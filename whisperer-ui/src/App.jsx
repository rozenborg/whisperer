import { useEffect, useMemo, useState } from 'react'
import ConfigPanel from './components/ConfigPanel.jsx'
import SourcesTable from './components/SourcesTable.jsx'
import EmailPreview from './components/EmailPreview.jsx'
import OutlinePanel from './components/OutlinePanel.jsx'
import EvidenceDrawer from './components/EvidenceDrawer.jsx'
import { fetchAllSources } from './services/fetchSources.js'
import { curateWithClaude, generateBriefing } from './services/claudeAPI.js'
import { formatEmailHtml } from './services/emailFormatter.js'
import { ingestSources as ingestToBackend, createReport, finalizeReport, listSources, deleteSource as deleteSourceFromBackend } from './services/backend.js'

const MAX_PER_RUN = Number(import.meta.env.VITE_MAX_SOURCES_PER_RUN || 42)
const CONFIG_PERSIST_KEY = 'whisperer-config-v2'
const LEGACY_SOURCE_PERSIST_KEY = 'whisperer-source-selection'
const personaPresets = [
  'Fortune 100 Executive',
  'Growth-Stage Founder',
  'Chief Strategy Officer',
  'Head of Innovation',
]

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
const initialConfig = {
  persona: 'Fortune 100 Executive',
  focusAreas: 'Fintech, Enterprise AI, Regulatory',
  dateRange: 7,
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
  idle: 'Ready to fetch sources',
  fetching: 'Fetching sources...',
  fetched: 'Sources ready for AI curation.',
  curating: 'AI is curating...',
  generating: 'Generating briefing...',
  done: 'Briefing ready to send',
}

function App() {
  const [config, setConfig] = useState(initialConfig)
  const [status, setStatus] = useState('idle')
  const [statusMessage, setStatusMessage] = useState(statusLabels.idle)
  const [progress, setProgress] = useState({ loaded: 0, total: 0 })
  const [sources, setSources] = useState([])
  const [briefing, setBriefing] = useState(null)
  const [outline, setOutline] = useState(null)
  const [reportMeta, setReportMeta] = useState(null) // { id, selectedUrls }
  const [error, setError] = useState(null)
  const [errorStage, setErrorStage] = useState(null)
  const [isFetching, setIsFetching] = useState(false)
  const [isRunningAi, setIsRunningAi] = useState(false)
  const [isIngesting, setIsIngesting] = useState(false)
  const [isCreatingReport, setIsCreatingReport] = useState(false)
  const [isFinalizing, setIsFinalizing] = useState(false)
  const [isConfigCollapsed, setIsConfigCollapsed] = useState(true)
  const [configSaveMessage, setConfigSaveMessage] = useState('')
  const [activeView, setActiveView] = useState('compose')
  const [isEvidenceOpen, setIsEvidenceOpen] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(CONFIG_PERSIST_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (parsed && typeof parsed === 'object') {
          setConfig((previous) => {
            const nextDateRange = Number(parsed.dateRange)
            return {
              ...previous,
              persona:
                typeof parsed.persona === 'string' && parsed.persona.trim()
                  ? parsed.persona
                  : previous.persona,
              focusAreas:
                typeof parsed.focusAreas === 'string' && parsed.focusAreas.trim()
                  ? parsed.focusAreas
                  : previous.focusAreas,
              dateRange:
                Number.isFinite(nextDateRange) && nextDateRange > 0
                  ? nextDateRange
                  : previous.dateRange,
              podcastProvider: parsed.podcastProvider || previous.podcastProvider,
              sources: {
                ...previous.sources,
                ...(parsed.sources && typeof parsed.sources === 'object' ? parsed.sources : {}),
              },
            }
          })
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
        const resp = await listSources({ sinceDays: 365, limit: 500 })
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
  }, [])

  useEffect(() => {
    if (!isEvidenceOpen) return
    const hasSelected = sources.some((item) => item && item.selected)
    if (!hasSelected) setIsEvidenceOpen(false)
  }, [isEvidenceOpen, sources])

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

  const handleFetchSources = async () => {
    if (!hasEnabledSource || isFetching || isRunningAi) return

    setIsFetching(true)
    setStatus('fetching')
    setStatusMessage(statusLabels.fetching)
    setProgress({ loaded: 0, total: 0 })
    setError(null)
    setErrorStage(null)
    setBriefing(null)
    setOutline(null)
    setReportMeta(null)

    try {
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
      setStatus('fetched')
      setStatusMessage(statusLabels.fetched)
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
    if (!hasEnabledSource || isFetching || isRunningAi || isIngesting) return

    setIsIngesting(true)
    setStatus('fetching')
    setStatusMessage(`Fetching sources for database update (up to ${MAX_PER_RUN})...`)
    setProgress({ loaded: 0, total: 0 })
    setError(null)
    setErrorStage(null)
    setBriefing(null)
    setOutline(null)
    setReportMeta(null)

    try {
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
      setStatus('fetched')
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
        setStatusMessage('Source removed from outline and database.')
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

  const handleCreateReport = async () => {
    if (isCreatingReport || isFetching || isRunningAi) return
    setIsCreatingReport(true)
    setError(null)
    setErrorStage(null)
    setStatus('curating')
    setStatusMessage('Curating and drafting outline...')
    setOutline(null)
    setBriefing(null)
    try {
      const resp = await createReport({ persona: config.persona, request: config.focusAreas, sinceDays: config.dateRange, limit: MAX_PER_RUN })
      if (!resp?.ok) throw new Error('Report creation failed')
      setOutline({ items: resp.outline, reasoning: resp.reasoning })
      setReportMeta({ id: resp.id, selectedUrls: resp.selectedUrls || [], selectedIds: resp.selectedIds || [] })
      setStatus('fetched')
      setStatusMessage('Outline ready. Review and provide feedback.')
    } catch (e) {
      console.error(e)
      setError(e.message || 'Report creation failed')
      setErrorStage('report')
      setStatus('idle')
      setStatusMessage('Report step failed. Try again.')
    } finally {
      setIsCreatingReport(false)
    }
  }

  const handleFinalizeReport = async (feedbackText) => {
    if (!reportMeta?.id || isFinalizing) return
    setIsFinalizing(true)
    setStatus('generating')
    setStatusMessage('Generating talking points...')
    setError(null)
    setErrorStage(null)
    try {
      const resp = await finalizeReport({ id: reportMeta.id, persona: config.persona, feedback: feedbackText, selectedIds: reportMeta?.selectedIds || [] })
      if (!resp?.ok) throw new Error('Finalize failed')
      setBriefing({ ...resp.briefing, generatedAt: new Date().toISOString(), reasoning: outline?.reasoning })
      setStatus('done')
      setStatusMessage('Briefing ready to send')
    } catch (e) {
      console.error(e)
      setError(e.message || 'Finalize failed')
      setErrorStage('finalize')
      setStatus('fetched')
      setStatusMessage('Finalize failed. Update feedback and retry.')
    } finally {
      setIsFinalizing(false)
    }
  }

  const handleGenerateBriefing = async () => {
    if (isRunningAi || isFetching) return

    const successfulSources = sources.filter((item) => !item.error)
    if (!successfulSources.length) {
      setError('Fetch sources before running AI curation.')
      setErrorStage('fetch')
      return
    }

    setIsRunningAi(true)
    setStatus('curating')
    setStatusMessage(statusLabels.curating)
    setError(null)
    setErrorStage(null)

    try {
      const { selectedIds, reasoning } = await curateWithClaude(successfulSources, {
        config,
      })

      const curatedSources = sources.map((source) => ({
        ...source,
        selected: selectedIds.includes(source.id),
      }))
      setSources(curatedSources)

      if (!selectedIds.length) {
        setStatus('fetched')
        setStatusMessage('AI did not select any sources. Review fetched items.')
        setBriefing({
          summary:
            'AI did not select any sources. Review the fetched items and adjust the configuration before retrying.',
          points: [],
          generatedAt: new Date().toISOString(),
          reasoning,
        })
        return
      }

      setStatus('generating')
      setStatusMessage(statusLabels.generating)

      const selectedSources = curatedSources.filter(
        (item) => item.selected && !item.error,
      )

      const briefingPayload = await generateBriefing({
        selectedSources,
        config,
        reasoning,
      })

      setBriefing(briefingPayload)
      setStatus('done')
      setStatusMessage(statusLabels.done)
      setErrorStage(null)
    } catch (caught) {
      console.error(caught)
      setError(formatAiError(caught))
      setErrorStage('ai')
      setStatus('fetched')
      setStatusMessage('AI step failed. Review the message below and run Generate again.')
    } finally {
      setIsRunningAi(false)
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

  const formattedEmail = briefing ? formatEmailHtml(config, briefing) : ''

  function formatAiError(caught) {
    const baseMessage = caught?.message || 'Unexpected error during AI generation.'

    if (/invalid\s+x-api-key/i.test(baseMessage)) {
      return `${baseMessage}. Double-check ANTHROPIC_API_KEY in your environment, then restart the dev server.`
    }

    if (/401/.test(baseMessage)) {
      return `${baseMessage}. The Anthropic API rejected the credentials. Refresh your key and try again.`
    }

    if (/429/.test(baseMessage)) {
      return `${baseMessage}. Anthropic is rate limiting requests—wait a few seconds before retrying.`
    }

    return `${baseMessage} Review your Anthropic configuration and retry.`
  }

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
            <div className="compose-layout">
              <div className="compose-main">
                <div className="panel compose-card">
                  <div className="panel-header">
                    <div>
                      <h2>Compose Briefing</h2>
                      <p>Describe your audience and focus, then generate an outline.</p>
                    </div>
                    <span className={`status-chip status-${status}`}>{statusLabels[status] || 'Status'}</span>
                  </div>
                  <div className="panel-body">
                    <label className="field-group">
                      <span className="field-label">Executive Persona</span>
                      <input
                        type="text"
                        value={config.persona}
                        onChange={(event) => handleConfigChange({ persona: event.target.value })}
                        list="persona-presets"
                        placeholder="Who will receive this briefing?"
                      />
                      <datalist id="persona-presets">
                        {personaPresets.map((persona) => (
                          <option key={persona} value={persona} />
                        ))}
                      </datalist>
                    </label>

                    <label className="field-group">
                      <span className="field-label">Focus / Prompt</span>
                      <textarea
                        value={config.focusAreas}
                        onChange={(event) => handleConfigChange({ focusAreas: event.target.value })}
                        rows={4}
                        spellCheck={false}
                        placeholder="Topics, key questions, or priorities for this briefing."
                      />
                    </label>

                    <label className="field-group inline">
                      <span className="field-label">Lookback window</span>
                      <div className="inline-input">
                        <input
                          type="number"
                          min={1}
                          value={config.dateRange}
                          onChange={(event) => {
                            const next = Number(event.target.value)
                            handleConfigChange({ dateRange: Number.isFinite(next) && next > 0 ? next : 1 })
                          }}
                          aria-label="Date range in days"
                        />
                        <span className="suffix">days</span>
                      </div>
                    </label>
                  </div>
                  <div className="panel-footer compose-actions">
                    <div className="button-group">
                      <button
                        type="button"
                        className="primary"
                        onClick={handleCreateReport}
                        disabled={isCreatingReport || isRunningAi}
                      >
                        {isCreatingReport ? 'Drafting Outline…' : 'Generate Outline'}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={handleGenerateBriefing}
                        disabled={!canGenerateBriefing || isRunningAi}
                      >
                        {isRunningAi ? 'Running AI…' : 'Generate Briefing'}
                      </button>
                    </div>
                    <div className="button-group">
                      <button
                        type="button"
                        className="ghost"
                        onClick={handleFetchSources}
                        disabled={!hasEnabledSource || isFetching || isRunningAi}
                      >
                        {isFetching ? 'Fetching…' : 'Refresh Sources'}
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={handleIngestToLibrary}
                        disabled={!hasEnabledSource || isFetching || isRunningAi || isIngesting}
                      >
                        {isIngesting ? 'Updating…' : 'Update Database'}
                      </button>
                    </div>
                  </div>
                  <div className="status-hint" data-status={status}>
                    <span className="status-dot" />
                    <span>{statusMessage}</span>
                  </div>
                  <div className="source-summary">
                    <span>{totalSourceCount} source{totalSourceCount === 1 ? '' : 's'} loaded</span>
                    {progress.total > 0 && (
                      <span>{progress.loaded}/{progress.total} items processed</span>
                    )}
                    <span>{selectedCount} selected for outline</span>
                  </div>
                </div>

                <OutlinePanel
                  outline={outline?.items}
                  reasoning={outline?.reasoning}
                  onFinalize={handleFinalizeReport}
                  isFinalizing={isFinalizing}
                  disabled={!outline?.items}
                  onOpenEvidence={handleOpenEvidence}
                  selectedCount={selectedCount}
                />
              </div>
              <div className="compose-side">
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
                  <button
                    type="button"
                    className="secondary"
                    onClick={handleOpenEvidence}
                    disabled={!selectedCount}
                  >
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
                onFetchSources={handleFetchSources}
                onUpdateDatabase={handleIngestToLibrary}
                onRemoveSource={handleRemoveSource}
                isFetching={isFetching}
                isIngesting={isIngesting}
                isRunningAi={isRunningAi}
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
        statusMessage={`${selectedCount} source${selectedCount === 1 ? '' : 's'} supporting this outline.`}
      />
    </div>
  )
}

export default App
