/**
 * InteractiveGenerator prompts — produce a 3–5 question quiz that
 * teaches the *underlying concept* of a just-published daily piece.
 *
 * One prompt per agent, co-located (AGENTS.md §9-2).
 * InteractiveGeneratorAgent is the only caller.
 *
 * THE QUALITY BAR: essence, not reference.
 *
 * If someone who has never read the source piece lands on the quiz
 * URL and can't tell which piece it came from, we did it right. If
 * a reader of the piece can score 100% by pattern-matching details
 * they remember, we did it wrong — that's a recall test, not
 * teaching.
 *
 * The prompt spends most of its words on this one rule because it's
 * the easiest thing to get wrong and the only thing that makes the
 * interactive worth a standalone URL.
 */

/** Hard cap on questions per quiz. Content collection schema also
 *  enforces [3, 5]; this constant is re-used by the agent when it
 *  validates Claude's output before commit. */
export const QUIZ_MIN_QUESTIONS = 3;
export const QUIZ_MAX_QUESTIONS = 5;

/** Options per question. Exactly 4 is the sweet spot — enough that
 *  guessing is ~25%, few enough that authoring 4 plausible ones isn't
 *  forced. Validation enforces ≥2 and ≤6 to match the content schema,
 *  but the prompt asks for 4 to keep quizzes uniform. */
export const QUIZ_OPTIONS_PER_QUESTION = 4;

/** Cap on piece body excerpt fed into the prompt. Matches Categoriser
 *  (~2000 chars) — enough to signal the teaching shape, not so much
 *  that the generator pattern-matches on surface details. */
export const GENERATOR_BODY_EXCERPT_MAX_CHARS = 2500;

export const INTERACTIVE_GENERATOR_PROMPT = `You produce a short multiple-choice quiz that teaches the UNDERLYING CONCEPT of a just-published Zeemish daily piece.

You DO NOT write a quiz about the piece.

You are shown:
- The piece's headline, underlying subject, and body excerpt.
- The piece's library categories.
- Titles + concepts of recently-published interactives (for diversity).

Your only output is the JSON described at the bottom. No prose outside the object. No markdown fences.

# THE ONE RULE: essence, not reference

The reader of your quiz does not know the piece exists. Your quiz must stand alone as a teaching asset about a concept — useful to a stranger who landed on its URL from a search result, a library chip, a friend's link. If a reader of the source piece could tell it came from that piece, you failed the rule.

The piece is the SOURCE of a concept. The concept is the SUBJECT of your quiz.

Worked examples:

- Piece: a 2026 SEC filing exposing an insider-trading ring at a tech firm.
  Wrong quiz subject: "SEC enforcement of insider trading".
  Right quiz subject: "Information asymmetry in markets — how prices behave when some actors know what others don't, and why markets collapse when trust goes."

- Piece: a power-grid failure during a Texas winter storm.
  Wrong quiz subject: "Texas power grid vulnerabilities".
  Right quiz subject: "Single-point-of-failure cascades — why narrow constraints shape the behaviour of whole systems."

- Piece: a Hormuz shipping disruption that spikes oil prices.
  Wrong quiz subject: "Hormuz strait and global oil".
  Right quiz subject: "Chokepoints — physical, economic, or procedural narrow points that determine flow for an entire system."

Notice: the RIGHT subjects never name the specific trigger. They name the PATTERN the specific trigger illustrates.

# Hard prohibitions

1. Do not use proper nouns from the piece (company names, people, cities, countries, agencies, product names).
2. Do not use specific dates, years, or timeframes from the piece.
3. Do not quote sentences or phrases from the piece.
4. Do not write "according to the piece", "as described", "in the article". There is no piece as far as the reader knows.
5. Do not write "Which of the following best describes what happened in…" — there is no "what happened".
6. Do not include specific numbers (dollar amounts, percentages, counts) UNLESS they are the universal form of the concept. "A human body is ~60% water" is the concept. "$18.2 billion in quarterly losses" is the piece.
7. Do not name industries in a way that a reader would recognise as this piece's industry. If the piece is about airlines, don't say "in the commercial aviation industry" — say "in an industry where fuel is 25% of operating cost and demand is seasonal" (the structure, not the label).

# What a good quiz looks like

- ${QUIZ_MIN_QUESTIONS}–${QUIZ_MAX_QUESTIONS} questions, each teaching a distinct facet of the concept. Questions should build: a definition-level opener, then mechanism, then implication, then edge/mis-application.
- Exactly ${QUIZ_OPTIONS_PER_QUESTION} options per question.
- Exactly one correct option.
- Wrong options are *plausible mistakes* — a reader reasoning casually might pick them. They teach by being wrong in instructive ways, not by being obviously silly. Avoid "All of the above" and "None of the above" — they dodge the teaching.
- Each question carries a 1–2 sentence explanation that unpacks WHY the correct answer is right AND why the most tempting wrong answer falls short.
- The whole quiz reads as if it were authored BEFORE the piece existed — a standalone teaching asset.

# Title + concept + slug

- \`title\`: 2–6 words, names the concept. Not a headline. Not a question. "Chokepoints and Cascades", "Information Asymmetry", "Moral Hazard".
- \`concept\`: one sentence naming the underlying principle this quiz teaches. A stranger reading this line on the interactive's page should understand what they'll learn.
- \`slug\`: kebab-case, derived from the concept (not from the piece headline). Short (under 4 words). "chokepoints-and-cascades", "information-asymmetry", "moral-hazard-in-markets".

# Diversity with past interactives

You're shown titles + concepts of the most recent interactives. If your draft's concept duplicates one of them, pick a different angle from the piece — e.g. a piece on an insider-trading ring that already has an "information asymmetry" interactive could instead teach "regulatory response cycles" or "market fragility under trust collapse".

If you genuinely cannot find a non-duplicating teachable concept in this piece — for example the piece's concept is fully covered by two recent interactives — decline to generate. Return the empty shape described below.

# Response format (strict)

On success, return JSON matching this shape exactly:

{
  "slug": "kebab-case-slug",
  "title": "Human Title",
  "concept": "One sentence naming the underlying principle this quiz teaches.",
  "questions": [
    {
      "question": "Full question text.",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctIndex": 2,
      "explanation": "One to two sentences — why the correct answer is right, why the tempting wrong one falls short."
    }
  ]
}

To decline (concept too redundant or too narrow to teach in ${QUIZ_MIN_QUESTIONS}+ questions):

{
  "slug": "",
  "title": "",
  "concept": "",
  "questions": []
}

No prose. No markdown fences. No explanation outside the object.
`;

/** Shape of a recently-published interactive fed into the prompt for
 *  diversity context. */
export interface RecentInteractive {
  slug: string;
  title: string;
  concept: string | null;
}

/** Shape of a piece's category fed into the prompt. */
export interface CategoryRow {
  name: string;
  slug: string;
}

/** Shape of the piece context fed into the prompt. */
export interface PieceContextForQuiz {
  headline: string;
  underlyingSubject: string | null;
  bodyExcerpt: string;
  categories: CategoryRow[];
}

/**
 * Build the user-message context for InteractiveGenerator.
 */
export function buildInteractivePrompt(
  piece: PieceContextForQuiz,
  recent: RecentInteractive[],
): string {
  const pieceBlock = `## The piece (source — DO NOT reference directly)
- Headline: "${piece.headline}"
- Underlying subject: ${piece.underlyingSubject ?? 'unknown'}
- Categories: ${
    piece.categories.length > 0
      ? piece.categories.map((c) => c.name).join(', ')
      : '(none assigned yet)'
  }

### Body excerpt (first ~${GENERATOR_BODY_EXCERPT_MAX_CHARS} chars, frontmatter + component tags stripped)
${piece.bodyExcerpt}`;

  const recentBlock = recent.length === 0
    ? `## Recently-published interactives
(None yet. You're creating the first one.)`
    : `## Recently-published interactives (${recent.length} most recent — do not duplicate their concept)
${recent
        .map(
          (r) => `- slug: ${r.slug}
  title: "${r.title}"
  concept: ${r.concept ?? '(no concept recorded)'}`,
        )
        .join('\n')}`;

  return `${pieceBlock}\n\n${recentBlock}`;
}

/** Shape of one audit-dimension's feedback fed into the revise
 *  prompt. Issues/violations are what the Auditor flagged; suggestions
 *  are (optional) specific fixes. */
export interface RevisionDimensionFeedback {
  passed: boolean;
  issues: string[];     // voice violations / structure issues / essence violations / factual issues
  suggestions: string[];
  score?: number;       // voice only
}

/** Full audit feedback shape passed to the revise prompt. */
export interface RevisionFeedback {
  voice: RevisionDimensionFeedback & { score: number };
  structure: RevisionDimensionFeedback;
  essence: RevisionDimensionFeedback;
  factual: RevisionDimensionFeedback;
}

/** Shape of the previous quiz fed into the revise prompt (same as
 *  ValidatedQuiz but duplicated locally to avoid cross-module
 *  imports in a prompt file). */
export interface RevisionPreviousQuiz {
  slug: string;
  title: string;
  concept: string;
  questions: Array<{
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
  }>;
}

/**
 * Build the user-message for a revision round. Takes the previous
 * attempt + auditor feedback + original piece context and asks
 * Claude to produce a fresh quiz that addresses each failed
 * dimension. The system prompt is the same `INTERACTIVE_GENERATOR_PROMPT`
 * — revision doesn't relax the essence-not-reference rule; if anything
 * it's tighter because the prior attempt already failed once.
 */
export function buildRevisionPrompt(
  previous: RevisionPreviousQuiz,
  feedback: RevisionFeedback,
  piece: PieceContextForQuiz,
  recent: RecentInteractive[],
  round: number,
): string {
  const previousBlock = `## Previous attempt (round ${round - 1}) — DID NOT pass audit

Title: ${previous.title}
Slug: ${previous.slug}
Concept: ${previous.concept}

${previous.questions
    .map((q, i) => {
      const optionLines = q.options
        .map((opt, j) => `  ${String.fromCharCode(65 + j)}. ${opt}${j === q.correctIndex ? ' (correct)' : ''}`)
        .join('\n');
      return `### Question ${i + 1}
${q.question}

${optionLines}

Explanation: ${q.explanation}`;
    })
    .join('\n\n')}`;

  const dimensionBlock = (
    label: string,
    dim: RevisionDimensionFeedback,
  ): string => {
    if (dim.passed) return `- ${label}: PASSED`;
    const lines: string[] = [];
    lines.push(`- ${label}: FAILED${dim.score !== undefined ? ` (score ${dim.score})` : ''}`);
    for (const issue of dim.issues) lines.push(`  - ${issue}`);
    for (const suggestion of dim.suggestions) lines.push(`  - SUGGESTION: ${suggestion}`);
    return lines.join('\n');
  };

  const feedbackBlock = `## Auditor feedback

${dimensionBlock('Voice', feedback.voice)}
${dimensionBlock('Structure', feedback.structure)}
${dimensionBlock('Essence (the primary bar)', feedback.essence)}
${dimensionBlock('Factual', feedback.factual)}`;

  const instruction = `## What to do

Produce a fresh quiz that addresses every failed dimension above. Do NOT incrementally edit the previous attempt — write new questions that teach the same underlying concept but resolve the issues. Same JSON shape as the initial generation. If the essence dimension failed, you likely need to re-derive the concept from the piece's underlying pattern rather than its surface details.

If the feedback makes it clear the piece's concept cannot be taught cleanly in a standalone quiz, decline — return the empty shape {"slug":"","title":"","concept":"","questions":[]}.`;

  const pieceBlock = `## The piece (source — STILL DO NOT reference directly)
- Headline: "${piece.headline}"
- Underlying subject: ${piece.underlyingSubject ?? 'unknown'}
- Categories: ${
    piece.categories.length > 0
      ? piece.categories.map((c) => c.name).join(', ')
      : '(none assigned yet)'
  }

### Body excerpt
${piece.bodyExcerpt}`;

  const recentBlock = recent.length === 0
    ? ''
    : `\n\n## Recently-published interactives (${recent.length} — still avoid duplicating)
${recent
        .map((r) => `- ${r.title}: ${r.concept ?? '(no concept recorded)'}`)
        .join('\n')}`;

  return `${previousBlock}\n\n${feedbackBlock}\n\n${instruction}\n\n${pieceBlock}${recentBlock}`;
}
