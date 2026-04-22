/**
 * Shared types + teaser-count helper for the "How this was made" drawer.
 *
 * The endpoint is src/pages/api/daily/[date]/made.ts.
 * The drawer is src/components/MadeBy.astro + src/interactive/made-drawer.ts.
 *
 * Keep types in one place so the server endpoint, the Astro component, and
 * the client-side Web Component all agree on shape.
 */

import type { AuditTier } from './audit-tier';

export interface MadePiece {
  headline: string;
  subject: string | null;
  wordCount: number | null;
  beatCount: number | null;
  voiceScore: number | null;
  tier: AuditTier;
  qualityFlag: 'low' | null;
  publishedAt: number | null;
  commitUrl: string | null;
  filePath: string | null;
}

export interface MadeTimelineStep {
  step: string;
  status: 'running' | 'done' | 'failed' | 'skipped' | string;
  t: number;
  data: Record<string, any>;
}

export interface MadeVoice {
  score: number | null;
  passed: boolean;
  violations: string[];
}

export interface MadeStructure {
  passed: boolean;
  issues: string[];
}

export interface MadeFactClaim {
  claim: string;
  status?: string;
  note?: string;
}

export interface MadeFacts {
  passed: boolean;
  claims: MadeFactClaim[];
}

export interface MadeRound {
  round: number;
  voice: MadeVoice;
  structure: MadeStructure;
  fact: MadeFacts;
}

export interface MadeCandidate {
  headline: string;
  source: string;
  category: string | null;
  summary: string | null;
  url: string | null;
  teachabilityScore: number | null;
}

export interface MadeCandidates {
  total: number;
  picked: MadeCandidate | null;
  alsoConsidered: MadeCandidate[];
}

export interface MadeAudioBeat {
  beatName: string;
  publicUrl: string;
  characterCount: number;
}

/**
 * Audio state for a published piece. Populated only if audio landed
 * (has_audio = 1 on daily_pieces + rows in daily_piece_audio). If
 * audio hasn't run yet or failed, `beats` is empty — the drawer
 * shows nothing rather than lying about the state.
 */
export interface MadeAudio {
  beats: MadeAudioBeat[];
  totalCharacters: number;
  totalSizeBytes: number | null;
  model: string | null;
  voiceId: string | null;
  generatedAt: number | null;
}

/**
 * A single learning row pinned to this piece via `learnings.piece_date`.
 * Shape matches Build 1's dashboard Memory panel — two surfaces, one
 * schema. Source is nullable to preserve pre-P1.3 orphan rows; the
 * drawer renders those under a defensive "Learning pattern" fallback
 * group (same fallback the dashboard Memory panel uses).
 */
export interface MadeLearning {
  observation: string;
  source: string | null;
  createdAt: number;
}

export interface MadeEnvelope {
  date: string;
  piece: MadePiece | null;
  timeline: MadeTimelineStep[];
  rounds: MadeRound[];
  candidates: MadeCandidates;
  audio: MadeAudio;
  learnings: MadeLearning[];
}

/**
 * Teaser counts for the "How this was made" open-affordance button.
 * Cheap single-row counts — three quick queries, no joins.
 * Called at page render time on `/daily/[date]`.
 */
export interface MadeTeaser {
  rounds: number;          // audit rounds this piece went through
  candidates: number;      // candidates Scanner surfaced for this date
  agentsOnDuty: number;    // static — the 11 non-paused agents in the pipeline
}

export async function loadMadeTeaser(
  db: D1Database,
  date: string,
  pieceId?: string | null,
): Promise<MadeTeaser> {
  const teaser: MadeTeaser = { rounds: 0, candidates: 0, agentsOnDuty: 11 };
  try {
    // Prefer piece_id scoping when available (unambiguous at
    // multi-per-day). Falls back to date-keyed at 1/day or when the
    // caller doesn't know the piece_id yet.
    const draftRows = pieceId
      ? await db
          .prepare('SELECT COUNT(DISTINCT draft_id) as n FROM audit_results WHERE piece_id = ?')
          .bind(pieceId)
          .first<{ n: number }>()
      : await db
          .prepare('SELECT COUNT(DISTINCT draft_id) as n FROM audit_results WHERE task_id = ?')
          .bind(`daily/${date}`)
          .first<{ n: number }>();
    teaser.rounds = draftRows?.n ?? 0;

    const candRows = pieceId
      ? await db
          .prepare('SELECT COUNT(*) as n FROM daily_candidates WHERE piece_id = ?')
          .bind(pieceId)
          .first<{ n: number }>()
      : await db
          .prepare('SELECT COUNT(*) as n FROM daily_candidates WHERE date = ?')
          .bind(date)
          .first<{ n: number }>();
    teaser.candidates = candRows?.n ?? 0;
  } catch {
    /* table may be empty in dev — zeros are fine */
  }
  return teaser;
}
