import { AgentWorkflow } from 'agents/workflows';
import type { AgentWorkflowEvent, AgentWorkflowStep } from 'agents/workflows';
import type { DirectorAgent } from '../director';
import type { LessonBrief, DraftResult } from '../types';

interface PublishLessonParams {
  courseSlug: string;
  lessonNumber: number;
  courseTitle: string;
  existingLessons: string[];
}

/**
 * PublishLessonWorkflow — durable multi-step pipeline for lesson production.
 *
 * Each step is a checkpoint. If the Worker restarts mid-pipeline,
 * execution resumes from the last completed step.
 *
 * Steps:
 * 1. Curate (plan the lesson)
 * 2. Draft (write MDX)
 * 3. Audit (voice + structure + facts in parallel)
 * 4. Revise (if gates fail, up to 3 rounds)
 * 5. Generate audio
 * 6. Publish (commit to GitHub)
 */
export class PublishLessonWorkflow extends AgentWorkflow<DirectorAgent, PublishLessonParams> {
  async run(
    event: AgentWorkflowEvent<PublishLessonParams>,
    step: AgentWorkflowStep,
  ) {
    const { courseSlug, lessonNumber, courseTitle, existingLessons } = event.payload;

    await this.reportProgress({ stage: 'curating' });

    // Step 1: Curate
    const brief = await step.do('curate-lesson', {
      retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' },
      timeout: '3 minutes',
    }, async () => {
      const director = this.agent;
      return await director.curateLessonStep(courseSlug, courseTitle, lessonNumber, existingLessons);
    });

    await this.reportProgress({ stage: 'drafting' });

    // Step 2: Draft
    const draft = await step.do('draft-lesson', {
      retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' },
      timeout: '5 minutes',
    }, async () => {
      const director = this.agent;
      return await director.draftLessonStep(brief);
    });

    // Step 3-4: Audit + revise loop (up to 3 rounds)
    let currentMdx = draft.mdx;
    let passed = false;

    for (let round = 1; round <= 3; round++) {
      await this.reportProgress({ stage: 'auditing', round });

      const auditResult = await step.do(`audit-round-${round}`, {
        timeout: '3 minutes',
      }, async () => {
        const director = this.agent;
        return await director.auditLessonStep(currentMdx, `${courseSlug}/lesson-${lessonNumber}`, round);
      });

      if (auditResult.allPassed) {
        passed = true;
        break;
      }

      if (round < 3) {
        await this.reportProgress({ stage: 'revising', round });

        const revised = await step.do(`revise-round-${round}`, {
          timeout: '5 minutes',
        }, async () => {
          const director = this.agent;
          return await director.reviseLessonStep(currentMdx, auditResult);
        });

        currentMdx = revised;
      }
    }

    if (!passed) {
      await this.reportProgress({ stage: 'escalated' });
      return { published: false, reason: 'Failed after 3 revision rounds' };
    }

    // Step 5: Audio
    await this.reportProgress({ stage: 'generating_audio' });
    await step.do('generate-audio', {
      retries: { limit: 1, delay: '30 seconds' },
      timeout: '10 minutes',
    }, async () => {
      const director = this.agent;
      return await director.generateAudioStep(brief, currentMdx);
    });

    // Step 6: Publish
    await this.reportProgress({ stage: 'publishing' });
    const publishResult = await step.do('publish', {
      timeout: '2 minutes',
    }, async () => {
      const director = this.agent;
      return await director.publishStep(brief, currentMdx);
    });

    await this.reportProgress({ stage: 'complete' });

    return {
      published: true,
      title: brief.title,
      commitUrl: publishResult.commitUrl,
    };
  }
}
