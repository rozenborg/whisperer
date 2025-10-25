import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ConfigPanel from './components/ConfigPanel.jsx'
import SourcesTable from './components/SourcesTable.jsx'
import EmailPreview from './components/EmailPreview.jsx'
import FeedbackPanel from './components/FeedbackPanel.jsx'
import EvidenceDrawer from './components/EvidenceDrawer.jsx'
import { fetchAllSources } from './services/fetchSources.js'
import { formatEmailHtml } from './services/emailFormatter.js'
import { ingestSources as ingestToBackend, listSources, deleteSource as deleteSourceFromBackend, createBriefing, reviseBriefing } from './services/backend.js'

const MAX_PER_RUN = Number(import.meta.env.VITE_MAX_SOURCES_PER_RUN || 42)
const CONFIG_PERSIST_KEY = 'whisperer-config-v2'
const LEGACY_SOURCE_PERSIST_KEY = 'whisperer-source-selection'
const COMPOSE_LAYOUT_KEY = 'whisperer-compose-left-percent'
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
    techcrunch: { enabled: true, max: 10, label: 'TechCrunch AI (10 items)' },
    noPriors: { enabled: true, max: 3, label: 'No Priors Podcast (3 items)' },
    a16z: { enabled: true, max: 3, label: 'a16z Podcast (3 items)' },
    dwarkesh: { enabled: true, max: 3, label: 'Dwarkesh Podcast (3 items)' },
    lexfridman: { enabled: true, max: 3, label: 'Lex Fridman Podcast (3 items)' },
    twiml: { enabled: true, max: 3, label: 'TWIML AI Podcast (3 items)' },
    thisDayInAi: { enabled: true, max: 3, label: 'This Day in AI (3 items)' },
    latentSpace: { enabled: true, max: 3, label: 'Latent Space (3 items)' },
    mlst: { enabled: true, max: 3, label: 'Machine Learning Street Talk (3 items)' },
    yCombinator: { enabled: true, max: 3, label: 'Y Combinator Podcast (3 items)' },
    trainingData: { enabled: true, max: 3, label: 'Training Data Podcast (3 items)' },
    deepmind: { enabled: true, max: 3, label: 'Google DeepMind Podcast (3 items)' },
    openaiBlog: { enabled: true, max: 5, label: 'OpenAI Blog (5 items)' },
    openaiResearch: { enabled: true, max: 5, label: 'OpenAI Research (5 items)' },
    deepmindBlog: { enabled: true, max: 5, label: 'Google DeepMind Blog (5 items)' },
    metaAiBlog: { enabled: true, max: 5, label: 'Meta AI Blog (5 items)' },
    googleAiBlog: { enabled: true, max: 5, label: 'Google AI Blog (5 items)' },
    microsoftAiBlog: { enabled: true, max: 5, label: 'Microsoft AI Blog (5 items)' },
    nvidiaBlog: { enabled: true, max: 5, label: 'NVIDIA AI Blog (5 items)' },
    mitAiBlog: { enabled: true, max: 5, label: 'MIT Tech Review – AI (5 items)' },
    gradientBlog: { enabled: true, max: 5, label: 'The Gradient (5 items)' },
    ai2Blog: { enabled: true, max: 5, label: 'AI2 Blog (5 items)' },
    eleutherBlog: { enabled: true, max: 5, label: 'Eleuther AI News (5 items)' },
    cohereBlog: { enabled: true, max: 5, label: 'Cohere Blog (5 items)' },
    mistralBlog: { enabled: true, max: 5, label: 'Mistral AI News (5 items)' },
    stabilityBlog: { enabled: true, max: 5, label: 'Stability AI Blog (5 items)' },
    anthropicBlog: { enabled: true, max: 5, label: 'Anthropic Updates (5 items)' },
    tavily: { enabled: false, max: 5, label: 'Tavily News Search (5 items)' },
    arxiv: { enabled: true, max: 5, label: 'ArXiv Papers (5 items)' },
  },
}

const statusLabels = {
  idle: 'Ready to add sources',
  fetching: 'Adding sources...',
  curating: 'Selecting top sources…',
  generating: 'Composing executive talking points…',
  done: 'Briefing ready to send',
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
  const [activeView, setActiveView] = useState('compose')
  const [isEvidenceOpen, setIsEvidenceOpen] = useState(false)
  const [leftPanePercent, setLeftPanePercent] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = Number.parseFloat(window.localStorage.getItem(COMPOSE_LAYOUT_KEY) || '')
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
      window.localStorage.setItem(COMPOSE_LAYOUT_KEY, leftPanePercent.toFixed(4))
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

  useEffect(() => {
    if (activeView !== 'compose') {
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

  const isAiBusy = isCreatingBriefing || isRevisingBriefing

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

  const resolveDateRange = () => {
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
  }

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
              total: Math.max(prev.total, merged.length),
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
    setStatusMessage(`Adding sources to database (up to ${MAX_PER_RUN})...`)
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
              total: Math.max(prior.total, merged.length),
            }))
            return merged
          })
        },
        onProgress: (p) => setProgress(p),
        onStatus: (m) => setStatusMessage(m),
        dateRange: { start, end },
      })

      const successful = allSources.filter((i) => !i.error)
      // Enforce global cap per run
      const capped = successful.slice(0, MAX_PER_RUN)
      if (!capped.length) throw new Error('No sources fetched to ingest.')

      setStatusMessage(`Ingesting ${capped.length} into database...`)
      const result = await ingestToBackend(capped)
      let mergedList
      setSources((prev) => {
        mergedList = mergeSourceLists(prev, capped)
        return mergedList
      })
      if (mergedList) {
        setProgress({ loaded: mergedList.length, total: mergedList.length })
      }
      setStatus('idle')
      setStatusMessage(`Database updated (${result.inserted} items upserted; cap ${MAX_PER_RUN}).`)
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
    } catch (err) {
      console.error(err)
      setError(err.message || 'Failed to remove source')
      setErrorStage('delete')
    }
  }


  const handleViewChange = (view) => {
    setActiveView(view)
  }

  // New: create briefing in one pass
  const handleCreateBriefing = async () => {
    if (isAiBusy || isFetching) return
    setIsCreatingBriefing(true)
    setError(null)
    setErrorStage(null)
    setStatus('generating')
    setStatusMessage('Selecting and composing talking points…')
    setBriefing(null)
    setReportMeta(null)
    try {
      const { start, end } = resolveDateRange()
      const resp = await createBriefing({ prompt: config.prompt, startDate: start, endDate: end, limit: MAX_PER_RUN })
      if (!resp?.ok) throw new Error('Briefing creation failed')
      setBriefing(resp.briefing)
      setReportMeta({ id: resp.id, selectedUrls: resp.selectedUrls || [], selectedIds: resp.selectedIds || [] })

      // Mark selections for evidence drawer
      const selectedSet = new Set(resp.selectedUrls || [])
      setSources((prev) => prev.map((s) => ({ ...s, selected: selectedSet.has(s.url) })))

      setStatus('done')
      setStatusMessage('Briefing ready to send')
    } catch (e) {
      console.error(e)
      setError(e.message || 'Briefing creation failed')
      setErrorStage('briefing')
      setStatus('idle')
      setStatusMessage('Creation failed. Adjust prompt/date window and retry.')
    } finally {
      setIsCreatingBriefing(false)
    }
  }

  // New: revise with feedback
  const handleReviseBriefing = async ({ feedback, pinnedPoints = [], droppedUrls = [] }) => {
    if (!reportMeta?.id || isRevisingBriefing) return
    setIsRevisingBriefing(true)
    setStatus('generating')
    setStatusMessage('Regenerating with feedback…')
    setError(null)
    setErrorStage(null)
    try {
      const resp = await reviseBriefing({ id: reportMeta.id, prompt: config.prompt, feedback, selectedIds: reportMeta?.selectedIds || [], pinnedPoints, droppedUrls, keepPinned: true })
      if (!resp?.ok) throw new Error('Revision failed')
      setBriefing({ ...resp.briefing, generatedAt: new Date().toISOString(), reasoning: briefing?.reasoning })
      setStatus('done')
      setStatusMessage('Briefing updated')
    } catch (e) {
      console.error(e)
      setError(e.message || 'Revision failed')
      setErrorStage('revise')
      setStatus('done')
      setStatusMessage('Revision failed. Update feedback and retry.')
    } finally {
      setIsRevisingBriefing(false)
    }
  }

  const hasSuccessfulSource = sources.some((item) => !item.error)
  const canGenerateBriefing = hasSuccessfulSource && !isFetching
  const selectedUrlSet = useMemo(() => new Set(reportMeta?.selectedUrls || []), [reportMeta])
  const displayedSources = useMemo(() =>
    sources.map((s) => ({ ...s, selected: s.selected || selectedUrlSet.has(s.url) })),
  [sources, selectedUrlSet])
  const evidenceSources = useMemo(
    () => displayedSources.filter((item) => item.selected),
    [displayedSources],
  )
  const totalSourceCount = displayedSources.filter((s) => !s.error).length
  const selectedCount = evidenceSources.length
  const resolvedDateRange = useMemo(() => resolveDateRange(), [config.startDate, config.endDate])

  const formattedEmail = briefing ? formatEmailHtml(config, briefing) : ''
  const leftPaneStyle = useMemo(() => ({
    flex: `0 0 ${(leftPanePercent * 100).toFixed(1)}%`,
    minWidth: 260,
    maxWidth: '640px',
  }), [leftPanePercent])
  const rightPaneStyle = useMemo(() => ({
    flex: '1 1 auto',
    minWidth: 420,
  }), [])
  const handleOpenEvidence = () => {
    if (selectedCount > 0) setIsEvidenceOpen(true)
  }

  const handleCloseEvidence = () => {
    setIsEvidenceOpen(false)
  }

  const isComposeView = activeView === 'compose'

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-title">Whisperer</span>
        <nav className="workspace-nav" aria-label="Primary">
          <button
            type="button"
            className={`nav-item${isComposeView ? ' is-active' : ''}`}
            onClick={() => handleViewChange('compose')}
          >
            Compose
          </button>
          <button
            type="button"
            className={`nav-item${activeView === 'sources' ? ' is-active' : ''}`}
            onClick={() => handleViewChange('sources')}
          >
            Sources
          </button>
        </nav>
        <button
          type="button"
          className="header-toggle"
          onClick={handleToggleConfigCollapsed}
          aria-label={isConfigCollapsed ? 'Show configuration panel' : 'Hide configuration panel'}
          aria-pressed={!isConfigCollapsed}
        >
          <i aria-hidden="true" className="bi bi-gear" />
        </button>
      </header>
      <main className={`app-main view-${activeView}${isConfigCollapsed ? ' config-collapsed' : ''}`}>
        <section className="workspace-column">
          {isComposeView ? (
            <div className="compose-layout" ref={composeLayoutRef}>
              <div className="compose-main" style={leftPaneStyle} id="compose-controls-pane">
                <div className="panel compose-card">
                  <div className="panel-header">
                    <div>
                      <h2>Compose Briefing</h2>
                      <p>Write a single prompt, then generate talking points.</p>
                    </div>
                  </div>
                  <div className="panel-body">
                    <label className="field-group">
                      <span className="field-label">Briefing Prompt</span>
                      <textarea
                        value={config.prompt}
                        onChange={(event) => handleConfigChange({ prompt: event.target.value })}
                        rows={4}
                        spellCheck={false}
                        placeholder="Topics, key questions, or priorities for this briefing."
                      />
                    </label>
                  </div>
                  <div className="panel-footer compose-actions">
                    <div className="button-group">
                      <button
                        type="button"
                        className="primary"
                        onClick={handleCreateBriefing}
                        disabled={!canGenerateBriefing || isCreatingBriefing}
                      >
                        {isCreatingBriefing ? 'Generating…' : 'Generate Talking Points'}
                      </button>
                    </div>
                  </div>
                  <div className="source-summary">
                    <span>{totalSourceCount} source{totalSourceCount === 1 ? '' : 's'} loaded</span>
                    {progress.total > 0 && (
                      <span>{progress.loaded}/{progress.total} items processed</span>
                    )}
                    <span>{selectedCount} selected for evidence</span>
                    {resolvedDateRange && (
                      <span>
                        Window: {resolvedDateRange.start} → {resolvedDateRange.end}
                      </span>
                    )}
                  </div>
                </div>
                <FeedbackPanel
                  briefing={briefing}
                  onRegenerate={handleReviseBriefing}
                  isRegenerating={isRevisingBriefing}
                  onOpenEvidence={handleOpenEvidence}
                  selectedCount={selectedCount}
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
                <EmailPreview
                  briefing={briefing}
                  htmlContent={formattedEmail}
                  status={status}
                />
                <div className="panel status-panel" data-status={status}>
                  <h3>Workflow Status</h3>
                  <p className="status-label-text">{statusLabels[status] || 'Status'}</p>
                  <p className="status-message-text">{statusMessage}</p>
                  {error && (
                    <div className="error-banner compact">
                      <strong>{errorStage ? `${errorStage} error:` : 'Error:'}</strong> {error}
                    </div>
                  )}
                  <button type="button" className="secondary" onClick={handleOpenEvidence} disabled={!selectedCount}>
                    View Evidence ({selectedCount})
                  </button>
                </div>
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
                isFetching={isFetching}
                isIngesting={isIngesting}
                isRunningAi={isAiBusy}
                hasEnabledSource={hasEnabledSource}
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
        open={isComposeView && isEvidenceOpen}
        onClose={handleCloseEvidence}
        sources={evidenceSources}
        statusMessage={`${selectedCount} source${selectedCount === 1 ? '' : 's'} supporting these talking points.`}
      />
    </div>
  )
}

export default App
