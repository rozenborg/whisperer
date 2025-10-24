# Whisperer UI

React implementation of the Whisperer MVP. Launch the app locally, iterate on the flow, and connect real APIs when you are ready.

## Quick Start

```bash
cd whisperer-ui
npm install
npm run dev
```

The dev server runs on `http://localhost:5173`. `npm run build` outputs a production bundle.

To enable the tiny backend (for ingestion and reports), in a second terminal:

```
cd ../server
npm install
cp .env.example .env   # set ANTHROPIC_API_KEY
npm run dev
```

Then add this to `whisperer-ui/.env.local`:

```
VITE_BACKEND_BASE=http://localhost:8787
VITE_MAX_SOURCES_PER_RUN=42
```

## Environment Variables

Create `whisperer-ui/.env.local` and add:

```
ANTHROPIC_API_KEY=sk-ant-xxxx
# Optional: remove this once you switch fully to the proxy
VITE_ANTHROPIC_KEY=sk-ant-xxxx
VITE_TAVILY_KEY=tvly-xxxx
VITE_ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
VITE_RSS_PROXY_URL=https://api.allorigins.win/raw?url=
VITE_LISTEN_NOTES_KEY=ln-xxxx
VITE_LISTEN_NOTES_NOPRIORS_ID=f7e941ea4371421c98ad5f36cd18f98a
VITE_LISTEN_NOTES_A16Z_ID=37c80af23f34406a9999dd749a63988f
VITE_LISTEN_NOTES_DWARKESH_ID=c5527633a7084bd1ba292af3dc18c35f
VITE_LISTEN_NOTES_LEX_ID=23e2be3c56e64dcdbb0cff3cedca4c95
VITE_LISTEN_NOTES_TWIML_ID=51f6ce503750485ba02bb60193feef49
VITE_LISTEN_NOTES_THIS_DAY_ID=7096d6e9e2304680abbbd1b8411f4db7
VITE_LISTEN_NOTES_LATENT_ID=25e6efa22a424ee78ab62bdb620baa9e
VITE_LISTEN_NOTES_MLST_ID=5559e08a3cf24c5ebdadb7ca61d9c7e9
VITE_LISTEN_NOTES_YC_ID=89938ec707e6466f81cc2a74b21842a1
VITE_LISTEN_NOTES_TRAINING_ID=f05f2599c25340d68233b27cfb4bdc0a
VITE_LISTEN_NOTES_DEEPMIND_ID=c13ff0b1755b4fa7aa2a0166e5340599
# Optional: override Apple Podcasts collection IDs (defaults are bundled)
VITE_ITUNES_NOPRIORS_ID=1668002688
VITE_ITUNES_A16Z_ID=842818711
VITE_ITUNES_DWARKESH_ID=1516093381
VITE_ITUNES_LEX_ID=1434243584
VITE_ITUNES_TWIML_ID=1116303051
VITE_ITUNES_THIS_DAY_ID=1671087656
VITE_ITUNES_LATENT_ID=1674008350
VITE_ITUNES_MLST_ID=1510472996
VITE_ITUNES_YC_ID=1236907421
VITE_ITUNES_TRAINING_ID=1750736528
VITE_ITUNES_DEEPMIND_ID=1476316441
VITE_BACKEND_BASE=http://localhost:8787
```

- Set `ANTHROPIC_API_KEY` for the built-in Anthropic proxy (the key never ships to the browser). Keep `VITE_ANTHROPIC_KEY` only if you need legacy behaviour.
- Tavily keys are required; the app surfaces inline errors if missing.
- `VITE_RSS_PROXY_URL` is optional but recommended in browsers to bypass RSS feeds that block cross-origin requests.
- Listen Notes values are needed for podcast sourcing (No Priors, a16z, Dwarkesh, Lex Fridman, TWIML, This Day in AI, Latent Space, Machine Learning Street Talk, Y Combinator, Training Data, Google DeepMind by default); swap in the IDs for whatever shows you want to track.
- Apple Podcasts IDs can stay unset—the defaults above are baked into the app. Add overrides if you prefer different feeds.
- The model variable is optional; remove or change if you want a different Claude release.
- Set `VITE_BACKEND_BASE` to use the tiny backend for ingestion and reports.
- Per-run cap: UI and backend enforce `up to 42` items per database update. Override with `VITE_MAX_SOURCES_PER_RUN` (UI) and `MAX_SOURCES_PER_RUN` (server).

Restart the dev server after updating environment variables.

## Project Structure

```
src/
  App.jsx                # Main orchestration and state machine
  components/            # Config panel, sources table, email preview
  services/              # Source fetchers, Claude integration, email formatter
  styles/                # App-level styling
```

- Source fetchers call live RSS feeds and Tavily; errors surface in the UI if endpoints fail.
- Pick the podcast source from the Configuration panel (`Listen Notes` or `Apple Podcasts Search`) if you hit Listen Notes limits.
- Claude helpers require a valid Anthropic key and will error when the API request fails.

## Next Steps

1. Confirm RSS feeds and Tavily calls work in your browser (some endpoints may need a proxy).
2. Monitor Anthropic usage and adjust model/token limits as needed.
3. Enable email sending in a follow-up iteration.

## Workflow Summary

- Fetch Sources → preview items without affecting the database.
- Update Database → fetch and upsert up to 42 deduped items into the local DB.
- Create Report (Outline) → curate from the DB and draft 9 bullets.
- Generate Talking Points → produce summary + bullets with citations; refine via feedback.
