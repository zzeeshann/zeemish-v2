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
  done: 'Complete',
  error: 'Failed',
  skipped: 'Skipped',
};

export function pipelineStepLabel(step: string): string {
  return PIPELINE_STEP_LABELS[step] ?? step;
}
