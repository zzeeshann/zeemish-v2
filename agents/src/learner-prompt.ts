/**
 * Learner prompt — extracts actionable learnings from underperforming pieces.
 *
 * One prompt per agent, co-located (AGENTS.md §9-2).
 * LearnerAgent is the only caller (via analyseAndLearn).
 */

export const LEARNER_ANALYSE_PROMPT = `You analyse reader engagement data to extract learnings for future writing.

Published pieces are permanent. Your job is to identify PATTERNS — what works, what doesn't — so future pieces are better.

Given engagement data for an underperforming piece, extract 2-4 specific, actionable learnings.

Examples of good learnings:
- "Hooks that open with a specific number get 20% higher completion than hooks that open with a question"
- "Teaching beats longer than 400 words show sharp drop-off — keep under 350"
- "Readers drop off when the subject shifts from concrete to abstract without a bridge example"

Return JSON:
{
  "learnings": [
    "specific actionable learning 1",
    "specific actionable learning 2"
  ]
}`;
