import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import { db, upsertSourceStmt, withTransaction, selectRecentSourcesStmt, selectSourcesByDateStmt, insertReportStmt, updateReportStmt, selectSourcesByIdsStmt, selectSourceByUrlUniqueStmt, deleteSourceStmt, selectContentsBySourceIdsStmt, upsertContentStmt, selectSourcesByFtsStmt, selectEmbeddingsBySourceIdsStmt, upsertEmbeddingStmt, countSourcesStmt, countEnrichedSourcesStmt, countReportsStmt, updateSourceStarStmt, clearSourceStarStmt, updateSourceHideStmt, clearSourceHideStmt, insertTalkingPointStmt, updateTalkingPointStmt, deleteTalkingPointStmt, selectTalkingPointsStmt, selectTalkingPointByIdStmt, selectSourceNoteBySourceIdStmt, upsertSourceNoteStmt, selectTalkingPointTagCountsStmt, selectTalkingPointDailyCountsStmt, countTalkingPointsStmt } from './db.js'
import { normalizeUrl, urlFingerprint } from './urlUtils.js'
import { callClaude } from './anthropic.js'
import { applyFeedPolicies, policyForFeedKey } from './feeds.js'
import fetch from 'node-fetch'
import { embedTexts, normalizeVector, cosineSimilarity, isEmbeddingConfigured } from './embeddings.js'

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
  const MAX_PER_RUN = Number(process.env.MAX_SOURCES_PER_RUN || 0)

  // Server-side feed policies override UI caps
  const policyBatch = applyFeedPolicies(items)
  // Optional global safeguard (0 or negative disables)
  const globalCap = Number.isFinite(MAX_PER_RUN) && MAX_PER_RUN > 0 ? MAX_PER_RUN : null
  const batch = globalCap ? policyBatch.slice(0, globalCap) : policyBatch

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
        source_type: item.sourceType || item.feedType || null,
        published_at: normalizePublishedAt(item.date),
        description: item.description || null,
        origin_key: item.feedKey || item.source || null,
      }
      try {
        upsertSourceStmt.run(payload)
        inserted += 1
      } catch (e) {
        // unique conflict + no updates: ignore
      }
      if (globalCap && inserted >= globalCap) break
    }
    return { inserted, capped: globalCap || null }
  })

  const result = save()
  res.json({ ok: true, ...result })
})

// Enrich: fetch and cache full content/transcripts on demand
app.post('/api/enrich', async (req, res) => {
  try {
    const { sourceIds = [], force = false } = req.body || {}
    const ids = Array.isArray(sourceIds)
      ? sourceIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
      : []
    if (!ids.length) {
      return res.status(400).json({ error: 'sourceIds array required' })
    }

    const idsJson = JSON.stringify(ids)
    const sources = selectSourcesByIdsStmt.all({ idsJson })
    if (!sources.length) {
      return res.status(404).json({ error: 'No matching sources found' })
    }

    await enrichSourcesIfNeeded(sources, { force: Boolean(force) })
    const contents = getContentsMap(ids)

    const items = sources.map((source) => {
      const content = contents.get(source.id)
      const excerpt = buildExcerptForSource(source, content)
      const hasText = Boolean(content?.content_text || content?.transcript_text)
      return {
        id: source.id,
        url: source.url,
        title: source.title,
        source: source.source,
        sourceType: source.source_type,
        description: source.description,
        hasContent: hasText,
        enrichedAt: content?.enriched_at || null,
        excerpt,
        contentText: content?.content_text || null,
        transcriptUrl: content?.transcript_url || null,
        transcriptText: content?.transcript_text || null,
      }
    })

    res.json({ ok: true, items })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
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

app.get('/api/stats', (req, res) => {
  try {
    const totalSources = countSourcesStmt.get().total || 0
    const enrichedSources = countEnrichedSourcesStmt.get().total || 0
    const totalReports = countReportsStmt.get().total || 0
    const totalTalkingPoints = countTalkingPointsStmt.get().total || 0
    res.json({ ok: true, totalSources, enrichedSources, totalReports, totalTalkingPoints })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/talking-points', (req, res) => {
  try {
    const { start, end, limit = 100 } = req.query
    const normalizedStart = normalizeDateParam(start, false)
    const normalizedEnd = normalizeDateParam(end, true)
    const limitNum = Math.min(Math.max(Number(limit) || 100, 1), 500)

    const rows = selectTalkingPointsStmt.all({
      start: normalizedStart,
      end: normalizedEnd,
      limit: limitNum,
    })

    const items = rows
      .map((row) => mapTalkingPointRow(row))
      .filter(Boolean)

    res.json({ ok: true, items })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/talking-points', (req, res) => {
  try {
    const {
      headline,
      body,
      sourceId,
      sourceUrl,
      relatedSourceIds,
      tags,
      originalHeadline,
      originalBody,
      savedAt,
    } = req.body || {}
    const headlineText = typeof headline === 'string' ? headline.trim() : ''
    const bodyText = typeof body === 'string' ? body.trim() : ''
    if (!headlineText || !bodyText) {
      return res.status(400).json({ error: 'headline and body are required' })
    }

    const resolvedSourceId = resolveSourceId({ sourceId, sourceUrl })
    const relatedIds = sanitizeRelatedIds(relatedSourceIds, resolvedSourceId)

    const normalizedTags = sanitizeTagList(tags)
    const editDistance = computeCombinedEditDistance({
      headline: headlineText,
      body: bodyText,
      originalHeadline,
      originalBody,
    })

    const payload = {
      source_id: resolvedSourceId,
      headline: headlineText,
      body: bodyText,
      related_source_ids: JSON.stringify(relatedIds),
      tags: JSON.stringify(normalizedTags),
      edit_distance: editDistance,
      saved_at: savedAt ? new Date(savedAt).toISOString() : undefined,
    }

    const info = insertTalkingPointStmt.run(payload)
    const created = selectTalkingPointByIdStmt.get(info.lastInsertRowid)
    res.status(201).json({ ok: true, item: mapTalkingPointRow(created) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/talking-points/metrics', (req, res) => {
  try {
    const tagRows = selectTalkingPointTagCountsStmt.all()
    const dailyRows = selectTalkingPointDailyCountsStmt.all({ limit: Number(req.query.limit) || 30 })
    const aggregates = db.prepare('SELECT COUNT(*) AS total, AVG(edit_distance) AS avg_edit FROM talking_points').get()

    res.json({
      ok: true,
      total: aggregates?.total || 0,
      averageEditDistance: aggregates?.avg_edit ? Number(aggregates.avg_edit) : 0,
      tagCounts: tagRows
        .map((row) => ({ tag: row.tag, count: row.count }))
        .filter((row) => row.tag && row.tag !== 'unknown'),
      daily: dailyRows.map((row) => ({
        day: row.day,
        count: row.count,
        averageEditDistance: row.avg_edit_distance ? Number(row.avg_edit_distance) : 0,
      })),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

app.put('/api/talking-points/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid talking point id' })
    }

    const {
      headline,
      body,
      sourceId,
      sourceUrl,
      relatedSourceIds,
      tags,
      originalHeadline,
      originalBody,
      savedAt,
    } = req.body || {}
    const payload = { id }
    let updated = false

    if (typeof headline === 'string') {
      const trimmed = headline.trim()
      if (trimmed) {
        payload.headline = trimmed
        updated = true
      }
    }

    if (typeof body === 'string') {
      const trimmedBody = body.trim()
      if (trimmedBody) {
        payload.body = trimmedBody
        updated = true
      }
    }

    if (typeof sourceId !== 'undefined' || typeof sourceUrl !== 'undefined') {
      payload.source_id = resolveSourceId({ sourceId, sourceUrl })
      updated = true
    }

    if (typeof relatedSourceIds !== 'undefined') {
      payload.related_source_ids = JSON.stringify(
        sanitizeRelatedIds(relatedSourceIds, payload.source_id ?? null),
      )
      updated = true
    }

    if (typeof tags !== 'undefined') {
      const normalizedTags = sanitizeTagList(tags)
      payload.tags = JSON.stringify(normalizedTags)
      updated = true
    }

    if (typeof originalHeadline !== 'undefined' || typeof originalBody !== 'undefined') {
      const editDistance = computeCombinedEditDistance({
        headline: payload.headline || headline,
        body: payload.body || body,
        originalHeadline,
        originalBody,
      })
      payload.edit_distance = editDistance
      updated = true
    }

    if (typeof savedAt === 'string') {
      const parsed = new Date(savedAt)
      if (!Number.isNaN(parsed.getTime())) {
        payload.saved_at = parsed.toISOString()
        updated = true
      }
    }

    if (!updated) {
      return res.status(400).json({ error: 'No updates provided' })
    }

    const info = updateTalkingPointStmt.run(payload)
    if (info.changes === 0) {
      return res.status(404).json({ error: 'Talking point not found' })
    }

    const updatedRow = selectTalkingPointByIdStmt.get(id)
    res.json({ ok: true, item: mapTalkingPointRow(updatedRow) })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/talking-points/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid talking point id' })
    }
    const info = deleteTalkingPointStmt.run(id)
    if (info.changes === 0) {
      return res.status(404).json({ error: 'Talking point not found' })
    }
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/search', async (req, res) => {
  try {
    const { q = '', limit = 20, start, end, useEmbeddings = 'true' } = req.query
    const query = typeof q === 'string' ? q.trim() : ''
    if (!query) {
      return res.status(400).json({ error: 'q parameter required' })
    }

    const normalizedStart = normalizeDateParam(start, false)
    const normalizedEnd = normalizeDateParam(end, true)
    const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 100)
    const ranking = await rankSourcesForPrompt({
      prompt: query,
      limit: limitNum,
      start: normalizedStart,
      end: normalizedEnd,
      useEmbeddings: useEmbeddings !== 'false',
    })

    const items = ranking.items.map((item) => ({
      id: item.id,
      title: item.title,
      url: item.url,
      source: item.source,
      source_type: item.source_type,
      description: item.description,
      published_at: item.published_at,
      created_at: item.created_at,
      excerpt: item.excerpt,
      scores: item._scores,
    }))

    res.json({ ok: true, items, meta: ranking.meta })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/sources/:id', (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid source id' })
    // Clean up any cached content for this source first
    db.prepare('DELETE FROM contents WHERE source_id = ?').run(id)
    const info = deleteSourceStmt.run(id)
    if (info.changes === 0) return res.status(404).json({ error: 'Source not found' })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/sources/:id/star', async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid source id' })

    const source = getSourceById(id)
    if (!source) return res.status(404).json({ error: 'Source not found' })

    updateSourceStarStmt.run({ id })

    await enrichSourcesIfNeeded([source], { force: true })

    const note = await generateSourceNoteForSource(source)
    if (!note || !Array.isArray(note.points) || note.points.length === 0) {
      return res.status(502).json({ error: 'Note generation failed' })
    }

    upsertSourceNoteStmt.run({
      source_id: id,
      points_json: JSON.stringify(note.points),
    })

    res.json({ ok: true, starredAt: new Date().toISOString(), note })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/sources/:id/star', (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid source id' })
    clearSourceStarStmt.run({ id })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/sources/:id/hide', (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid source id' })
    updateSourceHideStmt.run({ id })
    res.json({ ok: true, hiddenAt: new Date().toISOString() })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

app.delete('/api/sources/:id/hide', (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid source id' })
    clearSourceHideStmt.run({ id })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/sources/:id/note', (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid source id' })
    const row = selectSourceNoteBySourceIdStmt.get(id)
    if (!row) return res.status(404).json({ error: 'Note not found' })
    res.json({ ok: true, note: mapSourceNoteRow(row) })
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

    let retrievalMeta = null
    let sources = []
    try {
      const ranking = await rankSourcesForPrompt({
        prompt: promptCopy,
        limit: Number(limit),
        start: normalizedStart,
        end: normalizedEnd,
        useEmbeddings: true,
      })
      sources = ranking.items
      retrievalMeta = ranking.meta
    } catch (err) {
      console.warn('Ranked retrieval failed, falling back to recency', err.message)
    }

    if (!sources.length) {
      sources = normalizedStart || normalizedEnd
        ? selectSourcesByDateStmt.all({ start: normalizedStart, end: normalizedEnd, limit: Number(limit) })
        : selectRecentSourcesStmt.all({ since: String(since), limit: Number(limit) })
      retrievalMeta = {
        usedEmbeddings: false,
        embeddingProvider: null,
        totalCandidates: sources.length,
        embeddingError: 'retrieval_fallback',
      }
    }

    if (!sources.length) return res.status(400).json({ error: 'No sources available to curate' })

    // Build curation prompt (indices)
    const list = sources
      .map((s, i) => `${i}. ${s.title || 'Untitled'} (${s.source || 'Unknown'}) — ${truncate(s.description, 400)}`)
      .join('\n')
    const curationPrompt = `You are curating AI developments for an executive briefing.\n\nAudience: Fortune 100 executives.\nBias: Prioritize very recent developments; select older items only if they add superior substance and are not hype.\n\nUser prompt:\n${promptCopy}\n\nSources:\n${list}\n\nSelect 5-10 most strategically relevant items. Return ONLY JSON:\n{ "selected": [0,2], "reasoning": "brief why" }`
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

    // Enrich selected sources with full content when possible
    await enrichSourcesIfNeeded(selected)

    const enrichedMap = getContentsMap(selected.map((s) => s.id))
    const entryContext = selected.map((s, index) => buildPromptEntry(s, enrichedMap.get(s.id), index))

    const draft = await buildTalkingPointsDraft({
      persona,
      promptCopy,
      entries: entryContext,
      feedbackText: null,
      pinnedPoints: [],
      droppedUrls: [],
    })

    if (!draft?.briefing?.summary || !Array.isArray(draft.briefing.points)) {
      return res.status(502).json({ error: 'Talking point generation failed validation' })
    }

    const record = {
      persona,
      request: userPrompt,
      reasoning: curation?.reasoning || '',
      outline_json: null,
      final_points_json: JSON.stringify(draft.briefing),
    }
    const info = insertReportStmt.run(record)

    const briefing = { ...draft.briefing, generatedAt: new Date().toISOString(), reasoning: record.reasoning }
    return res.json({
      ok: true,
      id: info.lastInsertRowid,
      briefing,
      selectedIds: selected.map((s) => s.id),
      selectedUrls: selected.map((s) => s.url),
      retrievalMeta,
    })
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

    await enrichSourcesIfNeeded(sources)
    const enrichedMap = getContentsMap(sources.map((s) => s.id))
    const entryContext = sources.map((s, index) => buildPromptEntry(s, enrichedMap.get(s.id), index))

    const draft = await buildTalkingPointsDraft({
      persona: null,
      promptCopy,
      entries: entryContext,
      feedbackText: feedbackCopy,
      pinnedPoints: keepPinned ? pinnedPoints : [],
      droppedUrls,
    })

    if (!draft?.briefing?.summary || !Array.isArray(draft.briefing.points)) {
      return res.status(502).json({ error: 'Revision failed validation' })
    }

    updateReportStmt.run({ id, reasoning: null, outline_json: null, final_points_json: JSON.stringify(draft.briefing) })
    res.json({ ok: true, briefing: draft.briefing })
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

    let retrievalMeta = null
    let sources = []
    try {
      const ranking = await rankSourcesForPrompt({
        prompt: promptCopy,
        limit: Number(limit),
        start: normalizedStart,
        end: normalizedEnd,
        useEmbeddings: true,
      })
      sources = ranking.items
      retrievalMeta = ranking.meta
    } catch (err) {
      console.warn('Ranked retrieval failed (report), falling back to recency', err.message)
    }

    if (!sources.length) {
      sources = normalizedStart || normalizedEnd
        ? selectSourcesByDateStmt.all({ start: normalizedStart, end: normalizedEnd, limit: Number(limit) })
        : selectRecentSourcesStmt.all({ since: String(since), limit: Number(limit) })
      retrievalMeta = {
        usedEmbeddings: false,
        embeddingProvider: null,
        totalCandidates: sources.length,
        embeddingError: 'retrieval_fallback',
      }
    }

    if (!sources.length) return res.status(400).json({ error: 'No sources available to curate' })

    // Build curation prompt (indices)
    const list = sources
      .map((s, i) => `${i}. ${s.title || 'Untitled'} (${s.source || 'Unknown'}) — ${truncate(s.description, 400)}`)
      .join('\n')
    const curationPrompt = `You are curating AI news for an executive briefing.\n\nBias: Favor the freshest developments; only reach for older material when it adds unique, trustworthy insight.\n\nUser prompt:\n${promptCopy}\n\nSources:\n${list}\n\nSelect 4-8 most relevant items. Return ONLY JSON:\n{ "selected": [0,2], "reasoning": "why" }`
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
    return res.json({
      ok: true,
      id: info.lastInsertRowid,
      outline: outline.outline,
      reasoning: report.reasoning,
      selectedIds: selected.map((s) => s.id),
      selectedUrls: selected.map((s) => s.url),
      retrievalMeta,
    })
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

function resolveSourceId({ sourceId, sourceUrl }) {
  const numeric = Number(sourceId)
  if (Number.isInteger(numeric) && numeric > 0) {
    return numeric
  }

  if (typeof sourceUrl === 'string' && sourceUrl.trim()) {
    try {
      const normalized = normalizeUrl(sourceUrl.trim())
      if (normalized) {
        const fingerprint = urlFingerprint(normalized)
        const match = selectSourceByUrlUniqueStmt.get(fingerprint)
        if (match?.id) {
          return match.id
        }
      }
    } catch (err) {
      console.warn('resolveSourceId lookup failed', err.message)
    }
  }

  return null
}

function sanitizeRelatedIds(value, primarySourceId = null) {
  if (value === null || typeof value === 'undefined') {
    return []
  }

  let candidates
  if (Array.isArray(value)) {
    candidates = value
  } else if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      candidates = Array.isArray(parsed) ? parsed : [value]
    } catch {
      candidates = value.split(/[,\s]+/).filter(Boolean)
    }
  } else {
    candidates = [value]
  }

  const primaryNumeric = Number(primarySourceId)
  const primary =
    Number.isInteger(primaryNumeric) && primaryNumeric > 0 ? primaryNumeric : null

  const seen = new Set()
  const result = []
  for (const candidate of candidates) {
    const num = Number(candidate)
    if (!Number.isInteger(num) || num <= 0) continue
    if (primary && num === primary) continue
    if (seen.has(num)) continue
    seen.add(num)
    result.push(num)
  }
  return result
}

function parseRelatedSourceIds(raw) {
  if (raw === null || typeof raw === 'undefined') return []
  if (Array.isArray(raw)) return sanitizeRelatedIds(raw)
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return sanitizeRelatedIds(parsed)
    } catch {
      return sanitizeRelatedIds(raw.split(/[,\s]+/).filter(Boolean))
    }
  }
  return sanitizeRelatedIds([raw])
}

function mapTalkingPointRow(row) {
  if (!row) return null
  const relatedSourceIds = parseRelatedSourceIds(row.related_source_ids)
  const source =
    row.source_id && (row.source_title || row.source_url || row.source_name)
      ? {
          id: row.source_id,
          title: row.source_title || null,
          url: row.source_url || null,
          source: row.source_name || null,
          sourceType: row.source_type || null,
        }
      : null
  let tags = []
  try {
    if (row.tags) {
      const parsed = JSON.parse(row.tags)
      if (Array.isArray(parsed)) {
        tags = parsed.map((tag) => String(tag).trim()).filter(Boolean)
      }
    }
  } catch {
    tags = []
  }
  return {
    id: row.id,
    sourceId: row.source_id || null,
    headline: row.headline,
    body: row.body,
    relatedSourceIds,
    tags,
    editDistance: Number.isFinite(row.edit_distance) ? Number(row.edit_distance) : 0,
    savedAt: row.saved_at || row.updated_at || row.created_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    source,
  }
}

function mapSourceNoteRow(row) {
  if (!row) return null
  let points = []
  try {
    const parsed = JSON.parse(row.points_json)
    if (Array.isArray(parsed)) {
      points = parsed
    }
  } catch (err) {
    console.warn('Failed to parse source note JSON', err.message)
  }
  return {
    sourceId: row.source_id,
    points,
    generatedAt: row.generated_at,
    updatedAt: row.updated_at,
  }
}

function getSourceById(id) {
  const numericId = Number(id)
  if (!Number.isInteger(numericId) || numericId <= 0) return null
  const rows = selectSourcesByIdsStmt.all({ idsJson: JSON.stringify([numericId]) })
  return Array.isArray(rows) && rows.length ? rows[0] : null
}

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

function sanitizeTag(value) {
  if (!value || typeof value !== 'string') return ''
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32)
}

function clampNumber(value, min, max, fallback = 0) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  if (numeric < min) return min
  if (numeric > max) return max
  return numeric
}

function sanitizeTagList(value) {
  if (value === null || typeof value === 'undefined') return []
  if (Array.isArray(value)) {
    return value
      .map((tag) => sanitizeTag(String(tag)))
      .filter(Boolean)
      .slice(0, 8)
  }
  if (typeof value === 'string') {
    return value
      .split(/[,\s]+/)
      .map((tag) => sanitizeTag(tag))
      .filter(Boolean)
      .slice(0, 8)
  }
  return []
}

function computeCombinedEditDistance({ headline, body, originalHeadline, originalBody }) {
  const normalizedOriginalHeadline = typeof originalHeadline === 'string' ? originalHeadline : ''
  const normalizedOriginalBody = typeof originalBody === 'string' ? originalBody : ''
  const headlineDistance = normalizedOriginalHeadline
    ? computeEditDistance(String(headline || ''), normalizedOriginalHeadline)
    : 0
  const bodyDistance = normalizedOriginalBody
    ? computeEditDistance(String(body || ''), normalizedOriginalBody)
    : 0
  return headlineDistance + bodyDistance
}

function computeEditDistance(a, b) {
  const s1 = typeof a === 'string' ? a : ''
  const s2 = typeof b === 'string' ? b : ''
  const len1 = s1.length
  const len2 = s2.length
  if (len1 === 0) return len2
  if (len2 === 0) return len1
  const prev = new Array(len2 + 1)
  const curr = new Array(len2 + 1)
  for (let j = 0; j <= len2; j += 1) prev[j] = j
  for (let i = 1; i <= len1; i += 1) {
    curr[0] = i
    for (let j = 1; j <= len2; j += 1) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      )
    }
    for (let j = 0; j <= len2; j += 1) prev[j] = curr[j]
  }
  return curr[len2]
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

// --- Enrichment helpers ---
function getContentsMap(sourceIds) {
  const idsJson = JSON.stringify((sourceIds || []).map(Number).filter(Boolean))
  const rows = selectContentsBySourceIdsStmt.all({ idsJson })
  const map = new Map()
  for (const row of rows) map.set(row.source_id, row)
  return map
}

function buildExcerptForSource(source, contentRow) {
  const MAX = 1200
  const base =
    contentRow?.snippet_text ||
    contentRow?.content_text ||
    contentRow?.transcript_text ||
    source.description ||
    ''
  return truncate(base, MAX)
}

function getEmbeddingsMap(sourceIds) {
  const ids = (sourceIds || []).map(Number).filter(Boolean)
  if (!ids.length) return new Map()
  const idsJson = JSON.stringify(ids)
  const rows = selectEmbeddingsBySourceIdsStmt.all({ idsJson })
  const map = new Map()
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.vector)
      const vector = Float32Array.from(parsed)
      map.set(row.source_id, { provider: row.provider, model: row.model, vector })
    } catch (err) {
      console.warn('Failed to parse embedding for source', row.source_id, err.message)
    }
  }
  return map
}

function buildEmbeddingText(source, contentRow) {
  const TEXT_LIMIT = 6000
  const parts = []
  if (source?.title) parts.push(String(source.title))
  if (contentRow?.content_text) {
    parts.push(String(contentRow.content_text))
  } else if (contentRow?.transcript_text) {
    parts.push(String(contentRow.transcript_text))
  } else if (source?.description) {
    parts.push(String(source.description))
  }
  const joined = parts.join('\n').replace(/\s+/g, ' ').trim()
  return joined ? joined.slice(0, TEXT_LIMIT) : ''
}

function buildFtsQuery(text) {
  if (!text) return ''
  const sanitized = text.replace(/["'\-]/g, ' ').replace(/[^\w\s]/g, ' ').trim()
  if (!sanitized) return ''
  const terms = sanitized.split(/\s+/).filter(Boolean)
  if (!terms.length) return ''
  return terms.map((term) => `${term}*`).join(' ')
}

function computeRecencyScore(publishedAt, createdAt, now = Date.now()) {
  const dateValue = publishedAt || createdAt
  if (!dateValue) return 0.2
  const timestamp = new Date(dateValue).getTime()
  if (Number.isNaN(timestamp)) return 0.2
  const ageMs = Math.max(0, now - timestamp)
  const ageDays = ageMs / 86400000
  const halfLife = Number(process.env.RECENCY_HALFLIFE_DAYS || 4)
  return Math.exp(-ageDays / Math.max(halfLife, 1))
}

async function ensureEmbeddingsForSources(sources, { force = false, contentsMap } = {}) {
  if (!isEmbeddingConfigured()) return new Map()
  const ids = sources.map((s) => s.id).filter(Boolean)
  if (!ids.length) return new Map()

  let existing = force ? new Map() : getEmbeddingsMap(ids)
  const missingSources = force ? sources : sources.filter((s) => !existing.has(s.id))
  if (!missingSources.length) return existing

  const map = contentsMap || getContentsMap(ids)
  const texts = []
  const meta = []
  for (const source of missingSources) {
    const contentRow = map.get(source.id)
    const text = buildEmbeddingText(source, contentRow)
    if (!text) continue
    texts.push(text)
    meta.push(source.id)
  }

  if (!texts.length) return existing

  const vectors = await embedTexts(texts)
  if (!vectors.length) return existing

  const provider = process.env.EMBEDDINGS_PROVIDER || 'openai'
  const model = process.env.EMBEDDING_MODEL || 'text-embedding-3-small'
  vectors.forEach((vector, idx) => {
    const sourceId = meta[idx]
    if (!sourceId) return
    const normalized = normalizeVector(vector)
    const serialized = JSON.stringify(Array.from(normalized))
    upsertEmbeddingStmt.run({
      source_id: sourceId,
      provider,
      model,
      vector: serialized,
    })
    existing.set(sourceId, { provider, model, vector: normalized })
  })

  return existing
}

async function rankSourcesForPrompt({ prompt, limit = 60, start, end, useEmbeddings = true }) {
  const query = typeof prompt === 'string' ? prompt.trim() : ''
  const clampedLimit = Math.min(Math.max(Number(limit) || 60, 5), 200)
  const match = buildFtsQuery(query)

  const lexicalLimit = Math.max(clampedLimit * 4, 80)
  const lexicalRows = match
    ? selectSourcesByFtsStmt.all({ match, start: start || null, end: end || null, limit: lexicalLimit })
    : []
  const recencyLimit = Math.max(clampedLimit * 3, 80)
  const recencyRows = selectSourcesByDateStmt.all({ start: start || null, end: end || null, limit: recencyLimit })

  const candidateMap = new Map()
  lexicalRows.forEach((row, index) => {
    const entry = candidateMap.get(row.id) || {}
    entry.source = entry.source || row
    entry.bm25 = typeof row.bm25 === 'number' ? row.bm25 : null
    entry.lexicalRank = index
    candidateMap.set(row.id, entry)
  })
  recencyRows.forEach((row, index) => {
    const entry = candidateMap.get(row.id)
    if (entry) {
      if (!entry.source) entry.source = row
      entry.recencyRank = index
    } else {
      candidateMap.set(row.id, { source: row, bm25: null, recencyRank: index })
    }
  })

  const candidates = Array.from(candidateMap.values()).filter((entry) => entry.source)
  if (!candidates.length) {
    return { items: [], meta: { usedEmbeddings: false, totalCandidates: 0, embeddingProvider: null, embeddingError: null } }
  }

  const candidateIds = candidates.map((entry) => entry.source.id)
  const contentsMap = getContentsMap(candidateIds)

  let queryEmbedding = null
  let docEmbeddings = new Map()
  let usedEmbeddings = false
  let embeddingError = null

  if (useEmbeddings && isEmbeddingConfigured() && query) {
    try {
      const vectors = await embedTexts([query])
      if (Array.isArray(vectors) && vectors.length > 0) {
        queryEmbedding = normalizeVector(vectors[0])
        docEmbeddings = await ensureEmbeddingsForSources(
          candidates.map((entry) => entry.source),
          { contentsMap },
        )
        usedEmbeddings = docEmbeddings.size > 0
      }
    } catch (err) {
      embeddingError = err
      console.warn('Query embedding failed', err.message)
    }
  }

  const now = Date.now()
  const recencyWeight = usedEmbeddings ? 0.5 : 0.6
  const embeddingWeight = usedEmbeddings ? 0.3 : 0
  const lexicalWeight = usedEmbeddings ? 0.2 : 0.4

  const scored = candidates.map((entry) => {
    const source = { ...entry.source }
    delete source.bm25
    const contentRow = contentsMap.get(source.id)
    const recencyScore = computeRecencyScore(source.published_at, source.created_at, now)
    const lexicalScore = typeof entry.bm25 === 'number' ? 1 / (1 + entry.bm25) : 0
    let embeddingScore = 0
    if (usedEmbeddings && queryEmbedding) {
      const doc = docEmbeddings.get(source.id)
      if (doc?.vector) {
        embeddingScore = cosineSimilarity(queryEmbedding, doc.vector)
      }
    }
    const finalScore = (recencyWeight * recencyScore) + (lexicalWeight * lexicalScore) + (embeddingWeight * embeddingScore)
    const excerpt = buildExcerptForSource(source, contentRow)
    return {
      ...source,
      excerpt,
      _scores: {
        final: finalScore,
        recency: recencyScore,
        lexical: lexicalScore,
        embedding: embeddingScore,
      },
    }
  })

  scored.sort((a, b) => b._scores.final - a._scores.final)
  const diversified = diversifySources(scored, docEmbeddings, {
    threshold: 0.82,
    limit: clampedLimit,
    maxPerCluster: 1,
  })
  const items = diversified.slice(0, clampedLimit)

  return {
    items,
    meta: {
      usedEmbeddings,
      embeddingProvider: usedEmbeddings ? process.env.EMBEDDINGS_PROVIDER || 'openai' : null,
      totalCandidates: candidates.length,
      embeddingError: embeddingError ? embeddingError.message : null,
      diversifiedCount: items.length,
    },
  }
}

async function enrichSourcesIfNeeded(sources, { force = false } = {}) {
  const sourceIds = sources.map((s) => s.id).filter(Boolean)
  if (!sourceIds.length) return
  const baselineContents = force ? new Map() : getContentsMap(sourceIds)
  for (const s of sources) {
    if (!force && baselineContents.has(s.id)) continue
    try {
      const policy = policyForFeedKey(s.origin_key)
      const type = (s.source_type || policy?.type || '').toLowerCase()
      if (type.includes('podcast')) {
        // For podcasts, cache the description as a fallback "transcript" when nothing else is available
        const transcript_text = s.description ? String(s.description) : null
        const snippet_text = transcript_text ? extractSnippet(transcript_text) : null
        upsertContentStmt.run({
          source_id: s.id,
          content_text: null,
          transcript_url: null,
          transcript_text,
          snippet_text,
        })
        continue
      }
      if (s.url) {
        const text = await fetchAndExtractText(s.url)
        if (text && text.trim()) {
          const snippet_text = extractSnippet(text) || (s.description ? extractSnippet(s.description) : null)
          upsertContentStmt.run({
            source_id: s.id,
            content_text: text,
            transcript_url: null,
            transcript_text: null,
            snippet_text,
          })
        } else if (s.description) {
          const snippet_text = extractSnippet(s.description)
          if (snippet_text) {
            upsertContentStmt.run({
              source_id: s.id,
              content_text: null,
              transcript_url: null,
              transcript_text: null,
              snippet_text,
            })
          }
        }
      }
    } catch (e) {
      console.warn('Enrich failed for source', s.id, e.message)
    }
  }

  const refreshedContentMap = getContentsMap(sourceIds)
  try {
    await ensureEmbeddingsForSources(sources, { force, contentsMap: refreshedContentMap })
  } catch (err) {
    console.warn('Embedding ensure failed', err.message)
  }
}

async function fetchAndExtractText(url) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 WhispererBot' } })
    if (!res.ok) return null
    const html = await res.text()
    return extractMainText(html)
  } catch {
    return null
  }
}

function extractMainText(html) {
  if (!html) return ''
  // Remove scripts/styles and tags; basic heuristic extraction
  let text = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim()
  return text
}

function extractSnippet(text, { maxSentences = 2, maxChars = 360 } = {}) {
  if (!text) return null
  const normalized = String(text).replace(/\s+/g, ' ').trim()
  if (!normalized) return null
  const sentences = normalized.split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter(Boolean)
  if (!sentences.length) {
    return normalized.slice(0, maxChars)
  }
  let snippet = ''
  let count = 0
  for (const sentence of sentences) {
    const next = snippet ? `${snippet} ${sentence}` : sentence
    snippet = next.length > maxChars && !snippet ? sentence.slice(0, maxChars) : next.slice(0, maxChars)
    count += 1
    if (snippet.length >= maxChars || count >= maxSentences) break
  }
  return snippet.trim()
}

function diversifySources(sortedItems, embeddingsMap, { threshold = 0.82, limit = sortedItems.length, maxPerCluster = 1 } = {}) {
  if (!Array.isArray(sortedItems) || sortedItems.length === 0) return []
  const output = []
  const clusters = []

  for (const item of sortedItems) {
    if (output.length >= limit) break
    const embeddingEntry = embeddingsMap instanceof Map ? embeddingsMap.get(item.id) : null
    const vector = embeddingEntry?.vector || null
    if (!vector) {
      output.push(item)
      continue
    }

    let matchedCluster = null
    for (const cluster of clusters) {
      const similarity = cosineSimilarity(vector, cluster.vector)
      if (similarity >= threshold) {
        matchedCluster = cluster
        break
      }
    }

    if (!matchedCluster) {
      clusters.push({ vector, count: 1 })
      output.push(item)
      continue
    }

    if (matchedCluster.count < maxPerCluster) {
      matchedCluster.count += 1
      output.push(item)
    }
  }

  return output
}

function buildPromptEntry(source, contentRow, index = 0) {
  const snippet = buildPromptSnippet(source, contentRow)
  const type = determinePointType(source?.source_type)
  return {
    id: Number(source.id),
    url: source.url || null,
    title: source.title || `Source ${index + 1}`,
    source: source.source || null,
    type,
    snippet,
  }
}

function buildPromptSnippet(source, contentRow) {
  const base =
    contentRow?.snippet_text ||
    contentRow?.content_text ||
    contentRow?.transcript_text ||
    source?.description ||
    ''
  return truncate(base, 640)
}

async function generateSourceNoteForSource(source) {
  if (!source || !source.id) throw new Error('Source missing id')
  const contentsMap = getContentsMap([source.id])
  const entry = buildPromptEntry(source, contentsMap.get(source.id) || null, 0)
  if (!entry.snippet) {
    throw new Error('Source has no cached content for note generation')
  }

  const prompt = buildSourceNotePrompt(entry)
  let parsed = null
  const attempts = 3
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await callClaude({
        model: MODEL,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        max_tokens: 900,
      })
      parsed = extractJson(response)
      const points = normalizeSourceNotePayload(parsed, entry)
      if (points && points.length) {
        return {
          sourceId: entry.id,
          generatedAt: new Date().toISOString(),
          points,
        }
      }
    } catch (err) {
      console.warn('Source note generation attempt failed', { sourceId: source.id, attempt: attempt + 1, error: err.message })
    }
  }
  throw new Error('Failed to generate source note')
}

function buildSourceNotePrompt(entry) {
  const lines = [
    `Source title: ${entry.title}`,
    entry.source ? `Publisher: ${entry.source}` : null,
    entry.type ? `Type: ${entry.type}` : null,
    `URL: ${entry.url || 'Unknown'}`,
    '',
    'Content excerpt:',
    entry.snippet,
  ]
    .filter(Boolean)
    .join('\n')

  return `You are extracting executive talking points from a single source. The audience is Fortune 100 leaders making strategic decisions about AI. Be factual, concise, and avoid hype.\n\nFor this source, identify 1-4 high-signal talking points. Each must include:\n- hook: 6-12 word headline tuned for executives (no marketing fluff, include whether to read or listen).\n- type: Article|Podcast|Research.\n- insight: exactly 2 sentences summarizing the core takeaway with concrete detail.\n- implication: 1-2 sentences focused on executive action, risk, competitive move, or compliance.\n- supportingFacts: 1-3 short bullet statements quoting or paraphrasing the source (cite numbers/quotes when available).\n- tags: 1-4 lowercase tags (strategy, risk, compliance, vendor, economics, policy, etc.).\n- confidence: number 0-1 reflecting signal quality and clarity.\n\nReturn ONLY JSON:\n{ "points": [{"hook":"...","type":"Article","insight":"...","implication":"...","supportingFacts":["..."],"tags":["strategy"],"confidence":0.8}] }\n\nSource context:\n${lines}`
}

function normalizeSourceNotePayload(payload, entry) {
  if (!payload || typeof payload !== 'object') return []
  const list = Array.isArray(payload.points) ? payload.points : []
  if (!list.length) return []
  const results = []
  for (const raw of list.slice(0, 4)) {
    const hook = sanitizeSentence(raw?.hook, 16)
    const insight = sanitizeParagraph(raw?.insight)
    const implication = sanitizeParagraph(raw?.implication)
    if (!hook || !insight || !implication) continue
    const type = raw?.type && typeof raw.type === 'string' ? raw.type : entry.type || 'Article'
    const supportingFacts = Array.isArray(raw?.supportingFacts)
      ? raw.supportingFacts.map((fact) => sanitizeParagraph(fact)).filter(Boolean).slice(0, 3)
      : []
    if (!supportingFacts.length) continue
    const tags = Array.isArray(raw?.tags)
      ? raw.tags.map((tag) => sanitizeTag(tag)).filter(Boolean).slice(0, 6)
      : []
    const confidence = clampNumber(raw?.confidence, 0, 1, 0.7)
    results.push({
      hook,
      type,
      insight,
      implication,
      supportingFacts,
      tags,
      confidence,
      url: entry.url || null,
      sourceId: entry.id,
    })
  }
  return results
}

function determinePointType(rawType) {
  const value = typeof rawType === 'string' ? rawType.toLowerCase() : ''
  if (value.includes('podcast') || value.includes('audio')) return 'Podcast'
  if (value.includes('research') || value.includes('paper') || value.includes('arxiv')) return 'Research'
  return 'Article'
}

async function buildTalkingPointsDraft({ persona, promptCopy, entries, feedbackText, pinnedPoints = [], droppedUrls = [] }) {
  const normalizedEntries = Array.isArray(entries) ? entries.filter((entry) => entry && entry.id) : []
  if (!normalizedEntries.length) {
    return { briefing: { summary: '', points: [] }, nuggets: [] }
  }

  const nuggetResult = await generateSourceNuggets({ persona, promptCopy, entries: normalizedEntries })
  const finalBriefing = await generateFinalBriefing({
    persona,
    promptCopy,
    entries: normalizedEntries,
    nuggets: nuggetResult.nuggets,
    feedbackText,
    pinnedPoints,
    droppedUrls,
  })

  return { briefing: finalBriefing, nuggets: nuggetResult.nuggets }
}

async function generateSourceNuggets({ persona, promptCopy, entries }) {
  const personaText = persona ? persona : 'Fortune 100 executive leadership evaluating AI strategy.'
  const context = entries
    .map((entry, idx) => {
      const label = entry.source ? `${entry.title} (${entry.source})` : entry.title
      return `${idx + 1}. [sourceId:${entry.id}] ${label} — ${entry.snippet}`
    })
    .join('\n')

  const nuggetPrompt = `You are an analyst distilling AI developments into factual nuggets for executive strategists.\n\nPersona focus: ${personaText}.\nUser prompt:\n${promptCopy}\n\nFor each source below, identify the key development and why it matters for executives. Avoid hype; focus on evidence-backed facts and implications.\n\nSources:\n${context}\n\nReturn ONLY JSON with this shape:\n{ "nuggets": [{"sourceId": 123, "headline": "<8-12 word hook>", "fact": "Specific evidence or data", "execAngle": "Why this matters for execs", "riskOrAction": "Optional risk/compliance/action cue"}] }`

  try {
    const text = await callClaude({
      model: MODEL,
      messages: [{ role: 'user', content: [{ type: 'text', text: nuggetPrompt }] }],
    })
    const json = extractJson(text)
    const normalized = normalizeNuggetPayload(json, entries)
    if (normalized.length) {
      return { nuggets: normalized }
    }
  } catch (err) {
    console.warn('Failed to generate nuggets', err.message)
  }

  // Fallback: derive basic nuggets from snippets
  const fallback = entries.map((entry) => ({
    sourceId: entry.id,
    headline: entry.title.slice(0, 80),
    fact: entry.snippet.slice(0, 280),
    execAngle: 'Assess strategic impact for enterprise AI teams.',
    riskOrAction: '',
  }))
  return { nuggets: fallback }
}

function normalizeNuggetPayload(payload, entries) {
  if (!payload || typeof payload !== 'object') return []
  const list = Array.isArray(payload.nuggets) ? payload.nuggets : []
  if (!list.length) return []
  const entryById = new Map(entries.map((entry) => [Number(entry.id), entry]))
  const normalized = []
  for (const raw of list) {
    const sourceId = Number(raw?.sourceId)
    if (!Number.isInteger(sourceId) || !entryById.has(sourceId)) continue
    const headline = sanitizeSentence(raw?.headline, 12)
    const fact = sanitizeParagraph(raw?.fact)
    const execAngle = sanitizeParagraph(raw?.execAngle)
    const riskOrAction = sanitizeParagraph(raw?.riskOrAction)
    if (!headline || !fact || !execAngle) continue
    normalized.push({
      sourceId,
      headline,
      fact,
      execAngle,
      riskOrAction: riskOrAction || '',
    })
  }
  return normalized
}

async function generateFinalBriefing({ persona, promptCopy, entries, nuggets, feedbackText, pinnedPoints, droppedUrls }) {
  const personaText = persona ? persona : 'Fortune 100 executive leadership evaluating AI strategy.'
  const nuggetSection = nuggets
    .map((nugget, idx) => {
      const risk = nugget.riskOrAction ? ` | Risk/Action: ${nugget.riskOrAction}` : ''
      return `${idx + 1}. Source ${nugget.sourceId} — ${nugget.headline} | Fact: ${nugget.fact} | Exec Angle: ${nugget.execAngle}${risk}`
    })
    .join('\n')

  const droppedSet = new Set((Array.isArray(droppedUrls) ? droppedUrls : []).map((url) => String(url).trim()).filter(Boolean))
  const droppedSection = droppedSet.size
    ? Array.from(droppedSet).map((url) => `- ${url}`).join('\n')
    : '- (none)'

  const pinnedSummary = Array.isArray(pinnedPoints) && pinnedPoints.length
    ? JSON.stringify(pinnedPoints)
    : '[]'

  const entrySummary = entries
    .map((entry, idx) => `${idx + 1}. [sourceId:${entry.id}] ${entry.title} (${entry.type}) — ${entry.snippet}`)
    .join('\n')

  const finalPrompt = `You are generating executive talking points about AI developments.\n\nPersona: ${personaText}.\nUser prompt:\n${promptCopy}\n\nUser feedback:\n${feedbackText || 'None provided.'}\n\nEvidence nuggets:\n${nuggetSection || '(none)'}\n\nReference sources:\n${entrySummary}\n\nPinned points (JSON) — keep these verbatim at the top if provided:\n${pinnedSummary}\n\nExclude any points based on these URLs:\n${droppedSection}\n\nRequirements:\n- Produce 4-7 talking points tailored for executives.\n- Summary: 1-2 sentences capturing the strategic theme.\n- Each point must include fields: title (6-14 words), type (Article|Podcast|Research), url, sourceIds (matching provided sourceId values), insight (exactly 2 sentences), implication (1-2 sentences focused on action, risk, or competitive angle), supportingFacts (1-2 short bullet statements referencing the evidence).\n- Do not invent facts; use only the evidence nuggets.\n- Avoid hype adjectives; be specific and factual.\n- If a point would rely on a dropped URL, omit it.\n\nReturn ONLY JSON: { "summary": "...", "points": [{"title":"...","type":"Article","url":"https://...","sourceIds":[123],"insight":"...","implication":"...","supportingFacts":["..."] }] }`

  const attempts = 3
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const text = await callClaude({
        model: MODEL,
        messages: [{ role: 'user', content: [{ type: 'text', text: finalPrompt }] }],
      })
      const json = extractJson(text)
      const validation = validateBriefingPayload(json, entries, { pinnedPoints, droppedUrls })
      if (validation.ok) {
        return validation.data
      }
    } catch (err) {
      console.warn('Final briefing generation attempt failed', err.message)
    }
  }

  throw new Error('Invalid briefing response after retries')
}

function validateBriefingPayload(candidate, entries, { pinnedPoints = [], droppedUrls = [] } = {}) {
  if (!candidate || typeof candidate !== 'object') {
    return { ok: false, error: 'Missing response payload' }
  }

  const summary = sanitizeParagraph(candidate.summary)
  if (!summary) {
    return { ok: false, error: 'Missing summary' }
  }

  const entryById = new Map(entries.map((entry) => [Number(entry.id), entry]))
  const urlToEntry = new Map(entries.map((entry) => [String(entry.url || '').trim(), entry]))
  const droppedSet = new Set((Array.isArray(droppedUrls) ? droppedUrls : []).map((url) => String(url).trim()).filter(Boolean))

  const rawPoints = Array.isArray(candidate.points) ? candidate.points : []
  const normalizedPoints = []
  for (const raw of rawPoints) {
    const title = sanitizeSentence(raw?.title, 16)
    const insight = sanitizeParagraph(raw?.insight)
    const implication = sanitizeParagraph(raw?.implication)
    if (!title || !insight || !implication) continue

    const sourceIds = coerceSourceIds(raw, entryById, urlToEntry)
    if (!sourceIds.length) continue

    const primaryEntry = entryById.get(sourceIds[0])
    const type = raw?.type && typeof raw.type === 'string' ? raw.type : (primaryEntry?.type || 'Article')
    const url = raw?.url && typeof raw.url === 'string' ? raw.url.trim() : (primaryEntry?.url || null)
    if (!url || droppedSet.has(String(url))) continue

    const supportingFacts = Array.isArray(raw?.supportingFacts)
      ? raw.supportingFacts.map((fact) => sanitizeParagraph(fact)).filter(Boolean).slice(0, 3)
      : []

    normalizedPoints.push({
      title,
      type,
      url,
      sourceIds,
      insight,
      implication,
      supportingFacts,
    })
  }

  if (!normalizedPoints.length) {
    return { ok: false, error: 'No valid talking points returned' }
  }

  const merged = mergePinnedPoints({
    generatedPoints: normalizedPoints,
    pinnedPoints,
    droppedUrls: Array.from(droppedSet),
    entryById,
  })

  return {
    ok: true,
    data: {
      summary,
      points: merged,
    },
  }
}

function coerceSourceIds(rawPoint, entryById, urlToEntry) {
  const candidates = []
  const tryArrays = [rawPoint?.sourceIds, rawPoint?.supportingSourceIds, rawPoint?.sources]
  for (const value of tryArrays) {
    if (!value) continue
    if (Array.isArray(value)) {
      value.forEach((item) => {
        const id = Number(item)
        if (Number.isInteger(id) && entryById.has(id)) candidates.push(id)
      })
    } else {
      const id = Number(value)
      if (Number.isInteger(id) && entryById.has(id)) candidates.push(id)
    }
    if (candidates.length) break
  }

  if (!candidates.length && rawPoint?.url) {
    const entry = urlToEntry.get(String(rawPoint.url).trim())
    if (entry) candidates.push(entry.id)
  }

  const unique = Array.from(new Set(candidates)).slice(0, 3)
  return unique
}

function mergePinnedPoints({ generatedPoints, pinnedPoints, droppedUrls, entryById }) {
  const droppedSet = new Set((Array.isArray(droppedUrls) ? droppedUrls : []).map((url) => String(url).trim()).filter(Boolean))
  const urlToEntry = new Map()
  entryById.forEach((entry) => {
    if (entry?.url) {
      urlToEntry.set(String(entry.url).trim(), entry)
    }
  })
  const resolvedPinned = Array.isArray(pinnedPoints)
    ? pinnedPoints
        .map((point) => normalizePinnedPoint(point, entryById, urlToEntry))
        .filter((point) => point && !droppedSet.has(point.urlKey))
    : []

  const seen = new Set()
  const merged = []

  for (const point of resolvedPinned) {
    if (seen.has(point.urlKey)) continue
    merged.push(point.data)
    seen.add(point.urlKey)
  }

  for (const point of generatedPoints) {
    const urlKey = String(point.url || point.title).trim().toLowerCase()
    if (!urlKey || seen.has(urlKey) || droppedSet.has(point.url)) continue
    merged.push(point)
    seen.add(urlKey)
  }

  return merged
}

function normalizePinnedPoint(point, entryById, urlToEntry) {
  if (!point || typeof point !== 'object') return null
  const url = typeof point.url === 'string' ? point.url.trim() : ''
  const title = sanitizeSentence(point.title || point.headline || '', 20)
  const insight = sanitizeParagraph(point.insight)
  const implication = sanitizeParagraph(point.implication)
  if (!title || !insight || !implication) return null
  const sourceIds = coerceSourceIds(point, entryById, urlToEntry || new Map())
  const primaryEntry = sourceIds.length ? entryById.get(sourceIds[0]) : null
  const type = point.type || primaryEntry?.type || 'Article'
  const supportingFacts = Array.isArray(point.supportingFacts)
    ? point.supportingFacts.map((fact) => sanitizeParagraph(fact)).filter(Boolean).slice(0, 3)
    : []

  const urlKey = (url || title).trim().toLowerCase()
  return {
    urlKey,
    data: {
      title,
      type,
      url,
      sourceIds,
      insight,
      implication,
      supportingFacts,
    },
  }
}

function sanitizeParagraph(value) {
  if (!value || typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, 600)
}

function sanitizeSentence(value, maxWords = 20) {
  if (!value || typeof value !== 'string') return ''
  const trimmed = value.replace(/\s+/g, ' ').trim()
  if (!trimmed) return ''
  const words = trimmed.split(' ')
  if (words.length <= maxWords) return trimmed
  return words.slice(0, maxWords).join(' ')
}

function normalizePublishedAt(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toISOString()
}
