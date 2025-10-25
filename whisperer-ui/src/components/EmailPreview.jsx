import { useEffect, useState } from 'react'

function EmailPreview({
  briefing,
  htmlContent,
  status,
  pinnedUrlSet = new Set(),
  excludedUrlSet = new Set(),
  onTogglePin,
  onToggleExclude,
  isDrafting,
}) {
  const [copied, setCopied] = useState(false)
  const emptyCopy = {
    idle: 'Fetch sources and run the AI step to see the formatted briefing.',
    fetching: 'Waiting for sources to finish loading.',
    fetched: 'Run Generate Briefing to build the talking points.',
    curating: 'AI is selecting the top sources.',
    generating: 'AI is composing the briefing.',
  }

  useEffect(() => {
    setCopied(false)
  }, [htmlContent])

  const handleCopy = async () => {
    if (!htmlContent) return

    try {
      await navigator.clipboard.writeText(htmlContent)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy HTML', error)
      setCopied(false)
    }
  }

  const hasContent =
    briefing && (briefing.summary || (briefing.points && briefing.points.length))

  const renderPoint = (point, index) => {
    const urlKey = point.url ? String(point.url) : `point-${index}`
    const isPinned = pinnedUrlSet instanceof Set && point.url ? pinnedUrlSet.has(String(point.url)) : false
    const isExcluded = excludedUrlSet instanceof Set && point.url ? excludedUrlSet.has(String(point.url)) : false
    const canToggle = Boolean(point.url)
    const togglePin = () => {
      if (!canToggle || typeof onTogglePin !== 'function') return
      onTogglePin(point)
    }
    const toggleExclude = () => {
      if (!canToggle || typeof onToggleExclude !== 'function') return
      onToggleExclude(point)
    }

    return (
      <li
        key={urlKey}
        className={`email-point${isPinned ? ' is-pinned' : ''}${isExcluded ? ' is-excluded' : ''}`}
      >
        <div className="point-header">
          <div className="point-meta">
            <span className="point-title">{point.title}</span>
            {point.type && <span className="point-type">{point.type}</span>}
          </div>
          <div className="point-actions">
            <button
              type="button"
              className={`chip${isPinned ? ' selected' : ''}`}
              onClick={togglePin}
              disabled={!canToggle || isDrafting}
            >
              {isPinned ? 'Pinned' : 'Pin'}
            </button>
            <button
              type="button"
              className={`chip${isExcluded ? ' selected' : ''}`}
              onClick={toggleExclude}
              disabled={!canToggle || isDrafting}
            >
              {isExcluded ? 'Excluded' : 'Exclude'}
            </button>
          </div>
        </div>
        <div className="point-body">
          <p>{point.insight}</p>
          <p>{point.implication}</p>
          <a href={point.url} target="_blank" rel="noreferrer">
            Open source
          </a>
        </div>
        {isExcluded && (
          <div className="point-flag" role="status">
            Will drop this point on the next draft.
          </div>
        )}
      </li>
    )
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h2>Email Preview</h2>
          <p>
            Review the generated briefing. Copy when ready or share feedback
            before sending.
          </p>
        </div>
        <div className="actions">
          <button
            type="button"
            onClick={handleCopy}
            disabled={!htmlContent}
            className="secondary"
          >
            {copied ? 'Copied!' : 'Copy HTML'}
          </button>
          <button type="button" className="ghost" disabled>
            Send to Email (coming soon)
          </button>
        </div>
      </div>

      {!hasContent ? (
        <div className="empty-state">
          <p>
            {emptyCopy[status] ??
              'Waiting on AI to finish building the email preview.'}
          </p>
        </div>
      ) : (
        <article className="email-preview">
          <header>
            <h3>AI Executive Briefing</h3>
            <span className="email-date">
              {new Date(briefing.generatedAt || Date.now()).toLocaleDateString()}
            </span>
          </header>
          <section>
            <h4>Executive Summary</h4>
            <p>{briefing.summary}</p>
          </section>
          {briefing.points && briefing.points.length > 0 && (
            <section>
              <h4>Briefing Points</h4>
              <ul className="email-points">
                {briefing.points.map((point, index) => renderPoint(point, index))}
              </ul>
            </section>
          )}
          {briefing.reasoning && (
            <section className="email-reasoning">
              <h4>AI Rationale</h4>
              <p>{briefing.reasoning}</p>
            </section>
          )}
        </article>
      )}
    </div>
  )
}

export default EmailPreview
