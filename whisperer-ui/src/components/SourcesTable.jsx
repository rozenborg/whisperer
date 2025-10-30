import React from 'react'

function SourcesTable({
  sources,
  status,
  progress,
  error,
  errorStage,
  onUpdateDatabase,
  onRemoveSource,
  onViewSource,
  onToggleStar,
  onToggleHide,
  isFetching,
  isIngesting,
  isRunningAi,
  hasEnabledSource,
  pendingStarIds = new Set(),
  pendingHideIds = new Set(),
  sourceNotes = new Map(),
  noteLoadingIds = new Set(),
  enrichedContent = {},
}) {
  const [expandedRowIds, setExpandedRowIds] = React.useState(new Set())
  const [expandedPointIds, setExpandedPointIds] = React.useState(new Set())
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

  const handleToggleExpanded = (sourceId) => {
    setExpandedRowIds((prev) => {
      const next = new Set(prev)
      if (next.has(sourceId)) {
        next.delete(sourceId)
      } else {
        next.add(sourceId)
      }
      return next
    })
  }

  const handleTogglePointExpanded = (pointKey) => {
    setExpandedPointIds((prev) => {
      const next = new Set(prev)
      if (next.has(pointKey)) {
        next.delete(pointKey)
      } else {
        next.add(pointKey)
      }
      return next
    })
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

    const numericId = Number(source.id)
    const canDelete = Number.isInteger(numericId) && numericId > 0
    const isStarred = Boolean(source.starredAt || source.starred)
    const isStarPending = pendingStarIds instanceof Set ? pendingStarIds.has(numericId) : false
    const isHidden = Boolean(source.hiddenAt || source.hidden)
    const isHidePending = pendingHideIds instanceof Set ? pendingHideIds.has(numericId) : false
    const isExpanded = expandedRowIds.has(source.id)
    const isNoteLoading = noteLoadingIds.has(numericId)
    const note = sourceNotes.get(numericId)
    const content = enrichedContent[numericId]

    const handleDelete = () => {
      if (!canDelete) return
      if (typeof onRemoveSource === 'function') {
        onRemoveSource(source)
      }
    }

    const handleStarClick = async () => {
      await onToggleStar?.(source, !isStarred)
      // Auto-expand when starring
      if (!isStarred && !isExpanded) {
        handleToggleExpanded(source.id)
      }
    }

    const rows = [
      <tr key={source.id} data-selected={source.selected ? 'true' : 'false'} className={`${isHidden ? 'row-hidden' : ''}${isExpanded ? ' row-expanded' : ''}`}>
        <td>
          <a href={source.url} target="_blank" rel="noreferrer">
            {source.title}
          </a>
          {source.selected && <span className="chip selected">Selected</span>}
        </td>
        <td>{source.source}</td>
        <td>{readableDate}</td>
        <td className="actions-cell">
          <button
            type="button"
            className={`icon-button${isStarred ? ' enriched' : ''}`}
            onClick={handleStarClick}
            disabled={isStarPending || isRunningAi}
            aria-pressed={isStarred}
            title={isStarred && isExpanded ? 'Collapse talking points' : isStarred ? 'Expand talking points' : 'Enrich with talking points'}
          >
            <i className={`bi ${isStarred && isExpanded ? 'bi-patch-minus-fill' : isStarred ? 'bi-patch-plus-fill' : 'bi-patch-plus'}`} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`icon-button${isHidden ? ' hidden' : ''}`}
            onClick={() => onToggleHide?.(source, !isHidden)}
            disabled={isHidePending || isRunningAi}
            aria-pressed={isHidden}
            title={isHidden ? 'Hidden source (click to unhide)' : 'Hide source from AI selection'}
          >
            <i className={`bi ${isHidden ? 'bi-eye-slash-fill' : 'bi-eye-slash'}`} aria-hidden="true" />
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
    ]

    // Add expanded content row if starred and expanded
    if (isStarred && isExpanded) {
      rows.push(
        <tr key={`${source.id}-expanded`} className="source-expanded-row">
          <td colSpan={4}>
            <div className="source-expanded-content">
              {isNoteLoading ? (
                <div className="source-loading">
                  <p className="muted">Generating talking points...</p>
                </div>
              ) : (
                <>
                  {/* Content Summary */}
                  {content && (
                    <div className="source-summary-section">
                      <h4>Summary</h4>
                      <p>{content.excerpt || content.contentText?.slice(0, 300) || source.description || 'No content available.'}</p>
                    </div>
                  )}

                  {/* Talking Points */}
                  {note && Array.isArray(note.points) && note.points.length > 0 ? (
                    <div className="source-talking-points-section">
                      <h4>Talking Points</h4>
                      <ul className="source-talking-points-list">
                        {note.points.map((point, index) => {
                          const pointKey = `${source.id}-point-${index}`
                          const isPointExpanded = expandedPointIds.has(pointKey)
                          return (
                            <li key={pointKey} className="talking-point-item">
                              <button
                                type="button"
                                className="talking-point-hook"
                                onClick={() => handleTogglePointExpanded(pointKey)}
                              >
                                <i className={`bi ${isPointExpanded ? 'bi-chevron-down' : 'bi-chevron-right'}`} />
                                <span>{point.hook}</span>
                              </button>
                              {isPointExpanded && (
                                <div className="talking-point-details">
                                  <p className="point-insight">{point.insight}</p>
                                  <p className="point-implication">{point.implication}</p>
                                  {Array.isArray(point.supportingFacts) && point.supportingFacts.length > 0 && (
                                    <ul className="point-facts">
                                      {point.supportingFacts.map((fact, factIndex) => (
                                        <li key={factIndex}>{fact}</li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  ) : (
                    !isNoteLoading && (
                      <div className="source-no-points">
                        <p className="muted">No talking points generated yet.</p>
                      </div>
                    )
                  )}
                </>
              )}
            </div>
          </td>
        </tr>
      )
    }

    return rows
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
            <tbody>{sources.map((source) => renderRow(source)).flat()}</tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default SourcesTable
