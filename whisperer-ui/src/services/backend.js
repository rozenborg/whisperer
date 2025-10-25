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

export async function createReport({ persona, request, sinceDays = 14, limit = 200 }) {
  const since = `-${Number(sinceDays)} days`
  return post('/api/reports', { persona, request, since, limit })
}

export async function finalizeReport({ id, persona, feedback, selectedIds = [] }) {
  return post(`/api/reports/${id}/finalize`, { persona, feedback, selectedSourceIds: selectedIds })
}

export async function listSources({ sinceDays = 14, limit = 200 } = {}) {
  const since = `-${Number(sinceDays)} days`
  return get(`/api/sources?since=${encodeURIComponent(since)}&limit=${encodeURIComponent(limit)}`)
}

export async function deleteSource(id) {
  return del(`/api/sources/${encodeURIComponent(id)}`)
}
