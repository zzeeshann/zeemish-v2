import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './types';
import { extractJson } from './shared/parse-json';
import {
  INTERACTIVE_AUDITOR_PROMPT,
  INTERACTIVE_VOICE_MIN_SCORE,
  buildAuditorPrompt,
  type AuditableQuiz,
  type AuditPieceContext,
} from './interactive-auditor-prompt';

export interface InteractiveAuditDimension {
  passed: boolean;
  violations?: string[];
  issues?: string[];
  suggestions: string[];
  score?: number;
}

export interface InteractiveAuditResult {
  passed: boolean;
  voice: InteractiveAuditDimension & { score: number; violations: string[] };
  structure: InteractiveAuditDimension & { issues: string[] };
  essence: InteractiveAuditDimension & { violations: string[] };
  factual: InteractiveAuditDimension & { issues: string[] };
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

interface InteractiveAuditorState {
  auditsPerformed: number;
  auditsPassed: number;
  auditsFailed: number;
}

/** Safe read of an array-of-strings field from parsed JSON — defensive
 *  so a malformed auditor response can't crash the caller. */
function asStringArray(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return x.filter((s): s is string => typeof s === 'string' && s.length > 0);
}

/** Safe boolean with default. */
function asBool(x: unknown, fallback: boolean): boolean {
  return typeof x === 'boolean' ? x : fallback;
}

/** Safe integer score clamped to [0, 100]. */
function asScore(x: unknown): number {
  const n = typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : 0;
  return Math.max(0, Math.min(100, n));
}

/**
 * InteractiveAuditorAgent — 16th agent.
 *
 * Audits a generated quiz against four dimensions:
 *   1. Voice — plain English, no tribe words, no flattery (voice contract)
 *   2. Structure / pedagogy — plausible wrong options, explanations teach,
 *      questions cover distinct facets, no "all of the above"
 *   3. Essence-not-reference — no proper nouns, dates, or specifics from
 *      the source piece (the PRIMARY bar that makes interactives usable
 *      standalone)
 *   4. Factual — any claims about the world are true as general statements
 *
 * Single Claude call evaluates all four dimensions. Not four separate
 * auditors (as with daily pieces) because a 3–5 question quiz is small
 * enough that one comprehensive audit is both cheaper and more coherent.
 *
 * Does NOT rewrite. Returns pass/fail + per-dimension feedback. The
 * revise loop lives in InteractiveGeneratorAgent — it reads the audit
 * feedback and produces the next round. Auditor is stateless-in-
 * behaviour (an `auditsPerformed` counter is kept for observability
 * only).
 *
 * Fail-on-parse behaviour: if Claude returns non-JSON or the JSON is
 * malformed, Auditor throws. Generator's loop catches and treats as an
 * audit failure (round doesn't pass, but doesn't crash the run).
 */
export class InteractiveAuditorAgent extends Agent<Env, InteractiveAuditorState> {
  initialState: InteractiveAuditorState = {
    auditsPerformed: 0,
    auditsPassed: 0,
    auditsFailed: 0,
  };

  /**
   * Audit a quiz against the four dimensions.
   *
   * @param quiz     Validated quiz produced by Generator (structurally sound).
   * @param piece    Source piece context — used only for essence-reference checks.
   */
  async audit(
    quiz: AuditableQuiz,
    piece: AuditPieceContext,
  ): Promise<InteractiveAuditResult> {
    const started = Date.now();

    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2500,
      system: INTERACTIVE_AUDITOR_PROMPT,
      messages: [
        { role: 'user', content: buildAuditorPrompt(quiz, piece) },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const tokensIn = response.usage?.input_tokens ?? 0;
    const tokensOut = response.usage?.output_tokens ?? 0;

    let parsed: Record<string, unknown>;
    try {
      parsed = extractJson<Record<string, unknown>>(text);
    } catch {
      throw new Error('audit: Claude returned non-JSON output');
    }

    const voiceRaw = (parsed.voice ?? {}) as Record<string, unknown>;
    const structureRaw = (parsed.structure ?? {}) as Record<string, unknown>;
    const essenceRaw = (parsed.essence ?? {}) as Record<string, unknown>;
    const factualRaw = (parsed.factual ?? {}) as Record<string, unknown>;

    const voiceScore = asScore(voiceRaw.score);
    const voiceViolations = asStringArray(voiceRaw.violations);
    const voiceSuggestions = asStringArray(voiceRaw.suggestions);
    // Defensive pass-gate: Claude's `passed` field is trusted, but
    // clamp to the score threshold as a backstop. A claimed pass with
    // score 60 is a bug in the response — treat as fail.
    const voicePassed = asBool(voiceRaw.passed, false) && voiceScore >= INTERACTIVE_VOICE_MIN_SCORE;

    const structureIssues = asStringArray(structureRaw.issues);
    const structureSuggestions = asStringArray(structureRaw.suggestions);
    const structurePassed = asBool(structureRaw.passed, false) && structureIssues.length === 0;

    const essenceViolations = asStringArray(essenceRaw.violations);
    const essenceSuggestions = asStringArray(essenceRaw.suggestions);
    const essencePassed = asBool(essenceRaw.passed, false) && essenceViolations.length === 0;

    const factualIssues = asStringArray(factualRaw.issues);
    const factualSuggestions = asStringArray(factualRaw.suggestions);
    const factualPassed = asBool(factualRaw.passed, false) && factualIssues.length === 0;

    const passed = voicePassed && structurePassed && essencePassed && factualPassed;

    this.setState({
      auditsPerformed: this.state.auditsPerformed + 1,
      auditsPassed: this.state.auditsPassed + (passed ? 1 : 0),
      auditsFailed: this.state.auditsFailed + (passed ? 0 : 1),
    });

    return {
      passed,
      voice: {
        passed: voicePassed,
        score: voiceScore,
        violations: voiceViolations,
        suggestions: voiceSuggestions,
      },
      structure: {
        passed: structurePassed,
        issues: structureIssues,
        suggestions: structureSuggestions,
      },
      essence: {
        passed: essencePassed,
        violations: essenceViolations,
        suggestions: essenceSuggestions,
      },
      factual: {
        passed: factualPassed,
        issues: factualIssues,
        suggestions: factualSuggestions,
      },
      tokensIn,
      tokensOut,
      durationMs: Date.now() - started,
    };
  }
}
