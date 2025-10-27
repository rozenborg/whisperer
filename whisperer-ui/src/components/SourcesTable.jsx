function SourcesTable({
  sources,
  status,
  progress,
  error,
  errorStage,
  onUpdateDatabase,
  onRemoveSource,
  onViewSource,
  isFetching,
  isIngesting,
  isRunningAi,
  hasEnabledSource,
}) {
  const progressLabel =
    progress.total > 0
      ? progress.loaded === progress.total
        ? `Loaded ${progress.loaded}`
        : `Loaded ${progress.loaded} of ${progress.total}`
      : `Loaded ${sources.length}`

  const statusCopy = {
    idle: 'Click Add Sources to pull the latest items into your library.',
    fetching: 'Adding sources. Items will appear here as they load.',
    fetched: 'Sources updated. Run AI to curate and draft talking points.',
    curating: 'AI is selecting the most relevant sources.',
    generating: 'Drafting executive talking points.',
    done: 'Review the selected sources supporting your talking points.',
  }

  const updateDisabled = !hasEnabledSource || isFetching || isRunningAi || isIngesting

  const renderRow = (source) => {
    if (source.error) {
      return (
        <tr key={source.id} className="row-error">
          <td colSpan={4}>
            <div className="error-chip">
              <span className="error-source">{source.source}</span>
              <span>{source.error}</span>
            </div>
          </td>
        </tr>
      )
    }

    const readableDate = (() => {
      if (!source.date) return '—'
      const parsed = new Date(source.date)
      return Number.isNaN(parsed.getTime())
        ? source.date
        : parsed.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })
    })()

    const numericId = Number(source.id)
    const canDelete = Number.isInteger(numericId) && numericId > 0

    const handleDelete = () => {
      if (!canDelete) return
      if (typeof onRemoveSource === 'function') {
        onRemoveSource(source)
      }
    }

    const handleView = () => {
      if (typeof onViewSource === 'function') {
        onViewSource(source)
      }
    }

    return (
      <tr key={source.id} data-selected={source.selected ? 'true' : 'false'}>
        <td>
          <a href={source.url} target="_blank" rel="noreferrer">
            {source.title}
          </a>
          {source.selected && <span className="chip selected">Selected</span>}
        </td>
        <td>{source.source}</td>
        <td>{readableDate}</td>
        <td className="actions-cell">
          <button type="button" className="icon-button" onClick={handleView}>
            <i className="bi bi-journal-text" aria-hidden="true" />
            <span className="sr-only">View full article</span>
          </button>
          {canDelete ? (
            <button type="button" className="icon-button danger" onClick={handleDelete}>
              <i className="bi bi-trash" aria-hidden="true" />
              <span className="sr-only">Remove source</span>
            </button>
          ) : (
            <span className="actions-placeholder">—</span>
          )}
        </td>
      </tr>
    )
  }

  return (
    <div className="panel stretch">
      <div className="panel-header">
        <div>
          <h2>Sources</h2>
          <p>{statusCopy[status] ?? statusCopy.idle}</p>
        </div>
        <div className="panel-actions">
          <button
            type="button"
            className="primary"
            onClick={onUpdateDatabase}
            disabled={updateDisabled}
          >
            {isIngesting || isFetching ? 'Adding…' : 'Add Sources'}
          </button>
          <span className="progress-label">{progressLabel}</span>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          {errorStage === 'ai' ? (
            <>
              <strong>AI step failed:</strong> {error}
            </>
          ) : (
            error
          )}
        </div>
      )}

      <div className="table-wrapper">
        {sources.length === 0 ? (
          <div className="empty-state">
            <p>No sources yet.</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Source</th>
                <th>Date</th>
                <th aria-hidden="true" />
              </tr>
            </thead>
            <tbody>{sources.map((source) => renderRow(source))}</tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default SourcesTable
