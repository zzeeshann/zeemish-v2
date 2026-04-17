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
    // Set to 'low' when Director publishes a piece that failed the
    // voice/structure/fact gates after max revisions. Library and
    // dashboard archive views filter these out; the daily page still
    // renders them so the day isn't blank, with a banner explaining why.
    qualityFlag: z.enum(['low']).optional(),
  }),
});

export const collections = { dailyPieces };
