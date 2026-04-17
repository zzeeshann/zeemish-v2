# ZEEMISH v2 — Project Brief

## What Zeemish is

Zeemish is an autonomous learning platform that turns today's real-world news into daily educational pieces — teaching ordinary people the systems, patterns, and ideas behind what's actually happening in the world.

**The Zeemish Protocol: "Educate myself for humble decisions."**

Every morning, a team of 13 AI agents scans the news, picks the most teachable story, writes a 10-minute piece explaining the underlying system (not just the headline), audits it for voice, accuracy, and structure, generates audio, and publishes — all autonomously. The human (Zishan) sets direction, watches the dashboard, and intervenes only when needed.

The news is the hook. The teaching is the substance. "Here's what happened" is CNN. "Here's why it happened and how the underlying thing works" is Zeemish.

## Who it's for

Ordinary people who want to understand the world they live in. Not experts. Not students cramming for exams. Adults who know something is going on — with AI, with money, with power, with systems — and want to actually understand it. Willing to give 10 minutes a day. Not willing to wade through jargon, tribes, or self-help language.

## The voice

- Plain English. No jargon without immediate translation.
- No tribe words: no "mindfulness," "journey," "empower," "transform," "wellness," "unlock," "dive in," "embrace."
- Short sentences. Direct. Honest. No flattery.
- Specific beats general. Numbers, examples, research.
- Trust the reader. Never tell them they're doing great.
- The hospitality principle: a Hindu grandmother in Delhi, a Muslim teenager in Bradford, an atheist programmer in Berlin, a Catholic nurse in Manila — they should all read the same piece and feel it was written for them.

## The daily piece format

One piece per day. 1000-1500 words. 4-6 beats:

1. **Hook** — the news, in 2 sentences, then the question that turns it into a lesson
2. **Teaching (2-3 beats)** — the underlying system explained in plain English
3. **Watch** — what to look for next, one paragraph
4. **Close** — one sentence that lands
5. **Optional: exercise** — interactive element if the subject earns one

Weekdays: news-driven. Weekends: evergreen pieces on deeper subjects.

## The agent team

| Agent | Job |
|-------|-----|
| Scanner | Fetches news RSS, deduplicates, stores candidates |
| Director | Picks most teachable story, writes brief |
| Curator | Structures the piece into beats |
| Drafter | Writes MDX (voice contract + learnings loaded) |
| Voice Auditor | Checks voice compliance, score ≥85 to pass |
| Fact Checker | Verifies claims via web search, zero unverified allowed |
| Structure Editor | Reviews hook, beats, pacing, close |
| Integrator | Merges feedback, revises, max 3 loops |
| Audio Producer | Generates MP3 per beat via ElevenLabs |
| Audio Auditor | Checks pronunciation and pacing |
| Publisher | Commits to GitHub, triggers Astro build, piece goes live |
| Engagement Analyst | Watches reader data, flags weak pieces |
| Reviser | Proposes improvements based on engagement signals |
| Observer | Daily digest for Zishan — what agents did, any issues |

Quality gates: nothing publishes unless Voice Auditor, Fact Checker, AND Structure Editor all approve. Self-improvement: engagement data feeds back into Drafter prompts via a learnings database.

## The stack

- **Frontend:** Astro + MDX + Tailwind CSS + Web Components + TypeScript strict
- **Backend:** Cloudflare Workers + D1 (SQLite) + R2 (audio storage)
- **Agents:** Cloudflare Agents SDK + Workflows v2 (Durable Objects)
- **AI:** Anthropic Claude (Sonnet default, Opus for hard subjects)
- **Audio:** ElevenLabs (one locked voice)
- **Deploy:** GitHub Actions → Cloudflare

## Site structure

- **Daily** (`/daily/`) — today's piece, prominent
- **Library** (`/library/`) — all published pieces, newest first, browsable by subject later
- **Dashboard** (`/dashboard/`) — admin only, pipeline status + analytics
- **Account** (`/account/`) — user progress, settings, login

## Design

- Warm cream background (#FAF8F4), dark ink text (#1A1A1A), deep teal accent (#1A6B62), muted gold secondary (#C49A1A)
- DM Sans body font, clean and readable
- Optimised for long-form reading on mobile (Android primary test device)
- No dark mode (cream is the brand)
- Generous whitespace, slow animations, things that breathe

## Hard rules for Claude Code

- Follow the committed architecture. Don't propose alternatives without a strong reason.
- TypeScript strict mode everywhere.
- No new dependencies without stating the pain they remove.
- Small commits, clear messages that explain WHY not WHAT.
- Explain significant decisions as you build — Zishan is learning best practices.
- Maintain living documentation inside the repo: CLAUDE.md, docs/ARCHITECTURE.md, docs/DECISIONS.md, docs/SCHEMA.md, docs/RUNBOOK.md, docs/AGENTS.md.
- Update docs alongside code in the same commit, not after.
- Never suggest "let me refactor everything." Incremental commits.
- When in doubt: "Does this help someone educate themselves for humble decisions?" If yes, ship it. If no, cut it.

## Current state

Stage 3 complete. Auth, progress tracking, D1 database working. QA fixes in progress. Dashboard being built. Daily piece pipeline operational. Preparing for GitHub commit and public deploy.

## Key documents in the repo

- `CLAUDE.md` — start here. What was last worked on, current state, known issues.
- `docs/ARCHITECTURE.md` — living architecture reference
- `docs/DECISIONS.md` — append-only decision log
- `docs/AGENTS.md` — each agent documented
- `docs/SCHEMA.md` — D1 tables explained
- `docs/RUNBOOK.md` — how to run, deploy, trigger, revert
- `content/voice-contract.md` — the voice rules, versioned

## What Zeemish becomes over time

After 1 month: 30 pieces. A habit.
After 6 months: 180 pieces. A real library, clustered by subject.
After 1 year: 365 pieces. An encyclopaedia of "how the world actually works."
After 3 years: 1000+ pieces. Searchable. Curated reading paths. A resource that gets more valuable every single day.

Not a course platform. Not a news site. A daily practice of understanding, produced autonomously, growing forever.

**Hope. Trust. Progress.**
