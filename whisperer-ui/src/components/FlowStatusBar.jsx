function FlowStatusBar({
  stats = {},
  filteredCount,
  talkingPointsCount,
  savedPointsCount,
  statusLabel,
}) {
  const items = [
    { key: 'sources', label: 'Sources', value: stats.totalSources ?? 0 },
    { key: 'enriched', label: 'Enriched', value: stats.enrichedSources ?? 0 },
    { key: 'filtered', label: 'Filtered', value: filteredCount ?? 0 },
    { key: 'points', label: 'Generated', value: talkingPointsCount ?? 0 },
    {
      key: 'saved',
      label: 'Saved Points',
      value: savedPointsCount ?? stats.totalTalkingPoints ?? 0,
    },
  ]
  const currentLabel = statusLabel || 'Status'

  return (
    <div className="flow-status-bar" role="group" aria-label="Pipeline status">
      <nav className="flow-status-items" aria-label="Pipeline counts">
        {items.map((item, index) => (
          <div key={item.key} className="flow-status-segment" aria-label={`${item.label}: ${item.value}`}>
            <span className="flow-status-value">{item.value}</span>
            <span className="flow-status-label">{item.label}</span>
            {index < items.length - 1 && (
              <i className="bi bi-arrow-right-short flow-status-arrow" aria-hidden="true" />
            )}
          </div>
        ))}
      </nav>
      <div className="flow-status-current" aria-label="Current status">
        <span className="flow-status-current-label">{currentLabel}</span>
      </div>
    </div>
  )
}

export default FlowStatusBar
