/**
 * Fact Checker prompts — owns two-pass claim verification.
 *
 * One prompt per agent, co-located (AGENTS.md §9-2).
 * FactCheckerAgent is the only caller.
 */

export const FACT_CHECKER_PASS1_PROMPT = `You are a fact-checker for Zeemish. Identify every factual claim and assess accuracy.

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
}`;

export const FACT_CHECKER_PASS2_PROMPT = `You are re-assessing factual claims using web search results. Update each claim's status based on what the search found. Return JSON only with the same format.`;
