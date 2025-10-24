import { useMemo } from 'react'
import { SOURCE_METADATA } from '../services/fetchSources.js'

const personaPresets = [
  'Fortune 100 Executive',
  'Growth-Stage Founder',
  'Chief Strategy Officer',
  'Head of Innovation',
]

function ConfigPanel({
  config,
  onConfigChange,
  onToggleSource,
  onSelectAllSources,
  onSelectNoneSources,
  onFetchSources,
  onGenerateBriefing,
  onIngestToLibrary,
  onCreateReport,
  isFetching,
  isRunningAi,
  isIngesting,
  isCreatingReport,
  hasEnabledSource,
  canGenerateBriefing,
  briefingReady,
  onSendEmail,
  status,
  statusMessage,
}) {
  const groupedSources = useMemo(() => {
    const groups = {
      podcasts: { label: 'Podcasts', items: [] },
      feeds: { label: 'News & Research', items: [] },
    }

    Object.entries(config.sources).forEach(([key, settings]) => {
      const metadata = SOURCE_METADATA[key]
      const bucket = metadata?.type === 'Podcast' ? 'podcasts' : 'feeds'
      groups[bucket].items.push({ key, settings, metadata })
    })

    return Object.values(groups)
      .map((group) => ({
        ...group,
        items: group.items.sort((a, b) => a.settings.label.localeCompare(b.settings.label)),
      }))
      .filter((group) => group.items.length)
  }, [config.sources])

  const handlePersonaChange = (event) => {
    onConfigChange({ persona: event.target.value })
  }

  const handleFocusAreasChange = (event) => {
    onConfigChange({ focusAreas: event.target.value })
  }

  const handleDateRangeChange = (event) => {
    const value = Number(event.target.value) || 0
    onConfigChange({ dateRange: Math.max(value, 1) })
  }

  const handlePodcastProviderChange = (event) => {
    onConfigChange({ podcastProvider: event.target.value })
  }

  const fetchDisabled = !hasEnabledSource || isFetching || isRunningAi || isIngesting
  const ingestDisabled = !hasEnabledSource || isFetching || isRunningAi || isIngesting
  const reportDisabled = isCreatingReport || isRunningAi
  const generateDisabled = !canGenerateBriefing || isRunningAi
  const sendDisabled = !briefingReady

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Configuration</h2>
        <p>Set your preferences, then work through each step to build the briefing.</p>
      </div>

      <label className="field-group">
        <span className="field-label">Executive Persona</span>
        <select value={config.persona} onChange={handlePersonaChange}>
          {personaPresets.map((persona) => (
            <option key={persona} value={persona}>
              {persona}
            </option>
          ))}
        </select>
      </label>

      <label className="field-group">
        <span className="field-label">Podcast Source</span>
        <select
          value={config.podcastProvider ?? 'itunes'}
          onChange={handlePodcastProviderChange}
        >
          <option value="itunes">Apple Podcasts Search (default)</option>
          <option value="listenNotes">Listen Notes API (backup; key)</option>
        </select>
        <p className="helper-text">
          Defaults to Apple Podcasts (free). Falls back to Listen Notes when needed.
        </p>
      </label>

      <label className="field-group">
        <span className="field-label">Focus Areas (comma separated)</span>
        <textarea
          value={config.focusAreas}
          onChange={handleFocusAreasChange}
          rows={3}
          spellCheck={false}
        />
      </label>

      <label className="field-group inline">
        <span className="field-label">Date Range</span>
        <div className="inline-input">
          <input
            type="number"
            min={1}
            value={config.dateRange}
            onChange={handleDateRangeChange}
            aria-label="Date range in days"
          />
          <span className="suffix">days</span>
        </div>
      </label>

      <div className="field-group">
        <div className="field-label-row">
          <span className="field-label">Sources</span>
          <div className="source-actions">
            <button type="button" onClick={onSelectAllSources}>
              Select all
            </button>
            <span aria-hidden="true">·</span>
            <button type="button" onClick={onSelectNoneSources}>
              Select none
            </button>
          </div>
        </div>
        <div className="source-groups">
          {groupedSources.map((group) => (
            <div key={group.label} className="source-group">
              <span className="source-group-title">{group.label}</span>
              <div className="source-list">
                {group.items.map(({ key, settings }) => (
                  <label key={key} className="source-item">
                    <input
                      type="checkbox"
                      checked={settings.enabled}
                      onChange={() => onToggleSource(key)}
                    />
                    <span>{settings.label}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <button
        type="button"
        className="primary"
        onClick={onFetchSources}
        disabled={fetchDisabled}
      >
        {isFetching ? 'Fetching…' : 'Fetch Sources'}
      </button>

      <button
        type="button"
        className="secondary"
        onClick={onIngestToLibrary}
        disabled={ingestDisabled}
      >
        {isIngesting ? 'Updating…' : 'Update Database (up to 42)'}
      </button>

      <button
        type="button"
        className="secondary"
        onClick={onCreateReport}
        disabled={reportDisabled}
      >
        {isCreatingReport ? 'Drafting Outline…' : 'Create Report (Outline)'}
      </button>

      <button
        type="button"
        className="secondary"
        onClick={onGenerateBriefing}
        disabled={generateDisabled}
      >
        {isRunningAi ? 'Running AI…' : 'Generate Briefing'}
      </button>

      <button
        type="button"
        className="ghost"
        onClick={onSendEmail}
        disabled={sendDisabled}
      >
        Send Briefing via Email (coming soon)
      </button>

      {!hasEnabledSource && (
        <p className="helper-text">
          Enable at least one source to activate the fetch button.
        </p>
      )}

      <div className="status-hint" data-status={status}>
        <span className="status-dot" />
        <span>{statusMessage}</span>
      </div>
    </div>
  )
}

export default ConfigPanel
