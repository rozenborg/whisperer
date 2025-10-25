const tavilyKey = import.meta.env.VITE_TAVILY_KEY
const listenNotesKey = import.meta.env.VITE_LISTEN_NOTES_KEY
const listenNotesIds = {
  noPriors: import.meta.env.VITE_LISTEN_NOTES_NOPRIORS_ID || 'f7e941ea4371421c98ad5f36cd18f98a',
  a16z: import.meta.env.VITE_LISTEN_NOTES_A16Z_ID || '37c80af23f34406a9999dd749a63988f',
  dwarkesh: import.meta.env.VITE_LISTEN_NOTES_DWARKESH_ID || 'c5527633a7084bd1ba292af3dc18c35f',
  lexfridman: import.meta.env.VITE_LISTEN_NOTES_LEX_ID || '23e2be3c56e64dcdbb0cff3cedca4c95',
  twiml: import.meta.env.VITE_LISTEN_NOTES_TWIML_ID || '51f6ce503750485ba02bb60193feef49',
  thisDayInAi: import.meta.env.VITE_LISTEN_NOTES_THIS_DAY_ID || '7096d6e9e2304680abbbd1b8411f4db7',
  latentSpace: import.meta.env.VITE_LISTEN_NOTES_LATENT_ID || '25e6efa22a424ee78ab62bdb620baa9e',
  mlst: import.meta.env.VITE_LISTEN_NOTES_MLST_ID || '5559e08a3cf24c5ebdadb7ca61d9c7e9',
  yCombinator: import.meta.env.VITE_LISTEN_NOTES_YC_ID || '89938ec707e6466f81cc2a74b21842a1',
  trainingData: import.meta.env.VITE_LISTEN_NOTES_TRAINING_ID || 'f05f2599c25340d68233b27cfb4bdc0a',
  deepmind: import.meta.env.VITE_LISTEN_NOTES_DEEPMIND_ID || 'c13ff0b1755b4fa7aa2a0166e5340599',
}
const itunesIds = {
  noPriors: import.meta.env.VITE_ITUNES_NOPRIORS_ID || '1668002688',
  a16z: import.meta.env.VITE_ITUNES_A16Z_ID || '842818711',
  dwarkesh: import.meta.env.VITE_ITUNES_DWARKESH_ID || '1516093381',
  lexfridman: import.meta.env.VITE_ITUNES_LEX_ID || '1434243584',
  twiml: import.meta.env.VITE_ITUNES_TWIML_ID || '1116303051',
  thisDayInAi: import.meta.env.VITE_ITUNES_THIS_DAY_ID || '1671087656',
  latentSpace: import.meta.env.VITE_ITUNES_LATENT_ID || '1674008350',
  mlst: import.meta.env.VITE_ITUNES_MLST_ID || '1510472996',
  yCombinator: import.meta.env.VITE_ITUNES_YC_ID || '1236907421',
  trainingData: import.meta.env.VITE_ITUNES_TRAINING_ID || '1750736528',
  deepmind: import.meta.env.VITE_ITUNES_DEEPMIND_ID || '1476316441',
}
const rssProxyBase = import.meta.env.VITE_RSS_PROXY_URL

export const SOURCE_METADATA = {
  techcrunch: { label: 'TechCrunch AI', type: 'RSS' },
  noPriors: { label: 'No Priors Podcast', type: 'Podcast' },
  a16z: { label: 'a16z Podcast', type: 'Podcast' },
  dwarkesh: { label: 'Dwarkesh Podcast', type: 'Podcast' },
  lexfridman: { label: 'Lex Fridman Podcast', type: 'Podcast' },
  twiml: { label: 'TWIML AI Podcast', type: 'Podcast' },
  thisDayInAi: { label: 'This Day in AI', type: 'Podcast' },
  latentSpace: { label: 'Latent Space', type: 'Podcast' },
  mlst: { label: 'Machine Learning Street Talk', type: 'Podcast' },
  yCombinator: { label: 'Y Combinator Podcast', type: 'Podcast' },
  trainingData: { label: 'Training Data Podcast', type: 'Podcast' },
  deepmind: { label: 'Google DeepMind Podcast', type: 'Podcast' },
  openaiBlog: { label: 'OpenAI Blog', type: 'Blog' },
  openaiResearch: { label: 'OpenAI Research', type: 'Blog' },
  deepmindBlog: { label: 'Google DeepMind Blog', type: 'Blog' },
  metaAiBlog: { label: 'Meta AI Blog', type: 'Blog' },
  googleAiBlog: { label: 'Google AI Blog', type: 'Blog' },
  microsoftAiBlog: { label: 'Microsoft AI Blog', type: 'Blog' },
  nvidiaBlog: { label: 'NVIDIA AI Blog', type: 'Blog' },
  mitAiBlog: { label: 'MIT Technology Review – AI', type: 'Blog' },
  gradientBlog: { label: 'The Gradient', type: 'Blog' },
  ai2Blog: { label: 'AI2 Blog', type: 'Blog' },
  eleutherBlog: { label: 'Eleuther AI News', type: 'Blog' },
  cohereBlog: { label: 'Cohere Blog', type: 'Blog' },
  mistralBlog: { label: 'Mistral AI News', type: 'Blog' },
  stabilityBlog: { label: 'Stability AI Blog', type: 'Blog' },
  anthropicBlog: { label: 'Anthropic Updates', type: 'Blog' },
  tavily: { label: 'Tavily News Search', type: 'Web' },
  arxiv: { label: 'ArXiv', type: 'ArXiv' },
}

export async function fetchAllSources(config, callbacks = {}) {
  const { onBatch, onProgress, onStatus, dateRange } = callbacks
  const effectiveRange = normalizeDateRange(dateRange, config)
  const enabledSources = Object.entries(config.sources).filter(
    ([, settings]) => settings.enabled,
  )

  if (!enabledSources.length) {
    throw new Error('Enable at least one source before generating a briefing.')
  }

  const expectedTotal =
    enabledSources.reduce((total, [, settings]) => total + (settings.max || 0), 0) ||
    enabledSources.length * 3

  onProgress?.({ loaded: 0, total: expectedTotal })
  onStatus?.('Fetching sources...')

  let loadedCount = 0
  const aggregated = []

  await Promise.all(
    enabledSources.map(async ([key, settings]) => {
      try {
        onStatus?.(`Fetching ${settings.label}...`)
        const batch = await fetchSourceByKey(key, settings, config)
        const filteredBatch = enforceDateRange(batch, effectiveRange)
        aggregated.push(...filteredBatch)
        loadedCount += filteredBatch.length
        if (filteredBatch.length) {
          onBatch?.(filteredBatch)
        }
      } catch (error) {
        console.error(`Failed to fetch ${key}`, error)
        const errorItem = buildErrorSource(key, settings, error)
        aggregated.push(errorItem)
        loadedCount += 1
        onBatch?.([errorItem])
      } finally {
        onProgress?.({ loaded: Math.min(loadedCount, expectedTotal), total: expectedTotal })
      }
    }),
  )

  return aggregated
}

async function fetchSourceByKey(key, settings, config) {
  const fetcher = liveFetchers[key]
  if (!fetcher) {
    throw new Error(`No fetcher defined for ${key}`)
  }

  return fetcher(settings, config)
}

function createPodcastFetcher(sourceKey) {
  return async (settings, config) => {
    const maxItems = (settings?.max ?? 0) || 3
    const provider = config?.podcastProvider ?? 'itunes'

    // Default to Apple Podcasts (free), fallback to Listen Notes
    if (provider === 'listenNotes') {
      return fetchListenNotesPodcast(sourceKey, maxItems)
    }

    try {
      const episodes = await fetchItunesPodcast(sourceKey, maxItems)
      if (episodes && episodes.length) return episodes
      // fallback to Listen Notes if Apple returns nothing
      return fetchListenNotesPodcast(sourceKey, maxItems)
    } catch (e) {
      console.warn(`Apple Podcasts failed for ${sourceKey}, attempting Listen Notes.`, e)
      return fetchListenNotesPodcast(sourceKey, maxItems)
    }
  }
}

const liveFetchers = {
  techcrunch: async (settings) =>
    fetchRssFeed(
      'https://techcrunch.com/category/artificial-intelligence/feed/',
      settings.max || 10,
      SOURCE_METADATA.techcrunch.label,
    ),
  noPriors: createPodcastFetcher('noPriors'),
  a16z: createPodcastFetcher('a16z'),
  dwarkesh: createPodcastFetcher('dwarkesh'),
  lexfridman: createPodcastFetcher('lexfridman'),
  twiml: createPodcastFetcher('twiml'),
  thisDayInAi: createPodcastFetcher('thisDayInAi'),
  latentSpace: createPodcastFetcher('latentSpace'),
  mlst: createPodcastFetcher('mlst'),
  yCombinator: createPodcastFetcher('yCombinator'),
  trainingData: createPodcastFetcher('trainingData'),
  deepmind: createPodcastFetcher('deepmind'),
  openaiBlog: async (settings) =>
    fetchRssFeed(
      'https://openai.com/blog/rss',
      settings.max || 5,
      SOURCE_METADATA.openaiBlog.label,
    ),
  openaiResearch: async (settings) =>
    fetchRssFeed(
      'https://openai.com/research/feed',
      settings.max || 5,
      SOURCE_METADATA.openaiResearch.label,
    ),
  deepmindBlog: async (settings) =>
    fetchRssFeed(
      'https://deepmind.google/discover/blog/feed/',
      settings.max || 5,
      SOURCE_METADATA.deepmindBlog.label,
    ),
  metaAiBlog: async (settings) =>
    fetchRssFeed(
      'https://ai.meta.com/blog/rss/',
      settings.max || 5,
      SOURCE_METADATA.metaAiBlog.label,
    ),
  googleAiBlog: async (settings) =>
    fetchRssFeed(
      'https://developers.googleblog.com/feeds/posts/default/-/AI?alt=rss',
      settings.max || 5,
      SOURCE_METADATA.googleAiBlog.label,
    ),
  microsoftAiBlog: async (settings) =>
    fetchRssFeed(
      'https://blogs.microsoft.com/ai/feed/',
      settings.max || 5,
      SOURCE_METADATA.microsoftAiBlog.label,
    ),
  nvidiaBlog: async (settings) =>
    fetchRssFeed(
      'https://developer.nvidia.com/blog/tag/artificial-intelligence/feed/',
      settings.max || 5,
      SOURCE_METADATA.nvidiaBlog.label,
    ),
  mitAiBlog: async (settings) =>
    fetchRssFeed(
      'https://www.technologyreview.com/feed/ai/',
      settings.max || 5,
      SOURCE_METADATA.mitAiBlog.label,
    ),
  gradientBlog: async (settings) =>
    fetchRssFeed(
      'https://thegradient.pub/rss/',
      settings.max || 5,
      SOURCE_METADATA.gradientBlog.label,
    ),
  ai2Blog: async (settings) =>
    fetchRssFeed(
      'https://allenai.org/blog/rss',
      settings.max || 5,
      SOURCE_METADATA.ai2Blog.label,
    ),
  eleutherBlog: async (settings) =>
    fetchRssFeed(
      'https://www.eleuther.ai/news/rss/',
      settings.max || 5,
      SOURCE_METADATA.eleutherBlog.label,
    ),
  cohereBlog: async (settings) =>
    fetchRssFeed(
      'https://txt.cohere.com/feed/',
      settings.max || 5,
      SOURCE_METADATA.cohereBlog.label,
    ),
  mistralBlog: async (settings) =>
    fetchMistralNews(settings.max || 5),
  stabilityBlog: async (settings) =>
    fetchRssFeed(
      'https://stability.ai/blog?format=rss',
      settings.max || 5,
      SOURCE_METADATA.stabilityBlog.label,
    ),
  anthropicBlog: async (settings) => fetchAnthropicNews(settings.max || 5),
  tavily: async (settings, config) => fetchTavily(settings, config),
  arxiv: async (settings) =>
    fetchArxivFeed(settings.max || 5, SOURCE_METADATA.arxiv.label),
}

async function fetchRssFeed(url, maxItems, sourceLabel) {
  const response = await fetchXml(url, sourceLabel)
  if (!response.ok) {
    throw new Error(`Received ${response.status} from ${sourceLabel}`)
  }

  const text = await response.text()
  const parser = new DOMParser()
  const xml = parser.parseFromString(text, 'text/xml')
  const items = Array.from(xml.querySelectorAll('item')).slice(0, maxItems)

  return items.map((item, index) => ({
    id: generateId(`${sourceLabel}-${index}`),
    title: cleanText(item.querySelector('title')?.textContent) ?? 'Untitled',
    url: item.querySelector('link')?.textContent ?? '#',
    source: sourceLabel,
    date: item.querySelector('pubDate')?.textContent ?? '',
    description: cleanText(item.querySelector('description')?.textContent) ?? '',
    sourceType: 'RSS',
    selected: false,
  }))
}

async function fetchArxivFeed(maxItems, sourceLabel) {
  const url = new URL('https://export.arxiv.org/api/query')
  url.searchParams.set('search_query', 'cat:cs.AI')
  url.searchParams.set('max_results', maxItems)
  url.searchParams.set('sortBy', 'submittedDate')
  url.searchParams.set('sortOrder', 'descending')

  const response = await fetchXml(url.toString(), sourceLabel)
  if (!response.ok) {
    throw new Error(`Received ${response.status} from ${sourceLabel}`)
  }

  const text = await response.text()
  const parser = new DOMParser()
  const xml = parser.parseFromString(text, 'text/xml')
  const entries = Array.from(xml.querySelectorAll('entry')).slice(0, maxItems)

  return entries.map((entry, index) => ({
    id: generateId(`${sourceLabel}-${index}`),
    title: cleanText(entry.querySelector('title')?.textContent) ?? 'Untitled',
    url: entry.querySelector('id')?.textContent ?? '#',
    source: sourceLabel,
    date: entry.querySelector('published')?.textContent ?? '',
    description: cleanText(entry.querySelector('summary')?.textContent) ?? '',
    sourceType: 'ArXiv',
    selected: false,
  }))
}

async function fetchTavily(settings, config) {
  if (!tavilyKey) {
    throw new Error('Missing Tavily API key. Set VITE_TAVILY_KEY in your .env.local file.')
  }

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      api_key: tavilyKey,
      query: `AI updates for ${config.persona}`,
      max_results: settings.max || 5,
      topic: 'news',
    }),
  })

  if (!response.ok) {
    throw new Error(`Tavily returned ${response.status}.`)
  }

  const payload = await response.json()
  const results = Array.isArray(payload.results) ? payload.results : []

  return results.slice(0, settings.max || 5).map((item, index) => ({
    id: generateId(`tavily-${index}`),
    title: item.title ?? 'Untitled',
    url: item.url ?? '#',
    source: SOURCE_METADATA.tavily.label,
    date: item.published_date ?? '',
    description: item.content ?? '',
    sourceType: 'Tavily',
    selected: false,
  }))
}

function buildErrorSource(key, settings, error) {
  const metadata = SOURCE_METADATA[key] ?? { label: key }
  return {
    id: generateId(`${key}-error`),
    title: `${metadata.label} failed`,
    url: '#',
    source: metadata.label,
    date: '',
    description: '',
    sourceType: metadata.type ?? 'Unknown',
    selected: false,
    error:
      error?.message ??
      'Unable to fetch this source. Check the network tab for full diagnostics.',
  }
}

function generateId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`
}

function cleanText(value) {
  if (!value) return ''
  return value.replace(/<!\[CDATA\[|\]\]>/g, '').trim()
}

async function fetchItunesPodcast(sourceKey, maxItems) {
  const collectionId = itunesIds[sourceKey]
  if (!collectionId) {
    throw new Error(
      `Missing Apple Podcasts collection ID for ${sourceKey}. Set VITE_ITUNES_${sourceKey.toUpperCase()}_ID in your .env.local file.`,
    )
  }

  const url = new URL('https://itunes.apple.com/lookup')
  url.searchParams.set('id', collectionId)
  url.searchParams.set('entity', 'podcastEpisode')
  url.searchParams.set('limit', String(Math.max(maxItems * 2, maxItems)))

  const response = await fetch(url.toString())

  if (!response.ok) {
    throw new Error(
      `Apple Podcasts returned ${response.status} for ${
        SOURCE_METADATA[sourceKey]?.label ?? sourceKey
      }.`,
    )
  }

  const payload = await response.json()
  const results = Array.isArray(payload.results) ? payload.results : []
  const episodes = results.filter((item) => item.wrapperType === 'podcastEpisode')
  if (!episodes.length) {
    throw new Error(
      `Apple Podcasts did not return recent episodes for ${
        SOURCE_METADATA[sourceKey]?.label ?? sourceKey
      }.`,
    )
  }

  return episodes.slice(0, maxItems).map((episode, index) => ({
    id: generateId(`${sourceKey}-${episode.trackId ?? index}`),
    title: episode.trackName ?? 'Untitled episode',
    url: episode.trackViewUrl ?? episode.collectionViewUrl ?? '#',
    source: SOURCE_METADATA[sourceKey]?.label ?? sourceKey,
    date: episode.releaseDate ? new Date(episode.releaseDate).toISOString() : '',
    description: cleanText(
      stripHtml(episode.description ?? episode.shortDescription ?? ''),
    ),
    sourceType: 'Podcast',
    selected: false,
  }))
}

async function fetchListenNotesPodcast(sourceKey, maxItems) {
  if (!listenNotesKey) {
    throw new Error('Missing Listen Notes API key. Set VITE_LISTEN_NOTES_KEY in your .env.local file.')
  }

  const podcastId = listenNotesIds[sourceKey]
  if (!podcastId) {
    throw new Error(
      `Missing Listen Notes podcast ID for ${sourceKey}. Set VITE_LISTEN_NOTES_${sourceKey.toUpperCase()}_ID in your .env.local file.`,
    )
  }

  const url = new URL(`https://listen-api.listennotes.com/api/v2/podcasts/${encodeURIComponent(podcastId)}`)
  url.searchParams.set('sort', 'recent_first')

  const response = await fetchListenNotesWithRetry(() =>
    fetch(url.toString(), {
      headers: {
        'X-ListenAPI-Key': listenNotesKey,
      },
    }),
  )

  if (!response.ok) {
    throw new Error(
      `Listen Notes returned ${response.status} for ${
        SOURCE_METADATA[sourceKey]?.label ?? sourceKey
      }.`,
    )
  }

  const payload = await response.json()
  const episodes = Array.isArray(payload.episodes) ? payload.episodes.slice(0, maxItems) : []

  return episodes.map((episode, index) => ({
    id: generateId(`${sourceKey}-${episode.id ?? index}`),
    title: episode.title ?? 'Untitled episode',
    url: episode.link ?? episode.listennotes_url ?? '#',
    source: SOURCE_METADATA[sourceKey]?.label ?? sourceKey,
    date: episode.pub_date_ms ? new Date(episode.pub_date_ms).toISOString() : '',
    description: cleanText(stripHtml(episode.description ?? '')),
    sourceType: 'Podcast',
    selected: false,
  }))
}

async function fetchXml(url, sourceLabel) {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Received ${response.status} from ${sourceLabel}`)
    }
    return response
  } catch (error) {
    const shouldRetryWithProxy =
      rssProxyBase && error instanceof TypeError
    if (!shouldRetryWithProxy) {
      throw error
    }
  }

  const proxiedUrl = `${rssProxyBase}${encodeURIComponent(url)}`
  const proxiedResponse = await fetch(proxiedUrl)
  if (!proxiedResponse.ok) {
    throw new Error(
      `Received ${proxiedResponse.status} from proxy while fetching ${sourceLabel}`,
    )
  }

  return proxiedResponse
}

function stripHtml(value) {
  if (!value) return ''
  return value.replace(/<[^>]*>/g, ' ')
}

async function fetchListenNotesWithRetry(requestFn, attempts = 2) {
  let response
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      response = await requestFn()
    } catch (error) {
      if (attempt === attempts) throw error
      await pause(1000)
      continue
    }

    if (response.status !== 429 || attempt === attempts) {
      return response
    }

    const retryAfter = Number(response.headers.get('Retry-After'))
    const delayMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 1500
    await pause(delayMs)
  }

  return response
}

function pause(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function fetchWithProxy(url, sourceLabel) {
  try {
    const response = await fetch(url)
    if (response.ok || !rssProxyBase) {
      return response
    }

    const proxied = await fetch(`${rssProxyBase}${encodeURIComponent(url)}`)
    return proxied
  } catch (error) {
    if (rssProxyBase && error instanceof TypeError) {
      return fetch(`${rssProxyBase}${encodeURIComponent(url)}`)
    }

    throw error
  }
}

async function fetchMistralNews(maxItems) {
  const sourceLabel = SOURCE_METADATA.mistralBlog.label
  const sitemapUrl = 'https://mistral.ai/sitemap.xml'

  const response = await fetchXml(sitemapUrl, sourceLabel)
  if (!response.ok) {
    throw new Error(`Received ${response.status} while loading sitemap for ${sourceLabel}`)
  }

  const text = await response.text()
  const parser = new DOMParser()
  const xml = parser.parseFromString(text, 'text/xml')
  const urlNodes = Array.from(xml.querySelectorAll('url loc'))

  const seen = new Set()
  const posts = []

  for (const node of urlNodes) {
    const loc = node.textContent
    if (!loc || !loc.includes('/news/') || loc.includes('/fr/')) continue

    const slug = loc.split('/').filter(Boolean).pop()
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    posts.push({ url: loc, slug })
  }

  const selected = posts.slice(0, maxItems)

  const details = await Promise.all(
    selected.map(async ({ url, slug }) => {
      try {
        const pageResponse = await fetchWithProxy(url, sourceLabel)
        if (!pageResponse.ok) {
          throw new Error(`Received ${pageResponse.status}`)
        }

        const html = await pageResponse.text()
        const doc = parser.parseFromString(html, 'text/html')

        const title =
          doc.querySelector('meta[property="og:title"]')?.content ||
          doc.querySelector('h1')?.textContent ||
          formatSlug(slug)
        const description =
          doc.querySelector('meta[name="description"]')?.content ||
          doc.querySelector('meta[property="og:description"]')?.content ||
          ''
        const date =
          doc.querySelector('meta[property="article:published_time"]')?.content ||
          ''

        return {
          id: generateId(`mistral-${slug}`),
          title: cleanText(title),
          url,
          source: sourceLabel,
          date,
          description: cleanText(description),
          sourceType: 'Blog',
          selected: false,
        }
      } catch (error) {
        console.error('Failed to parse Mistral news article', url, error)
        return {
          id: generateId(`mistral-${slug}`),
          title: formatSlug(slug),
          url,
          source: sourceLabel,
          date: '',
          description: '',
          sourceType: 'Blog',
          selected: false,
        }
      }
    }),
  )

  return details
}

function formatSlug(slug) {
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function enforceDateRange(items, rangeInDays) {
  if (!rangeInDays) return items

  const { start, end } = rangeInDays
  const startTime = start ? new Date(start).setHours(0, 0, 0, 0) : null
  const endTime = end ? new Date(end).setHours(23, 59, 59, 999) : Date.now()

  return items.filter((item) => {
    if (!item?.date) return true
    const timestamp = new Date(item.date).getTime()
    if (Number.isNaN(timestamp)) return true
    if (startTime && timestamp < startTime) return false
    if (timestamp > endTime) return false
    return true
  })
}

function normalizeDateRange(range, config) {
  if (range && range.start && range.end) return range

  const configStart = config?.startDate
  const configEnd = config?.endDate
  if (!configStart && !configEnd) {
    return null
  }

  const endIso = configEnd || new Date().toISOString().slice(0, 10)
  let startIso = configStart
  if (!startIso) {
    const endDate = new Date(endIso)
    const fallback = new Date(endDate.getTime() - 6 * 86400000)
    startIso = fallback.toISOString().slice(0, 10)
  }

  return { start: startIso, end: endIso }
}

async function fetchAnthropicNews(maxItems) {
  const sourceLabel = SOURCE_METADATA.anthropicBlog.label
  const sitemapUrl = 'https://www.anthropic.com/sitemap.xml'

  const response = await fetchXml(sitemapUrl, sourceLabel)
  if (!response.ok) {
    throw new Error(`Received ${response.status} while loading sitemap for ${sourceLabel}`)
  }

  const text = await response.text()
  const parser = new DOMParser()
  const xml = parser.parseFromString(text, 'text/xml')
  const urlNodes = Array.from(xml.querySelectorAll('url'))

  const entries = urlNodes
    .map((node) => ({
      url: node.querySelector('loc')?.textContent ?? '',
      lastmod: node.querySelector('lastmod')?.textContent ?? '',
    }))
    .filter((entry) => entry.url.includes('/news/') || entry.url.includes('/research/'))
    .filter((entry) => entry.url && !entry.url.includes('/fr/'))

  entries.sort((a, b) => {
    const timeA = new Date(b.lastmod || 0).getTime()
    const timeB = new Date(a.lastmod || 0).getTime()
    return timeA - timeB
  })

  const selected = entries.slice(0, maxItems)

  const items = await Promise.all(
    selected.map(async ({ url, lastmod }) => {
      const slug = url.split('/').filter(Boolean).pop() || Date.now().toString()

      try {
        const pageResponse = await fetchWithProxy(url, sourceLabel)
        if (!pageResponse.ok) {
          throw new Error(`Received ${pageResponse.status}`)
        }

        const html = await pageResponse.text()
        const doc = parser.parseFromString(html, 'text/html')

        const title =
          doc.querySelector('meta[property="og:title"]')?.content ||
          doc.querySelector('h1')?.textContent ||
          formatSlug(slug)
        const description =
          doc.querySelector('meta[name="description"]')?.content ||
          doc.querySelector('meta[property="og:description"]')?.content ||
          ''
        const date =
          doc.querySelector('meta[property="article:published_time"]')?.content ||
          lastmod ||
          ''

        return {
          id: generateId(`anthropic-${slug}`),
          title: cleanText(title),
          url,
          source: sourceLabel,
          date,
          description: cleanText(description),
          sourceType: 'Blog',
          selected: false,
        }
      } catch (error) {
        console.error('Failed to parse Anthropic article', url, error)
        return {
          id: generateId(`anthropic-${slug}`),
          title: formatSlug(slug),
          url,
          source: sourceLabel,
          date: lastmod || '',
          description: '',
          sourceType: 'Blog',
          selected: false,
        }
      }
    }),
  )

  return items
}
