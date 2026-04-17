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
  LEARNER: DurableObjectNamespace;
  AUDIO_PRODUCER: DurableObjectNamespace;
  AUDIO_AUDITOR: DurableObjectNamespace;
  AUDIO_BUCKET: R2Bucket;
  GITHUB_TOKEN: string;
  SCANNER: DurableObjectNamespace;
  ADMIN_SECRET: string;
  ELEVENLABS_API_KEY: string;
  MAX_LESSONS_PER_DAY?: string;
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
  status: 'idle' | 'scanning' | 'curating' | 'drafting' | 'auditing' | 'revising' | 'generating_audio' | 'publishing' | 'error';
  currentTask: string | null;
  lastLesson: { courseSlug: string; lessonNumber: number; title: string } | null;
  lastDailyPiece: { title: string; date: string } | null;
  error: string | null;
}

/** A daily piece brief — news-anchored teaching */
export interface DailyPieceBrief {
  date: string;
  headline: string;
  newsSource: string;
  underlyingSubject: string;
  teachingAngle: string;
  hooks: string[];
  beats: BeatPlan[];
  estimatedTime: string;
  toneNote: string;
  avoid: string;
}

/** A news candidate from the Scanner */
export interface DailyCandidate {
  id: string;
  headline: string;
  source: string;
  category: string;
  summary: string;
  url: string;
  teachabilityScore?: number;
}

/** Subject from subject-values.json */
export interface Subject {
  slug: string;
  title: string;
  description: string;
  priority: number;
  lessons: number;
}
