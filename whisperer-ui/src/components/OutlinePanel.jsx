import { useState, useEffect } from 'react'

function OutlinePanel({ outline, reasoning, onFinalize, isFinalizing, disabled, onOpenEvidence, selectedCount = 0 }) {
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    setFeedback('')
  }, [outline])

  const hasOutline = Array.isArray(outline) && outline.length > 0
  const canOpenEvidence = typeof onOpenEvidence === 'function' && selectedCount > 0

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h2>Draft Outline</h2>
          <p>Review the AI-proposed bullets. Add feedback before finalizing talking points.</p>
        </div>
        {canOpenEvidence && (
          <button type="button" className="secondary subtle" onClick={onOpenEvidence}>
            View {selectedCount} Source{selectedCount === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {!hasOutline ? (
        <div className="empty-state">
          <p>No outline yet. Create a report to see draft bullets.</p>
        </div>
      ) : (
        <div>
          <ol style={{ paddingLeft: 16 }}>
            {outline.map((item, idx) => (
              <li key={idx} style={{ marginBottom: 8 }}>
                <strong>{item.title || `Bullet ${idx + 1}`}</strong>
                {item.angle && <div style={{ color: '#374151', marginTop: 4 }}>{item.angle}</div>}
              </li>
            ))}
          </ol>
          {reasoning && (
            <div className="email-reasoning" style={{ marginTop: 12 }}>
              <h4>AI Rationale</h4>
              <p>{reasoning}</p>
            </div>
          )}

          <label className="field-group" style={{ marginTop: 16 }}>
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
            onClick={() => onFinalize(feedback)}
            disabled={disabled || isFinalizing}
          >
            {isFinalizing ? 'Generating Talking Points…' : 'Generate Talking Points'}
          </button>
        </div>
      )}
    </div>
  )
}

export default OutlinePanel
