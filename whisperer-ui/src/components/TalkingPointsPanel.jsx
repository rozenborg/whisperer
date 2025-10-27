import { useMemo, useState } from 'react'

const TAG_PRESETS = [
  { value: 'strategy', label: 'Strategy' },
  { value: 'risk', label: 'Risk' },
  { value: 'actionable', label: 'Actionable' },
  { value: 'follow-up', label: 'Follow Up' },
  { value: 'too-technical', label: 'Too Technical' },
  { value: 'too-hype', label: 'Too Hype' },
]

function sanitizeTag(value) {
  if (!value) return ''
  return String(value).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').trim()
}

function uniqueTags(list) {
  const seen = new Set()
  const result = []
  list.forEach((tag) => {
    const normalized = sanitizeTag(tag)
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    result.push(normalized)
  })
  return result.slice(0, 8)
}

function TagSelector({ selected = [], onToggle, onAdd, customValue, onCustomChange }) {
  return (
    <div className="tag-selector">
      <div className="tag-preset-list">
        {TAG_PRESETS.map((tag) => {
          const active = selected.includes(tag.value)
          return (
            <button
              key={tag.value}
              type="button"
              className={`chip${active ? ' selected' : ''}`}
              onClick={() => onToggle(tag.value)}
            >
              {tag.label}
            </button>
          )
        })}
      </div>
      <div className="tag-custom-input">
        <input
          type="text"
          value={customValue}
          placeholder="Add custom tag"
          onChange={(event) => onCustomChange(event.target.value)}
        />
        <button type="button" onClick={onAdd} disabled={!customValue.trim()}>
          Add
        </button>
      </div>
      {selected.length > 0 && (
        <div className="tag-selected-summary">
          {selected.map((tag) => (
            <span key={tag} className="tag-chip">{tag}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function TalkingPointsPanel({
  briefing,
  status,
  pinnedUrlSet = new Set(),
  excludedUrlSet = new Set(),
  onTogglePin,
  onToggleExclude,
  isDrafting,
  onOpenEvidence,
  evidenceCount = 0,
  onSavePoint,
  onSaveAll,
  isPointSaved,
  isPointSaving,
  isSavingAll,
  savedPoints = [],
  savedPointsLoading = false,
  onUpdateSavedPoint,
  onDeleteSavedPoint,
  isSavedPointUpdating,
  isSavedPointDeleting,
  metrics,
  metricsLoading = false,
}) {
  const generatedPoints = Array.isArray(briefing?.points) ? briefing.points : []
  const summary = briefing?.summary || ''

  const [pendingSave, setPendingSave] = useState(null)
  const [saveCustomTag, setSaveCustomTag] = useState('')

  const [editingId, setEditingId] = useState(null)
  const [draftHeadline, setDraftHeadline] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [draftTags, setDraftTags] = useState([])
  const [editCustomTag, setEditCustomTag] = useState('')
  const [editingOriginal, setEditingOriginal] = useState(null)

  const getActionLabel = (typeLike) => {
    const normalized = typeof typeLike === 'string' ? typeLike.toLowerCase() : ''
    if (normalized.includes('podcast') || normalized.includes('audio')) {
      return 'Listen to this:'
    }
    return 'Read this:'
  }

  const emptyCopy = {
    idle: 'Fetch sources and run the AI step to generate talking points.',
    fetching: 'Waiting for sources to finish loading.',
    fetched: 'Run Generate Points to build the talking points.',
    curating: 'AI is selecting the most relevant sources.',
    generating: 'AI is drafting the talking points.',
  }

  const canOpenEvidence = typeof onOpenEvidence === 'function' && evidenceCount > 0

  const unsavedCount = useMemo(() => {
    if (!generatedPoints.length || typeof isPointSaved !== 'function') return 0
    return generatedPoints.reduce(
      (count, point) => (isPointSaved(point) ? count : count + 1),
      0,
    )
  }, [generatedPoints, isPointSaved])

  const startSaveFlow = (point, key) => {
    setPendingSave({
      key,
      point,
      tags: [],
      awaitingConfirmation: false,
      duplicate: null,
      error: '',
    })
    setSaveCustomTag('')
  }

  const cancelSaveFlow = () => {
    setPendingSave(null)
    setSaveCustomTag('')
  }

  const toggleSaveTag = (tagValue) => {
    const normalized = sanitizeTag(tagValue)
    if (!normalized) return
    setPendingSave((previous) => {
      if (!previous) return previous
      const exists = previous.tags.includes(normalized)
      const nextTags = exists
        ? previous.tags.filter((tag) => tag !== normalized)
        : uniqueTags([...previous.tags, normalized])
      return { ...previous, tags: nextTags }
    })
  }

  const addCustomSaveTag = () => {
    if (!saveCustomTag.trim()) return
    const normalized = sanitizeTag(saveCustomTag)
    if (!normalized) return
    setPendingSave((previous) => {
      if (!previous) return previous
      const nextTags = uniqueTags([...previous.tags, normalized])
      return { ...previous, tags: nextTags }
    })
    setSaveCustomTag('')
  }

  const handleConfirmSave = async () => {
    if (!pendingSave || typeof onSavePoint !== 'function') return
    try {
      const result = await onSavePoint(pendingSave.point, {
        tags: pendingSave.tags,
        force: pendingSave.awaitingConfirmation,
      })
      if (result?.requiresConfirmation) {
        setPendingSave((previous) => (previous ? { ...previous, awaitingConfirmation: true, duplicate: result.duplicate } : previous))
        return
      }
      if (result?.ok) {
        cancelSaveFlow()
      }
    } catch (error) {
      console.error('Save talking point failed', error)
      setPendingSave((previous) => (previous ? { ...previous, error: error.message || 'Save failed' } : previous))
    }
  }

  const handleSaveAllClick = async () => {
    if (typeof onSaveAll !== 'function') return
    try {
      await onSaveAll()
    } catch (error) {
      console.error('Save all talking points failed', error)
    }
  }

  const startEditing = (item) => {
    setEditingId(item.id)
    setDraftHeadline(item.headline || '')
    setDraftBody(item.body || '')
    setDraftTags(Array.isArray(item.tags) ? [...item.tags] : [])
    setEditCustomTag('')
    setEditingOriginal({ headline: item.headline || '', body: item.body || '' })
  }

  const cancelEditing = () => {
    setEditingId(null)
    setDraftHeadline('')
    setDraftBody('')
    setDraftTags([])
    setEditCustomTag('')
    setEditingOriginal(null)
  }

  const toggleDraftTag = (tagValue) => {
    const normalized = sanitizeTag(tagValue)
    if (!normalized) return
    setDraftTags((previous) => {
      const exists = previous.includes(normalized)
      return exists
        ? previous.filter((tag) => tag !== normalized)
        : uniqueTags([...previous, normalized])
    })
  }

  const addDraftCustomTag = () => {
    if (!editCustomTag.trim()) return
    const normalized = sanitizeTag(editCustomTag)
    if (!normalized) return
    setDraftTags((previous) => uniqueTags([...previous, normalized]))
    setEditCustomTag('')
  }

  const commitEdit = async () => {
    if (!editingId || typeof onUpdateSavedPoint !== 'function') return
    const trimmedHeadline = draftHeadline.trim()
    const trimmedBody = draftBody.trim()
    if (!trimmedHeadline || !trimmedBody) return
    try {
      const result = await onUpdateSavedPoint(editingId, {
        headline: trimmedHeadline,
        body: trimmedBody,
        tags: draftTags,
        originalHeadline: editingOriginal?.headline,
        originalBody: editingOriginal?.body,
      })
      if (result?.ok) {
        cancelEditing()
      }
    } catch (error) {
      console.error('Update talking point failed', error)
    }
  }

  const handleDelete = async (item) => {
    if (!item?.id || typeof onDeleteSavedPoint !== 'function') return
    const confirmed =
      typeof window !== 'undefined'
        ? window.confirm('Delete this talking point?')
        : true
    if (!confirmed) return
    try {
      await onDeleteSavedPoint(item.id)
      if (editingId === item.id) {
        cancelEditing()
      }
    } catch (error) {
      console.error('Delete talking point failed', error)
    }
  }

  const metricsSummary = useMemo(() => {
    if (!metrics || typeof metrics !== 'object') return null
    const avgEdit = metrics.averageEditDistance ? metrics.averageEditDistance.toFixed(1) : '0'
    const topTags = Array.isArray(metrics.tagCounts)
      ? metrics.tagCounts.slice(0, 4).map((entry) => `${entry.tag} (${entry.count})`).join(', ')
      : ''
    return { avgEdit, topTags }
  }, [metrics])

  const renderGeneratedPoint = (point, index) => {
    const urlKey = point.url ? String(point.url) : `point-${index}`
    const isPinned =
      pinnedUrlSet instanceof Set && point.url ? pinnedUrlSet.has(String(point.url)) : false
    const isExcluded =
      excludedUrlSet instanceof Set && point.url ? excludedUrlSet.has(String(point.url)) : false
    const canToggle = Boolean(point.url)
    const saved = typeof isPointSaved === 'function' ? isPointSaved(point) : false
    const saving = typeof isPointSaving === 'function' ? isPointSaving(point) : false
    const disableSave = saved || saving || isDrafting
    const saveLabel = saved ? 'Saved' : saving ? 'Saving…' : 'Save'
    const actionLabel = getActionLabel(point.type)
    const isPending = pendingSave && pendingSave.key === urlKey
    const supportingFacts = Array.isArray(point.supportingFacts) ? point.supportingFacts.filter(Boolean) : []

    return (
      <li
        key={urlKey}
        className={`talking-point-card${isPinned ? ' is-pinned' : ''}${isExcluded ? ' is-excluded' : ''}`}
      >
        <div className="point-header">
          <div className="point-meta">
            <span className="point-title">
              {actionLabel} {point.title || point.insight || 'New development'}
            </span>
            {point.type && <span className="point-type">{point.type}</span>}
          </div>
          <div className="point-actions">
            <button
              type="button"
              className={`chip${isPinned ? ' selected' : ''}`}
              onClick={() => canToggle && onTogglePin?.(point)}
              disabled={!canToggle || isDrafting}
            >
              {isPinned ? 'Pinned' : 'Pin'}
            </button>
            <button
              type="button"
              className={`chip${isExcluded ? ' selected' : ''}`}
              onClick={() => canToggle && onToggleExclude?.(point)}
              disabled={!canToggle || isDrafting}
            >
              {isExcluded ? 'Excluded' : 'Exclude'}
            </button>
            <button
              type="button"
              className={`chip${saved ? ' selected' : ''}`}
              onClick={() => (!saved && !disableSave ? startSaveFlow(point, urlKey) : null)}
              disabled={disableSave}
            >
              {saveLabel}
            </button>
          </div>
        </div>
        <div className="point-body">
          {point.insight && <p>{point.insight}</p>}
          {point.implication && <p>{point.implication}</p>}
          {supportingFacts.length > 0 && (
            <ul className="point-supporting-facts">
              {supportingFacts.map((fact, factIndex) => (
                <li key={`${urlKey}-fact-${factIndex}`}>{fact}</li>
              ))}
            </ul>
          )}
          {point.url && (
            <a href={point.url} target="_blank" rel="noreferrer">
              {point.title ? `Source: ${point.title}` : 'Open source'}
            </a>
          )}
        </div>
        {isExcluded && (
          <div className="point-flag" role="status">
            Will drop this point on the next draft.
          </div>
        )}
        {isPending && (
          <div className="save-panel">
            <p>Select tags before saving (optional).</p>
            <TagSelector
              selected={pendingSave.tags}
              onToggle={toggleSaveTag}
              onAdd={addCustomSaveTag}
              customValue={saveCustomTag}
              onCustomChange={setSaveCustomTag}
            />
            {pendingSave.duplicate && (
              <p className="duplicate-warning">
                Possible duplicate of “{pendingSave.duplicate.point.headline}”. Click save again to confirm.
              </p>
            )}
            {pendingSave.error && <p className="error-text">{pendingSave.error}</p>}
            <div className="save-panel-actions">
              <button type="button" className="primary" onClick={handleConfirmSave} disabled={saving}>
                {pendingSave.awaitingConfirmation ? 'Save Anyway' : 'Save Talking Point'}
              </button>
              <button type="button" onClick={cancelSaveFlow} disabled={saving}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </li>
    )
  }

  const renderSavedPoint = (item) => {
    const isEditing = editingId === item.id
    const updating = typeof isSavedPointUpdating === 'function' && isSavedPointUpdating(item.id)
    const deleting = typeof isSavedPointDeleting === 'function' && isSavedPointDeleting(item.id)
    const paragraphs = typeof item.body === 'string'
      ? item.body.split(/\n{2,}/).map((segment) => segment.trim()).filter(Boolean)
      : []
    const tagList = Array.isArray(item.tags) ? item.tags : []
    return (
      <li key={`saved-${item.id}`} className="saved-point-card">
        {isEditing ? (
          <div className="saved-point-edit">
            <label className="field-group">
              <span className="field-label">Headline</span>
              <textarea
                value={draftHeadline}
                onChange={(event) => setDraftHeadline(event.target.value)}
                rows={2}
              />
            </label>
            <label className="field-group">
              <span className="field-label">Details</span>
              <textarea
                value={draftBody}
                onChange={(event) => setDraftBody(event.target.value)}
                rows={4}
              />
            </label>
            <TagSelector
              selected={draftTags}
              onToggle={toggleDraftTag}
              onAdd={addDraftCustomTag}
              customValue={editCustomTag}
              onCustomChange={setEditCustomTag}
            />
            <div className="saved-point-actions">
              <button
                type="button"
                className="primary"
                onClick={commitEdit}
                disabled={updating || !draftHeadline.trim() || !draftBody.trim()}
              >
                {updating ? 'Saving…' : 'Save'}
              </button>
              <button type="button" onClick={cancelEditing} disabled={updating}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="saved-point-content">
            <p className="saved-point-headline">
              <span>{getActionLabel(item?.source?.sourceType || item?.type)}</span> {item.headline}
            </p>
            <div className="saved-point-body">
              {paragraphs.length
                ? paragraphs.map((segment, idx) => <p key={`${item.id}-p-${idx}`}>{segment}</p>)
                : <p>{item.body}</p>}
            </div>
            {tagList.length > 0 && (
              <div className="saved-point-tags">
                {tagList.map((tag) => (
                  <span key={`${item.id}-tag-${tag}`} className="tag-chip">{tag}</span>
                ))}
              </div>
            )}
            <div className="saved-point-meta">
              {item.source && (item.source.title || item.source.url) && (
                <span>
                  From:{' '}
                  {item.source.url ? (
                    <a href={item.source.url} target="_blank" rel="noreferrer">
                      {item.source.title || item.source.url}
                    </a>
                  ) : (
                    <span>{item.source.title}</span>
                  )}
                </span>
              )}
              {typeof item.editDistance === 'number' && item.editDistance > 0 && (
                <span className="saved-point-edit-distance">Edit distance: {item.editDistance}</span>
              )}
              {item.savedAt && (
                <span className="saved-point-saved-at">Saved {new Date(item.savedAt).toLocaleString()}</span>
              )}
            </div>
            <div className="saved-point-actions">
              <button type="button" onClick={() => startEditing(item)}>
                Edit
              </button>
              <button
                type="button"
                onClick={() => handleDelete(item)}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        )}
      </li>
    )
  }

  return (
    <div className="panel talking-points-panel">
      <div className="panel-header">
        <div>
          <h2>Talking Points</h2>
          <p>Review the AI draft, pin or exclude items, then save what matters.</p>
        </div>
        <div className="actions">
          <button
            type="button"
            onClick={onOpenEvidence}
            disabled={!canOpenEvidence}
            className="icon-button"
            aria-label={`View Evidence (${evidenceCount})`}
          >
            <i className="bi bi-eye" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="chip"
            onClick={handleSaveAllClick}
            disabled={typeof onSaveAll !== 'function' || isSavingAll || isDrafting || unsavedCount === 0}
          >
            {isSavingAll ? 'Saving…' : `Save All${unsavedCount ? ` (${unsavedCount})` : ''}`}
          </button>
        </div>
      </div>

      {!summary && generatedPoints.length === 0 ? (
        <div className="empty-state">
          <p>{emptyCopy[status] ?? 'Waiting on AI to finish drafting the talking points.'}</p>
        </div>
      ) : (
        <article className="talking-points-preview">
          <header>
            <h3>AI Executive Briefing</h3>
            <span className="preview-date">
              {new Date(briefing?.generatedAt || Date.now()).toLocaleDateString()}
            </span>
          </header>
          {summary && (
            <section className="preview-summary">
              <h4>Executive Summary</h4>
              <p>{summary}</p>
            </section>
          )}
          {generatedPoints.length > 0 && (
            <section className="preview-points">
              <h4>Generated Talking Points</h4>
              <ul className="talking-point-list">
                {generatedPoints.map((point, index) => renderGeneratedPoint(point, index))}
              </ul>
            </section>
          )}
        </article>
      )}

      <section className="saved-points-section">
        <header>
          <h4>Saved Talking Points</h4>
          {(savedPointsLoading || metricsLoading) && <span className="saved-points-status">Loading…</span>}
          {metricsSummary && !metricsLoading && (
            <span className="saved-points-status">
              Avg edit distance: {metricsSummary.avgEdit}
              {metricsSummary.topTags ? ` • Top tags: ${metricsSummary.topTags}` : ''}
            </span>
          )}
        </header>
        {savedPoints.length === 0 && !savedPointsLoading ? (
          <p className="saved-points-empty">
            Saved talking points will appear here. Use Save to keep high-signal items.
          </p>
        ) : (
          <ul className="saved-points-list">
            {savedPoints.map((item) => renderSavedPoint(item))}
          </ul>
        )}
      </section>
    </div>
  )
}

export default TalkingPointsPanel
