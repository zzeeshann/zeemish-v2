import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './types';
import { writeLearning } from './shared/learnings';
import type { UnderperformingLesson } from './engagement-analyst';

export interface EngagementLearning {
  lessonId: string;
  problem: string;
  learnings: string[];
}

interface LearnerState {
  learningsWritten: number;
}

/**
 * LearnerAgent — learns from reader behaviour to make future pieces better.
 * Does NOT revise or update published pieces. Published pieces are permanent.
 *
 * Analyses engagement patterns (completion rates, drop-off beats) and
 * writes actionable learnings to the D1 learnings table. The Drafter
 * reads these when writing new content.
 */
export class LearnerAgent extends Agent<Env, LearnerState> {
  initialState: LearnerState = { learningsWritten: 0 };

  /** Analyse an underperforming piece and extract learnings for future pieces */
  async analyseAndLearn(lessonData: UnderperformingLesson): Promise<EngagementLearning> {
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1500,
      system: `You analyse reader engagement data to extract learnings for future writing.

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
}`,
      messages: [
        {
          role: 'user',
          content: `## Underperforming piece
- Piece: ${lessonData.lessonId}
- Completion rate: ${lessonData.completionRate}%
- Views: ${lessonData.views}
- Drop-off beat: ${lessonData.dropOffBeat ?? 'unknown'}
- Problem: ${lessonData.reason}

Extract learnings for future pieces. What should the Drafter do differently next time?`,
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
    let parsed: { learnings: string[] };
    try {
      const match = text.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : { learnings: [] };
    } catch {
      parsed = { learnings: [] };
    }

    for (const learning of parsed.learnings) {
      try {
        await writeLearning(this.env.DB, 'engagement', learning, {
          source: lessonData.lessonId,
          completionRate: lessonData.completionRate,
          dropOffBeat: lessonData.dropOffBeat,
        }, 70);
      } catch { /* learning write shouldn't break */ }
    }

    this.setState({ learningsWritten: this.state.learningsWritten + parsed.learnings.length });

    return {
      lessonId: lessonData.lessonId,
      problem: lessonData.reason,
      learnings: parsed.learnings,
    };
  }
}
