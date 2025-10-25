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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL,
  content_text TEXT,
  transcript_url TEXT,
  transcript_text TEXT,
  enriched_at TEXT,
  FOREIGN KEY (source_id) REFERENCES sources(id)
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
  (
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

export const insertReportStmt = db.prepare(`
INSERT INTO reports (persona, request, reasoning, outline_json, final_points_json)
VALUES (@persona, @request, @reasoning, @outline_json, @final_points_json)
`)

export const updateReportStmt = db.prepare(`
UPDATE reports SET reasoning=@reasoning, outline_json=@outline_json, final_points_json=@final_points_json WHERE id=@id
`)

export const deleteSourceStmt = db.prepare('DELETE FROM sources WHERE id = ?')

export function withTransaction(fn) {
  const trx = db.transaction(fn)
  return (...args) => trx(...args)
}
