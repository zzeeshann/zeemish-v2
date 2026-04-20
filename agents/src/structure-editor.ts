import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './types';
import { extractJson } from './shared/parse-json';
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

    // Learnings are NOT written here. Learner.analysePiecePostPublish reads
    // audit_results post-publish and synthesises producer-origin learnings
    // from the full quality record in lesson-shaped prose — that subsumes
    // the signal this audit produces. See DECISIONS 2026-04-20 "Drop
    // StructureEditor's writeLearning calls".
    this.setState({ lastResult: result });
    return result;
  }
}
