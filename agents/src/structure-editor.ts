import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './types';
import { extractJson } from './shared/parse-json';

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
      system: `You are a structure editor for Zeemish, a learning site. Review the lesson structure:

CHECK:
1. Has 3-6 beats (hook, 2-3 teaching, optional practice, close)
2. Hook is ONE screen — drops reader in, no introduction
3. Each teaching beat has ONE idea (not crammed)
4. Teaching beats total 1500-2500 words
5. Close is ONE sentence — no summary, no CTA, no congratulations
6. Proper <lesson-shell> and <lesson-beat> tags
7. Valid MDX frontmatter (title, course, lessonNumber, estimatedTime, beatCount, description)
8. No padding, no filler paragraphs

Respond with JSON only:
{
  "passed": boolean,
  "issues": ["specific issue 1", "specific issue 2"],
  "suggestions": ["how to fix issue 1", "how to fix issue 2"]
}

If no issues, return { "passed": true, "issues": [], "suggestions": [] }`,
      messages: [{ role: 'user', content: `Review this lesson structure:\n\n${mdx}` }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const result = extractJson<StructureAuditResult>(text);
    this.setState({ lastResult: result });
    return result;
  }
}
