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
  }),
});

export const collections = { dailyPieces };
