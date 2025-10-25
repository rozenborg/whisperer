function SourcesTable({
  sources,
  status,
  progress,
  error,
  errorStage,
  onUpdateDatabase,
  onRemoveSource,
  isFetching,
  isIngesting,
  isRunningAi,
  hasEnabledSource,
}) {
  const progressLabel =
    progress.total > 0
      ? `Loaded ${progress.loaded} of ~${progress.total}`
      : `Loaded ${sources.length}`

  const statusCopy = {
    idle: 'Click Add Sources to pull the latest items into your library.',
    fetching: 'Adding sources. Items will appear here as they load.',
    fetched: 'Sources updated. Run AI to curate and build the briefing.',
    curating: 'AI is selecting the most relevant sources.',
    generating: 'Building the executive briefing.',
    done: 'Review the selected sources before sending the email.',
  }

  const updateDisabled = !hasEnabledSource || isFetching || isRunningAi || isIngesting

  const renderRow = (source) => {
    if (source.error) {
      return (
        <tr key={source.id} className="row-error">
          <td colSpan={5}>
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

    return (
      <tr key={source.id} data-selected={source.selected ? 'true' : 'false'}>
        <td>
          <a href={source.url} target="_blank" rel="noreferrer">
            {source.title}
          </a>
        </td>
        <td>{source.source}</td>
        <td>{readableDate}</td>
        <td>{source.selected ? 'Selected' : '—'}</td>
        <td className="actions-cell">
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
                <th>AI</th>
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
