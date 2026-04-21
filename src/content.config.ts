import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Daily pieces collection — the primary content unit.
 * Lives in content/daily-pieces/
 * Filename format: YYYY-MM-DD-{slug}.mdx
 */
const dailyPieces = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './content/daily-pieces' }),
  schema: z.object({
    title: z.string(),
    date: z.string().or(z.date().transform((d) => d.toISOString().slice(0, 10))),
    // Unix-ms timestamp, spliced into frontmatter by Director at publish
    // time (analogous to voiceScore). Primary role: homepage + library
    // tiebreaker at multi-per-day cadence, where multiple pieces share
    // `date` — sort by publishedAt DESC gives a deterministic newest-
    // first order. Added in cadence Phase 4 (2026-04-21).
    publishedAt: z.number(),
    newsSource: z.string().optional(),
    underlyingSubject: z.string().optional(),
    estimatedTime: z.coerce.string(),
    beatCount: z.number(),
    description: z.string(),
    audioSrc: z.string().optional(),
    // Per-beat audio map: { beatName: publicUrl }. Spliced in by
    // Publisher.publishAudio (second commit) after AudioProducer +
    // AudioAuditor succeed. Missing on pieces whose audio hasn't landed
    // yet (text-first ship-and-retry) and on legacy pre-un-pause pieces.
    audioBeats: z.record(z.string(), z.string()).optional(),
    // Per-beat display-title override: { beatSlug: "Human Title" }.
    // rehype-beats prefers these over humanize(slug) at render time, so
    // acronyms and punctuation the kebab form can't express
    // (e.g. `qvcs-original-advantage` → "QVC's Original Advantage") can
    // be restored without editing the piece's body. Metadata-only
    // carve-out per the permanence rule — see DECISIONS 2026-04-19
    // "beatTitles frontmatter map for display-layer fixes".
    beatTitles: z.record(z.string(), z.string()).optional(),
    // Voice auditor's 0-100 score from the last audit round, spliced in
    // at publish time. Feeds the public-facing audit tier (polished /
    // solid / rough) via src/lib/audit-tier.ts. Optional because older
    // pieces (before this plumbing landed) don't have it.
    voiceScore: z.number().optional(),
    // Set to 'low' when Director publishes a piece that failed the
    // voice/structure/fact gates after max revisions. No longer used
    // for archive filtering (as of 2026-04-17 soften-quality pass) —
    // kept as a fallback signal for the tier helper when voiceScore
    // is missing, and for future admin/operator use.
    qualityFlag: z.enum(['low']).optional(),
  }),
});

export const collections = { dailyPieces };
