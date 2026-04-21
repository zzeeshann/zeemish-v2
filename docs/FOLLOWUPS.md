# Zeemish v2 — Follow-ups Log

Append-only. One entry per known issue worth fixing later. Close via DECISIONS entry (note the FOLLOWUPS line that's now resolved). Never delete entries.

**Status markers** (start of each entry title): `[open]` — ready to pick up · `[observing]` — paused pending data, with an unblock note · `[resolved]` — shipped, commit SHA in a **Resolved:** line at the end of the entry · `[wontfix]` — deliberately scoped out, with a **Won't fix:** line explaining the call.

Format per entry:
- **Title** — one-line summary
- **Surfaced:** date + how it came up
- **Hypothesis:** what we think is wrong (may be incomplete)
- **Investigation hints:** where to start
- **Priority:** blocker / medium / low

---

## [resolved] 2026-04-21: Unblock multi-per-day flip — pre-run DELETEs + Learner input scoping

**Surfaced:** 2026-04-21 during the Phase 3 pipeline_log consumer audit (see DECISIONS 2026-04-21 "Multi-piece cadence — Phase 3 hourly cron + runtime gate"). Three sites in the agents worker are scoped by `WHERE run_id = ? .bind(today)` or equivalent and behave correctly at 1 piece/day but pool across pieces at multi-per-day. `interval_hours` cannot be flipped below 24 until these are resolved.

**Hypothesis / fix for each site:**

1. **[`agents/src/director.ts:109`](../agents/src/director.ts) — pre-run DELETE.**
   ```ts
   await this.env.DB.prepare('DELETE FROM pipeline_log WHERE run_id = ?').bind(today).run()
   ```
   Clears stale intra-day rows before a fresh run starts. At 1/day this correctly wipes an earlier failed attempt. At multi/day this wipes earlier completed runs' history when run 2+ starts. Fix options:
   - (a) Remove the DELETE entirely — pipeline_log accumulates forever, `scripts/reset-today.sh` remains the only wipe path.
   - (b) Scope by `created_at > (start-of-this-hour)` — delete only rows from "this hour's attempt".
   - (c) Scope by a new `piece_id` column filled from pre-allocated UUID — but that's a bigger schema + code change.
   - Lean option (a): simplest, log grows ~19-31 rows/day, 200-700/month at multi-per-day cadences. Negligible storage.

2. **[`agents/src/director.ts:783`](../agents/src/director.ts) — audio retry-fresh DELETE.**
   ```ts
   DELETE FROM pipeline_log WHERE run_id = ? AND step LIKE 'audio%'
   ```
   Retry-fresh semantic: wipe a day's audio attempt history. At multi/day this wipes audio logs across ALL that day's pieces, not just the one being retried. The retry target is already known per-piece by date — needs a piece-scoped filter. Blocks until either a piece_id column lands on pipeline_log or the retry path shifts to using `daily_piece_audio` as the truth (which is already piece-scoped post-Phase-1).

3. **[`agents/src/learner.ts:338`](../agents/src/learner.ts) — post-publish synthesis input.**
   ```ts
   SELECT step, status, data, created_at FROM pipeline_log WHERE run_id = ? .bind(date)
   ```
   Learner's `analysePiecePostPublish(date)` reads the pipeline log for the date to synthesise producer-origin learnings. At multi/day the SELECT returns ALL that day's pieces' steps, noisifying the synthesis with other pieces' data. Needs either per-piece scoping (piece_id column) or time-window scoping (only rows between the piece's run start and publish time, via a piece-specific timestamp range).

**Investigation hints:**
- Lean fix for (1): remove the DELETE, add nothing. Verify `reset-today.sh` still works as the manual wipe.
- For (2) and (3): adding `pipeline_log.piece_id` is the shared primitive. Requires Director to allocate piece_id at run start (not publish time) and pass through every `logStep` call. That's a Phase 3.5 / 4 concern.
- Test both before flipping: `UPDATE admin_settings SET value='4' WHERE key='interval_hours'`, let two runs complete same day, verify neither wiped the other.

**Priority:** Blocker for multi-per-day cadence. Not urgent otherwise — Phase 3 ships at `interval_hours=24` which exercises none of these paths.

**Resolved:** 2026-04-21 via three atomic commits in sequence:
- `ecedb87` — item #1 (pre-run `pipeline_log` DELETE removed). See DECISIONS "Remove pre-run pipeline_log DELETE."
- `900905d` — item #2 (audio retry-fresh + R2 key shape), plus a latent persistBeatRow NOT NULL bug found during scoping. See DECISIONS "Scope audio pipeline state per piece_id."
- `30ddbdd` — item #3 (Learner synthesis input scoped by time window). See DECISIONS "Scope Learner synthesis input by time window."

All three deploy clean through CI. Admin UI for interval flip (Phase 5) unblocked.

---

## [open] 2026-04-21: `daily_candidates.selected` never flipped on historical runs

**Surfaced:** 2026-04-21 during multi-piece cadence Phase 1 sizing audit. Prod `daily_candidates` has 250 rows across 5 dates (50/day, consistent with Scanner's `MAX_CANDIDATES_PER_DAY` cap) but **zero rows have `selected = 1`** — meaning no historical daily_candidates row maps back to the piece it became. Director's post-curation UPDATE at [director.ts:150-156](../agents/src/director.ts) is wrapped in `.run().catch(() => {})` which silently swallows any error.

**Hypothesis:** Three candidates:
1. `curatorResult.selectedCandidateId` is falsy in the returned shape, so the UPDATE is skipped by the truthy guard (`if (curatorResult.selectedCandidateId)`). Would be visible in the admin Director logs if the selected id was empty.
2. The id string shape mismatches between Scanner's write (`agents/src/scanner.ts:120` uses `crypto.randomUUID()`) and Curator's return. Curator's prompt may be returning a truncated or different-shape identifier.
3. The UPDATE runs but throws — `.catch(() => {})` swallows with no observer event, so it's invisible in the admin feed.

**Investigation hints:**
- Pull the most recent Curator output from admin dashboard (task-level data) and compare `selectedCandidateId` returned vs the IDs in `daily_candidates` for that date.
- Temporarily replace the `.catch(() => {})` with a `.catch(err => observer.logError(...))` to expose silent failures.
- Matters for Phase 3: with piece_id FKs in place, Director should set `daily_candidates.piece_id` and `selected=1` atomically for the winning candidate. Won't help if the current code path never fires the UPDATE.

**Priority:** Medium. Non-blocking for Phase 1 (piece_id column added nullable), but Phase 3's admin observability depends on being able to trace "which candidate became which piece." Investigate alongside or before Phase 3.

---

## [open] 2026-04-21: Drop `daily_piece_audio_backup_20260421` snapshot

**Surfaced:** 2026-04-21 alongside migration 0015 (multi-piece cadence Phase 1). The 32-row snapshot was created as a free-rollback safety net for the daily_piece_audio PK rebuild. Should be dropped on or after **2026-04-28** once Phase 3 has been live for a week and queries against the new `(piece_id, beat_name)` PK have been exercised by at least one real multi-per-day run.

**Hypothesis:** None — housekeeping, not a bug. Retention window gives us time to detect any row-shape regressions in the new table that manual verification missed. Small (32 rows) so cost of keeping it a few extra days is nothing.

**Investigation hints:**
- Before dropping: re-run the verification query from migration 0015 (`SELECT piece_id, COUNT(*) FROM daily_piece_audio GROUP BY piece_id ORDER BY piece_id`) and confirm the 5 piece_id groups match the snapshot's 8+6+6+6+6 distribution.
- Drop command: `DROP TABLE daily_piece_audio_backup_20260421;` via `wrangler d1 execute zeemish --remote --command`.
- Close with a DECISIONS entry on the drop date naming the SHA that dropped it.

**Priority:** Low. One-line operational task, no downstream dependency.

---

## [open] 2026-04-21: Drop `pipeline_log_backup_20260421` snapshot

**Surfaced:** 2026-04-21 alongside migration 0014's manual backfill UPDATEs (multi-piece cadence Phase 1). The 111-row snapshot was created before rewriting `pipeline_log.run_id` from `YYYY-MM-DD` strings to `daily_pieces.id` UUIDs. **Update 2026-04-21 (same day): the backfill was rolled back — the snapshot was consumed for that rollback.** See DECISIONS 2026-04-21 "Roll back `pipeline_log.run_id` backfill". The snapshot still holds the correct pre-rewrite values (which are also the current live values, since they were restored from it) — keeping it through 2026-04-28 gives a second-attempt audit window before Phase 3 re-approaches adding a `piece_id` column to this table.

**Hypothesis:** None — housekeeping.

**Investigation hints:**
- Before dropping: verify `SELECT run_id, COUNT(*) FROM pipeline_log GROUP BY run_id` matches the snapshot distribution (5 date-shape run_ids, 31/23/19/19/19 = 111 rows). If anything has drifted, don't drop.
- Drop command: `DROP TABLE pipeline_log_backup_20260421;` via `wrangler d1 execute zeemish --remote --command`.
- Close with a DECISIONS entry.

**Priority:** Low.

---

## [open] 2026-04-21: Drop `zita_messages_backup_20260421` snapshot

**Surfaced:** 2026-04-21 alongside migration 0013 Commit A. The 92-row snapshot was created as a free-rollback safety net while verifying the hand-mapped content-based backfill of `zita_messages.piece_date`. Should be dropped on or after **2026-04-28** once Phase 1 Commit B has been live for a week and the per-piece distribution (`SELECT piece_date, COUNT(*) FROM zita_messages GROUP BY piece_date`) has remained stable through at least one full daily cycle with new writes.

**Hypothesis:** None — this is housekeeping, not a bug. The retention window is to give us one admin Zita view session (Phase 3) against real data, during which a bad mapping would become visible in grouping before it ages out of easy correction.

**Investigation hints:**
- Before dropping: re-run the verification SELECT from migration 0013 Step 3 and compare against the expected distribution documented in the migration file.
- Drop command: `DROP TABLE zita_messages_backup_20260421;` via `wrangler d1 execute zeemish --remote --command`.
- Close with a DECISIONS entry on the drop date naming the SHA that dropped it.

**Priority:** Low. One-line operational task, no downstream dependency.

---

## [open] 2026-04-19: Publisher.publishAudio double-fires on Continue retry path

**Surfaced:** 2026-04-19 during retro audio generation for 2026-04-17. Admin "Continue" retry button (after a mid-pipeline silent stall at 4/8 beats) produced two `audio-publishing done` events in observer_events: 543651b (first, correct) and 02882fd (second, corrupted). The second commit deleted the audioBeats map and collapsed `qualityFlag: "low"\n---\n` onto a single line `qualityFlag: "low"---`.

**Hypothesis:** Two bugs stacked:
1. The Continue path in Director fires a full `runAudioPipeline` instead of resuming from the last-written beat. First producer call ran all 4 remaining chunks (total 8 beats, 4 chunks); second producer call ran 1 chunk as no-op (all R2 objects already present). Both calls still flowed through to Audio Auditor and Publisher.
2. Publisher's second `publishAudio` call should have no-op'd via the `updatedMdx === current.mdx` guard at [publisher.ts:103](../agents/src/publisher.ts:103). It did not. Instead, `spliceAudioBeats` produced `qualityFlag: "low"---` with no YAML terminator — a state that the regex logic on paper should not be able to generate. Needs a trace with actual inputs captured.

**Investigation hints:**
- Read `agents/src/publisher.ts:230-247` (spliceAudioBeats). Confirm both regexes behave as expected when called with (a) a file that already contains the full audioBeats block and (b) the same audioBeats map that was spliced last time. On paper the idempotent guard should fire.
- Check `getFileContent` — could it be returning stale/cached content from GitHub's API such that `current.mdx` doesn't reflect 543651b's post-state? If so the guard compares against wrong baseline.
- Check Director's Continue path (`runAudioPipelineScheduled` + retryAudio) for whether it dedupes already-completed beats before invoking Producer. If Producer runs at all on Continue-when-already-done, Publisher will also get re-invoked.

**Priority:** Medium. Manual recovery is a `git revert` (small, safe). Automated daily pipeline (2am UTC cron) does NOT exercise the Continue path, so tonight's run is unaffected. But any future manual retry risks corrupting the frontmatter again until this is fixed.

---

## [resolved] 2026-04-20: StructureEditor writes violation-shaped observations into learnings, not forward-going lessons

**Surfaced:** 2026-04-20 during Commit 2 of Build 2. The per-piece drawer's "What the system learned from this piece" section surfaces `learnings.observation` verbatim. For pieces written before P1.3/P1.4 (pre-2026-04-19), the only producer-origin writer was StructureEditor, whose rows read as raw audit violations ("Hook exceeds one screen - it's two full paragraphs with ~120 words") — the rule-break itself, not a forward-going pattern the Drafter should apply. Reads starkly in the drawer next to Learner/Drafter-reflect writes that phrase observations as applicable lessons.

**Hypothesis:** `agents/src/structure-editor.ts:47` passes `result.issues[i]` / `result.suggestions[i]` directly as the `observation` argument. The StructureEditor prompt produces audit-time diagnostic language, not forward-going lesson language. Two possible fixes:
1. Prompt-level retune: teach StructureEditor to rewrite each issue/suggestion into lesson-shaped prose before writing (e.g. "Keep the hook within one screen — two-paragraph hooks exceed the budget" instead of "Hook exceeds one screen…").
2. Drop StructureEditor's writeLearning calls entirely. `Learner.analysePiecePostPublish` (P1.3) already reads `audit_results` and synthesises producer-origin learnings from them post-publish, and it writes lesson-shaped prose. If the sets substantially overlap, StructureEditor's writes are redundant; dropping them removes the tone mismatch without a prompt retune.

**Investigation hints:**
- Diff the set of learnings Learner.analysePiecePostPublish writes against what StructureEditor writes for the same piece. If Learner already covers the ground, option 2 is cleaner.
- 2026-04-17's drawer shows 4 StructureEditor learnings, all violation-shaped. No Learner rows for that piece (predates P1.3). Good test case once the next pipeline run has fresh data from both writers on the same piece.

**Priority:** Low. The drawer faithfully surfaces what the system wrote — honesty beats prettiness. Retune when next retuning StructureEditor.

**Resolved:** 2026-04-20 — chose Option 2. Investigation compared SE's 4 rows for 2026-04-17 QVC vs Learner's 5 producer rows for 2026-04-20 Hormuz: Learner reads `audit_results` so SE's findings are *input* to the synthesis, SE emits duplicates within a single audit (2 of 4 QVC rows repeated "hook exceeds one screen"), and SE's rows teach Drafter rules the Structure Editor prompt already enforces. Dropped the writeLearning call + issues/suggestions loop from `agents/src/structure-editor.ts`; unused `writeLearning` import and `pieceDate` parameter on `review()` removed alongside; Director's call site updated. Historical rows stay in D1 and age out of Drafter's `getRecentLearnings(10)` as new Learner / Drafter-reflection writes accumulate. See DECISIONS 2026-04-20 "Drop StructureEditor's writeLearning calls".

---

## [resolved] 2026-04-20: D1 migration tracker out of sync on first `wrangler d1 migrations apply`

**Surfaced:** 2026-04-20 while applying migration 0012. First run of `wrangler d1 migrations apply zeemish --remote` tried to replay ALL 12 migrations from scratch — the `d1_migrations` tracker table was empty, so wrangler thought nothing had been applied. 0001–0008 (CREATE TABLE IF NOT EXISTS) succeeded idempotently, 0009 (`ALTER TABLE ADD COLUMN quality_flag`) failed with `duplicate column name` because the column already existed from an earlier ad-hoc apply. Recovered manually by `INSERT INTO d1_migrations (name) VALUES ('0009_*'), ('0010_*'), ('0011_*');` then re-running `migrations apply`, which then only applied 0012.

**Hypothesis:** All prior migrations were applied ad-hoc via `wrangler d1 execute --file migrations/NNNN_*.sql` (or via the Cloudflare dashboard's query console) rather than through `wrangler d1 migrations apply`. Those bypass paths run the SQL but don't write to `d1_migrations`. Migration 0012 was the first to go through `migrations apply`, so it triggered the full replay.

**Investigation hints:**
- Check git history / project chat logs for how 0001–0011 were originally applied. If ad-hoc, document the expected path going forward (always `migrations apply`) in `docs/RUNBOOK.md`.
- Consider adding a pre-migration hygiene check to a future deploy script: `SELECT COUNT(*) FROM d1_migrations` — if the count doesn't match the number of `.sql` files in `migrations/` minus any pending, warn before running `apply`.
- Alternatively, future migrations could start with a defensive comment block explaining how to verify the tracker state before applying, so the next person doesn't hit the same surprise.

**Priority:** Low. One-time recovery is done; the tracker is now in sync (12 rows, 0001–0012). But the next contributor who adds migration 0013 will avoid a same-shape failure only if they run `apply` on a DB whose tracker is already correct — which from now on it will be.

**Resolved:** 2026-04-20 — added a `### Migration tracker hygiene` subsection to [docs/RUNBOOK.md](RUNBOOK.md) covering (a) use `migrations apply`, not `execute --file` or `execute --command`, (b) the pre-flight `SELECT name FROM d1_migrations ORDER BY id` check, and (c) a link to the 2026-04-20 DECISIONS recovery steps rather than re-documenting the procedure. Existing `### Run migrations` block left intact as fresh-DB bootstrap documentation with a pointer from the new section.

---

## [open] 2026-04-20: D1 rejects correlated subqueries referencing the outer table in SELECT projection / UPDATE SET

**Surfaced:** 2026-04-20 running migration 0012's one-time backfill. The commented backfill in the migration file used the standard SQLite pattern for a nearest-timestamp join:
```sql
UPDATE learnings SET piece_date = (
  SELECT dp.date FROM daily_pieces dp WHERE dp.published_at IS NOT NULL
  ORDER BY ABS(dp.published_at - learnings.created_at) ASC LIMIT 1
) WHERE ...;
```
D1 rejected this with `no such column: learnings.created_at` — the inner subquery can't resolve the outer table. Same error on the SELECT preview variant using `l.created_at` alias. Rewrote the backfill as two date-equality UPDATEs (same outcome for this 13-row case, because every `created_at` landed on the same calendar day as its corresponding piece's `published_at`) and shipped. Migration file's comment block was updated post-hoc to match what actually ran.

**Hypothesis:** D1's query planner (libSQL fork) may not support the full SQLite correlated-subquery semantics that stock SQLite does. Plain SQLite 3.33+ supports this pattern natively. Needs a minimal reproducer filed at [workers-sdk#new-issue](https://github.com/cloudflare/workers-sdk/issues/new/choose) to confirm it's a D1 limitation vs. a wrangler shell-quoting quirk (reasonably confident it's the former based on the error text and two failed attempts with different aliasing).

**Investigation hints:**
- Build a minimal repro on a scratch D1: two tables, correlated subquery in SELECT projection, see if it fails on real D1 vs. local `miniflare`. If consistent, file the issue.
- For future UPDATEs that need nearest-timestamp joins, use either: (a) `UPDATE … FROM (subquery) WHERE learnings.id = mapping.id` if D1 supports the PostgreSQL-style syntax, (b) `UPDATE … SET col = (SELECT …)` where the inner subquery avoids touching the outer table, or (c) direct explicit updates per value cluster (what we did here).
- If this turns out to be a real D1 limitation, add a note to `docs/DECISIONS.md` so future migrations avoid the pattern upfront.

**Priority:** Low. Unblocks nothing today; the 0012 backfill shipped via the rewrite. Only matters again when a future migration wants a similar nearest-X backfill against existing rows.

---

## [resolved] 2026-04-20: `/api/dashboard/today.ts` appears to be uncalled dead code

**Surfaced:** 2026-04-20 during Build 1 of the dashboard Memory panel. Treated `today.ts` as the canonical convention example for the new `memory.ts` endpoint. Grep for `/api/dashboard/today` across the repo turns up matches only in docs (`docs/DECISIONS.md`, `docs/RUNBOOK.md`, `docs/handoff/ZEEMISH-DASHBOARD-SPEC.md`) — no TypeScript / Astro / HTML consumer. The public dashboard page queries D1 directly in its Astro frontmatter; admin uses its own client-side fetches against different endpoints.

**Hypothesis:** The endpoint is a leftover from an earlier dashboard design where the public view was client-rendered. After the 2026-04-18 dashboard refocus (server-rendered via frontmatter queries), it was never removed. Safe to delete — no runtime caller.

**Investigation hints:**
- Confirm by grepping the built worker bundle (`dist/_worker.js/`) and the admin dashboard's client-side JS for any late-binding reference.
- Check `src/pages/api/dashboard/*.ts` for other similar zombies (`analytics.ts`, `observer.ts`, `pipeline.ts`, `recent.ts`, `stats.ts`) — the same 2026-04-18 refocus may have orphaned others.
- Before deletion, decide whether to keep a minimal public JSON surface for future external consumers (a "public API" posture) or commit to server-rendered-only and remove all orphans.

**Priority:** Low. Dead code adds surface area but doesn't break anything. Fold into a future API-layer cleanup sweep.

**Resolved:** 2026-04-20 — endpoint file deleted; RUNBOOK verify step rewritten to use a `wrangler d1 execute` query; RUNBOOK's public API list pruned. `docs/DECISIONS.md:556` and `docs/handoff/ZEEMISH-DASHBOARD-SPEC.md:200` left intact (append-only convention + frozen handoff spec). Sibling endpoints (`analytics.ts`, `observer.ts`, `pipeline.ts`, `recent.ts`, `stats.ts`) not audited in this pass — logged as its own followup. See DECISIONS 2026-04-20 "Remove /api/dashboard/today".

---

## [open] 2026-04-19: Audio pipeline silent stall between alarm chunks on longer pieces

**Surfaced:** 2026-04-19 during retro audio for 2026-04-17. First retry attempt stopped at 4 of 8 beats. No `audio-failed` event in observer_events. No error logged. Alarm chain simply stopped firing. User clicked Continue and the pipeline resumed and finished cleanly.

**Hypothesis:** Even with alarm-based audio + keepAlive + Phase F chunking (2 beats per RPC, alarm-scheduled), the alarm chain can break silently between chunks on longer pieces — likely when a producer chunk + auditor + self-reschedule exceeds its wall budget but doesn't throw, so no failure event is emitted. Continue is the correct recovery path. But the lack of any signal means nobody knows the pipeline stopped until a reader notices missing audio.

**Investigation hints:**
- Add a watchdog alarm that fires N minutes after `runAudioPipelineScheduled` starts and checks whether `has_audio == 1`. If not and no `audio-*` events since the watchdog armed, emit `audio-stalled` into observer_events.
- When P1.3 ships (Learner reads producer-side signals), add a learning heuristic: `audio.beats < piece.beatCount AND zero audio-failed events within N hours of audio-started` → flag as silent stall pattern.
- Could also be the DO eviction cliff extending beyond what keepAlive's heartbeat covers under ElevenLabs latency variance — consider a longer heartbeat or doubling the keepAlive grace window.

**Priority:** Medium. Continue recovers cleanly, so no data is lost. But the silent failure mode is a class-of-bug concern: any future retry that silently stalls leaves the piece in partial state indefinitely.

---

## [wontfix] 2026-04-19: Title-case articles/conjunctions in humanize() or at the Drafter

**Surfaced:** 2026-04-19 during P2.1 retrofit. `humanize("what-is-a-chokepoint")` produces "What Is A Chokepoint" — the capital "A" is technically correct letter-by-letter but stylistically wrong for English title case, which lowercases articles, conjunctions, and short prepositions (under 4 letters) except when they're the first word.

**Hypothesis:** Two paths to fix, separate decision:
1. Teach `humanize()` in `src/lib/rehype-beats.ts` about English title-case rules — lowercase a short stop-word list (a, an, the, and, or, but, of, to, in, on, at, by, for, with) unless it's the first word.
2. Upgrade Drafter to write display-formatted `##` headings directly (e.g. `## What Is a Chokepoint`) so neither humanize() nor the `beatTitles` override is needed for new pieces.

Option 2 is the more durable fix — it aligns with the parallel durable fix already tracked in CLAUDE.md for the broader kebab→display lossiness (acronyms, punctuation). Option 1 is a smaller bandaid that still benefits retroactive pieces where Drafter output can't be changed.

**Investigation hints:**
- Option 1: add a stop-word list + first-word rule to `humanize()`. Kept out of today's scope because 2026-04-18 is the only current piece with the aesthetic issue and the user judged it non-corrective.
- Option 2: update `DRAFTER_PROMPT` in `agents/src/drafter-prompt.ts` to demand display-formatted `##` headings. Requires rehype-beats to keep handling non-kebab headings (it already does via `isKebabOnly` branch). Confirm downstream agents (AudioProducer, FactChecker) don't depend on kebab-case matching.

**Priority:** Low. Aesthetic, not corrective. Only affects pieces where Drafter's kebab slug uses multiple words including articles/conjunctions.

**Won't fix:** 2026-04-20 — scoped out as part of the broader P2.1 decision. The bigger punctuation-stripping bug the improvement plan named (QVC's / "Teaching 1:") was addressed by the `beatTitles` frontmatter override ([b204dbd](https://github.com/zzeeshann/zeemish-v2/commit/b204dbd)); this narrower title-case-of-articles remainder isn't worth the prompt retune or stopword list. If the Drafter is ever retuned for a different reason, option 2 (display-formatted `##` headings in the prompt) is the cheap way to pick it up as a side effect — until then, no action.

---

## [resolved] 2026-04-19: Surface producer-side learnings + self-reflection in the UI

**Surfaced:** 2026-04-19 as P1.3+P1.4 landed. The learning loop is now writing `source='producer'` and `source='self-reflection'` rows into `learnings` after every publish, and the Drafter reads them on the next run — but nothing in the reader-facing UI exposes what the system is learning about itself. The per-piece transparency drawer ("How this was made") already shows audit rounds and candidates; the public dashboard shows quality signals and recent runs. Neither currently shows the learnings that drove the *next* piece's prompt.

**Hypothesis:** Two additions, both nice-to-have, neither blocking:
1. **Per-piece drawer.** Add a "What the system learned from this piece" section to the existing transparency drawer (`src/pages/api/daily/[date]/made.ts` + whatever renders it). Pull rows from `learnings` where `evidence.date = <piece date>` (producer rows write this) or matched via any provenance link. Show observation + category + source badge. Deep-link to the piece that produced the learning if applicable.
2. **Public dashboard panel.** On `/dashboard/`, add a "How we're learning" panel next to "How it's holding up". Show last-7-days counts per source (`reader` / `producer` / `self-reflection` / `zita`), count of distinct observations, and maybe a rotating sample of the most recent 3 observations. Makes the self-improvement loop visible without clicking into a piece.

**Prerequisite:** Don't design this until P1.3+P1.4 have actually run and 3-5 real producer + self-reflection rows exist to design against. The prompt quality of early reflections will shape the best UI treatment — a row that reads "hook was thin on monetary policy" wants different framing than a row that reads "voice violations recurred in beat 4". Ship after 3-5 days of real learnings accumulate so the UI is designed to the actual shape of the data, not a guess.

**Investigation hints:**
- `src/pages/api/daily/[date]/made.ts` already aggregates per-piece state; extending it to include learnings is a small join. The evidence JSON carries `date` for producer + self-reflection writes so filtering by piece is straightforward.
- For the public dashboard panel: `GROUP BY source` + count + top-N observations by `created_at DESC`. No schema changes — `idx_learnings_source` is already in place.
- Be honest about empty states. Day 1-3 will have 0-10 rows total; the panel should show "Early days — N learnings so far" rather than empty/broken.

**Priority:** Low. Nice-to-have transparency; no system depends on it. Revisit when ~20+ learnings exist across sources so the UI has enough density to be worth designing.

**Resolved:** 2026-04-20 — shipped as Build 1 (dashboard Memory panel, [b96c8d6](https://github.com/zzeeshann/zeemish-v2/commit/b96c8d6)) and Build 2 (per-piece drawer section + `piece_date` migration/backfill, [a0a9b22](https://github.com/zzeeshann/zeemish-v2/commit/a0a9b22)). Both surfaces live on prod. See DECISIONS 2026-04-20 "Surfacing the learning loop".

---

## [open] 2026-04-19: Continue retry path may trigger full re-run instead of resuming

**Surfaced:** 2026-04-19. When combined with the Publisher double-fire bug above, the Continue button corrupted 2026-04-17's frontmatter. Observer events show producer ran twice (chunks: 4, then chunks: 1) — second run should have been a true no-op (skip producer entirely) but instead walked the full pipeline again.

**Hypothesis:** Director's `retryAudio` branch doesn't short-circuit when `has_audio == 1` or when all beats already exist in D1. It always calls `runAudioPipeline` which always calls Producer → Auditor → Publisher. Producer correctly skips generation when R2 objects are present (hence `chunks: 1` for the second call), but the downstream steps still fire.

**Investigation hints:**
- Read `agents/src/director.ts` `retryAudio` and `runAudioPipeline`. Add an early return if `piece.has_audio === 1 && all beat rows present in daily_piece_audio`.
- Alternative: make Publisher's idempotency guard strictly enforce the no-op (which it should already — see related FOLLOWUP above).
- Consider whether Continue vs Start-over should even share the same runAudioPipeline entry point. Start-over wipes and runs; Continue should resume from the last successful beat without re-triggering the publish step if nothing new was produced.

**Priority:** Medium. Paired with the Publisher double-fire, this is what corrupted 2026-04-17. Fixing either one prevents the corruption; fixing both defends in depth.

---

## [resolved] 2026-04-19: Book chapter 9 vs Structure Editor — "4–6 beats" vs "3–6 beats"

**Surfaced:** 2026-04-19 during pre-commit review of the book import. [book/09-the-thirteen-roles.md](../book/09-the-thirteen-roles.md) line 73 describes Structure Editor as checking "there are 4–6 beats." Actual code ([agents/src/structure-editor-prompt.ts:10](../agents/src/structure-editor-prompt.ts:10)) says "Has 3-6 beats (hook, 2-3 teaching, optional practice, close)."

**Hypothesis:** Spec-vs-implementation drift, not a book error per se. The project brief's daily-piece format (4–6 beats) matches the book's claim; the Structure Editor gate is one beat more permissive than the spec. Both "the code matches the brief" and "the brief matches the book" would resolve it; currently neither is true.

**Investigation hints:**
- If the spec is canonical: tighten `STRUCTURE_EDITOR_PROMPT` in `agents/src/structure-editor-prompt.ts` to gate on 4-6, and let the next pipeline run flag any existing 3-beat pieces (there aren't any in content/daily-pieces/ as of this writing — all three shipped pieces are 6–8 beats).
- If the code's looser gate is intentional: update the book + project brief to say "3–6 beats" and note why the floor is three, not four.
- Related to P2.2 (Watch beat enforcement) still queued from the 2026-04-19 plan — any Structure Editor update should likely land in the same pass as that one.

**Priority:** Low. Nobody's blocked; both documents-and-code read the same to ordinary readers. Worth fixing next time Structure Editor is touched for any reason.

**Resolved:** 2026-04-20 — book line aligned to code. Code is authoritative (the enforcer wins when book and code drift); tightening `STRUCTURE_EDITOR_PROMPT` to 4–6 would make legitimate 3-beat pieces suddenly fail structural audit — real consequence for a one-line doc fix. Project brief's "4–6 beats" claim left untouched (handoff material, frozen historical spec). Scope held to the single named line — no sibling chapters read, no consistency sweep.

---

## [resolved] 2026-04-19: Book chapter 10 reconstructed commit message, not actual

**Surfaced:** 2026-04-19 during pre-commit review of the book import. [book/10-a-day-in-the-life.md](../book/10-a-day-in-the-life.md) line 71 says Publisher committed the 2026-04-19 piece with the message `feat(daily): publish 2026-04-19 piece on airline fuel shocks`. Actual commit was `feat(daily): 2026-04-19 — Airline industry faces a shakeup as jet fuel hits hard`.

**Hypothesis:** Not a bug — narrative reconstruction for readability. The book chose a cleaner example commit message to illustrate the pattern, rather than the auto-generated headline-based one the Publisher actually produces.

**Investigation hints:**
- If/when the book gets machine-read against commit history (e.g. for an auto-generated "how this chapter lines up with git log" appendix), this line won't match. Either the book's example needs updating to the real string, or the machine-check needs a "narrative reconstruction" escape hatch.
- The Publisher's actual commit-message template lives in [agents/src/director.ts](../agents/src/director.ts) near the publishing step (grep `commitMsg`) — worth a cross-reference if the book ever tries to show the actual string.

**Priority:** Low. No bug, just a divergence between narrative prose and the literal git log that's worth being honest about if the book grows into a forensic record.

**Resolved:** 2026-04-20 — book line replaced with the literal commit subject verified against `git log` (four matching commits across the 2026-04-19 reset/retry cycle, all carrying the same `feat(daily): 2026-04-19 — Airline industry faces a shakeup as jet fuel hits hard` subject). Chose literal over narrative because the book is now a forensic record of what actually happened, not an illustrative guide. Scope held to the single named line — no sibling chapters read.

---

## [observing] 2026-04-19: Curator conceptual diversity (P1.2)

**Surfaced:** 2026-04-19 in the external system-improvement plan (`~/Downloads/ZEEMISH-IMPROVEMENT-PLAN-2026-04-19.md`, never committed to the repo). After the first three published pieces — QVC 2026-04-17, Hormuz 2026-04-18, airlines 2026-04-19 — all three landed on the same meta-concept: systems built for efficiency fail at their narrowest point, and incumbents can't adapt. Visible after three days. A reader arriving on day three and reading all three pieces would think Zeemish is the systems-fragility blog — not what the brief says it is. As of 2026-04-20 a fourth piece (Hormuz shipping) reinforces the pattern.

**Hypothesis:** Curator has no context about what recent pieces have already taught. Two paths, recommended in order:
1. Add an `underlying_concept` column to `daily_pieces`. Curator backfills it as it runs. At curate time, show Curator a summary of the last 5–7 pieces (title + `underlying_concept`) and instruct it to prefer candidates whose concept is distant from the recent set.
2. Derive the concept tag on the fly via a small Claude call at curate time — cheaper to ship, pays a Claude call every day.

Option 1 is what the external plan recommends. Not a hard constraint — Curator should still be allowed to pick a related concept if news genuinely demands it; prefer distance, all else equal, and record the reasoning.

**Investigation hints:**
- Check `daily_pieces` current state. As of 2026-04-20 there are four pieces; two are literally about Hormuz chokepoints; thematic overlap across all four.
- Before building this, observe whether the closed loop (P1.1 + P1.3 + P1.4, all shipped 2026-04-19) has shifted Curator's clustering on its own via the learnings feed the Drafter now reads. If the self-reflections written post-Hormuz mention topic sameness, and the next Curator run sees those via its brief or the Drafter's prompt, organic correction may remove the need for this entry entirely.
- If after a week of pieces (by 2026-04-26) clustering persists, ship option 1. See `docs/AGENTS.md` Curator section, `docs/SCHEMA.md` for the new column, `docs/DECISIONS.md` for a "Curator now enforces conceptual diversity" entry.

**Priority:** Low in blast radius, visibly important in editorial quality. No system depends on it.

**Unblock after:** one week of pieces (by 2026-04-26) — check if the closed loop has shifted Curator's clustering on its own, or if hard-coded concept-distance is still needed. If clustering has organically diversified, close as `[resolved]` with a DECISIONS entry naming the organic resolution. If clustering persists, promote to `[open]` and ship option 1.

---

## [open] 2026-04-20: Audit sibling dashboard API endpoints for the same dead-code pattern

**Surfaced:** 2026-04-20 during the `today.ts` removal (resolved this session). The resolution raised the question of whether `analytics.ts`, `observer.ts`, `pipeline.ts`, `recent.ts`, `stats.ts` were similarly orphaned by the 2026-04-18 dashboard refocus. Not investigated in today's commit to hold scope.

**Hypothesis:** Some of them are likely dead too. The 2026-04-18 refocus moved the public dashboard to server-rendered frontmatter queries, and the admin page has its own client-side fetches — the same conditions that left `today.ts` uncalled apply to its siblings.

**Investigation hints:**
- Same grep pattern used on `today.ts`: zero runtime callers across `src/`, `scripts/`, `agents/` means dead.
- Check the admin dashboard's client-side scripts (`dist/_worker.js/manifest_*.mjs` `inlinedScripts` array) for late-binding fetches before deleting any endpoint that might still be referenced from the admin UI.
- `/api/dashboard/observer` has a POST handler for acknowledging events — that one is almost certainly live. Don't delete it; verify first.
- For any endpoint that survives the audit, decide (like we did for `today.ts`) whether to keep it for future external consumers or remove. Err toward removing — speculative API surface rots.

**Priority:** Low. Dead code adds surface area but doesn't break anything.
