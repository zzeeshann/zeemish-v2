import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './types';
import { extractJson } from './shared/parse-json';

export interface FactCheckResult {
  passed: boolean;
  claims: FactClaim[];
}

export interface FactClaim {
  claim: string;
  status: 'verified' | 'unverified' | 'incorrect';
  note: string;
}

interface FactCheckerState {
  lastResult: FactCheckResult | null;
}

/**
 * FactCheckerAgent — verifies factual claims in lesson drafts.
 * Flags unsupported or incorrect claims. Zero unverified claims
 * allowed on technical/scientific topics.
 */
export class FactCheckerAgent extends Agent<Env, FactCheckerState> {
  initialState: FactCheckerState = { lastResult: null };

  async check(mdx: string): Promise<FactCheckResult> {
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 3000,
      system: `You are a fact-checker for Zeemish, a learning site. Your job is to identify every factual claim in a lesson draft and assess whether it's accurate.

RULES:
- Extract each specific factual claim (statistics, research findings, biological facts, historical claims)
- For each claim, assess: "verified" (widely accepted/true), "unverified" (can't confirm), or "incorrect" (wrong)
- Be strict on numbers, dates, and scientific claims
- Opinion or subjective statements are NOT claims — skip them
- Metaphors and analogies are NOT claims — skip them
- If the lesson makes a claim about research, check if the described research is plausible

Respond with JSON only:
{
  "passed": boolean (true if zero "incorrect" and zero "unverified" on hard facts),
  "claims": [
    { "claim": "the specific claim text", "status": "verified|unverified|incorrect", "note": "explanation" }
  ]
}

If there are no factual claims (rare), return { "passed": true, "claims": [] }`,
      messages: [{ role: 'user', content: `Fact-check this lesson:\n\n${mdx}` }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const result = extractJson<FactCheckResult>(text);
    this.setState({ lastResult: result });
    return result;
  }
}
