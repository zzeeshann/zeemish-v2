# Zeemish v2 — Decision Log

Append-only. Never edit old entries.

## 2026-04-21: P1.5 Learner skeleton — Zita-question synthesis scheduled 01:45 UTC day+1 (Phase 5)

**Context:** Phase 5 of the Zita improvement plan and P1.5 from the 2026-04-19 improvement plan. Schema plumbing for `source='zita'` has been in place since migration 0011 (2026-04-20), labels in the made-drawer and public dashboard have referenced it since 2026-04-20 commit [a0a9b22](https://github.com/zzeeshann/zeemish-v2/commit/a0a9b22), but no code path wrote rows with that source. CLAUDE.md has flagged it as "blocked on reader + Zita traffic" — but waiting for real data to arrive before building the synthesis means we'd be writing the synthesis on the day the first real signal appeared, under time pressure. Better to build the skeleton now, guarded so it no-ops cleanly at current traffic levels, and let it start producing rows organically as reader traffic grows.

**Decision:** Mirror the three-source pattern exactly.

1. **New prompt** `LEARNER_ZITA_PROMPT` in [`agents/src/learner-prompt.ts`](../agents/src/learner-prompt.ts). Shape identical to `LEARNER_POST_PUBLISH_PROMPT`: 0–10 learnings, strict JSON, category is voice/structure/fact/engagement, no hedging. Prompt posture is different — it names the Socratic-chat context, asks for pattern-recurrence (not per-conversation summaries), and its example learnings are all recognition-of-misreading / beyond-the-piece-questions / engagement-pattern shaped (not audit-violation shaped).

2. **New Learner method** `analyseZitaPatternsDaily(date)` in [`agents/src/learner.ts`](../agents/src/learner.ts). Pulls `zita_messages WHERE piece_date = ? ORDER BY created_at ASC`, counts user messages, **returns `{ skipped: true, userMsgCount, durationMs }` without firing a Claude call when `userMsgCount < ZITA_SYNTHESIS_MIN_USER_MESSAGES` (5).** Above threshold: pulls the piece's headline + underlying_subject for context, groups messages by reader, builds a compact "### Conversation N (K turns)\\nReader: …\\nZita: …" block per reader, sends to Claude Sonnet 4.5 (max_tokens: 2000, same model as the other two synthesis calls), parses JSON with the existing `extractJson` helper, caps writes at `ZITA_LEARNINGS_WRITE_CAP` (10), writes via `writeLearning(db, category, observation, { date, phase: 'zita-synthesis', readerCount, userMsgCount, totalMsgCount }, 60, 'zita', date)`. Returns `ZitaSynthesisResult { date, skipped, userMsgCount, written, overflowCount, considered, tokensIn, tokensOut, durationMs }` — the last three are for cost metering.

3. **Director scheduling** in [`agents/src/director.ts`](../agents/src/director.ts) `triggerDailyPiece`, after `publishing done`. Unlike producer + self-reflection (which fire at publish+1s because they analyse signals complete at publish), Zita synthesis needs a full day of reader traffic. Schedule for **01:45 UTC on day+1** — just before the 02:00 UTC cron kicks the next run, so we analyse a complete window without interfering. Computed via `Date.UTC(y, m, d+1, 1, 45)` and `Math.max(60, Math.floor(...))`. For a publish at ~02:07 UTC, delay is ~23.63h / 85080s.

4. **New alarm handler** `analyseZitaPatternsScheduled({date, title})` mirrors `analyseProducerSignalsScheduled` shape exactly. Calls `learner.analyseZitaPatternsDaily(date)`, logs via `observer.logZitaSynthesisMetered(...)` (handles both skipped and success paths — the skip log is informational so "is the P1.5 schedule firing?" has a visible answer even when traffic is below threshold), logs via `observer.logZitaSynthesisFailure(...)` on throw. Non-retriable.

5. **Observer methods** in [`agents/src/observer.ts`](../agents/src/observer.ts):
   - `logZitaSynthesisMetered(date, title, metrics)` — branches on `metrics.skipped`. Skipped: `severity: 'info'`, "Zita synthesis skipped: title" / "only N reader messages, threshold 5, no Claude call fired". Success: "Zita synthesis: title" / tokens-in/out + latency + overflow. Both shapes match the existing `logReflectionMetered` posture.
   - `logZitaSynthesisFailure(date, title, reason)` — `severity: 'warn'`, same shape as `logLearnerFailure` and `logReflectionFailure`.

6. **No Drafter changes.** The runtime `getRecentLearnings(db, 10)` in [`agents/src/shared/learnings.ts`](../agents/src/shared/learnings.ts) is source-agnostic — `source='zita'` rows auto-flow into the next Drafter prompt the moment they're written. Zero work needed on the reader side of the loop.

**Why the guard at 5, not 0.** Below 5 user messages, Claude would produce learnings from 1–4 chat turns, which is noise rather than pattern. A pattern by definition requires repetition or a striking exchange; single chats don't qualify. At current traffic (3 users across 5 pieces as of 2026-04-21), most days will skip. That's the right behaviour — we'd rather have `source='zita'` rows appear organically when real signal exists than produce a stream of low-confidence rows that pollute the Drafter's feed. The skip is metered so we know the schedule is running; the count is a leading indicator for when the feature "activates" naturally.

**Why not schedule at publish+1h.** That's what producer + self-reflection do, because they analyse signals complete at publish. Zita synthesis needs reader traffic that takes a day. At publish+1h the ≥5 guard would skip every run (readers haven't arrived yet), and we'd never know if the schedule was firing vs the guard was the problem. Scheduling at 01:45 UTC day+1 means the guard becomes a real threshold instead of a false one.

**Non-retriable by design.** Same reasoning as `analysePiecePostPublish` and `reflect`: the piece is live, one missed synthesis isn't catastrophic, and retry logic turns into mystery failures later. If a run fails, `logZitaSynthesisFailure` warns in the admin feed and the loop moves on.

**Verified locally:** typecheck passes with zero new errors (33 pre-existing SubAgent typing errors before AND after the change). Schedule math verified via a simulated 02:07 UTC publish: target = 01:45 UTC next day, delay = 85080s = 23.63h. Full runtime test (triggering the alarm) would require waiting 24 hours or invoking the scheduled method directly via the agents worker; deferred to Zishan's call on whether to manually trigger against the 2026-04-20 piece's 26 messages (17 user messages, above threshold) to see a real Claude synthesis run.

**Non-goals:**
- No Drafter retuning to weight `source='zita'` differently. They flow into the same 10-row feed as the other sources, equal standing.
- No per-conversation analysis or drill-down UI — the admin Zita view (Phase 3) already provides the raw data; this synthesis is about patterns, not individual sessions.
- No real-time / per-message triggering. One synthesis per piece per day is enough; the schedule boundary is deliberate.
- No cost alerting / escalation on token spike. Metered info event is sufficient until we see actual drift.

**References:** [agents/src/learner-prompt.ts](../agents/src/learner-prompt.ts) (new `LEARNER_ZITA_PROMPT`), [agents/src/learner.ts](../agents/src/learner.ts) (new `analyseZitaPatternsDaily`), [agents/src/director.ts](../agents/src/director.ts) (schedule + alarm handler), [agents/src/observer.ts](../agents/src/observer.ts) (new `logZitaSynthesisMetered` + `logZitaSynthesisFailure`).

---

## 2026-04-21: Zita safety smallest-viable pass (Phase 4)

**Context:** Phase 4 of the Zita improvement plan. With piece-scoping (Phase 1), a history cap (Phase 2), and admin visibility (Phase 3) in place, three operational blind spots remained:
1. Claude API errors were silently swallowed — the reader saw a generic 503, ops never learned which piece / user / upstream status triggered it.
2. Rate-limit 429s were silently returned — no way to see abuse patterns or runaway clients in the admin feed.
3. The persisted assistant `content` had no ceiling. `max_tokens: 300` at the API level is the only bound, but a misconfigured model / cache weirdness could theoretically return longer output, and a single row could dominate future context loads.

**Decision:** smallest-viable safety pass. No prompt-injection hardening (that's gated on Phase 6's design doc); just the three observable gaps.

1. **`zita_claude_error` observer_event** fired when `!claudeResponse.ok`. Severity `warn` (not `escalation` — Claude is occasionally flaky). Context captures `{ type, httpStatus, userId, pieceDate, upstreamBody }` — the upstream body is capped at 500 chars via `claudeResponse.text().slice(0, 500)` to stop large error payloads from bloating `observer_events`. Reader still sees the generic "Zita is temporarily unavailable" — the event is for ops, not for disclosure.

2. **`zita_rate_limited` observer_event** fired on the 429 path. Severity `warn`. Context `{ type, userId, limit: 20, windowSeconds: 900 }`. Helpful for catching runaway clients or abuse patterns — the current rate limit (20 msg / 15 min) is aggressive, so one spam-loop would produce a clear trail.

3. **`zita_handler_error` observer_event** on the outer `catch` for unhandled exceptions. Same severity/shape posture.

4. **`capStoredContent()` helper** — if `content.length > ZITA_STORED_CONTENT_CAP` (4000), truncate and append `\n\n[…truncated]`. Applied to both user message and assistant reply INSERTs. 4000 is generous relative to the ≈1200-char typical output from `max_tokens: 300` — it's a ceiling, not a target. The truncation marker is recognisable if it shows up in a transcript.

**Why not a new writer helper.** `logObserverEvent` from Phase 2 already encapsulates the INSERT + swallow-errors shape. Four call sites now use it: truncation (Phase 2), rate limit, Claude error, handler error.

**Verified end-to-end** via preview: fired 22 rapid POSTs at `/api/zita/chat`. First 20 returned 503 (local Claude key is invalid → 401 → zita_claude_error row each). Next 2 returned 429 → zita_rate_limited rows. Every row had correctly-shaped title, body, and JSON context. Upstream body (authentication_error / invalid x-api-key / request_id) was captured verbatim up to the 500-char cap. Test rows cleaned before commit.

**Non-goals (all deferred to Phase 6 design doc):**
- Prompt-injection detection or guardrails on reader input.
- PII redaction on stored content.
- Per-event alerting (escalation escalation vs. silent warn). Current posture: log everything, let the admin feed show operators what's happening.
- Encryption at rest for `zita_messages` content.

**References:** [src/pages/api/zita/chat.ts](../src/pages/api/zita/chat.ts) (all four observer call sites + capStoredContent), [src/lib/observer-events.ts](../src/lib/observer-events.ts) (shared writer).

---

## 2026-04-21: Admin Zita view (Phase 3)

**Context:** Phase 3 of the Zita improvement plan. With Phase 1 scoping `zita_messages` by piece_date and Phase 2 logging truncation events, the next gap was operator visibility: no dashboard surface for reading what readers actually ask Zita. Without this, validating P1.5 (Phase 5's Learner synthesis) is impossible — you can't evaluate whether the synthesised patterns are accurate against reader questions you can't see.

**Decision:** Two surfaces, both admin-gated, matching the existing design system (eyebrow + title header, stat grid, rounded-xl cards with `border-zee-border`, `text-xs font-semibold uppercase tracking-widest text-zee-muted` section headers):

1. **`/dashboard/admin/zita/`** — standalone view. Stats grid (conversations / messages / unique readers / truncation count, all 30-day window). Conversation list grouped by `(user_id, piece_date)`, 100 most recent, each as a `<details>` with collapsed summary (message count, short user id, relative time, piece headline) + expanded transcript (reader/zita labelled messages). Deep-link to per-piece admin route when piece_date is set. Piece headlines joined from `daily_pieces` via a single `WHERE date IN (?, ?, …)` query.

2. **Per-piece deep-dive** (`/dashboard/admin/piece/[date]/`) — new "Questions from readers" section, inserted between Audio and Observer events. Shows distinct readers who chatted about this piece, sorted by most-recent message. Each reader's full transcript expandable via `<details>`. Header includes an "All Zita activity →" link to the standalone view for cross-piece context.

3. **Main admin page entry point** (`/dashboard/admin/`) — new "Zita activity →" link in the top-right corner alongside the existing "← Public dashboard" link.

**Defensive refactor caught during verification:** the per-piece page originally ran audio + zita queries inside the same try/catch. When local D1 was missing `daily_piece_audio` (migration 0010 tracker drift), the audio query threw, the shared catch swallowed it, and the Zita section silently disappeared. Split Zita into its own `try { ... } catch {}` so a failure in an unrelated section can't hide the Questions block. Same defensive shape as the site-worker `logObserverEvent` helper — observability writes never break the handler that's calling them.

**No new data flows.** All three surfaces read from existing tables (`zita_messages`, `daily_pieces`, `observer_events`) — no schema changes, no writer changes. The piece title join uses a fresh `daily_pieces` lookup rather than denormalising into `zita_messages`; 100 conversations × 5 distinct piece_dates in the 30-day window means the `IN (…)` lookup is cheap.

**Verified end-to-end** in local preview with a minimal seeded conversation (4 messages from `demo-reader-1` about the 2026-04-20 piece): stats rendered correctly (1 conv / 4 msgs / 1 reader / 0 truncations), conversation card showed message count + short user id + piece headline, transcript expanded cleanly with READER / ZITA labels and alternating styling. Per-piece deep-dive showed the matching "Questions from readers" block. Test data cleaned before commit.

**Non-goals:**
- No pagination beyond the 100-conversation cap. If the dataset grows, revisit then — not now.
- No filtering UI (search, date-range, reader-id lookup). The deep-links + piece deep-dive give piece-scoped views already; freeform search is Phase 6 territory.
- No PII redaction of content. Messages display verbatim for honest operator review. When the design doc in Phase 6 decides on PII posture, apply it here.
- No real-time refresh. A reload picks up new conversations; the admin surface isn't a live monitoring tool.

**References:** [src/pages/dashboard/admin/zita.astro](../src/pages/dashboard/admin/zita.astro), [src/pages/dashboard/admin/piece/[date].astro](../src/pages/dashboard/admin/piece/[date].astro) ("Questions from readers" section + independent zita try/catch), [src/pages/dashboard/admin.astro](../src/pages/dashboard/admin.astro) (top-right link).

---

## 2026-04-21: Cap Zita history load at 40 + log truncation to observer_events

**Context:** Phase 2 of the Zita improvement plan. Even with Phase 1's piece-scoped history (DECISIONS 2026-04-21 "Scope zita_messages by piece_date"), a single reader's long session on one piece still grows unbounded. In the 92-row audit on 2026-04-21, one user had 44 messages scoped to the 2026-04-21 tariffs piece alone; at current rate, a committed reader could reach 100+ turns on a single day's piece inside a week. Every new message would reload the full history into the Claude system prompt, growing input tokens linearly per turn.

**Decision:** Cap the history load at **40 rows = 20 turns** (user + assistant pairs). Change:

- `SELECT role, content FROM zita_messages WHERE … ORDER BY created_at DESC LIMIT 40` — newest first for correct truncation semantics. Reverse in-memory when building the Claude `messages` array to preserve chronological order.
- Parallel `SELECT COUNT(*)` on the same scope, batched together via `db.batch` so it's one D1 round trip.
- When `totalCount > 40`, fire a `logObserverEvent(db, { severity: 'info', title: 'Zita history truncated at 40 for <pieceDate>', body: 'Clipped N older messages…', context: { type: 'zita_history_truncated', userId, pieceDate, courseSlug, lessonNumber, totalCount, loadedCount: 40, clippedCount: totalCount - 40 } })`. Severity is `info` because this is expected long-session behaviour, not a failure — it surfaces the cap in the admin Observer feed instead of leaving it silent.
- `ZITA_HISTORY_LIMIT` constant at the top of `chat.ts` so a future tweak is a single-line edit.

**Data stays in D1.** The cap is purely about what we send to Claude per turn; `zita_messages` still receives every new INSERT, and the admin Zita view (Phase 3) will read the full history independent of the cap.

**Why 40.** A Socratic exchange is typically short — Zita's prompt enforces 2-4 sentence replies, and reader messages trend short too. 40 rows covers ~20 back-and-forths, which is a long session. Beyond that, older context adds token cost without changing Zita's posture — she's already in-character from the system prompt, not from the conversation. The clippedCount in the observer_event gives us a real signal if 40 turns out to be too aggressive for any reader's flow.

**New helper: `src/lib/observer-events.ts`** — site-worker → `observer_events` writer that mirrors the shape used by `agents/src/observer.ts:writeEvent` (id, severity, title, body, JSON-stringified context, created_at). Fire-and-forget with `try/catch {}` so observer logging never breaks the handler. This is the first site-origin writer of observer_events; Phase 4 will add `zita_claude_error` and `zita_rate_limited` events through the same helper.

**Verified end-to-end locally:** seeded 45 dummy rows for `test-cap-user` on 2026-04-20. `COUNT(*)` returned 45, `LIMIT 40` returned exactly 40 rows. Synthetic `observer_events` INSERT with the same shape the handler produces queried back cleanly with all fields populated. Test data cleaned up before commit.

**Non-goals:**
- No summarisation of clipped messages — they're gone from Claude's view, not condensed into a "previously…" blurb. Add that in Phase 6's deep-Zita design doc if we decide cross-turn memory matters.
- No server-side cursor / pagination UI. The cap is invisible to readers; only visible to admins via observer_events.
- No reduction of the 40 for non-daily courses — lessons-course path keeps the same cap because 20 turns is a reasonable default regardless.

**References:** [src/pages/api/zita/chat.ts](../src/pages/api/zita/chat.ts), [src/lib/observer-events.ts](../src/lib/observer-events.ts), [migrations/0002_observer_events.sql](../migrations/0002_observer_events.sql) (table shape).

---

## 2026-04-21: Scope `zita_messages` by piece_date (migration 0013 Commit A)

**Context:** Direct query of `zita_messages` on 2026-04-21 returned 92 rows from 3 users across 5 different daily pieces, all keyed under the same `(course_slug='daily', lesson_number=0)` — because [`LessonLayout.astro:74-78`](../src/layouts/LessonLayout.astro) hardcodes those attributes on `<zita-chat>` for every piece. One reader (User fb906615) had 80 messages spanning QVC → Hormuz → tariffs, all of which loaded into every new Claude call as conversation history. Zita coped verbally ("we've been wandering through the whole lesson") but couldn't prevent cross-piece history contamination or cost creep, and had no way to tell the reader which piece they were on.

**Decision:** Add `zita_messages.piece_date TEXT` (nullable at schema level) + composite index `idx_zita_piece(user_id, piece_date)`. Matches the shape of the `learnings.piece_date` column added in migration 0012 — both are hand-backfilled with a one-time commented UPDATE block inside the migration file, both nullable at schema level so the ALTER applies non-destructively, both enforced non-null at the application layer going forward. This is Commit A of a two-commit Phase 1: schema-only now, code changes (LessonLayout pass-through, request-body field, scoped history SELECT, scoped INSERTs, system-prompt line naming the piece) in Commit B after the migration is applied and verified.

**Two-commit split because:** the 0012 rollout (resolved FOLLOWUPS "D1 migration tracker out of sync") burned an evening recovering from `d1_migrations` drift when code + schema landed together. Separating the commits means: (a) schema change lands, is applied, column existence is verified with a `PRAGMA table_info` query, *then* code starts reading/writing the new column. No "code deployed but column missing" or "column added but code still writing NULL" race window.

**Backfill by content, not by calendar date.** Migration 0012 used `date(created_at/1000, 'unixepoch') = 'YYYY-MM-DD'` to match learnings rows to pieces — works because Learner + Drafter-reflection run within seconds of publish, same calendar day. For Zita messages that pattern fails: readers arrive on their own cadence, and User 5bcf333c's entire conversation about airline jet fuel (2026-04-19 piece) happened on 2026-04-20. Every row was hand-mapped by reading content against the five pieces' headlines. User fb906615 split into three segments by created_at boundaries chosen to fall inside the 55-hour and 21-hour silent gaps between their QVC / Hormuz / tariffs reading sessions. Full mapping, including per-user evidence, lives in [`migrations/0013_zita_messages_piece_date.sql`](../migrations/0013_zita_messages_piece_date.sql) as commented UPDATEs.

**Snapshot before UPDATE.** `CREATE TABLE zita_messages_backup_20260421 AS SELECT * FROM zita_messages;` runs as Step 0 of the backfill — 92-row free rollback, one line, zero downside. Queued for drop on or after 2026-04-28 in FOLLOWUPS once Commit B has been live for a week. Rollback path (if Step 3 distribution is wrong): `DELETE FROM zita_messages; INSERT INTO zita_messages SELECT * FROM zita_messages_backup_20260421;` then revise the mapping.

**Non-goals:**
- No change to the Zita system prompt in this commit. Prompt change ("You are discussing the piece titled …, published …") lives in Commit B, because it reads `piece_date` at request time.
- No deletion of legacy lesson-course conversations. `course_slug='lessons'` rows (if any future path re-enables them) will continue to work with `piece_date=NULL`.
- No backfill of `zita_messages_backup_*` snapshots retroactively for past migrations — this is a one-off safety net for the hand-mapped backfill.

**References:** [migrations/0013_zita_messages_piece_date.sql](../migrations/0013_zita_messages_piece_date.sql), [docs/SCHEMA.md](SCHEMA.md) (zita_messages section + migrations summary), [docs/FOLLOWUPS.md](FOLLOWUPS.md) ("[open] 2026-04-21: Drop `zita_messages_backup_20260421` snapshot"). Plan file: `~/.claude/plans/could-please-do-a-harmonic-waffle.md`.

---

## 2026-04-20: Drop StructureEditor's writeLearning calls

**Context:** FOLLOWUPS 2026-04-20 "StructureEditor writes violation-shaped observations into learnings, not forward-going lessons" flagged that the 2026-04-17 per-piece drawer surfaces raw audit diagnostics ("Hook exceeds one screen - it's two full paragraphs with ~120 words") next to lesson-shaped prose from Learner and Drafter-reflection. The FOLLOWUPS framed two options — (1) retune SE's prompt to emit lesson-shaped prose, or (2) drop SE's writeLearning calls entirely since Learner.analysePiecePostPublish covers the ground from the same source data.

**Investigation (2026-04-20):** Pulled the 4 StructureEditor rows written for 2026-04-17 QVC and the 5 Learner producer rows written for 2026-04-20 Hormuz and compared qualitatively. Three findings:

1. **Learner reads `audit_results` in its post-publish synthesis.** SE's findings are *input* to Learner's generalisation pass — nothing SE sees is invisible to Learner.
2. **SE emits duplicates within a single audit.** 2 of 4 QVC rows said "hook exceeds one screen" — the auditor legitimately flags the same rule break multiple ways, but every flag becomes a separate learnings row. Learner post-publish compresses these into one generalised lesson.
3. **SE's rows teach Drafter rules Drafter already has.** "Lesson has 7 beats instead of the required 3-6 beats" is information the Structure Editor prompt already enforces as a gate. Surfacing it to Drafter via `getRecentLearnings(10)` adds zero signal over the existing voice contract + structure prompt.

Every piece published (including `qualityFlag='low'` ones under the "daily cadence > perfect catalogue" rule) reaches `analysePiecePostPublish`, so the hypothetical "SE catches things for pieces that don't publish" does not translate to any unique coverage in practice.

**Decision:** Option 2. Delete SE's writeLearning calls and the `result.issues`/`result.suggestions` loop. Keep `review()`'s return shape intact — Director and Integrator still use `{passed, issues, suggestions}` to gate publication and drive revision. The `pieceDate` parameter on `review()` (added for the writes on 2026-04-20 via the "Surfacing the learning loop" entry) is removed alongside, since it existed only for the writes we're removing. Director's single call site updated accordingly.

**Historical rows stay in D1.** The 4 QVC rows and any other SE writes on earlier pieces remain in the learnings table as honest historical record. Drafter's `getRecentLearnings(10)` reads newest-first, so they age out naturally as Learner + Drafter-reflection writes accumulate; no cleanup needed.

**Why not Option 1 (prompt retune):**
- Double-duty prompt (audit + lesson-writer) increases cognitive load per call and adds tokens.
- Models synthesise lessons better from the full quality record (post-publish) than from per-violation judgements (audit-time).
- Doesn't solve the within-audit duplicate problem.
- Still wouldn't add signal beyond what Learner already produces.

**What didn't change:**
- SE's audit behaviour — gate scores, issues, suggestions, return shape, Director's consumption. No behavioural change to the pipeline's publication decisions.
- The Structure Editor prompt (`structure-editor-prompt.ts`) — untouched.
- Learner, Drafter-reflect, or any other writer — untouched.
- `writeLearning` helper — still used by Learner.analysePiecePostPublish, Drafter.reflect, and the reader-side Learner path.

**FOLLOWUPS resolved:** 2026-04-20 "StructureEditor writes violation-shaped observations into learnings, not forward-going lessons".

**References:** [agents/src/structure-editor.ts](../agents/src/structure-editor.ts), [agents/src/director.ts](../agents/src/director.ts) (line 181 call site), [docs/AGENTS.md](AGENTS.md) (section 7).

---

## 2026-04-20: Remove /api/dashboard/today — unused since 2026-04-17

**Context:** FOLLOWUPS 2026-04-20 flagged `src/pages/api/dashboard/today.ts` as likely dead. Verification confirmed: zero runtime callers across `src/`, `scripts/`, `agents/`. The public dashboard (`src/pages/dashboard/index.astro`) queries D1 directly in Astro frontmatter; the admin dashboard uses its own client-side fetches against different endpoints; the built worker's `inlinedScripts` contain no reference. The endpoint's last commit (`b84de9e`, 2026-04-17) was itself a comment-only update whose message already named the consumer as gone: *"That path went away when the reader-facing tier moved to voiceScore + src/lib/audit-tier.ts."*

**Decision:** Delete the endpoint. Update RUNBOOK's verify step (line 154) to use a `wrangler d1 execute` query instead of `curl /api/dashboard/today`. Remove the line from RUNBOOK's public API list (line 217). Leave `docs/handoff/ZEEMISH-DASHBOARD-SPEC.md:200` intact — handoff is frozen historical spec. Leave `docs/DECISIONS.md:556` intact — append-only convention; this new entry records the removal without editing the original 2026-04-17 "Soften quality surfacing" reference.

**Chose deletion over keeping for future external consumers.** The FOLLOWUPS investigation hints named the choice explicitly. Speculative API surface rots — three days of zero callers is already long enough that any hypothetical future consumer would be reading stale shape. Better to remove and rebuild against actual demand than maintain a ghost endpoint whose response contract drifts from whatever the dashboard now considers canonical.

**Scope held.** Sibling endpoints (`analytics.ts`, `observer.ts`, `pipeline.ts`, `recent.ts`, `stats.ts`) were not audited in this commit — logged as its own FOLLOWUP instead so the sweep can happen deliberately rather than piggybacking on a single-endpoint removal.

**FOLLOWUPS resolved:** 2026-04-20 "/api/dashboard/today.ts appears to be uncalled dead code".
**FOLLOWUPS added:** 2026-04-20 "Audit sibling dashboard API endpoints for the same dead-code pattern".

**References:** [docs/FOLLOWUPS.md](FOLLOWUPS.md), [docs/RUNBOOK.md](RUNBOOK.md).

---

## 2026-04-20: Surfacing the learning loop (Builds 1 + 2)

**Context:** P1.3 + P1.4 closed the write side of the self-improvement loop on 2026-04-19 — Learner and Drafter now write post-publish learnings. Nothing in the reader-facing UI exposed what was being learned. FOLLOWUPS 2026-04-19 "Surface producer-side learnings + self-reflection in the UI" queued the work pending enough real data to design against. The first real cron run at 2am UTC 2026-04-20 wrote 9 rows on the Hormuz piece (5 producer + 4 self-reflection) — enough density to ship.

**Decision:** Two surfaces, one commit each, sequenced:
- **Build 1 ([b96c8d6](https://github.com/zzeeshann/zeemish-v2/commit/b96c8d6)) — dashboard "What we've learned so far" panel** on `/dashboard/`. Three counts (producer / self-reflection / total) plus the most recent observation as a blockquote with source attribution. New endpoint `/api/dashboard/memory`. Inserted between "How it's holding up" and "The agent team". Quiet visual register matching the rest of the dashboard — no animations, no toggles, no charts.
- **Build 2 ([a0a9b22](https://github.com/zzeeshann/zeemish-v2/commit/a0a9b22)) — per-piece "What the system learned from this piece" section** in the How-this-was-made drawer on `/daily/[date]/`. Grouped by source in fixed order (Drafter self-reflection → Learner producer-side pattern → reader → zita). Hide-when-empty — absent entirely when the piece has no learnings, not just visually hidden. Required migration 0012 adding `learnings.piece_date TEXT`, plus a one-time backfill of 13 pre-migration rows (4 → 2026-04-17 QVC, 9 → 2026-04-20 Hormuz).

Source labels are shared across both surfaces — "Learner, producer-side pattern", "Drafter self-reflection", "Reader signal", "Zita question pattern" — so the vocabulary is stable across dashboard cross-piece view and per-piece drawer view.

**Operational notes:**
- `writeLearning` widened to require `pieceDate` going forward; same defensive non-null pattern as `source` from migration 0011. Both checks route through a shared `logMissingField` helper (renamed from `logSourceRegression` to cover both field warnings).
- Four writer call sites updated: `Learner.analysePiecePostPublish`, `Drafter.reflect`, `StructureEditor.review` (date threaded via one-line Director update since `review()` is stateless over mdx), `Learner.analyseAndLearn` (reader path — pieceDate derived from the daily-piece slug's YYYY-MM-DD prefix with a regex guard; malformed slug skips the write rather than inventing a date).
- Migration 0012's originally-prescribed correlated-subquery backfill (`SET piece_date = (SELECT … ORDER BY ABS(dp.published_at - learnings.created_at) …)`) failed on D1 with "no such column". Rewrote as two date-equality UPDATEs, one per affected piece_date. Same outcome for this data (every learning's `created_at` landed on the same calendar day as its piece's `published_at`) but not the same SQL. Migration file's comment block preserves both shapes for the historical record. See FOLLOWUPS 2026-04-20 "D1 correlated-subquery limitation".
- Migration apply hit a second, unrelated snag: `d1_migrations` was empty (prior migrations applied ad-hoc, bypassing the tracker), so wrangler tried to replay all 12 migrations and failed on 0009's `duplicate column name`. Recovered by manually inserting tracker rows for 0009–0011 and re-running apply — it then applied only 0012. Tracker is now in sync (12 rows, 0001–0012). See FOLLOWUPS 2026-04-20 "D1 migration tracker out of sync".

**Styling register — drawer vs dashboard:**
The drawer runs its own CSS namespace (`src/styles/made.css`, `made-*` prefix, not Tailwind-processed) while the dashboard Memory panel uses Tailwind utility classes. Decision: match each surface's existing register rather than unify. Three new classes added to `made.css` (`.made-learning-group`, `.made-learning-group-title`, `.made-learning`) recreate the italic-quote + gold-left-border visual rhythm inside the drawer's standalone CSS, without pulling Tailwind into the drawer.

**Grouping order within the drawer section:**
Fixed (not data-driven): Drafter self-reflection first, Learner producer-side pattern second, reader third, zita fourth. Rationale: self-reflection reads as narrative first-person critique — more reader-interesting; producer/reader/zita are progressively terser and more system-y. Readers clicking "What the system learned" find the most human-voiced material first.

**Alternatives considered:**
- **Flat list with per-row source attribution** (instead of grouping). Rejected per the Build 2 handoff which explicitly called for grouping; also the 2026-04-20 piece has 9 rows across two sources and grouping makes the tonal shift between Drafter reflection and Learner pattern visually obvious.
- **Pull the drawer into Tailwind.** Rejected — bigger change than this commit warranted, and the drawer's `made.css` standalone convention matches `beats.css` / `zita.css` deliberately.
- **Inline explanatory copy under the drawer's section heading** (mentioning the dashboard Memory panel as a pointer). Drafted, then struck per Zishan's feedback: the section heading + group labels + observations do the work silently; adding "Zeemish explaining Zeemish to Zeemish" is the kind of self-reference the voice contract avoids. If a later session discovers confusion, can be added then.

**Data observation worth naming:**
The 2026-04-17 drawer shows 4 StructureEditor-origin producer learnings, all of which read as audit violations ("Hook exceeds one screen…") rather than forward-going lessons. That's faithful to what StructureEditor actually writes — logged as its own followup ("StructureEditor writes violation-shaped observations into learnings"). Honesty over prettiness; retune when next retuning StructureEditor.

**Loop status after the two builds:**
- Producer signal → Drafter: wired end-to-end (P1.3), now reader-visible.
- Self-reflection → Drafter: wired end-to-end (P1.4), now reader-visible.
- Reader signal → Drafter: scaffolded but dormant (no readers yet); surface ready to render when rows land.
- Zita signal → Drafter: not yet (P1.5); surface ready.

**FOLLOWUPS resolved:** 2026-04-19 "Surface producer-side learnings + self-reflection in the UI".

**References:** [src/pages/api/dashboard/memory.ts](../src/pages/api/dashboard/memory.ts), [src/pages/dashboard/index.astro](../src/pages/dashboard/index.astro), [src/pages/api/daily/[date]/made.ts](../src/pages/api/daily/[date]/made.ts), [src/interactive/made-drawer.ts](../src/interactive/made-drawer.ts), [src/styles/made.css](../src/styles/made.css), [migrations/0012_learnings_piece_date.sql](../migrations/0012_learnings_piece_date.sql), [agents/src/shared/learnings.ts](../agents/src/shared/learnings.ts), [docs/AGENTS.md](AGENTS.md), [docs/SCHEMA.md](SCHEMA.md).

---

## 2026-04-19: Drafter self-reflects post-publish (P1.4)
**Context:** Writers generate qualitative signal in their heads while they work — what felt thin, where the research was thinner than the writing made it sound, which beat took the most rewrites, what they'd do differently next time. Publication-time audits (voice/structure/fact) capture the *gated* signal; the honest post-hoc judgment is separate and valuable. Reader-side engagement data doesn't exist yet (no readers), and producer-side pipeline metrics (P1.3) don't capture this flavour of signal. A one-shot Sonnet call asking the Drafter role to review its own output gives the Learner a qualitative feed from day 1.

**Decision:** After every `publishing done`, Director fires `Drafter.reflect(brief, mdx, date)` off-pipeline via `this.schedule(1, 'reflectOnPieceScheduled', ...)`. The call re-reads the committed MDX from GitHub (same pattern as the audio alarm), carries the original brief in the alarm payload so the prompt has both "what was asked" and "what was produced", and writes up to 10 learnings with `source='self-reflection'`.

**Prompt shape — deliberate:**
- **Opens by naming the stateless reality.** "You didn't write this piece — a prior invocation with this same role did. You're being asked to review it as the same role would, with honest post-hoc judgment. Don't LARP memories; evaluate what's on the page." Without this framing the model tends to fabricate remembered struggle; with it, the model evaluates the piece as a peer editor would. Constraint from Zishan, carried verbatim in intent.
- **Specific in the ask.** "What felt thin? Which topic were you stretching on where the research was thinner than the writing made it sound? Which beat would have taken the most rewrites? If you wrote a follow-up tomorrow, what would you do differently?" Generic "reflect on this piece" prompts produce generic hedging output; specificity forces substance.
- **Explicit bans on review-speak.** "No hedging. No 'overall the piece was strong' throat-clearing. No summaries of what the piece did. Write like you're telling a trusted editor what actually happened." The bullets we want are the ones a writer wouldn't put in a revision note.
- **Output contract mirrors P1.3's `LEARNER_POST_PUBLISH_PROMPT`:** `{learnings: [{category, observation}]}`. Category normalisation + fallback same as Learner (unknown → `structure`). This is so the three origins (producer / reader / self-reflection) compound into one feed that Drafter's `getRecentLearnings(10)` reads without any slicing logic.
- **User message includes brief + final MDX only.** No scores, no round counts. Scores anchor the model's judgment to a number and invite review-speak; we want unprompted post-hoc reflection on the writing itself.

**Operational constraints — per Zishan:**
- **Non-retriable on failure.** `Drafter.reflect` throws on Claude/JSON errors; Director catches in `reflectOnPieceScheduled`, logs via `observer.logReflectionFailure(date, title, reason)`, and returns. No retry logic. The piece is live; a missed reflection isn't catastrophic.
- **Cap writes at 10 per run.** Same constant semantics as P1.3 (`REFLECTION_WRITE_CAP = 10` in drafter.ts, mirroring `PRODUCER_LEARNINGS_WRITE_CAP`). If the call produces more than 10, it's restating the same pattern — tightening the prompt is the fix, not raising the cap. Overflow is surfaced in the metered observer event.
- **Metered on every run.** Director calls `observer.logReflectionMetered(date, title, {written, overflowCount, considered, tokensIn, tokensOut, durationMs})`. This is the one Sonnet call in the pipeline that doesn't gate anything — so if it silently grows in cost over time (model produces longer reflections, MDX grows, whatever), we want visibility before it matters. Not a hard cap, just a breadcrumb. Info severity so it doesn't clutter the admin feed; the warn/escalation budget stays for actual failures.

**Alarm ordering:**
Both P1.3 (`analyseProducerSignalsScheduled`) and P1.4 (`reflectOnPieceScheduled`) fire at `this.schedule(1, …)`, then audio fires at `this.schedule(2, …)`. The Agents SDK alarm queue serialises them on the same DO; no races because the DO is single-threaded. Order within the same second isn't guaranteed but doesn't matter — neither depends on the other.

**Alternatives considered:**
- **Fire inline after Integrator's final pass (pre-publish).** Rejected. Consistency was the decisive argument: keeping the post-publish learning machinery behind a single boundary (alarm → scheduled method) for both Learner and reflection means disabling or debugging either is one code path, not two. Also: Claude is stateless between calls, so there's no memory-freshness benefit to firing pre-publish.
- **Single combined scheduled method that calls both Learner and Drafter.reflect.** Rejected. Two independent signals with independent failure modes; separate methods means one can go wrong without affecting the other. Alarm queue handles ordering for free.
- **Pass final MDX in the alarm payload instead of re-reading from GitHub.** Rejected. Payload size discipline — Phase F audio work established the "re-read from GitHub" pattern for exactly this reason.
- **Hard cap on reflection tokens or cost.** Rejected for v1 — user preference is visibility first, enforce later if drift actually happens.

**Loop status after P1.4:**
- Producer signal → Drafter: wired end-to-end (P1.3).
- Self-reflection → Drafter: **wired end-to-end.** `reflect()` → `learnings (source='self-reflection')` → `getRecentLearnings(10)` on the next run.
- Reader signal → Drafter: scaffolded but dormant (no readers yet).
- Zita signal → Drafter: not yet (P1.5).

**Verification:** Unit-tested the prompt builder — system prompt opens with the stateless-reality line, contains all the specific-ask language (be honest, what felt thin, stretching, three-to-six bullets, no hedging, no throat-clearing), carries the JSON contract; user message includes brief + full MDX but omits scores/round counts. Type-check on agents workspace: 33 pre-existing errors, 33 after. Behaviour will first exercise tonight's 2am UTC cron — expect one `Reflection: <title>` info event in observer_events per publish, with tokens-in/out + latency.

**References:** [agents/src/drafter.ts](../agents/src/drafter.ts) `reflect()`, [agents/src/drafter-prompt.ts](../agents/src/drafter-prompt.ts) `DRAFTER_REFLECTION_PROMPT` + `buildDrafterReflectionPrompt`, [agents/src/director.ts](../agents/src/director.ts) `reflectOnPieceScheduled`, [agents/src/observer.ts](../agents/src/observer.ts) `logReflectionMetered` + `logReflectionFailure`, [docs/AGENTS.md](AGENTS.md) DrafterAgent section.

## 2026-04-19: Learner writes producer-origin learnings post-publish (P1.3 — behaviour)
**Context:** Plumbing for the `source` column landed in the previous commit ([DECISIONS entry elided — see migration 0011 + writeLearning signature change]). This commit turns it on. The Learner has been reader-engagement-only since launch; since no readers exist on daily pieces yet, the learnings feed the Drafter reads has been narrow (mostly StructureEditor's auditor-time writes). Producer-side signal — which auditor findings recurred, which candidate Curator picked vs the 49 it skipped, how many revision rounds a piece needed, what the final voice score was — was visible to the Director in `audit_results` + `pipeline_log` + `daily_candidates` but never flowed into the learning loop.

**Decision:** After every `publishing done`, Director fires `Learner.analysePiecePostPublish(date)` off-pipeline via `this.schedule(1, 'analyseProducerSignalsScheduled', ...)`. The Learner reads the full quality record for the date, sends a compact context to Claude (Sonnet 4.5), parses a strict JSON response `{learnings: [{category, observation}]}`, and writes the first 10 rows with `source='producer'`. Drafter's `getRecentLearnings(10)` from P1.1 then picks these up on the next run.

**Design choices — explicit:**
- **Trigger at `publishing done`, not `audio-publishing done`.** Producer-side signal is complete the moment text is live — the revision rounds, voice score, candidates picked vs skipped are all settled. Audio lands in its own separate signal category (audio-producer failures, character budgets) that can flow through a future hook without waiting for audio to bind to text. Firing earlier means tomorrow's Drafter starts benefiting from today's lessons ~2 minutes sooner, which matters at zero cost.
- **Off-pipeline, non-blocking.** `this.schedule(1, ...)` not `await learner.analysePiecePostPublish(...)` directly. The piece is already live; the learning is nice-to-have, and must never delay publishing.
- **Non-retriable on failure.** If Claude errors, JSON is malformed, or D1 chokes, Director's `analyseProducerSignalsScheduled` logs to `observer_events` via `observer.logLearnerFailure(date, title, reason)` and returns. No retry loop. The piece is live; a missed batch of learnings isn't catastrophic and retry logic is exactly the kind of defensive code that turns into mystery failures later — deliberate constraint from Zishan.
- **Cap writes at 10 per run; log overflow.** Learner slices `.slice(0, 10)` and returns `overflowCount`. If >0, Director calls `observer.logLearnerOverflow(...)` as a warn event. Usually means the analysis restated the same pattern N ways — a cheap signal that the prompt needs tightening. Constant `PRODUCER_LEARNINGS_WRITE_CAP = 10` in [learner.ts](../agents/src/learner.ts) so the number is searchable.
- **Category normalisation, not constraint.** Claude's returned `category` is lowercased and matched against the four known values (voice / structure / fact / engagement). Anything else falls back to `structure` — a safe default because every prompt sees structure findings. No CHECK constraint, no throw; the `category` column's enum is a convention, not a contract.
- **Dedicated observer methods over reused `logError`.** `logLearnerFailure` (warn) and `logLearnerOverflow` (warn) surface with specific titles in the admin feed rather than generic "Error: learner-post-publish" noise. Small observability win; ~15 lines in `observer.ts`.

**Alternatives considered:**
- **Hand the Learner its own alarm loop with per-piece retry.** Rejected per Zishan's non-retriable constraint. Dead simple to add later if the failure rate turns out to warrant it — for now, silence on failure is fine.
- **Write from the Director directly, skip the LearnerAgent subagent hop.** Rejected — agents own their own prompts and state. The Learner is already the right place to think about learnings; routing producer signal through the same agent keeps the "watch everything, write to learnings" concept honest.
- **Trigger at `done done` (final step) instead of `publishing done`.** Rejected — `done done` fires one log-line after `publishing done` with no new information. Earlier is strictly better.
- **Deeper quality record (include full MDX body, entire pipeline_log payloads).** Rejected for v1. Context is already ~3-10KB for a typical piece; adding the MDX body would triple it for marginal extra signal. If a specific learning needs body context, add it selectively.

**Loop status after P1.3:**
- Producer signal → Drafter: **wired end-to-end.** Post-publish Learner → `learnings (source='producer')` → Drafter's `getRecentLearnings(10)` on the next run.
- Reader signal → Drafter: scaffolded but dormant (no readers yet).
- Self-reflection → Drafter: not yet (P1.4).
- Zita signal → Drafter: not yet (P1.5).

**Verification:** Type-check on agents workspace — 33 errors before, 33 after (all pre-existing Agents-SDK inference issues in server.ts; zero from the changes in this commit). Behaviour will first exercise tonight's 2am UTC cron: after `publishing done`, a `analyseProducerSignalsScheduled` alarm fires; on success, 0–10 rows land in `learnings` with `source='producer'`; on failure, a warn event titled "Post-publish learnings missed: …" appears in observer_events.

**References:** [agents/src/learner.ts](../agents/src/learner.ts) `analysePiecePostPublish`, [agents/src/learner-prompt.ts](../agents/src/learner-prompt.ts) `LEARNER_POST_PUBLISH_PROMPT`, [agents/src/director.ts](../agents/src/director.ts) `analyseProducerSignalsScheduled`, [agents/src/observer.ts](../agents/src/observer.ts) `logLearnerFailure` + `logLearnerOverflow`, [docs/AGENTS.md](AGENTS.md) LearnerAgent section.

## 2026-04-19: Drafter reads learnings at runtime (P1.1 — closing the self-improvement loop)
**Context:** Twelve of thirteen agents have been running identical prompts every day since launch. The `learnings` table was effectively write-only — StructureEditor and Learner wrote into it, but no agent's runtime prompt read from it. That meant every day started from scratch regardless of what prior pieces taught us. The self-improvement loop existed in principle only.

**Decision:** Drafter now reads the 10 most recent rows from `learnings` at runtime and includes them in its user-message prompt as a "Lessons from prior pieces" block, positioned between the Voice Contract and the Brief. This is the first closing of the loop — from here, every subsequent Drafter run sees what the system has learned.

**Design choices — explicit:**
- **Recency-only, no relevance scoring.** `getRecentLearnings(DB, 10)` orders by `created_at DESC` across all categories (structure, voice, engagement, fact — and forthcoming producer / self-reflection / zita). Recency is a cheap, defensible v1. Relevance scoring (tag match against the brief's underlying subject, confidence-weighted) is a later refinement if the recency-only feed proves noisy.
- **No source filter.** Deliberate. When P1.3 adds a `source` column (reader / producer / self-reflection / zita), the default Drafter query still pulls all origins — we want the producer-side signal to compound with reader signal, not be quarantined. Category-filtered reads remain available by adding a separate function; the bare `getRecentLearnings` intentionally widens.
- **Block is semantically named.** "Lessons from prior pieces" — not "Additional context" or "Notes". Block names shape how Claude weights the content; a vague name invites the model to treat the block as decorative.
- **Voice contract still wins on conflict.** Explicit line in the block: "These lessons guide. The voice contract binds. If they conflict, the contract wins." A learning that says "try hedging more" cannot override the voice contract's "no hedging" rule.
- **Empty-state omits the block entirely.** No "No learnings yet" placeholder. On day 1 of the closed loop, the Drafter prompt is identical to its pre-P1.1 shape. The block only appears once something has been written.
- **Fail-open on DB read.** A D1 hiccup must not block a draft. `getRecentLearnings` is wrapped in try/catch; on failure, learnings = [] and the block silently absents itself.

**Alternatives considered:**
- **System-prompt inclusion.** Rejected. System prompts are static cache-friendly artifacts; runtime learnings belong in the user message alongside the brief, where they're contextual to the specific task.
- **Per-category rotation.** Rejected. A reader of the prompt should see the full current-truth, not a curated slice.
- **Confidence filtering (only learnings with confidence ≥ N).** Rejected for v1. Low-confidence learnings are still information; Claude can weight them by the `[category]` prefix and the observation text itself.

**Loop status after P1.1:**
- Producer signal → Drafter: **wired** (pending P1.3 to start writing producer-side rows — until then the feed is mostly StructureEditor's existing writes).
- Self-reflection → Drafter: not yet (P1.4).
- Reader signal → Drafter: not yet (P1.5 + no readers yet).
- Zita signal → Drafter: not yet (P1.5 + no Zita traffic yet).

**Verification:** Unit-tested `buildDrafterPrompt` with (a) empty learnings — block absent, no "contract wins" sentinel, (b) 3 learnings across 3 categories — block present, all 3 observations included, ordering `Voice Contract` → `Lessons` → `Today's Brief`. Type-check on the agents workspace shows zero new errors (33 pre-existing, 33 post — all unrelated Agents SDK inference issues in server.ts).

**References:** [agents/src/drafter.ts](../agents/src/drafter.ts), [agents/src/drafter-prompt.ts](../agents/src/drafter-prompt.ts), [agents/src/shared/learnings.ts](../agents/src/shared/learnings.ts), [docs/AGENTS.md](AGENTS.md) Drafter section.

## 2026-04-19: Frontmatter edits permitted for display-layer fixes (`beatTitles` map)
**Context:** Drafter authors beat headings in kebab-case (`## qvcs-original-advantage`). `rehype-beats.ts` humanises these for display at build time (`qvcs-original-advantage` → "Qvcs Original Advantage"). That round-trip is lossy: apostrophes, colons, and acronym casing the kebab form can't express are gone by the time the display string is generated, so pieces render headings like "Qvcs Original Advantage" instead of "QVC's Original Advantage" and "Teaching 1 The Fuel Equation" instead of "Teaching 1: The Fuel Equation". The display-layer plugin alone can't recover punctuation that was never in the MDX.

**Decision:** Add an optional `beatTitles` frontmatter map — `{ beatSlug: "Human Display Title" }` — that `rehype-beats` prefers over `humanize(slug)`. Retroactively apply to pieces where the default humanise produces wrong output. Leave the Drafter-authored body untouched.

**Permanence rule carve-out:** Per the existing precedent for `audioBeats`, `voiceScore`, and `qualityFlag` (see `metadata_vs_content` memory + publisher.ts:25-29 "Metadata carve-out" comment), frontmatter edits are metadata, not content. `beatTitles` joins that set. The MDX body — the piece's teaching — stays byte-for-byte identical. This explicitly permits editing published pieces' frontmatter when the change is a display-layer fix that can't be expressed any other way.

**Alternatives considered:**
- **Fix Drafter going forward to write human headings into MDX (`## QVC's Original Advantage`).** Rejected as the primary fix because it leaves the three already-published pieces mangled forever under the permanence rule. Still worth doing in parallel for future pieces, and rehype-beats already handles non-kebab headings correctly via the `isKebabOnly` branch. Tracked separately.
- **Teach humanize() to recognise known acronyms (QVC, USA, NATO).** Rejected as too narrow and too magic — a heading like `qvcs-original-advantage` needs both an acronym-detect and a punctuation-insert (`'s`), and generalising that is a larger problem than the fix deserves.
- **Add a separate per-beat YAML block with display fields (e.g. `beats: [{slug, title, audio}]`).** Rejected as scope creep — `audioBeats` already exists as a separate map and mirroring that shape for titles keeps the additions parallel and small.

**Scope of retroactive apply (2026-04-19):**
- 2026-04-17: `qvcs-original-advantage` → "QVC's Original Advantage". Also corrected `beatCount: 6` → `beatCount: 8` (Drafter-declared count drifted from actual `##` count — separate known issue in CLAUDE.md Remaining minor items, fixed on this piece as a metadata-only correction since we were touching frontmatter anyway).
- 2026-04-18: not needed — `humanize()` produces correct output for all its headings.
- 2026-04-19: four `teaching-N-*` headings → "Teaching N: ..." (restore colons + lowercase "and" in the second).

**References:** [src/lib/rehype-beats.ts](../src/lib/rehype-beats.ts), [src/content.config.ts](../src/content.config.ts), CLAUDE.md "Remaining minor items" → beatCount drift entry now updated.

## 2026-04-19: Revert 02882fd — audio double-publish corrupted frontmatter
**Context:** Retro audio generation for 2026-04-17 via admin Continue button produced two `audio-publishing done` events — 543651b (valid) and 02882fd (corrupted). The second commit deleted the audioBeats map and collapsed `qualityFlag: "low"\n---\n` onto a single line, leaving the MDX with no YAML terminator. Live site unaffected (still serving cached HTML built from 543651b), but next deploy would have built from the corrupted state.

**Decision:** `git revert 02882fd`. Smallest safe action — preserves history, doesn't hide the bug. Audio data in D1/R2 is intact; only the MDX frontmatter splice got mangled.

**Root cause NOT fixed here.** Two stacked bugs (Publisher.publishAudio non-idempotent on second call + Director Continue path firing full re-run instead of resuming) tracked in [docs/FOLLOWUPS.md](FOLLOWUPS.md). Out of today's improvement-plan scope. Tonight's 2am UTC cron is a fresh pipeline (not a retry), so it's unaffected by the Continue-path trigger; tomorrow's piece should land clean.

**References:** [docs/FOLLOWUPS.md](FOLLOWUPS.md) 2026-04-19 entries, [agents/src/publisher.ts:230-247](../agents/src/publisher.ts:230) (spliceAudioBeats), [agents/src/director.ts](../agents/src/director.ts) retryAudio.

## 2026-04-18: Ship as-is despite security-header gap on prerendered HTML (LAUNCH)
**Context:** zeemish.io custom-domain swap completed. All security-critical surfaces (`/dashboard/`, `/account`, `/login`, `/api/*`, `/auth/*`, `/audio/*`) are returning all 6 security headers — confirmed via curl. But the public read-only pages (`/`, `/daily/*`, `/library`) still return without security headers and with Cloudflare's default `cache-control: public, max-age=0, must-revalidate`. Three workarounds attempted in sequence (run_worker_first=true → middleware Cache-Control no-store on HTML → post-build.sh overriding _routes.json to include /*) all failed: Cloudflare Workers Static Assets serves `.html` files directly from the asset binding, bypassing the worker entirely, regardless of all three settings. Verified: `_routes.json` IS deployed correctly (`curl https://zeemish.io/_routes.json` shows the override), and the worker IS running for non-HTML routes (the new cache-control lands on `/dashboard/`).

**Decision:** Launch zeemish.io to the public with this gap. Document it explicitly. Move on. Don't keep iterating.

**Reason — risk analysis:**
- The pages missing headers are read-only HTML with no auth, no forms, no cross-origin fetches, no third-party scripts beyond a Google Fonts preconnect
- Headers we'd want on them are CSP (mostly to constrain what the page can fetch — moot, it doesn't fetch anything cross-origin), X-Frame-Options (clickjacking — there's no sensitive UI to overlay), X-Content-Type-Options (MIME sniffing — only matters for content the browser would mis-execute, irrelevant for static HTML)
- The realistic residual risk is clickjacking. For a public reading site with no actions, that's a low-impact vulnerability. An attacker iframing a Zeemish daily piece to overlay something else achieves nothing — there's nothing to phish, no buttons to mis-click into a transaction
- The auth surfaces (where headers DO land) are the actual attack surface. Those are hardened
- Fixing this would require either (a) a Cloudflare Transform Rule (UI work, splits config), or (b) making prerendered pages server-rendered (loses prerender perf benefit, every request re-renders MDX through worker). Neither change is worth blocking launch for
- The user explicitly weighed this and chose to ship: "I dont think its too much of a big risk as they are read only pages not like admin pages that already rendered on the server side"

**Reason — why this matters as a documented decision:** Future-me or future-them will discover the missing headers in a security scan or audit and want to know whether this was an oversight or a deliberate trade-off. It was deliberate. The path to close the gap is in `Remaining minor items` in CLAUDE.md.

**Lessons captured for next time:**
1. Cloudflare Workers Static Assets has surprising precedence over worker-side configuration. `run_worker_first` and `_routes.json` `include` patterns are not the safety net you'd expect for `.html` files. If you need headers on static HTML, plan for it from the start — either prerender to dist with build-time HTML transformation, or use Cloudflare Transform Rules from day one.
2. Don't trust `cf-cache-status: HIT` to mean "old cache, will fix on next purge." It can also mean "Cloudflare is serving the asset directly without any cache logic running." Distinguish via cache-bypass tests on routes you KNOW are server-rendered.
3. Custom-domain swaps need at least one Cloudflare cache purge after the bind. Future-proof: add a `gh workflow_dispatch` step that calls Cloudflare's purge API after each deploy. Or set Cache Rules in the dashboard to `bypass` for HTML.

**Launch state captured at git tag `v1.0.0`.**

**References:** [src/middleware.ts](../src/middleware.ts), [scripts/post-build.sh](../scripts/post-build.sh), [wrangler.toml](../wrangler.toml), CLAUDE.md "Critical lesson — Cloudflare Workers Static Assets" + "Launch (2026-04-18 — v1.0.0)".

## 2026-04-18: Override Astro Cloudflare adapter's _routes.json (post-launch hotfix)
**Context:** zeemish.io went live via custom domain swap. Smoke test on the live domain showed `cf-cache-status: HIT` and zero security headers on `/`, `/daily/*`, `/library` — but headers ARE present on `/dashboard/`, `/api/*`, `/audio/*`. Three Cloudflare cache purges didn't fix it. Diagnosis: the Astro Cloudflare adapter auto-generates `dist/_routes.json` with prerendered paths in the `exclude` list, which tells Cloudflare to serve those files directly from Static Assets WITHOUT invoking the worker. `run_worker_first = true` in wrangler.toml is overridden by this exclude list — Cloudflare honours `_routes.json` first.

**Decision:** Add `scripts/post-build.sh` that overwrites `dist/_routes.json` after `astro build` runs. New file routes ALL paths through the worker via `include: ["/*"]`, with only true static assets (`/_astro/*` bundled JS/CSS, `/og-image.svg`, `/robots.txt`) in `exclude`. This makes the middleware-applied security headers reach prerendered HTML.

**Alternatives considered:**
- **Adapter `routes.extend.include` config option.** Documented per the adapter type defs. Rejected because the docs explicitly say "exclude always takes priority over include" — and the adapter's auto-generated excludes already list every prerendered path. Adding to include doesn't unlist them.
- **Cloudflare Transform Rules in dashboard.** Would work and apply to ALL responses regardless of cache state. Rejected because (a) splits header config between code and Cloudflare UI, (b) requires manual setup, (c) would re-apply on every domain swap. Code-side fix is portable.
- **Make `/`, `/daily/[date]`, `/library` server-rendered (`prerender = false`).** Loses the prerender perf benefit (every request would re-render MDX through the worker). Rejected — overkill for a header problem.
- **Set `_headers` in `public/`.** Workers Static Assets does not honour `_headers` (that's a Pages-only feature). Already learned this in the morning's pass.

**Reason — why post-build script over adapter config:** The adapter has no exposed knob for the auto-exclude behaviour. A post-build script is a small, obvious, contained workaround that survives adapter upgrades. If the adapter ever adds a `routes.strategy` option, we can rip the script out without other changes.

**Cost:** All static-HTML requests now invoke the worker (~1-5 ms added per request). At our scale, negligible. The `Cache-Control: private, no-store` middleware sets on HTML means CDN won't cache HTML, so the worker runs on every request — but Workers are fast and the rendered HTML is tiny. Bundled JS/CSS (`/_astro/*`) still get edge-cached and served direct from assets, so performance for repeat visitors is preserved.

**References:** [scripts/post-build.sh](../scripts/post-build.sh), [src/middleware.ts](../src/middleware.ts) (the `applySecurityHeaders` content-type check), [package.json](../package.json) (build script), [wrangler.toml](../wrangler.toml) (`run_worker_first = true`). See CLAUDE.md "Critical lesson — Cloudflare Workers Static Assets" for the three-layer mental model that's needed to reason about this in future.

## 2026-04-18: Launch-readiness pass before zeemish.io domain swap
**Context:** About to retire the old `zeemish.io` (separate breathing-tools product) and bind `zeemish-v2` to the apex. Audited what was actually broken vs. what CLAUDE.md *claimed* was broken. CLAUDE.md "Remaining minor items" had drifted: site worker R2 binding and `/audio/*` route were already shipped, daily-piece engagement writes were already firing from `<lesson-shell>`, only the surface was missing. Real launch blockers turned out to be smaller and different.

**Decisions made in this pass:**

1. **Wire `audio_plays` engagement once-per-session.** `<audio-player>` knows when audio plays; `<lesson-shell>` owns the engagement HTTP. Bridge them with a `audio-player:firstplay` custom event (paused→playing transition, fires once per page load via `hasReportedFirstPlay` guard). Lesson-shell already had `trackEngagement('audio_play')` plumbing. Alternative considered: inline POST in audio-player. Rejected — duplicates URL-parsing logic for course_id/lesson_id that lesson-shell already does, and event-based keeps audio-player free of HTTP concerns.

2. **Surface engagement on admin via server-side query.** Admin is a `.astro` page with full D1 access — no need to call the JSON `/api/dashboard/analytics` endpoint client-side. One `GROUP BY lesson_id` query; rows render with the same Tailwind/eyebrow patterns as the All Pieces list. Each row deep-links to `/dashboard/admin/piece/{lesson_id}/`. The legacy `analytics.ts` endpoint is now unused but kept (could become useful for scripted admin tooling later).

3. **Move security headers from `public/_headers` into middleware + flip `run_worker_first = true`.** Cloudflare Workers Static Assets does not honour `_headers` (that's Cloudflare Pages, a different product). Live response had ZERO security headers despite a fully-populated `_headers` file. Middleware can apply headers — but only runs for requests that hit the worker, so prerendered pages (home, daily, library) were skipped. Two options: (a) copy headers into a build-time HTML transform, or (b) `run_worker_first = true` so the worker handles every request including static assets. Picked (b): one extra worker invocation per asset, negligible at our scale, single source of truth, no build-step gymnastics. Cost: paying ~1ms CPU per asset request that previously was free. Worth it for headers correctness across the full surface. `public/_headers` deleted to prevent future devs from trusting it.

4. **CSP simplified.** Old policy hard-coded `connect-src https://zeemish-agents.zzeeshann.workers.dev` because the live `_headers` was the model. New policy: `connect-src 'self'`. The site does NOT call the Agents worker from the browser — site→agents traffic uses the Cloudflare service binding (`[[services]]` in wrangler.toml) which is in-process, not a network fetch. Removing the workers.dev URL from CSP also avoids stale-domain rot once we move to zeemish.io.

5. **Documented Range-request bug as deferred minor item.** `/audio/*` route claims Range support but returns 200 with full body on `Range: bytes=0-1023`. Per-beat clips are small (~480KB) so browsers cope; deferring the fix until a real seek-bandwidth complaint arrives.

**Reason — why audit instead of just executing:** First instinct was "audio's broken, engagement's not tracked, fix both." Reading the code showed both were further along than CLAUDE.md indicated. The honest pre-launch list was much shorter (and different) than the claimed one. Lesson: trust code over docs when they disagree. Added to the launch process: walk CLAUDE.md against reality before any release.

**References:** [src/interactive/audio-player.ts](../src/interactive/audio-player.ts), [src/interactive/lesson-shell.ts](../src/interactive/lesson-shell.ts), [src/pages/dashboard/admin.astro](../src/pages/dashboard/admin.astro), [src/middleware.ts](../src/middleware.ts), [wrangler.toml](../wrangler.toml).

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

## 2026-04-19: First autonomous cron fire exposes three silent-failure bugs

**Context:** 2am UTC cron fired autonomously for the first time (the cron fix deployed 2026-04-18 worked). Pipeline produced a Polished piece — Voice 95/100, 1 round, 0 revisions, 50 candidates, committed at 02:01. But the first real auto-run also exposed three regressions that manual-trigger runs had been masking:

1. `/daily/2026-04-19/` rendered as one flowing prose block — no `<lesson-shell>`/`<lesson-beat>` slides, no Next/Previous, no pagination. 04-17 and 04-18 render correctly.
2. Auditor escalated at 02:01:48: *"No audio rows found for 2026-04-19 — producer did not run or persist failed."* Admin timeline misleadingly showed `audio-producing ✓`. Reader: "Audio version coming soon" indefinitely.
3. Dashboard "how it's holding up" surfaced *fact-check web: Offline — 5 checks this week used Claude-only*, meaning every Facts ✓ this week had silently degraded to first-pass Claude only.

**Diagnosis — bugs 1 and 2 are the same bug:** `agents/src/drafter-prompt.ts` lists beat names in the brief but never specifies how to demarcate them in the MDX body. Claude free-styled: 04-17 and 04-18 happened to use `## beat-name` markdown headings; 04-19 used `<beat id="beat-name">` custom JSX tags. Both are valid MDX. Two downstream consumers hard-code `##`:
- `src/lib/rehype-beats.ts:85` only wraps `h2` nodes into `<lesson-beat>`. Zero h2s → plugin no-ops at line 90 → flat prose.
- `agents/src/audio-producer.ts:145` `extractBeats()` splits on `/\n## /`. Zero matches → empty array → producer loops over nothing → returns "success" with no ElevenLabs calls and no D1 writes. Pipeline log gets `audio-producing ✓` regardless.

**Diagnosis — bug 3 is two bugs stacked:** The DDG Instant Answer API (`api.duckduckgo.com`) is a Wikipedia-topic oracle, not a general web search. Specific factual claims return HTTP 200 with empty `Abstract`/`RelatedTopics`. `fact-checker.ts:137-163` had a bare `catch { return null }` + `if (!response.ok) return null` that collapsed three distinct outcomes into a single nullable string. The "Web search unavailable" warn then fired for both actual network failures AND "DDG reached but had no answer" — conflating infrastructure health with question-specificity. No fetch timeout either.

**Decisions:**

1. **Drafter prompt mandates `##` syntax.** Added "Beat format (required)" section to `DRAFTER_PROMPT` with the `## beat-name` pattern, explicit forbiddance of JSX tags, and the *why* (downstream renderer + audio producer both split on `## `). One-line clarification at the root of both bugs 1 and 2.

2. **`extractBeats()` throws on zero beats.** Converts silent zero-row "success" into a visible escalation via Director's existing try/catch. The audio pipeline `✓` becomes `✗` with a real reason; Auditor's "no rows found" check becomes a backstop instead of the primary alarm.

3. **Fact-checker refactored to discriminated outcomes.** New `WebSearchOutcome` and `SearchPassOutcome` types encode `ok | empty | error`. `webSearch()` returns `{status: 'error', reason}` for unreachable/5xx/timeout, `{status: 'empty'}` for reachable-but-no-answer, `{status: 'ok', text}` otherwise. `check()` maps these to three honest combos of `FactCheckResult.{searchUsed, searchAvailable}`:
   - `both true` → pass-3 reassessment ran on real content
   - `searchAvailable: true, searchUsed: false` → DDG was reachable, had no relevant answer, first-pass Claude is the final word — **not** a quality regression, no Observer warn
   - `both false` → DDG unreachable, real infrastructure problem
   5-second `AbortSignal.timeout` added. The dashboard's *Fact-check web: Offline* signal is now truthful — it fires only on real network failure.

4. **Reset 04-19 rather than patch the MDX.** The committed body had `<beat>` tags — the permanence rule forbids content edits. Reset (git rm + D1 wipe across 6 tables) preserves the rule and lets the fixed Drafter produce a clean replacement.

**Alternatives considered:**

- **Teach `rehype-beats.ts` to also accept `<beat>` tags.** Retroactively fixes 04-19 without MDX edit — tempting. Rejected: legitimising two valid syntaxes invites future Drafter drift and hides the real bug (prompt ambiguity). One syntax, enforced at source.
- **Replace DDG Instant Answer with Brave/Serper/Claude-web-search.** Correct long-term fix — DDG IA realistically resolves ~5% of specific factual claims. Scoped out of tonight's patch; logged in CLAUDE.md "Remaining minor items". Tonight's refactor at least makes the signal honest about the narrow coverage.
- **Enforce `beatCount` = actual `##` count via Structure-Editor gate.** Uncovered a data-integrity drift on 04-17 (declares 6, has 8 `##` headings). Reader UI counts actual headings so rendering is correct; only `daily_pieces.beat_count` is stale metadata. Also logged in minor items.

**Reason — why a prompt fix over making both consumers accept multiple syntaxes:** The contract Drafter owes downstream is *"one section per `##` heading, kebab-case slug."* Two consumers already enforce it. Loosening them (adding `<beat>` tolerance to either) multiplies the surface area of valid inputs and invites the next drift — `<section>`, `###`, `<div data-beat=...>`. One source of truth at the producer, not defensive tolerance at every consumer.

**Reason — why throw in `extractBeats()` rather than return an empty sentinel:** The 04-19 failure was invisible because the success signal (pipeline-log `✓`) was emitted from Director *after* a successful function return, regardless of whether that success had produced any rows. Throwing surfaces the real failure in Director's try/catch, which is already wired to Observer escalation. The old pattern meant the Auditor's "no rows found" check was the alarm — triggered ~60s downstream with a symptom ("no rows") instead of a root cause ("zero beats found in MDX"). The throw moves diagnosis upstream.

**Recovery:** Reset 04-19 (git rm MDX + D1 wipe 6 tables: `daily_pieces`, `daily_candidates`, `pipeline_log`, `audit_results`, `observer_events`, `daily_piece_audio`). User triggers fresh pipeline from admin. Fixed Drafter emits `##` syntax → rehype-beats produces `<lesson-beat>` slides → extractBeats returns 6 beats → audio-producer writes 6 rows → Publisher's second commit splices `audioBeats` into frontmatter → reader sees paginated slides + working audio.

**Verified:** `npx tsc --noEmit` on agents/ — zero errors in touched files. `server.ts` pre-existing Durable Object stub type errors are unrelated and pre-date this change.

**References:** [agents/src/drafter-prompt.ts](../agents/src/drafter-prompt.ts), [agents/src/audio-producer.ts](../agents/src/audio-producer.ts), [agents/src/fact-checker.ts](../agents/src/fact-checker.ts), [src/lib/rehype-beats.ts](../src/lib/rehype-beats.ts). CLAUDE.md "Remaining minor items" now lists the DDG IA narrow-coverage limitation and the `beatCount` declared-vs-actual drift.

## 2026-04-19: Audio pipeline hardening — fetch timeout + Continue/Start-over retry UX

**Context:** After the first three-bug fix landed and 04-19 was re-triggered, text + beats published cleanly but audio stalled at 2 of 6 beats. Last row (`the-cost-structure`) persisted at 08:19:05 UTC; 18+ minutes later, `pipeline_log` still showed `audio-producing running`, no `done`, no `failed`, no observer escalation, and the admin page showed no retry button because the existing logic was a binary branch: *show rows if any exist, show retry button only if none exist.* Operator had partial state + zero way to act on it.

**Root cause:** `agents/src/audio-producer.ts` `callElevenLabs()` had no fetch timeout. When ElevenLabs stalled the TCP connection on beat 3 (likely rate limit or transient network glitch with no response), `fetch()` hung indefinitely. The Durable Object eventually hibernated, leaving Director's `await producer.generateAudio(...)` in limbo — no resolve, no reject. Same silent-failure pattern we'd just fixed in DDG fact-checker but never propagated to ElevenLabs.

Retry UI gap compounded the problem: partial rows are exactly when operators need a retry button most (the pipeline is stuck, not complete), but the existing template hid it.

**Decisions:**

1. **30-second `AbortSignal.timeout` on ElevenLabs fetch.** Matches the DDG fix pattern. Typical response for a 2000-char beat is 5-15s; 30s is generous headroom. On timeout, `fetch` rejects, existing 3-attempt retry loop in `callElevenLabs` fires (1s then 2s backoff), all 3 fail fast, exception bubbles up to Director's try/catch at `director.ts:336-346`, which logs `audio-producing failed` + emits an Observer escalation via `logAudioFailure`. Silent hang → visible escalation.

2. **`retryAudioFresh(date)` on Director.** Wipes R2 objects (`list({prefix: audio/daily/YYYY-MM-DD/}) → delete` each), `daily_piece_audio` rows, `daily_pieces.has_audio`, and `pipeline_log` rows matching `step LIKE 'audio%'`. Then delegates to existing `retryAudio(date)` for MDX read + pipeline re-run. Text-phase pipeline rows (scanning/curating/drafting/auditing/publishing/done) are preserved — they describe a piece that remains published. Only audio-side state is reset.

3. **`/audio-retry` endpoint accepts `mode=continue|fresh` query param** (default `continue` for backwards compatibility with any external callers). Site proxy at `src/pages/api/agents/audio-retry.ts` passes through.

4. **Admin UI rework** at `src/pages/dashboard/admin/piece/[date].astro`. New completion signal: `piece.has_audio === 1`. Whenever that's false, retry affordance is visible. When partial rows exist, TWO buttons appear: **Continue** (default `mode=continue`, resumes missing beats) and **Start over** (`mode=fresh`, confirm() dialog stating the clip count that will be deleted + cost, then wipe-and-regenerate). Row listing and retry affordance stack vertically instead of being mutually exclusive — operator sees current state AND has an action.

**Alternatives considered:**

- **Per-beat retry buttons (regenerate just this one clip).** Rejected — adds UI complexity for a rare need. If one beat's audio is bad, Start over with six cheap ElevenLabs calls is simpler than per-row targeting, and production traffic is low enough that the extra cost is negligible.
- **Double-click-to-confirm on Start over instead of browser confirm() dialog.** Cleaner visual feel but needs state management for the 3-second arm window. Browser `confirm()` is zero-JS-state, explicit about consequences (clip count in the message), and idiomatic for destructive admin actions.
- **Auto-retry on stall (detect `audio-producing running` > 5min and re-fire).** Rejected for now — adds a polling/watchdog dimension to the system. The new timeout on ElevenLabs fetch should prevent stalls in the first place; if they still happen, operator gets a visible retry button. Revisit if stalls recur despite the timeout.

**Reason — why the timeout is a 30s per-attempt and not a smaller outer deadline:** ElevenLabs latency varies by text length and server load. 5-15s typical, occasionally 20-25s for long beats. A 10s timeout would false-positive frequently. 30s gives headroom for normal variance but still fails fast if the connection is truly stuck.

**Reason — why `retryAudioFresh` wipes before delegating instead of having `runAudioPipeline` take a `reset` flag:** Keeps the pipeline method free of mode branching. `runAudioPipeline` should only know how to produce + audit + publish given fresh input; the "is this a fresh attempt or a resume" decision belongs at the caller. Cleaner separation.

**Verified:** `npx tsc --noEmit` on agents/ — zero new errors in touched files. The server.ts DurableObjectStub noise that flags `retryAudioFresh` is the same pre-existing pattern that flags `retryAudio`, `getStatus`, `triggerDailyPiece`, etc. Runtime is unaffected.

**References:** [agents/src/audio-producer.ts](../agents/src/audio-producer.ts) (callElevenLabs + AbortSignal.timeout), [agents/src/director.ts](../agents/src/director.ts) (retryAudioFresh), [agents/src/server.ts](../agents/src/server.ts) (/audio-retry mode dispatch), [src/pages/api/agents/audio-retry.ts](../src/pages/api/agents/audio-retry.ts) (proxy passthrough), [src/pages/dashboard/admin/piece/[date].astro](../src/pages/dashboard/admin/piece/[date].astro) (UI + script).

## 2026-04-19: Audio RPC wall-clock budget — chunked generation

**Context:** After Phase D fixes (ElevenLabs timeout + retry UI + retryAudioFresh) deployed and 04-19 was re-triggered, audio again stalled at exactly 2 of 6 beats. Hit **Continue** once → 2→4. Hit it again → 4→6. Pattern made the root cause crisp:

| Run | Beat 1 | Beat 2 | Elapsed |
|---|---|---|---|
| First autonomous | 08:18:47 | 08:19:05 | ~18s |
| First retrigger | 09:14:08 | 09:14:20 | ~12s |
| Continue click 1 | N/A | N/A | ~20s, +2 beats |
| Continue click 2 | N/A | N/A | ~15s, +2 beats |

Each producer invocation cleared ~2 beats in ~20-25s then silently died — no error logged, no observer escalation, no pipeline_log `failed` row. The 30s AbortSignal.timeout we added in Phase D wasn't the culprit: individual ElevenLabs calls completed in 10-15s. The **outer RPC call** from Director → Producer was the thing hitting a ~30s wall-clock budget.

**Root cause:** Cloudflare Durable Object RPC calls are bounded by a wall-clock budget (~30 seconds) before the platform considers them stuck and terminates/hibernates the callee. When producer's `generateAudio(brief, mdx)` ran a for-loop over 6 beats × ~10-15s each of ElevenLabs latency, total wall time was 60-90s — well over budget. Cloudflare silently killed the DO; the pending promise in Director's `await` never resolved. Every symptom tonight — silent hang, no error, admin UI showing partial state indefinitely — traces back to this single budget.

**Decision:** Chunk the producer work. Rename + refactor `generateAudio()` to `generateAudioChunk(brief, mdx, maxBeats = 2)` — processes at most N new beats per call, returns `{processedBeats, totalBeats, completedCount, totalCharacters}`. Director's `runAudioPipeline` replaces the single `await producer.generateAudio(...)` with a bounded while-loop (≤10 iterations) calling `generateAudioChunk` until `completedCount >= totalBeats`. Each call runs for ≤25s (2 beats × ~12s + overhead), comfortably under the RPC budget. All remaining state (auditor, publisher second-commit) is unchanged — they already read from D1.

**Chunk size chosen = 2:** Safe margin under the 30s budget even at ElevenLabs' slow end (2 × 15s = 30s + overhead is risky; 2 × 12s = 24s + overhead fits). Could raise to 3 but no reason to — the loop cost is negligible.

**Cross-chunk prosodic continuity:** ElevenLabs stitches audio across calls via `previous_request_ids` (up to 3 prior request IDs per call). In the old single-call version, this lived in an in-memory array that survived because the whole loop was one DO invocation. Across chunks, that array is gone on each new call. **Fix:** at the start of each chunk, query `daily_piece_audio` for the last 3 non-null `request_id`s by `generated_at DESC`, reverse to oldest-first, use those as the seed `previous_request_ids`. The stitching works unchanged across chunk boundaries — listeners can't tell the audio was generated in 3 calls instead of 1.

**Publisher reads audioBeats map from D1, not from Director's in-memory accumulation.** D1 is the only source of truth that covers (a) all beats from the current run's chunks, (b) any beats carried over from a prior partial run via R2 head-check skip. In-memory accumulation in Director would miss case (b) if a retry happened to land on Continue after a partial.

**Safety belts in Director's while-loop:**
- `MAX_CHUNK_ITERATIONS = 10` — hard ceiling on loop reruns; for a 20k-char piece at 2 beats/chunk, ≤6 iterations is expected; throws at 10 to prevent runaway cost
- `processedBeats.length === 0 && completedCount < totalBeats` → no progress → throw (prevents infinite loops if producer silently refuses work)

**Alternatives considered:**

- **Use DO alarm() to chain beat generation.** Producer schedules an alarm to fire in ~2s which picks up the next beat, continues until done, sets a "complete" state that Director polls. Rejected — adds state machine complexity (alarm scheduling, completion polling, timeout detection) for no real benefit over the cleaner synchronous loop. Also leaks "running" state if Director's polling side dies.
- **Use Cloudflare Queues between Director and Producer.** Over-engineered for a sequential 6-step pipeline. Queues are for decoupling async consumers, not orchestrating a deterministic sequence.
- **Use `ctx.waitUntil` on the producer side to return early + continue in background.** Changes the RPC contract (caller gets back instantly without results) and introduces the same polling + completion-detection complexity as the alarm approach. Rejected for the same reasons.
- **Put the loop inside the producer (use ctx.waitUntil + multiple inner RPCs).** Same wall-clock budget still applies to the outer producer RPC; just shifts the problem.

**Reason — why a bounded loop rather than "just keep calling until done":** A runaway loop could spend unbounded ElevenLabs credits if producer gets into a weird state where beats look unprocessed but can't be generated. `MAX_CHUNK_ITERATIONS = 10` is roughly 2× the expected ceiling for the largest piece we'd ship (12 beats × 2 per chunk = 6 iterations), so legitimate work always succeeds but a bug never costs more than ~$1 of credits before escalating.

**Reason — why not just do 1 beat per chunk:** Each chunk has fixed overhead (subAgent lookup, D1 queries for priorRequestIds + countRow, return-trip latency). Doing 1 beat per chunk means 6 chunks of overhead. 2 per chunk halves that; 3 would start flirting with the 30s budget at ElevenLabs' slow end. 2 is the Pareto sweet spot.

**Verified:** `npx tsc --noEmit` — zero errors in touched files. `pnpm build` — site build passes. End-to-end verification pending reset + re-trigger.

**References:** [agents/src/audio-producer.ts](../agents/src/audio-producer.ts) (generateAudioChunk + ChunkResult + priorRequestIds from D1), [agents/src/director.ts](../agents/src/director.ts) (runAudioPipeline chunk-loop + audioBeats from D1 for publisher).

## 2026-04-19: DO eviction was the real root cause (not a per-RPC budget) — keepAlive() fix

**Context:** Phase F chunking made the producer robust but didn't fix the underlying stall. After Phase F deployed, next trigger stalled at **1/5 beats** — even worse than the 2/6 we'd seen before. Only explanation: the problem wasn't at the producer-RPC level. Going back to the pipeline_log timestamps told the real story:

```
scanning      0s  → done 2s      (Scanner)
curating      2s  → done 30s     (Curator, 28s — Claude call)
drafting      30s → done 78s     (Drafter, 48s — Claude generates ~1300 words)
auditing_r1   78s → done 106s    (three auditors in parallel)
publishing    106s → done 107s   (GitHub commit)
done          107s
audio-producing 108s → running
  └─ hook beat generated at 116s (8s into audio)
  └─ silence after 116s
```

Director's Durable Object ran for 116 seconds and died. The text phase alone consumed 107s of that. Audio only got 9 seconds before the DO was evicted.

**Root cause (found, not guessed):** Grepping the Agents SDK source at `agents/node_modules/agents/dist/index.js` for timeout/hibernation code surfaced the `keepAlive()` method docstring:

> *"Use this when you have long-running work and need to prevent the DO from going idle (**eviction after ~70-140s of inactivity**). The heartbeat fires every `keepAliveIntervalMs` (default 30s) via the alarm system."*

This is a documented Agents SDK feature, not a Cloudflare platform limit. Without `keepAlive()`, the runtime considers a long-running DO "inactive" after ~70-140s and hibernates it — killing any in-flight awaits including cross-facet RPC chains. The exact 70-140s range is why we saw stalls in that window consistently. The reason the Continue button worked is that `/audio-retry` kicks off a fresh HTTP request → fresh Director invocation → fresh 70-140s window, which gave audio enough budget to do 2 more beats before hitting the window again.

**Decision:** Wrap `Director.triggerDailyPiece`, `retryAudio`, and `retryAudioFresh` with `await this.keepAlive()` + `try/finally` disposer. The SDK's keepAlive uses the alarm system to fire a 30s heartbeat that resets the inactivity timer. Reference-counted internally, so nested calls (`retryAudioFresh` → `retryAudio`) are safe and the heartbeat only stops once all refs are disposed.

```ts
async triggerDailyPiece(force = false) {
  const dispose = await this.keepAlive();
  try {
    // full pipeline body — text + audio
  } finally {
    dispose();
  }
}
```

**What Phase F chunking still buys us (not wasted work):**

1. **Retry semantics are cleaner.** `generateAudioChunk(maxBeats=2)` processes bounded work per call. A retry resumes exactly where prior runs left off via R2 head-check; no infinite loops on weird state.
2. **Cross-chunk prosodic continuity via D1.** Loading the last 3 `request_id`s from `daily_piece_audio` at chunk start means ElevenLabs stitching works across multiple retries, not just within one invocation's in-memory window.
3. **Safer per-RPC budget.** Even with `keepAlive`, Agents SDK's client-side RPC timeout default is 60s. Chunked calls stay well under that regardless of DO inactivity.
4. **Progress is visible sooner.** Each chunk persists rows incrementally, so the admin dashboard reflects progress during generation instead of all-or-nothing at the end.

**Why I misdiagnosed it in Phase F:**

Pattern matched "30s Cloudflare RPC timeout" — a known Cloudflare limit I'd seen mentioned in platform docs. The 2/6-beat ceiling and the ~25s elapsed time both fit. But the correlation wasn't causation: the real signal was the **total Director invocation wall-clock**, not the producer-RPC-call duration. Chunking addressed the symptom (per-producer-call stays short) without fixing the cause (Director's surrounding invocation times out). 1/5 on the next trigger — worse than 2/6 — was the data point that broke the hypothesis and forced me to actually read the SDK source.

**Alternatives considered:**

- **Split audio into a separate HTTP request after text completes.** Would give audio its own fresh Director invocation (same trick the Continue button uses). Rejected: more moving parts than `keepAlive()`, and still needs `keepAlive()` for pieces whose audio alone runs past 140s (12-beat newspapers).
- **Use DO alarms to chain audio chunks.** Each alarm fire is a fresh invocation. Rejected same reason — adds orchestration complexity (state machine, completion detection, timeout handling) when a single SDK method call does the same thing cleaner.
- **Static options `keepAliveIntervalMs: 20000`** (tighter heartbeat). Rejected — 30s default is fine; the eviction timer is 70-140s, so 30s heartbeats have 40-110s of slack. Changing it adds config surface without improving reliability.

**Verified:** `npx tsc --noEmit` clean in touched files; `pnpm build` passes. End-to-end verification via reset + fresh trigger next.

**Lesson for next time:** When empirical pattern-matching gives a plausible story that fits the symptoms, resist the urge to ship without verifying against the SDK/platform source. The 30s RPC timeout story was plausible enough to waste a deploy cycle. Ten minutes of grepping `node_modules/agents/dist/` would have surfaced `keepAlive()` immediately.

**References:** [agents/src/director.ts](../agents/src/director.ts) (keepAlive wrappers on triggerDailyPiece, retryAudio, retryAudioFresh); SDK doc in `agents/node_modules/agents/dist/index.js:1671-1699`.

## 2026-04-19: Audio via alarm, not inline (keepAlive was a partial fix)

**Context:** Phase G added `keepAlive()` based on the Agents SDK docstring *"eviction after ~70-140s of inactivity"*. Next trigger still stalled at 2/5 beats after 117s. keepAlive wasn't helping. Asked a research agent to pull **actual Cloudflare docs** instead of continuing to guess.

**What the docs actually say** (quoted from [Cloudflare DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) and [Workers platform limits](https://developers.cloudflare.com/workers/platform/limits/)):

- HTTP/RPC-triggered DO invocations: *"If you consume more than 30 seconds of compute between incoming network requests, there is a heightened chance that the individual Durable Object is evicted and reset."* **There is no hard wall-clock limit** while the caller stays connected — but the "30s of compute between incoming requests" eviction rule kills long-running inline work.
- **Alarm handlers: "maximum wall time of 15 minutes."** They are a separate invocation boundary with their own fresh budget.
- **CPU budget: 30s default, up to 5 minutes via `limits.cpu_ms`.** CPU time excludes I/O waits (fetch, KV, D1), so our ElevenLabs-heavy audio phase burns almost no CPU — CPU wasn't the blocker.
- `keepAlive()` uses alarm-system heartbeats to simulate "incoming network requests" and reset the inactivity timer. But **Durable Objects are single-threaded**: alarms can't fire while the current invocation is holding the DO. So during a long inline method call, queued heartbeats can't actually deliver — they pile up waiting for the current call to finish, exactly when we need them.

**Root cause (definitive):** Our `triggerDailyPiece` runs inline from an HTTP-triggered invocation. Text phase: ~90s. Audio starts: ~2s of compute per beat × 5 beats = ~10s CPU with ~60s wall (ElevenLabs I/O). Cumulative compute-between-requests hits the ~30s eviction threshold midway through audio, and since no new HTTP request arrives during the whole pipeline, the DO gets reset. keepAlive heartbeats can't fire because the DO is busy running triggerDailyPiece. Whole invocation dies silently around 110-120s.

**Decision:** Move audio out of the HTTP-triggered invocation entirely. After text publishes, `triggerDailyPiece` calls `await this.schedule(1, 'runAudioPipelineScheduled', { date, filePath, title })` and returns. Schedule row is persisted in SQLite, alarm fires 1 second later in a **fresh DO invocation with up to 15 minutes of wall time**. Audio runs comfortably under that budget (6 beats × 15s ≈ 90s).

New method: `runAudioPipelineScheduled(payload)` — receives payload from the SDK scheduler, re-reads committed MDX from GitHub (keeps scheduled payloads small), calls existing `runAudioPipeline`. If MDX is missing (piece was deleted), logs an observer failure and exits cleanly.

Same change applied to `retryAudio`: validates inputs synchronously (so admin sees bad-date errors immediately), then schedules the audio work on an alarm. `retryAudioFresh` cascades through `retryAudio` so it inherits the schedule.

**Why Phase F and Phase G aren't wasted work:**

- **Phase F chunking** still lets the producer resume cleanly from partial prior runs via R2 head-check skip. Safer retry semantics, cross-chunk `request_id` stitching from D1.
- **Phase G keepAlive** stays on `triggerDailyPiece` + `retryAudioFresh`. Not the primary mechanism, but harmless; it protects shorter stretches of work (text phase alone is ~107s) and costs nothing when the DO isn't near the eviction boundary.

**Alternatives considered:**

- **`keepAliveWhile` helper + longer CPU limits.** Research agent suggested using `keepAliveWhile` instead of manual try/finally. Same result — still bound by the "compute between incoming requests" rule even if CPU is raised to 5min via `limits.cpu_ms`. The rule is about incoming request cadence, not CPU budget.
- **Split audio into per-beat alarms** (one alarm per beat). Overkill — single alarm invocation has 15 minutes, more than enough for 12 beats. Adds scheduling overhead without benefit.
- **Have `/audio-retry` call the alarm handler directly via fetch.** The SDK's `schedule()` does this cleanly already; no reason to reinvent it.
- **Use `runFiber` for automatic checkpointing + recovery.** Tempting (it uses `keepAlive` + `cf_agents_runs` for resumable work) but adds complexity we don't need — our audio work is already resumable via R2 head-check skip. Save `runFiber` for work with non-idempotent state.

**Reason — why we hit this specifically for audio and not text:** Text phase's work is dominated by Claude API calls via the Anthropic SDK, each of which is one outbound fetch. Between calls, Director does short logic (parse response, log step). The pattern of "call → await → short sync work → next call" keeps the DO regularly yielding, and Cloudflare's eviction heuristic apparently gives leeway to that shape. Audio's work is dominated by ElevenLabs fetches + R2 puts + D1 inserts — similar shape, but by the time audio starts, we've already burned most of the compute-between-requests budget on text. The issue is cumulative, not about audio being structurally different.

**Lesson for next time:** When a platform behavior doesn't match a plausible reading of the SDK docs, pull the actual platform docs before shipping another fix. Two wrong fixes (Phase F chunking, Phase G keepAlive) preceded the one that reads the platform limits page. Total cost: two CI cycles and one user retry cycle. Verifying the platform doc would have taken 5 minutes.

**Verified:** `npx tsc --noEmit` clean; `pnpm build` passes. End-to-end verification in Phase H.5 via reset + fresh trigger.

**References:** [agents/src/director.ts](../agents/src/director.ts) (runAudioPipelineScheduled + schedule(1, ...) wiring); [Cloudflare DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/); [Workers platform limits](https://developers.cloudflare.com/workers/platform/limits/).

**VERIFIED (2026-04-19 ~10:30 UTC):** Post-deploy trigger ran end-to-end in one shot. Text phase published cleanly (Voice 92/100, 1 round, 0 revisions, 6 beats, *"Why Jet Fuel Price Spikes Break Some Airlines and Not Others"*). Audio ran from the scheduled alarm invocation: generated all 6 beats totalling 9,299 characters, auditor passed, `publishAudio` committed the `audioBeats` frontmatter map (commit `6fd4466`), `has_audio = 1`. Live `/daily/2026-04-19/` shows a working `<audio-player>` (not "coming soon") + beat navigation. **Zero Continue clicks required.**

One informational artefact in the pipeline timeline: `audio-producing ✗ Durable Object reset because its code was updated.` followed immediately by a retry that succeeded. This was a deploy-during-scheduled-alarm race — the Phase H deploy propagated to the live worker between `schedule(1, ...)` and alarm fire. Cloudflare reset the DO to load the new code, the Agents SDK's scheduled-task retry absorbed the reset, second fire succeeded. Future runs (autonomous 2am UTC or manual triggers against stable code) won't show this — it's a lifecycle event tied specifically to mid-flight deploys. Also a nice demonstration that the alarm-based path is resilient to DO resets in a way the old inline path wasn't.

Post-verification cleanup: all 11 unacknowledged observer_events (3 stale escalations from 04-17/04-18 before tonight's fixes + 4 fact-check-web warnings + 4 audio-published infos) acknowledged in bulk. Dashboard inbox is clean.
