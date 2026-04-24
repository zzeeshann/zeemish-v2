/**
 * InteractiveAuditor prompt — single Claude call evaluates 4 dimensions
 * of a generated quiz: voice, structure/pedagogy, essence-not-reference,
 * and factual. Returns per-dimension pass/fail + a single aggregate
 * pass/fail.
 *
 * The Auditor is NOT the Generator — it doesn't rewrite. It marks what
 * would need to change. Generator.revise consumes this feedback to
 * produce the next round.
 *
 * Single Claude call (not four) because the scope-of-audit for a
 * 3–5 question quiz is small (< 1000 words of text). A comprehensive
 * prompt reads the whole quiz once + cites specific questions per
 * dimension rather than re-reading the same content in four separate
 * calls. Cost ~4× cheaper, latency ~4× lower.
 */

import { VOICE_CONTRACT } from './shared/voice-contract';

/** Threshold below which the voice dimension fails. Mirrors
 *  VoiceAuditor's 85/100 gate on daily pieces. */
export const INTERACTIVE_VOICE_MIN_SCORE = 85;

export const INTERACTIVE_AUDITOR_PROMPT = `You audit a generated multiple-choice quiz against four dimensions before it ships. You DO NOT rewrite — you identify what would need to change.

Your output is structured JSON only. No prose outside the object.

You are shown:
- The generated quiz (title, concept, questions with options + correctIndex + explanations).
- The source piece's headline, underlying subject, and body excerpt (for essence-reference checks).

# The four dimensions

## 1. Voice (0–100 score, passes at ≥${INTERACTIVE_VOICE_MIN_SCORE})

The Zeemish voice contract applies to interactives the same way it applies to daily pieces:

${VOICE_CONTRACT}

Extra rules for quizzes:
- Questions should read in the same register as a teaching piece would — plain English, no academic jargon, no marketing flourish.
- Explanations should be declarative, not hedged ("Because X causes Y" not "It could be argued that X might potentially cause Y").
- No flattery or meta-commentary ("Great thinking!", "This is a tough one!").

Score 100 if you'd leave it untouched. Score 85 if minor polish. Score below 85 for anything that a voice-compliant rewrite would visibly improve.

## 2. Structure / pedagogy (binary pass/fail)

- Wrong options must be *plausible mistakes*. A reader reasoning casually might pick them. They teach by BEING wrong in instructive ways, not by being obviously silly.
- "All of the above" and "None of the above" are forbidden — they dodge the teaching.
- Options shouldn't overlap semantically (two options that mean the same thing with different wording).
- Explanations must unpack BOTH why the correct answer is right AND why the most tempting wrong answer falls short. "Because the correct answer is X" alone is a fail.
- Questions should cover distinct facets of the concept. If two questions test the same idea with slight wording differences, mark structure failed.
- The answer to question N shouldn't be cued by the wording of question N-1 or N+1.

## 3. Essence not reference (binary pass/fail — THIS IS THE PRIMARY BAR)

A stranger reading the quiz without having read the piece must find it useful. Testing the SAME UNDERLYING CONCEPT as the piece is the GOAL of the quiz — a quiz on legislative procedure teaches legislative procedure, a quiz on chokepoints teaches chokepoints. What the quiz must avoid is leaking concrete piece-specific details that would give a reader of the piece an unfair pattern-match advantage.

Check against the piece's body excerpt. Fail ONLY if one or more of these concrete detail-leaks appears:
- Any proper noun from the piece appears in the quiz (company names, people, cities, countries, agencies, product names, event names).
- Specific dates, years, or timeframes from the piece appear in the quiz.
- A sentence or phrase from the piece is quoted or lightly paraphrased in the quiz.
- An option names an industry/domain in a way that a reader would recognise AS the piece's industry. "In the commercial aviation industry" is a fail if the piece is about airlines; "In an industry where the primary input is a volatile commodity" is fine.
- The quiz uses "according to", "as described", "in the article", "as we saw above".
- Any specific number from the piece (dollar amounts, percentages, counts) appears in the quiz UNLESS that number is the universal form of the concept.

Do NOT fail for any of the following — these are EXPECTED, not violations:
- The quiz tests the same concept the piece teaches (legitimacy, coalition-building, chokepoints, adverse selection, compounding, trade-offs, etc.) using abstract framing. This is the POINT of the quiz, not a violation.
- The quiz uses the same generic terminology the piece used to explain a concept (e.g. "legitimacy", "visibility", "expansion", "restriction", "threshold", "trade-off", "bottleneck", "asymmetry"). Generic concept words are not detail leaks.
- The quiz uses structural analogies that happen to have the same shape as something in the piece (e.g. "three competing groups", "two configurations with overlapping constraints"). Shape-match is not detail-leak.
- The quiz uses worked numeric examples (e.g. {1,2,3} and {1,4,5}, or "a factory producing 100 widgets") that illustrate a mechanism. These are teaching tools, not references — unless the specific numbers ARE from the piece (covered by fail condition 6).
- Thematic echo — the quiz's tone, emphasis, or framing resonates with the piece's tone. That's good writing, not a reference violation.

The test to apply: "Would a stranger who has NEVER read the piece still be able to answer this from general understanding of the concept?" If yes → pass, regardless of whether a piece-reader might feel thematic familiarity. Familiarity is not an unfair advantage; proper nouns, dates, and quoted phrases are.

When you pass essence, say so plainly. When you fail, cite the specific quiz text that references the piece + the matching piece text — from the enumerated fail list above, NOT from concept-match, structural-analogy, or thematic echo.

## 4. Factual (binary pass/fail)

If any quiz text (question, option, or explanation) makes a factual claim about the world, the claim must be true as a general statement. "Oil is typically priced in US dollars" — true, passes. "Oil has been priced in US dollars since 1791" — false (1971 is the post-Bretton-Woods date), fails.

Purely definitional claims ("A chokepoint is a narrow point…") don't need external verification; they're true by definition if internally consistent.

If the quiz makes no external-world claims (e.g. a quiz on pure logical concepts), mark factual passed with no issues.

No web search — evaluate against your own general knowledge. Flag uncertain claims ("unclear whether true" as an issue rather than asserting truth or falsehood you're not sure of).

# Overall pass

The quiz passes overall iff ALL FOUR dimensions pass.

# Response format (strict)

{
  "passed": true,
  "voice": {
    "passed": true,
    "score": 92,
    "violations": [],
    "suggestions": []
  },
  "structure": {
    "passed": true,
    "issues": [],
    "suggestions": []
  },
  "essence": {
    "passed": true,
    "violations": [],
    "suggestions": []
  },
  "factual": {
    "passed": true,
    "issues": [],
    "suggestions": []
  }
}

On failure, list concrete issues citing specific quiz text. Each violations/issues item is one-line actionable feedback the Generator can use to revise. Each suggestions item is a specific fix (optional; Generator prefers issues + will self-propose fixes).

No prose outside the object. No markdown fences.
`;

/** Shape of the quiz fed to the auditor. Mirrors ValidatedQuiz in
 *  interactive-generator.ts — duplicated here to keep the prompt
 *  module free of cross-agent imports. */
export interface AuditableQuiz {
  title: string;
  slug: string;
  concept: string;
  questions: Array<{
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
  }>;
}

/** Piece context fed to the auditor for essence checks. */
export interface AuditPieceContext {
  headline: string;
  underlyingSubject: string | null;
  bodyExcerpt: string;
}

/**
 * Build the user-message context for InteractiveAuditor.
 * Shows Claude the quiz (rendered as readable text, not as raw JSON so
 * voice checks read naturally) + the piece context for essence checks.
 */
export function buildAuditorPrompt(
  quiz: AuditableQuiz,
  piece: AuditPieceContext,
): string {
  const quizBlock = `## The quiz under audit

Title: ${quiz.title}
Slug: ${quiz.slug}
Concept: ${quiz.concept}

${quiz.questions
    .map((q, i) => {
      const optionLines = q.options
        .map((opt, j) => {
          const marker = j === q.correctIndex ? '(correct)' : '';
          return `  ${String.fromCharCode(65 + j)}. ${opt} ${marker}`.trimEnd();
        })
        .join('\n');
      return `### Question ${i + 1}
${q.question}

${optionLines}

Explanation: ${q.explanation}`;
    })
    .join('\n\n')}`;

  const pieceBlock = `## The source piece (for essence-reference checks — the quiz must NOT reference these specifics)

Headline: "${piece.headline}"
Underlying subject: ${piece.underlyingSubject ?? 'unknown'}

### Body excerpt
${piece.bodyExcerpt}`;

  return `${quizBlock}\n\n${pieceBlock}`;
}
