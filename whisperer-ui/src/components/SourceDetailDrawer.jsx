function SourceDetailDrawer({
  open,
  source,
  detail,
  statusMessage,
  onClose,
  onFetchFullContent,
  isFetching,
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
      <div className="article-content">
        <p style={{ whiteSpace: 'pre-wrap' }}>{content}</p>
      </div>
    </aside>
  )
}

export default SourceDetailDrawer
