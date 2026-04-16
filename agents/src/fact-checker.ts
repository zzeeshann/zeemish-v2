import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './types';
import { extractJson } from './shared/parse-json';

export interface FactCheckResult {
  passed: boolean;
  claims: FactClaim[];
  searchUsed: boolean;
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
 *
 * Two-pass approach:
 * 1. First pass: Claude identifies all factual claims
 * 2. Second pass: For any unverified/incorrect claims, search the web
 *    and re-assess with the search results
 */
export class FactCheckerAgent extends Agent<Env, FactCheckerState> {
  initialState: FactCheckerState = { lastResult: null };

  async check(mdx: string): Promise<FactCheckResult> {
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });

    // Pass 1: Identify claims
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 3000,
      system: `You are a fact-checker for Zeemish. Identify every factual claim and assess accuracy.

RULES:
- Extract each specific factual claim (statistics, research findings, biological facts)
- Assess: "verified" (widely accepted/true), "unverified" (can't fully confirm), "incorrect" (definitely wrong)
- General well-known science (e.g. "cortisol is a stress hormone") → "verified"
- Approximate numbers in right ballpark (e.g. "about 20,000 breaths a day") → "verified"
- Only "incorrect" if demonstrably wrong
- Skip opinions, metaphors, analogies

Return JSON only:
{
  "passed": boolean (true if zero "incorrect" — a few "unverified" is acceptable),
  "claims": [{ "claim": "text", "status": "verified|unverified|incorrect", "note": "why" }]
}`,
      messages: [{ role: 'user', content: `Fact-check this lesson:\n\n${mdx}` }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const firstPass = extractJson<FactCheckResult>(text);

    // Check if any claims need web verification
    const needsSearch = firstPass.claims.filter(
      (c) => c.status === 'unverified' || c.status === 'incorrect',
    );

    if (needsSearch.length === 0) {
      const result = { ...firstPass, searchUsed: false };
      this.setState({ lastResult: result });
      return result;
    }

    // Pass 2: Web search for unverified/incorrect claims
    const searchResults = await this.searchClaims(needsSearch);

    if (!searchResults) {
      // Search unavailable — return first pass results
      const result = { ...firstPass, searchUsed: false };
      this.setState({ lastResult: result });
      return result;
    }

    // Pass 3: Re-assess with search results
    const reassessResponse = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2000,
      system: `You are re-assessing factual claims using web search results. Update each claim's status based on what the search found. Return JSON only with the same format.`,
      messages: [
        {
          role: 'user',
          content: `## Claims to re-check:\n${needsSearch.map((c) => `- "${c.claim}" (was: ${c.status})`).join('\n')}\n\n## Web search results:\n${searchResults}\n\nReturn updated JSON:\n{"passed": boolean, "claims": [{"claim": "text", "status": "verified|unverified|incorrect", "note": "updated assessment"}]}`,
        },
      ],
    });

    const reassessText = reassessResponse.content[0].type === 'text' ? reassessResponse.content[0].text : '{}';
    const secondPass = extractJson<{ passed: boolean; claims: FactClaim[] }>(reassessText);

    // Merge: keep verified claims from pass 1, use updated claims from pass 2
    const verifiedFromFirst = firstPass.claims.filter((c) => c.status === 'verified');
    const allClaims = [...verifiedFromFirst, ...secondPass.claims];
    const hasIncorrect = allClaims.some((c) => c.status === 'incorrect');

    const result: FactCheckResult = {
      passed: !hasIncorrect,
      claims: allClaims,
      searchUsed: true,
    };

    this.setState({ lastResult: result });
    return result;
  }

  /** Search the web for claims that need verification */
  private async searchClaims(claims: FactClaim[]): Promise<string | null> {
    try {
      // Use Cloudflare Workers AI search if available, otherwise fallback
      const queries = claims.slice(0, 3).map((c) => c.claim); // Max 3 searches

      const results: string[] = [];
      for (const query of queries) {
        const searchResult = await this.webSearch(query);
        if (searchResult) {
          results.push(`Query: "${query}"\nResult: ${searchResult}\n`);
        }
      }

      return results.length > 0 ? results.join('\n---\n') : null;
    } catch {
      return null;
    }
  }

  /** Simple web search via a search API */
  private async webSearch(query: string): Promise<string | null> {
    try {
      // Use Cloudflare AI Gateway search or a simple search API
      // For now, use a lightweight approach via DuckDuckGo instant answer
      const encoded = encodeURIComponent(query);
      const response = await fetch(
        `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`,
      );

      if (!response.ok) return null;

      const data = await response.json() as {
        Abstract?: string;
        AbstractText?: string;
        RelatedTopics?: Array<{ Text?: string }>;
      };

      const abstract = data.AbstractText || data.Abstract;
      if (abstract) return abstract;

      // Use first related topic if no abstract
      const firstTopic = data.RelatedTopics?.[0]?.Text;
      return firstTopic ?? null;
    } catch {
      return null;
    }
  }
}
