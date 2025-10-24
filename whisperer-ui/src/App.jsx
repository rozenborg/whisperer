import { useEffect, useMemo, useState } from 'react'
import ConfigPanel from './components/ConfigPanel.jsx'
import SourcesTable from './components/SourcesTable.jsx'
import EmailPreview from './components/EmailPreview.jsx'
import { fetchAllSources } from './services/fetchSources.js'
import { curateWithClaude, generateBriefing } from './services/claudeAPI.js'
import { formatEmailHtml } from './services/emailFormatter.js'
import { ingestSources as ingestToBackend, createReport, finalizeReport } from './services/backend.js'
import OutlinePanel from './components/OutlinePanel.jsx'

const MAX_PER_RUN = Number(import.meta.env.VITE_MAX_SOURCES_PER_RUN || 42)
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
    tavily: { enabled: true, max: 5, label: 'Tavily News Search (5 items)' },
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

const SOURCE_PERSIST_KEY = 'whisperer-source-selection'

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

  const handleFetchSources = async () => {
    if (!hasEnabledSource || isFetching || isRunningAi) return

    setIsFetching(true)
    setStatus('fetching')
    setStatusMessage(statusLabels.fetching)
    setProgress({ loaded: 0, total: 0 })
    setError(null)
    setErrorStage(null)
    setSources([])
    setBriefing(null)
    setOutline(null)
    setReportMeta(null)

    try {
      const allSources = await fetchAllSources(config, {
        onBatch: (batch) => {
          setSources((previous) => [...previous, ...batch])
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

      setSources(allSources)
      setProgress({ loaded: allSources.length, total: allSources.length })
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
    setSources([])
    setBriefing(null)
    setOutline(null)
    setReportMeta(null)

    try {
      const allSources = await fetchAllSources(config, {
        onBatch: (batch) => setSources((prev) => [...prev, ...batch]),
        onProgress: (p) => setProgress(p),
        onStatus: (m) => setStatusMessage(m),
      })

      const successful = allSources.filter((i) => !i.error)
      // Enforce global cap per run
      const capped = successful.slice(0, MAX_PER_RUN)
      if (!capped.length) throw new Error('No sources fetched to ingest.')

      setStatusMessage(`Ingesting ${capped.length} into database...`)
      const result = await ingestToBackend(capped)
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
  const briefingReady = Boolean(briefing && briefing.points)
  const selectedUrlSet = useMemo(() => new Set(reportMeta?.selectedUrls || []), [reportMeta])
  const displayedSources = useMemo(() =>
    sources.map((s) => ({ ...s, selected: s.selected || selectedUrlSet.has(s.url) })),
  [sources, selectedUrlSet])

  const handleSendEmail = () => {
    setStatus('done')
    setStatusMessage('Email sending coming soon. Copy the HTML preview to share manually.')
  }

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

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SOURCE_PERSIST_KEY)
      if (!stored) return

      const parsed = JSON.parse(stored)
      if (!parsed || typeof parsed !== 'object') return

      setConfig((previous) => ({
        ...previous,
        sources: Object.fromEntries(
          Object.entries(previous.sources).map(([key, settings]) => [
            key,
            {
              ...settings,
              enabled:
                typeof parsed[key] === 'boolean' ? parsed[key] : settings.enabled,
            },
          ]),
        ),
      }))
    } catch (error) {
      console.error('Failed to restore saved sources', error)
    }
  }, [])

  useEffect(() => {
    const enabledMap = Object.fromEntries(
      Object.entries(config.sources).map(([key, settings]) => [key, settings.enabled]),
    )
    try {
      localStorage.setItem(SOURCE_PERSIST_KEY, JSON.stringify(enabledMap))
    } catch (error) {
      console.error('Failed to store sources', error)
    }
  }, [config.sources])

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>Whisperer</h1>
          <p>Generate AI executive briefings in minutes.</p>
        </div>
        <div className="status-block" data-status={status}>
          <span className="status-label">{statusLabels[status] || 'Status'}</span>
          <span className="status-message">{statusMessage}</span>
          {progress.total > 0 && (
            <span className="status-progress">
              {progress.loaded}/{progress.total} items loaded
            </span>
          )}
        </div>
      </header>
      <main className="app-main">
        <section className="layout-column config-column">
          <ConfigPanel
            config={config}
            onConfigChange={handleConfigChange}
            onToggleSource={handleSourceToggle}
            onSelectAllSources={handleSelectAllSources}
            onSelectNoneSources={handleSelectNoneSources}
            onFetchSources={handleFetchSources}
            onGenerateBriefing={handleGenerateBriefing}
            onIngestToLibrary={handleIngestToLibrary}
            onCreateReport={handleCreateReport}
            isFetching={isFetching}
            isRunningAi={isRunningAi}
            isIngesting={isIngesting}
            isCreatingReport={isCreatingReport}
            hasEnabledSource={hasEnabledSource}
            canGenerateBriefing={canGenerateBriefing}
            briefingReady={briefingReady}
            onSendEmail={handleSendEmail}
            status={status}
            statusMessage={statusMessage}
          />
        </section>
        <section className="layout-column content-column">
          <SourcesTable
            sources={displayedSources}
            status={status}
            progress={progress}
            error={error}
            errorStage={errorStage}
          />
          <OutlinePanel
            outline={outline?.items}
            reasoning={outline?.reasoning}
            onFinalize={handleFinalizeReport}
            isFinalizing={isFinalizing}
            disabled={!outline?.items}
          />
          <EmailPreview
            briefing={briefing}
            htmlContent={formattedEmail}
            status={status}
          />
        </section>
      </main>
    </div>
  )
}

export default App
