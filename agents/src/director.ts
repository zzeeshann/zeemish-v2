import { Agent } from 'agents';
import { CuratorAgent } from './curator';
import { DrafterAgent } from './drafter';
import { VoiceAuditorAgent } from './voice-auditor';
import { StructureEditorAgent } from './structure-editor';
import { FactCheckerAgent } from './fact-checker';
import { IntegratorAgent } from './integrator';
import { PublisherAgent } from './publisher';
import { ObserverAgent } from './observer';
import { AudioProducerAgent } from './audio-producer';
import { AudioAuditorAgent } from './audio-auditor';
import type { Env, DirectorState, LessonBrief, DraftResult } from './types';
import type { PublishResult } from './publisher';
import type { AudioResult } from './audio-producer';
import type { AudioAuditResult } from './audio-auditor';
import type { VoiceAuditResult } from './voice-auditor';
import type { StructureAuditResult } from './structure-editor';
import type { FactCheckResult } from './fact-checker';

import { VOICE_CONTRACT } from './shared/voice-contract';
import subjectValuesJson from '../../content/subject-values.json';

const MAX_REVISIONS = 3;
const MAX_LESSONS_PER_DAY = 2; // spending cap — don't produce more than this per scheduled run

/** Full pipeline result with audit trail */
export interface PipelineResult {
  brief: LessonBrief;
  draft: DraftResult;
  audits: AuditRound[];
  finalMdx: string;
  revisionCount: number;
  passed: boolean;
  published: PublishResult | null;
}

interface AuditRound {
  round: number;
  voice: VoiceAuditResult;
  structure: StructureAuditResult;
  facts: FactCheckResult;
  allPassed: boolean;
}

/**
 * DirectorAgent — the top-level supervisor.
 * Orchestrates the full publishing pipeline:
 * 1. Curator plans the lesson
 * 2. Drafter writes MDX
 * 3. Three auditors review in parallel (voice, structure, facts)
 * 4. If any fail: Integrator revises, re-audit (up to 3 rounds)
 * 5. Return final MDX with full audit trail
 */
export class DirectorAgent extends Agent<Env, DirectorState> {
  initialState: DirectorState = {
    status: 'idle',
    currentTask: null,
    lastLesson: null,
    error: null,
  };

  /** Set up daily scheduled run on first activation */
  async onStart() {
    // Schedule daily autonomous run at 8am UTC
    await this.schedule('0 8 * * *', 'autonomousRun', { type: 'daily' });
  }

  /**
   * Autonomous run — called by daily schedule.
   * Looks at subject-values and gap analysis, produces the next needed lesson.
   */
  async autonomousRun() {
    const subjects = subjectValuesJson as Array<{ slug: string; title: string; lessons: number; priority: number }>;

    // Sort by priority (lower = higher priority)
    const sorted = [...subjects].sort((a, b) => a.priority - b.priority);

    let produced = 0;

    for (const subject of sorted) {
      if (produced >= MAX_LESSONS_PER_DAY) break;

      // Find how many lessons exist for this course
      const existing = await this.getExistingLessons(subject.slug);
      const nextLesson = existing.length + 1;

      // If course is incomplete, produce the next lesson
      if (nextLesson <= subject.lessons) {
        try {
          await this.triggerLesson(subject.slug, nextLesson);
          produced++;
        } catch {
          // Log error via Observer (already wired in triggerLesson)
          // Continue to next subject
        }
      }
    }
  }

  /**
   * Full pipeline: curate → draft → audit → revise → repeat.
   */
  async triggerLesson(
    courseSlug: string,
    lessonNumber: number,
  ): Promise<PipelineResult> {
    const subjects = subjectValuesJson as Array<{ slug: string; title: string; description: string }>;
    const subject = subjects.find((s) => s.slug === courseSlug);
    if (!subject) throw new Error(`Unknown course: ${courseSlug}`);

    const existingLessons = await this.getExistingLessons(courseSlug);
    const taskId = `${courseSlug}/lesson-${lessonNumber}`;

    this.setState({ status: 'curating', currentTask: taskId, error: null });

    try {
      // Step 1: Curator plans the lesson
      const curator = await this.subAgent(CuratorAgent, `curator-${courseSlug}`);
      const brief = await curator.planLesson(
        courseSlug, subject.title, lessonNumber, existingLessons, VOICE_CONTRACT,
      );

      // Step 2: Drafter writes the MDX
      this.setState({ ...this.state, status: 'drafting' });
      const drafter = await this.subAgent(DrafterAgent, `drafter-${taskId}`);
      const draft = await drafter.writeDraft(brief, VOICE_CONTRACT);

      // Step 3: Audit loop (up to MAX_REVISIONS rounds)
      let currentMdx = draft.mdx;
      const audits: AuditRound[] = [];

      for (let round = 1; round <= MAX_REVISIONS; round++) {
        this.setState({ ...this.state, status: 'auditing' });

        // Run all three auditors in parallel
        const [voiceResult, structureResult, factResult] = await Promise.all([
          (await this.subAgent(VoiceAuditorAgent, `voice-${taskId}-r${round}`)).audit(currentMdx),
          (await this.subAgent(StructureEditorAgent, `struct-${taskId}-r${round}`)).review(currentMdx),
          (await this.subAgent(FactCheckerAgent, `fact-${taskId}-r${round}`)).check(currentMdx),
        ]);

        const allPassed = voiceResult.passed && structureResult.passed && factResult.passed;
        audits.push({ round, voice: voiceResult, structure: structureResult, facts: factResult, allPassed });

        // Persist audit results to D1
        await this.saveAuditResults(taskId, round, voiceResult, structureResult, factResult);

        if (allPassed) {
          // All gates passed — done
          break;
        }

        if (round < MAX_REVISIONS) {
          // Revise and try again
          this.setState({ ...this.state, status: 'revising' });
          const integrator = await this.subAgent(IntegratorAgent, `integrator-${taskId}`);
          const revision = await integrator.revise(currentMdx, voiceResult, structureResult, factResult);
          currentMdx = revision.revisedMdx;
        }
      }

      const lastAudit = audits[audits.length - 1];
      const passed = lastAudit.allPassed;

      // Step 4: Generate audio if all text gates passed
      let audioResult: AudioResult | null = null;
      if (passed) {
        this.setState({ ...this.state, status: 'generating_audio' });
        try {
          const audioProducer = await this.subAgent(AudioProducerAgent, `audio-${taskId}`);
          audioResult = await audioProducer.generateAudio(brief, currentMdx);

          // Step 4b: Audit the audio
          const audioAuditor = await this.subAgent(AudioAuditorAgent, `audio-audit-${taskId}`);
          const audioAudit = await audioAuditor.audit(audioResult.beatAudioPaths);

          if (!audioAudit.passed) {
            // Audio failed — still publish text, just log the issue
            const observer = await this.subAgent(ObserverAgent, 'observer');
            await observer.logError(courseSlug, lessonNumber,
              `Audio audit failed: ${audioAudit.issues.map((i) => i.issue).join('; ')}`);
          }
        } catch (err) {
          // Audio failure shouldn't block text publishing
          const msg = err instanceof Error ? err.message : 'Audio generation failed';
          const observer = await this.subAgent(ObserverAgent, 'observer');
          await observer.logError(courseSlug, lessonNumber, msg);
        }
      }

      // Step 5: Publish if all text gates passed
      let published: PublishResult | null = null;
      if (passed) {
        this.setState({ ...this.state, status: 'publishing' });
        const publisher = await this.subAgent(PublisherAgent, `publisher-${taskId}`);
        published = await publisher.publish(brief, currentMdx);
      }

      // Log to D1 and Observer
      await this.logTask(courseSlug, lessonNumber, brief, draft, audits, passed);
      const observer = await this.subAgent(ObserverAgent, 'observer');
      const lastVoiceScore = audits[audits.length - 1]?.voice?.score ?? 0;

      if (passed && published) {
        await observer.logPublished(
          courseSlug, lessonNumber, brief.title,
          lastVoiceScore, audits.length - 1, published.commitUrl,
        );
      } else {
        const failedGates: string[] = [];
        const last = audits[audits.length - 1];
        if (!last.voice.passed) failedGates.push('voice');
        if (!last.structure.passed) failedGates.push('structure');
        if (!last.facts.passed) failedGates.push('facts');
        await observer.logEscalation(
          courseSlug, lessonNumber, brief.title,
          lastVoiceScore, audits.length, failedGates,
        );
      }

      this.setState({
        status: 'idle',
        currentTask: null,
        lastLesson: { courseSlug, lessonNumber, title: brief.title },
        error: passed ? null : `Failed after ${MAX_REVISIONS} revision rounds`,
      });

      return {
        brief,
        draft,
        audits,
        finalMdx: currentMdx,
        revisionCount: audits.length - 1,
        passed,
        published,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      try {
        const observer = await this.subAgent(ObserverAgent, 'observer');
        await observer.logError(courseSlug, lessonNumber, message);
      } catch { /* observer failure shouldn't mask the real error */ }
      this.setState({
        status: 'error',
        currentTask: taskId,
        error: message,
        lastLesson: this.state.lastLesson,
      });
      throw err;
    }
  }

  getStatus(): DirectorState {
    return this.state;
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/trigger' && request.method === 'POST') {
      const body = await request.json() as { courseSlug: string; lessonNumber: number };
      try {
        const result = await this.triggerLesson(body.courseSlug, body.lessonNumber);
        return new Response(JSON.stringify({
          status: result.passed ? 'success' : 'failed_audit',
          brief: result.brief,
          passed: result.passed,
          revisionCount: result.revisionCount,
          audits: result.audits.map((a) => ({
            round: a.round,
            voiceScore: a.voice.score,
            voicePassed: a.voice.passed,
            structurePassed: a.structure.passed,
            factsPassed: a.facts.passed,
            allPassed: a.allPassed,
          })),
          mdxPreview: result.finalMdx.slice(0, 500) + '...',
          mdxLength: result.finalMdx.length,
          model: result.draft.model,
          tokensUsed: result.draft.tokensUsed,
        }), { headers: { 'Content-Type': 'application/json' } });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return new Response(JSON.stringify({ error: message }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
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

  private async getExistingLessons(courseSlug: string): Promise<string[]> {
    try {
      const result = await this.env.DB
        .prepare(
          `SELECT output FROM agent_tasks
           WHERE agent_name = 'director' AND task_type = 'publish_lesson'
           AND status = 'succeeded' AND input LIKE ?
           ORDER BY created_at`,
        )
        .bind(`%"courseSlug":"${courseSlug}"%`)
        .all();

      return result.results
        .map((r: Record<string, unknown>) => {
          try { return (JSON.parse(r.output as string))?.brief?.title as string; }
          catch { return null; }
        })
        .filter((t: string | null): t is string => t !== null);
    } catch { return []; }
  }

  private async logTask(
    courseSlug: string,
    lessonNumber: number,
    brief: LessonBrief,
    draft: DraftResult,
    audits: AuditRound[],
    passed: boolean,
  ): Promise<void> {
    try {
      const id = crypto.randomUUID();
      await this.env.DB
        .prepare(
          `INSERT INTO agent_tasks (id, agent_name, task_type, status, input, output, completed_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id, 'director', 'publish_lesson',
          passed ? 'succeeded' : 'failed',
          JSON.stringify({ courseSlug, lessonNumber }),
          JSON.stringify({
            brief,
            mdxLength: draft.mdx.length,
            model: draft.model,
            tokensUsed: draft.tokensUsed,
            auditRounds: audits.length,
            passed,
          }),
          Date.now(), Date.now(),
        )
        .run();
    } catch { /* logging failure shouldn't break the pipeline */ }
  }

  /** Save audit results to D1 for durable audit trail */
  private async saveAuditResults(
    taskId: string,
    round: number,
    voice: VoiceAuditResult,
    structure: StructureAuditResult,
    facts: FactCheckResult,
  ): Promise<void> {
    const now = Date.now();
    const draftId = `${taskId}-r${round}`;
    try {
      await this.env.DB.batch([
        this.env.DB.prepare(
          'INSERT INTO audit_results (id, task_id, draft_id, auditor, passed, score, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(crypto.randomUUID(), taskId, draftId, 'voice', voice.passed ? 1 : 0, voice.score, JSON.stringify(voice.violations), now),
        this.env.DB.prepare(
          'INSERT INTO audit_results (id, task_id, draft_id, auditor, passed, score, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(crypto.randomUUID(), taskId, draftId, 'structure', structure.passed ? 1 : 0, null, JSON.stringify(structure.issues), now),
        this.env.DB.prepare(
          'INSERT INTO audit_results (id, task_id, draft_id, auditor, passed, score, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(crypto.randomUUID(), taskId, draftId, 'fact', facts.passed ? 1 : 0, null, JSON.stringify(facts.claims), now),
      ]);
    } catch { /* audit logging shouldn't break the pipeline */ }
  }
}
