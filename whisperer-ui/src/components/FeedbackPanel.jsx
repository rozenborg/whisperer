import { useEffect, useState, useMemo } from 'react'

function FeedbackPanel({ briefing, onRegenerate, isRegenerating, onOpenEvidence, selectedCount = 0 }) {
  const [feedback, setFeedback] = useState('')
  const [pinned, setPinned] = useState([])
  const [excluded, setExcluded] = useState([])
  const hasBriefing = useMemo(() => !!briefing && Array.isArray(briefing.points), [briefing])
  const canOpenEvidence = typeof onOpenEvidence === 'function' && selectedCount > 0

  useEffect(() => {
    setFeedback('')
    setPinned([])
    setExcluded([])
  }, [hasBriefing])

  const togglePin = (point) => {
    setPinned((prev) => {
      const exists = prev.find((p) => p.url === point.url)
      if (exists) return prev.filter((p) => p.url !== point.url)
      return [...prev, point]
    })
  }

  const toggleExclude = (point) => {
    setExcluded((prev) => {
      const exists = prev.includes(point.url)
      if (exists) return prev.filter((u) => u !== point.url)
      return [...prev, point.url]
    })
  }

  const handleRegenerate = () => {
    if (typeof onRegenerate !== 'function') return
    onRegenerate({ feedback, pinnedPoints: pinned, droppedUrls: excluded })
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h2>Feedback & Regenerate</h2>
          <p>Provide feedback, pin or exclude points, then regenerate.</p>
        </div>
        {canOpenEvidence && (
          <button type="button" className="secondary subtle" onClick={onOpenEvidence}>
            View {selectedCount} Source{selectedCount === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {!hasBriefing ? (
        <div className="empty-state">
          <p>No talking points yet. Generate to begin.</p>
        </div>
      ) : (
        <div>
          <div className="feedback-badges" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <small>Click a point to Pin/Exclude:</small>
          </div>
          <ol style={{ paddingLeft: 16, marginBottom: 12 }}>
            {briefing.points.map((p, idx) => {
              const isPinned = pinned.some((x) => x.url === p.url)
              const isExcluded = excluded.includes(p.url)
              return (
                <li key={p.url ?? idx} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong>{p.title || `Point ${idx + 1}`}</strong>
                    <span style={{ fontSize: 12, color: '#6b7280' }}>{p.type}</span>
                    <button type="button" className={`chip ${isPinned ? 'selected' : ''}`} onClick={() => togglePin(p)}>
                      {isPinned ? 'Pinned' : 'Pin'}
                    </button>
                    <button type="button" className={`chip ${isExcluded ? 'selected' : ''}`} onClick={() => toggleExclude(p)}>
                      {isExcluded ? 'Excluded' : 'Exclude'}
                    </button>
                  </div>
                  {p.insight && <div style={{ color: '#374151', marginTop: 4 }}>{p.insight}</div>}
                </li>
              )
            })}
          </ol>

          <label className="field-group" style={{ marginTop: 8 }}>
            <span className="field-label">Your feedback</span>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={4}
              spellCheck={false}
              placeholder="Tone, focus, exclusions, extra emphasis, formatting notes..."
            />
          </label>
          <button
            type="button"
            className="secondary"
            onClick={handleRegenerate}
            disabled={isRegenerating}
          >
            {isRegenerating ? 'Regenerating…' : 'Regenerate with Feedback'}
          </button>
        </div>
      )}
    </div>
  )
}

export default FeedbackPanel

