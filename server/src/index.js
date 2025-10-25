import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import { db, upsertSourceStmt, withTransaction, selectRecentSourcesStmt, selectSourcesByDateStmt, insertReportStmt, updateReportStmt, selectSourcesByIdsStmt, deleteSourceStmt } from './db.js'
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

// List sources for a window (absolute or relative)
app.get('/api/sources', (req, res) => {
  const { since = '-14 days', limit = 200, start, end } = req.query
  const normalizedStart = normalizeDateParam(start, false)
  const normalizedEnd = normalizeDateParam(end, true)

  const rows = normalizedStart || normalizedEnd
    ? selectSourcesByDateStmt.all({ start: normalizedStart, end: normalizedEnd, limit: Number(limit) })
    : selectRecentSourcesStmt.all({ since: String(since), limit: Number(limit) })

  res.json({ items: rows })
})

app.delete('/api/sources/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid source id' })
    const info = deleteSourceStmt.run(id)
    if (info.changes === 0) return res.status(404).json({ error: 'Source not found' })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// New: One-pass briefing creation (curate -> talking points)
app.post('/api/briefings', async (req, res) => {
  try {
    const {
      persona: rawPersona,
      prompt = '',
      request = '',
      since = '-14 days',
      limit = 200,
      startDate,
      endDate,
    } = req.body || {}

    const persona = typeof rawPersona === 'string' && rawPersona.trim() ? rawPersona.trim() : null
    const userPrompt = typeof prompt === 'string' && prompt.trim()
      ? prompt.trim()
      : (typeof request === 'string' && request.trim() ? request.trim() : '')
    const promptCopy = userPrompt || 'No additional guidance provided.'
    const normalizedStart = normalizeDateParam(startDate, false)
    const normalizedEnd = normalizeDateParam(endDate, true)

    const sources = normalizedStart || normalizedEnd
      ? selectSourcesByDateStmt.all({ start: normalizedStart, end: normalizedEnd, limit: Number(limit) })
      : selectRecentSourcesStmt.all({ since: String(since), limit: Number(limit) })
    if (!sources.length) return res.status(400).json({ error: 'No sources available to curate' })

    // Build curation prompt (indices)
    const list = sources
      .map((s, i) => `${i}. ${s.title || 'Untitled'} (${s.source || 'Unknown'}) — ${truncate(s.description, 400)}`)
      .join('\n')
    const curationPrompt = `You are curating AI developments for an executive briefing.\n\nAudience: Fortune 100 executives.\n\nUser prompt:\n${promptCopy}\n\nSources:\n${list}\n\nSelect 5-10 most strategically relevant items. Return ONLY JSON:\n{ "selected": [0,2], "reasoning": "brief why" }`
    const curationText = await callClaude({ model: MODEL, messages: [{ role: 'user', content: [{ type: 'text', text: curationPrompt }] }] })
    const curation = extractJson(curationText)
    const selectedIndices = normalizeSelectedIndices(curation)

    const fallbackIndices = sources.slice(0, Math.min(6, sources.length)).map((_, i) => i)
    const indicesToUse = (selectedIndices.length ? selectedIndices : fallbackIndices)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 0 && value < sources.length)

    const selected = indicesToUse
      .map((i) => sources[i])
      .filter(Boolean)

    // Compose executive-ready talking points from selected sources
    const selectedList = selected
      .map((s, i) => `${i + 1}. ${s.title} — ${truncate(s.description, 800)}`)
      .join('\n')
    const tpPrompt = `You are generating an executive-ready AI briefing email.\n\nAudience: Fortune 100 executives.\nStyle: crisp, factual, quantify when possible, no hype, highlight risks/compliance and competitive moves.\n\nUser prompt:\n${promptCopy}\n\nSelected sources:\n${selectedList}\n\nReturn ONLY JSON:\n{ "summary": "1-2 sentences", "points": [{"title":"...","url":"...","type":"Article|Podcast|Research","insight":"2-3 sentences: key takeaway","implication":"2-3 sentences: what this means for execs"}] }`
    const tpText = await callClaude({ model: MODEL, messages: [{ role: 'user', content: [{ type: 'text', text: tpPrompt }] }] })
    const json = extractJson(tpText)
    if (!json?.summary || !Array.isArray(json.points)) return res.status(502).json({ error: 'Invalid briefing response' })

    const record = {
      persona,
      request: userPrompt,
      reasoning: curation?.reasoning || '',
      outline_json: null,
      final_points_json: JSON.stringify(json),
    }
    const info = insertReportStmt.run(record)

    const briefing = { ...json, generatedAt: new Date().toISOString(), reasoning: record.reasoning }
    return res.json({ ok: true, id: info.lastInsertRowid, briefing, selectedIds: selected.map((s) => s.id), selectedUrls: selected.map((s) => s.url) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// New: Revise an existing briefing with feedback and optional pins/exclusions
app.post('/api/briefings/:id/revise', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const {
      prompt = '',
      feedback = '',
      selectedSourceIds = [],
      pinnedPoints = [],
      droppedUrls = [],
      keepPinned = true,
    } = req.body || {}

    if (!Array.isArray(selectedSourceIds) || selectedSourceIds.length === 0) {
      return res.status(400).json({ error: 'selectedSourceIds required for revision' })
    }

    const userPrompt = typeof prompt === 'string' && prompt.trim() ? prompt.trim() : ''
    const promptCopy = userPrompt || 'No additional guidance provided.'
    const feedbackCopy = typeof feedback === 'string' && feedback.trim() ? feedback.trim() : 'none'

    const idsJson = JSON.stringify(selectedSourceIds.map(Number).filter(Boolean))
    const sources = selectSourcesByIdsStmt.all({ idsJson })

    const list = sources
      .map((s, i) => `${i + 1}. ${s.title} — ${truncate(s.description, 800)}`)
      .join('\n')

    const pinnedJson = Array.isArray(pinnedPoints) && pinnedPoints.length
      ? JSON.stringify(pinnedPoints)
      : '[]'
    const droppedList = Array.isArray(droppedUrls) && droppedUrls.length
      ? droppedUrls.map((u) => `- ${u}`).join('\n')
      : '(none)'

    const revisePrompt = `You are revising an executive AI briefing.\n\nAudience: Fortune 100 executives. Style: crisp, factual, quantify where possible, no hype.\n\nUser prompt:\n${promptCopy}\n\nUser feedback:\n${feedbackCopy}\n\nSelected sources:\n${list}\n\nPinned points (JSON array)${keepPinned ? ' — keep these verbatim at the top' : ''}:\n${pinnedJson}\n\nExclude any points based on these URLs:\n${droppedList}\n\nReturn ONLY JSON:\n{ "summary": "1-2 sentences", "points": [{"title":"...","url":"...","type":"Article|Podcast|Research","insight":"...","implication":"..."}] }`

    const text = await callClaude({ model: MODEL, messages: [{ role: 'user', content: [{ type: 'text', text: revisePrompt }] }] })
    const json = extractJson(text)
    if (!json?.summary || !Array.isArray(json.points)) return res.status(502).json({ error: 'Invalid briefing response' })

    // Merge pinned points if requested, filter out dropped/duplicates by url
    const droppedSet = new Set((Array.isArray(droppedUrls) ? droppedUrls : []).map(String))
    const pinned = keepPinned && Array.isArray(pinnedPoints) ? pinnedPoints.filter((p) => p && p.url && !droppedSet.has(String(p.url))) : []
    const pinnedUrls = new Set(pinned.map((p) => String(p.url)))
    const newPoints = json.points.filter((p) => p && p.url && !pinnedUrls.has(String(p.url)) && !droppedSet.has(String(p.url)))
    const merged = pinned.length ? { ...json, points: [...pinned, ...newPoints] } : json

    updateReportStmt.run({ id, reasoning: null, outline_json: null, final_points_json: JSON.stringify(merged) })
    res.json({ ok: true, briefing: merged })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// Create a report: curate -> outline (9 bullets)
app.post('/api/reports', async (req, res) => {
  try {
    const {
      persona: rawPersona,
      prompt = '',
      request = '',
      since = '-14 days',
      limit = 200,
      startDate,
      endDate,
    } = req.body || {}
    const persona = typeof rawPersona === 'string' && rawPersona.trim() ? rawPersona.trim() : null
    const userPrompt = typeof prompt === 'string' && prompt.trim()
      ? prompt.trim()
      : (typeof request === 'string' && request.trim() ? request.trim() : '')
    const promptCopy = userPrompt || 'No additional guidance provided.'
    const normalizedStart = normalizeDateParam(startDate, false)
    const normalizedEnd = normalizeDateParam(endDate, true)

    const sources = normalizedStart || normalizedEnd
      ? selectSourcesByDateStmt.all({ start: normalizedStart, end: normalizedEnd, limit: Number(limit) })
      : selectRecentSourcesStmt.all({ since: String(since), limit: Number(limit) })
    if (!sources.length) return res.status(400).json({ error: 'No sources available to curate' })

    // Build curation prompt (indices)
    const list = sources
      .map((s, i) => `${i}. ${s.title || 'Untitled'} (${s.source || 'Unknown'}) — ${truncate(s.description, 400)}`)
      .join('\n')
    const curationPrompt = `You are curating AI news for an executive briefing.\n\nUser prompt:\n${promptCopy}\n\nSources:\n${list}\n\nSelect 4-8 most relevant items. Return ONLY JSON:\n{ "selected": [0,2], "reasoning": "why" }`
    const curationText = await callClaude({ model: MODEL, messages: [{ role: 'user', content: [{ type: 'text', text: curationPrompt }] }] })
    const curation = extractJson(curationText)
    const selectedIndices = normalizeSelectedIndices(curation)

    if (!selectedIndices.length) {
      console.warn('Invalid curation response, falling back to recency', {
        curationText,
        parsed: curation,
      })
    }

    const fallbackIndices = sources.slice(0, Math.min(6, sources.length)).map((_, i) => i)
    const indicesToUse = (selectedIndices.length ? selectedIndices : fallbackIndices)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 0 && value < sources.length)

    const selected = indicesToUse
      .map((i) => sources[i])
      .filter(Boolean)

    // Outline prompt (9 bullets)
    const selectedList = selected
      .map((s, i) => `${i + 1}. ${s.title} — ${truncate(s.description, 600)}`)
      .join('\n')
    const outlinePrompt = `You are drafting a report outline for an executive briefing.\n\nUser prompt:\n${promptCopy}\n\nSelected sources:\n${selectedList}\n\nPropose 9 bullets with angles. Return ONLY JSON:\n{ "outline": [{"title":"...","angle":"...","sources":["url"]}], "reasoning":"..." }`
    const outlineText = await callClaude({ model: MODEL, messages: [{ role: 'user', content: [{ type: 'text', text: outlinePrompt }] }] })
    const outline = extractJson(outlineText)
    if (!Array.isArray(outline?.outline)) return res.status(502).json({ error: 'Invalid outline response' })

    const report = {
      persona,
      request: userPrompt,
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
    const { prompt = '', feedback = '', selectedSourceIds = [] } = req.body || {}
    const userPrompt = typeof prompt === 'string' && prompt.trim() ? prompt.trim() : ''
    const promptCopy = userPrompt || 'No additional guidance provided.'
    const feedbackCopy = typeof feedback === 'string' && feedback.trim() ? feedback.trim() : 'none'

    const idsJson = JSON.stringify(selectedSourceIds.map(Number).filter(Boolean))
    const sources = selectSourcesByIdsStmt.all({ idsJson })

    const list = sources
      .map((s, i) => `${i + 1}. ${s.title} — ${truncate(s.description, 800)}`)
      .join('\n')
    const promptText = `You are generating an executive briefing.\n\nUser prompt:\n${promptCopy}\n\nUser feedback: ${feedbackCopy}\n\nSelected sources:\n${list}\n\nReturn ONLY JSON with: { "summary": "...", "points": [{"title":"...","url":"...","type":"Article|Podcast|Research","insight":"...","implication":"..."}] }`
    const text = await callClaude({ model: MODEL, messages: [{ role: 'user', content: [{ type: 'text', text: promptText }] }] })
    const json = extractJson(text)
    if (!json?.summary || !Array.isArray(json.points)) return res.status(502).json({ error: 'Invalid briefing response' })

    updateReportStmt.run({ id, reasoning: null, outline_json: null, final_points_json: JSON.stringify(json) })
    res.json({ ok: true, briefing: json })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

function normalizeDateParam(value, endOfDay) {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  if (endOfDay) {
    parsed.setHours(23, 59, 59, 999)
  } else {
    parsed.setHours(0, 0, 0, 0)
  }
  return parsed.toISOString()
}

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

function normalizeSelectedIndices(curation) {
  if (!curation || typeof curation !== 'object') return []

  const candidates = [
    curation.selected,
    curation.selected_indices,
    curation.selectedIndexes,
    curation.selected_indexes,
    curation.indices,
    curation.indexes,
    curation.selectedItems,
    curation.selected_items,
    curation.selection,
    curation.choices,
    curation.items,
  ]

  for (const candidate of candidates) {
    const indices = extractIndexArray(candidate)
    if (indices.length) return Array.from(new Set(indices))
  }

  const truthyKeys = Object.entries(curation)
    .filter(([, value]) => typeof value === 'boolean' ? value : false)
    .map(([key]) => Number(key))
    .filter((value) => Number.isInteger(value))

  return Array.from(new Set(truthyKeys))
}

function extractIndexArray(candidate) {
  if (!candidate) return []

  if (Array.isArray(candidate)) {
    return candidate.flatMap((value) => {
      if (typeof value === 'number') return [value]
      if (typeof value === 'string') {
        const num = Number.parseInt(value, 10)
        return Number.isInteger(num) ? [num] : []
      }
      if (value && typeof value === 'object') {
        const inner =
          value.index ?? value.idx ?? value.i ?? value.position ?? value.value ?? value.selection
        const num = Number(inner)
        if (Number.isInteger(num)) return [num]
        if (Array.isArray(inner) || typeof inner === 'object') {
          return extractIndexArray(inner)
        }
      }
      return []
    })
  }

  if (typeof candidate === 'string') {
    return candidate
      .split(/[\s,;]+/)
      .map((part) => Number.parseInt(part, 10))
      .filter((value) => Number.isInteger(value))
  }

  if (typeof candidate === 'object') {
    const nested =
      candidate.indices || candidate.indexes || candidate.values || candidate.list || candidate.selected
    const nestedArray = extractIndexArray(nested)

    const truthyKeys = Object.entries(candidate)
      .filter(([, value]) => typeof value === 'boolean' ? value : false)
      .map(([key]) => Number.parseInt(key, 10))
      .filter((value) => Number.isInteger(value))

    return [...nestedArray, ...truthyKeys]
  }

  return []
}

const PORT = Number(process.env.PORT || 8787)
app.listen(PORT, () => {
  console.log(`Whisperer server listening on :${PORT}`)
})
