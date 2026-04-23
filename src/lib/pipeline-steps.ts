/**
 * Shared step → human-label map for the pipeline_log feed.
 *
 * Used by both the admin pipeline monitor (live polling) and the
 * per-piece "How this was made" transparency drawer. Keeping one map
 * means labels stay consistent when the reader toggles between views
 * and when new step names are added.
 */
export const PIPELINE_STEP_LABELS: Record<string, string> = {
  scanning: 'Scanner reads the news',
  curating: 'Curator picks a story',
  drafting: 'Drafter writes the MDX',
  auditing_r1: 'Auditors review draft',
  auditing_r2: 'Auditors review revision 1',
  auditing_r3: 'Auditors review revision 2',
  revising_r1: 'Integrator revises (round 1)',
  revising_r2: 'Integrator revises (round 2)',
  publishing: 'Publisher commits to GitHub',
  'audio-producing': 'Audio Producer narrates the beats',
  'audio-auditing': 'Audio Auditor checks the files',
  'audio-publishing': 'Publisher commits the audio',
  done: 'Complete',
  error: 'Failed',
  skipped: 'Skipped',
};

export function pipelineStepLabel(step: string): string {
  return PIPELINE_STEP_LABELS[step] ?? step;
}

/**
 * Gerund/in-progress phrasing for live status lines ("Pipeline running
 * — generating audio."). The full PIPELINE_STEP_LABELS values are
 * subject-verb-object sentences that read awkwardly inside a
 * "currently in X" frame; these are composable noun-phrase equivalents.
 *
 * auditing_rN and revising_rN are generated dynamically in director.ts
 * (one per revision round), so round handling is regex-based rather
 * than requiring a map entry per round.
 */
const PIPELINE_STEP_PROGRESS: Record<string, string> = {
  scanning: 'reading the news',
  curating: "picking today's story",
  drafting: 'writing the draft',
  publishing: 'committing the piece',
  'audio-producing': 'generating audio',
  'audio-auditing': 'verifying audio',
  'audio-publishing': 'committing audio',
};

export function pipelineStepProgress(step: string): string {
  const m = step.match(/^(auditing|revising)_r(\d+)$/);
  if (m) {
    const [, verb, round] = m;
    const phrase = verb === 'auditing' ? 'running audits' : 'revising';
    return `${phrase} (round ${round})`;
  }
  return PIPELINE_STEP_PROGRESS[step] ?? step;
}
