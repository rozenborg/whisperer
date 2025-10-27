const backendBase = import.meta.env.VITE_BACKEND_BASE || 'http://localhost:8787'

async function post(path, body) {
  const res = await fetch(`${backendBase}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${path} failed: ${res.status} ${text.slice(0, 240)}`)
  }
  return res.json()
}

async function get(path) {
  const res = await fetch(`${backendBase}${path}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${path} failed: ${res.status} ${text.slice(0, 240)}`)
  }
  return res.json()
}

async function del(path) {
  const res = await fetch(`${backendBase}${path}`, { method: 'DELETE' })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${path} failed: ${res.status} ${text.slice(0, 240)}`)
  }
  return res.json()
}

async function put(path, body) {
  const res = await fetch(`${backendBase}${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${path} failed: ${res.status} ${text.slice(0, 240)}`)
  }
  return res.json()
}

export async function ingestSources(items) {
  return post('/api/ingest', { items })
}

export async function enrichSourcesOnDemand({ sourceIds, force = false }) {
  return post('/api/enrich', { sourceIds, force })
}

export async function fetchBackendStats() {
  return get('/api/stats')
}

export async function listTalkingPoints({ startDate, endDate, limit = 200 } = {}) {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  if (startDate) params.set('start', startDate)
  if (endDate) params.set('end', endDate)
  const query = params.toString()
  return get(`/api/talking-points?${query}`)
}

export async function createTalkingPoint({ headline, body, sourceId, sourceUrl, relatedSourceIds, tags, originalHeadline, originalBody, savedAt } = {}) {
  return post('/api/talking-points', {
    headline,
    body,
    sourceId,
    sourceUrl,
    relatedSourceIds,
    tags,
    originalHeadline,
    originalBody,
    savedAt,
  })
}

export async function updateTalkingPoint({ id, headline, body, sourceId, sourceUrl, relatedSourceIds, tags, originalHeadline, originalBody, savedAt } = {}) {
  if (!id) throw new Error('id required')
  return put(`/api/talking-points/${encodeURIComponent(id)}`, {
    headline,
    body,
    sourceId,
    sourceUrl,
    relatedSourceIds,
    tags,
    originalHeadline,
    originalBody,
    savedAt,
  })
}

export async function deleteTalkingPoint(id) {
  if (!id) throw new Error('id required')
  return del(`/api/talking-points/${encodeURIComponent(id)}`)
}

export async function fetchTalkingPointMetrics({ limit = 30 } = {}) {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  return get(`/api/talking-points/metrics?${params.toString()}`)
}

export async function createReport({ prompt, startDate, endDate, limit = 200 }) {
  const payload = {
    prompt,
    request: prompt,
    limit,
  }
  if (startDate) payload.startDate = startDate
  if (endDate) payload.endDate = endDate
  return post('/api/reports', payload)
}

// Briefings (one-pass)
export async function createBriefing({ prompt, startDate, endDate, limit = 200 }) {
  const payload = { prompt, request: prompt, limit }
  if (startDate) payload.startDate = startDate
  if (endDate) payload.endDate = endDate
  return post('/api/briefings', payload)
}

export async function reviseBriefing({ id, prompt, feedback, selectedIds = [], pinnedPoints = [], droppedUrls = [], keepPinned = true }) {
  return post(`/api/briefings/${id}/revise`, {
    prompt,
    feedback,
    selectedSourceIds: selectedIds,
    pinnedPoints,
    droppedUrls,
    keepPinned,
  })
}

export async function finalizeReport({ id, prompt, feedback, selectedIds = [] }) {
  return post(`/api/reports/${id}/finalize`, {
    prompt,
    feedback,
    selectedSourceIds: selectedIds,
  })
}

export async function listSources({ startDate, endDate, sinceDays = 14, limit = 200 } = {}) {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  if (startDate) params.set('start', startDate)
  if (endDate) params.set('end', endDate)
  if (!startDate && !endDate) {
    const since = `-${Number(sinceDays)} days`
    params.set('since', since)
  }
  const query = params.toString()
  return get(`/api/sources?${query}`)
}

export async function deleteSource(id) {
  return del(`/api/sources/${encodeURIComponent(id)}`)
}
