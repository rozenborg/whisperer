// Server-side feed policies to override UI caps immediately.
// Keyed by the UI feed key (e.g., 'techcrunch', 'noPriors').

export const FEED_POLICIES = {
  // High-volume news
  techcrunch: { type: 'RSS', volume: 'high', includeAll: false, perRunLimit: 12 },

  // Podcasts – low volume, include all
  noPriors: { type: 'Podcast', volume: 'low', includeAll: true },
  a16z: { type: 'Podcast', volume: 'low', includeAll: true },
  dwarkesh: { type: 'Podcast', volume: 'low', includeAll: true },
  lexfridman: { type: 'Podcast', volume: 'low', includeAll: true },
  twiml: { type: 'Podcast', volume: 'low', includeAll: true },
  thisDayInAi: { type: 'Podcast', volume: 'low', includeAll: true },
  latentSpace: { type: 'Podcast', volume: 'low', includeAll: true },
  mlst: { type: 'Podcast', volume: 'low', includeAll: true },
  yCombinator: { type: 'Podcast', volume: 'low', includeAll: true },
  trainingData: { type: 'Podcast', volume: 'low', includeAll: true },
  deepmind: { type: 'Podcast', volume: 'low', includeAll: true },

  // Company/Research blogs – moderate volume
  openaiBlog: { type: 'Blog', volume: 'medium', includeAll: false, perRunLimit: 6 },
  openaiResearch: { type: 'Blog', volume: 'medium', includeAll: false, perRunLimit: 6 },
  deepmindBlog: { type: 'Blog', volume: 'medium', includeAll: false, perRunLimit: 6 },
  metaAiBlog: { type: 'Blog', volume: 'medium', includeAll: false, perRunLimit: 6 },
  googleAiBlog: { type: 'Blog', volume: 'medium', includeAll: false, perRunLimit: 6 },
  microsoftAiBlog: { type: 'Blog', volume: 'medium', includeAll: false, perRunLimit: 6 },
  nvidiaBlog: { type: 'Blog', volume: 'medium', includeAll: false, perRunLimit: 6 },
  mitAiBlog: { type: 'Blog', volume: 'medium', includeAll: false, perRunLimit: 6 },
  gradientBlog: { type: 'Blog', volume: 'medium', includeAll: false, perRunLimit: 6 },
  ai2Blog: { type: 'Blog', volume: 'medium', includeAll: false, perRunLimit: 6 },
  eleutherBlog: { type: 'Blog', volume: 'medium', includeAll: false, perRunLimit: 6 },
  cohereBlog: { type: 'Blog', volume: 'medium', includeAll: false, perRunLimit: 6 },
  mistralBlog: { type: 'Blog', volume: 'medium', includeAll: false, perRunLimit: 6 },
  stabilityBlog: { type: 'Blog', volume: 'medium', includeAll: false, perRunLimit: 6 },
  anthropicBlog: { type: 'Blog', volume: 'medium', includeAll: false, perRunLimit: 6 },

  // Web / ArXiv
  tavily: { type: 'Web', volume: 'medium', includeAll: false, perRunLimit: 8 },
  arxiv: { type: 'ArXiv', volume: 'medium', includeAll: false, perRunLimit: 8 },
}

// Fallback policy if feedKey missing or unknown.
const DEFAULT_POLICY = { type: 'Unknown', volume: 'medium', includeAll: false, perRunLimit: 6 }

export function policyForFeedKey(feedKey) {
  if (!feedKey) return DEFAULT_POLICY
  return FEED_POLICIES[feedKey] || DEFAULT_POLICY
}

export function applyFeedPolicies(items) {
  if (!Array.isArray(items) || items.length === 0) return []

  // Group by feedKey
  const groups = new Map()
  for (const item of items) {
    const key = (item && item.feedKey) || 'unknown'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }

  const result = []
  for (const [key, group] of groups.entries()) {
    const policy = policyForFeedKey(key)
    // Sort by date desc when available to favor recency at ingest
    const sorted = group.slice().sort((a, b) => {
      const ta = new Date(a.date || a.published_at || 0).getTime()
      const tb = new Date(b.date || b.published_at || 0).getTime()
      return tb - ta
    })
    if (policy.includeAll) {
      result.push(...sorted)
    } else {
      const limit = Math.max(0, Number(policy.perRunLimit || 0)) || 6
      result.push(...sorted.slice(0, limit))
    }
  }
  return result
}

