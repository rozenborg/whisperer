import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import { db, upsertSourceStmt, withTransaction, selectRecentSourcesStmt, insertReportStmt, updateReportStmt, selectSourcesByIdsStmt } from './db.js'
import { normalizeUrl, urlFingerprint } from './urlUtils.js'
import { callClaude } from './anthropic.js'

const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))
app.use(morgan('dev'))

const MODEL = process.env.VITE_ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022'

// Health
app.get('/api/health', (req, res) => res.json({ ok: true }))

// Compatibility proxy for the client-side claudeAPI.js
app.post('/api/anthropic/messages', async (req, res) => {
  try {
    const { model = MODEL, max_tokens = 2000, messages } = req.body || {}
    const text = await callClaude({ model, max_tokens, messages })
    res.json({
      content: [{ type: 'text', text }],
      model,
      role: 'assistant',
    })
  } catch (e) {
    res.status(500).json({ error: { message: e.message } })
  }
})

// Ingest: upsert a batch of sources (cap per run)
app.post('/api/ingest', (req, res) => {
  const { items } = req.body || {}
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items array required' })
  const MAX_PER_RUN = Number(process.env.MAX_SOURCES_PER_RUN || 42)

  // enforce cap early to avoid unnecessary work
  const batch = items.slice(0, Math.max(0, MAX_PER_RUN))

  const save = withTransaction(() => {
    let inserted = 0
    for (const item of batch) {
      const url = String(item.url || '').trim()
      if (!url) continue
      const normal = normalizeUrl(url)
      const payload = {
        url,
        url_unique: urlFingerprint(normal),
        title: item.title || null,
        source: item.source || null,
        source_type: item.sourceType || null,
        published_at: item.date || null,
        description: item.description || null,
        origin_key: item.source || null,
      }
      try {
        upsertSourceStmt.run(payload)
        inserted += 1
      } catch (e) {
        // unique conflict + no updates: ignore
      }
      if (inserted >= MAX_PER_RUN) break
    }
    return { inserted, capped: MAX_PER_RUN }
  })

  const result = save()
  res.json({ ok: true, ...result })
})

// List recent sources for a date window (e.g., since = '-14 days')
app.get('/api/sources', (req, res) => {
  const { since = '-14 days', limit = 200 } = req.query
  const rows = selectRecentSourcesStmt.all({ since: String(since), limit: Number(limit) })
  res.json({ items: rows })
})

// Create a report: curate -> outline (9 bullets)
app.post('/api/reports', async (req, res) => {
  try {
    const { persona = 'Executive', request = '', since = '-14 days', limit = 200 } = req.body || {}
    const sources = selectRecentSourcesStmt.all({ since: String(since), limit: Number(limit) })
    if (!sources.length) return res.status(400).json({ error: 'No sources available to curate' })

    // Build curation prompt (indices)
    const list = sources
      .map((s, i) => `${i}. ${s.title || 'Untitled'} (${s.source || 'Unknown'}) — ${truncate(s.description, 400)}`)
      .join('\n')
    const curationPrompt = `You are curating AI news for ${persona}.\n\nSources:\n${list}\n\nSelect 4-8 most relevant items. Return ONLY JSON:\n{ "selected": [0,2], "reasoning": "why" }`
    const curationText = await callClaude({ model: MODEL, messages: [{ role: 'user', content: [{ type: 'text', text: curationPrompt }] }] })
    const curation = extractJson(curationText)
    if (!curation?.selected) return res.status(502).json({ error: 'Invalid curation response' })

    const selected = curation.selected
      .map((i) => sources[i])
      .filter(Boolean)

    // Outline prompt (9 bullets)
    const selectedList = selected
      .map((s, i) => `${i + 1}. ${s.title} — ${truncate(s.description, 600)}`)
      .join('\n')
    const outlinePrompt = `You are drafting a report outline for ${persona}.\n\nSelected sources:\n${selectedList}\n\nPropose 9 bullets with angles. Return ONLY JSON:\n{ "outline": [{"title":"...","angle":"...","sources":["url"]}], "reasoning":"..." }`
    const outlineText = await callClaude({ model: MODEL, messages: [{ role: 'user', content: [{ type: 'text', text: outlinePrompt }] }] })
    const outline = extractJson(outlineText)
    if (!Array.isArray(outline?.outline)) return res.status(502).json({ error: 'Invalid outline response' })

    const report = {
      persona,
      request,
      reasoning: outline.reasoning || curation.reasoning || '',
      outline_json: JSON.stringify(outline.outline),
      final_points_json: null,
    }
    const info = insertReportStmt.run(report)
    return res.json({ ok: true, id: info.lastInsertRowid, outline: outline.outline, reasoning: report.reasoning, selectedIds: selected.map((s) => s.id), selectedUrls: selected.map((s) => s.url) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// Finalize report with feedback -> talking points
app.post('/api/reports/:id/finalize', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const { persona = 'Executive', feedback = '', selectedSourceIds = [] } = req.body || {}

    const idsJson = JSON.stringify(selectedSourceIds.map(Number).filter(Boolean))
    const sources = selectSourcesByIdsStmt.all({ idsJson })

    const list = sources
      .map((s, i) => `${i + 1}. ${s.title} — ${truncate(s.description, 800)}`)
      .join('\n')
    const prompt = `You are generating an executive briefing for ${persona}.\n\nUser feedback: ${feedback || 'none'}\n\nSelected sources:\n${list}\n\nReturn ONLY JSON with: { "summary": "...", "points": [{"title":"...","url":"...","type":"Article|Podcast|Research","insight":"...","implication":"..."}] }`
    const text = await callClaude({ model: MODEL, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }] })
    const json = extractJson(text)
    if (!json?.summary || !Array.isArray(json.points)) return res.status(502).json({ error: 'Invalid briefing response' })

    updateReportStmt.run({ id, reasoning: null, outline_json: null, final_points_json: JSON.stringify(json) })
    res.json({ ok: true, briefing: json })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

function truncate(v, n) {
  if (!v) return ''
  const s = String(v).replace(/\s+/g, ' ').trim()
  return s.length <= n ? s : s.slice(0, n - 1) + '…'
}

function extractJson(text) {
  try { return JSON.parse(text) } catch {}
  const m = text && text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

const PORT = Number(process.env.PORT || 8787)
app.listen(PORT, () => {
  console.log(`Whisperer server listening on :${PORT}`)
})
