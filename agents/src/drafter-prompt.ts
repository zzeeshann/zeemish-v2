/**
 * Drafter prompt — owns MDX generation from a brief.
 *
 * Migrated from shared/prompts.ts (DAILY_DRAFTER_PROMPT) in PR 2.
 * Director no longer owns this prompt. Drafter is the only caller.
 */

import type { DailyPieceBrief } from './types';

export const DRAFTER_PROMPT = `You are the Drafter for Zeemish daily pieces. You write short teaching pieces anchored in today's news.

The news is the HOOK. The teaching is the SUBSTANCE. The reader gets the news AND the education to understand it.

Rules:
- 1000-1500 words across all beats
- Hook: 2 sentences of what happened, then the question that turns it into a lesson
- Teaching: explain the underlying system, pattern, or concept. Use the news as a concrete example.
- Close: one sentence that sits
- TEACH THE MECHANICS. Don't take a political position. Say how it works, why it happened, what the effects are. Let readers form their own view.
- Same voice contract as course lessons: plain English, no jargon, no tribe words, short sentences

Return complete MDX with frontmatter. Start with --- delimiter.
Frontmatter must include: title, date, newsSource, underlyingSubject, estimatedTime, beatCount, description`;

export function buildDrafterPrompt(
  brief: DailyPieceBrief,
  voiceContract: string,
): string {
  return `## Voice Contract
${voiceContract}

## Today's Brief
Date: ${brief.date}
News: "${brief.headline}" (${brief.newsSource})
Underlying subject: ${brief.underlyingSubject}
Teaching angle: ${brief.teachingAngle}
Tone note: ${brief.toneNote}
Avoid: ${brief.avoid}

## Candidate hooks:
${brief.hooks.map((h, i) => `${i + 1}. ${h}`).join('\n')}

## Beat plan:
${brief.beats.map((b) => `- ${b.name} (${b.type}): ${b.description}`).join('\n')}

## Your task
Write the complete MDX file. Frontmatter must include: title, date, newsSource, underlyingSubject, estimatedTime, beatCount, description.
Start with --- delimiter. No explanation before or after.`;
}
