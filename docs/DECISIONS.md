# Zeemish v2 — Decision Log

Append-only. Never edit old entries.

## 2026-04-18: Un-pause audio pipeline (ship-and-retry, metadata carve-out)
**Context:** Audio Producer + Audio Auditor had been paused since build (not wired into Director's pipeline, zero ElevenLabs spend possible by accident). Text pipeline was trusted; time to un-pause.

**Decision:** Wire audio in as a phase AFTER Publisher, not before. Ship text the moment Integrator approves. Run Audio Producer → Audio Auditor → `Publisher.publishAudio` (second commit splicing `audioBeats` into frontmatter) as a best-effort chase. Failures escalate to Observer; the admin piece-deep-dive page shows a "Retry audio" button that POSTs `/audio-retry` and re-runs the audio pipeline against the committed MDX.

**Reason — ship-and-retry over atomic:** The user framed it clearly: "have you seen a day where a newspaper didn't publish?" Strict atomic (block text publish on audio failure) would let ElevenLabs outages, Workers quirks, or a one-character typo in the transcript skip a day. A daily-cadence product can't afford that. Audio is a preferred-but-not-required enhancement. Text is the contract.

**Reason — metadata carve-out:** The `publishAudio` second commit modifies an already-published MDX file. A strict reading of CLAUDE.md's "Published pieces are permanent. No agent writes to, revises, regenerates, or updates any published piece." forbids this. User's explicit clarification: the rule governs teaching **content** (beats, narrative, facts), not frontmatter **metadata** (voiceScore, qualityFlag, audioBeats). `publishToPath` still refuses to overwrite (content rule intact). `publishAudio` is the only metadata-update path.

**Decisions bundled in:**
- **Model:** stay on `eleven_multilingual_v2`. `eleven_v3` is alpha + audio tags, no prosodic stitching, wrong fit for calm teaching narration. Flash v2.5 is speed-not-quality.
- **Voice:** Frederick Surrey (`j9jfwdrw7BRfcR43Qohk`), added to "My Voices" to guard against shared-library removal.
- **Format:** `mp3_44100_96`. Indistinguishable from 128 for a single voice; ~25% smaller R2 + egress.
- **Pronunciation:** "Zeemish" → "Zee-mish" via `prepareForTTS` text substitution. SSML not supported; PLS dictionaries work on v2 only for alias rules, not IPA — text substitution is simpler and equivalent for one brand word.
- **Budget:** 20,000 chars/piece hard cap (`AudioBudgetExceededError`). Sized for a 12-beat newspaper-style piece (~$2/day at $0.10/1k chars). Checked pre-flight, before any API call.
- **Granularity:** per-beat MP3s. `<lesson-shell>` → `<audio-player>` sync lets readers jump to any beat; future 12-beat newspaper pieces work cleanly on this shape.
- **Retry:** Producer does 3-attempt exponential backoff internally on 5xx. 4xx fails fast (bad key, quota). Director escalates to Observer on any uncaught failure. Admin dashboard retry button re-runs the audio pipeline against the committed MDX.
- **Schema:** new `daily_piece_audio` table (per-beat rows) is the query source of truth. `daily_pieces.has_audio` boolean for fast dashboard filtering. Frontmatter `audioBeats` map is the render source of truth for the site. Both kept in sync by `Publisher.publishAudio`.

**References:** `migrations/0010_audio_pipeline.sql`, `agents/src/audio-producer.ts`, `agents/src/audio-auditor.ts`, `agents/src/director.ts` (`runAudioPipeline`, `retryAudio`), `agents/src/publisher.ts` (`publishAudio`), `src/interactive/audio-player.ts`, `src/components/AudioPlayer.astro`, `src/pages/audio/[...path].ts` (site worker's R2 audio route).

**Deploy-time gotcha learned 2026-04-18:** Cloudflare Static Assets intercepts unrecognised paths with the prerendered 404.html **before** the worker runs, so a middleware-only `/audio/*` handler never executed. Fix: register as a real Astro route (`src/pages/audio/[...path].ts`). Also: manual `wrangler deploy` from a local build can overwrite the auto-deploy from GitHub Actions if local state is out of sync (e.g., Publisher just pushed `audioBeats` to a piece's frontmatter on GitHub — `git pull` before rebuilding).

## 2026-04-16: Chose pnpm over npm
**Context:** Setting up the repo.
**Decision:** Use pnpm for package management.
**Reason:** Faster installs, strict dependency resolution, saves disk space. Recommended in the build guide.

## 2026-04-16: Astro output mode set to `static`
**Context:** Configuring Astro for Cloudflare deployment.
**Decision:** Use `output: 'static'` (not `server` or `hybrid`).
**Reason:** Stage 1 is a static site — no server-side rendering needed yet. Static is cheaper, faster, and simpler on Cloudflare. We'll switch to `hybrid` or `server` only when we need server-side routes (Stage 3).

## 2026-04-16: Zeemish brand colours as Tailwind theme
**Context:** Setting up Tailwind config.
**Decision:** Added `zee-bg`, `zee-text`, `zee-accent` as custom Tailwind colours.
**Reason:** Keeps the colour palette consistent across components. DM Sans set as default sans font to match brand.

## 2026-04-16: Handoff docs stored in docs/handoff/
**Context:** Planning documents from the architecture phase.
**Decision:** Copy all handoff docs into the repo at `docs/handoff/`.
**Reason:** Every future Claude Code session needs access to the architecture and build guide. Keeping them in the repo means no dependency on external file paths.

## 2026-04-16: Beats as Web Components, not Astro components
**Context:** Stage 2 — deciding how to build beat navigation.
**Decision:** Use native Web Components (`<lesson-shell>`, `<lesson-beat>`) for beat navigation.
**Reason:** Beat navigation requires client-side state (show/hide on click). Astro components are build-time only. Web Components give us progressive enhancement (all beats visible without JS) and zero framework dependency.

## 2026-04-16: Single Astro Worker instead of separate site + API workers
**Context:** Stage 3 — deciding whether to build a separate `worker/` API project.
**Decision:** Keep API routes inside Astro using `src/pages/api/` with the Cloudflare adapter.
**Reason:** Avoids CORS complexity, keeps one deploy target, simpler to develop. The architecture planned three workers but Astro handles both static and server routes natively. Can split later if scale demands it.

## 2026-04-16: PBKDF2 via Web Crypto API for password hashing
**Context:** Stage 3 — choosing a password hashing approach for Cloudflare Workers.
**Decision:** Use PBKDF2 (100k iterations, SHA-256) via the Web Crypto API.
**Reason:** Works natively in Workers runtime — no npm dependencies needed. bcrypt/argon2 would require WASM or npm packages. PBKDF2 with sufficient iterations is NIST-approved and adequate for our use case.

## 2026-04-16: Middleware only on server-rendered routes
**Context:** Stage 3 — Astro middleware was crashing on prerendered pages.
**Decision:** Auth middleware checks the URL path and only runs on `/api/`, `/account`, `/login` routes.
**Reason:** Prerendered pages don't have access to D1 at build time. The middleware creates anonymous users in D1, which can only run on server-rendered routes. Lesson pages call the API from the client side instead.

## 2026-04-16: Agents as a separate Worker
**Context:** Stage 4 — setting up the agent team.
**Decision:** The agents live in `agents/` as a separate Cloudflare Worker, not inside the Astro site.
**Reason:** The Astro adapter manages its own fetch handler. Agents need Durable Object bindings with their own wrangler.toml. Separate Workers with separate concerns. Zero cost when agents are hibernated.

## 2026-04-16: getAgentByName for RPC instead of stub.fetch()
**Context:** Stage 4 — routing HTTP requests to Durable Objects.
**Decision:** Use `getAgentByName()` from the agents SDK for typed RPC calls from the main fetch handler.
**Reason:** The Agent base class's `fetch()` method expects specific SDK headers (namespace/room). Direct RPC via `getAgentByName` gives typed method calls and avoids header confusion.

## 2026-04-16: Voice contract as TypeScript string, not .md import
**Context:** Stage 4 — agents need the voice contract text.
**Decision:** Duplicate the voice contract as a string constant in `agents/src/shared/voice-contract.ts`.
**Reason:** Wrangler's bundler has no loader for `.md` files. The canonical version stays at `content/voice-contract.md`; the TS copy is kept in sync manually.

## 2026-04-16: Agent-chosen lesson topics instead of following course spine
**Context:** Stage 5 — producing the first 12-lesson course.
**Decision:** Let the Curator agent choose lesson topics freely rather than following the original 12-lesson spine from the brief.
**Reason:** The Curator produces better, more engaging titles when given creative freedom. The original spine ("20,000 breaths", "The nose knows") was a planning guide, not a requirement. The agents produced titles like "Why you can't tickle yourself" which are more compelling and still cover the body course subject.

## 2026-04-16: Synchronous RPC instead of Cloudflare Workflows v2
**Context:** Stage 4 — implementing the publishing pipeline.
**Decision:** Use synchronous sub-agent RPC calls instead of Cloudflare Workflows v2.
**Reason:** Faster to ship. The pipeline works end-to-end as synchronous calls. Trade-off: no durable checkpoints, pipeline cannot survive Worker restarts mid-execution. Workflows v2 can be added later without changing the agent logic — just wrap the existing calls in `step.do()`.

## 2026-04-16: Zita API in Astro site worker, not agents worker
**Context:** Stage 7 — building the Zita chat guide.
**Decision:** Zita's API endpoint lives in the Astro site (`/api/zita/chat`) not in the agents worker.
**Reason:** Zita needs the user's session cookie (from the auth middleware) and their conversation history from D1. The Astro site already has both. Putting Zita in the agents worker would require cross-worker auth, adding complexity.

## 2026-04-16: Coerce estimatedTime schema to handle agent output
**Context:** Stage 5 — agent-authored lessons had `estimatedTime: 18` (number) instead of `"18 min"` (string).
**Decision:** Changed Zod schema to `z.coerce.string()` for `estimatedTime`.
**Reason:** Agent output varies. Coercing is more robust than trying to enforce exact format in agent prompts. Numbers become strings automatically.

## 2026-04-17: Frederick Surrey as the Zeemish voice
**Context:** Choosing an ElevenLabs voice for lesson audio.
**Decision:** Frederick Surrey — British, male, middle-aged, calm, narrative style.
**Reason:** Matches the Zeemish tone: calm, direct, warm but not performative. Zishan's choice.

## 2026-04-17: Audio failure doesn't block text publishing
**Context:** Wiring audio generation into the publishing pipeline.
**Decision:** If audio generation or audit fails, the text lesson still publishes. Audio failure is logged via Observer but doesn't block.
**Reason:** Audio is enhancement, not core. A published lesson without audio is better than a blocked lesson. Audio can be regenerated later.

## 2026-04-17: Audio generated once per lesson, served from R2
**Context:** Cost model for audio.
**Decision:** Generate MP3 once via ElevenLabs, store in R2 bucket. Readers stream from R2.
**Reason:** ~$5 per lesson to generate. $0 per play after that. R2 serving is essentially free at this scale.

## 2026-04-17: Cancel passphrase auth, keep magic link
**Context:** Architecture planned both passphrase (6 BIP39 words) and magic link as login options.
**Decision:** Cancel passphrase auth. Build magic link instead.
**Reason:** They solve the same problem — passwordless login. Magic link is simpler, universally understood, and pairs with the existing email upgrade flow. Passphrase is clever but adds complexity readers don't need.

## 2026-04-17: Resend.com for magic link emails
**Context:** Choosing an email provider for magic link delivery.
**Decision:** Use Resend.com (free tier: 100 emails/day).
**Reason:** Simple API (one fetch call), no npm deps, generous free tier. Using test domain for now (onboarding@resend.dev) — needs verified domain for production.

## 2026-04-17: Two-pass Fact-Checker with web search
**Context:** Fact-Checker was failing too often on claims it couldn't verify from training data alone.
**Decision:** Two-pass approach: (1) Claude identifies claims, (2) DuckDuckGo instant answers for unverified/incorrect claims, (3) Claude re-assesses with search results.
**Reason:** Adds real-world verification without external API dependencies. DuckDuckGo is free and doesn't require an API key. Not as deep as a full search engine, but catches obvious errors.

## 2026-04-17: Learnings written by StructureEditor, reviewed by Director
**Context:** Architecture Section 4.3 describes a cross-lesson consistency system.
**Decision:** StructureEditor writes observations to the learnings table when it finds patterns. Director reviews audit patterns after each autonomous run and logs recurring issues via Observer.
**Reason:** Starts the learning loop without over-engineering. Observations accumulate, the Director surfaces recurring problems, and Zishan can act on them.

## 2026-04-17: PublishLessonWorkflow for durable pipeline execution
**Context:** Pipeline was synchronous RPC — wouldn't survive Worker restarts.
**Decision:** Added PublishLessonWorkflow using Cloudflare Workflows v2 via agents SDK. Each pipeline step (curate, draft, audit, revise, audio, publish) is a durable checkpoint.
**Reason:** Durable execution is critical for a pipeline that takes 1-2 minutes. If the Worker cold-starts mid-pipeline, it resumes from the last completed step instead of starting over.

## 2026-04-17: Security hardening — 21 issues addressed
**Context:** Comprehensive security audit found 5 critical, 5 high, 7 medium, 4 low issues.
**Decision:** Fixed all critical and high issues in one pass.
**Changes:**
- Added `Secure` flag to session cookies
- Timing-safe password comparison (prevents timing attacks)
- Email uniqueness check on upgrade (prevents account hijacking)
- All agents endpoints now require ADMIN_SECRET auth (not just /trigger)
- CORS restricted to site domain (was `*`)
- Removed query parameter auth (secrets leak in logs)
- CSRF origin header check on all POST requests
- Rate limiting on Zita chat (20/15min), upgrade (5/15min)
- Input validation: message length limits, JSON try-catch on all endpoints
- Claude API errors no longer leaked to users
- Login response no longer includes user_id

## 2026-04-17: Daily Pieces system — news-driven teaching
**Context:** Zishan's vision: Zeemish should teach from today's news, every morning.
**Decision:** Added ScannerAgent (#14) + Director daily mode. Scanner fetches Google News RSS (free, no API key), Director picks the most teachable story, existing pipeline produces the piece.
**Reason:** Nobody does "today's news → today's 10-minute lesson on the underlying system." CNN gives you the news. Coursera gives you the education 6 months later. Zeemish gives you both, same morning.

## 2026-04-17: Google News RSS as first news source
**Context:** Choosing a news data source for the Scanner.
**Decision:** Google News RSS feeds (6 categories: TOP, TECH, SCIENCE, BUSINESS, HEALTH, WORLD).
**Reason:** Free, no API key, unlimited requests, covers global news. Can add NewsData.io, Guardian API, etc. later as v2 sources.

## 2026-04-17: CORS dynamic origin matching
**Context:** Agents CORS was hardcoded to workers.dev domain.
**Decision:** CORS now checks request Origin against an allowed list (workers.dev + zeemish.io). Added CORS preflight (OPTIONS) handler.
**Reason:** Workers.dev domain will change to zeemish.io in production. Dynamic matching handles both without code changes.

## 2026-04-17: CSRF origin check uses URL parsing, not substring
**Context:** Security audit found the CSRF check used `origin.includes(host)` which is bypassable.
**Decision:** Changed to `new URL(origin).host === host` for strict comparison.
**Reason:** Substring matching allows attacker domains that contain the host string. URL parsing is correct.

## 2026-04-17: Courses renamed to Library
**Context:** Daily pieces are now the primary content, not structured courses.
**Decision:** Rename Courses to Library. Library shows all daily pieces in reverse chronological order.
**Reason:** Courses imply a fixed curriculum. Library implies a growing collection. Daily pieces accumulate into the library naturally.

## 2026-04-17: "The body you live in" course removed
**Context:** Placeholder content from the old architecture before daily pieces existed.
**Decision:** Delete entirely — course metadata, all 12 lesson MDX files, course page routes.
**Reason:** Clean slate. No dead content on a live site.

## 2026-04-17: Dashboard rebuilt as admin control room
**Context:** Running an autonomous agent pipeline without visibility is dangerous.
**Decision:** Full dashboard rebuild with pipeline status, recent pieces table, observer events, engagement data, manual trigger.
**Reason:** You can't run a system you can't see.

## 2026-04-17: Zeemish Protocol established
**Context:** Zishan defined Zeemish's purpose in one line.
**Decision:** "Educate myself for humble decisions" is the founding protocol. Added to voice contract, site footer, and CLAUDE.md.
**Reason:** Every agent, every piece, every design choice serves this purpose. It's the answer to "why does this site exist?"

## 2026-04-17: Reviser does NOT revise published pieces
**Context:** Zishan clarified that published pieces are permanent records.
**Decision:** Reviser's role changed from "propose revisions to existing pieces" to "analyse engagement patterns and write learnings for future pieces." It feeds the learnings database only.
**Reason:** Published content is a permanent record. The way to improve is not to rewrite the past but to make the future better. The Drafter reads learnings when writing new pieces — that's the improvement loop.

## 2026-04-17: Reviser renamed to Learner
**Context:** "Reviser" implies changing published content. It doesn't do that.
**Decision:** Rename ReviserAgent to LearnerAgent. "Learns from reader behaviour to make future pieces better."
**Reason:** The name should match the job. It learns. It doesn't revise.

## 2026-04-17: Merge EngagementAnalyst + Reviser into LearnerAgent
**Context:** Two agents doing related work — one watched engagement, the other extracted learnings. Unnecessary separation.
**Decision:** Merge into one LearnerAgent. It watches reader engagement (completions, drop-offs, audio vs text) AND writes patterns into the learnings database. 13 agents total now (12 public + Observer internal).
**Reason:** Simpler. One agent owns the entire "learn from readers" responsibility. Fewer moving parts.

## 2026-04-17: Restore Curator + Drafter as separate agents; Director becomes a pure orchestrator
**Context:** A prior refactor merged Curator and Drafter into Director "temporarily" — migration `v10` deleted their Durable Object classes. Director ended up doing four jobs (orchestrate, curate, draft, log-on-behalf-of-others) in one 308-line file. Documentation drifted to match the code ("11 agents") instead of the architecture ("13 agents"). "Paused" audio agents were a label, not a structural fact.
**Decision:** Restore `CuratorAgent` and `DrafterAgent` as separate Durable Objects with their own files, states, and prompt files (`curator-prompt.ts`, `drafter-prompt.ts`). Director becomes a pure orchestrator with zero LLM calls. Director's state splits into `status: 'idle' | 'running' | 'error'` + `currentPhase: DirectorPhase | null`. Audio agents stay paused — Director's pipeline does not reference them, so "paused" is now structural (cannot run by accident) rather than documentary.
**Reason:** Separation of concerns makes the system observable, debuggable, and replaceable. Each agent becomes a first-class row on the dashboard with its own status and last-run. A bug in drafting no longer takes down story selection. Swapping Drafter for a new version no longer risks touching Curator logic. Cost control on audio becomes a property of the wire diagram, not a promise in a README.
**Shipped in 3 PRs:** (1) scaffold empty stubs + DO bindings + migration v11; (2) migrate prompts and logic out of Director, rewrite Director to delegate; (3) sync CLAUDE.md, `docs/AGENTS.md`, `docs/ARCHITECTURE.md`, public dashboard, admin `STEP_LABELS`.

## 2026-04-17: Decouple piece identity from publication date (planned, not yet implemented)
**Context:** After restoring Curator + Drafter and running a manual test trigger, a second piece for 2026-04-17 published cleanly through the pipeline — but Zishan could not view it on the site. Investigation showed the system treats "publication date" and "piece identity" as the same thing in three places:
1. URL routing: `src/pages/daily/[date].astro` uses `piece.data.date` as the URL param, so two pieces on the same date produce a URL collision — only one is reachable.
2. Director's guard: `SELECT id FROM daily_pieces WHERE date = ? LIMIT 1` treats "today has a piece" as "today is full".
3. Filename prefix `YYYY-MM-DD-slug.mdx` makes the date visually dominant, though the slug is what disambiguates on disk.

The D1 `daily_pieces` table itself does not enforce date uniqueness — the conflation lives in the surface and the guard, not in the data model. So the architecture is lying about a constraint that isn't real.

**Decision:** Multiple pieces per day is the product vision, not an edge case. "One per day" was a temporary scaffold. Next session: decouple piece identity from publication date.
- URL becomes `/daily/{slug}/` (or `/pieces/{slug}/` — TBD) instead of `/daily/{date}/`. Date stays as metadata, not identity.
- Director's guard changes from "date already claimed" to "slug already published" (dedupe by content, not time).
- `content/daily-pieces/` filename pattern stays — slug is already the unique piece, date is just a sort aid.
- Library + "today's piece" sections still sort/filter by date, but no longer require uniqueness.
- Backwards compatibility: existing `/daily/YYYY-MM-DD/` URLs need a redirect or fallback (decide in implementation).

**Reason:** Same principle as the Director refactor — the surface should match what the architecture actually wants to express. Date-as-identity baked a 1:1 constraint into URLs and pipeline logic that neither the data model nor the product goal needs. Fixing it unlocks multiple-pieces-per-day (6 or 12 stories eventually), safe manual re-triggers during development, and accurate library rendering when pieces share a date.

**Scope for next session:** Plan the fix in detail (including URL redirect strategy for existing pieces), then implement in stages similar to the agent refactor.

## 2026-04-17: One piece per day is the product — reverse the prior "decouple" plan
**Context:** The prior entry (same day) planned to decouple piece identity from publication date to support multiple pieces per day. On reflection, Zishan decided against drifting into that larger refactor. One piece per day is the product. Architecture stays as-is.

**Decision:** Keep date-as-identity in URL routing, Director's guard, and the filename pattern. Do NOT decouple. The prior decision stands as a possibility considered and rejected; this entry supersedes it.

**Reason:** "Don't drift." The agent-side refactor we just shipped was necessary architectural work. Chasing another large surface refactor on the same day would repeat the original mistake — reacting to a surfaced edge case by rewriting the system instead of confirming the product. One story a day is simple, understandable, and fits the Zeemish Protocol. The admin force-trigger created one accidental duplicate today (two pieces for 2026-04-17) — that's a dev-mode artifact, not an architecture problem.

**Consequence for the duplicate currently in the repo:** Two pieces exist for 2026-04-17 (`europe-led-coalition...` and `what-lagging-jet-fuel...`). Both published via Publisher. The URL can only reach one. Left in place for now; Zishan can delete the unwanted one by hand later if desired, or leave as a record of the first real Curator+Drafter run.

**Remaining work tied to this:** The admin force-trigger that bypasses the guard can still create dev-mode duplicates. That's acceptable during build. If it becomes annoying later, a simple fix is to make the force-trigger delete today's D1 row + MDX file before running, so the new piece replaces instead of duplicating. Not planned — listed here so it's not forgotten.

## 2026-04-17: Agent system hardening pass — principle alignment, no silent failures
**Context:** Audit of `agents/src/` found the pipeline structurally sound but drifting from two principles documented in `docs/AGENTS.md` and `docs/handoff/ZEEMISH-V2-ARCHITECTURE-REVISED.md`: (1) "One prompt per agent, co-located in `{agent}-prompt.ts`" — followed only by Curator and Drafter, and (2) "no silent failure" — the fact-checker could return first-pass-only results when web search failed with nothing surfaced.

**Decision:** Ship an alignment pass — no behaviour change at the reader edge, no migrations, no API edits.

- Extracted inline prompts into dedicated files for voice-auditor, structure-editor, fact-checker, integrator, and learner (5 new `*-prompt.ts` files). Makes the Director's eventual prompt-edit approval surface (architecture §4.2) reviewable.
- `FactCheckResult` gained `searchAvailable: boolean`. When DuckDuckGo is unreachable, Director logs a warn via Observer so Zishan knows the draft was judged by Claude's first-pass assessment alone.
- `LearnerAgent` now uses the shared `extractJson` parser from `shared/parse-json.ts` instead of inline regex — same robustness as every other agent.
- `StructureEditorAgent` now writes learnings for both passing drafts (suggestions, confidence 60) and failing drafts (issues, confidence 40). Previously only passing-with-suggestions cases became learnings — a biased sample feeding into Drafter's future prompts (architecture §4.3).
- `IntegratorAgent` dropped dead `revisionCount` state. Director now spawns `integrator-daily-${today}` (fresh DO per day, matching the daily-cadence model and Publisher's existing pattern).
- `ScannerAgent` accepts an optional `SCANNER_RSS_FEEDS_JSON` env override with safe fallback to hardcoded defaults — feeds change without a redeploy.
- `wrangler.toml` gained a history banner above v5's migration clarifying the LearnerAgent/EngagementAnalyst/Reviser refactor trail.

**Reason:** The architecture locked the 13-agent roster and the "no silent failure" principle in April 2026. Small deviations compound into voice drift (biased learnings) and trust erosion (silent gate bypasses). This pass costs one afternoon and restores alignment before those problems materialise. Zero runtime changes to the reader path — any breakage surfaces on the next scheduled 2am UTC run and is `git revert`-reversible.

**Explicitly out of scope (not regressions, separate work):** D1 schema changes (`voice_score` is already nullable), DuckDuckGo → real search API, scanner XML regex → proper parser, weekend daily pieces, reset-today single-command script, deleting the `shared/prompts.ts` tombstone, audio pipeline (paused by design), `observer_events.severity = 'approval_needed'`.

## 2026-04-17: Dropped course-era `agent_tasks`, fixed orphaned FK on `audit_results`
**Context:** Verifying the first run against the hardened pipeline surfaced that `audit_results` had zero rows across all historical runs. Root cause: the table's `FOREIGN KEY (task_id) REFERENCES agent_tasks(id)` constraint (defined in `0004_audit_results.sql`) pointed at `agent_tasks`, a table created in `0002_observer_events.sql` but never populated by any code. Every Director INSERT silently failed the FK check and the try/catch swallowed the error. Side-effect: the site dashboard's stats and today pages (`src/pages/api/dashboard/stats.ts`, `today.ts`) silently returned empty audit data.

**Decision:** Migration `0008_drop_agent_tasks.sql` drops `agent_tasks` entirely (unused since the course model was retired — see the 2026-04-17 entries above), and drops+recreates `audit_results` without the FK. The recreated table has `idx_audit_task` and `idx_audit_created` indexes for dashboard queries.

**Reason:** Courses are gone; `agent_tasks` was a leftover from the course-era architecture. Keeping a dead table with a live FK pointing at it was producing a real, invisible failure in the audit trail. Clean-slate drop is safe because `audit_results` was empty and `agent_tasks` was unused.

**Verified:** Migration ran cleanly on remote D1. Manual INSERT/SELECT/DELETE round-trip into the new `audit_results` works. Table count now 12 (was 13); migration count now 8 (was 7). Director's next run will populate `audit_results` properly, unlocking the dashboard stats and long-term per-auditor trend analysis.

## 2026-04-17: Daily pieces run every day (weekends included)

**Context:** Zeemish is sold as a *daily* teaching product but `DirectorAgent.dailyRun()` skipped Saturday/Sunday via an `isWeekend` guard. The cron (`0 2 * * *`) was already daily — only the code gated weekends out. Readers arriving on a weekend saw yesterday's piece prominent on the home page, conflicting with the brand promise.

**Decision:** Removed the `dayOfWeek`/`isWeekend` check from `agents/src/director.ts`. The scheduled run now fires every day of the week. If the news is thin on a given weekend, Curator's existing "no teachable stories" skip path logs via Observer and the day is left blank — same graceful behaviour we already have on a quiet weekday.

**Reason:** The product claim is daily. Either ship daily or change the claim. We chose ship. No new Scanner sources for weekends — the RSS feed list is already broad enough that weekends rarely lack signal, and if they do, a blank day is more honest than a forced piece. Supersedes the "weekend daily pieces" item previously listed as out of scope in the 2026-04-17 "Nine-point hardening pass" entry above.

**Verified:** TypeScript compiles clean. Docs synced in the same commit (`CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/AGENTS.md`, `docs/RUNBOOK.md`). Next Saturday's 2am UTC run is the live verification.

## 2026-04-17: Admin rot swept — `isRunning` heuristic + trigger error handling

**Context:** `CLAUDE.md` flagged two admin-surface bugs as "remaining minor items." They were each small but compounding: (1) the pipeline monitor treated an audit-round `failed` status as pipeline-terminal, even though Integrator + next round follows, so the UI stopped polling in the middle of a run; (2) the admin "Trigger Daily Piece" button used a fire-and-forget `fetch` inside a sync try/catch, so HTTP failures (401, 500) never reached the UI — users saw "Starting pipeline..." stuck forever.

**Decision:**
- `src/pages/api/dashboard/pipeline.ts` — `isRunning` now keys off Director's three explicit terminal-marker steps (`done`, `error`, `skipped`). Audit-round `failed` statuses are no longer conflated with pipeline termination.
- `agents/src/server.ts` — `/daily-trigger` returns `202 Accepted` immediately and hands the pipeline work to `ctx.waitUntil()`. Caller-facing latency drops from "minutes" to "milliseconds"; errors from DO stub creation still surface synchronously.
- `src/pages/dashboard/admin.astro` — `await`s the fetch, inspects `res.ok`, surfaces HTTP status + JSON error body to the operator. Polling only begins after the 202 acks.

**Reason:** Admin tools decay first because only Zishan sees them. These two were the biggest "lie to operator" bugs on the surface — the dashboard looked trustworthy while being subtly wrong. Fixing the trigger at the source (async via `waitUntil`) meant the admin-side workaround could be removed rather than decorated.

**Verified:** Both workers build clean. Will verify end-to-end after next manual trigger — admin UI should show "Started (run YYYY-MM-DD)" immediately, polling begins, pipeline runs, `isRunning` flips to `false` only when a terminal marker is written.

## 2026-04-17: One-command reset-today script

**Context:** Dev iteration on the daily pipeline involves a 3-step reset (git rm MDX + D1 DELETE across 5 tables + trigger fresh run). Runbook documented it correctly, but typos in the SQL (notably the `observer_events.created_at` epoch-ms cutoff) had bitten us before.

**Decision:** `scripts/reset-today.sh` bundles the three steps into one command. Reads `ADMIN_SECRET` from env, uses the known-good SQL verbatim from the runbook, fails fast on any step. Manual 3-step procedure retained as a fallback.

**Reason:** Codify the known-good steps in a script so they can't drift, so the operator can't typo the epoch-ms cutoff, and so reset is one command instead of three. Zishan's ask from the previous session.

**Verified:** `bash -n` syntax check passes. Live-tested after committed alongside Phase 1-4.

## 2026-04-17: KV-backed rate limiting (replaces in-memory Map)

**Context:** `src/lib/rate-limit.ts` used a module-level `Map<key, window>`. On Cloudflare Workers, isolates die and recycle continuously and don't share state — so the limiter reset on every recycle and couldn't count across isolates. Effectively no rate limit. The login/magic-link/upgrade/Zita endpoints were all wearing this fig leaf.

**Decision:** Replace with Workers KV (`RATE_LIMIT_KV` binding). Key layout: `rl:<key>` → `{ count, resetAt }` JSON; TTL = window seconds so KV auto-expires entries. Signature went from sync to async; 4 callers updated in the same commit. Old in-memory implementation removed — no dual-path.

**Reason:** KV is eventually consistent, which introduces a small boundary window where a determined attacker could exceed the cap before KV propagates. For the soft limits we use (5 logins / 15 min, 3 magic links / hour, 20 Zita messages / 15 min) that's acceptable — we're stopping credential-stuffing and Claude-cost blowups, not an APT. The in-memory version didn't stop either.

**Verified:** `wrangler types` emits `RATE_LIMIT_KV: KVNamespace` into `Env`. `pnpm build` clean. Live verification: curl login 6 times with wrong password — 6th returns 429; wait 15 min, allowed again; `wrangler kv key list --binding=RATE_LIMIT_KV` shows the entry with TTL.

## 2026-04-17: Publish-anyway on max-revision audit failure (low-quality flag)

**Context:** On a round-3 audit failure, Director set its own status to `error`, logged escalation, and published nothing. For a daily-cadence product, that meant some days had no piece — a hole in the archive and on the home page. Zishan's call: "we still publish, the score will be low. no archive."

**Decision:** On max-revision failure, Director now:
1. Splices `qualityFlag: "low"` into MDX frontmatter (same regex pattern as Drafter's date-force);
2. Calls Publisher with a commit message tagged `[low-quality, gates: voice/structure/facts]`;
3. Inserts into `daily_pieces` with `quality_flag='low'` and `fact_check_passed` reflecting the actual last round;
4. Still logs Observer escalation (operator needs to know);
5. Completes with `status: 'idle'` (no longer `'error'`).

Reader surface:
- `/daily/YYYY-MM-DD/` renders the low piece with a yellow banner acknowledging it didn't fully pass checks.
- `/library/`, `/daily/` archive index, home page's "From the library", and all dashboard archive queries filter `qualityFlag !== 'low'` / `quality_flag IS NULL`.
- `/api/dashboard/today` exposes `qualityFlag` so live tooling can badge today's low publish distinctly.
- Admin pipeline monitor labels low-quality `done` steps with "LOW QUALITY" + failed gate names.

Schema: migration `0009_quality_flag.sql` adds `daily_pieces.quality_flag TEXT DEFAULT NULL`. Content-collection schema gets `qualityFlag: z.enum(['low']).optional()`.

**Reason:** The daily promise matters more than a perfect catalogue. A blank day breaks trust in the brand; a flagged-and-filtered day preserves daily cadence while keeping the archive clean. The "Published pieces are permanent" hard rule is intact — we never revise or delete the low piece, we just exclude it from the archive presentation.

**Verified:** Both workers build clean. Full verification requires a forced audit failure — will run on next reset-today cycle with a deliberately pathological brief, or wait for a naturally-failing day.

## 2026-04-17: Beat navigation activated via rehype plugin, not Drafter output

**Context:** The `<lesson-shell>` / `<lesson-beat>` Web Components were fully built in Stage 2 — beat-by-beat navigation, prev/next, progress bar, session resume, server sync, engagement tracking — but dormant. DrafterAgent was emitting plain markdown (`## hook`, `## what-is-hormuz`) rather than the wrapper tags described in the original spec, so every daily piece rendered as one continuous wall of prose. The reader's primary surface was quietly broken.

**Decision:** Add a small rehype plugin (`src/lib/rehype-beats.ts`, ≤ 120 lines) that walks the MDX HAST tree, splits the document at `h2` boundaries, and wraps each section in `<lesson-beat name="{slug}">` inside a single `<lesson-shell>`. The plugin also humanises kebab-case headings for display (`what-is-hormuz` → `What Is Hormuz`). No agent changes.

**Why a render-time transform instead of changing Drafter:**
- Agent pipeline stays untouched — the voice contract, prompt library, and audit gates are all validated against the existing output format. Touching Drafter risks regressions on output the audit layer has been tuned for.
- Retroactive: every past piece, including the in-tree Hormuz example, benefits immediately. No re-publishing.
- Safe fallback: if an MDX file has no `h2` headings (legacy or intro-only pieces), the plugin is a no-op and the page renders as regular prose.
- Progressive enhancement preserved: without JS the wrapped structure still reads as a long document.

**Tradeoff accepted:** Drafter can continue emitting `## slug-style` headings forever. We're treating those markdown headings as a structural seam the build knows how to cut along. If we later want richer beat metadata (duration, media, pull quote), we move that into frontmatter `beats:` rather than teaching the Drafter to emit XML.

**Verified:** `npm run build` produces 7 `<lesson-beat>` elements for the Hormuz test piece; beat-by-beat navigation, keyboard arrows, progress bar, and finish-redirect all work in the static preview.

## 2026-04-17: Soften quality surfacing — tier over filter

**Context:** The "publish-anyway" work (decision above) kept the daily cadence by publishing low-quality pieces but then hid them — filtered out of `/library/`, `/daily/`, the homepage "From the library" strip, and every dashboard archive query. On the direct URL the piece rendered behind a yellow banner that said *"This one didn't fully pass our voice, structure, and fact checks."* Two problems: (1) hiding a published piece contradicts the transparency brand (the dashboard is literally the "factory floor"); (2) the scolding language — "Failed" in red on the public dashboard, "LOW QUALITY" labels, the apologetic banner — treated a 78/85 piece as a disgrace rather than what it is: slightly below bar but readable. Zishan's call: treat every published piece equally, show a quiet tier instead of filtering, stop bragging or apologising.

**Decision:** Three-tier reader-facing label, derived from voice score:
- `polished` — voiceScore ≥ 85 (passes the voice bar)
- `solid` — 70 ≤ voiceScore < 85 (below bar, readable)
- `rough` — voiceScore < 70 (noticeably below, still published)

Fallback when `voiceScore` is missing: default to `polished`, unless `qualityFlag === 'low'` (then `rough`). Helper in `src/lib/audit-tier.ts`.

Changes:
1. New `voiceScore` field in MDX frontmatter + content schema. Director splices it on every publish (not just failures) alongside the conditional `qualityFlag`.
2. Removed `quality_flag IS NULL` / `qualityFlag !== 'low'` filters from every reader-facing query: `/library/`, `/daily/`, homepage, `/api/dashboard/recent`, `/api/dashboard/stats`, and the dashboard page's 4 D1 queries. Counts and lists now reflect reality.
3. Deleted the yellow banner on `/daily/[date]/`. Tier appears instead as a single quiet word in the existing metadata line (`8 min · 6 beats · Business · Solid`) — same `text-zee-muted` tone as the rest of the line, no colour change.
4. Public dashboard `Quality Scores` grid softened: Voice card shows the tier word (`Polished`/`Solid`/`Rough`), not `Passing`/`Failed`; Facts/Structure use `Passing`/`Mixed`. No red anywhere — neutral progress bars.
5. Dashboard footer updated — old line claimed *"No piece publishes without passing all three"* which is no longer true.
6. Admin surface (`/dashboard/admin/`) intentionally unchanged — operators still see `Voice: 78/100`, `LOW QUALITY` labels in the pipeline monitor, failed-gate detail. Raw truth for the factory floor.

**Kept as-is:** `quality_flag` column on `daily_pieces`, `qualityFlag` in MDX schema, Director still writes both. Non-destructive per project convention, useful as a secondary signal in the tier helper, and preserves optionality for future admin tooling.

**Reason:** Transparency is the brand. Treating one published piece as unworthy of the archive is the opposite of "educate myself for humble decisions" — it's the system hiding its own shortcomings. The tier lets a reader calibrate without being scolded, and the consistent treatment (every piece shows its tier) means the word `rough` isn't a warning singled-out on weak days — it's just information, same as the read time.

**Verified:** `npm run build` clean, content schema accepts new `voiceScore` field. Today's piece (2026-04-17, QVC) renders as `Rough` via the `qualityFlag: low` fallback path without a manual voice score backfill. Library, daily index, and homepage include it chronologically. Yellow banner gone.

## 2026-04-17: Avg voice score aggregated from `daily_pieces.voice_score`, not `audit_results`

**Context:** After the soften-quality pass (commit 80ebe10) every public surface was switched from `quality_flag IS NULL` filtering to "every published piece counts". Two queries were missed — `voiceAgg` in `src/pages/dashboard/index.astro` and `avgVoice` in `src/pages/api/dashboard/stats.ts`. Both still read from `audit_results` with `WHERE auditor = 'voice' AND passed = 1`, which excludes every piece scoring below the 85 voice bar. Today's piece scored 78 → `passed = 0` → excluded → Avg voice card rendered `—` despite a real score existing on the piece page. Secondary issue: even with the filter removed, aggregating over `audit_results` double-counts every revision round.

**Decision:** Aggregate from `daily_pieces.voice_score` instead.

```sql
SELECT AVG(voice_score) AS avg, COUNT(*) AS n
FROM daily_pieces
WHERE voice_score IS NOT NULL;
```

**Reason:**
- `daily_pieces` has exactly one row per published piece.
- Director writes `lastVoiceScore` there on every publish (`agents/src/director.ts:263-268`), so the value is the final-round score — the same number the reader sees and the same number `auditTier()` uses to derive the tier word.
- `WHERE voice_score IS NOT NULL` cleanly excludes historical pieces from before the plumbing landed.
- Same table already backs `totalPieces` and `subjects`, so the avg now lives in the same semantic universe as its neighbours on the Library stats strip.

The API endpoint also now returns `voiceSampleSize` alongside `avgVoiceScore` so external consumers get the same honesty the dashboard UI already shows ("from N pieces").

**Verified:** `npm run build` clean; local static build; live deploy confirms dashboard renders a number and "from N pieces" subtitle.

## 2026-04-18: "How this was made" surfaced as a drawer on each piece, not a page

**Context:** Transparency is the brand (CLAUDE.md). Before today, a reader saw only the finished piece — the machinery behind it (13 agents, audit scores, voice-contract rules, rejected candidates, revision rounds) was invisible. The user asked for a complete transparency surface readers can open on any piece.

**Decision:** Add a "How this was made" drawer that slides in from the right of the daily piece page. Not a dedicated `/daily/.../process/` route. Not a section expanded below the piece.

The open affordance is a full-width, quiet link-style row at the bottom of each piece. Clicking it opens a drawer with four sections: piece summary, timeline, per-round auditor output, rules applied, and the candidates Scanner surfaced. URL hash `#made` makes the drawer deep-linkable without a new route.

**Why a drawer, not a page:**
- Transparency lives *next* to the work, not behind a page-jump. A reader interested in "how was this made" is still interested in the piece itself; yanking them to a separate route breaks that thread.
- The drawer preserves scroll position on the piece. Close → you're back where you were, reading.
- One URL per piece keeps the library/daily routing model simple. Deep-links via `#made` work without new routes.

**Why it ships with only existing data, no DB or agent changes:**
- `pipeline_log` already has the full per-phase timeline (keyed by `run_id = YYYY-MM-DD`).
- `audit_results` already has per-round scores + violations / claims / issues (keyed by `task_id = daily/YYYY-MM-DD`, grouped by `draft_id`).
- `daily_candidates` already has the full Scanner candidate set.
- `daily_pieces` already has piece metadata + voice_score + quality_flag.
- Commit URL + file path are already written into the `publishing.done` step of `pipeline_log`.

Data that doesn't exist is explicitly not displayed: no reader visits (engagement isn't wired for daily pieces), no Curator reasoning (never stored), no intermediate drafts (not kept). The drawer hides sections whose data is empty rather than inventing placeholders.

**Shape of the fix:**
- New public endpoint `src/pages/api/daily/[date]/made.ts` aggregates the four tables above into one JSON envelope. Independent of the admin dashboard endpoints — simpler to consume than orchestrating three calls client-side.
- New `src/components/MadeBy.astro` renders the open button + drawer scaffold.
- New `src/interactive/made-drawer.ts` Web Component: open/close, focus trap, Escape to close, body scroll lock, URL hash sync, fetch-on-mount, render.
- New `src/styles/made.css` — standalone CSS, same pattern as `beats.css` / `zita.css` (avoids Tailwind purge).
- Rules card uses keyword matching between auditor violations and voice-contract rules — an honest, if imperfect, signal of which rules the audit flagged something adjacent to. Each rule "lights up" when a keyword from its list appears in any violation string.
- `src/lib/pipeline-steps.ts` extracted from `admin.astro` so admin + drawer share one step→label map and can't drift.

**Verified:** `npm run build` clean. Static preview: drawer opens, closes via button / Escape / backdrop, hash deep-link works. Full content requires D1 — confirmed live after deploy.

## 2026-04-18: Dashboard refocused on system-over-time, not per-piece

**Context:** The "How this was made" drawer (shipped earlier today) covers everything per-piece — timeline, audit rounds, rules, candidates. After it shipped, the public dashboard's most prominent sections (Today's Pipeline, Quality Scores, Recent Pieces) became duplicates of either the homepage hero or the drawer. The dashboard had no unique job.

**Decision:** Refocus the public dashboard on cross-piece, cross-day signals only. The drawer owns "how this piece was made"; the dashboard owns "how the factory is running over time".

**New structure:**
1. Page header (eyebrow / title / live subtitle: pieces published, days running, next-run countdown).
2. Today — one-line status strip (Published / Running / Pending), no fat card.
3. This week's output — 4 stat cards: pieces (week + lifetime), avg voice (week, lifetime fallback), tier mix (Polished·Solid·Rough), avg revision rounds.
4. Recent runs — vertical list of the last 7 days with tier dot, voice score, rounds, candidate count, headline; click → goes to that piece (which has the drawer).
5. How it's holding up — three honest signal rows: unresolved escalations (with context), fact-check web availability, avg candidates per day. Rows hide entirely if their data doesn't exist (no placeholder dashes).
6. Agent team — same 13 names, but the most recently active agent (last `pipeline_log` row within 24h) gets an ambient `● active Nm ago` marker.
7. How this works — short paragraph + Voice contract link. Admin Panel link appears here gated on isAdmin (moved from a prominent CTA at the top).

**Removed entirely:**
- Today's Pipeline fat card (drawer + homepage cover this).
- Quality Scores three-card grid (drawer covers per-round; the run log covers cross-piece).
- Recent Pieces simple list (replaced by the richer Recent Runs feed).
- Library 4-stat grid (merged into This week's output).
- Top-level Admin Panel button (moved to discreet footer link).

**Why these queries (all existing tables — no new schema):**
- Tier mix derives from `daily_pieces.voice_score` via `auditTier()` (already canonical).
- Avg rounds counts distinct `audit_results.draft_id` per task_id (suffix `-rN`).
- Unresolved escalations from `observer_events WHERE severity='escalation' AND acknowledged_at IS NULL`.
- Fact-check status counts last-7-days `observer_events WHERE severity='warn' AND title LIKE '%fact-check%'`.
- "Active agent" maps `pipeline_log` step name → agent via inline `STEP_TO_AGENT` table; only shown if the latest step is within 24h.

**Rationale:** Trust through specificity. The dashboard tells the truth at one piece (sample size shown) and at thirty pieces (week-vs-lifetime split). Empty sections vanish rather than show dashes. Every number is a thing the system actually knows.

**Verified:** `npm run build` clean. Static pages still 200. Dashboard requires D1 — verified post-deploy on the live worker.

## 2026-04-18: Site polish bundle — 404, OG meta, drawer lazy-load

**Context:** Post-dashboard-redesign audit found seven fixable rough edges. Shipped together as one quick-wins bundle.

### What landed
1. **Custom 404 page** (`src/pages/404.astro`) — replaces the default Astro dark/monospace 404. On-brand: gold eyebrow + "You've reached a dead end" title + three exit doors (today / library / dashboard).
2. **OG / Twitter sharing meta** (`src/layouts/BaseLayout.astro`) — full set of og:title / og:description / og:type / og:url / og:image / og:site_name + twitter:card + canonical link. Daily pieces pass `ogType="article"` and the piece description; everything else defaults to `"website"`. Requires `astro.config.mjs` to set `site` for absolute URL resolution.
3. **OG image** (`public/og-image.svg`) — typography-only branded card, 1200×630, cream + teal + gold. Same image for every page (per-piece dynamic OG is a separate project).
4. **Google Fonts preconnect** — added `<link rel="preconnect">` for both `fonts.googleapis.com` and `fonts.gstatic.com` (with crossorigin) before the font stylesheet load. ~50ms first-paint improvement.
5. **Library filter focus ring** — replaced `focus:ring-0` with `focus:ring-2 focus:ring-zee-primary/30 rounded`. Was an a11y regression — keyboard users had no focus indication on the filter input.
6. **Drawer lazy-load** (`src/interactive/made-drawer.ts` + `src/components/MadeBy.astro`) — `<made-drawer>` no longer fetches `/api/daily/[date]/made` on mount. Only on click or `#made` hash. Saves one D1 query per page view for readers who never open the drawer. Trade-off accepted: the button copy is now static ("The pipeline of 13 agents behind this piece") with no live audit-round count. Inside the drawer the reader sees real numbers.
7. **Dashboard mobile wrap** — "How it's holding up" rows now stack `flex-col` on small screens, revert to `sm:flex-row sm:justify-between` at 640px+. Fixes the awkward two-line wrap of "3 checks this week used Claude-only" at 375px.

### What was deferred (still real, just bigger)
- `public/_headers` exists with full CSP/HSTS but isn't being honored by the live response. Cloudflare Workers Static Assets uses a different mechanism — needs separate investigation.
- Login page styling refresh
- Zita panel rebrand (white → zee-bg)
- Per-piece dynamic OG image generation (Cloudflare Worker route)
- Skip-link / full WCAG audit

**Verified:** `npm run build` clean. Static preview confirmed: `/totally-fake/` renders custom 404; daily page no longer fires the made-API call on mount; drawer opens and fetches on click. Live verification post-deploy.

## 2026-04-18: Admin redesigned as a control room + per-piece deep-dive

**Context:** The admin page was a mix of broken (Recent Agent Tasks queried `agent_tasks`, dropped in migration 0008) and misleading (the 14-day Engagement table showed legacy lessons-era reader data, never daily-piece data). It also had no per-piece detail — operator could see today's pipeline and recent observer events, but couldn't click into any historical piece to see audit notes, candidates, or the day's events.

**Decision:** Rewrite admin as a control room. Add a per-piece deep-dive route. Refresh login to match the design system. All from existing data — no schema, no agent, no API changes.

**Admin (`src/pages/dashboard/admin.astro`)**:
- Page header: gold eyebrow ("THE CONTROL ROOM") + title + subtitle, matching account/dashboard.
- Today's run: trigger button + step-by-step pipeline log (existing functionality; refactored to share `pipelineStepLabel()` with the public dashboard and the per-piece drawer).
- System state: 4 stat cards — pipeline runs (lifetime), open escalations, errors this week, avg revisions.
- Observer events: same severity-coloured cards, but acknowledged-state now updates in-place (no page reload). Card softens, Acknowledge button removed.
- All pieces: every published piece, newest first, with tier dot + date + voice score + rounds + candidates count + low-flag indicator. Filter input shows when >5 pieces. Each row links to `/dashboard/admin/piece/{date}/`.
- Pipeline history: terminal step per run for the last 14 distinct runs, derived from `pipeline_log` with a single SQL window query.
- Engagement section replaced with an honest placeholder pointing to CLAUDE.md.
- Recent Agent Tasks table dropped (the table doesn't exist).

**Per-piece deep-dive (`src/pages/dashboard/admin/piece/[date].astro`, NEW)**:
- Same admin gate as `admin.astro`.
- Server-rendered, queries D1 directly — no new API endpoint.
- Sections: piece header (tier eyebrow, headline, all metadata, view-on-site + commit + source links), pipeline timeline (collapsed by step, each expandable to show full data JSON), audit rounds (full violations / claims / structure issues, no truncation, no "see more"), all candidates (no 6-cap), observer events for the day (36h window), raw data dumps for `daily_pieces` / `audit_results` / `pipeline_log` rows in collapsible `<details>` blocks.
- The reader-facing drawer caps `alsoConsidered` at 6 and parses violation strings; admin sees all 50 candidates and the raw notes JSON.

**Inline bug fix**: The `isRunning` heuristic on the public `/api/dashboard/pipeline` endpoint only checks step name, not status. Fixed on the consumer side in admin's polling: a run is only "running" if the latest row's `status === 'running'` AND its step is not in `['done', 'error', 'skipped']`. The API endpoint stays untouched (no other consumers verified safe).

**Login (`src/pages/login.astro`)**: Refreshed page header to match account/dashboard pattern (eyebrow + title + subtitle), wider container (`max-w-md` from `max-w-sm`), styled error/success notices in zee-* tokens instead of red/green Tailwind defaults, label uppercase-tracked. Magic-link form flow unchanged.

**Reused**: `auditTier()` + `auditTierLabel()` from `src/lib/audit-tier.ts`, `pipelineStepLabel()` from `src/lib/pipeline-steps.ts`, `getUser()` from `src/lib/db.ts`. Same divider-list + stat-card patterns used everywhere else.

**Verified**: `npm run build` clean. Live verification post-deploy with admin login.

## 2026-04-18: Director.onStart no longer cancels its own cron

**Context:** The 2am UTC run on 2026-04-18 never fired. `pipeline_log` for the day was empty; today's piece never produced. Yesterday's piece (2026-04-17) shipped only because it was a manual `/daily-trigger`. The cron has effectively never fired in production.

**Root cause:** The Agents SDK's `alarm()` handler calls `super.alarm()` *before* scanning `cf_agents_schedules` for due rows. `super.alarm()` triggers `#ensureInitialized()`, which runs `onStart()`. Director's `onStart()` was:

```ts
const existing = await this.getSchedules();
for (const s of existing) await this.cancelSchedule(s.id);
await this.schedule('0 2 * * *', 'dailyRun', { type: 'daily-piece' });
```

When the alarm woke the DO at 2am, `onStart()` deleted the cron row and re-inserted it. The new row's `time` is `getNextCronTime('0 2 * * *')` evaluated *after* 2am — i.e. tomorrow's 2am. The alarm body then queried `WHERE time <= now`, found nothing, and exited silently. Self-perpetuating: every 2am wake-up hits the same trap.

**Decision:** Drop the cancel loop. Cron schedules in the Agents SDK are idempotent on `(callback, cron, payload)` — repeated `schedule()` calls return the existing row instead of inserting. The cancel-then-recreate pattern was unnecessary defensive code that turned into the actual bug.

```ts
async onStart() {
  await this.schedule('0 2 * * *', 'dailyRun', { type: 'daily-piece' });
}
```

**Recovery:** Today's piece run manually from admin. Fix takes effect from tomorrow's 2am onward (after deploy).

**Why this slipped:** The cron path had never fired before. Yesterday was the first production day, and yesterday's piece was a manual trigger from the reset-today flow. Today's was meant to be the first true autonomous fire.

**Verified:** SDK source confirms idempotency at `agents/node_modules/agents/dist/index.js:1474` — cron path checks `WHERE type='cron' AND callback AND cron AND payload LIMIT 1`, returns existing row if found.
