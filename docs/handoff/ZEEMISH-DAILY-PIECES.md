# ZEEMISH v2 — Daily Pieces System

How the Director reads the world and turns it into teaching, every day.

---

## The idea, plainly

Every morning, Zeemish publishes one short piece. Not a news report. Not an opinion piece. A **teaching piece** — anchored in something real that happened, but teaching the underlying system, pattern, or concept that most people don't understand.

The news is the hook. The teaching is the substance.

"A bank collapsed today" → Zeemish teaches how banking actually works, what a bank run is, why they happen, what prevents them, what doesn't.

"An AI lab released a new model" → Zeemish teaches what actually changed, what a transformer is, why this one matters or doesn't, what to watch for.

"A country's currency crashed" → Zeemish teaches what a currency is, what holds it up, why crashes happen in patterns, what history says about what happens next.

The reader gets the news *and* the education they need to actually understand it. CNN gives you the first. Coursera gives you the second, six months later, in a 40-hour course. Zeemish gives you both, in 10 minutes, the same morning.

**Nobody does this.** PBS NewsHour Classroom does news-based lessons for K-12 teachers. Newsela does levelled news reading for students. The Economist does deep analysis for experts. Nobody does "today's news → today's 10-minute lesson on the underlying system, for ordinary adults, generated autonomously by AI agents, every single day."

---

## The flow — end to end

### 6:00 AM UTC — The Scanner wakes up

A new agent: the **Scanner**. Its only job is to gather raw material.

**Sources (v1):**
- Google News RSS — top stories + TECHNOLOGY, SCIENCE, BUSINESS, HEALTH, WORLD categories
- Free, no API key, unlimited

**Sources (v2, later):**
- NewsData.io (200 free requests/day, 85k+ sources)
- The Guardian Open Platform (free, high-quality, full text)
- Hacker News front page (tech pulse)
- Reddit worldnews (crowd signal)

The Scanner fetches headlines + short descriptions from all sources. Deduplicates. Produces a list of ~30-50 candidate stories with:
- Headline
- Source
- Category (tech, science, business, health, world, politics)
- One-paragraph summary (from the RSS description or a quick Claude summary)

Saves the list to D1 as `daily_candidates` for this date.

### 6:15 AM UTC — The Director evaluates

The Director reads the candidate list and picks **one story**. Selection criteria (baked into the Director's system prompt):

1. **Teachability** — Does this story reveal an underlying system, pattern, or concept? A celebrity scandal: low teachability. A supply chain disruption: high teachability.
2. **Universality** — Will this matter to someone in Delhi, Bradford, Berlin, and Manila? A local zoning dispute: low. A global food price spike: high.
3. **Freshness** — Is this genuinely new, or a rehash of something Zeemish already covered? The Director checks the last 30 days of published pieces to avoid repetition.
4. **Depth potential** — Can the underlying concept fill 1000-1500 words of real teaching without padding? Some stories are dramatic but shallow. Skip them.
5. **No culture war** — Stories designed to provoke tribal reactions are skipped. Not because they're unimportant — because Zeemish's voice is "no passport," and these stories are all passport.

The Director produces a **brief**:

```json
{
  "date": "2026-04-17",
  "headline": "European Central Bank cuts rates for the seventh time",
  "source": "Reuters via Google News",
  "underlying_subject": "How interest rates actually work",
  "teaching_angle": "What the ECB rate cut means, why central banks change rates, how it affects mortgages and savings and jobs, why this pattern keeps repeating",
  "estimated_reading_minutes": 10,
  "tone_note": "Readers will have seen the headline. They don't need the news repeated. They need to understand the machinery behind it.",
  "exercise_idea": "Interactive: slide a rate slider and see how it affects a mortgage payment, a savings account, and unemployment — live in the page",
  "avoid": "Don't take a political position on whether the cut was right. Teach the mechanics. Let readers form their own view."
}
```

### 6:30 AM UTC — The Curator structures the piece

The Curator takes the brief and produces the **beat plan**:

```json
{
  "beats": [
    {
      "id": "hook",
      "type": "text",
      "instruction": "The news in 2 sentences. What happened. Plain English. Then the question that turns it into a lesson: 'But what is an interest rate, actually? And why does one person in Frankfurt changing a number affect your mortgage in Manchester?'"
    },
    {
      "id": "teaching-1",
      "type": "text",
      "instruction": "What an interest rate is. Not the textbook definition. The real thing: it's the price of borrowing time. You want money now, you pay a fee to get it now instead of later. That fee is the rate."
    },
    {
      "id": "teaching-2",
      "type": "text",
      "instruction": "Why a central bank changes it. The thermostat metaphor: too hot (inflation) → raise the rate to cool things down. Too cold (recession) → lower the rate to warm things up. Why it's a blunt instrument. Why it works imperfectly."
    },
    {
      "id": "exercise",
      "type": "interactive",
      "instruction": "A slider: the reader moves the interest rate. Three numbers update live — monthly mortgage payment, annual savings interest, approximate effect on unemployment. The reader FEELS the mechanism instead of just reading about it.",
      "component": "rate-slider"
    },
    {
      "id": "watch",
      "type": "text",
      "instruction": "What to watch for next. If the ECB keeps cutting, what happens. If they stop, what that means. One pattern from history that rhymes."
    },
    {
      "id": "close",
      "type": "text",
      "instruction": "One sentence. The kind that sits."
    }
  ]
}
```

### 7:00 AM UTC — The Drafter writes

The Drafter takes the beat plan + voice contract + the brief's tone note + recent learnings. Produces MDX. 1000-1500 words across all beats.

### 7:15 AM UTC — The auditors check (in parallel)

- **Voice-Auditor**: Does it sound like Zeemish? Score ≥85 to pass.
- **Fact-Checker**: Are the claims about ECB rates, mortgage mechanics, employment effects accurate? Uses web search to verify.
- **Structure-Editor**: Is the hook sharp? Are the beats paced well? Does the close land?

If all pass → forward. If any fail → Integrator revises, resubmits. Max 3 loops.

### 7:30 AM UTC — Audio generation

Audio-Producer generates MP3 per beat. Audio-Auditor checks for pronunciation issues (e.g., "ECB" should be spelled out, "Frankfurt" pronounced correctly).

### 7:45 AM UTC — Interactive component (if needed)

**New step for daily pieces.** If the beat plan includes an interactive exercise (like the rate slider), the system needs to handle it. Two options:

**Option A — Use existing components.** If a component already exists (e.g., `<zee-breathe>`, a slider, a timeline), reuse it with different parameters.

**Option B — Flag for human.** If the exercise needs a new custom component (e.g., an interest rate simulator), the piece publishes without the exercise, and the Observer flags: "Today's piece would benefit from a rate-slider component. Build it when you can, and the piece will update automatically."

For v1: Option B. The system publishes text + audio daily. Interactive components are added by you when you have time, and the piece gets better retroactively. For v2 later: an agent that can generate simple interactive components from a spec.

### 8:00 AM UTC — Publisher ships

MDX + audio committed to repo. Astro builds. Live at `zeemish.io/daily/2026-04-17/` within 60 seconds.

### 8:01 AM UTC — Observer logs

Observer writes a summary: "Published: 'How interest rates actually work' (hook: ECB rate cut). Voice: 91. Facts: verified. 1247 words. 5 beats. Audio: 9 minutes 12 seconds. No interactive component today (rate-slider flagged for manual build)."

---

## The reader's experience

### The daily page

You visit `zeemish.io` at 8:30 AM. The home page shows today's piece prominently:

**"How interest rates actually work"**
*The ECB just cut rates again. Here's what that means and why it matters to you.*
10 min read · 17 April 2026

You tap it. You read through 5-6 beats. You learn something real about how the world works. If there's an interactive exercise, you play with it. You're done in 10 minutes.

Below today's piece: the archive. Yesterday's piece. Last week's. Browseable by category. Searchable.

### Not a course. Not a curriculum. A daily habit.

There's no "lesson 1 of 12." No progress bar. No "complete the course." You come back because today's piece is always about something that just happened, and you always leave knowing something you didn't.

It's closer to a **daily newspaper column** than a course. Like reading a great columnist who happens to be a teacher.

### The archive becomes the library

After 30 days, you have 30 pieces. After a year, 365. They naturally cluster into subjects — economics, technology, health, politics, history, psychology. The archive *becomes* the library. Not designed top-down as a curriculum. Grown bottom-up from the world's daily events.

Over time, some subjects accumulate enough pieces that they deserve a curated reading path: "If you want to understand how money works, read these 12 pieces in this order." That curation can be manual (you) or agent-driven (the Director proposes paths based on topic clusters).

---

## What this changes in the architecture

### New agent: Scanner

A lightweight agent that runs first in the daily pipeline. Fetches RSS, deduplicates, stores candidates. Separate from the Director because the Scanner is a data-fetching job, not a decision-making job.

### Director redesigned

No longer plans courses from a static list. Now:
- Reads Scanner's daily candidates
- Picks one story based on teachability, universality, freshness, depth
- Writes a brief
- Checks the last 30 days to avoid repetition
- Occasionally (weekly?) proposes a curated reading path from accumulated pieces

### No more courses as the primary unit

The primary unit is the **daily piece**. Courses (curated reading paths) are a secondary feature that emerges from the archive. This is a fundamental shift from the previous architecture.

### Adjusted schema

New tables:

```sql
-- Daily candidates from the Scanner
CREATE TABLE daily_candidates (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,            -- YYYY-MM-DD
  headline TEXT NOT NULL,
  source TEXT NOT NULL,
  category TEXT,
  summary TEXT,
  teachability_score INTEGER,   -- set by Director, 0-100
  selected INTEGER DEFAULT 0,   -- 1 if Director picked this one
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_candidates_date ON daily_candidates(date);

-- Published daily pieces (extends the lesson concept)
CREATE TABLE daily_pieces (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  headline TEXT NOT NULL,
  underlying_subject TEXT NOT NULL,
  source_story TEXT NOT NULL,
  word_count INTEGER,
  beat_count INTEGER,
  voice_score INTEGER,
  fact_check_passed INTEGER,
  has_interactive INTEGER DEFAULT 0,
  reading_minutes INTEGER,
  published_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_pieces_date ON daily_pieces(date);
CREATE INDEX idx_pieces_subject ON daily_pieces(underlying_subject);
```

### Adjusted cost model

One piece per day:
- Scanner: free (RSS fetch)
- Director: ~$0.03 (Claude call to evaluate candidates)
- Curator: ~$0.02 (beat plan)
- Drafter: ~$0.07 (1500 words)
- Auditors (×3): ~$0.06
- Integrator (avg 1 pass): ~$0.05
- Audio: ~$3.00 (10 min)
- Publisher: free

**Total per day: ~$3.25. Per month: ~$100. Per year: ~$1,200.**

At scale with 1M readers, that's $0.0012 per reader per year in content production cost. Essentially free.

### Adjusted timeline

The reader-facing changes are minimal — the daily page replaces the course page as the primary surface. This is mostly a Director + Scanner redesign (2-3 days of agent work) plus a new home page layout (1 day of Astro work).

The auditors, publisher, and improvement loop work identically whether they're processing a course lesson or a daily piece. The pipeline doesn't care about the format — it processes MDX.

---

## Honest questions still open

### 1. What if nothing teachable happened today?

Some days the news is all celebrity gossip, political squabbling, and sports. The Director's selection criteria should include a **"skip" option** — if no candidate scores above a teachability threshold, the system doesn't publish. Better no piece than a forced one.

On skip days, the system could publish a **"from the archive"** piece instead — resurfacing an older piece that's relevant to something happening now.

### 2. What about weekends?

Options:
- **Publish every day** including weekends (the agents don't care)
- **Publish weekdays only** (readers may expect a break)
- **Weekdays: news-driven. Weekends: evergreen.** Saturday and Sunday pieces aren't tied to news — they're standalone teaching on subjects the Director chooses from the subject-values list. "Weekend reads" that go deeper.

Recommendation: **option 3.** It gives the system two modes — reactive (weekday) and proactive (weekend) — and lets you test both.

### 3. What about time zones?

Publishing at 8am UTC means:
- 8am in London (perfect)
- 9am in Frankfurt (good)
- 1:30pm in Delhi (fine, lunch reading)
- 4pm in Beijing (afternoon)
- 3am in New York (they wake up to it)

UTC morning works for a global audience. The piece is there when each timezone wakes up.

### 4. What about bias?

The Director's system prompt must include: **"Teach the mechanics. Don't take a position."** When the ECB cuts rates, don't say it was right or wrong. Say how it works, why they did it, what the effects are, what critics say and why. Let the reader form their own view.

This is the Zeemish "no passport" principle applied to daily news. It's the hardest thing to get right and the most important.

### 5. What about sensitive topics?

Some news stories involve death, disaster, conflict. The Director needs a sensitivity filter: **"If the story involves active human suffering (a massacre, a natural disaster with ongoing casualties, a war), lead with humanity, not mechanics. Teach the underlying system but acknowledge the cost."**

This is a voice note, not a content ban. Zeemish can and should teach about war, famine, crisis. But the tone has to earn the subject.

### 6. How do readers discover old pieces?

The archive needs three views:
- **By date** — a scrollable timeline. Today, yesterday, last week.
- **By subject** — cluster pieces by underlying topic. All the economics pieces together. All the AI pieces. All the psychology pieces.
- **Curated paths** — "Understand money in 8 pieces" — reading paths assembled from the archive, either by you or by the Director.

### 7. What about corrections?

If a piece has a factual error (the Fact-Checker missed something), the system needs a **correction flow**: mark the piece as corrected, show a note at the top ("This piece was updated on [date] to correct [what]"), and feed the error back to the Fact-Checker's learnings so it doesn't happen again.

---

## What Zeemish becomes

After one month: 22 pieces (weekdays) + 8 weekend reads. 30 pieces of real teaching.

After six months: ~180 pieces. A genuine library, grown from the world's events.

After one year: ~365 pieces. Searchable. Clustered by subject. With curated paths. A resource that gets more valuable every single day, literally.

After three years: 1,000+ pieces. An encyclopaedia of "how the world actually works," built day by day from the things that actually happened in that world.

That's Zeemish. Not a course platform. Not a news site. A **daily practice of understanding**, produced autonomously, growing forever.

---

## Summary for Claude Code

Tell Claude Code:

1. **Add a Scanner agent** — fetches Google News RSS daily, stores candidates in D1
2. **Redesign Director** — evaluates candidates by teachability, picks one, writes brief with the format above
3. **Daily piece format** — 4-6 beats, 1000-1500 words, hook from news, teaching in the middle, close that lands
4. **Home page** — today's piece prominent, archive below
5. **Archive pages** — by date, by subject, curated paths (later)
6. **Pipeline unchanged** — Curator → Drafter → Auditors → Audio → Publisher, same flow, shorter content
7. **Weekend mode** — evergreen pieces from subject-values, not news-driven
8. **Skip threshold** — if no candidate is teachable enough, publish "from the archive" instead
9. **New schema tables** — `daily_candidates`, `daily_pieces`
10. **8am UTC daily trigger** — Scanner at 6:00, Director at 6:15, pipeline 6:30-8:00, published by 8:00

---

*This document replaces the course-based content model. The pipeline, quality gates, auditors, self-improvement — all identical. Only the input (news instead of static subjects) and the output (daily pieces instead of course lessons) are different.*
