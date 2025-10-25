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

export async function ingestSources(items) {
  return post('/api/ingest', { items })
}

export async function createReport({ persona, request, startDate, endDate, limit = 200 }) {
  const payload = { persona, request, limit }
  if (startDate) payload.startDate = startDate
  if (endDate) payload.endDate = endDate
  return post('/api/reports', payload)
}

export async function finalizeReport({ id, persona, feedback, selectedIds = [] }) {
  return post(`/api/reports/${id}/finalize`, { persona, feedback, selectedSourceIds: selectedIds })
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
