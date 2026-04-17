/**
 * Shared types for the Zeemish agent team.
 */

/** Cloudflare Worker environment bindings */
export interface Env {
  ANTHROPIC_API_KEY: string;
  DB: D1Database;
  DIRECTOR: DurableObjectNamespace;
  VOICE_AUDITOR: DurableObjectNamespace;
  STRUCTURE_EDITOR: DurableObjectNamespace;
  FACT_CHECKER: DurableObjectNamespace;
  INTEGRATOR: DurableObjectNamespace;
  PUBLISHER: DurableObjectNamespace;
  OBSERVER: DurableObjectNamespace;
  LEARNER: DurableObjectNamespace;
  AUDIO_PRODUCER: DurableObjectNamespace;
  AUDIO_AUDITOR: DurableObjectNamespace;
  SCANNER: DurableObjectNamespace;
  CURATOR: DurableObjectNamespace;
  DRAFTER: DurableObjectNamespace;
  AUDIO_BUCKET: R2Bucket;
  GITHUB_TOKEN: string;
  ADMIN_SECRET: string;
  ELEVENLABS_API_KEY: string;
}

/** Plan for a single beat within a piece */
export interface BeatPlan {
  name: string;
  type: 'hook' | 'teaching' | 'practice' | 'close';
  description: string;
}

/**
 * Which pipeline phase Director is coordinating.
 * Each value names the agent currently running — Director itself only routes.
 */
export type DirectorPhase =
  | 'scanner'
  | 'curator'
  | 'drafter'
  | 'auditors'
  | 'integrator'
  | 'publisher';

/** Director agent state — pure orchestrator, no content work */
export interface DirectorState {
  status: 'idle' | 'running' | 'error';
  currentPhase: DirectorPhase | null;
  currentTask: string | null;
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

/** Curator agent state */
export interface CuratorState {
  status: 'idle' | 'curating' | 'error';
  lastBrief: { headline: string; date: string } | null;
  error: string | null;
}

/** Drafter agent state */
export interface DrafterState {
  status: 'idle' | 'drafting' | 'error';
  lastDraft: { headline: string; date: string; wordCount: number } | null;
  error: string | null;
}

/** Result of Curator picking a story (or deciding to skip) */
export type CuratorResult =
  | { skip: false; brief: DailyPieceBrief; selectedCandidateId?: string }
  | { skip: true; reason: string };

/** Result of Drafter writing MDX for a brief */
export interface DrafterResult {
  mdx: string;
  wordCount: number;
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
