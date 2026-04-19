import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './types';
import { extractJson } from './shared/parse-json';
import { FACT_CHECKER_PASS1_PROMPT, FACT_CHECKER_PASS2_PROMPT } from './fact-checker-prompt';

/**
 * Result of fact-checking a draft.
 *
 * Gate semantics: `passed` is true iff no claim is marked `incorrect`.
 * Unverified claims are allowed (asymmetric with voice/structure gates —
 * this is intentional, since LLMs can flag anything they can't fully
 * confirm).
 *
 * The two boolean flags encode three distinct outcomes of the web leg:
 * - `searchUsed: true,  searchAvailable: true`  — pass-3 reassessment
 *   ran against real search content. Best case.
 * - `searchUsed: false, searchAvailable: true`  — DDG was reachable but
 *   had no answers for the specific claims. This is normal for
 *   news-style claims: the DDG Instant Answer API only resolves
 *   Wikipedia-like topics. Infrastructure is healthy, no new info to
 *   reassess against, first-pass Claude assessment is the final word.
 *   Not a quality regression; no Observer warn.
 * - `searchUsed: false, searchAvailable: false` — DDG was unreachable
 *   (network failure, timeout, HTTP 5xx). Real infrastructure problem.
 *   Director logs an Observer warn so the pipeline honours the
 *   "no silent failure" principle.
 */
export interface FactCheckResult {
  passed: boolean;
  claims: FactClaim[];
  searchUsed: boolean;
  searchAvailable: boolean;
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
 * Outcome of a single web-search query. Discriminated so call sites can
 * distinguish "DDG unreachable" (infrastructure failure) from
 * "DDG reachable but had no answer" (normal for specific claims).
 */
type WebSearchOutcome =
  | { status: 'ok'; text: string }
  | { status: 'empty' }
  | { status: 'error'; reason: string };

/**
 * Outcome of the whole search pass across multiple claims.
 * - `ok`: at least one query returned usable content; pass-3 runs.
 * - `empty`: every query reached DDG but none had an instant answer;
 *   infrastructure healthy, no pass-3 needed.
 * - `error`: DDG was unreachable on at least one query before we could
 *   collect any content; treat as infrastructure failure.
 */
type SearchPassOutcome =
  | { status: 'ok'; text: string }
  | { status: 'empty' }
  | { status: 'error'; reason: string };

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
      system: FACT_CHECKER_PASS1_PROMPT,
      messages: [{ role: 'user', content: `Fact-check this lesson:\n\n${mdx}` }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const firstPass = extractJson<FactCheckResult>(text);

    // Check if any claims need web verification
    const needsSearch = firstPass.claims.filter(
      (c) => c.status === 'unverified' || c.status === 'incorrect',
    );

    if (needsSearch.length === 0) {
      // No claims needed web verification — searchAvailable is trivially true
      const result: FactCheckResult = { ...firstPass, searchUsed: false, searchAvailable: true };
      this.setState({ lastResult: result });
      return result;
    }

    // Pass 2: Web search for unverified/incorrect claims
    const searchOutcome = await this.searchClaims(needsSearch);

    if (searchOutcome.status === 'error') {
      // DDG unreachable. Director will surface this via Observer.
      console.warn(`[fact-checker] web-search leg unreachable: ${searchOutcome.reason}`);
      const result: FactCheckResult = { ...firstPass, searchUsed: false, searchAvailable: false };
      this.setState({ lastResult: result });
      return result;
    }

    if (searchOutcome.status === 'empty') {
      // DDG was reached but had no instant answers for these specific
      // claims. Infrastructure is healthy; first-pass Claude assessment
      // is the final word. Pass-3 skipped — nothing to reassess against.
      const result: FactCheckResult = { ...firstPass, searchUsed: false, searchAvailable: true };
      this.setState({ lastResult: result });
      return result;
    }

    // Pass 3: Re-assess with search results
    const reassessResponse = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2000,
      system: FACT_CHECKER_PASS2_PROMPT,
      messages: [
        {
          role: 'user',
          content: `## Claims to re-check:\n${needsSearch.map((c) => `- "${c.claim}" (was: ${c.status})`).join('\n')}\n\n## Web search results:\n${searchOutcome.text}\n\nReturn updated JSON:\n{"passed": boolean, "claims": [{"claim": "text", "status": "verified|unverified|incorrect", "note": "updated assessment"}]}`,
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
      searchAvailable: true,
    };

    this.setState({ lastResult: result });
    return result;
  }

  /**
   * Search the web for claims that need verification. Caps at 3 queries.
   *
   * Aggregates per-query outcomes into a single pass outcome:
   * - If any query errored before we collected any content, the pass is
   *   `error` (infrastructure problem — bail out and fall back).
   * - If at least one query returned content, the pass is `ok` with the
   *   aggregated text (other queries' errors/empties are tolerated —
   *   partial results are better than nothing).
   * - If every query reached DDG but none had an answer, the pass is
   *   `empty` (infrastructure fine, just no instant answer to reassess
   *   against). First-pass Claude assessment stands.
   */
  private async searchClaims(claims: FactClaim[]): Promise<SearchPassOutcome> {
    const queries = claims.slice(0, 3).map((c) => c.claim);
    if (queries.length === 0) return { status: 'empty' };

    const results: string[] = [];
    let firstError: string | null = null;

    for (const query of queries) {
      const outcome = await this.webSearch(query);
      if (outcome.status === 'ok') {
        results.push(`Query: "${query}"\nResult: ${outcome.text}\n`);
      } else if (outcome.status === 'error' && firstError === null) {
        firstError = outcome.reason;
      }
    }

    if (results.length > 0) {
      return { status: 'ok', text: results.join('\n---\n') };
    }
    if (firstError !== null) {
      return { status: 'error', reason: firstError };
    }
    return { status: 'empty' };
  }

  /**
   * Single web-search query via DuckDuckGo Instant Answer API.
   *
   * Returns a discriminated outcome so callers can tell "unreachable"
   * (infrastructure problem) from "reachable but no answer" (normal —
   * DDG IA only resolves Wikipedia-like topics, not specific news
   * claims). The old bare `catch { return null }` conflated the two and
   * produced misleading "Web search unavailable" signals on the
   * dashboard.
   *
   * 5s timeout via AbortSignal — Workers kill long-running fetches
   * anyway, better to fail cleanly with a readable reason.
   *
   * Note on DDG IA as a fact-check source: the API is narrow — most
   * specific factual claims (e.g. "fuel prices spiked 18% last month")
   * return empty legitimately. A richer search backend (Brave, Serper,
   * or Claude's web-search tool) is tracked as a separate upgrade.
   */
  private async webSearch(query: string): Promise<WebSearchOutcome> {
    const encoded = encodeURIComponent(query);
    const url = `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`;

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });

      if (!response.ok) {
        return { status: 'error', reason: `DDG returned HTTP ${response.status}` };
      }

      const data = (await response.json()) as {
        Abstract?: string;
        AbstractText?: string;
        RelatedTopics?: Array<{ Text?: string }>;
      };

      const abstract = data.AbstractText || data.Abstract;
      if (abstract && abstract.trim().length > 0) {
        return { status: 'ok', text: abstract };
      }

      const firstTopic = data.RelatedTopics?.[0]?.Text;
      if (firstTopic && firstTopic.trim().length > 0) {
        return { status: 'ok', text: firstTopic };
      }

      return { status: 'empty' };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[fact-checker] webSearch "${query}" failed: ${reason}`);
      return { status: 'error', reason };
    }
  }
}
