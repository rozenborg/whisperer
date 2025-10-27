import { useEffect, useMemo, useRef, useState } from 'react'

function ChatPane({
  messages = [],
  onDraft,
  isDrafting,
  hasUserMessages,
  hasBriefing,
  width,
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
          <h2>Talking Points Chat</h2>
        </div>

        <div className="chat-body" ref={listRef}>
          {messages.length === 0 ? (
            <div className="chat-empty">
              <p>Start with the outcomes you want from these talking points: audience, tone, angles to emphasize, or guardrails.</p>
            </div>
          ) : (
            <ul className="chat-messages" aria-live="polite">
              {messages.map((message) => {
                const role = message.role || 'assistant'
                const key = message.id || `${role}-${message.text?.slice(0, 12) || 'msg'}`
                const label =
                  role === 'user'
                    ? 'Guidance'
                    : role === 'assistant'
                      ? 'AI Status'
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
              {isDrafting ? 'Drafting…' : hasBriefing ? 'Regenerate Points' : 'Generate Points'}
            </button>
          </div>
        </form>

      </div>
    </div>
  )
}

export default ChatPane
