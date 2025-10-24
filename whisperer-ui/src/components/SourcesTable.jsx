function SourcesTable({ sources, status, progress, error, errorStage }) {
  const progressLabel =
    progress.total > 0
      ? `Loaded ${progress.loaded} of ~${progress.total}`
      : `Loaded ${sources.length}`

  const statusCopy = {
    idle: 'Click Fetch Sources to start pulling the latest updates.',
    fetching: 'Fetching sources. Items will appear here as they load.',
    fetched: 'Sources fetched. Run AI to curate and build the briefing.',
    curating: 'AI is selecting the most relevant sources.',
    generating: 'Building the executive briefing.',
    done: 'Review the selected sources before sending the email.',
  }

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
        <span className="progress-label">{progressLabel}</span>
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
