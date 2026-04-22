# Zeemish v2 — Claude Code Context

**Read this first. Then read `docs/handoff/ZEEMISH-V2-ARCHITECTURE-REVISED.md` and `docs/handoff/ZEEMISH-DAILY-PIECES.md`.**

## The Zeemish Protocol

**"Educate myself for humble decisions."**

"Most human suffering — personal, in organisations, and across the world — comes from treating connected things as if they were separate. The cure is learning to see and work with the whole."

## What Zeemish v2 is

An autonomous multi-agent publishing system. 13 AI agents scan the news, decide what to teach, draft pieces, audit them through quality gates, and publish — all without human intervention. Readers see a daily teaching piece anchored in today's news, with a growing library of past pieces.

## Current state

**LAUNCHED 2026-04-18 at https://zeemish.io.** Tag: `v1.0.0`. Old breathing-tools site at zeemish.io retired (custom-domain binding moved from `zeemish-site` worker to `zeemish-v2` worker via Cloudflare dashboard). New site live with daily piece, audio, engagement tracking, public + admin dashboard, security headers on auth-touching surfaces. Workers.dev URL still active as fallback. The exact git commit at launch is what `v1.0.0` points at — use it as the reference if anyone asks "what shipped on day one".

13 agents deployed, all wired. Daily news-driven teaching operational, public + admin dashboard, security hardened on the routes that matter. Daily pieces are the only content type.

Each agent does one job and lives in one file. Director is a pure orchestrator — zero LLM calls. Curator picks the story, Drafter writes the MDX, auditors gate quality, Integrator revises, Publisher ships, Audio Producer narrates beat-by-beat via ElevenLabs, Audio Auditor verifies, Publisher second-commits the audio URLs into frontmatter. Audio runs in a ship-and-retry posture: text publishes the moment Integrator approves (a newspaper never skips a day); audio lands as a second commit when it's ready, or surfaces a retry button on the admin dashboard if it fails.

The 2026-04-19 improvement plan (`~/Downloads/ZEEMISH-IMPROVEMENT-PLAN-2026-04-19.md`, not committed) is ~90% closed as of 2026-04-20. Remaining items: **P1.2 Curator conceptual diversity** (in FOLLOWUPS as `[observing]`, unblock by 2026-04-26), **P2.2 Watch beat** (pending Zishan decision — enforce or drop from spec). **P1.5 Zita learning** shipped as the Learner skeleton in Zita improvement plan Phase 5 (2026-04-21) — no longer pending. P2.1 heading-punctuation scoped out (the major bug shipped via `beatTitles` override; the title-case remainder is `[wontfix]`). P2.3 audio-on-2026-04-17 resolved — live at `zeemish.io/daily/2026-04-17/`. P3.1 dashboard agent-team live state scoped out.

## Multi-piece cadence plan — status (2026-04-22, post-Phase-7 wrap)
Plan file: `~/.claude/plans/could-please-do-a-harmonic-waffle.md` — work complete. **14 commits** of plan phases (origin at `1e17031`, wrap at `c4caf39`) + **5 commits** of Phase 7 FOLLOWUPS cleanup (`19910d7`, `7ebae47`, `9d20b81`, `3208c86`, `205ce1e`). Production cadence unchanged: `interval_hours=24` (one piece per day at 02:00 UTC). The admin knob is live at `/dashboard/admin/settings/` and flipping it is architecturally safe for the pipeline with no known correctness blockers.

**Phase 7 FOLLOWUPS cleanup (2026-04-22, 5 commits):** closed all 5 `[open]` Low-priority items that remained after the plan's main run. See DECISIONS 2026-04-22 "Phase 7 FOLLOWUPS cleanup — five-commit wrap" for the full shipping log. One new `[open]` snapshot-drop FOLLOWUPS entry (`engagement_backup_20260422`, queued for 2026-04-29).

**Multi-per-day correctness blockers — updated 2026-04-22 PM after late-caught regression.** The original "all resolved as of `cbf1f17`" claim missed one: Director's `triggerDailyPiece` had a `WHERE date = ? LIMIT 1` guard that silently killed every non-first slot per calendar day. Caught when the 2026-04-22 14:00 UTC slot (at `interval_hours=12`) produced no piece and no trace. Fixed in the same session — see "Multi-piece cadence — slot-aware guard fix (2026-04-22 PM)" below. Previously-resolved work still stands: `writeLearning` persists `piece_id` (8th required param); 4 callers threaded; made-drawer component + `/api/daily/[date]/made` endpoint scope learnings by piece_id when provided; Director splices `pieceId` into frontmatter at publish time; 5 existing MDX files backfilled; content schema requires it. Phase 7 commit `9d20b81` resolved the reader-engagement partial-fix (`engagement.piece_id` column + reader-path reads it directly); only degraded path now is stale cached reader bundles that don't yet send `pieceId` — the endpoint falls back to date lookup with "arbitrary at multi-per-day" semantics, acceptable for the edge case.

Phases shipped in order (each has its own DECISIONS entry):
- **Phase 1** — Identity foundations (`piece_id = daily_pieces.id`, audio PK rebuild, `pipeline_log.run_id` walk-back after caught same-day regression).
- **Phase 2** — `admin_settings` table + Director reads `interval_hours`.
- **Phase 3** — Hourly cron + runtime gate anchored to hour 2 UTC.
- **Phase 4** — URL `/daily/{date}/{slug}/` + `publishedAt` tiebreaker.
- **Multi-per-day unblocker batch** (between Phase 4 and Phase 5, three separate commits): pre-run DELETE removed, audio pipeline piece_id scoping + R2 key + latent `persistBeatRow` bug fix, Learner time-window filter.
- **Phase 5** — Admin settings UI with observer-event audit trail.
- **Phase 6** — Zita synthesis timing (relative delay) + piece_id scoping.
- **writeLearning piece_id extension (`cbf1f17`)** — last correctness blocker. pieceId in MDX frontmatter + D1 + made-drawer fetch.
- **Phase 7 partial (`1e17031`)** — Curator prompt label wording.

**Phase 7 FOLLOWUPS cleanup — all 5 items resolved 2026-04-22** (5 commits). Each closure in FOLLOWUPS.md has a `Resolved:` line with SHA; DECISIONS 2026-04-22 "Phase 7 FOLLOWUPS cleanup" is the full shipping log.
- `19910d7` — Copy cleanup (README + book chapters + pages + ARCHITECTURE/AGENTS/RUNBOOK + CLAUDE.md).
- `7ebae47` — `nextRunRelative()` cadence-aware via new `src/lib/cadence.ts`; dashboard reads `admin_settings.interval_hours` at render time.
- `9d20b81` — `engagement.piece_id` column (migration 0017 rebuild + backfill) + rehype-beats injects `data-piece-id` on `<lesson-shell>` + lesson-shell passes through engagement POST + Learner reads directly off row.
- `3208c86` — Admin per-piece deep-dive → `[date]/[slug]` nested route + `[date]/index.astro` legacy URL handler (redirect when unambiguous, disambiguation list at multi-per-day).
- `205ce1e` — `reset-today.sh --piece-id` flag + `--retrigger` opt-in for single-piece re-runs.

## Multi-piece cadence — slot-aware guard fix (2026-04-22 PM)
Late-caught correctness regression. User flipped `admin_settings.interval_hours=12` evening of 2026-04-21. The 02:00 UTC run on 2026-04-22 fired normally. The 14:00 UTC slot should have produced a second piece — no pipeline_log entry, no observer event, silent. Root cause at [agents/src/director.ts:140-146](agents/src/director.ts:140) pre-fix: a `SELECT id FROM daily_pieces WHERE date = ? LIMIT 1` guard inherited from the one-piece-per-day era. At multi-per-day every non-first slot passed the Phase 3 gate, hit this guard, matched the same-date piece, returned `null` before any logStep fired. Phase 1–7 correctness work never audited this guard.

**Fix:** slot-aware guard + observer-on-skip. `intervalHours` read moved above the guard; guard now queries `WHERE published_at >= ?` with slotStartMs = top of current UTC hour (Phase 3's gate already guarantees we only reach here on valid slot-boundary hours, so hour-top IS slot-start regardless of interval). New `observer.logDailyRunSkipped(date, intervalHours, slotStartMs, existingPieceId)` helper fires info-severity event whenever the guard catches a same-slot re-dispatch — silent skip is now impossible. At `interval_hours=24` (legacy default) slotStart rounds to 02:00 UTC and behaviour is identical to the prior calendar-day guard.

Non-scoped: local-time cron anchoring (confirmed UTC with user), `daily_pieces(published_at)` index (6 rows, irrelevant), `pipeline_log.run_id` semantics (stays `YYYY-MM-DD` per Phase 3 walk-back).

**Retroactive fill:** 14:00 UTC slot backfilled same session via `/daily-trigger` with force=true. Today ends with 2 pieces for date=2026-04-22 as intended at `interval_hours=12`.

See DECISIONS 2026-04-22 "Slot-aware guard for multi-per-day cadence" for the full trade-offs.

## piece_id columns on day-keyed tables — schema-level fix for multi-per-day admin misattribution (2026-04-22 PM)
Same session discovered the per-piece admin page (`/dashboard/admin/piece/<date>/<slug>/`) was misattributing audit rounds, pipeline steps, and scanner candidates at multi-per-day. Tobacco piece page showed air-traffic's fact claims + voice notes + 100 candidates because 3 queries scoped by date not piece_id: `audit_results.task_id='daily/<date>'`, `pipeline_log.run_id='<date>'`, `daily_candidates.date='<date>'`. Director also built identical `draft_id`s for both pieces (`daily/<date>-r<N>`), so the page's group-by-draft_id collided them with D1's last-writer-wins.

Initial fix in-session was an astro-side time-window bandaid (midpoint between publishes); user pushed back ("you are going round and round") and the session pivoted to a proper 5-phase schema fix. Plan file `~/.claude/plans/glowing-snacking-shell.md`. Deployed as:

1. **Migration 0018** — `ALTER TABLE pipeline_log ADD COLUMN piece_id TEXT` + index. Scoped DOWN from the original plan after `PRAGMA` showed 0014 had already added the column to `audit_results` + `daily_candidates`.
2. **Migration 0019** — manual backfill of 512 null rows: pre-2026-04-22 via date-join (unambiguous at 1/day), 2026-04-22 via midpoint split at timestamp 1776850364493 between the two pieces' `published_at`.
3. **Agents-worker writer threading** — Director pre-allocates `pieceId` at the top of `triggerDailyPiece()` (moved from publish-time). `logStep()` + `saveAuditResults()` + `scanner.scan()` + `learner.analysePiecePostPublish()` all thread piece_id. `retryAudio()`'s publish-step lookup gains `AND piece_id = ?`. Learner drops the `LEARNER_PIPELINE_LOOKBACK_MS` time-window — piece_id scope replaces it.
4. **Site-worker reader repointing** — 3 queries on `[date]/[slug].astro` + 5 queries on `/api/daily/[date]/made.ts` + `made-by.ts` teaser counts all switch to `WHERE piece_id = ?`. Midpoint bandaid deleted. `/api/dashboard/pipeline.ts` now returns `groups[]` + `headlines{}` keyed by piece_id; `admin.astro` renders Today's Run as collapsible per-piece `<details>` blocks (closes Bug A — no more flat 26-step blob).
5. **Docs** — this entry + DECISIONS 2026-04-22 "piece_id columns on day-keyed tables" + FOLLOWUPS closes.

**Verified against production D1 for 2026-04-22** (row-by-row via `wrangler d1 execute --remote`): audit_results air-traffic 6 / tobacco 3 / zero NULL; pipeline_log 23 / 19 including the 04:19 audio retry / zero NULL; daily_candidates 50 / 50 / zero NULL. Midpoint bandaid removed; pages now bind by piece_id directly.

**Trade-offs:**
- `pipeline_log.run_id` stays `YYYY-MM-DD` permanently (Phase 3 walk-back preserved) — piece_id is additive, so day-aggregation views (admin pipeline history, lifetime runs) keep working.
- Orphan piece_ids (scanner-skipped runs, pre-publish errors) have rows with no matching `daily_pieces.id` row. Accepted — those rows don't render on any piece's admin page.
- Audio + Zita sections were already piece-scoped via `daily_piece_audio.piece_id` (migration 0015) and `zita_messages.piece_id` (0013 + 0014). Untouched.
- observer_events keeps its 36h day window (legitimate day view of operator events).

Audio retry-fresh DELETE on pipeline_log is moot — the prior DELETE-audio-step row wipe was removed in an earlier 2026-04-21 commit (`ecedb87` / `900905d`); the path now relies on `daily_piece_audio` which is piece-scoped.

See DECISIONS 2026-04-22 "piece_id columns on day-keyed tables" for full phase log and rollback procedure.

## Multi-piece cadence — Phase 6 Zita synthesis timing + scoping (2026-04-21)
Zita synthesis is now piece-scoped on both timing and input. Previous absolute clock target (01:45 UTC day+1) would have stacked N pieces' synth jobs on one clock at multi-per-day AND given same-date afternoon pieces a truncated reader window. Relative delay of `publish + 85500s` (23h45m) per piece gives every piece the same ~24h window regardless of publish time. Learner's SELECT switches from `WHERE piece_date = ?` to `WHERE piece_id = ?` to stop cross-piece pooling on shared dates.

Scanner / Curator audited — **no change needed**. `getRecentDailyPieces(30)` already uses `WHERE date >= <30d-ago>` which includes today's pieces. Curator's prompt "avoid repetition" signal already covers today's prior picks at multi-per-day.

Surfaced during scoping: **`writeLearning` doesn't persist `piece_id`** — made-drawer's per-piece "What the system learned" section pools across same-date pieces at multi-per-day. New FOLLOWUPS entry. Cross-cutting (4 writer callers); must land before flipping `interval_hours<24` for the drawer to display correctly.

Other Phase 6 items deferred to Phase 7 (cosmetic): "days running" stat rename, observer dashboard grouping by piece_id, `reset-today.sh --piece-id` flag, Curator prompt label "Already published in last 30 days" (misleading at multi-per-day but substantively correct).

## Multi-piece cadence — Phase 5 admin settings UI (2026-04-21)
Admin-gated dashboard surface for flipping `admin_settings.interval_hours` without a redeploy. With the 3 multi-per-day blockers resolved (commits `ecedb87` + `900905d` + `30ddbdd`), flipping to any allowed value is now architecturally safe.

- [`src/pages/dashboard/admin/settings.astro`](src/pages/dashboard/admin/settings.astro) — admin page. Dropdown populated from `ALLOWED_INTERVAL_HOURS = [1,2,3,4,6,8,12,24]` (divisors of 24). Shows current value + last-updated timestamp. Submits via fetch to the POST endpoint.
- [`src/pages/api/dashboard/admin/settings.ts`](src/pages/api/dashboard/admin/settings.ts) — GET (reads current) + POST (writes new). Both ADMIN_EMAIL-gated. POST validates against the allowed set (400 otherwise), UPSERTs `admin_settings`, then fires an `admin_settings_changed` observer event with before/after values + changed-by email for audit trail.
- Admin page entry: new "Settings →" link in top-right nav of [`src/pages/dashboard/admin.astro`](src/pages/dashboard/admin.astro) alongside the existing "Zita activity →" link.

`ALLOWED_INTERVAL_HOURS` is duplicated between the site worker (settings endpoint) and agents worker ([`agents/src/shared/admin-settings.ts`](agents/src/shared/admin-settings.ts)). The two workers don't share imports; both must be updated together if the allowed set changes. Defensive layers preserve correctness on drift: the POST endpoint rejects out-of-set values, the agents-side `parseIntervalHours` falls back to 24 for anything not in the set — so a drift still fails safe.

**Verified (local build + preview):** `pnpm build` clean; `/dashboard/admin/settings/` redirects unauthenticated visitors to `/login/?redirect=…`; GET + POST to the API return 401 without an admin session. Authenticated flow runtime-verifies after deploy.

**Effective:** change propagates to Director at the next hourly cron alarm (up to 1h from save). No DO restart required — Director reads fresh via `getAdminSetting` per run (Phase 2).

## Multi-piece cadence — Phase 4 URL routing + `publishedAt` tiebreaker (2026-04-21)
Reader-facing URL shape changed from `/daily/YYYY-MM-DD/` to `/daily/YYYY-MM-DD/slug/`. No 301 redirect layer — old URLs stop existing (dev-phase decision from Phase 1 DECISIONS). Slug derives from the existing filename convention (`YYYY-MM-DD-{slug}.mdx`) via [`src/lib/slug.ts`](src/lib/slug.ts): `deriveSlug(entryId)` strips the 11-char date prefix.

Five files touched to land this:
- [`src/pages/daily/[date]/[slug].astro`](src/pages/daily/[date]/[slug].astro) — new route, replaces the old flat `src/pages/daily/[date].astro` (deleted).
- [`src/pages/index.astro`](src/pages/index.astro), [`src/pages/daily/index.astro`](src/pages/daily/index.astro), [`src/pages/library/index.astro`](src/pages/library/index.astro) — URL generation + sort switched to `publishedAt DESC` tiebreaker.
- [`src/pages/dashboard/admin/piece/[date].astro`](src/pages/dashboard/admin/piece/[date].astro) — admin "View on site" link looks up the slug via `getCollection('dailyPieces')` at request time. Admin route itself stays date-keyed (single-piece-per-date admin UX works at `interval_hours=24`; a Phase 5/6 rework adds piece_id when admin flips the interval).

`publishedAt: number` is now a required frontmatter field on the content-collection schema. The 5 existing MDX files got their `published_at` values from `daily_pieces` backfilled as single-line additions (metadata carve-out under the permanence rule). Going forward, Director splices `publishedAt: Date.now()` into frontmatter at publish time, alongside the existing `voiceScore` splice, and uses the same `publishedAtMs` value for the `daily_pieces` INSERT so the two sources of truth match.

**Build verified:** `pnpm build` produces all 5 pages at the new URL shape. **Preview verified (localhost:4321):** homepage hero + recent list + library + per-piece page all render; hero title sorts correctly by `publishedAt DESC` with a same-date tiebreaker; old `/daily/2026-04-21/` URL returns 404 as designed; zero console errors.

**Not yet shipped:** Drafter does not write `publishedAt` in the initial draft (it's spliced by Director at publish time). Admin deep-dive URL stays date-keyed — fine at `interval_hours=24`; at multi-per-day it shows the first matching piece for a date (UX degradation, not a correctness issue). Piece-id-keyed rework deferred to Phase 7.

## Multi-piece cadence — Phase 3 hourly cron + runtime gate (2026-04-21)
Behavioural phase. Cron changed from `'0 2 * * *'` to `'0 * * * *'` in `onStart`. [`dailyRun`](agents/src/director.ts) now reads `admin_settings.interval_hours` (Phase 2 helper), computes `(hour - 2 + 24) % intervalHours`, and bails silently when it's not this slot's turn. Anchored to hour 2 UTC so the 02:00 ritual is preserved at every allowed interval. With the default `interval_hours=24`, only the 02:00 slot fires — zero behavioural change until an admin flips the value.

Legacy `'0 2 * * *'` row gets canceled from inside `dailyRun` (not `onStart` — cancel-from-onStart hazard documented at director.ts:46-60). Runs on every un-gated invocation; idempotent once the row is gone per the SDK's `cancelSchedule` contract at [`agents/dist/index.js:1658`](agents/node_modules/agents/dist/index.js). No race against in-flight alarms because the cancel happens INSIDE the handler, after the SDK has already dispatched and re-scheduled the firing cron.

No migration. No new column. No query changes. Method name stays `dailyRun` (callback-name-is-method-name coupling means renaming requires schedule-table surgery; not worth it for a semantic rename).

**`pipeline_log.run_id` stays as `YYYY-MM-DD` permanently.** Walk-back reasoning from decision #3 in DECISIONS 2026-04-21 "Multi-piece cadence — Phase 3 hourly cron":
- (a) Regression on 2026-04-21 afternoon showed the consequence of changing it — four site-worker consumers broke.
- (b) Day-grouping is a legitimate view at multi-per-day — "today's pipeline activity" is the right semantic for admin surfaces.
- (c) No concrete consumer needs per-piece pipeline_log filtering yet — Phase 4's URL change gives per-piece context via slug, and a future phase can add `piece_id` column + site-worker query updates atomically when real demand emerges.

**Verified:** agents typecheck clean on touched file (18 pre-existing SubAgent errors in `server.ts` unchanged). `interval_hours=24` still seeded. Gate math verified: `(2-2+24)%24=0` passes, `(3-2+24)%24=1` bails, `(2-2+24)%4=0` passes (the 4h slot fires at 02/06/10/14/18/22), `(3-2+24)%4=1` bails.

**At Phase 3 ship time the flip was blocked on 3 follow-ups** (FOLLOWUPS.md "Unblock multi-per-day flip" — now `[resolved]`): pre-run DELETE at [director.ts:109](agents/src/director.ts), audio DELETE at [director.ts:783](agents/src/director.ts), Learner input scope at [learner.ts:338](agents/src/learner.ts). All three resolved same-day in commits `ecedb87` + `900905d` + `30ddbdd` before Phase 5 shipped the admin UI. See the top-level "Multi-piece cadence plan — status" section for current blocker state.

## Multi-piece cadence — Phase 2 admin_settings plumbing (2026-04-21)
Second phase of the cadence plan. Pure plumbing — zero behavioural change. Adds the `admin_settings` key/value table, seeds `interval_hours=24` (preserving current 1-piece/day cadence), and teaches Director to read the value once per run. No gate yet; no UI; nothing uses the value. Phase 3 adds the hourly cron + runtime gate that actually consumes it.

[migrations/0016_admin_settings.sql](migrations/0016_admin_settings.sql) created the table + seeded the row. [agents/src/shared/admin-settings.ts](agents/src/shared/admin-settings.ts) holds the reader (`getAdminSetting<T>(db, key, parse, fallback)`) plus `ALLOWED_INTERVAL_HOURS = [1,2,3,4,6,8,12,24]` and `parseIntervalHours()`. [agents/src/director.ts](agents/src/director.ts) reads the value at the top of `triggerDailyPiece` and passes it into the scanning step's `data` field — visibility in the admin pipeline feed confirms the read path works before Phase 3 relies on it.

`admin_settings` is the first admin-configurable surface in Zeemish v2. Future settings (rate limits, feature flags, voice overrides, scanner feed overrides) live in the same table so there's one operational config surface. Write path lands in Phase 5 with the admin UI; a future `admin_settings_changed` observer_event will provide the audit trail.

**Verified remote (2026-04-21):** admin_settings row = `interval_hours '24'`, tracker at 0016, agents typecheck clean on the two touched files (18 pre-existing SubAgent typing errors in server.ts unchanged). Next 2am UTC cron run smoke-checks the read path — expected to produce 1 piece as before, with `intervalHours: 24` in the scanning step's data JSON.

## Multi-piece cadence — Phase 1 identity foundations (2026-04-21)
Start of a new plan (`~/.claude/plans/could-please-do-a-harmonic-waffle.md`). Goal: admin-configurable publishing cadence — testing at 1 piece every 4 hours (6/day), production at 1 piece every 1 hour (24/day). Currently 1/day is baked in as both schema and semantics across ~50 sites.

Phase 1 shipped identity foundations only — zero runtime behaviour change. The work unblocks everything downstream (Phases 2–7) by ensuring no table's keys collide at multi-per-day.

**Key architectural finding:** `daily_pieces.id` is already a UUID (via `crypto.randomUUID()` at [director.ts:286](agents/src/director.ts)). piece_id doesn't need a new column on the parent table — `id` IS piece_id. Child tables (audit_results, learnings, zita_messages, daily_candidates) each got a nullable `piece_id TEXT` FK. `pipeline_log.run_id` stays TEXT but its values migrated from `YYYY-MM-DD` to piece_id UUIDs for the 5 historical runs. `daily_piece_audio` got a PK rebuild — old `(date, beat_name)` → new `(piece_id, beat_name)` — via snapshot → new table → copy → drop → rename dance in one atomic migration.

Two migrations shipped:
- [migrations/0014_piece_id_fks.sql](migrations/0014_piece_id_fks.sql) — additive ALTERs on 4 child tables + commented backfill UPDATEs (run manually via wrangler). pipeline_log.run_id backfill lives here too as commented UPDATEs.
- [migrations/0015_daily_piece_audio_piece_id_pk.sql](migrations/0015_daily_piece_audio_piece_id_pk.sql) — auto-applied PK rebuild with `daily_piece_audio_backup_20260421` snapshot as safety net.

**Verified remote (2026-04-21):** 100% piece_id coverage across all 4 child tables (3 + 27 + 92 + 32 rows). Two snapshot tables held for 7-day rollback (`daily_piece_audio_backup_20260421` 32 rows, `pipeline_log_backup_20260421` 111 rows) — drops queued in FOLLOWUPS for 2026-04-28.

**Correction same day (2026-04-21):** The `pipeline_log.run_id` backfill (rewriting 111 historical rows from date-strings to piece_id UUIDs) was rolled back within hours of applying. Four site-worker consumers had embedded `run_id = YYYY-MM-DD` assumptions — the backfill broke the "How this was made" drawer on every daily-piece page plus the admin per-piece deep-dive timeline. Snapshot `pipeline_log_backup_20260421` restored the correct values. Phase 1 decision #3 ("run_id = piece_id") is walked back: `pipeline_log.run_id` stays `YYYY-MM-DD` permanently, and a separate `piece_id` column will be added in a future migration alongside the site-worker query updates, atomically. See DECISIONS 2026-04-21 "Roll back `pipeline_log.run_id` backfill" for the full post-mortem and guardrail for future destructive migrations.

**Ten architectural decisions** (URL nesting `/daily/YYYY-MM-DD/slug/` with no 301 redirect, piece_id = daily_pieces.id, run_id = piece_id, hourly cron + runtime gate anchored to hour 2 UTC with divisors-of-24 constraint, most-recent hero by published_at, flat library, publish+23h45m per-piece Zita synthesis, 6/50 feeds at 4/day, keep "daily" copy, D1 admin_settings table) recorded in DECISIONS 2026-04-21 "Multi-piece cadence — Phase 1 identity foundations".

**Deferred to later phases:** admin_settings table (Phase 2), hourly cron + gate + multi-per-day code paths (Phase 3), URL routing + slug column + frontmatter updates (Phase 4), admin UI (Phase 5), Zita synthesis re-scoping + Scanner/Curator retune (Phase 6), copy + docs (Phase 7).

**Investigation parked:** `daily_candidates.selected` never set on historical runs (250 rows, 0 with selected=1). See FOLLOWUPS.

## Zita scoped by piece_date (2026-04-21)
Phase 1 of the Zita improvement plan. Live query on 2026-04-21 showed 92 `zita_messages` rows from 3 users pooled under the same `(course='daily', lesson_number=0)` key because [`LessonLayout.astro`](src/layouts/LessonLayout.astro) hardcodes those attributes for every daily piece. One reader's 80-message session spanned QVC → Hormuz → tariffs, all loading into every new Claude call together. Fixed in two commits.

1. [`ca23f11`](https://github.com/zzeeshann/zeemish-v2/commit/ca23f11) — **Commit A, schema + backfill.** Migration 0013 adds `zita_messages.piece_date TEXT` (nullable) + `idx_zita_piece(user_id, piece_date)`. Backfill for the 92 pre-migration rows is a commented one-time block inside the migration file, hand-mapped by conversation content + `created_at` windows because readers don't arrive synced to publish, so 0012's calendar-date pattern fails here. Includes a `zita_messages_backup_20260421` snapshot for rollback (drop queued for 2026-04-28 via FOLLOWUPS). Applied via `wrangler d1 migrations apply zeemish --remote`; backfill ran as five UPDATEs via `wrangler d1 execute`. Post-backfill distribution: 2026-04-17: 18 · 2026-04-19: 4 · 2026-04-20: 26 · 2026-04-21: 44 · Total: 92 · NULLs: 0.

2. [`03d9f0d`](https://github.com/zzeeshann/zeemish-v2/commit/03d9f0d) — **Commit B, code + prompt.** [`LessonLayout.astro`](src/layouts/LessonLayout.astro) passes `piece-date={date}`; [`<zita-chat>`](src/interactive/zita-chat.ts) reads the attribute and includes it in the POST body; [`/api/zita/chat`](src/pages/api/zita/chat.ts) requires `piece_date` for `course_slug='daily'` (400 "Missing or invalid piece_date" if absent/malformed), scopes the history SELECT via `AND piece_date IS ?`, writes it on both INSERTs. System prompt gains a one-line banner naming the piece: `You are discussing the piece titled "<title>", published <date>.` — half the reason Phase 1 existed. Honesty guardrail preserved: rule 6 of the prompt still says "If something is outside the lesson scope, say so honestly" — Zita stops flatly denying the site she lives on exists but does not overclaim catalogue access. Library search is gated on Phase 6 of the plan.

Two-commit split was deliberate: the 0012 rollout on 2026-04-20 hit d1_migrations tracker drift when code + schema landed together. Separating them means the schema applies, column is verified via `PRAGMA table_info`, *then* code starts reading/writing — no "code deployed but column missing" window.

Verified end-to-end via `preview_start` + `preview_eval`: daily-piece page renders with `piece-date` attribute from frontmatter, POST body carries it, 400 fires on missing piece_date, valid requests pass validation. See DECISIONS 2026-04-21 "Scope zita_messages by piece_date" for the full trade-offs.

**Zita improvement plan complete** (`~/.claude/plans/could-please-do-a-harmonic-waffle.md`). Six phases shipped 2026-04-21 in sequence: piece-scoping (1A + 1B), history soft cap (2), admin view (3), safety pass (4), P1.5 Learner skeleton (5), design doc (6). All phases verified, each has its own DECISIONS entry, no follow-ups open from the plan itself (the `zita_messages_backup_20260421` drop on 2026-04-28 is queued in FOLLOWUPS).

## Zita design doc (2026-04-21)
Phase 6 of the Zita improvement plan and the final one. Book ch.17 required a design doc before any deep-Zita code — that doc now exists at [`docs/zita-design.md`](docs/zita-design.md). Decisions (not wishlist) for the six questions ch.17 posed:

1. **Multi-turn state** — three layers: turn history (already exists, bounded), session summary (new `zita_session_summary` rolled at cap-hit), reader profile (new `zita_reader_profile`, derived by the daily P1.5 pass). Cross-session chat retrieval deferred to v2 behind a consent screen.
2. **Tools** — two: `get_current_piece(date)` (returns MDX, bounded) and `search_library(query, k=3)` (Vectorize). No external web search — would break voice consistency and multiply failure modes. ReAct loop capped at 6 steps per turn.
3. **Library index** — Cloudflare Vectorize, `@cf/baai/bge-base-en-v1.5` embeddings, indexed on Publisher's `publishing done` with 60s delay. 5-piece manual backfill.
4. **Failure modes** — six addressed: prompt injection (tool-results treated as untrusted), tool-loop exhaustion (step cap + observer event), wrong library result (k=3 + metadata sanity), voice drift (summary includes voice rules + §6 harness catches it), factual misparaphrase (`get_current_piece` lets Zita verify), hallucinated past piece (only reference via `search_library` results).
5. **Human handoff** — none. Zeemish isn't staffed for support; a handoff button would be a false promise. Graceful "I don't know" instead, with category-logging (crisis deflection, support deflection, PII acknowledgement, refusal) surfaced via observer events.
6. **Voice testing** — scripted synthetic-conversation harness (`agents/eval/zita-voice.ts`), 10 personas × 50 turns × 5 runs = 500 scored Zita replies per run, ≥95% voice-rule pass target. Runs before any prompt change.

The doc also sequences the **v1 deep-Zita build** as independently-shippable work items (library index → tool-use loop → session summary → reader profile → voice harness → category logging) and lists explicit non-goals (cross-session retrieval, multi-language, audio Zita).

Next plan (not this one) picks up at the v1 build sequence.

## P1.5 Learner skeleton — Zita-question synthesis (2026-04-21)
Phase 5 of the Zita improvement plan. Closes the last gap in the self-improvement loop for Zita: the `source='zita'` slot reserved in migration 0011 now has a writer. Mirrors the three-source pattern exactly — new `LEARNER_ZITA_PROMPT`, new `Learner.analyseZitaPatternsDaily(date)`, new Director `analyseZitaPatternsScheduled` alarm, new `observer.logZitaSynthesisMetered` + `logZitaSynthesisFailure`. No Drafter changes needed (`getRecentLearnings` is already source-agnostic).

Schedule is **01:45 UTC on day+1**, not publish+1h like the producer / self-reflection runs. Zita synthesis needs reader traffic that takes a day; firing at publish+1h means the ≥5-user-message guard would skip every run and mask the mis-scheduling. At 01:45 UTC day+1 the guard becomes a real signal — it skips when reader traffic is genuinely thin, not because we checked too early.

Guarded no-op below 5 user messages per piece. At today's traffic (3 readers, 5 pieces, 46 user messages across 4 days) most days will skip. The skip path still fires a metered info observer_event so "is the schedule running?" has a visible answer even when nothing lands.

Verified: typecheck passes with zero new errors (33 pre-existing before and after). Schedule math validated via a simulated 02:07 UTC publish → target 01:45 UTC next day, 85080s (23.63h) delay. Full runtime test deferred — would either need to wait 24 hours or manually invoke against real 26-message 2026-04-20 piece (17 user messages above threshold).

See DECISIONS 2026-04-21 "P1.5 Learner skeleton — Zita-question synthesis scheduled 01:45 UTC day+1 (Phase 5)".

## Zita safety smallest-viable pass (2026-04-21)
Phase 4 of the Zita improvement plan. Four observer call sites added via the Phase 2 `logObserverEvent` helper, plus a `capStoredContent(content, 4000)` on both INSERTs:

- **`zita_claude_error`** (severity `warn`) when the Claude API returns non-OK. Captures `{ httpStatus, userId, pieceDate, upstreamBody }` with the upstream body capped at 500 chars. Reader still sees the generic 503; the event is for ops.
- **`zita_rate_limited`** (severity `warn`) on the 429 path. Captures `{ userId, limit, windowSeconds }`. Makes the 20-msg-per-15-min limit visible instead of silent.
- **`zita_handler_error`** (severity `warn`) on the outer try/catch for unhandled exceptions.
- **Output cap** at 4000 chars on both user message and assistant reply INSERTs with a `\n\n[…truncated]` marker. 4000 is a ceiling above the typical 1200-char output from `max_tokens: 300`, not a target. Recognisable marker means operators can spot the rare case if it ever fires.

Verified with 22 rapid POSTs: 20 × Claude 401 → 20 × `zita_claude_error` rows with upstream authentication_error captured; 2 × 429 → 2 × `zita_rate_limited` rows. All rows correctly shaped. Test data cleaned before commit.

Deferred to Phase 6 design doc: prompt-injection hardening, PII redaction, escalation tuning, encryption at rest.

See DECISIONS 2026-04-21 "Zita safety smallest-viable pass (Phase 4)".

## Zita admin view (2026-04-21)
Phase 3 of the Zita improvement plan. Three surfaces went live, same-day sequel to Phase 2:

1. **`/dashboard/admin/zita/`** — standalone "What readers are asking" view. 30-day stats grid (conversations / messages / readers / truncations) + expandable conversation cards grouped by `(user_id, piece_date)`. Piece headlines joined from `daily_pieces`, deep-links to per-piece admin on every card.
2. **Per-piece deep-dive** gains a "Questions from readers" section between Audio and Observer events. Distinct readers listed with full transcripts.
3. **Main admin page** gains a "Zita activity →" link in the top-right corner for discoverability.

Defensive catch during verification: originally had the Zita query nested inside the same `try/catch` as the audio query on the per-piece page. When the local D1 was missing `daily_piece_audio` (0010 tracker drift), audio threw, the shared catch swallowed it, Zita section silently vanished. Split into its own `try { ... } catch {}` — an unrelated failure can't hide the Questions block now.

No schema changes, no writer changes, no new data flows. All three surfaces read existing tables.

See DECISIONS 2026-04-21 "Admin Zita view (Phase 3)".

## Zita history soft cap (2026-04-21)
Phase 2 of the Zita improvement plan. Same-day sequel to the piece-scoping work above. Even scoped by piece_date, one reader's long session could still grow unbounded — in the 92-row audit, one user had 44 messages scoped to a single piece, and Zita reloads the full history into every new Claude call. Cost grows linearly with session length.

Fix in one commit: cap the Claude-side history at 40 rows (20 turns), batched with a `COUNT(*)` in one D1 round trip, and fire a `zita_history_truncated` observer_event (severity `info`) when the cap clips. The event carries `{totalCount, loadedCount, clippedCount, userId, pieceDate}` so the admin feed shows exactly how much was trimmed. Full history stays in D1 — the cap is purely about what Claude sees per turn.

Also introduced **`src/lib/observer-events.ts`** — first site-worker → observer_events writer. Mirrors the agents-side `observer.ts:writeEvent` shape. Fire-and-forget with swallowed errors. Phase 4 will reuse it for `zita_claude_error` and `zita_rate_limited` events.

Verified end-to-end by seeding 45 rows for a test user on 2026-04-20 locally: `COUNT(*)` returned 45, `LIMIT 40` returned exactly 40, and the synthetic observer_events INSERT queried back with all fields populated. Test data cleaned before commit.

See DECISIONS 2026-04-21 "Cap Zita history load at 40 + log truncation to observer_events".

## Hygiene + correctness pass (2026-04-20, afternoon session)
Six commits shipped working through `docs/FOLLOWUPS.md` step by step. Rollback point for the whole session is [`f87a520`](https://github.com/zzeeshann/zeemish-v2/commit/f87a520). Each commit deployed green on both workers with a post-deploy smoke check on `/`, `/daily/`, `/library/`, `/dashboard/`. FOLLOWUPS is visibly shorter.

1. [`81f6964`](https://github.com/zzeeshann/zeemish-v2/commit/81f6964) — removed unused `/api/dashboard/today` endpoint. Zero runtime callers; the endpoint's last commit (`b84de9e`, 2026-04-17) was itself a comment-only update noting the consumer was gone. Sibling-endpoint audit (`analytics.ts`, `observer.ts`, `pipeline.ts`, `recent.ts`, `stats.ts`) logged as its own new FOLLOWUP rather than piggybacked.
2. [`c3cd104`](https://github.com/zzeeshann/zeemish-v2/commit/c3cd104) — book ch 9 "4–6 beats" → "3–6 beats". Code is authoritative; tightening `STRUCTURE_EDITOR_PROMPT` would have broken legitimate 3-beat pieces for a one-line doc fix.
3. [`e005f4a`](https://github.com/zzeeshann/zeemish-v2/commit/e005f4a) — book ch 10 reconstructed commit subject replaced with the literal one, verified against git log (four matching commits across the 2026-04-19 reset/retry cycle). Book is a forensic record, not an illustrative guide.
4. [`4a6a004`](https://github.com/zzeeshann/zeemish-v2/commit/4a6a004) — added `### Migration tracker hygiene` section to RUNBOOK covering pre-flight `SELECT name FROM d1_migrations`, the "always use `migrations apply`" rule, and a link to DECISIONS for the 2026-04-20 drift-recovery procedure.
5. [`b06ad60`](https://github.com/zzeeshann/zeemish-v2/commit/b06ad60) — aligned the stale `### Run migrations` block with the new hygiene section. Count 10→12, `execute --file` loop → `migrations apply`, contradictory pointer paragraph removed.
6. [`fae8e21`](https://github.com/zzeeshann/zeemish-v2/commit/fae8e21) — dropped StructureEditor's `writeLearning` calls. Investigation (compare QVC 2026-04-17 SE rows vs Hormuz 2026-04-20 Learner rows) showed SE's writes were a noisier pre-synthesis copy of a signal Learner already processes post-publish via `audit_results`: 2 of 4 QVC rows duplicated internally, and every row taught Drafter a rule the SE prompt already enforces. Return shape unchanged (Director + Integrator still gate on `{passed, issues, suggestions}`), unused `pieceDate` parameter removed alongside. Historical rows stay in D1 and age out of `getRecentLearnings(10)`.

**Tomorrow's verification checkpoint for #6 (StructureEditor drop):** on 2026-04-21 after the 2am UTC cron, check the learnings table for that date's piece. Expected shape: Learner rows (post-publish synthesis) + Drafter self-reflection rows, zero StructureEditor-shape rows. If SE-shape rows appear, #6 regressed and we investigate. If they're absent, the behavioural change is confirmed.

**Next session primary work:** the audio retry trio in FOLLOWUPS — Publisher.publishAudio double-fires on Continue retry, Continue re-runs full pipeline, silent stall between alarm chunks. These bugs compound (they're what corrupted 2026-04-17's frontmatter) and share code paths, so they want a fresh session with a proper P0 scan rather than tacking onto tonight's hygiene pass.

## What was built

1. **Foundation:** Astro + Tailwind + MDX + TypeScript strict, Cloudflare Workers, GitHub Actions CI/CD
2. **Reader Surface:** Beat-by-beat navigation Web Components (one beat at a time), content collections
3. **Accounts & Progress:** Anonymous-first auth, D1, progress tracking, magic link login (Resend)
4. **Agent Team:** 13 agents on Cloudflare Agents SDK, full pipeline with quality gates + audio narration
5. **Self-Improvement:** Engagement tracking, LearnerAgent, learnings database
6. **Zita:** Socratic learning guide in every piece
7. **Daily Pieces:** ScannerAgent, Director daily mode, news-driven teaching on hourly cron gated by `admin_settings.interval_hours` (default 24 → fires at 02:00 UTC once per day; admin-configurable)
8. **Dashboard:** Public factory floor (/dashboard/) + admin control room (/dashboard/admin/)

## Architecture

### Two Workers
- **zeemish-v2** — Astro site: pages + API routes. `https://zeemish.io` (custom domain; workers.dev URL still active as fallback)
- **zeemish-agents** — 13 agents as Durable Objects. `https://zeemish-agents.zzeeshann.workers.dev`

### Stack
- Frontend: Astro + MDX + TypeScript strict + Tailwind + Web Components
- Backend: Cloudflare Workers (Astro adapter) + D1 (14 tables) + R2 (audio)
- Agents: Cloudflare Agents SDK v0.11.1
- AI: Anthropic Claude Sonnet 4.5
- Audio: ElevenLabs (Frederick Surrey voice)
- Email: Resend (magic link from hello@zeemish.io)
- Deploy: GitHub Actions → Cloudflare (both workers auto-deploy)

### The 13 Agents (one job per agent, one file per agent)

Pipeline: Scanner → Curator → Drafter → [Voice, Structure, Fact] → Integrator → Publisher → Audio Producer → Audio Auditor → Publisher.publishAudio (second commit splices audioBeats into frontmatter). Text ships first — audio is ship-and-retry so the day is never blank. Observer receives events throughout. Learner runs off-pipeline, watching readers.

1. **ScannerAgent** — reads the news every morning
2. **DirectorAgent** — pure orchestrator. Routes work between agents. Zero LLM calls. Hourly cron gated by `admin_settings.interval_hours` (default 24 → fires at 02:00 UTC once per day).
3. **CuratorAgent** — picks the most teachable story from today's candidates, plans beats + hook + teaching angle
4. **DrafterAgent** — writes the MDX from the brief, enforces `<lesson-shell>` / `<lesson-beat>` format
5. **VoiceAuditorAgent** — voice compliance gate (≥85/100)
6. **FactCheckerAgent** — verifies every claim (two-pass: Claude + DuckDuckGo)
7. **StructureEditorAgent** — reviews flow and pacing
8. **IntegratorAgent** — handles revisions before approval (3 rounds max)
9. **AudioProducerAgent** — generates per-beat MP3 via ElevenLabs (Frederick Surrey, `eleven_multilingual_v2`, 96 kbps), saves to R2, writes `daily_piece_audio` rows. 20k-char hard cap per piece, 3-attempt retry on transient failures, request-stitching for prosodic continuity.
10. **AudioAuditorAgent** — reads `daily_piece_audio` rows, verifies R2 objects exist + file sizes are sane + total chars under cap. Passes/fails without touching git.
11. **PublisherAgent** — commits to GitHub, piece goes live
12. **LearnerAgent** — learns from reader behaviour, writes patterns for future pieces
13. **ObserverAgent** — logs every pipeline event for the admin dashboard

### Dashboard
- **Public** (`/dashboard/`) — anyone can visit. Shows pipeline status, quality scores, agent team, library stats, recent pieces. Transparency is the brand.
- **Admin** (`/dashboard/admin/`) — ADMIN_EMAIL only. Pipeline controls, observer events with acknowledge, engagement data, agent tasks.

### Database (D1 — 14 tables, 16 migrations)
See `docs/SCHEMA.md`.
- Reader: users, progress, submissions, zita_messages, magic_tokens
- Agent: observer_events, engagement, learnings, audit_results, pipeline_log
- Daily: daily_candidates, daily_pieces (+ `has_audio` col), daily_piece_audio (per-beat MP3 rows)

### Key directories
```
src/pages/              Routes (index, daily, library, dashboard, account, login, API)
src/pages/api/dashboard/ Dashboard API (today, recent, stats, analytics, observer)
src/interactive/        Web Components (lesson-shell, lesson-beat, zita-chat)
src/lib/                Auth, DB helpers, rate limiting, formatting (formatDate, formatTime)
src/styles/             global.css (Tailwind) + beats.css + zita.css (standalone, not Tailwind-processed)
src/layouts/            BaseLayout, LessonLayout
content/daily-pieces/   Daily teaching pieces (YYYY-MM-DD-slug.mdx)
agents/src/             13 agent files (one per agent) + per-agent prompt files + shared code
migrations/             D1 schema migrations (0001-0006)
docs/                   Living documentation
docs/handoff/           Original architecture + specs
```

### Security
- Session cookies: HttpOnly, Secure, SameSite=Lax
- Passwords: PBKDF2 100k iterations, timing-safe comparison
- CSRF: origin header check (strict URL parsing)
- Rate limiting: login (5/15min), Zita (20/15min), upgrade (5/15min)
- Agents: ADMIN_SECRET bearer token, CORS restricted to allowed origins + preflight
- Dashboard: public view (no auth), admin view (ADMIN_EMAIL gated)
- Input validation: JSON try-catch, message length limits
- CSP header, X-Frame-Options DENY

### Secrets (never in code)
**Site worker:** ANTHROPIC_API_KEY, RESEND_API_KEY, AGENTS_ADMIN_SECRET, ADMIN_EMAIL
**Agents worker:** ANTHROPIC_API_KEY, GITHUB_TOKEN, ELEVENLABS_API_KEY, ADMIN_SECRET

### Site navigation
**Daily · Library · Dashboard · Account**

## Documentation index
- `docs/ARCHITECTURE.md` — what's built, deviations from plan
- `docs/AGENTS.md` — all 13 agents, endpoints, secrets
- `docs/SCHEMA.md` — all 13 D1 tables, 10 migrations
- `docs/RUNBOOK.md` — how to run, deploy, trigger, revert
- `docs/DECISIONS.md` — technical decisions (append-only)
- `docs/handoff/` — original specs (architecture, daily pieces, dashboard, project brief, instructions)

## Remaining minor items
- Voice contract .ts has belief line synced, but may drift — .md is canonical
- Audio-Auditor does file checks only (no STT round-trip)
- Audio `/audio/*` route returns 200 with full body for Range requests instead of 206 partial — browsers buffer the whole clip rather than seek. Per-beat clips are small so it's tolerable; revisit if seek behaviour or bandwidth becomes a concern
- Rate limiter is KV-backed (Workers KV, eventually consistent)
- CSP uses `unsafe-inline` for scripts (required by Astro)
- Dashboard pipeline API's `isRunning` heuristic is buggy on the API itself — admin's consumer fixes it inline; if other consumers want the right answer, fix the endpoint properly
- Zita chat panel uses white background — feels off-brand vs the cream `zee-bg` used elsewhere; rebrand needed
- OG image is one static SVG for every page; per-piece dynamic OG (headline + tier rendered to PNG at the edge) is a future Worker route project
- No skip-to-content link for keyboard users; full WCAG audit deferred
- **Security headers on prerendered HTML (`/`, `/daily/*`, `/library`) — known gap.** Despite `_routes.json` `include: ["/*"]` + `run_worker_first = true` + middleware `Cache-Control: no-store` on HTML, Cloudflare Workers Static Assets serves prerendered `.html` files directly without invoking the worker. Server-rendered routes (`/dashboard/`, `/api/*`, `/audio/*`, `/account`, `/login`) DO get all 6 headers (CSP/HSTS/X-Frame-Options/X-Content-Type-Options/Referrer-Policy/Permissions-Policy) — those are the auth-touching, security-critical surfaces. The static reading pages have no auth, no cross-origin fetches, no third-party scripts beyond Google Fonts (preconnect only). Practical residual risk = clickjacking (low — there's no sensitive UI to overlay). Two future paths if we want to close it: (a) Cloudflare Transform Rule injecting headers at the edge (5 min UI work, ironclad), (b) `prerender = false` on those pages (worker runs every time, ~15-50ms perf hit). See `docs/DECISIONS.md` 2026-04-18 "Ship as-is despite header gap" for the full reasoning.
- DNS `R2 listens.zeemish.io` and `Worker api.zeemish.io → zeemish-api` are leftover from the OLD breathing-tools site. Different subdomains, not in the way of launch. Retire when convenient — they don't serve anything used by zeemish-v2.
- Cache-purge needed on every Cloudflare deploy to evict CDN-cached prerendered HTML — until the header-gap above is closed (any solution there fixes this too)
- Fact-checker's DDG leg uses the **Instant Answer API** (`api.duckduckgo.com/?q=...&format=json`) which only resolves Wikipedia-like topics — specific news claims ("fuel prices spiked 18% last month") legitimately return empty. After the 2026-04-19 refactor, `searchAvailable: false` now means genuinely unreachable; reachable-but-empty results return `searchAvailable: true, searchUsed: false` (dashboard signal is honest). Long-term upgrade: swap DDG IA for a richer backend (Brave Search API, Serper, or Claude's native web-search tool). DDG IA realistically only verifies ~5% of specific claims — most pieces' Facts ✓ gate currently lands on first-pass Claude.
- Drafter-declared `beatCount` in frontmatter can drift from actual `##` heading count in the MDX body. 2026-04-17 previously declared 6 but has 8 `##` headings — corrected to 8 via a frontmatter-only edit on 2026-04-19 (permitted under the metadata carve-out). Reader UI counts actual headings in `src/lib/rehype-beats.ts` and is correct regardless; the stored metadata in `daily_pieces.beat_count` is still the Drafter's declared number. Durable fix still pending: add a Structure-Editor gate (`beatCount` must equal number of `##` in body) or drop the frontmatter field and derive it at render time.
- Drafter authors beat headings in kebab-case (`## qvcs-original-advantage`), which `rehype-beats.ts` humanises for display. Lossy for acronyms and punctuation — "Qvcs Original Advantage" not "QVC's Original Advantage". Fixed via optional `beatTitles` frontmatter map (added 2026-04-19) that overrides `humanize(slug)` per beat. Parallel durable fix still pending: teach Drafter to write display-formatted `##` headings going forward so new pieces don't need the override. See DECISIONS 2026-04-19 "Frontmatter edits permitted for display-layer fixes".

## Design pass (2026-04-17)
- Beat navigation activated: `src/lib/rehype-beats.ts` wraps `##`-demarcated MDX sections in `<lesson-shell>`/`<lesson-beat>` at build time. No agent changes.
- Homepage: hero + "made by 13 agents" pipeline strip + recent list. Mission line moved to footer (`BaseLayout`).
- Library: month-grouped, filterable by title/subject, topic pills in gold. No quality filter — every published piece appears.
- Dashboard: three unified quality-score cards (score + tier + bar); avg voice score shows sample size; admin button guard hardened against undefined email match.
- Post-deploy triage (same day): avg voice score now reads `daily_pieces.voice_score` (final-round per piece) instead of `audit_results WHERE passed=1` — see DECISIONS.md. Library stats card 4 unified to match cards 1–3 (days running + "Since" subtitle). Account page: date eyebrow, title, reading stats (pieces completed / in progress), tidier actions.
- Transparency drawer (2026-04-18): every daily piece now has a "How this was made" drawer at the bottom. Shows full pipeline timeline, per-round auditor output (Voice / Facts / Structure), voice-contract rules applied, and candidates Scanner surfaced. Fed by new public endpoint `/api/daily/[date]/made` that aggregates `pipeline_log` + `audit_results` + `daily_candidates` + `daily_pieces`. Deep-linkable via `#made`. No schema, no agent changes.
- Dashboard refocused (2026-04-18): now the cross-piece, cross-day view (the drawer owns per-piece). Sections: live header subtitle (next run countdown), one-line today status, week's output stat grid (pieces / avg voice / tier mix / avg rounds), recent-runs feed, "How it's holding up" honest signals (unresolved escalations / fact-check web / candidates-per-day), agent team with active marker, footer with Voice contract + admin link. All queries against existing tables. Removed: redundant Today fat card, redundant Quality Scores grid, redundant Recent Pieces list, redundant Library stat grid, top-level Admin Panel CTA.
- Site polish bundle (2026-04-18): custom on-brand 404, OG/Twitter meta + branded SVG OG image, Google Fonts preconnect, library filter focus ring restored, drawer no longer fetches on every page mount (lazy-loads on first open), dashboard "How it's holding up" rows stack on mobile.
- Audio pipeline live (2026-04-18): un-paused the two audio agents. New migration `0010_audio_pipeline.sql` adds `daily_piece_audio` (per-beat rows: r2_key, public_url, character_count, request_id, model, voice_id) + `has_audio` on `daily_pieces`. Producer switched to `mp3_44100_96`, added `use_speaker_boost`/`speed: 0.95`/request-stitching/"Zeemish → Zee-mish" alias, 20k-char budget cap (`AudioBudgetExceededError`), 3-attempt retry on 5xx, 4xx fails fast. Auditor rewritten to read rows + HEAD R2 (0.3×–3× expected-size tolerance). Director gained `runAudioPipeline` (ship-and-retry after Publisher) + public `retryAudio(date)`. Publisher gained `publishAudio` (second commit, idempotent, metadata-only). AudioPlayer.astro is now a `<audio-player>` web component that listens for `lesson-beat:change` and auto-advances on clip end. Transparency drawer gains Audio section. Admin piece deep-dive gains Audio section + Retry button (proxies `/audio-retry` → Director). `publishToPath` still refuses to overwrite content — `publishAudio` is an allowed metadata-only carve-out (see DECISIONS 2026-04-18).
- Admin control room + per-piece deep-dive + login refresh (2026-04-18): `/dashboard/admin/` rewritten to match the design system — today's run, system-state stat grid, observer events (with in-place ack), all-pieces list with filter, pipeline history. New route `/dashboard/admin/piece/[date]/` shows everything about one day: full timeline, all rounds with full violations/claims/issues (no truncation), all 50 candidates (no cap), observer events for that day, raw JSON dumps. Login page updated to use the eyebrow/title/subtitle header. Engagement section dropped from admin (legacy lessons-era data), placeholder pointing to CLAUDE.md. `isRunning` heuristic fixed inline on admin's poller (step name + status, not just step name).
- Audio hardening (2026-04-19, timeout raised 2026-04-22): `callElevenLabs` gained an `AbortSignal.timeout` per attempt (prior silent hang on stalled TCP is now a loud escalation). Originally 30s; bumped to 90s on 2026-04-22 after the 2026-04-22 run failed at beat 3 of 5 — Integrator had consolidated 8 beats → 5, pushing `why-the-debt-compounds` to ~3000 chars, and at `speed: 0.95` eleven_multilingual_v2 couldn't return within 30s on the happy path. Three retries burned ~93s before the producer gave up. 90s is ~6x the typical happy-path latency for a 2000-char beat; worst-case 3-attempt exhaustion at 90s × 3 + backoffs ≈ 273s/beat, still well under the alarm's 15-min budget. See DECISIONS 2026-04-22 "Bump ElevenLabs per-attempt timeout 30s → 90s". **Verified post-fix on 2026-04-22:** admin Continue retry completed 5/5 beats in 75s across 2 chunks with zero per-attempt retries — the three remaining beats (2960 / 3384 / 118 chars) each returned cleanly inside the 90s cap. Publisher second-commit `9bc60b5` spliced `audioBeats` into frontmatter; `has_audio=1`. Director gained `retryAudioFresh(date)` — wipes R2 clips + `daily_piece_audio` rows + `has_audio` + `pipeline_log` audio-* rows, then calls `retryAudio`. `/audio-retry` accepts `?mode=continue|fresh`; admin piece deep-dive shows **Continue** + **Start over** buttons whenever `has_audio ≠ 1` (including partial state), Start over triggers a confirm() dialog showing clip count that will be deleted. See DECISIONS 2026-04-19 "Audio pipeline hardening" for why.
- Audio RPC budget (2026-04-19, later same day): Cloudflare Durable Object RPC calls have a ~30s wall-clock ceiling. Producer's `generateAudio` ran a loop over 6 beats × 10-15s ElevenLabs = 60-90s wall time, getting silently killed around beat 2 in every run. **Fix:** chunked generation. Producer method renamed to `generateAudioChunk(brief, mdx, maxBeats = 2)` — processes at most N new beats per call (always under budget), returns `{processedBeats, totalBeats, completedCount, totalCharacters}`. Director's `runAudioPipeline` replaces the single await with a bounded while-loop (≤10 iterations). Cross-chunk prosodic continuity preserved: each chunk loads last 3 `request_id`s from D1 for ElevenLabs `previous_request_ids` stitching. Publisher's `audioBeats` map is now read from D1 (source of truth covering multi-chunk accumulation + head-check skip from prior partials). See DECISIONS 2026-04-19 "Audio RPC wall-clock budget".
- DO eviction root cause (2026-04-19, even later): Phase F chunking helped but didn't fix the stall — next trigger died at 1/5 beats. The actual cause was **Agents SDK DO eviction after 70-140s of inactivity** (documented in `agents/node_modules/agents/dist/index.js:1671-1699`, not a Cloudflare platform limit). Text pipeline alone runs ~107s, so audio always straddled the eviction cliff regardless of how short each producer RPC call was. **Fix:** wrap `triggerDailyPiece`, `retryAudio`, `retryAudioFresh` with `const dispose = await this.keepAlive();` + try/finally. The SDK fires a 30s heartbeat alarm that resets the inactivity timer; reference-counted so nested calls are safe. Phase F chunking is still valuable for clean retry semantics, cross-chunk `request_id` stitching, and progress visibility — but `keepAlive()` is what actually unblocks single-shot completion. See DECISIONS 2026-04-19 "DO eviction was the real root cause".
- Audio runs on alarm, not inline (2026-04-19, finally): keepAlive still wasn't enough — next trigger stalled again at 2/5. Real Cloudflare docs: HTTP-triggered DO invocations risk eviction *"after 30s of compute between incoming network requests"* and **Durable Objects are single-threaded** so alarm heartbeats can't deliver while the current method is holding the DO. **Alarm handlers have a separate 15-minute wall-clock budget.** Fix: `triggerDailyPiece` no longer runs `runAudioPipeline` inline — it calls `this.schedule(1, 'runAudioPipelineScheduled', {date, filePath, title})` and returns. Alarm fires 1s later in a fresh invocation with the 15-min budget. New method `runAudioPipelineScheduled(payload)` re-reads MDX from GitHub (keeps SQLite payload small) and calls `runAudioPipeline`. Same for `retryAudio` — validates synchronously, then schedules. Phase F chunking + Phase G keepAlive are retained (cheap + defensive) but the alarm boundary is what actually works. See DECISIONS 2026-04-19 "Audio via alarm, not inline".

## Closing the self-improvement loop (2026-04-19)
Twelve of thirteen agents have been running identical prompts every day since launch. The `learnings` table was effectively write-only — StructureEditor and Learner wrote into it, but no agent's runtime prompt read from it. From 2026-04-19 the loop starts closing, incrementally.

- **P1.1 — Drafter reads learnings at runtime.** Before building its prompt, Drafter calls `getRecentLearnings(DB, 10)` and includes the results in a "Lessons from prior pieces" block positioned between the Voice Contract and the Brief. Contract binds → lessons guide → brief specifies. Voice contract still wins on conflict (explicit line in the block). Fail-open on DB errors; block is omitted when empty. `getRecentLearnings` signature widened from `(db, category, limit)` → `(db, limit)` — no source filter so producer/self-reflection/reader/zita origins compound in the same feed. See DECISIONS 2026-04-19 "Drafter reads learnings at runtime". Files: [agents/src/drafter.ts](agents/src/drafter.ts), [agents/src/drafter-prompt.ts](agents/src/drafter-prompt.ts), [agents/src/shared/learnings.ts](agents/src/shared/learnings.ts).
- **P1.3 — Learner writes producer-origin learnings post-publish.** Migration 0011 added `learnings.source` (reader/producer/self-reflection/zita, nullable TEXT, no CHECK). `writeLearning` now takes a required `source` argument; StructureEditor's auditor-time writes pass `'producer'`, Learner's engagement-analysis writes pass `'reader'`. New Learner method `analysePiecePostPublish(date)` reads the full quality record (`daily_pieces` + `audit_results` + `pipeline_log` + `daily_candidates`) and writes up to 10 producer-origin learnings per piece; Director fires it via `this.schedule(1, 'analyseProducerSignalsScheduled', ...)` immediately after `publishing done` so it's off-pipeline and non-blocking. Non-retriable on failure (logs via `observer.logLearnerFailure`); overflow beyond 10 rows logs via `observer.logLearnerOverflow`. See DECISIONS 2026-04-19 "Learner writes producer-origin learnings post-publish".
- **P1.4 — Drafter self-reflects post-publish.** After `publishing done`, Director fires `Drafter.reflect(brief, mdx, date)` via `this.schedule(1, 'reflectOnPieceScheduled', ...)` alongside the Learner schedule. Drafter re-reads the committed MDX from GitHub, evaluates it as a peer editor would (prompt explicitly names the stateless reality — "you didn't write this piece, a prior invocation did"), and writes up to 10 learnings with `source='self-reflection'`. Same cap/fail-silent semantics as P1.3. One Sonnet call per publish, metered via `observer.logReflectionMetered` (tokens-in/out + latency) for cost visibility. See DECISIONS 2026-04-19 "Drafter self-reflects post-publish".
- **P1.5 — pending.** Zita-question learning waits on readers + Zita traffic.

## Surfacing the learning loop (2026-04-20)
With P1.3 + P1.4 writing producer and self-reflection rows after every publish, the next step was making that visible. Two surfaces shipped same day, one commit each.

- **Dashboard "What we've learned so far" panel** (`/dashboard/`, commit [b96c8d6](https://github.com/zzeeshann/zeemish-v2/commit/b96c8d6)). Three counts (producer / self-reflection / total) plus the most recent observation as a blockquote with source attribution. Fed by `/api/dashboard/memory`. Inserted between "How it's holding up" and "The agent team". Hidden entirely when the learnings table is empty. Files: [src/pages/api/dashboard/memory.ts](src/pages/api/dashboard/memory.ts), [src/pages/dashboard/index.astro](src/pages/dashboard/index.astro).
- **Per-piece "What the system learned from this piece" section** in the How-this-was-made drawer (`/daily/[date]/`, commit [a0a9b22](https://github.com/zzeeshann/zeemish-v2/commit/a0a9b22)). Grouped by source in fixed order (Drafter self-reflection → Learner producer-side pattern → reader → zita). Absent entirely when the piece has no learnings. Required migration 0012 adding `learnings.piece_date TEXT`, plus a one-time backfill of 13 pre-migration rows (4 → 2026-04-17 QVC, 9 → 2026-04-20 Hormuz). Files: [src/pages/api/daily/[date]/made.ts](src/pages/api/daily/[date]/made.ts), [src/interactive/made-drawer.ts](src/interactive/made-drawer.ts), [src/styles/made.css](src/styles/made.css), [migrations/0012_learnings_piece_date.sql](migrations/0012_learnings_piece_date.sql).

Source labels shared across both surfaces — "Learner, producer-side pattern", "Drafter self-reflection", "Reader signal", "Zita question pattern" — so the vocabulary is stable from dashboard cross-piece view to per-piece drawer view. `writeLearning` now enforces non-null `pieceDate` at the application layer (same defensive shape as `source` from 0011). See DECISIONS 2026-04-20 "Surfacing the learning loop" for the full rationale, the D1 quirks hit during the backfill (migration-tracker drift, correlated-subquery limitation), and the grouping-order call.

## Launch readiness (2026-04-18)
Pre-launch pass before pointing zeemish.io at the new worker. Audit revealed several "Remaining minor items" were already done (audio R2 wiring, /audio/* route, engagement writes via lesson-shell); the docs were drifting. Real fixes:
- **`audio_plays` engagement now wired**: `<audio-player>` dispatches `audio-player:firstplay` on first play in a session, `<lesson-shell>` listens and POSTs `event_type='audio_play'` once per session per piece. Previously the column was always 0 — silent gap. Files: [src/interactive/audio-player.ts](src/interactive/audio-player.ts), [src/interactive/lesson-shell.ts](src/interactive/lesson-shell.ts).
- **Admin engagement widget rendered**: `/dashboard/admin/` now shows per-piece views/completions/audio_plays/drop-off, aggregated across activity dates via `GROUP BY lesson_id` from the existing `engagement` table. Each row deep-links to the per-piece admin route. Replaces the honest placeholder. Reader-side data was already flowing from lesson-shell since the daily-pieces era — only the surface was missing.
- **Security headers moved into middleware**: `public/_headers` was silently ignored by Cloudflare Workers Static Assets (live response had zero security headers). Now `src/middleware.ts` applies CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy on every response. Required two coordinated fixes: (1) `run_worker_first = true` in `[assets]`, (2) `scripts/post-build.sh` overrides the Astro Cloudflare adapter's auto-generated `_routes.json` to put prerendered HTML (`/`, `/daily/*`, `/library`) BACK into the worker's reach — by default the adapter excludes them as a perf optimisation, which made middleware a no-op for those paths. Middleware also sets `Cache-Control: private, no-store` on `text/html` responses so the CDN edge cache can't intercept them before the worker runs. Static assets (`/_astro/*`, og image, robots.txt) still skip the worker — they don't need security headers and would just add overhead. CSP `connect-src 'self'` (Agents worker is reached via service binding, not browser fetch). `public/_headers` deleted to avoid future confusion.

**Critical lesson — Cloudflare Workers Static Assets (read this before touching cache or headers):** Three caching/routing layers interact and you have to defeat all of them to get headers on prerendered HTML.
1. **Adapter `_routes.json`** auto-excludes prerendered paths from the worker — overridden by `scripts/post-build.sh`.
2. **`run_worker_first`** in wrangler.toml asset binding — needed so the worker actually runs for the now-included paths.
3. **Cloudflare CDN edge cache** sits before the worker; cached HTML is served without ever invoking the worker — defeated by `Cache-Control: private, no-store` on `text/html` from middleware.

**Update after launch (2026-04-18):** Even all three of the above did NOT get headers onto prerendered HTML in production. Cloudflare Workers Static Assets appears to serve `.html` files directly from the asset binding for filesystem-resolvable paths regardless of `_routes.json` and `run_worker_first`. Confirmed by: `_routes.json` deployed correctly (verified via `curl https://zeemish.io/_routes.json`), worker IS running on server-rendered routes (`/dashboard/` returns the new `Cache-Control: private, no-store` from middleware), but prerendered HTML continues to return Cloudflare's default `cache-control: public, max-age=0, must-revalidate` and zero security headers — including a brand-new random URL that resolves to the static `404.html`. We hit this as a hard wall and decided to ship — see DECISIONS 2026-04-18 "Ship as-is despite header gap". If a future Cloudflare release exposes a `routes.strategy = 'always-worker'` option, or if we add a Cloudflare Transform Rule, this gap closes.

## Launch (2026-04-18 — `v1.0.0`)
- Old `zeemish.io` worker (`zeemish-site`, breathing tools) custom-domain bindings removed
- New `zeemish-v2` worker bound to `zeemish.io` + `www.zeemish.io` via Cloudflare dashboard
- TLS cert auto-issued by Cloudflare
- DNS records left in place: `api.zeemish.io → zeemish-api` (old API, different subdomain), `listens.zeemish.io → zeemish-listens` R2 (old audio, different subdomain), Resend records (verified: resend._domainkey, send MX, send SPF)
- Three Cloudflare cache purges performed during cutover; future deploys may need a manual purge until the prerendered-HTML header gap is closed
- Final smoke check on zeemish.io: site renders, daily piece loads, audio plays, engagement tracks, magic-link login works (Resend domain verified), www → apex redirect works, robots.txt served, security headers on `/dashboard/` + `/api/*` + `/audio/*` confirmed
- Known launch-day gap: prerendered HTML lacks security headers (see Remaining minor items)

## Quality surfacing (2026-04-17)
Every published piece shows a tier in the metadata line: `Polished` (voice ≥ 85), `Solid` (70–84), `Rough` (< 70). Derived at render time from `voiceScore` in MDX frontmatter via `src/lib/audit-tier.ts`. No archive filtering — a published piece is a published piece. Admin surface (`/dashboard/admin/`) keeps raw `Voice: N/100` + `LOW QUALITY` labels for operator truth. See `docs/DECISIONS.md` 2026-04-17 "Soften quality surfacing" for the full rationale.

## Dev-mode testing
One-command reset: `ADMIN_SECRET=... ./scripts/reset-today.sh` (git rm
MDX + D1 clear across 5 tables + trigger fresh pipeline). See
`docs/RUNBOOK.md` → "Reset today" for what it does and the manual
fallback.

## Hard rule
**Published pieces are permanent. No agent writes to, revises, regenerates, or updates any published piece. All improvements feed forward into the learnings database and improve future pieces only.**

## Key rules
- TypeScript strict everywhere
- No new dependencies without justification
- Docs updated alongside code, same commit
- Voice contract: plain English, no jargon, no tribe words, short sentences
- When in doubt: "Does this help someone educate themselves for humble decisions?"
