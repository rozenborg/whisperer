# Whisperer – Current Product Notes

## What the App Does (Today)
Whisperer is a two-part app: a React front end for composing executive briefings and a small Node/SQLite backend that stores and serves the source library. The happy path looks like this:

1. Open the UI and (optionally) tweak settings via the right-hand gear drawer.
2. Hit **Add Sources** from the Sources tab to ingest new articles/podcasts for the chosen date range.
3. Review/delete sources in the Sources tab as needed.
4. In Compose, write the briefing prompt and click **Generate Talking Points**.
5. Review the AI-generated briefing, inspect supporting evidence, and optionally pin/exclude bullets.
6. Provide feedback, regenerate if needed, then copy/send the final email.

The flow is optimized around “write a one-line prompt → receive talking points → iterate with feedback → produce an email executives value.”

---

## UI Overview

### Global Layout
- **Top bar:** Whisperer title, view tabs (Compose / Sources), gear icon (opens the settings drawer). Settings are hidden by default.
- **Compose view:** resizable two-column layout — the left column holds the compose prompt and feedback controls, the right column shows the email preview, status, and evidence controls.
- **Sources view:** single table page showing everything currently in the DB.

### Settings Drawer (right slide-out)
- **Podcast provider:** Apple Podcasts (default) or Listen Notes.
- **Time range:** start/end date pickers; defaults to “today” and “today minus 6 days.” These dates govern ingestion and reporting.
- **Sources:** checkboxes grouped by Podcasts, News & Research, and Web Searches (Tavily lives here and is disabled by default).
- **Save button:** persists settings to `localStorage` (`Saved!` feedback on success).

### Compose + Feedback Column (left)
- Single textarea prompt field (Briefing Prompt) for persona, instructions, and focus.
- Primary button: **Generate Talking Points** (calls the one-pass briefing endpoint for the current date range).
- Summary chips show total sources fetched, processed count, selected evidence count, and active date window.
- Feedback panel lists the current talking points with controls to **Pin** or **Exclude** individual bullets before regeneration.
- Feedback textarea + **Regenerate with Feedback** button send tone/focus adjustments back to the AI while respecting pinned/excluded items.
- Evidence button exposes the cited sources drawer; quick link duplicated in the status panel.

### Email Preview Column (right)
- **Email Preview** renders the executive-ready briefing (summary + bullets + rationale) and provides a copy action.
- **Workflow Status** panel mirrors current step (idle, fetching, generating, done), surfaces errors, and links to evidence.

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
1. **Briefing generation** (`POST /api/briefings`)
   - Pulls sources limited by the active date range or a relative fallback (`since = '-14 days'`).
   - Claude curates the most relevant items and immediately produces executive-ready talking points.
   - Final JSON (summary + points) is stored in the `reports` table; response returns selected source IDs/URLs for evidence.
2. **Regeneration with feedback** (`POST /api/briefings/:id/revise`)
   - Accepts freeform feedback plus optional pinned points and excluded URLs.
   - Claude rewrites the summary/points while keeping pinned items intact and omitting exclusions.

Evidence drawer shows all sources flagged as selected — opening it does not trigger additional API calls.

---

## Backend Summary
- **Tech:** Node 18+, Express, better-sqlite3 (file: `data/whisperer.sqlite`).
- **Endpoints:**
  - `POST /api/ingest` – ingest batch, returns inserted count.
  - `GET /api/sources` – accepts `start`, `end`, or `since` + `limit`.
  - `DELETE /api/sources/:id` – removes a row.
  - `POST /api/briefings` – curate sources + generate talking points in one pass.
  - `POST /api/briefings/:id/revise` – regenerate talking points using feedback, pins, and exclusions.
  - (Legacy) `POST /api/reports` / `POST /api/reports/:id/finalize` remain for the outline-first flow if needed.
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
