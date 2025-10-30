function SourceDetailDrawer({
  open,
  source,
  detail,
  statusMessage,
  onClose,
  onFetchFullContent,
  isFetching,
  note,
  isNoteLoading,
  onRefreshNote,
  onSavePoint,
  onSaveAllPoints,
}) {
  if (!open) return null

  const title = source?.title || detail?.title || 'Untitled'
  const sourceName = source?.source || detail?.source || 'Unknown source'
  const url = source?.url || detail?.url || '#'
  const dateValue = source?.date || detail?.published_at || detail?.created_at
  const formattedDate = (() => {
    if (!dateValue) return null
    const parsed = new Date(dateValue)
    if (Number.isNaN(parsed.getTime())) return dateValue
    return parsed.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  })()

  const content = detail?.contentText || detail?.transcriptText || detail?.excerpt || source?.description || 'Full content not cached yet.'
  const showFetchButton = typeof onFetchFullContent === 'function'
  const hasNote = note && Array.isArray(note.points) && note.points.length > 0

  return (
    <aside className="evidence-drawer article-drawer" role="complementary" aria-label="Source detail">
      <div className="evidence-header">
        <div>
          <h2>{sourceName}</h2>
          {statusMessage ? <p>{statusMessage}</p> : null}
        </div>
        <button type="button" className="ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="article-meta">
        <h3>
          <a href={url} target="_blank" rel="noreferrer">
            {title}
          </a>
        </h3>
        {formattedDate && <p className="muted">Published {formattedDate}</p>}
        {showFetchButton && (
          <button
            type="button"
            className="secondary"
            onClick={onFetchFullContent}
            disabled={isFetching}
          >
            {isFetching ? 'Fetching…' : detail?.hasContent ? 'Refresh content' : 'Fetch full content'}
          </button>
        )}
      </div>
      <div className="drawer-scroll">
        <div className="article-content">
          <p>{content}</p>
        </div>
        <div className="source-note-section">
          <div className="source-note-header">
            <h4>AI Talking Points</h4>
            {note?.generatedAt && (
              <span className="muted small-text">
                Generated {new Date(note.generatedAt).toLocaleString()}
            </span>
          )}
          <div className="source-note-actions">
            {typeof onRefreshNote === 'function' && (
              <button
                type="button"
                className="secondary"
                onClick={() => onRefreshNote(source)}
                disabled={isNoteLoading}
              >
                {isNoteLoading ? 'Generating…' : hasNote ? 'Regenerate' : 'Generate'}
              </button>
            )}
            {hasNote && typeof onSaveAllPoints === 'function' && (
              <button
                type="button"
                className="secondary"
                onClick={() => onSaveAllPoints(note.points)}
                disabled={isNoteLoading}
              >
                Save all
              </button>
            )}
          </div>
        </div>
          {isNoteLoading ? (
            <p className="muted">Generating talking points…</p>
          ) : hasNote ? (
            <ul className="source-note-list">
              {note.points.map((point, index) => {
                const tags = Array.isArray(point.tags) ? point.tags : []
              const facts = Array.isArray(point.supportingFacts)
                ? point.supportingFacts.filter(Boolean)
                : []
              const handleSave = () => {
                if (typeof onSavePoint === 'function') {
                  onSavePoint(point)
                }
              }
              return (
                <li key={`${point.hook || 'point'}-${index}`} className="source-note-card">
                  <div className="source-note-head">
                    <span className="source-note-hook">{point.hook}</span>
                    {point.type && <span className="source-note-type">{point.type}</span>}
                  </div>
                  <div className="source-note-body">
                    <p>{point.insight}</p>
                    <p>{point.implication}</p>
                    {facts.length > 0 && (
                      <ul className="source-note-facts">
                        {facts.map((fact, factIndex) => (
                          <li key={`${index}-fact-${factIndex}`}>{fact}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="source-note-footer">
                    <div className="source-note-tags">
                      {tags.map((tag) => (
                        <span key={`${point.hook || index}-${tag}`} className="tag-chip">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="source-note-actions-row">
                      {typeof point.confidence === 'number' && (
                        <span className="note-confidence">Confidence: {(point.confidence * 100).toFixed(0)}%</span>
                      )}
                      <button type="button" className="chip" onClick={handleSave}>
                        Save
                      </button>
                    </div>
                  </div>
                </li>
              )
              })}
            </ul>
          ) : (
            <p className="muted">
              {typeof onRefreshNote === 'function'
                ? 'Star this source or click Generate to produce talking points.'
                : 'Star this source to generate talking points.'}
            </p>
          )}
        </div>
      </div>
    </aside>
  )
}

export default SourceDetailDrawer
