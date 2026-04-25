import { Agent } from 'agents';
import type { Env } from './types';

export interface ObserverEvent {
  id: string;
  severity: 'info' | 'warn' | 'escalation';
  title: string;
  body: string;
  context: Record<string, unknown> | null;
  piece_id: string | null;
  created_at: number;
}

interface ObserverState {
  eventCount: number;
}

/**
 * ObserverAgent — the human-facing reporter.
 * Logs events about what the agent team has been doing so
 * Zishan can review from the dashboard.
 *
 * Events are stored in D1's observer_events table.
 *
 * piece_id threading (2026-04-22, migration 0020): piece-scoped
 * helpers accept an optional trailing `pieceId` so the per-piece
 * admin deep-dive can filter events by piece_id instead of the 36h
 * day window it used to fall back to. System-level events (admin
 * settings changes, global errors) pass `null` and remain visible
 * only on the admin home feed.
 */
export class ObserverAgent extends Agent<Env, ObserverState> {
  initialState: ObserverState = { eventCount: 0 };

  /** Log a lesson being published successfully */
  async logPublished(
    source: string,
    _unused: number,
    title: string,
    voiceScore: number,
    revisionCount: number,
    commitUrl: string,
    pieceId: string | null = null,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'info',
      title: `Published: ${title}`,
      body: `"${title}" passed all gates and was committed to the repo.`,
      context: { source, voiceScore, revisionCount, commitUrl },
      piece_id: pieceId,
    });
  }

  /** Log a piece that didn't clear every gate after max revisions.
   *  Still an escalation — operator needs to know — but phrased
   *  neutrally. The piece publishes anyway with a tier label. */
  async logEscalation(
    source: string,
    _unused: number,
    title: string,
    voiceScore: number,
    rounds: number,
    failedGates: string[],
    pieceId: string | null = null,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'escalation',
      title: `Escalation: ${title}`,
      body: `"${title}" didn't clear all gates after ${rounds} revision rounds. Unresolved: ${failedGates.join(', ')}. Published with voice ${voiceScore}/100; worth a manual look.`,
      context: { source, voiceScore, rounds, failedGates },
      piece_id: pieceId,
    });
  }

  /** Log a pipeline error. pieceId is optional — many error paths
   *  fire before a pieceId is allocated (Scanner returned zero, DB
   *  contention in Director setup). Pass null or omit in those cases. */
  async logError(
    source: string,
    _unused: number,
    error: string,
    pieceId: string | null = null,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'warn',
      title: `Error: ${source}`,
      body: `Pipeline error: ${error}`,
      context: { source, error },
      piece_id: pieceId,
    });
  }

  /** Daily run entered triggerDailyPiece, passed Phase 3's hourly
   *  cadence gate, but found a piece already published within the
   *  current slot window. Expected protective behaviour when a cron
   *  slot is re-dispatched (same-hour double-fire, SDK oddity, or
   *  manual replay); info severity — nothing broke. Makes the skip
   *  visible in the admin feed so "where did that run go?" has an
   *  answer. Replaces the prior silent `return null`.
   *
   *  piece_id is the EXISTING piece that's already in the slot — the
   *  skip is about that piece, so attributing it there is correct. */
  async logDailyRunSkipped(
    date: string,
    intervalHours: number,
    slotStartMs: number,
    existingPieceId: string,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'info',
      title: `Daily run skipped — slot already published`,
      body: `Slot starting ${new Date(slotStartMs).toISOString()} (interval_hours=${intervalHours}) already has piece ${existingPieceId} for date ${date}. No action needed.`,
      context: { date, intervalHours, slotStartMs, existingPieceId, reason: 'slot_already_published' },
      piece_id: existingPieceId,
    });
  }

  /** Audio landed — text + audio both live. Info severity, no action
   *  needed. Fires AFTER publisher.publishAudio second commit. */
  async logAudioPublished(
    date: string,
    title: string,
    beatCount: number,
    totalCharacters: number,
    commitUrl: string,
    pieceId: string | null = null,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'info',
      title: `Audio published: ${title}`,
      body: `Audio for "${title}" landed in ${beatCount} beats (${totalCharacters} chars). Commit: ${commitUrl}`,
      context: { date, beatCount, totalCharacters, commitUrl },
      piece_id: pieceId,
    });
  }

  /** Post-publish producer learnings analysis failed. Non-retriable —
   *  the piece is already live, a missed batch of learnings isn't
   *  catastrophic, and we don't want defensive retry logic. Surfaced
   *  as a warn (not escalation) because nothing downstream breaks. */
  async logLearnerFailure(
    date: string,
    title: string,
    reason: string,
    pieceId: string | null = null,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'warn',
      title: `Post-publish learnings missed: ${title}`,
      body: `Producer-side analysis failed for "${title}" (${date}). Reason: ${reason}. The piece is live; the loop just missed one iteration.`,
      context: { date, reason },
      piece_id: pieceId,
    });
  }

  /** Post-publish producer analysis produced more learnings than the
   *  cap allows (currently 10). Logged for visibility — usually a
   *  signal that the analysis restated one pattern multiple ways. */
  async logLearnerOverflow(
    date: string,
    title: string,
    written: number,
    overflowCount: number,
    pieceId: string | null = null,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'warn',
      title: `Learning overflow: ${title}`,
      body: `Post-publish analysis for "${title}" produced ${written + overflowCount} learnings; wrote ${written}, dropped ${overflowCount}. Usually means the analysis restated the same pattern multiple ways — worth a look if it keeps happening.`,
      context: { date, written, overflowCount },
      piece_id: pieceId,
    });
  }

  /** Self-reflection call ran — one metered info event per run so we
   *  can spot cost/latency drift before it matters. This is the one
   *  Sonnet call in the pipeline that doesn't gate anything, so
   *  visibility is the whole point: no hard cap, just a breadcrumb. */
  async logReflectionMetered(
    date: string,
    title: string,
    metrics: {
      written: number;
      overflowCount: number;
      considered: number;
      tokensIn: number;
      tokensOut: number;
      durationMs: number;
    },
    pieceId: string | null = null,
  ): Promise<void> {
    const overflowNote =
      metrics.overflowCount > 0
        ? ` Overflow: ${metrics.overflowCount} dropped (cap 10).`
        : '';
    await this.writeEvent({
      severity: 'info',
      title: `Reflection: ${title}`,
      body: `Self-reflection for "${title}" (${date}) produced ${metrics.considered} bullets, wrote ${metrics.written}.${overflowNote} Tokens: in=${metrics.tokensIn} out=${metrics.tokensOut}. Latency: ${metrics.durationMs}ms.`,
      context: { date, ...metrics },
      piece_id: pieceId,
    });
  }

  /** Zita synthesis ran — one metered info event per run so we can
   *  spot cost/latency drift before it matters. Same shape as
   *  logReflectionMetered. Fires on both skipped and written paths —
   *  the skipped path is informational (no Claude call happened) but
   *  worth a breadcrumb so "is the P1.5 schedule firing?" has a
   *  visible answer. */
  async logZitaSynthesisMetered(
    date: string,
    title: string,
    metrics: {
      skipped: boolean;
      userMsgCount: number;
      written: number;
      overflowCount: number;
      considered: number;
      tokensIn: number;
      tokensOut: number;
      durationMs: number;
    },
    pieceId: string | null = null,
  ): Promise<void> {
    if (metrics.skipped) {
      await this.writeEvent({
        severity: 'info',
        title: `Zita synthesis skipped: ${title}`,
        body: `Reader Q&A synthesis for "${title}" (${date}) skipped — only ${metrics.userMsgCount} reader message${metrics.userMsgCount === 1 ? '' : 's'}, threshold is 5. No Claude call fired. Latency: ${metrics.durationMs}ms (DB only).`,
        context: { date, ...metrics },
        piece_id: pieceId,
      });
      return;
    }
    const overflowNote =
      metrics.overflowCount > 0
        ? ` Overflow: ${metrics.overflowCount} dropped (cap 10).`
        : '';
    await this.writeEvent({
      severity: 'info',
      title: `Zita synthesis: ${title}`,
      body: `Reader Q&A synthesis for "${title}" (${date}) considered ${metrics.userMsgCount} reader messages, produced ${metrics.considered} bullets, wrote ${metrics.written}.${overflowNote} Tokens: in=${metrics.tokensIn} out=${metrics.tokensOut}. Latency: ${metrics.durationMs}ms.`,
      context: { date, ...metrics },
      piece_id: pieceId,
    });
  }

  /** Zita synthesis call failed — non-retriable by design, worth a
   *  warn so the admin feed knows this day's reader-signal got
   *  dropped. Same posture as logLearnerFailure / logReflectionFailure. */
  async logZitaSynthesisFailure(
    date: string,
    title: string,
    reason: string,
    pieceId: string | null = null,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'warn',
      title: `Zita synthesis missed: ${title}`,
      body: `Reader Q&A synthesis failed for "${title}" (${date}). Reason: ${reason}. The piece is live; the loop just missed one iteration.`,
      context: { date, reason },
      piece_id: pieceId,
    });
  }

  /** Self-reflection call failed — non-retriable by design, but worth
   *  a warn so the admin feed knows the loop missed an iteration. */
  async logReflectionFailure(
    date: string,
    title: string,
    reason: string,
    pieceId: string | null = null,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'warn',
      title: `Reflection missed: ${title}`,
      body: `Self-reflection failed for "${title}" (${date}). Reason: ${reason}. The piece is live; the loop just missed one iteration.`,
      context: { date, reason },
      piece_id: pieceId,
    });
  }

  /** Categoriser call ran — one metered info event per run so cost
   *  drift is visible over time. Same shape as logReflectionMetered
   *  and logZitaSynthesisMetered. Fires on both skipped and written
   *  paths — the skipped path (piece already categorised, idempotent
   *  re-run) logs no Claude call but still leaves a breadcrumb so
   *  "did the categoriser run?" has a visible answer.
   *
   *  Skipped path also surfaces the existing assignments (added
   *  2026-04-25) so an admin looking at the feed can tell at a glance
   *  whether the rows are correct or whether a buggy prior run wrote
   *  them. Without this, a deploy-during-pipeline race that loses the
   *  original "Categorised:" success log would leave the operator
   *  reading "Categorisation skipped" with no way to know what's
   *  actually attached. */
  async logCategoriserMetered(
    date: string,
    title: string,
    metrics: {
      skipped: boolean;
      assignmentsWritten: number;
      novelCategoriesCreated: number;
      novelCategoryNames: string[];
      considered: number;
      tokensIn: number;
      tokensOut: number;
      durationMs: number;
      existingAssignments?: Array<{ name: string; slug: string; confidence: number }>;
    },
    pieceId: string | null = null,
  ): Promise<void> {
    if (metrics.skipped) {
      const existing = metrics.existingAssignments ?? [];
      const existingNote = existing.length > 0
        ? ` Already assigned to: ${existing.map((a) => `${a.name} (${a.confidence}%)`).join(', ')}.`
        : ' No existing assignments visible (race or stale state).';
      await this.writeEvent({
        severity: 'info',
        title: `Categorisation skipped: ${title}`,
        body: `"${title}" (${date}) already has categories. No Claude call fired.${existingNote} Latency: ${metrics.durationMs}ms (DB only).`,
        context: { date, ...metrics },
        piece_id: pieceId,
      });
      return;
    }
    const novelNote = metrics.novelCategoriesCreated > 0
      ? ` Created ${metrics.novelCategoriesCreated} new categor${metrics.novelCategoriesCreated === 1 ? 'y' : 'ies'}: ${metrics.novelCategoryNames.join(', ')}.`
      : '';
    await this.writeEvent({
      severity: 'info',
      title: `Categorised: ${title}`,
      body: `"${title}" (${date}) assigned to ${metrics.assignmentsWritten} categor${metrics.assignmentsWritten === 1 ? 'y' : 'ies'} (considered ${metrics.considered}).${novelNote} Tokens: in=${metrics.tokensIn} out=${metrics.tokensOut}. Latency: ${metrics.durationMs}ms.`,
      context: { date, ...metrics },
      piece_id: pieceId,
    });
  }

  /** Categoriser call failed — non-retriable by design, worth a warn
   *  so the admin feed knows the piece missed its category
   *  assignments. The piece is live; a missed categorisation isn't
   *  catastrophic — the library filter just won't surface this piece
   *  under a category until the seed script or a manual admin run
   *  retags it. Same posture as logLearnerFailure /
   *  logReflectionFailure / logZitaSynthesisFailure. */
  async logCategoriserFailure(
    date: string,
    title: string,
    reason: string,
    pieceId: string | null = null,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'warn',
      title: `Categorisation missed: ${title}`,
      body: `Categoriser failed for "${title}" (${date}). Reason: ${reason}. The piece is live; it'll just miss category assignments until a manual retag.`,
      context: { date, reason },
      piece_id: pieceId,
    });
  }

  /** InteractiveGenerator ran — four terminal states:
   *  - skipped:                    piece already has interactive_id (idempotent re-run)
   *  - declined:                   Claude returned empty shape (concept redundant)
   *  - committed (clean):          a round passed; quality_flag NULL; info severity
   *  - committed (max-fail → low): 3 rounds failed; last attempt shipped with
   *                                quality_flag='low'; warn severity (operator
   *                                may want to retry for a cleaner quiz, but
   *                                readers can already use what shipped).
   *  Info severity on skipped / declined / committed-clean; warn on the
   *  committed-low path. (2026-04-24 reversal of 4.5's abandon-on-max-fail.)
   *  Mirrors logCategoriserMetered extended for the audit loop. */
  async logInteractiveGeneratorMetered(
    date: string,
    title: string,
    metrics: {
      skipped: boolean;
      declined: boolean;
      committed: boolean;
      auditorMaxFailed: boolean;
      interactiveId: string | null;
      slug: string | null;
      quizTitle: string | null;
      concept: string | null;
      questionCount: number;
      revisionCount: number;
      roundsUsed: number;
      voiceScore: number | null;
      finalAudit: {
        voicePassed: boolean;
        voiceScore: number;
        structurePassed: boolean;
        essencePassed: boolean;
        factualPassed: boolean;
        topIssues: string[];
      } | null;
      tokensIn: number;
      tokensOut: number;
      durationMs: number;
    },
    pieceId: string | null = null,
  ): Promise<void> {
    if (metrics.skipped) {
      await this.writeEvent({
        severity: 'info',
        title: `Interactive skipped: ${title}`,
        body: `"${title}" (${date}) already has an interactive (${metrics.interactiveId}). No Claude call fired. Latency: ${metrics.durationMs}ms (DB only).`,
        context: { date, ...metrics },
        piece_id: pieceId,
      });
      return;
    }
    if (metrics.declined) {
      await this.writeEvent({
        severity: 'info',
        title: `Interactive declined: ${title}`,
        body: `Generator declined to produce a quiz for "${title}" (${date}) — concept likely too redundant with recent interactives. Rounds used: ${metrics.roundsUsed}. Tokens: in=${metrics.tokensIn} out=${metrics.tokensOut}. Latency: ${metrics.durationMs}ms.`,
        context: { date, ...metrics },
        piece_id: pieceId,
      });
      return;
    }
    // Committed path — two sub-shapes:
    //   (a) auditorMaxFailed=false: clean pass, info severity.
    //   (b) auditorMaxFailed=true:  3 rounds failed audit; last attempt
    //       shipped with quality_flag='low'. Warn severity — operator
    //       may want to retry for a cleaner quiz, but readers can
    //       already use what shipped. (2026-04-24 reversal of 4.5's
    //       abandon-on-max-fail.)
    const voiceNote = metrics.voiceScore !== null ? ` Voice ${metrics.voiceScore}/100.` : '';
    const revisionNote = metrics.revisionCount > 0 ? ` (${metrics.revisionCount} revision${metrics.revisionCount === 1 ? '' : 's'})` : '';
    if (metrics.auditorMaxFailed) {
      const gates = metrics.finalAudit
        ? [
            metrics.finalAudit.voicePassed ? null : `voice (${metrics.finalAudit.voiceScore}/100)`,
            metrics.finalAudit.structurePassed ? null : 'structure',
            metrics.finalAudit.essencePassed ? null : 'essence',
            metrics.finalAudit.factualPassed ? null : 'factual',
          ]
            .filter((x): x is string => x !== null)
            .join(', ')
        : 'unknown';
      const issuesLine = metrics.finalAudit?.topIssues.length
        ? ` Top issues: ${metrics.finalAudit.topIssues.map((i) => `"${i}"`).join('; ')}.`
        : '';
      await this.writeEvent({
        severity: 'warn',
        title: `Interactive shipped (flagged low): ${title}`,
        body: `Generator for "${title}" (${date}) exhausted ${metrics.roundsUsed} rounds without passing audit but SHIPPED the last attempt with quality_flag='low' → "${metrics.quizTitle}" (${metrics.questionCount} questions, /interactives/${metrics.slug}/). Failed gates (final round): ${gates}.${issuesLine} Readers see it with a "Rough" tier tag; admin UI marks FLAGGED LOW. Retry via /interactive-generate-trigger or admin Retry button for a cleaner quiz. Tokens: in=${metrics.tokensIn} out=${metrics.tokensOut}. Latency: ${metrics.durationMs}ms.`,
        context: { date, ...metrics },
        piece_id: pieceId,
      });
      return;
    }
    await this.writeEvent({
      severity: 'info',
      title: `Interactive generated: ${title}`,
      body: `"${title}" (${date}) → "${metrics.quizTitle}" (${metrics.questionCount} questions, /interactives/${metrics.slug}/).${revisionNote} Concept: ${metrics.concept}.${voiceNote} Tokens: in=${metrics.tokensIn} out=${metrics.tokensOut}. Latency: ${metrics.durationMs}ms.`,
      context: { date, ...metrics },
      piece_id: pieceId,
    });
  }

  /** InteractiveGenerator failed — non-retriable. Piece stays live
   *  without an interactive; operator can hit the trigger endpoint
   *  to retry after fixing the underlying cause. Same posture as
   *  logCategoriserFailure / logReflectionFailure. */
  async logInteractiveGeneratorFailure(
    date: string,
    title: string,
    reason: string,
    pieceId: string | null = null,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'warn',
      title: `Interactive generation failed: ${title}`,
      body: `InteractiveGenerator failed for "${title}" (${date}). Reason: ${reason}. The piece is live; retry from admin or via /interactive-generate-trigger once the cause is fixed.`,
      context: { date, reason },
      piece_id: pieceId,
    });
  }

  /** Audio pipeline failed somewhere — text is already live, admin
   *  needs to know so they can retry. Escalation severity so it
   *  surfaces in the admin feed next to low-quality publishes. */
  async logAudioFailure(
    date: string,
    title: string,
    phase: 'producer' | 'auditor' | 'publisher',
    reason: string,
    pieceId: string | null = null,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'escalation',
      title: `Audio failure: ${title}`,
      body: `Audio ${phase} failed for "${title}" on ${date}. Text is already live. Reason: ${reason}. Retry from admin dashboard.`,
      context: { date, phase, reason },
      piece_id: pieceId,
    });
  }

  /** Get recent events for the dashboard */
  async getRecentEvents(limit = 20): Promise<ObserverEvent[]> {
    try {
      const result = await this.env.DB
        .prepare('SELECT * FROM observer_events ORDER BY created_at DESC LIMIT ?')
        .bind(limit)
        .all<ObserverEvent>();
      return result.results;
    } catch {
      return [];
    }
  }

  /** Get daily digest summary */
  async getDailyDigest(): Promise<{
    published: number;
    escalated: number;
    errors: number;
    events: ObserverEvent[];
  }> {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    try {
      const result = await this.env.DB
        .prepare('SELECT * FROM observer_events WHERE created_at > ? ORDER BY created_at DESC')
        .bind(oneDayAgo)
        .all<ObserverEvent>();

      const events = result.results;
      return {
        published: events.filter((e) => e.severity === 'info').length,
        escalated: events.filter((e) => e.severity === 'escalation').length,
        errors: events.filter((e) => e.severity === 'warn').length,
        events,
      };
    } catch {
      return { published: 0, escalated: 0, errors: 0, events: [] };
    }
  }

  private async writeEvent(event: Omit<ObserverEvent, 'id' | 'created_at'>): Promise<void> {
    const id = crypto.randomUUID();
    const now = Date.now();

    try {
      await this.env.DB
        .prepare(
          `INSERT INTO observer_events (id, severity, title, body, context, piece_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          event.severity,
          event.title,
          event.body,
          JSON.stringify(event.context),
          event.piece_id ?? null,
          now,
        )
        .run();

      this.setState({ eventCount: this.state.eventCount + 1 });
    } catch {
      // Don't let observer logging break the pipeline
    }
  }
}
