import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './types';
import { extractJson } from './shared/parse-json';
import { writeLearning } from './shared/learnings';
import { STRUCTURE_EDITOR_PROMPT } from './structure-editor-prompt';

export interface StructureAuditResult {
  passed: boolean;
  issues: string[];
  suggestions: string[];
}

interface StructureEditorState {
  lastResult: StructureAuditResult | null;
}

/**
 * StructureEditorAgent — reviews beat structure, pacing, length, hook, close.
 * Returns "approve" or specific revision notes.
 */
export class StructureEditorAgent extends Agent<Env, StructureEditorState> {
  initialState: StructureEditorState = { lastResult: null };

  async review(mdx: string): Promise<StructureAuditResult> {
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2000,
      system: STRUCTURE_EDITOR_PROMPT,
      messages: [{ role: 'user', content: `Review this lesson structure:\n\n${mdx}` }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const result = extractJson<StructureAuditResult>(text);

    // Write learnings — from both passing drafts (suggestions) and failing
    // drafts (issues). The learnings DB feeds Drafter's future prompts, so
    // a neutral sample matters. Failures get lower confidence (40 vs 60)
    // so they carry less weight in prompt re-tuning.
    const items = result.passed ? result.suggestions : result.issues;
    if (items.length > 0) {
      const confidence = result.passed ? 60 : 40;
      for (const item of items.slice(0, 2)) {
        try {
          await writeLearning(
            this.env.DB,
            'structure',
            item,
            { origin: 'structure-editor', passed: result.passed },
            confidence,
            'producer',
          );
        } catch { /* learning write shouldn't break audit */ }
      }
    }

    this.setState({ lastResult: result });
    return result;
  }
}
