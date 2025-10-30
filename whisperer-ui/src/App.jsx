import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ChatPane from './components/ChatPane.jsx'
import ConfigPanel from './components/ConfigPanel.jsx'
import SourcesTable from './components/SourcesTable.jsx'
import EvidenceDrawer from './components/EvidenceDrawer.jsx'
import FlowStatusBar from './components/FlowStatusBar.jsx'
import TalkingPointsPanel from './components/TalkingPointsPanel.jsx'
import { fetchAllSources } from './services/fetchSources.js'
import {
  ingestSources as ingestToBackend,
  listSources,
  deleteSource as deleteSourceFromBackend,
  createBriefing,
  reviseBriefing,
  enrichSourcesOnDemand,
  fetchBackendStats,
  listTalkingPoints,
  createTalkingPoint,
  updateTalkingPoint,
  deleteTalkingPoint,
  fetchTalkingPointMetrics,
  starSource,
  unstarSource,
  hideSource,
  unhideSource,
  fetchSourceNote,
} from './services/backend.js'

const MAX_PER_RUN = Number(import.meta.env.VITE_MAX_SOURCES_PER_RUN || 200)
const CONFIG_PERSIST_KEY = 'whisperer-config-v2'
const LEGACY_SOURCE_PERSIST_KEY = 'whisperer-source-selection'
const TALKING_LAYOUT_KEY = 'whisperer-compose-left-percent'
const CHAT_TRANSCRIPTS_STORAGE_KEY = 'whisperer-chat-transcripts'
const CHAT_TRANSCRIPT_LIMIT = 12
const initialAssistantMessage = {
  id: 'assistant-welcome',
  role: 'assistant',
  text: 'Tell me about the audience, priorities, tone, and any must-haves. Click Draft when you want me to build or revise the talking points.',
  createdAt: new Date().toISOString(),
}

function randomId(prefix) {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10)
  return `${prefix || 'msg'}-${random}`
}

function composePromptFromMessages(messages, fallbackPrompt = '') {
  if (!Array.isArray(messages) || messages.length === 0) {
    return fallbackPrompt
  }
  const userSections = messages
    .filter((message) => message && message.role === 'user' && typeof message.text === 'string')
    .map((message, index) => `Request ${index + 1}:\n${message.text.trim()}`)
    .filter((section) => section.trim().length > 0)

  if (userSections.length === 0) {
    return fallbackPrompt
  }

  return userSections.join('\n\n')
}

function extractFirstSentence(text) {
  if (typeof text !== 'string') return ''
  const trimmed = text.trim()
  if (!trimmed) return ''
  const match = trimmed.match(/(.+?[.!?])(\s|$)/)
  return match ? match[1].trim() : trimmed
}

function getSavedPointUrl(point) {
  if (!point) return ''
  if (point.source && point.source.url) return String(point.source.url).trim()
  if (point.sourceUrl) return String(point.sourceUrl).trim()
  if (point.url) return String(point.url).trim()
  return ''
}

function tokenizeForSimilarity(text) {
  if (!text) return []
  return String(text)
    .toLowerCase()
    .match(/[a-z0-9]+/g) || []
}

function computeTextSimilarity(a, b) {
  const tokensA = tokenizeForSimilarity(a)
  const tokensB = tokenizeForSimilarity(b)
  if (!tokensA.length || !tokensB.length) return 0
  const freqA = new Map()
  const freqB = new Map()
  tokensA.forEach((token) => {
    freqA.set(token, (freqA.get(token) || 0) + 1)
  })
  tokensB.forEach((token) => {
    freqB.set(token, (freqB.get(token) || 0) + 1)
  })
  let dot = 0
  let normA = 0
  let normB = 0
  freqA.forEach((value, key) => {
    normA += value * value
    if (freqB.has(key)) {
      dot += value * freqB.get(key)
    }
  })
  freqB.forEach((value) => {
    normB += value * value
  })
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

function sanitizeTagList(value) {
  if (!value) return []
  if (Array.isArray(value)) {
    return value
      .map((tag) => String(tag).trim().toLowerCase())
      .filter((tag) => tag && tag.length <= 40)
      .slice(0, 8)
  }
  if (typeof value === 'string') {
    return value
      .split(/[,\s]+/)
      .map((tag) => tag.trim().toLowerCase())
      .filter((tag) => tag && tag.length <= 40)
      .slice(0, 8)
  }
  return []
}
function mergeSourceLists(existing, incoming) {
  const map = new Map()

  const makeKey = (item) => {
    const url = (item?.url || '').trim()
    if (url && url !== '#') return url
    if (item?.id) return `id:${item.id}`
    if (item?.source) return `source:${item.source}`
    return `fallback:${Math.random().toString(36).slice(2)}`
  }

  for (const item of existing) {
    map.set(makeKey(item), item)
  }

  for (const item of incoming) {
    const key = makeKey(item)
    const current = map.get(key)

    if (!current) {
      map.set(key, item)
      continue
    }

    const nextSelected = current.selected || item.selected
    const keepExisting = current && !current.error && item.error

    if (keepExisting) {
      continue
    }

    const merged = {
      ...current,
      ...item,
      id: current.id || item.id,
      selected: nextSelected,
    }

    if (!item.error) {
      delete merged.error
    }

    map.set(key, merged)
  }

  return Array.from(map.values())
}

function normalizeStoredSource(item) {
  if (!item) return null
  const randomId = () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `stored-${Math.random().toString(36).slice(2)}`
  return {
    id: item.id ?? item.url ?? randomId(),
    title: item.title || 'Untitled',
    url: item.url || '#',
    source: item.source || 'Unknown',
    date: item.published_at || item.created_at || '',
    description: item.description || '',
    sourceType: item.source_type || 'Library',
    selected: false,
    starredAt: item.starred_at || null,
    starred: Boolean(item.starred_at),
    hiddenAt: item.hidden_at || null,
    hidden: Boolean(item.hidden_at),
  }
}
const todayIso = new Date().toISOString().slice(0, 10)
const defaultStartIso = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10)

const initialConfig = {
  prompt: 'Fortune 100 Executive — Fintech, Enterprise AI, Regulatory',
  startDate: defaultStartIso,
  endDate: todayIso,
  podcastProvider: 'itunes',
  sources: {
    techcrunch: { enabled: true, max: 10, label: 'TechCrunch AI' },
    noPriors: { enabled: true, max: 3, label: 'No Priors Podcast' },
    a16z: { enabled: true, max: 3, label: 'a16z Podcast' },
    dwarkesh: { enabled: true, max: 3, label: 'Dwarkesh Podcast' },
    lexfridman: { enabled: true, max: 3, label: 'Lex Fridman Podcast' },
    twiml: { enabled: true, max: 3, label: 'TWIML AI Podcast' },
    thisDayInAi: { enabled: true, max: 3, label: 'This Day in AI' },
    latentSpace: { enabled: true, max: 3, label: 'Latent Space' },
    mlst: { enabled: true, max: 3, label: 'Machine Learning Street Talk' },
    yCombinator: { enabled: true, max: 3, label: 'Y Combinator Podcast' },
    trainingData: { enabled: true, max: 3, label: 'Training Data Podcast' },
    deepmind: { enabled: true, max: 3, label: 'Google DeepMind Podcast' },
    openaiBlog: { enabled: true, max: 5, label: 'OpenAI Blog' },
    openaiResearch: { enabled: true, max: 5, label: 'OpenAI Research' },
    deepmindBlog: { enabled: true, max: 5, label: 'Google DeepMind Blog' },
    metaAiBlog: { enabled: true, max: 5, label: 'Meta AI Blog' },
    googleAiBlog: { enabled: true, max: 5, label: 'Google AI Blog' },
    microsoftAiBlog: { enabled: true, max: 5, label: 'Microsoft AI Blog' },
    nvidiaBlog: { enabled: true, max: 5, label: 'NVIDIA AI Blog' },
    mitAiBlog: { enabled: true, max: 5, label: 'MIT Tech Review – AI' },
    gradientBlog: { enabled: true, max: 5, label: 'The Gradient' },
    ai2Blog: { enabled: true, max: 5, label: 'AI2 Blog' },
    eleutherBlog: { enabled: true, max: 5, label: 'Eleuther AI News' },
    cohereBlog: { enabled: true, max: 5, label: 'Cohere Blog' },
    mistralBlog: { enabled: true, max: 5, label: 'Mistral AI News' },
    stabilityBlog: { enabled: true, max: 5, label: 'Stability AI Blog' },
    anthropicBlog: { enabled: true, max: 5, label: 'Anthropic Updates' },
    tavily: { enabled: false, max: 5, label: 'Tavily News Search' },
    arxiv: { enabled: true, max: 5, label: 'ArXiv Papers' },
  },
}

const statusLabels = {
  idle: 'Ready to add sources',
  fetching: 'Adding sources...',
  curating: 'Selecting top sources…',
  generating: 'Drafting executive talking points…',
  done: 'Talking points ready',
}

function App() {
  const [config, setConfig] = useState(initialConfig)
  const [status, setStatus] = useState('idle')
  const [statusMessage, setStatusMessage] = useState(statusLabels.idle)
  const [progress, setProgress] = useState({ loaded: 0, total: 0 })
  const [sources, setSources] = useState([])
  const [briefing, setBriefing] = useState(null)
  const [reportMeta, setReportMeta] = useState(null) // { id, selectedUrls, selectedIds }
  const [error, setError] = useState(null)
  const [errorStage, setErrorStage] = useState(null)
  const [isFetching, setIsFetching] = useState(false)
  const [isIngesting, setIsIngesting] = useState(false)
  const [isCreatingBriefing, setIsCreatingBriefing] = useState(false)
  const [isRevisingBriefing, setIsRevisingBriefing] = useState(false)
  const [isConfigCollapsed, setIsConfigCollapsed] = useState(true)
  const [configSaveMessage, setConfigSaveMessage] = useState('')
  const [activeView, setActiveView] = useState('points')
  const [isEvidenceOpen, setIsEvidenceOpen] = useState(false)
  const [chatMessages, setChatMessages] = useState(() => [initialAssistantMessage])
  const [sessionId] = useState(() => randomId('chat'))
  const [initialPrompt, setInitialPrompt] = useState('')
  const [lastDraftUserCount, setLastDraftUserCount] = useState(0)
  const [pinnedPoints, setPinnedPoints] = useState([])
  const [excludedUrls, setExcludedUrls] = useState([])
  const [savedPoints, setSavedPoints] = useState([])
  const [isLoadingSavedPoints, setIsLoadingSavedPoints] = useState(false)
  const [sourceNotes, setSourceNotes] = useState(() => new Map())
  const [pendingStarIds, setPendingStarIds] = useState(() => new Set())
  const [noteLoadingIds, setNoteLoadingIds] = useState(() => new Set())
  const [pendingPointSaves, setPendingPointSaves] = useState(() => new Set())
  const [pendingPointUpdates, setPendingPointUpdates] = useState(() => new Set())
  const [pendingHideIds, setPendingHideIds] = useState(() => new Set())
  const [pendingPointDeletes, setPendingPointDeletes] = useState(() => new Set())
  const [isSavingAllPoints, setIsSavingAllPoints] = useState(false)
  const [talkingPointMetrics, setTalkingPointMetrics] = useState(null)
  const [isMetricsLoading, setIsMetricsLoading] = useState(false)
  const [enrichedEvidence, setEnrichedEvidence] = useState({})
  const [evidenceStatusMessage, setEvidenceStatusMessage] = useState('')
  const [flowStats, setFlowStats] = useState({ totalSources: 0, enrichedSources: 0, totalReports: 0, totalTalkingPoints: 0 })
  const [leftPanePercent, setLeftPanePercent] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = Number.parseFloat(window.localStorage.getItem(TALKING_LAYOUT_KEY) || '')
        if (!Number.isNaN(stored) && stored >= 0.2 && stored <= 0.7) {
          return stored
        }
      } catch {
        // ignore storage read errors
      }
    }
    return 0.34
  })
  const [isResizing, setIsResizing] = useState(false)
  const composeLayoutRef = useRef(null)
  const isResizingRef = useRef(false)
  const transcriptSignatureRef = useRef('')
  const evidenceCacheRef = useRef(new Map())
  const updatePaneFromClientX = useCallback((clientX) => {
    if (!composeLayoutRef.current || typeof clientX !== 'number') return
    const rect = composeLayoutRef.current.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    const raw = (clientX - rect.left) / rect.width
    const clamped = Math.min(0.7, Math.max(0.2, raw))
    setLeftPanePercent(clamped)
  }, [])

  const handleResizeStart = useCallback((event) => {
    if (!composeLayoutRef.current) return
    event.preventDefault()
    isResizingRef.current = true
    setIsResizing(true)
    if (typeof document !== 'undefined') {
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'col-resize'
    }
    const clientX = 'touches' in event ? event.touches?.[0]?.clientX : event.clientX
    if (typeof clientX === 'number') {
      updatePaneFromClientX(clientX)
    }
  }, [updatePaneFromClientX])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    try {
      window.localStorage.setItem(TALKING_LAYOUT_KEY, leftPanePercent.toFixed(4))
    } catch {
      /* ignore storage failures */
    }
    return undefined
  }, [leftPanePercent])

  useEffect(() => {
    const handleMove = (event) => {
      if (!isResizingRef.current) return
      const clientX = 'touches' in event ? event.touches?.[0]?.clientX : event.clientX
      if (typeof clientX !== 'number') return
      if ('touches' in event && event.cancelable) event.preventDefault()
      updatePaneFromClientX(clientX)
    }

    const stopResize = () => {
      if (!isResizingRef.current) return
      isResizingRef.current = false
      setIsResizing(false)
      if (typeof document !== 'undefined') {
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
      }
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('touchmove', handleMove, { passive: false })
    window.addEventListener('mouseup', stopResize)
    window.addEventListener('touchend', stopResize)
    window.addEventListener('touchcancel', stopResize)

    return () => {
      stopResize()
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('touchmove', handleMove)
      window.removeEventListener('mouseup', stopResize)
      window.removeEventListener('touchend', stopResize)
      window.removeEventListener('touchcancel', stopResize)
    }
  }, [updatePaneFromClientX])

  useEffect(() => {
    try {
      const stored = localStorage.getItem(CONFIG_PERSIST_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (parsed && typeof parsed === 'object') {
          setConfig((previous) => ({
            ...previous,
            prompt:
              typeof parsed.prompt === 'string' && parsed.prompt.trim()
                ? parsed.prompt.trim()
                : previous.prompt,
            startDate:
              typeof parsed.startDate === 'string' && parsed.startDate
                ? parsed.startDate
                : previous.startDate,
            endDate:
              typeof parsed.endDate === 'string'
                ? parsed.endDate
                : previous.endDate,
            podcastProvider: parsed.podcastProvider || previous.podcastProvider,
            sources: {
              ...previous.sources,
              ...(parsed.sources && typeof parsed.sources === 'object' ? parsed.sources : {}),
            },
          }))
        }
      } else {
        const legacySources = localStorage.getItem(LEGACY_SOURCE_PERSIST_KEY)
        if (legacySources) {
          const parsedLegacy = JSON.parse(legacySources)
          if (parsedLegacy && typeof parsedLegacy === 'object') {
            setConfig((previous) => ({
              ...previous,
              sources: Object.fromEntries(
                Object.entries(previous.sources).map(([key, settings]) => [
                  key,
                  {
                    ...settings,
                    enabled:
                      typeof parsedLegacy[key] === 'boolean'
                        ? parsedLegacy[key]
                        : settings.enabled,
                  },
                ]),
              ),
            }))
          }
        }
      }
    } catch (err) {
      console.error('Failed to restore saved configuration', err)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!configSaveMessage) return undefined
    const timeout = setTimeout(() => setConfigSaveMessage(''), 4000)
    return () => clearTimeout(timeout)
  }, [configSaveMessage])

  const savedPointUrlSet = useMemo(() => {
    const set = new Set()
    savedPoints.forEach((item) => {
      const url = getSavedPointUrl(item)
      if (url) {
        set.add(url)
      }
    })
    return set
  }, [savedPoints])

  useEffect(() => {
    if (activeView !== 'points') {
      setIsEvidenceOpen(false)
    }
  }, [activeView])

  useEffect(() => {
    let ignore = false

    async function loadSavedSources() {
      try {
        const { start, end } = resolveDateRange()
        const resp = await listSources({ startDate: start, endDate: end, limit: 500 })
        const items = Array.isArray(resp?.items)
          ? resp.items
              .map((entry) => normalizeStoredSource(entry))
              .filter(Boolean)
          : []

        if (!ignore && items.length) {
          setSources((previous) => {
            const merged = mergeSourceLists(previous, items)
            setProgress({ loaded: merged.length, total: merged.length })
            return merged
          })
          setStatusMessage(`Loaded ${items.length} saved sources. Fetch to refresh.`)
        }
      } catch (err) {
        console.error('Failed to load saved sources', err)
      }
    }

    loadSavedSources()

    return () => {
      ignore = true
    }
  }, [config.startDate, config.endDate])

  useEffect(() => {
    if (!isEvidenceOpen) return
    const hasSelected = sources.some((item) => item && item.selected)
    if (!hasSelected) setIsEvidenceOpen(false)
  }, [isEvidenceOpen, sources])


  useEffect(() => {
    if (!briefing || !Array.isArray(briefing.points) || briefing.points.length === 0) {
      setPinnedPoints((previous) => (previous.length ? [] : previous))
      setExcludedUrls((previous) => (previous.length ? [] : previous))
      return
    }

    const latestByUrl = new Map(
      briefing.points
        .filter((point) => point && point.url)
        .map((point) => [String(point.url), point]),
    )

    setPinnedPoints((previous) => {
      if (!previous.length) return previous
      const next = []
      const seen = new Set()
      for (const point of previous) {
        if (!point || !point.url) continue
        const key = String(point.url)
        if (seen.has(key)) continue
        seen.add(key)
        const updated = latestByUrl.get(key)
        if (updated) {
          next.push(updated)
        }
      }
      if (next.length === previous.length && next.every((item, idx) => item === previous[idx])) {
        return previous
      }
      return next
    })

    setExcludedUrls((previous) => {
      if (!previous.length) return previous
      const filtered = previous.filter((url) => latestByUrl.has(String(url)))
      return filtered.length === previous.length ? previous : filtered
    })
  }, [briefing])

  const isAiBusy = isCreatingBriefing || isRevisingBriefing
  const hasUserMessages = useMemo(
    () => chatMessages.some((message) => message.role === 'user'),
    [chatMessages],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!Array.isArray(chatMessages) || chatMessages.length === 0) return
    const userMessages = chatMessages.filter((message) => message.role === 'user')
    if (userMessages.length === 0) return

    const signature = JSON.stringify({
      ids: chatMessages.map((message) => message.id),
      pinned: pinnedPoints
        .filter((point) => point && point.url)
        .map((point) => String(point.url)),
      excluded: excludedUrls.map((url) => String(url)),
      reportId: reportMeta?.id ?? null,
    })

    if (signature === transcriptSignatureRef.current) return
    transcriptSignatureRef.current = signature

    const sanitizedMessages = chatMessages.map((message) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      createdAt: message.createdAt || null,
    }))

    const payload = {
      sessionId,
      updatedAt: new Date().toISOString(),
      reportId: reportMeta?.id ?? null,
      initialPrompt,
      messageCount: chatMessages.length,
      userCount: userMessages.length,
      pinnedCount: pinnedPoints.length,
      excludedCount: excludedUrls.length,
      status,
      messages: sanitizedMessages,
    }

    let existing = []
    try {
      const stored = window.localStorage.getItem(CHAT_TRANSCRIPTS_STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed)) {
          existing = parsed.filter((entry) => entry && entry.sessionId !== sessionId)
        }
      }
    } catch (error) {
      console.error('Failed to read stored chat transcripts', error)
    }

    existing.push(payload)
    if (existing.length > CHAT_TRANSCRIPT_LIMIT) {
      existing = existing.slice(existing.length - CHAT_TRANSCRIPT_LIMIT)
    }

    try {
      window.localStorage.setItem(CHAT_TRANSCRIPTS_STORAGE_KEY, JSON.stringify(existing))
    } catch (error) {
      console.error('Failed to persist chat transcript', error)
    }
  }, [chatMessages, excludedUrls, initialPrompt, pinnedPoints, reportMeta, sessionId, status])

  const hasEnabledSource = useMemo(
    () => Object.values(config.sources).some((source) => source.enabled),
    [config.sources],
  )

  const handleConfigChange = (partial) => {
    setConfig((previous) => ({
      ...previous,
      ...partial,
    }))
  }

  const handleSourceToggle = (key) => {
    setConfig((previous) => ({
      ...previous,
      sources: {
        ...previous.sources,
        [key]: {
          ...previous.sources[key],
          enabled: !previous.sources[key].enabled,
        },
      },
    }))
  }

  const handleSelectAllSources = () => {
    setConfig((previous) => ({
      ...previous,
      sources: Object.fromEntries(
        Object.entries(previous.sources).map(([key, settings]) => [
          key,
          { ...settings, enabled: true },
        ]),
      ),
    }))
  }

  const handleSelectNoneSources = () => {
    setConfig((previous) => ({
      ...previous,
      sources: Object.fromEntries(
        Object.entries(previous.sources).map(([key, settings]) => [
          key,
          { ...settings, enabled: false },
        ]),
      ),
    }))
  }

  const handleToggleConfigCollapsed = () => {
    setIsConfigCollapsed((previous) => !previous)
  }

  const handleSaveConfig = () => {
    try {
      localStorage.setItem(CONFIG_PERSIST_KEY, JSON.stringify(config))
      setConfigSaveMessage('Saved!')
    } catch (err) {
      console.error('Failed to save configuration', err)
      setConfigSaveMessage('Save failed')
    }
  }

  const resolveDateRange = useCallback(() => {
    const start = config.startDate
    const end = config.endDate
    if (start && end) return { start, end }
    const endDateObj = end ? new Date(end) : new Date()
    if (Number.isNaN(endDateObj.getTime())) {
      const fallback = new Date()
      const fallbackEnd = fallback.toISOString().slice(0, 10)
      const fallbackStart = new Date(fallback.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      return { start: fallbackStart, end: fallbackEnd }
    }
    const endIso = endDateObj.toISOString().slice(0, 10)
    let from = start
      ? start
      : new Date(endDateObj.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const startDate = new Date(from)
    const endDate = new Date(endIso)
    if (startDate > endDate) {
      const normalized = endDate.toISOString().slice(0, 10)
      return { start: normalized, end: normalized }
    }
    if (Number.isNaN(startDate.getTime())) {
      from = new Date(endDate.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    }
    return { start: from, end: endIso }
  }, [config.endDate, config.startDate])

  const refreshTalkingPointMetrics = useCallback(async () => {
    setIsMetricsLoading(true)
    try {
      const resp = await fetchTalkingPointMetrics({ limit: 30 })
      if (resp && typeof resp === 'object') {
        setTalkingPointMetrics(resp)
      }
    } catch (err) {
      console.error('Failed to fetch talking point metrics', err)
    } finally {
      setIsMetricsLoading(false)
    }
  }, [])

  const loadSavedTalkingPoints = useCallback(async () => {
    setIsLoadingSavedPoints(true)
    try {
      const { start, end } = resolveDateRange()
      const resp = await listTalkingPoints({ startDate: start, endDate: end, limit: 500 })
      if (resp?.items && Array.isArray(resp.items)) {
        setSavedPoints(resp.items)
        refreshTalkingPointMetrics()
      } else {
        setSavedPoints([])
        refreshTalkingPointMetrics()
      }
    } catch (err) {
      console.error('Failed to load saved talking points', err)
      setStatusMessage('Failed to load saved talking points.')
    } finally {
      setIsLoadingSavedPoints(false)
    }
  }, [refreshTalkingPointMetrics, resolveDateRange])

  const findSimilarSavedPoint = useCallback(
    (headline, body, sourceUrl) => {
      const reference = `${headline || ''}\n${body || ''}`.trim()
      if (!reference) return null
      const normalizedRef = reference.toLowerCase()
      const refUrl = typeof sourceUrl === 'string' ? sourceUrl.trim() : ''
      let bestScore = 0
      let bestPoint = null
      savedPoints.forEach((item) => {
        const candidateUrl = getSavedPointUrl(item)
        if (refUrl && candidateUrl && candidateUrl === refUrl) return
        const candidateText = `${item.headline || ''}\n${item.body || ''}`.trim().toLowerCase()
        if (!candidateText) return
        const score = computeTextSimilarity(normalizedRef, candidateText)
        if (score > bestScore) {
          bestScore = score
          bestPoint = item
        }
      })
      if (bestScore >= 0.82 && bestPoint) {
        return {
          score: bestScore,
          point: bestPoint,
        }
      }
      return null
    },
    [savedPoints],
  )

  useEffect(() => {
    loadSavedTalkingPoints()
  }, [loadSavedTalkingPoints])

  const handleFetchSources = async () => {
    if (!hasEnabledSource || isFetching || isAiBusy) return

    setIsFetching(true)
    setStatus('fetching')
    setStatusMessage(statusLabels.fetching)
    setProgress({ loaded: 0, total: 0 })
    setError(null)
    setErrorStage(null)
    setBriefing(null)
    setReportMeta(null)

    try {
      const { start, end } = resolveDateRange()
      const allSources = await fetchAllSources(config, {
        onBatch: (batch) => {
          setSources((previous) => {
            const merged = mergeSourceLists(previous, batch)
            setProgress((prev) => ({
              loaded: merged.length,
              total: merged.length,
            }))
            return merged
          })
        },
        onProgress: (nextProgress) => setProgress(nextProgress),
        onStatus: (message) => setStatusMessage(message),
        dateRange: { start, end },
      })

      if (!allSources.length) {
        throw new Error('No sources returned. Try expanding the date range or enabling more feeds.')
      }

      const successfulSources = allSources.filter((item) => !item.error)
      if (!successfulSources.length) {
        throw new Error('All sources failed to load. Check API keys and network access, then try again.')
      }

      let mergedList
      setSources((previous) => {
        mergedList = mergeSourceLists(previous, allSources)
        return mergedList
      })

      if (mergedList) {
        setProgress({ loaded: mergedList.length, total: mergedList.length })
      }
      setStatus('idle')
      setStatusMessage('Sources loaded. Generate talking points when ready.')
      setErrorStage(null)
    } catch (caught) {
      console.error(caught)
      setError(caught.message || 'Unexpected error while fetching sources.')
      setErrorStage('fetch')
      setStatus('idle')
      setStatusMessage('Something went wrong. Adjust settings and retry fetch.')
    } finally {
      setIsFetching(false)
    }
  }

  const handleIngestToLibrary = async () => {
    if (!hasEnabledSource || isFetching || isAiBusy || isIngesting) return

    setIsIngesting(true)
    setStatus('fetching')
    setStatusMessage('Adding sources to database...')
    setProgress({ loaded: 0, total: 0 })
    setError(null)
    setErrorStage(null)
    setBriefing(null)
    setReportMeta(null)

    try {
      const { start, end } = resolveDateRange()
      const allSources = await fetchAllSources(config, {
        onBatch: (batch) => {
          setSources((prev) => {
            const merged = mergeSourceLists(prev, batch)
            setProgress((prior) => ({
              loaded: merged.length,
              total: merged.length,
            }))
            return merged
          })
        },
        onProgress: (p) => setProgress(p),
        onStatus: (m) => setStatusMessage(m),
        dateRange: { start, end },
      })

      const successful = allSources.filter((i) => !i.error)
      if (!successful.length) throw new Error('No sources fetched to ingest.')

      setStatusMessage(
        `Ingesting ${successful.length} into database (server enforces per-feed policy)...`,
      )
      const result = await ingestToBackend(successful)
      let mergedList
      setSources((prev) => {
        mergedList = mergeSourceLists(prev, successful)
        return mergedList
      })
      if (mergedList) {
        setProgress({ loaded: mergedList.length, total: mergedList.length })
      }
      setStatus('idle')
      setStatusMessage(`Database updated (${result.inserted} item${result.inserted === 1 ? '' : 's'} upserted).`)
      refreshFlowStats()
    } catch (e) {
      console.error(e)
      setError(e.message || 'Ingestion failed')
      setErrorStage('ingest')
      setStatus('idle')
      setStatusMessage('Ingestion failed. Adjust settings and retry.')
    } finally {
      setIsIngesting(false)
    }
  }

  const handleRemoveSource = async (source) => {
    if (!source?.id) return
    const numericId = Number(source.id)
    if (!Number.isInteger(numericId) || numericId <= 0) return
    try {
      await deleteSourceFromBackend(numericId)
      const nextSources = sources.filter((item) => item.id !== source.id)
      setSources(nextSources)
      setProgress((prev) => ({
        loaded: Math.min(prev.loaded, nextSources.length),
        total: prev.total > 0 ? Math.max(prev.total - 1, nextSources.length) : nextSources.length,
      }))
      setReportMeta((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          selectedUrls: Array.isArray(prev.selectedUrls)
            ? prev.selectedUrls.filter((url) => url !== source.url)
            : prev.selectedUrls,
          selectedIds: Array.isArray(prev.selectedIds)
            ? prev.selectedIds.filter((id) => id !== source.id)
            : prev.selectedIds,
        }
      })
      if (selectedCount && source.selected) {
        setStatusMessage('Source removed from briefing and database.')
      }
      refreshFlowStats()
      setSourceNotes((previous) => {
        if (!previous.has(numericId)) return previous
        const next = new Map(previous)
        next.delete(numericId)
        return next
      })
    } catch (err) {
      console.error(err)
      setError(err.message || 'Failed to remove source')
      setErrorStage('delete')
    }
  }

  const handleToggleStarSource = useCallback(
    async (source, nextStarred) => {
      if (!source?.id) return
      const numericId = Number(source.id)
      if (!Number.isInteger(numericId) || numericId <= 0) return

      setPendingStarIds((previous) => {
        const next = new Set(previous)
        next.add(numericId)
        return next
      })

      try {
        if (nextStarred) {
          const resp = await starSource(numericId)
          const starredAt = resp?.starredAt || new Date().toISOString()
          const note = resp?.note || null
          setSources((previous) =>
            previous.map((item) =>
              Number(item.id) === numericId
                ? { ...item, starred: true, starredAt }
                : item,
            ),
          )
          if (note && Array.isArray(note.points)) {
            setSourceNotes((previous) => {
              const next = new Map(previous)
              next.set(numericId, note)
              return next
            })
          }
          setStatusMessage('Talking points generated for starred source.')
        } else {
          await unstarSource(numericId)
          setSources((previous) =>
            previous.map((item) =>
              Number(item.id) === numericId
                ? { ...item, starred: false, starredAt: null }
                : item,
            ),
          )
          setStatusMessage('Source unstarred.')
        }
      } catch (err) {
        console.error('Failed to toggle source star', err)
        setStatusMessage(err.message || 'Failed to update star status.')
      } finally {
        setPendingStarIds((previous) => {
          const next = new Set(previous)
          next.delete(numericId)
          return next
        })
      }
    },
    [starSource, unstarSource],
  )

  const handleToggleHideSource = useCallback(
    async (source, nextHidden) => {
      if (!source?.id) return
      const numericId = Number(source.id)
      if (!Number.isInteger(numericId) || numericId <= 0) return

      setPendingHideIds((previous) => {
        const next = new Set(previous)
        next.add(numericId)
        return next
      })

      try {
        if (nextHidden) {
          const resp = await hideSource(numericId)
          const hiddenAt = resp?.hiddenAt || new Date().toISOString()
          setSources((previous) =>
            previous.map((item) =>
              Number(item.id) === numericId
                ? { ...item, hidden: true, hiddenAt }
                : item,
            ),
          )
          setStatusMessage('Source hidden. It will not be used for AI selection.')
        } else {
          await unhideSource(numericId)
          setSources((previous) =>
            previous.map((item) =>
              Number(item.id) === numericId
                ? { ...item, hidden: false, hiddenAt: null }
                : item,
            ),
          )
          setStatusMessage('Source unhidden.')
        }
      } catch (err) {
        console.error('Failed to toggle source hide', err)
        setStatusMessage(err.message || 'Failed to update hide status.')
      } finally {
        setPendingHideIds((previous) => {
          const next = new Set(previous)
          next.delete(numericId)
          return next
        })
      }
    },
    [hideSource, unhideSource],
  )

  const loadSourceNote = useCallback(
    async (sourceId, { force = false } = {}) => {
      const numericId = Number(sourceId)
      if (!Number.isInteger(numericId) || numericId <= 0) return null
      if (!force && sourceNotes.has(numericId)) {
        return sourceNotes.get(numericId)
      }

      setNoteLoadingIds((previous) => {
        const next = new Set(previous)
        next.add(numericId)
        return next
      })
      try {
        const resp = await fetchSourceNote(numericId)
        if (resp?.note) {
          setSourceNotes((previous) => {
            const next = new Map(previous)
            next.set(numericId, resp.note)
            return next
          })
          return resp.note
        }
        return null
      } catch (err) {
        const message = err?.message || ''
        if (!message.includes('404')) {
          console.error('Failed to load source note', err)
          setStatusMessage(message || 'Failed to load source talking points.')
        }
        return null
      } finally {
        setNoteLoadingIds((previous) => {
          const next = new Set(previous)
          next.delete(numericId)
          return next
        })
      }
    },
    [fetchSourceNote, sourceNotes],
  )

  const handleRefreshSourceNote = useCallback(
    async (source) => {
      if (!source?.id) return
      const numericId = Number(source.id)
      if (!Number.isInteger(numericId) || numericId <= 0) return
      setPendingStarIds((previous) => {
        const next = new Set(previous)
        next.add(numericId)
        return next
      })
      setNoteLoadingIds((previous) => {
        const next = new Set(previous)
        next.add(numericId)
        return next
      })
      try {
        const resp = await starSource(numericId)
        const note = resp?.note || null
        const starredAt = resp?.starredAt || new Date().toISOString()
        setSources((previous) =>
          previous.map((item) =>
            Number(item.id) === numericId
              ? { ...item, starred: true, starredAt }
              : item,
          ),
        )
        if (note && Array.isArray(note.points)) {
          setSourceNotes((previous) => {
            const next = new Map(previous)
            next.set(numericId, note)
            return next
          })
        }
        setStatusMessage('Talking points refreshed for this source.')
      } catch (err) {
        console.error('Failed to refresh source note', err)
        setStatusMessage(err.message || 'Failed to regenerate talking points.')
      } finally {
        setPendingStarIds((previous) => {
          const next = new Set(previous)
          next.delete(numericId)
          return next
        })
        setNoteLoadingIds((previous) => {
          const next = new Set(previous)
          next.delete(numericId)
          return next
        })
      }
    },
    [starSource],
  )


  const handleViewChange = (view) => {
    setActiveView(view)
  }

  const handleCreateBriefing = async (promptText) => {
    if (isAiBusy || isFetching) {
      return { ok: false, error: 'AI is busy. Try again once the current run finishes.' }
    }
    const effectivePrompt = typeof promptText === 'string' && promptText.trim()
      ? promptText.trim()
      : (config.prompt && config.prompt.trim()) || initialConfig.prompt
    setConfig((previous) => ({
      ...previous,
      prompt: effectivePrompt,
    }))
    setIsCreatingBriefing(true)
    setError(null)
    setErrorStage(null)
    setStatus('generating')
    setStatusMessage('Selecting and composing talking points…')
    setBriefing(null)
    setReportMeta(null)
    try {
      const { start, end } = resolveDateRange()
      const resp = await createBriefing({ prompt: effectivePrompt, startDate: start, endDate: end, limit: MAX_PER_RUN })
      if (!resp?.ok) throw new Error('Talking point generation failed')
      setBriefing(resp.briefing)
      setReportMeta({ id: resp.id, selectedUrls: resp.selectedUrls || [], selectedIds: resp.selectedIds || [] })

      // Mark selections for evidence drawer
      const selectedSet = new Set(resp.selectedUrls || [])
      setSources((prev) => prev.map((s) => ({ ...s, selected: selectedSet.has(s.url) })))

      setStatus('done')
      setStatusMessage('Talking points ready')
      refreshFlowStats()
      return { ok: true, selectedCount: Array.isArray(resp.selectedIds) ? resp.selectedIds.length : 0 }
    } catch (e) {
      console.error(e)
      setError(e.message || 'Talking point generation failed')
      setErrorStage('briefing')
      setStatus('idle')
      setStatusMessage('Generation failed. Adjust prompt/date window and retry.')
      return { ok: false, error: e.message || 'Talking point generation failed' }
    } finally {
      setIsCreatingBriefing(false)
    }
  }

  const handleReviseBriefing = async ({ feedback, pinnedPoints: pinned = [], droppedUrls = [], promptText } = {}) => {
    if (!reportMeta?.id || isRevisingBriefing) {
      return { ok: false, error: 'No draft available to revise yet.' }
    }
    const effectivePrompt = typeof promptText === 'string' && promptText.trim()
      ? promptText.trim()
      : (config.prompt && config.prompt.trim()) || initialPrompt || initialConfig.prompt
    setConfig((previous) => ({
      ...previous,
      prompt: effectivePrompt,
    }))
    setIsRevisingBriefing(true)
    setStatus('generating')
    setStatusMessage('Regenerating with feedback…')
    setError(null)
    setErrorStage(null)
    try {
      const resp = await reviseBriefing({
        id: reportMeta.id,
        prompt: effectivePrompt,
        feedback,
        selectedIds: reportMeta?.selectedIds || [],
        pinnedPoints: pinned,
        droppedUrls,
        keepPinned: true,
      })
      if (!resp?.ok) throw new Error('Revision failed')
      setBriefing({ ...resp.briefing, generatedAt: new Date().toISOString(), reasoning: briefing?.reasoning })
      setStatus('done')
      setStatusMessage('Talking points updated')
      return { ok: true, selectedCount: Array.isArray(resp.briefing?.points) ? resp.briefing.points.length : 0 }
    } catch (e) {
      console.error(e)
      setError(e.message || 'Revision failed')
      setErrorStage('revise')
      setStatus('done')
      setStatusMessage('Revision failed. Update feedback and retry.')
      return { ok: false, error: e.message || 'Revision failed' }
    } finally {
      setIsRevisingBriefing(false)
    }
  }

  const handleDraftFromChat = useCallback(
    async (text) => {
      const trimmed = typeof text === 'string' ? text.trim() : ''
      let workingMessages = chatMessages
      if (trimmed) {
        const userMessage = {
          id: randomId('user'),
          role: 'user',
          text: trimmed,
          createdAt: new Date().toISOString(),
        }
        workingMessages = [...chatMessages, userMessage]
        setChatMessages(workingMessages)
      }

      const userMessages = workingMessages.filter((message) => message.role === 'user')
      if (userMessages.length === 0) {
        setChatMessages((previous) => [
          ...previous,
          {
            id: randomId('assistant'),
            role: 'assistant',
            text: 'Add at least one message about the audience or focus before drafting.',
            createdAt: new Date().toISOString(),
          },
        ])
        return
      }

      const userCount = userMessages.length
      const placeholderId = randomId('assistant')
      setChatMessages((previous) => [
        ...previous,
        {
          id: placeholderId,
          role: 'assistant',
          text: 'Drafting your talking points…',
          createdAt: new Date().toISOString(),
        },
      ])

      if (!briefing) {
        const promptText = composePromptFromMessages(userMessages, config.prompt)
        setInitialPrompt(promptText)
        const result = await handleCreateBriefing(promptText)
        if (result.ok) {
          setLastDraftUserCount(userCount)
        }
        const draftSummary = result.ok
          ? (() => {
              const parts = ['Draft ready.']
              if (typeof result.selectedCount === 'number' && result.selectedCount > 0) {
                parts.push(
                  `${result.selectedCount} point${result.selectedCount === 1 ? '' : 's'} generated.`,
                )
              }
              parts.push('Review the talking points on the right.')
              return parts.join(' ')
            })()
          : `Draft failed: ${result.error}`
        setChatMessages((previous) =>
          previous.map((message) =>
            message.id === placeholderId
              ? {
                  ...message,
                  text: draftSummary,
                }
              : message,
          ),
        )
      } else {
        const promptText = initialPrompt || composePromptFromMessages(userMessages, config.prompt)
        const feedbackMessages = userMessages.slice(lastDraftUserCount)
        const feedbackText = feedbackMessages.length
          ? feedbackMessages.map((message) => message.text).join('\n\n')
          : 'Refresh the talking points using the existing guidance.'

        const result = await handleReviseBriefing({
          feedback: feedbackText,
          pinnedPoints,
          droppedUrls: excludedUrls,
          promptText,
        })
        if (result.ok) {
          setLastDraftUserCount(userCount)
        }
        const revisionSummary = result.ok
          ? (() => {
              const parts = ['Updated the talking points.']
              if (pinnedPoints.length) {
                parts.push(`Pinned ${pinnedPoints.length}.`)
              }
              if (excludedUrls.length) {
                parts.push(`Marked ${excludedUrls.length} to drop.`)
              }
              parts.push('Review the talking points panel.')
              return parts.join(' ')
            })()
          : `Revision failed: ${result.error}`

        setChatMessages((previous) =>
          previous.map((message) =>
            message.id === placeholderId
              ? {
                  ...message,
                  text: revisionSummary,
                }
              : message,
          ),
        )
      }
  },
    [
      chatMessages,
      briefing,
      config.prompt,
      excludedUrls,
      handleCreateBriefing,
      handleReviseBriefing,
      initialPrompt,
      lastDraftUserCount,
      pinnedPoints,
    ],
  )

  const refreshFlowStats = useCallback(async () => {
    try {
      const resp = await fetchBackendStats()
      if (resp && typeof resp === 'object') {
        const {
          totalSources = 0,
          enrichedSources = 0,
          totalReports = 0,
          totalTalkingPoints = 0,
        } = resp
        setFlowStats({
          totalSources: Number(totalSources) || 0,
          enrichedSources: Number(enrichedSources) || 0,
          totalReports: Number(totalReports) || 0,
          totalTalkingPoints: Number(totalTalkingPoints) || 0,
        })
      }
    } catch (err) {
      console.error('Failed to refresh flow stats', err)
    }
  }, [])

  useEffect(() => {
    refreshFlowStats()
  }, [refreshFlowStats])

  const findSourceIdForUrl = useCallback(
    (url) => {
      if (typeof url !== 'string') return null
      const trimmed = url.trim()
      if (!trimmed) return null
      const match = sources.find(
        (item) => item && typeof item.url === 'string' && item.url.trim() === trimmed,
      )
      if (!match || !match.id) return null
      const numeric = Number(match.id)
      if (Number.isInteger(numeric) && numeric > 0) return numeric
      return null
    },
    [sources],
  )

  const buildGeneratedPointKey = useCallback((point) => {
    if (!point || typeof point !== 'object') return ''
    if (point.url) return `url:${String(point.url)}`
    if (point.title) return `title:${String(point.title)}`
    if (point.insight) return `insight:${String(point.insight).slice(0, 60)}`
    if (point.implication) return `implication:${String(point.implication).slice(0, 60)}`
    return `point:${JSON.stringify(point).slice(0, 60)}`
  }, [])

  const formatPointForSave = useCallback(
    (point, { tags = [] } = {}) => {
      if (!point || typeof point !== 'object') return null
      const headline =
        (typeof point.title === 'string' && point.title.trim()) ||
        extractFirstSentence(point.insight) ||
        'New talking point'
      const insight = typeof point.insight === 'string' ? point.insight.trim() : ''
      const implication = typeof point.implication === 'string' ? point.implication.trim() : ''
      const bodyParts = [insight, implication].filter(Boolean)
      const body = bodyParts.length ? bodyParts.join('\n\n') : headline
      const sourceUrl = typeof point.url === 'string' && point.url.trim() ? point.url.trim() : null
      const sourceId = sourceUrl ? findSourceIdForUrl(sourceUrl) : null
      const normalizedTags = sanitizeTagList(tags)
      return {
        headline,
        body,
        sourceId,
        sourceUrl,
        relatedSourceIds: [],
        tags: normalizedTags,
      }
    },
    [findSourceIdForUrl],
  )

  const isGeneratedPointSaved = useCallback(
    (point) => {
      const payload = formatPointForSave(point)
      if (!payload) return false
      const urlKey = payload.sourceUrl ? payload.sourceUrl.trim() : ''
      if (urlKey && savedPointUrlSet.has(urlKey)) return true
      const headlineKey = payload.headline ? payload.headline.trim().toLowerCase() : ''
      if (!headlineKey) return false
      return savedPoints.some(
        (item) =>
          typeof item?.headline === 'string' &&
          item.headline.trim().toLowerCase() === headlineKey,
      )
    },
    [formatPointForSave, savedPointUrlSet, savedPoints],
  )

  const isSavingGeneratedPoint = useCallback(
    (point) => {
      const key = buildGeneratedPointKey(point)
      return pendingPointSaves.has(key)
    },
    [buildGeneratedPointKey, pendingPointSaves],
  )

  const handleSaveGeneratedPoint = useCallback(
    async (point, { tags = [], force = false } = {}) => {
      const payload = formatPointForSave(point, { tags })
      if (!payload) {
        setStatusMessage('Unable to save this talking point.')
        return { ok: false, error: 'Invalid talking point' }
      }
      const urlKey = payload.sourceUrl ? payload.sourceUrl.trim() : ''
      if (urlKey && savedPointUrlSet.has(urlKey)) {
        setStatusMessage('Already saved this talking point.')
        return { ok: true, skipped: true }
      }
      if (!urlKey) {
        const headlineKey = payload.headline ? payload.headline.trim().toLowerCase() : ''
        if (
          headlineKey &&
          savedPoints.some(
            (item) =>
              typeof item?.headline === 'string' &&
              item.headline.trim().toLowerCase() === headlineKey,
          )
        ) {
          setStatusMessage('Already saved this talking point.')
          return { ok: true, skipped: true }
        }
      }

      const duplicateCandidate = findSimilarSavedPoint(payload.headline, payload.body, payload.sourceUrl)
      if (duplicateCandidate && !force) {
        setStatusMessage(`Possible duplicate of saved point “${duplicateCandidate.point.headline}”. Confirm to save anyway.`)
        return {
          ok: false,
          requiresConfirmation: true,
          duplicate: duplicateCandidate,
        }
      }

      const originalHeadline = typeof point.title === 'string' && point.title.trim()
        ? point.title.trim()
        : payload.headline
      const originalBody = [point.insight, point.implication]
        .map((segment) => (typeof segment === 'string' ? segment.trim() : ''))
        .filter(Boolean)
        .join('\n\n') || payload.body

      const pendingKey = buildGeneratedPointKey(point)
      setPendingPointSaves((previous) => {
        const next = new Set(previous)
        next.add(pendingKey)
        return next
      })
      try {
        const resp = await createTalkingPoint({
          ...payload,
          originalHeadline,
          originalBody,
        })
        if (resp?.item) {
          setSavedPoints((previous) => {
            const filtered = previous.filter((item) => item?.id !== resp.item.id)
            return [resp.item, ...filtered]
          })
          setStatusMessage('Talking point saved.')
          refreshFlowStats()
          refreshTalkingPointMetrics()
          return { ok: true, item: resp.item }
        }
        throw new Error('Save failed')
      } catch (err) {
        console.error('Failed to save talking point', err)
        setStatusMessage(err.message || 'Failed to save talking point')
        return { ok: false, error: err.message || 'Failed to save talking point' }
      } finally {
        setPendingPointSaves((previous) => {
          const next = new Set(previous)
          next.delete(pendingKey)
          return next
        })
      }
    },
    [buildGeneratedPointKey, findSimilarSavedPoint, formatPointForSave, refreshFlowStats, refreshTalkingPointMetrics, savedPointUrlSet, savedPoints],
  )

  const handleSaveAllPoints = useCallback(async () => {
    if (!briefing || !Array.isArray(briefing.points) || briefing.points.length === 0) {
      return { ok: false, error: 'No talking points to save.' }
    }
    const unsaved = briefing.points.filter((point) => !isGeneratedPointSaved(point))
    if (unsaved.length === 0) {
      setStatusMessage('All talking points are already saved.')
      return { ok: true, skipped: true }
    }
    setIsSavingAllPoints(true)
    let savedCount = 0
    for (const point of unsaved) {
      // eslint-disable-next-line no-await-in-loop
      const result = await handleSaveGeneratedPoint(point, { force: true })
      if (result.ok && !result.skipped) {
        savedCount += 1
      }
    }
    setIsSavingAllPoints(false)
    if (savedCount > 0) {
      setStatusMessage(
        `Saved ${savedCount} talking point${savedCount === 1 ? '' : 's'}.`,
      )
    }
    return { ok: true, savedCount }
  }, [briefing, handleSaveGeneratedPoint, isGeneratedPointSaved])

  const handleSaveNotePoint = useCallback(
    async (sourceId, notePoint) => {
      if (!notePoint || typeof notePoint !== 'object') {
        return { ok: false, error: 'Invalid note point' }
      }
      const converted = {
        title: notePoint.hook || notePoint.title || 'New talking point',
        type: notePoint.type || 'Article',
        insight: notePoint.insight || '',
        implication: notePoint.implication || '',
        url: notePoint.url || '',
        supportingFacts: Array.isArray(notePoint.supportingFacts)
          ? notePoint.supportingFacts.filter(Boolean)
          : [],
        sourceId: notePoint.sourceId || sourceId || null,
      }
      if (!converted.url && sourceId) {
        const match = sources.find((item) => Number(item.id) === Number(sourceId))
        if (match?.url) {
          converted.url = match.url
        }
      }
      const tags = Array.isArray(notePoint.tags) ? notePoint.tags : []
      return handleSaveGeneratedPoint(converted, { tags, force: true })
    },
    [handleSaveGeneratedPoint, sources],
  )

  const handleSaveAllNotePoints = useCallback(
    async (sourceId, notePoints = []) => {
      if (!Array.isArray(notePoints) || notePoints.length === 0) {
        return { ok: false, error: 'No note points available' }
      }
      let savedCount = 0
      // eslint-disable-next-line no-restricted-syntax
      for (const point of notePoints) {
        // eslint-disable-next-line no-await-in-loop
        const result = await handleSaveNotePoint(sourceId, point)
        if (result.ok && !result.skipped) {
          savedCount += 1
        }
      }
      if (savedCount > 0) {
        setStatusMessage(
          `Saved ${savedCount} talking point${savedCount === 1 ? '' : 's'} from this source.`,
        )
      }
      return { ok: true, savedCount }
    },
    [handleSaveNotePoint],
  )

  const handleUpdateSavedPoint = useCallback(
    async (id, updates = {}) => {
      const numericId = Number(id)
      if (!Number.isInteger(numericId) || numericId <= 0) {
        return { ok: false, error: 'Invalid talking point id' }
      }
      const payload = { id: numericId }
      if (typeof updates.headline === 'string') {
        const trimmed = updates.headline.trim()
        if (trimmed) payload.headline = trimmed
      }
      if (typeof updates.body === 'string') {
        const trimmedBody = updates.body.trim()
        if (trimmedBody) payload.body = trimmedBody
      }
      if (typeof updates.tags !== 'undefined') {
        payload.tags = sanitizeTagList(updates.tags)
      }

      if (typeof updates.originalHeadline === 'string') {
        payload.originalHeadline = updates.originalHeadline
      }
      if (typeof updates.originalBody === 'string') {
        payload.originalBody = updates.originalBody
      }

      if (!payload.headline && !payload.body && !payload.tags && !payload.originalHeadline && !payload.originalBody) {
        return { ok: false, error: 'Nothing to update' }
      }

      setPendingPointUpdates((previous) => {
        const next = new Set(previous)
        next.add(numericId)
        return next
      })
      try {
        const resp = await updateTalkingPoint(payload)
        if (resp?.item) {
          setSavedPoints((previous) =>
            previous.map((item) => (item.id === numericId ? resp.item : item)),
          )
          setStatusMessage('Talking point updated.')
          refreshTalkingPointMetrics()
          return { ok: true, item: resp.item }
        }
        throw new Error('Update failed')
      } catch (err) {
        console.error('Failed to update talking point', err)
        setStatusMessage(err.message || 'Failed to update talking point')
        return { ok: false, error: err.message || 'Failed to update talking point' }
      } finally {
        setPendingPointUpdates((previous) => {
          const next = new Set(previous)
          next.delete(numericId)
          return next
        })
      }
    },
    [refreshTalkingPointMetrics],
  )

  const handleDeleteSavedPoint = useCallback(
    async (id) => {
      const numericId = Number(id)
      if (!Number.isInteger(numericId) || numericId <= 0) {
        return { ok: false, error: 'Invalid talking point id' }
      }
      setPendingPointDeletes((previous) => {
        const next = new Set(previous)
        next.add(numericId)
        return next
      })
      try {
        await deleteTalkingPoint(numericId)
        setSavedPoints((previous) => previous.filter((item) => item.id !== numericId))
        setStatusMessage('Talking point deleted.')
        refreshFlowStats()
        refreshTalkingPointMetrics()
        return { ok: true }
      } catch (err) {
        console.error('Failed to delete talking point', err)
        setStatusMessage(err.message || 'Failed to delete talking point')
        return { ok: false, error: err.message || 'Failed to delete talking point' }
      } finally {
        setPendingPointDeletes((previous) => {
          const next = new Set(previous)
          next.delete(numericId)
          return next
        })
      }
    },
    [refreshFlowStats, refreshTalkingPointMetrics],
  )

  const isSavedPointUpdating = useCallback(
    (id) => pendingPointUpdates.has(Number(id)),
    [pendingPointUpdates],
  )

  const isSavedPointDeleting = useCallback(
    (id) => pendingPointDeletes.has(Number(id)),
    [pendingPointDeletes],
  )

  const ensureSourceDetails = useCallback(
    async (sourceIds, { force = false } = {}) => {
      if (!Array.isArray(sourceIds) || sourceIds.length === 0) return []
      const numericIds = sourceIds
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0)
      if (!numericIds.length) return []

      const cache = evidenceCacheRef.current
      const needsFetch = force ? numericIds : numericIds.filter((id) => !cache.has(id))
      if (needsFetch.length) {
        const resp = await enrichSourcesOnDemand({ sourceIds: needsFetch, force })
        if (resp?.items && Array.isArray(resp.items)) {
          let hasNewEnrichment = false
          setEnrichedEvidence((previous) => {
            const next = { ...previous }
            resp.items.forEach((item) => {
              const existing = previous[item.id]
              next[item.id] = item
              cache.set(item.id, item)
              if (item?.hasContent && (!existing || !existing.hasContent)) {
                hasNewEnrichment = true
              }
            })
            return next
          })
          if (hasNewEnrichment) {
            refreshFlowStats()
          }
        }
      }
      return numericIds.map((id) => cache.get(id) || null)
    },
    [enrichSourcesOnDemand, refreshFlowStats],
  )

  const requestEvidence = useCallback(
    async (sourceIds, { force = false } = {}) => {
      if (!Array.isArray(sourceIds) || sourceIds.length === 0) return
      const numericIds = sourceIds
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0)
      if (!numericIds.length) return

      const cache = evidenceCacheRef.current
      const missing = force ? numericIds : numericIds.filter((id) => !cache.has(id))
      if (!missing.length) return

      try {
        setEvidenceStatusMessage(
          `Pulling full content for ${missing.length} source${missing.length === 1 ? '' : 's'}…`,
        )
        await ensureSourceDetails(numericIds, { force })
        setEvidenceStatusMessage('Full content cached for selected sources.')
      } catch (err) {
        console.error('Failed to enrich sources', err)
        setEvidenceStatusMessage(err.message || 'Failed to cache full content.')
      }
    },
    [ensureSourceDetails],
  )

  const handleViewSourceDetail = useCallback(
    async (source) => {
      // This handler is kept for compatibility but no longer opens a drawer
      // The enriched content will be shown inline when the row is expanded
      if (!source?.id) return
      const numericId = Number(source.id)
      if (!Number.isInteger(numericId) || numericId <= 0) return

      // Ensure enriched content is available
      await ensureSourceDetails([numericId], { force: false })
    },
    [ensureSourceDetails],
  )


  const handleTogglePinPoint = useCallback((point) => {
    if (!point || !point.url) return
    const urlKey = String(point.url)
    setPinnedPoints((previous) => {
      const exists = previous.some((item) => item && String(item.url) === urlKey)
      if (exists) {
        return previous.filter((item) => item && String(item.url) !== urlKey)
      }
      return [...previous, point]
    })
    setExcludedUrls((previous) => previous.filter((url) => String(url) !== urlKey))
  }, [])

  const handleToggleExcludePoint = useCallback((point) => {
    if (!point || !point.url) return
    const urlKey = String(point.url)
    setExcludedUrls((previous) => {
      const exists = previous.some((url) => String(url) === urlKey)
      if (exists) {
        return previous.filter((url) => String(url) !== urlKey)
      }
      return [...previous, urlKey]
    })
    setPinnedPoints((previous) => previous.filter((item) => item && String(item.url) !== urlKey))
  }, [])
  const selectedUrlSet = useMemo(() => new Set(reportMeta?.selectedUrls || []), [reportMeta])
  const selectedSourceIds = useMemo(
    () => (Array.isArray(reportMeta?.selectedIds) ? reportMeta.selectedIds : []),
    [reportMeta],
  )
  const displayedSources = useMemo(() =>
    sources.map((s) => ({ ...s, selected: s.selected || selectedUrlSet.has(s.url) })),
  [sources, selectedUrlSet])
  const evidenceSources = useMemo(
    () =>
      displayedSources
        .filter((item) => item.selected)
        .map((item) => {
          const enriched = item.id ? enrichedEvidence[item.id] : null
          return {
            ...item,
            excerpt: enriched?.excerpt || '',
            enrichedAt: enriched?.enrichedAt || null,
            hasContent: enriched?.hasContent || false,
          }
        }),
    [displayedSources, enrichedEvidence],
  )
  const selectedCount = evidenceSources.length
  const evidenceDrawerMessage = evidenceStatusMessage || `${selectedCount} source${selectedCount === 1 ? '' : 's'} supporting these talking points.`
  const filteredSourceCount = Array.isArray(reportMeta?.selectedIds) ? reportMeta.selectedIds.length : 0
  const talkingPointsCount = Array.isArray(briefing?.points) ? briefing.points.length : 0
  const savedPointsCount = flowStats.totalTalkingPoints || 0
  const pinnedUrlSet = useMemo(
    () =>
      new Set(
        pinnedPoints
          .filter((point) => point && point.url)
          .map((point) => String(point.url)),
      ),
    [pinnedPoints],
  )
  const excludedUrlSet = useMemo(
    () => new Set(excludedUrls.map((url) => String(url))),
    [excludedUrls],
  )
  const flowStatusLabel = statusLabels[status] || 'Status'
  const chatWidth = useMemo(
    () => `clamp(260px, ${(leftPanePercent * 100).toFixed(1)}vw, 640px)`,
    [leftPanePercent],
  )
  const chatPlaceholderWidth = useMemo(
    () => `calc(${chatWidth} - 32px)`,
    [chatWidth],
  )
  const leftPaneStyle = useMemo(
    () => ({
      flex: `0 0 ${chatPlaceholderWidth}`,
      minWidth: '228px',
      maxWidth: '608px',
      position: 'relative',
    }),
    [chatPlaceholderWidth],
  )
  const rightPaneStyle = useMemo(() => ({
    flex: '1 1 auto',
    minWidth: 420,
  }), [])
  const handleOpenEvidence = () => {
    if (selectedCount > 0) {
      if (selectedSourceIds.length) {
        requestEvidence(selectedSourceIds)
      }
      setIsEvidenceOpen(true)
    }
  }

  const handleCloseEvidence = () => {
    setIsEvidenceOpen(false)
  }

  useEffect(() => {
    if (selectedSourceIds.length) {
      requestEvidence(selectedSourceIds)
    }
  }, [selectedSourceIds, requestEvidence])

  const isTalkingPointsView = activeView === 'points'

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-title">Whisperer</span>
        <nav className="workspace-nav" aria-label="Primary">
          <button
            type="button"
            className={`nav-item${activeView === 'sources' ? ' is-active' : ''}`}
            onClick={() => handleViewChange('sources')}
          >
            Sources
          </button>
          <button
            type="button"
            className={`nav-item${isTalkingPointsView ? ' is-active' : ''}`}
            onClick={() => handleViewChange('points')}
          >
            Talking Points
          </button>
          <button
            type="button"
            className={`nav-item nav-config${!isConfigCollapsed ? ' is-active' : ''}`}
            onClick={handleToggleConfigCollapsed}
            aria-label={isConfigCollapsed ? 'Show configuration panel' : 'Hide configuration panel'}
            aria-pressed={!isConfigCollapsed}
          >
            <i aria-hidden="true" className="bi bi-gear" />
            <span className="nav-label">Config</span>
          </button>
        </nav>
      </header>
      <FlowStatusBar
        stats={flowStats}
        filteredCount={filteredSourceCount}
        talkingPointsCount={talkingPointsCount}
        savedPointsCount={savedPointsCount}
        statusLabel={flowStatusLabel}
      />
      <main className={`app-main view-${activeView}${isConfigCollapsed ? ' config-collapsed' : ''}`}>
        <section className="workspace-column">
          {isTalkingPointsView ? (
            <div className="compose-layout" ref={composeLayoutRef}>
              <div className="compose-main" style={leftPaneStyle} id="compose-controls-pane">
                <ChatPane
                  messages={chatMessages}
                  onDraft={handleDraftFromChat}
                  isDrafting={isAiBusy}
                  hasUserMessages={hasUserMessages}
                  hasBriefing={Boolean(briefing)}
                  width={chatWidth}
                />
              </div>
              <div
                className={`compose-resize-handle${isResizing ? ' is-active' : ''}`}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize briefing panels"
                aria-valuemin={20}
                aria-valuemax={70}
                aria-valuenow={Math.round(leftPanePercent * 100)}
                aria-controls="compose-controls-pane compose-preview-pane"
                onMouseDown={handleResizeStart}
                onTouchStart={handleResizeStart}
              >
                <span className="sr-only">Drag to resize briefing panels</span>
              </div>
              <div className="compose-side" style={rightPaneStyle} id="compose-preview-pane">
                <TalkingPointsPanel
                  briefing={briefing}
                  status={status}
                  pinnedUrlSet={pinnedUrlSet}
                  excludedUrlSet={excludedUrlSet}
                  onTogglePin={handleTogglePinPoint}
                  onToggleExclude={handleToggleExcludePoint}
                  isDrafting={isAiBusy}
                  onOpenEvidence={handleOpenEvidence}
                  evidenceCount={selectedCount}
                  onSavePoint={handleSaveGeneratedPoint}
                  onSaveAll={handleSaveAllPoints}
                  isPointSaved={isGeneratedPointSaved}
                  isPointSaving={isSavingGeneratedPoint}
                  isSavingAll={isSavingAllPoints}
                  savedPoints={savedPoints}
                  savedPointsLoading={isLoadingSavedPoints}
                  onUpdateSavedPoint={handleUpdateSavedPoint}
                  onDeleteSavedPoint={handleDeleteSavedPoint}
                  isSavedPointUpdating={isSavedPointUpdating}
                  isSavedPointDeleting={isSavedPointDeleting}
                />
              </div>
            </div>
          ) : (
            <div className="sources-layout">
              <SourcesTable
                sources={displayedSources}
                status={status}
                progress={progress}
                error={error}
                errorStage={errorStage}
                onUpdateDatabase={handleIngestToLibrary}
                onRemoveSource={handleRemoveSource}
                onViewSource={handleViewSourceDetail}
                onToggleStar={handleToggleStarSource}
                onToggleHide={handleToggleHideSource}
                isFetching={isFetching}
                isIngesting={isIngesting}
                isRunningAi={isAiBusy}
                hasEnabledSource={hasEnabledSource}
                pendingStarIds={pendingStarIds}
                pendingHideIds={pendingHideIds}
                sourceNotes={sourceNotes}
                noteLoadingIds={noteLoadingIds}
                enrichedContent={enrichedEvidence}
              />
            </div>
          )}
        </section>
      </main>
      <ConfigPanel
        open={!isConfigCollapsed}
        onClose={handleToggleConfigCollapsed}
        config={config}
        onConfigChange={handleConfigChange}
        onToggleSource={handleSourceToggle}
        onSelectAllSources={handleSelectAllSources}
        onSelectNoneSources={handleSelectNoneSources}
        onSaveConfig={handleSaveConfig}
        saveMessage={configSaveMessage}
      />
      <EvidenceDrawer
        open={isTalkingPointsView && isEvidenceOpen}
        onClose={handleCloseEvidence}
        sources={evidenceSources}
        statusMessage={evidenceDrawerMessage}
      />
    </div>
  )
}

export default App
