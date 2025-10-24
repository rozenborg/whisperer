import fetch from 'node-fetch'

const API_URL = 'https://api.anthropic.com/v1/messages'

export async function callClaude({ model, messages, max_tokens = 2000 }) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('Missing ANTHROPIC_API_KEY')

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens, messages }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Claude API ${res.status}: ${text.slice(0, 500)}`)
  }

  const data = await res.json()
  const textBlock = Array.isArray(data.content)
    ? data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
    : ''
  return textBlock
}

