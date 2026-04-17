# ZEEMISH v2 — Dashboard Specification

The dashboard is two things: a public transparency layer showing readers how content gets made, and a private admin panel for Zishan to operate the system. Same URL, two levels.

---

## The idea

Most platforms hide their machinery. Zeemish shows it. A reader who wonders "how does this site work?" clicks Dashboard and sees the agents, the scores, the pipeline. Transparency is the brand. Trust is built by showing the work.

**Public:** anyone can see the factory floor.
**Admin:** only Zishan can press the buttons.

---

## URL structure

```
/dashboard/              → public view (no login required)
/dashboard/admin/        → admin view (ADMIN_EMAIL login required)
```

---

## Public dashboard (`/dashboard/`)

No login. Anyone can visit. Shows how Zeemish works and what it did today.

### Section 1 — Today's pipeline

A clean status card showing:

- **Status indicator** — "Published" (green) / "In progress" (amber) / "Failed" (red) / "Scheduled" (grey)
- **Today's piece title** — linked to the piece
- **Timeline** — when each agent ran:
  - Scanner: 2:01 AM
  - Director: 2:16 AM  
  - Curator: 2:32 AM
  - Drafter: 2:45 AM
  - Auditors: 2:58 AM
  - Audio: 3:12 AM
  - Published: 3:47 AM
- **Total pipeline time** — "1 hour 46 minutes from scan to live"
- **Revision passes** — "1 revision (Voice Auditor flagged 'embrace' in beat 3)"

Keep it visual. A horizontal timeline or simple vertical list with timestamps. Not a table.

### Section 2 — Quality scores

For today's piece (and expandable to recent pieces):

- **Voice score** — 91/100 (with a simple bar or number)
- **Fact check** — Verified (green checkmark) or "2 claims flagged" (amber)
- **Structure** — Approved (green) or "Hook revised" (amber)

No jargon. A reader should understand what these mean without explanation. If needed, a small tooltip: "Voice score measures how well the piece follows Zeemish's writing principles."

### Section 3 — The agent team

A clean list of all 13 agents with one-line descriptions. Always visible, not collapsible. This is how readers learn what Zeemish actually is.

| Agent | What it does |
|-------|-------------|
| Scanner | Reads the news every morning |
| Director | Picks the most teachable story |
| Curator | Plans the lesson structure |
| Drafter | Writes the piece |
| Voice Auditor | Checks it sounds like Zeemish |
| Fact Checker | Verifies every claim |
| Structure Editor | Reviews the flow and pacing |
| Integrator | Handles revisions |
| Audio Producer | Generates the audio version |
| Audio Auditor | Checks pronunciation |
| Publisher | Puts it live on the site |
| Engagement Analyst | Watches how readers interact |
| Reviser | Improves weak pieces over time |

Don't show the Observer here — it's internal to Zishan.

### Section 4 — Library stats

Simple counters:

- **Pieces published** — "47 pieces and counting"
- **Subjects covered** — "Economics, Technology, Health, Psychology, Systems" (auto-generated from piece tags)
- **Days running** — "Running since April 2026"
- **Average voice score** — "92/100 average"

### Section 5 — Recent pieces

The last 7 published pieces in a simple list:

- Date
- Title (linked)
- Voice score
- Subject tag

No description. Just enough to see the pattern of what's been published.

### Design

Same cream background, teal accents, DM Sans font as the rest of the site. Clean, minimal, generous whitespace. Not a Grafana dashboard — a reading page that happens to show data. Mobile-friendly. No charts unless they genuinely help (a simple bar for voice scores is fine; a complex multi-axis chart is not).

One line at the bottom of the public dashboard: *"Zeemish is produced by a team of AI agents, guided by one human. Every piece is audited for voice, accuracy, and structure before it goes live. No piece publishes without passing all three."*

---

## Admin dashboard (`/dashboard/admin/`)

Behind ADMIN_EMAIL login. Only Zishan sees this. This is the control room.

### Access

- Stored as a Cloudflare Secret: `wrangler secret put ADMIN_EMAIL`
- User logs in via magic link (Resend)
- Worker checks if logged-in email matches ADMIN_EMAIL
- If yes: admin view loads
- If no: redirect to public dashboard
- Session persists via secure httpOnly cookie

### Section 1 — Pipeline controls

- **Manual trigger button** — kicks off the full pipeline on demand (for testing, or if the scheduled run failed)
- **Force re-run button** — re-runs today's pipeline from a specific agent (e.g., "re-run from Drafter" if you want a different take)
- **Skip today button** — marks today as skipped, publishes a "from the archive" piece instead
- **Pipeline schedule** — shows current cron schedule (2:00-4:00 AM UTC), editable

### Section 2 — Observer events

The Observer's messages, newest first. Each event shows:

- **Severity** — info (grey), warn (amber), escalation (red), approval needed (teal)
- **Title** — one-line summary
- **Body** — full message, expandable
- **Acknowledge button** — marks the event as read
- **Context links** — links to the relevant piece, task, or agent log

Unacknowledged events appear at the top with a highlight. A counter in the nav: "Dashboard (3)" if there are 3 unacknowledged events.

### Section 3 — Analytics

Reader data. Private because it contains aggregate user behaviour.

- **Views per piece** (last 7 and 30 days) — simple bar chart or table
- **Completion rate per piece** — % of readers who reached the last beat
- **Beat drop-off** — for each piece, which beat loses the most readers (shown as a small funnel or list)
- **Audio vs text** — % who play audio vs read text, per piece
- **Return rate** — % of readers who came back the next day
- **Top 5 pieces** (last 30 days) — by completion rate, not views. Completion is what matters.
- **Total unique readers** — daily, weekly, monthly

Keep analytics simple for v1. Tables and simple bars. No complex visualisations. The data is more important than the charts.

### Section 4 — Agent health

A status page for the agent team:

- **Last run time** per agent
- **Success/failure** for last 7 days (simple green/red dots)
- **Average time per agent** (is something getting slower?)
- **Error log** — last 10 errors across all agents, with stack traces if available
- **Cost tracker** — estimated Claude API cost today, this week, this month

### Section 5 — Voice contract management

- **Current voice contract** — displayed, editable in-place
- **Version history** — list of past versions with dates
- **Pending prompt changes** — if the Director has proposed a Drafter prompt edit, it shows here for approval
- **Approve / reject buttons** for pending changes

This is the single most important admin feature. The voice contract is what keeps Zeemish being Zeemish. Making it easy to read, edit, and version from the dashboard means Zishan actually does it.

### Section 6 — Subject values

- **Current subject preferences** — the `subject-values.json` content, editable
- **Director's gap analysis** — which subjects have few pieces, which are well-covered
- **Proposed next subjects** — if the Director is suggesting new directions based on news patterns

---

## Technical implementation

### Data sources

All dashboard data comes from existing D1 tables:

- `agent_tasks` → pipeline timeline, agent health, success/failure
- `audit_results` → voice scores, fact check results, structure approvals  
- `observer_events` → Observer messages
- `engagement` → reader analytics
- `daily_pieces` → piece metadata, library stats
- `daily_candidates` → what the Scanner found, what the Director picked
- `learnings` → agent improvement data

No new tables needed. Just read queries.

### API endpoints

```
GET  /api/dashboard/today          → today's pipeline status + scores
GET  /api/dashboard/recent         → last 7 pieces with scores
GET  /api/dashboard/agents         → agent health status
GET  /api/dashboard/stats          → library counters

# Admin only (ADMIN_EMAIL check):
GET  /api/dashboard/analytics      → reader engagement data
GET  /api/dashboard/observer       → Observer events
POST /api/dashboard/trigger        → manual pipeline trigger
POST /api/dashboard/skip           → skip today
POST /api/dashboard/acknowledge    → acknowledge Observer event
GET  /api/dashboard/voice-contract → current voice contract
PUT  /api/dashboard/voice-contract → update voice contract
GET  /api/dashboard/subject-values → current subject preferences
PUT  /api/dashboard/subject-values → update subject preferences
POST /api/dashboard/approve-prompt → approve a pending prompt change
POST /api/dashboard/reject-prompt  → reject a pending prompt change
```

### Rendering

The public dashboard is a static Astro page that fetches data client-side from the API endpoints. This keeps the page fast (static HTML loads instantly, data fills in after). Use simple fetch calls, no heavy framework.

The admin section loads only after authentication is confirmed. Same approach — static page shell, data loaded via API.

---

## What this is NOT

- Not Grafana. Not Datadog. Not a monitoring platform.
- No real-time streaming updates (polling every 60 seconds is fine)
- No complex charts or dashboards. Tables, numbers, simple bars.
- No configuration management beyond voice contract and subject values
- No user management (there's one admin — you)
- No multi-tenant anything

---

## Build order

1. **Public dashboard first** — today's status, quality scores, agent team, library stats, recent pieces. This is the "show the factory floor" moment.
2. **Admin auth** — ADMIN_EMAIL secret, magic link login, session cookie, gate the admin section.
3. **Admin pipeline controls** — manual trigger, skip, Observer events.
4. **Admin analytics** — reader data, completion rates, drop-offs.
5. **Admin voice contract** — editable, versioned, with pending prompt approvals.
6. **Admin subject values** — editable, with Director's gap analysis.

Steps 1-3 are essential. Steps 4-6 are valuable but can come after launch.

---

## One line to remember

The public dashboard answers: *"How does Zeemish work?"*
The admin dashboard answers: *"Is Zeemish working?"*

Both questions matter. Both deserve clean, honest answers.

---

*End of dashboard spec. Give this to Claude Code alongside the instructions doc.*
