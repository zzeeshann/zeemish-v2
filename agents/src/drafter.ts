import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env, DrafterState, DrafterResult, DailyPieceBrief } from './types';
import { DRAFTER_PROMPT, buildDrafterPrompt } from './drafter-prompt';
import { VOICE_CONTRACT } from './shared/voice-contract';

/**
 * DrafterAgent — writes the MDX for a daily piece from a brief.
 *
 * Responsibility (one job):
 *   Given a DailyPieceBrief, produce MDX using the
 *   <lesson-shell> / <lesson-beat> format.
 *
 * Does NOT pick the story — that is Curator's job.
 * Does NOT orchestrate — that is Director's job.
 * Does NOT audit its own output — that is the auditors' job.
 *
 * Forces brief.date into the MDX frontmatter so Claude's own
 * generated date can never drift from the orchestrator's run date.
 */
export class DrafterAgent extends Agent<Env, DrafterState> {
  initialState: DrafterState = {
    status: 'idle',
    lastDraft: null,
    error: null,
  };

  async draft(brief: DailyPieceBrief): Promise<DrafterResult> {
    this.setState({ ...this.state, status: 'drafting', error: null });

    try {
      const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });

      const response = await client.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 8000,
        system: DRAFTER_PROMPT,
        messages: [{ role: 'user', content: buildDrafterPrompt(brief, VOICE_CONTRACT) }],
      });

      let mdx = response.content[0].type === 'text' ? response.content[0].text : '';
      // Force correct date in frontmatter (Claude may generate a different date)
      mdx = mdx.replace(/^(date:\s*)"?\d{4}-\d{2}-\d{2}"?/m, `$1"${brief.date}"`);
      const wordCount = mdx.split(/\s+/).length;

      this.setState({
        ...this.state,
        status: 'idle',
        lastDraft: { headline: brief.headline, date: brief.date, wordCount },
      });

      return { mdx, wordCount };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Drafter failed';
      this.setState({ ...this.state, status: 'error', error: message });
      throw err;
    }
  }

  getStatus(): DrafterState {
    return this.state;
  }
}
