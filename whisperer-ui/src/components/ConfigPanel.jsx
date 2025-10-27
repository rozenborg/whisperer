import { useMemo } from 'react'
import { SOURCE_METADATA } from '../services/fetchSources.js'

function ConfigPanel({
  open,
  onClose,
  config,
  onConfigChange,
  onToggleSource,
  onSelectAllSources,
  onSelectNoneSources,
  onSaveConfig,
  saveMessage,
}) {
  const { grouped, web } = useMemo(() => {
    const groups = {
      podcasts: { label: 'Podcasts', items: [] },
      feeds: { label: 'News & Research', items: [] },
    }
    const webItems = []

    Object.entries(config.sources).forEach(([key, settings]) => {
      const metadata = SOURCE_METADATA[key]
      const displayLabel = metadata?.label || settings.label || key
      if (metadata?.type === 'Web') {
        webItems.push({ key, settings, label: displayLabel })
        return
      }

      const bucket = metadata?.type === 'Podcast' ? 'podcasts' : 'feeds'
      groups[bucket].items.push({ key, settings, label: displayLabel })
    })

    return {
      grouped: Object.values(groups)
        .map((group) => ({
          ...group,
          items: group.items.sort((a, b) => a.label.localeCompare(b.label)),
        }))
        .filter((group) => group.items.length),
      web: webItems.sort((a, b) => a.label.localeCompare(b.label)),
    }
  }, [config.sources])

  const drawerClass = `config-drawer${open ? ' is-open' : ''}`

  const handlePodcastProviderChange = (event) => {
    onConfigChange({ podcastProvider: event.target.value })
  }

  const hasSaveMessage = Boolean(saveMessage)

  return (
    <aside className={drawerClass} aria-hidden={!open} aria-label="Settings panel">
      <div className="config-drawer-inner">
        <header className="config-drawer-header">
          <div>
            <h2>Settings</h2>
            <p>Choose feeds and podcasts, then generate your talking points.</p>
          </div>
          <button type="button" className="config-drawer-close" onClick={onClose} aria-label="Close settings">
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </header>

        <div className="config-drawer-body">
          <section className="config-section">
            <h3>Podcasts</h3>
            <label className="field-group">
              <span className="field-label">Podcast provider</span>
              <select value={config.podcastProvider ?? 'itunes'} onChange={handlePodcastProviderChange}>
                <option value="itunes">Apple Podcasts Search (default)</option>
                <option value="listenNotes">Listen Notes API (backup; key)</option>
              </select>
              <p className="helper-text">Defaults to Apple Podcasts (free). Falls back to Listen Notes when needed.</p>
            </label>
          </section>

          <section className="config-section">
            <h3>Time Range</h3>
            <div className="time-range">
              <label className="field-group">
                <span className="field-label">Start date</span>
                <input
                  type="date"
                  value={config.startDate || ''}
                  onChange={(event) => onConfigChange({ startDate: event.target.value })}
                />
              </label>
              <label className="field-group">
                <span className="field-label">End date</span>
                <input
                  type="date"
                  value={config.endDate || ''}
                  onChange={(event) => onConfigChange({ endDate: event.target.value })}
                />
              </label>
            </div>
            <p className="helper-text">
              Defaults to the last 7 days. Leave end date empty to include today.
            </p>
          </section>

          <section className="config-section">
            <div className="config-section-header">
              <h3>Sources</h3>
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
              {grouped.map((group) => (
                <div key={group.label} className="source-group">
                  <span className="source-group-title">{group.label}</span>
                  <div className="source-list">
                    {group.items.map(({ key, settings, label }) => (
                      <label key={key} className="source-item">
                        <input
                          type="checkbox"
                          checked={settings.enabled}
                          onChange={() => onToggleSource(key)}
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {web.length > 0 && (
            <section className="config-section">
              <h3>Web Searches</h3>
              <p className="helper-text">
                Enable curated web search integrations to broaden coverage. Results may include mixed quality sources.
              </p>
              <div className="source-list">
                {web.map(({ key, settings, label }) => (
                  <label key={key} className="source-item">
                    <input
                      type="checkbox"
                      checked={settings.enabled}
                      onChange={() => onToggleSource(key)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </section>
          )}
        </div>

        <footer className="config-drawer-footer">
          <button type="button" className="primary" onClick={onSaveConfig}>
            {hasSaveMessage ? saveMessage : 'Save Configuration'}
          </button>
        </footer>
      </div>
    </aside>
  )
}

export default ConfigPanel
