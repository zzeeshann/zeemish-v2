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

/** Director agent state */
export interface DirectorState {
  status: 'idle' | 'scanning' | 'curating' | 'drafting' | 'auditing' | 'revising' | 'generating_audio' | 'publishing' | 'error';
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
