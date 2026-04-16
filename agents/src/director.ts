import { Agent } from 'agents';
import { CuratorAgent } from './curator';
import { DrafterAgent } from './drafter';
import type { Env, DirectorState, LessonBrief, DraftResult } from './types';

import { VOICE_CONTRACT } from './shared/voice-contract';
import subjectValuesJson from '../../content/subject-values.json';

/**
 * DirectorAgent — the top-level supervisor.
 * Decides what to work on, spawns Curator + Drafter, orchestrates the pipeline.
 * This is the only agent that can be triggered externally.
 */
export class DirectorAgent extends Agent<Env, DirectorState> {
  initialState: DirectorState = {
    status: 'idle',
    currentTask: null,
    lastLesson: null,
    error: null,
  };

  /**
   * Manual trigger: produce a lesson for a given course and lesson number.
   * This is the entry point for testing the pipeline end-to-end.
   */
  async triggerLesson(
    courseSlug: string,
    lessonNumber: number,
  ): Promise<{ brief: LessonBrief; draft: DraftResult }> {
    // Find the subject
    const subjects = subjectValuesJson as Array<{ slug: string; title: string; description: string }>;
    const subject = subjects.find((s) => s.slug === courseSlug);
    if (!subject) {
      throw new Error(`Unknown course: ${courseSlug}`);
    }

    // Get existing lesson titles from D1 (for context)
    const existingLessons = await this.getExistingLessons(courseSlug);

    // Update state
    this.setState({
      status: 'curating',
      currentTask: `${courseSlug}/lesson-${lessonNumber}`,
      error: null,
    });

    try {
      // Step 1: Curator plans the lesson
      const curator = await this.subAgent(CuratorAgent, `curator-${courseSlug}`);
      const brief = await curator.planLesson(
        courseSlug,
        subject.title,
        lessonNumber,
        existingLessons,
        VOICE_CONTRACT,
      );

      // Step 2: Drafter writes the MDX
      this.setState({ ...this.state, status: 'drafting' });
      const drafter = await this.subAgent(DrafterAgent, `drafter-${courseSlug}-${lessonNumber}`);
      const draft = await drafter.writeDraft(brief, VOICE_CONTRACT);

      // Log to D1 for observability
      await this.logTask(courseSlug, lessonNumber, brief, draft);

      // Update state
      this.setState({
        status: 'idle',
        currentTask: null,
        lastLesson: {
          courseSlug,
          lessonNumber,
          title: brief.title,
        },
        error: null,
      });

      return { brief, draft };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.setState({
        status: 'error',
        currentTask: `${courseSlug}/lesson-${lessonNumber}`,
        error: message,
        lastLesson: this.state.lastLesson,
      });
      throw err;
    }
  }

  /** Get status of the Director */
  getStatus(): DirectorState {
    return this.state;
  }

  /** Handle HTTP requests to the Director (trigger and status endpoints) */
  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/trigger' && request.method === 'POST') {
      const body = await request.json() as { courseSlug: string; lessonNumber: number };
      try {
        const result = await this.triggerLesson(body.courseSlug, body.lessonNumber);
        return new Response(JSON.stringify({
          status: 'success',
          brief: result.brief,
          mdxPreview: result.draft.mdx.slice(0, 500) + '...',
          mdxLength: result.draft.mdx.length,
          model: result.draft.model,
          tokensUsed: result.draft.tokensUsed,
        }), { headers: { 'Content-Type': 'application/json' } });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return new Response(JSON.stringify({ error: message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    if (url.pathname === '/status') {
      return new Response(JSON.stringify(this.getStatus()), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  }

  /** Fetch existing lesson titles from the agent_tasks log in D1 */
  private async getExistingLessons(courseSlug: string): Promise<string[]> {
    try {
      const result = await this.env.DB
        .prepare(
          `SELECT output FROM agent_tasks
           WHERE agent_name = 'director'
           AND task_type = 'publish_lesson'
           AND status = 'succeeded'
           AND input LIKE ?
           ORDER BY created_at`,
        )
        .bind(`%"courseSlug":"${courseSlug}"%`)
        .all();

      return result.results
        .map((r: Record<string, unknown>) => {
          try {
            const output = JSON.parse(r.output as string);
            return output?.brief?.title as string;
          } catch {
            return null;
          }
        })
        .filter((t: string | null): t is string => t !== null);
    } catch {
      return []; // Table might not exist yet, that's fine
    }
  }

  /** Log the completed task to D1 for observability */
  private async logTask(
    courseSlug: string,
    lessonNumber: number,
    brief: LessonBrief,
    draft: DraftResult,
  ): Promise<void> {
    try {
      const id = crypto.randomUUID();
      await this.env.DB
        .prepare(
          `INSERT INTO agent_tasks (id, agent_name, task_type, status, input, output, completed_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          'director',
          'publish_lesson',
          'succeeded',
          JSON.stringify({ courseSlug, lessonNumber }),
          JSON.stringify({ brief, mdxLength: draft.mdx.length, model: draft.model, tokensUsed: draft.tokensUsed }),
          Date.now(),
          Date.now(),
        )
        .run();
    } catch {
      // Logging failure shouldn't break the pipeline
    }
  }
}
