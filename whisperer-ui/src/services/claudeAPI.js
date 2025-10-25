const anthropicModel =
  import.meta.env.VITE_ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022'

const MAX_CURATION_SNIPPET = 600
const MAX_BRIEFING_SNIPPET = 800
const ERROR_PREVIEW_LIMIT = 240

export async function curateWithClaude(sources, context) {
  if (!sources.length) {
    return { selectedIds: [], reasoning: 'No sources provided to curate.' }
  }

  const prompt = buildCurationPrompt(sources, context)
  const response = await callClaude(prompt)
  const parsed = extractJson(response)

  if (!parsed?.selected) {
    throw new Error('Claude curation response did not include selected indices.')
  }

  const selectedIds = parsed.selected
    .map((index) => (sources[index] ? sources[index].id : null))
    .filter(Boolean)

  return {
    selectedIds,
    reasoning:
      parsed.reasoning ??
      'Claude did not return reasoning. Review selected sources manually.',
  }
}

export async function generateBriefing({ selectedSources, config, reasoning }) {
  if (!selectedSources.length) {
    return {
      summary: 'No sources selected. Adjust your filters and try again.',
      points: [],
      generatedAt: new Date().toISOString(),
      reasoning,
    }
  }

  const prompt = buildBriefingPrompt(selectedSources, config)
  const response = await callClaude(prompt)
  const parsed = extractJson(response)

  if (!parsed?.summary || !Array.isArray(parsed.points)) {
    throw new Error('Claude briefing response was not valid JSON.')
  }

  return {
    summary: parsed.summary,
    points: parsed.points,
    generatedAt: new Date().toISOString(),
    reasoning,
  }
}

async function callClaude(prompt) {
  const body = {
    model: anthropicModel,
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: prompt }],
      },
    ],
  }

  const response = await fetch('/api/anthropic/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const cloned = response.clone()
    const errorPayload = await safeReadJson(cloned)
    const fallbackText = await response.text()
    if (fallbackText) {
      console.error('[claudeAPI] Anthropic request failed', {
        status: response.status,
        body: fallbackText,
      })
    }
    const fallbackMessage = fallbackText ? truncateText(fallbackText, ERROR_PREVIEW_LIMIT) : 'Check API keys and quota.'
    throw new Error(
      `Claude API returned ${response.status}. ${
        errorPayload?.error?.message ?? fallbackMessage
      }`,
    )
  }

  const payload = await response.json()
  const textBlock = Array.isArray(payload.content)
    ? payload.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
    : ''

  return textBlock
}

function buildCurationPrompt(sources, context) {
  const { config } = context
  const list = sources
    .map(
      (source, index) =>
        `${index}. ${source.title} (${source.source}, ${source.date || 'n/a'})${
          source.description
            ? ` — ${truncateText(source.description, MAX_CURATION_SNIPPET)}`
            : ''
        }`,
    )
    .join('\n')

  const userPrompt =
    config?.prompt && config.prompt.trim()
      ? config.prompt.trim()
      : 'No additional guidance provided.'

  return `
You are curating AI news for an executive briefing.

User prompt:
${userPrompt}

Sources:
${list}

Select 4-8 most strategically relevant items.

Return ONLY valid JSON (no markdown):
{
  "selected": [0, 2, 5, 7],
  "reasoning": "Brief explanation of themes"
}
`.trim()
}

function buildBriefingPrompt(selectedSources, config) {
  const list = selectedSources
    .map(
      (source, index) =>
        `${index + 1}. ${source.title} (${source.sourceType})${
          source.description
            ? ` — ${truncateText(source.description, MAX_BRIEFING_SNIPPET)}`
            : ''
        }`,
    )
    .join('\n')

  const userPrompt =
    config?.prompt && config.prompt.trim()
      ? config.prompt.trim()
      : 'No additional guidance provided.'

  return `
You are creating an executive briefing.

User prompt:
${userPrompt}

Selected sources:
${list}

For each source, create a talking point.

Return ONLY valid JSON (no markdown):
{
  "summary": "1-2 sentence overview",
  "points": [
    {
      "title": "exact title",
      "url": "exact url",
      "type": "Article/Podcast/Research",
      "insight": "2-3 sentences: key strategic takeaway",
      "implication": "2-3 sentences: what this means for senior decision-makers"
    }
  ]
}
`.trim()
}

function extractJson(text) {
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch (error) {
      console.error('Failed to parse Claude response', error, text)
      return null
    }
  }
}

async function safeReadJson(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function truncateText(value, maxLength) {
  if (!value) return ''
  const normalised = String(value).replace(/\s+/g, ' ').trim()
  if (!normalised) return ''
  if (normalised.length <= maxLength) return normalised
  return `${normalised.slice(0, maxLength - 1).trim()}…`
}
