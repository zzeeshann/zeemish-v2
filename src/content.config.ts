import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Courses collection — one MDX file per course with metadata.
 * Lives in content/courses/
 */
const courses = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './content/courses' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    description: z.string(),
    estimatedTotalTime: z.string(),
    lessonCount: z.number(),
  }),
});

/**
 * Lessons collection — MDX files organised by course subdirectory.
 * Lives in content/lessons/{course-slug}/
 */
const lessons = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './content/lessons' }),
  schema: z.object({
    title: z.string(),
    course: z.string(),
    lessonNumber: z.number(),
    estimatedTime: z.string(),
    beatCount: z.number(),
    description: z.string(),
    audioSrc: z.string().optional(),
  }),
});

export const collections = { courses, lessons };
