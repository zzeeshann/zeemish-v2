import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './types';
import { VOICE_CONTRACT } from './shared/voice-contract';
import { extractJson } from './shared/parse-json';

export interface VoiceAuditResult {
  passed: boolean;
  score: number; // 0-100
  violations: string[];
  suggestions: string[];
}

interface VoiceAuditorState {
  lastResult: VoiceAuditResult | null;
}

/**
 * VoiceAuditorAgent — reviews drafts against the voice contract.
 * Scores 0-100. Must be ≥85 to pass.
 * Flags specific violations (tribe words, flattery, jargon, etc.)
 */
export class VoiceAuditorAgent extends Agent<Env, VoiceAuditorState> {
  initialState: VoiceAuditorState = { lastResult: null };

  async audit(mdx: string): Promise<VoiceAuditResult> {
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2000,
      system: `You are a voice auditor for Zeemish, a learning site. Your ONLY job is to check if a draft follows the voice contract.

${VOICE_CONTRACT}

Score the draft 0-100 on voice compliance. Be strict. Flag EVERY violation.
- Tribe words (mindfulness, journey, empower, etc.) → automatic -10 per instance
- Flattery ("great job reading this") → -15
- Jargon without explanation → -10
- Long padded sentences → -5 each
- "In this lesson we'll learn..." openings → -20
- Summary/CTA/congratulations in close → -15

Respond with JSON only:
{
  "score": number,
  "passed": boolean (score >= 85),
  "violations": ["specific violation 1", "specific violation 2"],
  "suggestions": ["how to fix violation 1", "how to fix violation 2"]
}`,
      messages: [{ role: 'user', content: `Audit this draft:\n\n${mdx}` }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const result = extractJson<VoiceAuditResult>(text);
    result.passed = result.score >= 85;
    this.setState({ lastResult: result });
    return result;
  }
}
