# Whisperer – Current Product Notes

## What the App Does (Today)
Whisperer is a two-part app: a React front end for composing executive briefings and a small Node/SQLite backend that stores and serves the source library. The happy path looks like this:

1. Open the UI and (optionally) tweak settings via the right-hand gear drawer.
2. Hit **Add Sources** from the Sources tab to ingest new articles/podcasts for the chosen date range.
3. Review/delete sources in the Sources tab as needed.
4. In Compose, write the briefing prompt and click **Generate Outline**.
5. Review the AI outline, inspect supporting evidence, provide feedback.
6. Generate talking points — the email preview updates live.

The flow is optimized around “write a one-line prompt → get an outline → quickly refine → produce an email.”

---

## UI Overview

### Global Layout
- **Top bar:** Whisperer title, view tabs (Compose / Sources), gear icon (opens the settings drawer). Settings are hidden by default.
- **Compose view:** split into a main column (prompt + outline) and a side column (email preview + workflow status + evidence button).
- **Sources view:** single table page showing everything currently in the DB.

### Settings Drawer (right slide-out)
- **Podcast provider:** Apple Podcasts (default) or Listen Notes.
- **Time range:** start/end date pickers; defaults to “today” and “today minus 6 days.” These dates govern ingestion and reporting.
- **Sources:** checkboxes grouped by Podcasts, News & Research, and Web Searches (Tavily lives here and is disabled by default).
- **Save button:** persists settings to `localStorage` (`Saved!` feedback on success).

### Compose Card
- Single textarea prompt field (Briefing Prompt) for persona, instructions, and focus.
- Buttons
  - **Generate Outline** – calls the backend report endpoint using the selected date window.
  - **Generate Briefing** – runs the end-to-end flow using whatever sources are already in the table.
- Summary chips (total sources, processed count, selections, active date window).

### Outline + Evidence
- Outline panel shows bullets and a “View Sources” button (opens the evidence drawer with per-bullet citations).
- Feedback textarea drives the “Generate Talking Points” call.

### Sources Tab
- **Add Sources** (primary button): fetches new items and upserts them into SQLite (cap of `MAX_SOURCES_PER_RUN`, default 42).
- Table columns: Title, Source, Date, AI flag, Actions (trash icon deletes the row/back-end record).
- Row errors surface feed/Tavily failures.

---

## Source Ingestion
- Triggered manually via **Add Sources** on the Sources tab. No auto-refresh on load.
- Respects the current date window (`startDate` → `endDate`). If none provided, defaults to “last 7 days ending today.”
- Each configured feed/podcast/search fetch runs in parallel; results are deduped by canonical URL/content hash.
- Successful items are written to `server/data/whisperer.sqlite` with a per-run cap (`MAX_SOURCES_PER_RUN`, default 42). Response returns `{ inserted, capped }` for UI messaging.
- Rows can be removed via the trash icon (DELETE endpoint); removal updates state immediately.

### Feeds & Search
- **Podcasts:** Apple Podcasts (default) with Listen Notes fallback.
- **News/Research:** curated RSS feeds (OpenAI, Anthropic, Google AI, etc.).
- **Web Searches:** Tavily (disabled by default); additional search providers can be added to the Web section later.

---

## AI Workflow
1. **Outline generation** (`POST /api/reports`)
   - Pulls sources limited by the active date range or a relative fallback (`since = '-14 days'`).
   - Claude first selects the most relevant items, then drafts a 9-bullet outline.
   - Outline + reasoning stored in `reports` table; UI stores `reportMeta` (ids & URLs).
2. **Talking points** (`POST /api/reports/:id/finalize`)
   - Uses selected source IDs + user feedback to produce summary and detailed bullets.
   - Email preview renders the JSON response along with citations.

Evidence drawer shows all sources flagged as selected — opening it does not trigger additional API calls.

---

## Backend Summary
- **Tech:** Node 18+, Express, better-sqlite3 (file: `data/whisperer.sqlite`).
- **Endpoints:**
  - `POST /api/ingest` – ingest batch, returns inserted count.
  - `GET /api/sources` – accepts `start`, `end`, or `since` + `limit`.
  - `DELETE /api/sources/:id` – removes a row.
  - `POST /api/reports` – outline creation (supports absolute date range).
  - `POST /api/reports/:id/finalize` – final talking points.
- History: date filtering handled in SQL via `selectSourcesByDateStmt` when explicit start/end provided.

---

## Frontend Summary
- **React + Vite + hooks**, bootstrap-icons for lightweight icons.
- `App.jsx` orchestrates state (config, sources, progress, errors) and view switching.
- Key helpers:
  - `fetchAllSources` (with optional `dateRange` override) enforces start/end.
  - `mergeSourceLists` dedupes while preserving selection status.
  - `resolveDateRange` builds defaults + guards invalid combos.
- Evidence drawer & settings drawer are independent overlays rendered alongside the main layout.
- All settings persist into `CONFIG_PERSIST_KEY` (`localStorage`).

---

## Things To Watch / Next Candidates
- Background jobs or scheduler if we want passive updates instead of manual “Add Sources.”
- Bulk delete and pinning/favoriting sources for better curation.
- Additional web search providers alongside Tavily.
- Export/sync (e.g., send email, push to Slack) once the talking points flow is stable.
