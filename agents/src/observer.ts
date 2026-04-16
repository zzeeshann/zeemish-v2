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
    courseSlug: string,
    lessonNumber: number,
    title: string,
    voiceScore: number,
    revisionCount: number,
    commitUrl: string,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'info',
      title: `Published: ${title}`,
      body: `Lesson ${lessonNumber} of "${courseSlug}" passed all gates (voice: ${voiceScore}/100, ${revisionCount} revision${revisionCount !== 1 ? 's' : ''}) and was committed to the repo.`,
      context: { courseSlug, lessonNumber, voiceScore, revisionCount, commitUrl },
    });
  }

  /** Log a lesson that failed after max revisions */
  async logEscalation(
    courseSlug: string,
    lessonNumber: number,
    title: string,
    voiceScore: number,
    rounds: number,
    failedGates: string[],
  ): Promise<void> {
    await this.writeEvent({
      severity: 'escalation',
      title: `Escalation: ${title}`,
      body: `Lesson ${lessonNumber} of "${courseSlug}" failed after ${rounds} revision rounds. Failed gates: ${failedGates.join(', ')}. Voice score: ${voiceScore}/100. Needs manual review.`,
      context: { courseSlug, lessonNumber, voiceScore, rounds, failedGates },
    });
  }

  /** Log a pipeline error */
  async logError(
    courseSlug: string,
    lessonNumber: number,
    error: string,
  ): Promise<void> {
    await this.writeEvent({
      severity: 'warn',
      title: `Error: ${courseSlug}/lesson-${lessonNumber}`,
      body: `Pipeline error: ${error}`,
      context: { courseSlug, lessonNumber, error },
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
