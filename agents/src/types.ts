/**
 * Shared types for the Zeemish agent team.
 */

/** Cloudflare Worker environment bindings */
export interface Env {
  ANTHROPIC_API_KEY: string;
  DB: D1Database;
  DIRECTOR: DurableObjectNamespace;
  CURATOR: DurableObjectNamespace;
  DRAFTER: DurableObjectNamespace;
  VOICE_AUDITOR: DurableObjectNamespace;
  STRUCTURE_EDITOR: DurableObjectNamespace;
  FACT_CHECKER: DurableObjectNamespace;
  INTEGRATOR: DurableObjectNamespace;
  PUBLISHER: DurableObjectNamespace;
  OBSERVER: DurableObjectNamespace;
  ENGAGEMENT_ANALYST: DurableObjectNamespace;
  REVISER: DurableObjectNamespace;
  GITHUB_TOKEN: string;
}

/** A lesson brief produced by the Curator */
export interface LessonBrief {
  courseSlug: string;
  lessonNumber: number;
  title: string;
  learningObjective: string;
  hooks: string[];
  beats: BeatPlan[];
  estimatedTime: string;
}

/** Plan for a single beat within a lesson */
export interface BeatPlan {
  name: string;
  type: 'hook' | 'teaching' | 'practice' | 'close';
  description: string;
}

/** The result of a draft — MDX content */
export interface DraftResult {
  mdx: string;
  brief: LessonBrief;
  model: string;
  tokensUsed: number;
}

/** Director agent state */
export interface DirectorState {
  status: 'idle' | 'curating' | 'drafting' | 'auditing' | 'publishing' | 'error';
  currentTask: string | null;
  lastLesson: { courseSlug: string; lessonNumber: number; title: string } | null;
  error: string | null;
}

/** Subject from subject-values.json */
export interface Subject {
  slug: string;
  title: string;
  description: string;
  priority: number;
  lessons: number;
}
