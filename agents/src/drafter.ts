import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env, LessonBrief, DraftResult } from './types';
import { DRAFTER_SYSTEM_PROMPT, buildDrafterPrompt } from './shared/prompts';

interface DrafterState {
  lastDraft: DraftResult | null;
}

/**
 * DrafterAgent — writes complete lesson MDX from a brief.
 * Takes a lesson brief + voice contract → produces MDX content.
 */
export class DrafterAgent extends Agent<Env, DrafterState> {
  initialState: DrafterState = { lastDraft: null };

  async writeDraft(brief: LessonBrief, voiceContract: string): Promise<DraftResult> {
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 8000,
      system: DRAFTER_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildDrafterPrompt(brief, voiceContract),
        },
      ],
    });

    const mdx = response.content[0].type === 'text' ? response.content[0].text : '';
    const tokensUsed = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

    const result: DraftResult = {
      mdx,
      brief,
      model: 'claude-sonnet-4-5-20250929',
      tokensUsed,
    };

    this.setState({ lastDraft: result });
    return result;
  }
}
