# Zeemish v2 — Follow-ups Log

Append-only. One entry per known issue worth fixing later. Close via DECISIONS entry (note the FOLLOWUPS line that's now resolved). Never delete entries.

Format per entry:
- **Title** — one-line summary
- **Surfaced:** date + how it came up
- **Hypothesis:** what we think is wrong (may be incomplete)
- **Investigation hints:** where to start
- **Priority:** blocker / medium / low

---

## 2026-04-19: Publisher.publishAudio double-fires on Continue retry path

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

## 2026-04-19: Audio pipeline silent stall between alarm chunks on longer pieces

**Surfaced:** 2026-04-19 during retro audio for 2026-04-17. First retry attempt stopped at 4 of 8 beats. No `audio-failed` event in observer_events. No error logged. Alarm chain simply stopped firing. User clicked Continue and the pipeline resumed and finished cleanly.

**Hypothesis:** Even with alarm-based audio + keepAlive + Phase F chunking (2 beats per RPC, alarm-scheduled), the alarm chain can break silently between chunks on longer pieces — likely when a producer chunk + auditor + self-reschedule exceeds its wall budget but doesn't throw, so no failure event is emitted. Continue is the correct recovery path. But the lack of any signal means nobody knows the pipeline stopped until a reader notices missing audio.

**Investigation hints:**
- Add a watchdog alarm that fires N minutes after `runAudioPipelineScheduled` starts and checks whether `has_audio == 1`. If not and no `audio-*` events since the watchdog armed, emit `audio-stalled` into observer_events.
- When P1.3 ships (Learner reads producer-side signals), add a learning heuristic: `audio.beats < piece.beatCount AND zero audio-failed events within N hours of audio-started` → flag as silent stall pattern.
- Could also be the DO eviction cliff extending beyond what keepAlive's heartbeat covers under ElevenLabs latency variance — consider a longer heartbeat or doubling the keepAlive grace window.

**Priority:** Medium. Continue recovers cleanly, so no data is lost. But the silent failure mode is a class-of-bug concern: any future retry that silently stalls leaves the piece in partial state indefinitely.

---

## 2026-04-19: Title-case articles/conjunctions in humanize() or at the Drafter

**Surfaced:** 2026-04-19 during P2.1 retrofit. `humanize("what-is-a-chokepoint")` produces "What Is A Chokepoint" — the capital "A" is technically correct letter-by-letter but stylistically wrong for English title case, which lowercases articles, conjunctions, and short prepositions (under 4 letters) except when they're the first word.

**Hypothesis:** Two paths to fix, separate decision:
1. Teach `humanize()` in `src/lib/rehype-beats.ts` about English title-case rules — lowercase a short stop-word list (a, an, the, and, or, but, of, to, in, on, at, by, for, with) unless it's the first word.
2. Upgrade Drafter to write display-formatted `##` headings directly (e.g. `## What Is a Chokepoint`) so neither humanize() nor the `beatTitles` override is needed for new pieces.

Option 2 is the more durable fix — it aligns with the parallel durable fix already tracked in CLAUDE.md for the broader kebab→display lossiness (acronyms, punctuation). Option 1 is a smaller bandaid that still benefits retroactive pieces where Drafter output can't be changed.

**Investigation hints:**
- Option 1: add a stop-word list + first-word rule to `humanize()`. Kept out of today's scope because 2026-04-18 is the only current piece with the aesthetic issue and the user judged it non-corrective.
- Option 2: update `DRAFTER_PROMPT` in `agents/src/drafter-prompt.ts` to demand display-formatted `##` headings. Requires rehype-beats to keep handling non-kebab headings (it already does via `isKebabOnly` branch). Confirm downstream agents (AudioProducer, FactChecker) don't depend on kebab-case matching.

**Priority:** Low. Aesthetic, not corrective. Only affects pieces where Drafter's kebab slug uses multiple words including articles/conjunctions.

---

## 2026-04-19: Surface producer-side learnings + self-reflection in the UI

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

---

## 2026-04-19: Continue retry path may trigger full re-run instead of resuming

**Surfaced:** 2026-04-19. When combined with the Publisher double-fire bug above, the Continue button corrupted 2026-04-17's frontmatter. Observer events show producer ran twice (chunks: 4, then chunks: 1) — second run should have been a true no-op (skip producer entirely) but instead walked the full pipeline again.

**Hypothesis:** Director's `retryAudio` branch doesn't short-circuit when `has_audio == 1` or when all beats already exist in D1. It always calls `runAudioPipeline` which always calls Producer → Auditor → Publisher. Producer correctly skips generation when R2 objects are present (hence `chunks: 1` for the second call), but the downstream steps still fire.

**Investigation hints:**
- Read `agents/src/director.ts` `retryAudio` and `runAudioPipeline`. Add an early return if `piece.has_audio === 1 && all beat rows present in daily_piece_audio`.
- Alternative: make Publisher's idempotency guard strictly enforce the no-op (which it should already — see related FOLLOWUP above).
- Consider whether Continue vs Start-over should even share the same runAudioPipeline entry point. Start-over wipes and runs; Continue should resume from the last successful beat without re-triggering the publish step if nothing new was produced.

**Priority:** Medium. Paired with the Publisher double-fire, this is what corrupted 2026-04-17. Fixing either one prevents the corruption; fixing both defends in depth.
