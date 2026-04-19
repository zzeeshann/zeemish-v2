/**
 * Drafter prompt — owns MDX generation from a brief.
 *
 * Migrated from shared/prompts.ts (DAILY_DRAFTER_PROMPT) in PR 2.
 * Director no longer owns this prompt. Drafter is the only caller.
 */

import type { DailyPieceBrief } from './types';
import type { Learning } from './shared/learnings';

export const DRAFTER_PROMPT = `You are the Drafter for Zeemish daily pieces. You write short teaching pieces anchored in today's news.

The news is the HOOK. The teaching is the SUBSTANCE. The reader gets the news AND the education to understand it.

Rules:
- 1000-1500 words across all beats
- Hook: 2 sentences of what happened, then the question that turns it into a lesson
- Teaching: explain the underlying system, pattern, or concept. Use the news as a concrete example.
- Close: one sentence that sits
- TEACH THE MECHANICS. Don't take a political position. Say how it works, why it happened, what the effects are. Let readers form their own view.
- Same voice contract as course lessons: plain English, no jargon, no tribe words, short sentences

## Beat format (required)
Demarcate each beat with a markdown H2 heading whose text is the kebab-case beat name from the brief:

    ## hook

    Body of hook beat...

    ## what-is-a-chokepoint

    Body of next beat...

Do NOT use JSX tags like \`<beat>\`, \`<section>\`, or custom elements. Only \`##\` headings. Downstream renderers and the audio producer both split on \`## \` — any other syntax silently breaks beat navigation and audio generation.

Return complete MDX with frontmatter. Start with --- delimiter.
Frontmatter must include: title, date, newsSource, underlyingSubject, estimatedTime, beatCount, description`;

export function buildDrafterPrompt(
  brief: DailyPieceBrief,
  voiceContract: string,
  learnings: Learning[] = [],
): string {
  // Lessons block — included only when there are learnings to show.
  // Empty on day 1 of the closed loop; the block silently absents itself
  // rather than inserting a placeholder ("No learnings yet") that would
  // dilute the prompt. Once P1.3 ships producer-side learnings, this
  // block populates automatically on every subsequent run.
  const lessonsBlock =
    learnings.length === 0
      ? ''
      : `## Lessons from prior pieces
These are patterns observed across recent Zeemish pieces — producer-side quality signals, self-reflection notes, and (once readers arrive) reader-behaviour signal. Let them shape what you write today.

${learnings.map((l) => `- [${l.category}] ${l.observation}`).join('\n')}

These lessons guide. The voice contract binds. If they conflict, the contract wins.

`;

  return `## Voice Contract
${voiceContract}

${lessonsBlock}## Today's Brief
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
