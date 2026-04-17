# Zeemish v2 — Decision Log

Append-only. Never edit old entries.

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
