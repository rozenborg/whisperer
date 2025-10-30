import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'whisperer.sqlite')

function ensureDir(p) {
  const dir = path.dirname(p)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

ensureDir(dbPath)

export const db = new Database(dbPath)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  url_unique TEXT NOT NULL UNIQUE,
  title TEXT,
  source TEXT,
  source_type TEXT,
  published_at TEXT,
  description TEXT,
  origin_key TEXT,
  starred_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL,
  content_text TEXT,
  transcript_url TEXT,
  transcript_text TEXT,
  snippet_text TEXT,
  enriched_at TEXT,
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS embeddings (
  source_id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  vector TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  persona TEXT,
  request TEXT,
  reasoning TEXT,
  outline_json TEXT,
  final_points_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS talking_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER,
  headline TEXT NOT NULL,
  body TEXT NOT NULL,
  related_source_ids TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  edit_distance INTEGER DEFAULT 0,
  saved_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS source_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL UNIQUE,
  points_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);
`)

try {
  db.prepare('ALTER TABLE contents ADD COLUMN snippet_text TEXT').run()
} catch (err) {
  if (!String(err.message || '').includes('duplicate column name')) {
    console.warn('Failed to ensure snippet_text column on contents table', err.message)
  }
}

try {
  db.prepare("ALTER TABLE talking_points ADD COLUMN tags TEXT").run()
  db.prepare("UPDATE talking_points SET tags = '[]' WHERE tags IS NULL").run()
} catch (err) {
  if (!String(err.message || '').includes('duplicate column name')) {
    console.warn('Failed to ensure tags column on talking_points table', err.message)
  }
}

try {
  db.prepare('ALTER TABLE talking_points ADD COLUMN edit_distance INTEGER DEFAULT 0').run()
} catch (err) {
  if (!String(err.message || '').includes('duplicate column name')) {
    console.warn('Failed to ensure edit_distance column on talking_points table', err.message)
  }
}

try {
  db.prepare('ALTER TABLE talking_points ADD COLUMN saved_at TEXT').run()
  db.prepare("UPDATE talking_points SET saved_at = datetime('now') WHERE saved_at IS NULL").run()
} catch (err) {
  if (!String(err.message || '').includes('duplicate column name')) {
    console.warn('Failed to ensure saved_at column on talking_points table', err.message)
  }
}

try {
  db.prepare('ALTER TABLE sources ADD COLUMN starred_at TEXT').run()
} catch (err) {
  if (!String(err.message || '').includes('duplicate column name')) {
    console.warn('Failed to ensure starred_at column on sources table', err.message)
  }
}

try {
  db.prepare('ALTER TABLE sources ADD COLUMN hidden_at TEXT').run()
} catch (err) {
  if (!String(err.message || '').includes('duplicate column name')) {
    console.warn('Failed to ensure hidden_at column on sources table', err.message)
  }
}

// Full-text search index for sources metadata (title, description)
db.exec(`
CREATE VIRTUAL TABLE IF NOT EXISTS sources_fts USING fts5(
  title, description,
  content='sources', content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS sources_ai AFTER INSERT ON sources BEGIN
  INSERT INTO sources_fts(rowid, title, description)
  VALUES (new.id, COALESCE(new.title,''), COALESCE(new.description,''));
END;

CREATE TRIGGER IF NOT EXISTS sources_ad AFTER DELETE ON sources BEGIN
  INSERT INTO sources_fts(sources_fts, rowid, title, description)
  VALUES('delete', old.id, COALESCE(old.title,''), COALESCE(old.description,''));
END;

CREATE TRIGGER IF NOT EXISTS sources_au AFTER UPDATE ON sources BEGIN
  INSERT INTO sources_fts(sources_fts, rowid, title, description)
  VALUES('delete', old.id, COALESCE(old.title,''), COALESCE(old.description,''));
  INSERT INTO sources_fts(rowid, title, description)
  VALUES (new.id, COALESCE(new.title,''), COALESCE(new.description,''));
END;
`)

export const upsertSourceStmt = db.prepare(`
INSERT INTO sources (url, url_unique, title, source, source_type, published_at, description, origin_key)
VALUES (@url, @url_unique, @title, @source, @source_type, @published_at, @description, @origin_key)
ON CONFLICT(url_unique) DO UPDATE SET
  title=COALESCE(excluded.title, sources.title),
  description=COALESCE(excluded.description, sources.description),
  updated_at=datetime('now')
`)

export const selectRecentSourcesStmt = db.prepare(`
SELECT * FROM sources
WHERE published_at IS NULL OR published_at >= datetime('now', @since)
ORDER BY published_at DESC, id DESC
LIMIT @limit
`)

export const selectSourcesByDateStmt = db.prepare(`
SELECT * FROM sources
WHERE
  hidden_at IS NULL
  AND (
    @start IS NULL
    OR published_at IS NULL
    OR datetime(published_at) >= datetime(@start)
  )
  AND (
    @end IS NULL
    OR published_at IS NULL
    OR datetime(published_at) <= datetime(@end)
  )
ORDER BY
  CASE WHEN published_at IS NOT NULL THEN datetime(published_at) ELSE datetime(created_at) END DESC,
  id DESC
LIMIT @limit
`)

export const selectSourcesByIdsStmt = db.prepare(`
SELECT * FROM sources WHERE id IN (SELECT value FROM json_each(@idsJson))
`)

export const selectSourceByUrlUniqueStmt = db.prepare(`
SELECT * FROM sources WHERE url_unique = ?
`)

export const selectSourcesByFtsStmt = db.prepare(`
SELECT s.*, bm25(sources_fts) AS bm25
FROM sources_fts
JOIN sources s ON s.id = sources_fts.rowid
WHERE sources_fts MATCH @match
  AND s.hidden_at IS NULL
  AND (
    @start IS NULL
    OR s.published_at IS NULL
    OR datetime(s.published_at) >= datetime(@start)
  )
  AND (
    @end IS NULL
    OR s.published_at IS NULL
    OR datetime(s.published_at) <= datetime(@end)
  )
ORDER BY bm25 ASC
LIMIT @limit
`)

export const insertReportStmt = db.prepare(`
INSERT INTO reports (persona, request, reasoning, outline_json, final_points_json)
VALUES (@persona, @request, @reasoning, @outline_json, @final_points_json)
`)

export const updateReportStmt = db.prepare(`
UPDATE reports SET reasoning=@reasoning, outline_json=@outline_json, final_points_json=@final_points_json WHERE id=@id
`)

export const deleteSourceStmt = db.prepare('DELETE FROM sources WHERE id = ?')

export const updateSourceStarStmt = db.prepare(`
UPDATE sources
SET starred_at = datetime('now'), updated_at = datetime('now')
WHERE id = @id
`)

export const clearSourceStarStmt = db.prepare(`
UPDATE sources
SET starred_at = NULL, updated_at = datetime('now')
WHERE id = @id
`)

export const updateSourceHideStmt = db.prepare(`
UPDATE sources
SET hidden_at = datetime('now'), updated_at = datetime('now')
WHERE id = @id
`)

export const clearSourceHideStmt = db.prepare(`
UPDATE sources
SET hidden_at = NULL, updated_at = datetime('now')
WHERE id = @id
`)

export const insertTalkingPointStmt = db.prepare(`
INSERT INTO talking_points (source_id, headline, body, related_source_ids, tags, edit_distance, saved_at)
VALUES (
  @source_id,
  @headline,
  @body,
  COALESCE(@related_source_ids, '[]'),
  COALESCE(@tags, '[]'),
  COALESCE(@edit_distance, 0),
  COALESCE(@saved_at, datetime('now'))
)
`)

export const updateTalkingPointStmt = db.prepare(`
UPDATE talking_points
SET
  source_id = COALESCE(@source_id, source_id),
  headline = COALESCE(@headline, headline),
  body = COALESCE(@body, body),
  related_source_ids = COALESCE(@related_source_ids, related_source_ids),
  tags = COALESCE(@tags, tags),
  edit_distance = COALESCE(@edit_distance, edit_distance),
  saved_at = COALESCE(@saved_at, saved_at),
  updated_at = datetime('now')
WHERE id = @id
`)

export const deleteTalkingPointStmt = db.prepare('DELETE FROM talking_points WHERE id = ?')

export const selectTalkingPointsStmt = db.prepare(`
SELECT
  tp.*,
  s.title AS source_title,
  s.url AS source_url,
  s.source AS source_name,
  s.source_type AS source_type
FROM talking_points tp
LEFT JOIN sources s ON s.id = tp.source_id
WHERE
  (
    @start IS NULL
    OR datetime(tp.created_at) >= datetime(@start)
  )
  AND (
    @end IS NULL
    OR datetime(tp.created_at) <= datetime(@end)
  )
ORDER BY datetime(tp.created_at) DESC, tp.id DESC
LIMIT @limit
`)

export const selectTalkingPointByIdStmt = db.prepare(`
SELECT
  tp.*,
  s.title AS source_title,
  s.url AS source_url,
  s.source AS source_name,
  s.source_type AS source_type
FROM talking_points tp
LEFT JOIN sources s ON s.id = tp.source_id
WHERE tp.id = ?
`)

export const selectSourceNoteBySourceIdStmt = db.prepare(`
SELECT * FROM source_notes WHERE source_id = ?
`)

export const upsertSourceNoteStmt = db.prepare(`
INSERT INTO source_notes (source_id, points_json, generated_at, updated_at)
VALUES (@source_id, @points_json, datetime('now'), datetime('now'))
ON CONFLICT(source_id) DO UPDATE SET
  points_json = excluded.points_json,
  generated_at = excluded.generated_at,
  updated_at = datetime('now')
`)

export const deleteSourceNoteStmt = db.prepare('DELETE FROM source_notes WHERE source_id = ?')

export const selectTalkingPointTagCountsStmt = db.prepare(`
SELECT
  json_each.value AS tag,
  COUNT(*) AS count
FROM talking_points, json_each(talking_points.tags)
GROUP BY tag
ORDER BY count DESC
`)

export const selectTalkingPointDailyCountsStmt = db.prepare(`
SELECT
  substr(saved_at, 1, 10) AS day,
  COUNT(*) AS count,
  AVG(edit_distance) AS avg_edit_distance
FROM talking_points
WHERE saved_at IS NOT NULL
GROUP BY day
ORDER BY day DESC
LIMIT @limit
`)

// Contents helpers
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS contents_source_id_idx ON contents(source_id)`)

export const selectContentsBySourceIdsStmt = db.prepare(`
SELECT * FROM contents WHERE source_id IN (SELECT value FROM json_each(@idsJson))
`)

export const upsertContentStmt = db.prepare(`
INSERT INTO contents (source_id, content_text, transcript_url, transcript_text, snippet_text, enriched_at)
VALUES (@source_id, @content_text, @transcript_url, @transcript_text, @snippet_text, datetime('now'))
ON CONFLICT(source_id) DO UPDATE SET
  content_text = COALESCE(excluded.content_text, contents.content_text),
  transcript_url = COALESCE(excluded.transcript_url, contents.transcript_url),
  transcript_text = COALESCE(excluded.transcript_text, contents.transcript_text),
  snippet_text = COALESCE(excluded.snippet_text, contents.snippet_text),
  enriched_at = datetime('now')
`)

db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS embeddings_source_id_idx ON embeddings(source_id)`)

export const selectEmbeddingsBySourceIdsStmt = db.prepare(`
SELECT * FROM embeddings WHERE source_id IN (SELECT value FROM json_each(@idsJson))
`)

export const upsertEmbeddingStmt = db.prepare(`
INSERT INTO embeddings (source_id, provider, model, vector)
VALUES (@source_id, @provider, @model, @vector)
ON CONFLICT(source_id) DO UPDATE SET
  provider = excluded.provider,
  model = excluded.model,
  vector = excluded.vector,
  created_at = datetime('now')
`)

export const countSourcesStmt = db.prepare('SELECT COUNT(*) AS total FROM sources')

export const countEnrichedSourcesStmt = db.prepare(
  'SELECT COUNT(*) AS total FROM contents WHERE COALESCE(content_text, transcript_text) IS NOT NULL'
)

export const countReportsStmt = db.prepare('SELECT COUNT(*) AS total FROM reports')
export const countTalkingPointsStmt = db.prepare('SELECT COUNT(*) AS total FROM talking_points')

export function withTransaction(fn) {
  const trx = db.transaction(fn)
  return (...args) => trx(...args)
}
