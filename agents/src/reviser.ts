import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './types';
import { VOICE_CONTRACT } from './shared/voice-contract';
import type { UnderperformingLesson } from './engagement-analyst';

export interface RevisionProposal {
  lessonId: string;
  problem: string;
  proposedChanges: string[];
  revisedMdx: string | null; // null if only proposing, not rewriting
}

interface ReviserState {
  proposalCount: number;
}

/**
 * ReviserAgent — takes engagement signals and proposes lesson revisions.
 * Analyses WHY a lesson underperforms (drop-off beat, low completion)
 * and suggests specific improvements.
 *
 * Can either propose changes (for human review) or generate a revised
 * draft that goes back through the audit pipeline.
 */
export class ReviserAgent extends Agent<Env, ReviserState> {
  initialState: ReviserState = { proposalCount: 0 };

  /** Propose revisions for an underperforming lesson */
  async proposeRevision(
    lessonData: UnderperformingLesson,
    currentMdx: string,
  ): Promise<RevisionProposal> {
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 8000,
      system: `You are the Reviser agent for Zeemish. Your job is to improve underperforming lessons based on engagement data.

${VOICE_CONTRACT}

Given engagement signals (completion rate, drop-off beat), analyse WHY the lesson might be losing readers and produce a REVISED version.

Common problems and fixes:
- Low completion + drop-off at hook → Hook isn't compelling enough. Make it more specific and surprising.
- Drop-off at teaching beats → Too long, too dense, or too abstract. Shorten, add concrete examples, break into smaller beats.
- Drop-off at practice → Practice is too demanding or unclear. Simplify or make optional.
- Overall low completion → Lesson may not be interesting enough on its topic. Consider a different angle.

Return the COMPLETE revised MDX file. Start with --- frontmatter.`,
      messages: [
        {
          role: 'user',
          content: `## Engagement data
- Completion rate: ${lessonData.completionRate}%
- Views: ${lessonData.views}
- Drop-off beat: ${lessonData.dropOffBeat ?? 'unknown'}
- Problem: ${lessonData.reason}

## Current lesson MDX:

${currentMdx}

## Your task
Revise this lesson to improve engagement. Return the complete revised MDX.`,
        },
      ],
    });

    const revisedMdx = response.content[0].type === 'text' ? response.content[0].text : null;

    this.setState({ proposalCount: this.state.proposalCount + 1 });

    return {
      lessonId: lessonData.lessonId,
      problem: lessonData.reason,
      proposedChanges: [
        `Completion rate was ${lessonData.completionRate}%`,
        lessonData.dropOffBeat ? `Readers dropping off at: ${lessonData.dropOffBeat}` : 'General low engagement',
        'Revised content generated',
      ],
      revisedMdx,
    };
  }
}
