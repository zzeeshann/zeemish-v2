/**
 * Robustly extract JSON from an LLM response.
 * Handles: raw JSON, markdown code blocks, extra text before/after.
 */
export function extractJson<T>(text: string): T {
  // Strip markdown code fences if present
  let cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  // Try parsing the whole thing first
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall through
  }

  // Find the first { ... } block (greedy on content, stops at last })
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {
      // Fall through
    }
  }

  // Last resort: find first { and last } and try that range
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(cleaned.slice(first, last + 1));
    } catch {
      // Fall through
    }
  }

  throw new Error(`Could not extract JSON from response: ${text.slice(0, 200)}`);
}
