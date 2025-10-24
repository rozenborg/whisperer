import { useEffect, useState } from 'react'

function EmailPreview({ briefing, htmlContent, status }) {
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

  const renderPoint = (point, index) => (
    <li key={point.url ?? index} className="email-point">
      <div className="point-header">
        <span className="point-title">{point.title}</span>
        <span className="point-type">{point.type}</span>
      </div>
      <div className="point-body">
        <p>{point.insight}</p>
        <p>{point.implication}</p>
        <a href={point.url} target="_blank" rel="noreferrer">
          Open source
        </a>
      </div>
    </li>
  )

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
