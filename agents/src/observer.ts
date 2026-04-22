import { Agent } from 'agents';
import type { Env } from './types';

export interface ObserverEvent {
  id: string;
  severity: 'info' | 'warn' | 'escalation';
  title: string;
  body: string;
  context: Record<string, unknown> | null;
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
  ): Promise<void> {
    await this.writeEvent({
      severity: 'info',
      title: `Published: ${title}`,
      body: `"${title}" passed all gates and was committed to the repo.`,
      context: { source, voiceScore, revisionCount, commitUrl },
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
  ): Promise<void> {
    await this.writeEvent({
      severity: 'escalation',
      title: `Escalation: ${title}`,
      body: `"${title}" didn't clear all gates after ${rounds} revision rounds. Unresolved: ${failedGates.join(', ')}. Published with voice ${voiceScore}/100; worth a manual look.`,
      context: { source, voiceScore, rounds, failedGates },
    });
  }

  /** Log a pipeline error */
  async logError(
    source: string,
    _unused: number,
    error: string,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'warn',
      title: `Error: ${source}`,
      body: `Pipeline error: ${error}`,
      context: { source, error },
    });
  }

  /** Daily run entered triggerDailyPiece, passed Phase 3's hourly
   *  cadence gate, but found a piece already published within the
   *  current slot window. Expected protective behaviour when a cron
   *  slot is re-dispatched (same-hour double-fire, SDK oddity, or
   *  manual replay); info severity — nothing broke. Makes the skip
   *  visible in the admin feed so "where did that run go?" has an
   *  answer. Replaces the prior silent `return null`. */
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
  ): Promise<void> {
    await this.writeEvent({
      severity: 'info',
      title: `Audio published: ${title}`,
      body: `Audio for "${title}" landed in ${beatCount} beats (${totalCharacters} chars). Commit: ${commitUrl}`,
      context: { date, beatCount, totalCharacters, commitUrl },
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
  ): Promise<void> {
    await this.writeEvent({
      severity: 'warn',
      title: `Post-publish learnings missed: ${title}`,
      body: `Producer-side analysis failed for "${title}" (${date}). Reason: ${reason}. The piece is live; the loop just missed one iteration.`,
      context: { date, reason },
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
  ): Promise<void> {
    await this.writeEvent({
      severity: 'warn',
      title: `Learning overflow: ${title}`,
      body: `Post-publish analysis for "${title}" produced ${written + overflowCount} learnings; wrote ${written}, dropped ${overflowCount}. Usually means the analysis restated the same pattern multiple ways — worth a look if it keeps happening.`,
      context: { date, written, overflowCount },
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
  ): Promise<void> {
    if (metrics.skipped) {
      await this.writeEvent({
        severity: 'info',
        title: `Zita synthesis skipped: ${title}`,
        body: `Reader Q&A synthesis for "${title}" (${date}) skipped — only ${metrics.userMsgCount} reader message${metrics.userMsgCount === 1 ? '' : 's'}, threshold is 5. No Claude call fired. Latency: ${metrics.durationMs}ms (DB only).`,
        context: { date, ...metrics },
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
    });
  }

  /** Zita synthesis call failed — non-retriable by design, worth a
   *  warn so the admin feed knows this day's reader-signal got
   *  dropped. Same posture as logLearnerFailure / logReflectionFailure. */
  async logZitaSynthesisFailure(
    date: string,
    title: string,
    reason: string,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'warn',
      title: `Zita synthesis missed: ${title}`,
      body: `Reader Q&A synthesis failed for "${title}" (${date}). Reason: ${reason}. The piece is live; the loop just missed one iteration.`,
      context: { date, reason },
    });
  }

  /** Self-reflection call failed — non-retriable by design, but worth
   *  a warn so the admin feed knows the loop missed an iteration. */
  async logReflectionFailure(
    date: string,
    title: string,
    reason: string,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'warn',
      title: `Reflection missed: ${title}`,
      body: `Self-reflection failed for "${title}" (${date}). Reason: ${reason}. The piece is live; the loop just missed one iteration.`,
      context: { date, reason },
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
  ): Promise<void> {
    await this.writeEvent({
      severity: 'escalation',
      title: `Audio failure: ${title}`,
      body: `Audio ${phase} failed for "${title}" on ${date}. Text is already live. Reason: ${reason}. Retry from admin dashboard.`,
      context: { date, phase, reason },
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
          `INSERT INTO observer_events (id, severity, title, body, context, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, event.severity, event.title, event.body, JSON.stringify(event.context), now)
        .run();

      this.setState({ eventCount: this.state.eventCount + 1 });
    } catch {
      // Don't let observer logging break the pipeline
    }
  }
}
