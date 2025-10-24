# Whisperer - MVP PRD

## What We're Building

Whisperer is a simple web app where you click "Generate Briefing" and it:
1. Fetches sources from RSS/APIs (~30 items)
2. Shows them in a table as they load
3. Uses Claude to pick the best 4-8 items
4. Generates an executive email briefing
5. Shows you the email preview with a "Send" button (non-functional in v1)

**Philosophy:** Bias towards simplicity and speed of building/testing. Get something working, then iterate.

**Tech stack:** React app with direct API calls (no backend)

---

## User Flow

```
Landing Page
    |
[Edit Config] -> Config panel (persona, sources, date range)
    |
[Generate Briefing] button clicked
    |
Loading state: "Fetching sources..." (shows progress)
    |
Sources Table: Shows all ~30 sources as they load
    |
Loading state: "AI is curating..."
    |
Selected Sources: Highlights 4-8 items Claude picked
    |
Loading state: "Generating briefing..."
    |
Email Preview: Full formatted email
    |
[Send to Email] button (shows "Coming soon" in v1)
```

---

## UI Components

### 1. Config Panel (Editable)

```
+-----------------------------------------------+
| Configuration                                 |
+-----------------------------------------------+
|                                               |
| Executive Persona                             |
| +-------------------------------------------+ |
| | Fortune 100 Executive                    v| |
| +-------------------------------------------+ |
|                                               |
| Focus Areas (comma separated)                 |
| +-------------------------------------------+ |
| | Fintech, Enterprise AI, Regulatory         | |
| +-------------------------------------------+ |
|                                               |
| Date Range                                    |
| +-------+                                     |
| | 7     | days                                |
| +-------+                                     |
|                                               |
| Sources (checked = active)                    |
| [x] TechCrunch AI (10 items)                  |
| [x] No Priors Podcast (3 items)               |
| [x] a16z Podcast (3 items)                    |
| [x] Tavily News Search (5 items)              |
| [x] ArXiv Papers (5 items)                    |
|                                               |
|        [Generate Briefing]                    |
|                                               |
+-----------------------------------------------+
```

### 2. Sources Table (Live Updates)

```
+------------------------------------------------------------+
| Sources Found (18/30)                                      |
+----------------------------+---------------+-------+-------+
| Title                      | Source        | Date  | AI OK |
+----------------------------+---------------+-------+-------+
| AI Hits 500B Market...     | Tavily        | 10/02 |   X   |
| OpenAI DevDay Updates...   | TechCrunch    | 10/06 |       |
| Agentic AI Research...     | ArXiv         | 10/05 |   X   |
| No Priors: AI Scaling...   | Podcast       | 10/01 |   X   |
| ...                        | ...           | ...   |       |
+------------------------------------------------------------+

Status: Fetching sources... (18 of ~30 complete)
```

### 3. Email Preview

```
+------------------------------------------------------------+
| Email Preview                                              |
+------------------------------------------------------------+
|                                                            |
|  AI EXECUTIVE BRIEFING                                     |
|  October 11, 2025                                          |
|  ======================================================    |
|                                                            |
|  EXECUTIVE SUMMARY                                         |
|  Current AI market shows 500B valuation...                 |
|                                                            |
|  YOU SHOULD READ                                           |
|                                                            |
|  - AI Hits 500B Market Milestone                           |
|    [Full email content here...]                            |
|                                                            |
|  YOU SHOULD LISTEN TO                                      |
|                                                            |
|  - No Priors: Scaling Laws Discussion                      |
|    [Full email content here...]                            |
|                                                            |
+------------------------------------------------------------+
|                                                            |
|  [Copy to Clipboard]  [Send to Email]                      |
|                       (Coming Soon)                        |
|                                                            |
+------------------------------------------------------------+
```

---

## Technical Architecture

**Single React App** - Whisperer runs entirely in the browser

```
React App
  |- Config State
  |- Source Fetching (parallel API calls)
  |- Claude API Integration (curation + generation)
  |- Email HTML Formatting
```

**Key Decisions:**
- No backend - all API calls from browser
- State in React hooks (useState)
- Parallel source fetching for speed
- Progressive UI updates (do not wait for everything)

---

## Data Flow

### 1. State Structure

```javascript
const [config, setConfig] = useState({
  persona: 'Fortune 100 Executive',
  focusAreas: 'Fintech, Enterprise AI, Regulatory',
  dateRange: 7,
  sources: {
    techcrunch: { enabled: true, max: 10 },
    noPriors: { enabled: true, max: 3 },
    a16z: { enabled: true, max: 3 },
    tavily: { enabled: true, max: 5 },
    arxiv: { enabled: true, max: 5 }
  }
});

const [sources, setSources] = useState([]);
const [briefing, setBriefing] = useState(null);
const [status, setStatus] = useState('idle'); 
// idle, fetching, curating, generating, done
```

### 2. Source Schema

```javascript
{
  id: 'unique-id',
  title: string,
  url: string,
  source: string,
  date: 'YYYY-MM-DD',
  description: string,
  sourceType: 'RSS' | 'Tavily' | 'ArXiv',
  selected: boolean  // marked by Claude
}
```

### 3. Briefing Schema

```javascript
{
  summary: string,
  points: [
    {
      title: string,
      url: string,
      type: 'Article' | 'Podcast' | 'Research',
      insight: string,
      implication: string
    }
  ],
  generatedAt: timestamp
}
```

---

## API Integration

### Sources to Fetch

**RSS Feeds:**
- `https://techcrunch.com/category/artificial-intelligence/feed/`
- `https://feeds.megaphone.fm/sciencevs` (No Priors)
- `https://feeds.simplecast.com/JGE3yC0M` (a16z)
- `https://lexfridman.com/feed/podcast/` (Lex Fridman)
- `https://feeds.megaphone.fm/WWO3519750118` (Invest Like the Best)

**Tavily API:**
```javascript
POST https://api.tavily.com/search
{
  api_key: env.TAVILY_KEY,
  query: 'AI breakthroughs 2025',
  max_results: 5,
  topic: 'news'
}
```

**ArXiv API:**
```javascript
GET http://export.arxiv.org/api/query?
  search_query=cat:cs.AI&
  max_results=5&
  sortBy=submittedDate&
  sortOrder=descending
```

### Claude API Calls

**Curation:**
```javascript
POST https://api.anthropic.com/v1/messages
Headers: {
  'x-api-key': env.ANTHROPIC_KEY,
  'anthropic-version': '2023-06-01',
  'content-type': 'application/json'
}
Body: {
  model: 'claude-sonnet-4-20250514',
  max_tokens: 2000,
  messages: [{
    role: 'user',
    content: [curation prompt with all sources]
  }]
}
```

**Talking Points:**
```javascript
// Same endpoint, different prompt
// Input: selected sources
// Output: formatted talking points JSON
```

---

## Prompts

### Curation Prompt

```
You are curating AI news for a [persona from config].

Focus areas: [focusAreas from config]

Sources:
[List all sources with index numbers]

Select 4-8 most strategically relevant items.

Return ONLY valid JSON (no markdown):
{
  "selected": [0, 2, 5, 7],
  "reasoning": "Brief explanation of themes"
}
```

### Talking Points Prompt

```
You are creating an executive briefing for [persona].

Selected sources:
[List selected sources with descriptions]

For each source, create a talking point.

Return ONLY valid JSON (no markdown):
{
  "summary": "1-2 sentence overview",
  "points": [
    {
      "title": "exact title",
      "url": "exact url",
      "type": "Article/Podcast/Research",
      "insight": "2-3 sentences: key strategic takeaway",
      "implication": "2-3 sentences: what this means for Fortune 100 decision-making"
    }
  ]
}
```

---

## File Structure

```
src/
|- App.jsx                  # Main component orchestration
|- components/
|  |- ConfigPanel.jsx       # Editable config UI
|  |- SourcesTable.jsx      # Live-updating sources table
|  |- EmailPreview.jsx      # Formatted email display
|- services/
|  |- fetchSources.js       # All source API calls
|  |- claudeAPI.js          # Claude integration
|  |- emailFormatter.js     # Generate HTML email
|- styles/
   |- App.css               # Simple styling
```

---

## Environment Variables

```bash
# .env.local
REACT_APP_ANTHROPIC_KEY=sk-ant-xxxxx
REACT_APP_TAVILY_KEY=tvly-xxxxx
```

---

## MVP Scope

### In Scope (v1)
- [x] Config panel (all settings editable)
- [x] Generate button triggers full flow
- [x] Sources table updates live as fetched
- [x] Claude marks selected items
- [x] Email preview with HTML formatting
- [x] Copy to clipboard button
- [x] Send button (disabled, shows tooltip)

### Out of Scope (v1)
- [ ] Actually sending email
- [ ] Saving/loading configs
- [ ] History of past briefings
- [ ] Editing email before sending
- [ ] User authentication
- [ ] Database persistence

### Phase 2 (Later)
- Send email via API (SendGrid/AWS SES)
- Save briefings to localStorage
- Edit email before sending
- Schedule automatic generation
- Multiple personas/configs

---

## Key Interactions

1. **Edit Config** -> Changes reflected immediately, no save button needed
2. **Generate Button** -> Disables during processing, shows current step
3. **Sources Load** -> Table rows appear progressively, not all at once
4. **AI Selection** -> Green checkmark (X on table) appears in table for selected items
5. **Email Preview** -> Auto-scrolls into view when ready
6. **Copy Button** -> Copies full HTML to clipboard, shows "Copied!" feedback
7. **Send Button** -> Disabled with tooltip: "Email sending coming in v2"

---

## Error Handling

**Source Fetch Fails:**
- Show error in table row
- Continue with other sources
- Do not block entire workflow

**Claude API Error:**
- Show error message
- Offer retry button
- Log error for debugging

**No Sources Found:**
- Show message: "No sources in date range, try expanding to 14 days"
- Do not attempt curation

**AI Selects 0 Items:**
- Show warning: "No relevant items found"
- Display all sources anyway
- Allow manual selection (future)

---

## Success Criteria

**Functionality:**
- [x] Fetches 25-35 sources from multiple APIs
- [x] Sources appear progressively (not all at end)
- [x] Claude successfully selects 4-8 items
- [x] Email preview is readable and properly formatted
- [x] Can copy email HTML to clipboard

**Performance:**
- [x] Sources start appearing within 5 seconds
- [x] All sources loaded within 30 seconds
- [x] UI remains responsive throughout
- [x] No hanging or frozen states

**UX:**
- [x] Config changes are intuitive
- [x] Clear visual feedback at each step
- [x] Error states are informative
- [x] Email preview looks professional

---

## Testing Strategy

**Manual Testing Checklist:**
1. Edit each config field -> verify changes work
2. Disable all sources except one -> verify it works
3. Click Generate with default config -> verify full flow
4. Check each source type appears in table
5. Verify AI checkmarks appear on some items
6. Confirm email preview looks correct
7. Test copy to clipboard
8. Try with different date ranges (3, 7, 14 days)
9. Test with bad API key -> verify error handling
10. Refresh page mid-generation -> verify graceful handling

**Edge Cases:**
- Zero sources enabled -> show error
- API rate limit hit -> show error, offer retry
- Malformed API response -> log error, continue
- Very long source titles -> truncate in table
- All sources fail -> show helpful message

---

## UI Polish (Optional)

**If time allows:**
- Loading skeleton for sources table
- Progress bar with percentage
- Toast notifications for errors
- Dark mode toggle
- Keyboard shortcuts (Cmd+G to generate)
- Export email as PDF

**Nice-to-haves:**
- Filter or search sources table
- Sort table by column
- Expand row to see full description
- Manually select or deselect sources before generation
- Preview different email styles

---

## What Happens When You Click "Generate"

```javascript
async function handleGenerate() {
  // 1. Reset state
  setSources([]);
  setBriefing(null);
  setStatus('fetching');
  
  // 2. Fetch all sources in parallel
  const sourcePromises = [];
  
  if (config.sources.techcrunch.enabled) {
    sourcePromises.push(fetchTechCrunch());
  }
  if (config.sources.tavily.enabled) {
    sourcePromises.push(fetchTavily());
  }
  // ... etc for each source
  
  // Update table as each completes
  sourcePromises.forEach(p => {
    p.then(results => {
      setSources(prev => [...prev, ...results]);
    });
  });
  
  // Wait for all to complete
  const allSources = await Promise.all(sourcePromises);
  const flatSources = allSources.flat();
  
  // 3. Claude curation
  setStatus('curating');
  const selectedIds = await curateWithClaude(flatSources);
  
  // Mark selected in table
  setSources(flatSources.map(s => ({
    ...s,
    selected: selectedIds.includes(s.id)
  })));
  
  // 4. Generate briefing
  setStatus('generating');
  const selectedSources = flatSources.filter(s => 
    selectedIds.includes(s.id)
  );
  const email = await generateBriefing(selectedSources);
  
  // 5. Done
  setBriefing(email);
  setStatus('done');
}
```

---

## Next Steps After MVP

1. **Add email sending** - Integrate SendGrid or AWS SES
2. **Persistence** - Save configs and briefings to localStorage or DB
3. **Scheduling** - Set up recurring generation (daily or weekly)
4. **Multi-user** - Add authentication, per-user configs
5. **Analytics** - Track which sources get selected most
6. **Feedback loop** - Rate sources or emails to improve curation
7. **Templates** - Multiple email formats or styles
8. **Personas** - Quick-switch between different executive profiles

---

## Development Philosophy

**Principles:**
- Ship something working quickly
- Test in browser, not just theory
- Do not over-engineer
- Real user feedback beats perfect architecture
- Iterate based on actual usage
- Build the smallest thing that works

**When in doubt:**
- Choose the simpler implementation
- Hardcode first, make configurable later
- UI polish comes after functionality
- One feature working beats three half-done
