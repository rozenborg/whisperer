import { useMemo } from 'react'

function EvidenceDrawer({ open, onClose, sources = [], statusMessage }) {
  const visibleSources = useMemo(
    () => sources.filter((item) => item && !item.error),
    [sources],
  )

  if (!open) return null

  return (
    <aside className="evidence-drawer" role="complementary" aria-label="Selected sources">
      <div className="evidence-header">
        <div>
          <h2>Sources & Evidence</h2>
          <p>{statusMessage || `Showing ${visibleSources.length} source${visibleSources.length === 1 ? '' : 's'}.`}</p>
        </div>
        <button type="button" className="ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="evidence-list">
        {visibleSources.length === 0 ? (
          <div className="empty-state">
            <p>No sources selected yet. Generate talking points to see evidence.</p>
          </div>
        ) : (
          visibleSources.map((source) => (
            <article key={source.url || source.id} className="evidence-card">
              <header>
                <span className="evidence-source">{source.source || 'Unknown source'}</span>
                {source.date && (
                  <time dateTime={source.date}>{new Date(source.date).toLocaleDateString()}</time>
                )}
              </header>
              <h3>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title || 'Untitled'}
                </a>
              </h3>
              {source.description && <p>{source.description.slice(0, 220)}</p>}
            </article>
          ))
        )}
      </div>
    </aside>
  )
}

export default EvidenceDrawer
