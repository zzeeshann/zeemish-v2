/**
 * Audit tier — the single reader-facing quality signal.
 *
 * Every published piece gets one word: polished, solid, or rough.
 * Derived from the voice auditor's 0-100 score (the only numeric gate —
 * structure and facts are booleans).
 *
 * The 85 threshold is the VoiceAuditor pass bar (voice-auditor.ts). Pieces
 * above it passed cleanly. Pieces between 70-84 are below the bar but
 * readable; 'solid' flags that honestly without scolding. Below 70 is
 * noticeably rough but we still publish because daily cadence matters more
 * than perfection — 'rough' lets the reader calibrate.
 *
 * Fallbacks (in order):
 *   - voiceScore present → tier by threshold
 *   - voiceScore missing + qualityFlag='low' → 'rough' (catches pre-plumbing low pieces)
 *   - voiceScore missing + no flag → 'polished' (historical pieces that passed)
 */

export type AuditTier = 'polished' | 'solid' | 'rough';

export function auditTier(
  voiceScore: number | null | undefined,
  qualityFlag?: 'low' | null,
): AuditTier {
  if (voiceScore == null) return qualityFlag === 'low' ? 'rough' : 'polished';
  if (voiceScore >= 85) return 'polished';
  if (voiceScore >= 70) return 'solid';
  return 'rough';
}

/** Capitalised for display — "Polished", "Solid", "Rough". */
export function auditTierLabel(tier: AuditTier): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}
