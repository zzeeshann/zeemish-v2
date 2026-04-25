/**
 * Categoriser prompts — assign 1–3 categories to a published daily
 * piece, strongly biased toward reusing an existing category.
 *
 * One prompt per agent, co-located (AGENTS.md §9-2).
 * CategoriserAgent is the only caller.
 */

/** Hard cap on assignments per piece. The prompt enforces 1–3; this
 *  constant is re-used by the agent when it clamps the LLM's output
 *  so a misbehaving response can't over-tag a piece. */
export const CATEGORISER_MAX_ASSIGNMENTS = 3;

/** Minimum confidence Claude should require before picking an
 *  existing category. Below this, the piece doesn't truly belong and
 *  creating a new category is the honest answer. Shown in the prompt
 *  so the reuse-bias has a numeric anchor. The agent does not
 *  post-hoc filter on this — Claude is told the rule and expected to
 *  follow it.
 *
 *  Raised 60 → 75 on 2026-04-25 after the firing-squads piece (a
 *  state-violence subject with a secondary pharma-supply-chain thread)
 *  picked up "Commodity Shocks" at 70 confidence — a cross-domain
 *  stretch from "supply running out" to "commodity shock". 75 is high
 *  enough to require the piece's *primary* underlying subject to fit
 *  the reused category, not merely a thematic echo from a secondary
 *  beat. See DECISIONS 2026-04-25 "Tighten Categoriser reuse floor". */
export const CATEGORISER_REUSE_CONFIDENCE_FLOOR = 75;

export const CATEGORISER_PROMPT = `You categorise a just-published Zeemish daily piece by assigning it to 1–3 existing categories — or, only when nothing truly fits, proposing a single new one.

You are shown:
- The piece's headline, underlying subject, and the first chunk of its body.
- The full list of categories that already exist in the library, with their descriptions and current piece counts.

Your only output is the JSON described at the bottom. Do not write prose outside the object.

# The most important rule: prefer reuse over novelty

Categories are a taxonomy for readers to browse the library. They only work if they mean something specific. A taxonomy that grows a new category for every piece becomes noise — it's a list of headlines, not a map.

Strongly prefer an existing category. Create a new one only when NO existing category fits the piece at confidence ≥${CATEGORISER_REUSE_CONFIDENCE_FLOOR}.

Before proposing a new category, ask yourself:
- Is there an existing category whose description covers this piece's *underlying subject*, even if the headline is new?
- Could this piece plausibly sit alongside pieces already in one of the existing categories? (Check the piece counts — a category with 6 pieces has a defined shape; a category with 1 piece hasn't converged yet.)
- Am I proposing a new category because the piece is genuinely different, or because the headline uses a different word than the existing category names?

If you're on the fence, reuse.

# When a new category is the honest answer

Propose one only when the piece's underlying subject is materially absent from the existing list. A good new category:
- Is a *subject*, not a topic-of-the-week (e.g. "Chokepoints & Supply", not "Suez Canal").
- Could plausibly hold 10+ future pieces (e.g. "Monetary Policy", not "This Week's Fed Meeting").
- Has a one-sentence description that would help another piece's categoriser know whether to put it here.
- Has a kebab-case slug derived from the name (e.g. "chokepoints-and-supply"). Keep it short — under 4 words in the name.

Return AT MOST one new category per piece. If two aspects of the piece feel novel, pick the more important one and reuse-or-skip the other.

# Assignment shape

Return between 1 and ${CATEGORISER_MAX_ASSIGNMENTS} assignments. More than one is fine when a piece genuinely spans — e.g. a monetary-policy piece that also teaches supply chains could legitimately land in both. Don't pad. Three is an upper bound, not a target.

For each assignment, provide a confidence (0–100). For existing-category assignments, confidence reflects how well the piece fits that category's stated scope. For a new category, confidence reflects how confidently you believe it's a durable addition to the taxonomy.

# Response format (strict)

Return JSON with this exact shape. One of \`categoryId\` or \`newCategory\` must be present on each assignment, never both:

{
  "assignments": [
    {
      "categoryId": "<existing category UUID, exactly as shown>",
      "confidence": 85,
      "reasoning": "one short sentence — why this piece fits this category"
    },
    {
      "newCategory": {
        "name": "Short Display Name",
        "slug": "kebab-case-slug",
        "description": "One sentence about what belongs in this category."
      },
      "confidence": 80,
      "reasoning": "one short sentence — why no existing category fits and this one would be durable"
    }
  ]
}

No prose. No markdown fences. No explanation outside the object.
`;

/** Shape of one existing category as fed into the prompt's context. */
export interface CategoryContextRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  pieceCount: number;
}

/** Shape of the piece context fed into the prompt. */
export interface PieceContext {
  headline: string;
  underlyingSubject: string | null;
  bodyExcerpt: string;
}

/**
 * Build the user-message context for Categoriser. Keeps the piece
 * excerpt bounded (~2000 chars of body after frontmatter strip) so
 * the call cost stays predictable across a session of backfills.
 */
export function buildCategoriserPrompt(
  piece: PieceContext,
  existing: CategoryContextRow[],
): string {
  const pieceBlock = `## The piece
- Headline: "${piece.headline}"
- Underlying subject: ${piece.underlyingSubject ?? 'unknown'}

### Body excerpt (first ~2000 chars, frontmatter stripped)
${piece.bodyExcerpt}`;

  const categoriesBlock = existing.length === 0
    ? `## Existing categories
(None yet — this is the first piece being categorised. Propose a new category for this piece only if it has a clearly durable subject. Otherwise you may return zero assignments and the next piece's run will revisit with more context.)`
    : `## Existing categories (${existing.length} total — prefer one of these)
${existing
        .map(
          (c) => `- id: ${c.id}
  name: "${c.name}"
  slug: ${c.slug}
  description: ${c.description ?? '(no description)'}
  piece_count: ${c.pieceCount}`,
        )
        .join('\n')}`;

  return `${pieceBlock}\n\n${categoriesBlock}`;
}
