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
    newsSource: z.string().optional(),
    underlyingSubject: z.string().optional(),
    estimatedTime: z.coerce.string(),
    beatCount: z.number(),
    description: z.string(),
    audioSrc: z.string().optional(),
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
