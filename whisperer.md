# Whisperer – Current Product Notes (Oct 2024)

## Overview
Whisperer pairs a React/Vite front end with a lightweight Express + SQLite backend. It helps you curate high-signal AI news, then generate and iterate on executive-ready talking points. The flow today:

1. Configure feeds, podcasts, and time window in the settings drawer (gear icon).
2. In the **Sources** view, click **Add Sources** to pull the latest items for the chosen window.
3. Review sources, open full articles in the side drawer, delete noise.
4. Switch to **Compose**, use the chat-style prompt pane to describe the audience/objectives, and click **Draft**.
5. Inspect the generated email, pin or exclude points, revise with feedback, and copy/send when it’s ready.

The design optimizes for “fetch → curate quickly → produce an executive briefing grounded in full content.”

---

## UI

### Global Shell
- **Header:** app title, view tabs (Compose / Sources), and gear button (settings drawer). The drawer is collapsed by default.
- **Compose view:** two-column layout — left pane is the chat-style drafting surface, right pane hosts the formatted email and evidence controls. Drag handle adjusts widths.
- **Sources view:** table of everything currently in SQLite plus a detail drawer for reading the full article/transcript.

### Settings Drawer (right slide-out)
- **Podcast provider:** Apple Podcasts search (default) or Listen Notes API fallback.
- **Time range:** start/end date inputs (defaults to “today” and 6 days prior). Drives ingestion, retrieval, and prompting.
- **Sources:** grouped toggles for Podcasts, News & Research, and Web Searches (Tavily is off by default). Labels no longer mention per-feed caps because policies live on the server.
- **Save Configuration** persists to `localStorage` (`whisperer-config-v2`).

### Compose View
- **Chat Pane:** conversational text area where each user message is stored. Hitting **Draft** composes a prompt from user turns and triggers briefing generation. The pane also surfaces status messages, errors, and draft updates.
- **Briefing Preview:** shows the generated email (summary + bullets + reasoning). Buttons allow pinning/excluding bullets, opening evidence, and copying HTML.
- **Evidence Drawer:** slides in from the right with the sources backing the current briefing. Each source shows cached excerpts (full article or transcript when available) with timestamps.
- **Pipeline Bar (below header):** fixed secondary nav under the top header. Shows counts for sources → enriched → saved talking points, plus the current action (e.g., "Adding sources", "Ready to add sources").

### Sources View
- **Add Sources** button fetches the latest items, merges them into the in-memory list, and sends them to the backend for storage (per-feed policies apply server-side; no global cap unless `MAX_SOURCES_PER_RUN` is set > 0).
- **Table columns:** Title (with "Selected" chip if part of the current briefing), Source, Date, Actions. Actions provide:
  - **Star** (`star` icon) → star a source to generate AI talking points notes for it.
  - **Hide** (`eye-slash` icon) → hide a source so it remains in the database but is excluded from AI selection. Hidden sources appear greyed out and can be unhidden by clicking again.
  - **View** (`journal` icon) → opens the Source Detail drawer on the right.
  - **Delete** (`trash` icon) → removes from SQLite and the UI.
- **Source Detail Drawer:** mirrors the evidence drawer styling but shows a single source. Displays title, publication date, cached excerpt/full content, and a button to fetch or refresh full content via the `/api/enrich` endpoint.

---

## Data Ingestion & Storage
- **Manual trigger:** only runs when **Add Sources** is clicked. No automatic refresh on load.
- **Per-feed policies:** enforced server-side (`server/src/feeds.js`). Examples: TechCrunch capped at 12 per run, podcasts set to include all, blogs capped at 6. These replace the old UI "max items" caps.
- **Date handling:** incoming RSS dates are normalized to ISO strings before hitting SQLite so range queries behave consistently.
- **Deduplication:** URLs are canonicalized (tracking params removed) and hashed; duplicates update metadata without duplicating rows.
- **On-demand enrichment:** full article text or podcast transcripts are fetched only when needed (during briefing generation, in the Evidence drawer, or via the Source Detail drawer) and cached in the `contents` table.
- **Hidden sources:** sources can be marked as hidden (`hidden_at` timestamp in `sources` table). Hidden sources remain in the database to prevent re-ingestion but are automatically excluded from all AI retrieval queries (FTS search, date-based queries). They appear greyed out in the UI.

---

## Retrieval & AI Workflow

1. **Draft (POST `/api/briefings`)**
   - Ranked retrieval combines FTS5 keyword search, recency decay, and (when configured) OpenAI embeddings (`text-embedding-3-small`) to shortlist candidates.
   - Selected sources are auto-enriched (articles scraped with a minimal readability pass; podcasts store show notes/transcript text).
   - Claude 3.5 Sonnet curates the shortlist, then generates a JSON payload (`summary`, `points[]`). Reasoning and selected source IDs are saved in the `reports` table.
   - Response returns the briefing, selected source IDs/URLs, and retrieval metadata.

2. **Revise (POST `/api/briefings/:id/revise`)**
   - Accepts freeform feedback + optional pinned points + excluded URLs.
   - Claude rewrites the JSON while keeping pins and removing exclusions.

3. **Evidence Drawer**
   - Fetches cached content via `/api/enrich` if a source lacks full text. Displays excerpts and “cached at” timestamps.

4. **Source Detail Drawer**
   - Reuses `/api/enrich` to fetch or refresh a single source on demand.

5. **Legacy outline flow** (`/api/reports`, `/api/reports/:id/finalize`) remains available but is no longer used by the Compose chat UI.

Recency bias is tuned to prefer very recent items (explicit instructions in prompts); older sources surface only when clearly superior.

---

## Backend Summary
- **Stack:** Node 18+, Express, better-sqlite3. Data lives in `server/data/whisperer.sqlite` (WAL mode).
- **Key tables:**
  - `sources` – metadata for each article/podcast, including `starred_at` and `hidden_at` timestamps.
  - `contents` – cached full text/transcripts (`enriched_at` timestamp).
  - `embeddings` – per-source embedding vector (provider/model stored alongside JSON-serialized Float32 array).
  - `reports` – generated briefings / reasoning history.
  - `talking_points` – saved talking points with headlines, body text, tags, and edit distance tracking.
  - `source_notes` – AI-generated talking points for starred sources.
- **Endpoints:**
  - `POST /api/ingest` – apply feed policies, upsert sources (optional global cap via `MAX_SOURCES_PER_RUN`).
  - `GET /api/sources` – list by date window or relative `since`/`limit`.
  - `DELETE /api/sources/:id` – remove a source (cascades cached content + embeddings).
  - `POST /api/sources/:id/star` – star a source and generate talking point notes.
  - `DELETE /api/sources/:id/star` – unstar a source.
  - `POST /api/sources/:id/hide` – hide a source from AI selection.
  - `DELETE /api/sources/:id/hide` – unhide a source.
  - `GET /api/sources/:id/note` – get AI-generated notes for a starred source.
  - `POST /api/enrich` – fetch/cache full content for specific `sourceIds` (supports `force` refresh).
  - `GET /api/search` – ranked retrieval endpoint (FTS + recency + optional embeddings) used by the server before prompting.
  - `POST /api/briefings` – curated draft (retrieval → enrichment → Claude call → persist).
  - `POST /api/briefings/:id/revise` – regenerate with feedback/pins/exclusions.
  - `GET /api/talking-points` – list saved talking points.
  - `POST /api/talking-points` – create a new talking point.
  - `PUT /api/talking-points/:id` – update a talking point.
  - `DELETE /api/talking-points/:id` – delete a talking point.
  - `GET /api/talking-points/metrics` – get metrics on saved talking points (tags, daily counts, edit distance).
  - `GET /api/stats` – get overall stats (total sources, enriched sources, reports, talking points).
  - `POST /api/reports` / `POST /api/reports/:id/finalize` – outline-first legacy path.
- **Env keys:**
  - `ANTHROPIC_API_KEY` (Claude), `OPENAI_API_KEY` (embeddings), `EMBEDDINGS_PROVIDER`/`EMBEDDING_MODEL`, `RECENCY_HALFLIFE_DAYS`, `MAX_SOURCES_PER_RUN` (set `0` to disable global cap), `DATABASE_PATH`, `PORT`.

---

## Frontend Summary
- **Tech:** React (hooks), Vite, bootstrap-icons, vanilla CSS.
- **State management:** all in `App.jsx` — config, source list, progress, chat history, briefing, evidence cache, drawers.
- **Services:**
  - `fetchAllSources` handles live feed fetching, date enforcement, and attaches `feedKey` metadata for the backend.
  - `backend.js` wraps REST calls (`ingest`, `listSources`, `briefings`, `revise`, `enrich`).
  - `emailFormatter.js` produces HTML for the preview.
- **Caching:** evidence + source detail drawers share a memoized cache keyed by source ID to avoid duplicate `/api/enrich` calls.
- **Progress UI:** now reports the true count of loaded items (no more “~expected total” guess).

---

## Open Questions / Next Steps
- Improve article extraction (Readability-style parsing) for higher fidelity.
- Expand embeddings support beyond OpenAI (e.g., Cohere, local models) and surface debug info in the UI.
- Consider auto-refresh scheduling or background jobs for source ingestion.
- Add filtering/sorting in the Sources table (by recency, type, feed).
- Explore direct publishing options (email, Slack) once executive briefings stabilize.
