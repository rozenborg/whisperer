import fetch from 'node-fetch'

const PROVIDER = process.env.EMBEDDINGS_PROVIDER || 'openai'
const OPENAI_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small'

export function isEmbeddingConfigured() {
  if (PROVIDER !== 'openai') return false
  return Boolean(process.env.OPENAI_API_KEY)
}

export async function embedTexts(texts, { model = OPENAI_MODEL } = {}) {
  if (!Array.isArray(texts) || texts.length === 0) return []
  if (PROVIDER !== 'openai') {
    throw new Error(`Unsupported embedding provider: ${PROVIDER}`)
  }
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('Missing OPENAI_API_KEY for embeddings')

  const payload = {
    model,
    input: texts,
  }

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OpenAI embeddings ${res.status}: ${text.slice(0, 500)}`)
  }

  const data = await res.json()
  if (!data?.data || !Array.isArray(data.data)) {
    throw new Error('Invalid embeddings response')
  }

  return data.data.map((item) => {
    if (!item?.embedding || !Array.isArray(item.embedding)) {
      throw new Error('Embedding data missing')
    }
    return Float32Array.from(item.embedding)
  })
}

export function normalizeVector(vector) {
  if (!vector || vector.length === 0) return Float32Array.from([])
  let sumSquares = 0
  for (const value of vector) {
    sumSquares += value * value
  }
  const magnitude = Math.sqrt(sumSquares)
  if (!magnitude || !Number.isFinite(magnitude)) return Float32Array.from(vector)
  const normalized = new Float32Array(vector.length)
  for (let i = 0; i < vector.length; i += 1) {
    normalized[i] = vector[i] / magnitude
  }
  return normalized
}

export function cosineSimilarity(a, b) {
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) return 0
  let dot = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
  }
  return dot
}
