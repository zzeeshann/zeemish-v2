# ZEEMISH v2 — Instructions for Claude Code (Post Stage 3)

Read this entire document before doing anything. Then execute in the order given.

---

## The Zeemish Protocol

Before anything else, understand what Zeemish is for. This is the soul of the project. Every design decision, every word, every agent behaviour flows from this:

**"Educate myself for humble decisions."**

Zeemish exists to help ordinary people understand the world they actually live in — so they can make better, more humble, more informed decisions. Not to impress. Not to certify. Not to gamify. To genuinely help people understand what's happening around them, through the real news of the real world, explained plainly and honestly.

This line must appear:
- In the site footer, subtly
- In the about/manifesto section if one exists
- In the voice contract as the founding purpose
- In the Observer's daily digest template as a reminder of what we're doing

It is the answer to "why does this site exist?" and every piece, every agent, every design choice must serve it.

---

## Part 1 — QA Fixes (do these FIRST, before anything else)

### 1.1 Paragraph spacing
The lesson body text is a wall of text. Add proper `margin-bottom` to `<p>` tags inside lesson content. Prose needs to breathe. Each paragraph should have clear visual separation.

### 1.2 Stray "7" under lesson title
There's a number "7" floating below the lesson title. Find what's generating it and remove it. It looks like a stray beat count or lesson number that shouldn't be visible.

### 1.3 Beat navigation styling
The "Previous 1 of 5 Next" with raw `‹` and `›` characters at the bottom is unstyled. Replace with proper styled buttons — teal accent, clear tap targets for mobile, proper spacing. This is the core mechanic of the product.

### 1.4 Beat separation
The lesson content should NOT be one long scroll. Each beat should be its own screen. The reader sees one beat at a time and presses "Next" to advance. That's the whole design. If all beats are currently visible at once, fix this — show only the current beat, hide the rest.

### 1.5 "? Ask Zita" broken icon
The question mark before "Ask Zita" looks like a broken icon or missing emoji. Either use a proper Lucide icon or remove the `?` and just show "Ask Zita" as clean text with teal accent.

### 1.6 Audio player
The audio player shows "Coming soon." If audio generation isn't wired up yet, that's fine — but style the placeholder properly. It should look intentional, not broken.

### 1.7 General pass
After fixing the above, do a full visual pass on mobile (Android viewport). Check:
- All text readable, no overflow
- All buttons have proper tap targets (minimum 44px)
- No horizontal scroll on any page
- Footer sits properly at the bottom
- Nav works on mobile (responsive)

---

## Part 2 — Content cleanup

### 2.1 Remove old course
Delete "The body you live in" course entirely. It's placeholder content from the old architecture. Remove the course JSON, any lesson MDX files associated with it, and any references to it.

### 2.2 Rename "Courses" to "Library"
- In the nav: change "Courses" to "Library"
- The `/courses/` route becomes `/library/`
- The Library page shows all published daily pieces in reverse chronological order (newest first)
- For now it's a simple list. Later we'll add subject clustering and curated reading paths
- Update all internal links and breadcrumbs

### 2.3 Nav structure
The nav should now be: **Daily · Library · Dashboard · Account**

- **Daily** — today's piece, prominent
- **Library** — all published pieces, newest first, browsable
- **Dashboard** — admin only (see Part 3)
- **Account** — user account, progress, settings

### 2.4 Home page
The home page should lead with today's daily piece prominently. Below it, a "From the library" section showing the 3-5 most recent pieces. Below that, one line: *"Educate yourself for humble decisions."*

Clean. No clutter. The piece is the product.

---

## Part 3 — Admin Dashboard

Build `/dashboard/` — the control room. Gated behind admin auth (admin cookie or token check). Two sections:

### 3.1 Pipeline section
- **Today's run status**: did the pipeline run? What time? What story was selected?
- **Today's piece summary**: title, underlying subject, word count, beat count, audit scores (voice, fact, structure)
- **Recent pieces** (last 7 days): a table showing date, title, voice score, fact score, structure score, published yes/no
- **Observer events**: list of recent Observer messages, sorted by severity. Unacknowledged events highlighted.
- **Manual trigger button**: a button that kicks off the pipeline manually for testing. Calls the Director's trigger endpoint.
- **Agent status**: which agents ran today, time taken, any errors

### 3.2 Analytics section (can be built after Pipeline)
- **Views per piece** (last 7 days)
- **Completion rate per piece** (% who reached last beat)
- **Beat drop-off**: for each piece, which beat loses the most readers
- **Audio plays vs text reads**
- **Return rate**: % of readers who come back the next day
- **Top 5 pieces by engagement** (last 30 days)

Use data from D1 tables: `agent_tasks`, `audit_results`, `observer_events`, `engagement`, `daily_pieces`, `daily_candidates`.

Keep the dashboard design consistent with the rest of the site — warm cream, teal accents, clean typography. Simple tables and numbers. No complex charting libraries unless needed.

---

## Part 4 — Documentation updates

### 4.1 Update CLAUDE.md
Add to the "current state" section:
- Stage 3 complete, QA fixes in progress
- Daily pieces are the primary content (not courses)
- Nav is now: Daily · Library · Dashboard · Account
- Old "body" course has been removed
- Dashboard is being built at `/dashboard/`
- The Zeemish Protocol: "Educate myself for humble decisions."

### 4.2 Update docs/ARCHITECTURE.md
- Reflect that courses are now secondary (curated reading paths from daily pieces, future feature)
- Primary content unit is the daily piece
- Library replaces the courses page
- Dashboard section added
- Note the Zeemish Protocol as the founding purpose

### 4.3 Update docs/DECISIONS.md
Log these decisions:
```
## 2026-04-17: Courses renamed to Library
**Context:** Daily pieces are now the primary content, not structured courses.
**Decision:** Rename Courses to Library. Library shows all daily pieces in reverse chronological order.
**Reason:** Courses imply a fixed curriculum. Library implies a growing collection. Daily pieces accumulate into the library naturally.

## 2026-04-17: "The body you live in" course removed
**Context:** Placeholder content from the old architecture before daily pieces existed.
**Decision:** Delete entirely.
**Reason:** Clean slate. No dead content on a live site.

## 2026-04-17: Dashboard added at /dashboard/
**Context:** Running an autonomous agent pipeline without visibility is dangerous.
**Decision:** Build admin dashboard with pipeline status and reader analytics.
**Reason:** You can't run a system you can't see.

## 2026-04-17: Zeemish Protocol established
**Context:** Zishan defined Zeemish's purpose in one line.
**Decision:** "Educate myself for humble decisions" is the founding protocol.
**Reason:** Every agent, every piece, every design choice serves this purpose. It's the answer to "why does this site exist?"
```

### 4.4 Update docs/RUNBOOK.md
Add:
- How to access the dashboard
- How to manually trigger the pipeline
- How to check if today's piece published successfully
- How to revert a bad piece (git revert the commit)

### 4.5 Update voice-contract.md
Add to the top of the voice contract:

```
## The Zeemish Protocol

"Educate myself for humble decisions."

Every piece serves this purpose. If a piece doesn't help someone understand the world better so they can make more humble, more informed decisions — it doesn't belong on Zeemish.
```

This becomes part of what the Voice Auditor checks against.

---

## Part 5 — Update the Daily Pieces system doc

The `ZEEMISH-DAILY-PIECES.md` in the handoff folder describes the full daily pipeline. If it hasn't been fully integrated into the architecture docs yet, do so now. Key points to ensure are documented:

- Scanner agent fetches Google News RSS at 6:00 AM UTC
- Director picks one story at 6:15 AM UTC based on teachability
- Pipeline runs 6:30-8:00 AM UTC
- Daily piece format: 4-6 beats, 1000-1500 words
- Three quality gates in parallel (voice ≥85, zero unverified facts, structure approved)
- Max 3 revision loops before escalation
- Weekend mode: evergreen pieces from subject values, not news-driven
- Skip threshold: if nothing teachable, publish "from the archive" instead
- New schema tables: `daily_candidates`, `daily_pieces`

---

## Execution order

1. **QA fixes** (Part 1) — fix all visual and functional issues
2. **Content cleanup** (Part 2) — remove old course, rename to Library, fix nav
3. **Dashboard** (Part 3) — build the admin control room
4. **Documentation** (Part 4) — update all living docs
5. **Daily Pieces integration** (Part 5) — ensure architecture docs are current

Do them in this order. Don't start Part 2 until Part 1 is verified working. Don't start Part 3 until Part 2 is clean. Commit after each part with a clear message explaining what was done and why.

---

## Reminder

This is not a prototype. This is not a demo. This is a real product being built for real people. Every pixel, every word, every interaction should feel like someone cared about it. When in doubt, ask: "Does this help someone educate themselves for humble decisions?" If yes, ship it. If no, cut it.

Hope. Trust. Progress.
