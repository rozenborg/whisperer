import { useEffect, useMemo, useRef, useState } from 'react'

function ChatPane({
  messages = [],
  onDraft,
  isDrafting,
  hasUserMessages,
  hasBriefing,
  width,
  statusLabel,
  statusMessage,
  statusMeta = [],
  error,
  onOpenEvidence,
  evidenceCount = 0,
}) {
  const [inputValue, setInputValue] = useState('')
  const listRef = useRef(null)
  const bottomRef = useRef(null)

  const trimmedValue = useMemo(() => inputValue.trim(), [inputValue])
  const canDraft = !isDrafting && (trimmedValue.length > 0 || hasUserMessages)

  useEffect(() => {
    if (!bottomRef.current) return
    bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages])

  const handleSubmit = (event) => {
    event.preventDefault()
    if (!canDraft) return
    onDraft?.(trimmedValue.length > 0 ? trimmedValue : null)
    setInputValue('')
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      if (canDraft) {
        onDraft?.(trimmedValue.length > 0 ? trimmedValue : null)
        setInputValue('')
      }
    }
  }

  return (
    <div className="chat-pane-container" style={{ '--chat-pane-width': width }}>
      <div className="chat-pane">
        <div className="chat-pane-header">
          <h2>Compose Conversation</h2>
        </div>

        <div className="chat-body" ref={listRef}>
          {messages.length === 0 ? (
            <div className="chat-empty">
              <p>Start with the outcomes you want from this briefing: persona, tone, sections to emphasize, or guardrails.</p>
            </div>
          ) : (
            <ul className="chat-messages" aria-live="polite">
              {messages.map((message) => {
                const role = message.role || 'assistant'
                const key = message.id || `${role}-${message.text?.slice(0, 12) || 'msg'}`
                const label =
                  role === 'user'
                    ? 'Draft Inputs'
                    : role === 'assistant'
                      ? 'Draft Status'
                      : 'Update'
                return (
                  <li key={key} className={`chat-message chat-message-${role}`}>
                    <span className="chat-message-label">{label}</span>
                    <div className="chat-message-content">{message.text}</div>
                  </li>
                )
              })}
              <li ref={bottomRef} aria-hidden="true" />
            </ul>
          )}
        </div>

        <form className="chat-composer" onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="chat-input">
            Add drafting guidance
          </label>
          <textarea
            id="chat-input"
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Example: Fortune 50 CIO — highlight generative AI risks, keep it concise, call out compliance angles."
            rows={3}
            spellCheck={false}
          />
          <div className="chat-actions">
            <button type="submit" className="primary" disabled={!canDraft}>
              {isDrafting ? 'Drafting…' : hasBriefing ? 'Redraft Email' : 'Draft Email'}
            </button>
          </div>
          <p className="chat-hint">

          </p>
        </form>

        <div className="chat-status">
          <header className="chat-status-header">
            <span className="chat-status-label">{statusLabel || 'Status'}</span>
            <span className="chat-status-message">{statusMessage}</span>
          </header>
          {statusMeta.length > 0 && (
            <ul className="chat-status-meta">
              {statusMeta.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          {error && (
            <div className="chat-status-error" role="alert">
              {error}
            </div>
          )}
          <button
            type="button"
            className="ghost"
            onClick={onOpenEvidence}
            disabled={!evidenceCount}
          >
            View Evidence ({evidenceCount})
          </button>
        </div>
      </div>
    </div>
  )
}

export default ChatPane
