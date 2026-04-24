import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './types';
import { extractJson } from './shared/parse-json';
import { PublisherAgent } from './publisher';
import { InteractiveAuditorAgent, type InteractiveAuditResult } from './interactive-auditor';
import {
  INTERACTIVE_GENERATOR_PROMPT,
  GENERATOR_BODY_EXCERPT_MAX_CHARS,
  QUIZ_MIN_QUESTIONS,
  QUIZ_MAX_QUESTIONS,
  buildInteractivePrompt,
  buildRevisionPrompt,
  type PieceContextForQuiz,
  type RecentInteractive,
  type CategoryRow,
  type RevisionFeedback,
} from './interactive-generator-prompt';

/** Number of recently-published interactives to show Claude for the
 *  diversity nudge. */
const RECENT_INTERACTIVES_FOR_DIVERSITY = 10;

/** Max attempts at suffixing a colliding slug (`-2`, `-3`, …). */
const SLUG_COLLISION_MAX_ATTEMPTS = 5;

/** Max revision rounds before ship-or-abandon. Matches the daily-piece
 *  auditor loop's MAX_REVISIONS. 3 rounds = 1 initial + 2 revisions. */
const INTERACTIVE_MAX_ROUNDS = 3;

function stripForExcerpt(mdx: string): string {
  let body = mdx.replace(/^---\n[\s\S]*?\n---\n?/, '');
  body = body.replace(/<[^>]+>/g, '');
  body = body.replace(/\n{3,}/g, '\n\n').trim();
  return body.slice(0, GENERATOR_BODY_EXCERPT_MAX_CHARS);
}

function normaliseSlug(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

interface RawQuestion {
  question?: unknown;
  options?: unknown;
  correctIndex?: unknown;
  explanation?: unknown;
}
interface RawQuiz {
  slug?: unknown;
  title?: unknown;
  concept?: unknown;
  questions?: unknown;
}

interface ValidatedQuiz {
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

/** Brief audit summary suitable for observer logging (plain Claude-free
 *  strings). */
export interface FinalAuditSummary {
  voicePassed: boolean;
  voiceScore: number;
  structurePassed: boolean;
  essencePassed: boolean;
  factualPassed: boolean;
  topIssues: string[]; // first ~5 issues across dimensions for the feed
}

/** Result surfaced back to Director. */
export interface InteractiveGeneratorResult {
  pieceId: string;
  date: string;
  skipped: boolean;            // true when piece already has interactive_id
  declined: boolean;           // true when Claude returned the empty shape
  committed: boolean;          // true when file + D1 writes landed
  auditorMaxFailed: boolean;   // true when ALL rounds failed audit — shipped
                               // as quality_flag='low' alongside committed=true
                               // (2026-04-24 reversal of abandon-on-max-fail).
  qualityFlag: 'low' | null;   // 'low' when auditorMaxFailed on a shipped
                               // round; null when clean pass.
  interactiveId: string | null;
  slug: string | null;
  title: string | null;
  concept: string | null;
  questionCount: number;
  revisionCount: number;       // 0 = passed first round, 1 = passed round 2, …
  roundsUsed: number;          // total rounds executed (1, 2, or 3)
  voiceScore: number | null;   // final round's voice score when audit ran
  finalAudit: FinalAuditSummary | null; // only set when audit ran
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

interface InteractiveGeneratorState {
  interactivesGenerated: number;
  interactivesDeclined: number;
  interactivesAuditorMaxFailed: number;
}

/**
 * InteractiveGeneratorAgent — 15th agent.
 *
 * Produces a standalone-teaching multiple-choice quiz for a just-
 * published daily piece. The quiz teaches the UNDERLYING CONCEPT —
 * it does not reference the piece. A stranger landing on the quiz's
 * URL should find it useful without having read the piece.
 *
 * Generator owns the produce → audit → revise loop (4.5). Up to 3
 * rounds, matching the daily-piece auditor pattern. Auditor is an
 * internal sub-agent — Director's alarm just calls `generate()` and
 * gets back a terminal result.
 *
 * Loop:
 *   round 1: produce initial quiz → structural validate → audit
 *   round 2..3 (only if prior round failed): revise with audit feedback
 *   → structural validate → audit
 *
 * Terminal states:
 *   - `skipped`       daily_pieces.interactive_id already set
 *   - `declined`      Claude returned the empty shape (first round or
 *                     any revision round — concept-too-redundant)
 *   - `committed (clean)`  a round passed all four audit dimensions;
 *                     file + D1 rows written with quality_flag=NULL.
 *                     Result shape: {committed: true, auditorMaxFailed:
 *                     false, qualityFlag: null}.
 *   - `committed (low)`  3 rounds exhausted without passing audit;
 *                     the LAST attempt is still shipped with
 *                     quality_flag='low'. File + D1 rows written;
 *                     last-beat prompt surfaces it; admin UI marks
 *                     it FLAGGED LOW. Result shape: {committed: true,
 *                     auditorMaxFailed: true, qualityFlag: 'low'}.
 *                     See DECISIONS 2026-04-24 "Loosen essence rule
 *                     + ship-as-low on max-fail" — this reverses
 *                     4.5's abandon-not-low decision.
 *
 * Why ship-as-low (2026-04-24 reversal of 4.5's abandon posture):
 *   - 4.5 abandoned on max-fail because "no mostly-fine salvage from a
 *     max-failed round" — but the real-world 2026-04-24 FISA piece ran
 *     showed max-fails were caused by the auditor's over-strict
 *     interpretation of "pattern-match to details" (catching concept
 *     echoes and structural analogies, not concrete detail leaks).
 *   - The paired essence-rule loosening makes genuine max-fails rare;
 *     when they do happen, a 3-rounds-refined quiz is still a better
 *     reader artefact than a 404. "It can't be that bad after 3 tries"
 *     (user, 2026-04-24).
 *   - Permanence rule still respected — quality_flag='low' is the same
 *     mechanism daily_pieces use for sub-85 voice score; readers see a
 *     "Rough" tier tag, admin sees "FLAGGED LOW", operator can retry.
 *
 * Does NOT touch the published piece's content. Does NOT orchestrate.
 * Fail-silent posture: throws on infrastructure failure (Claude down,
 * DB error, GitHub 5xx). Director's alarm catches + routes to
 * observer.logInteractiveGeneratorFailure. Auditor rejection is NOT
 * an infrastructure failure — it's an expected path that returns a
 * structured result with `auditorMaxFailed: true`.
 */
export class InteractiveGeneratorAgent extends Agent<Env, InteractiveGeneratorState> {
  initialState: InteractiveGeneratorState = {
    interactivesGenerated: 0,
    interactivesDeclined: 0,
    interactivesAuditorMaxFailed: 0,
  };

  async generate(
    pieceId: string,
    date: string,
    mdx: string,
  ): Promise<InteractiveGeneratorResult> {
    const started = Date.now();

    // ── 1. Idempotence guard ─────────────────────────────────────
    const piece = await this.env.DB
      .prepare(
        `SELECT headline, underlying_subject, interactive_id
         FROM daily_pieces WHERE id = ? LIMIT 1`,
      )
      .bind(pieceId)
      .first<{
        headline: string;
        underlying_subject: string | null;
        interactive_id: string | null;
      }>();

    if (!piece) {
      throw new Error(`generate: no daily_pieces row for id ${pieceId}`);
    }

    if (piece.interactive_id) {
      return {
        pieceId,
        date,
        skipped: true,
        declined: false,
        committed: false,
        auditorMaxFailed: false,
        qualityFlag: null,
        interactiveId: piece.interactive_id,
        slug: null,
        title: null,
        concept: null,
        questionCount: 0,
        revisionCount: 0,
        roundsUsed: 0,
        voiceScore: null,
        finalAudit: null,
        tokensIn: 0,
        tokensOut: 0,
        durationMs: Date.now() - started,
      };
    }

    // ── 2. Gather context ────────────────────────────────────────
    const catsRes = await this.env.DB
      .prepare(
        `SELECT c.name, c.slug
         FROM piece_categories pc
         JOIN categories c ON c.id = pc.category_id
         WHERE pc.piece_id = ?`,
      )
      .bind(pieceId)
      .all<{ name: string; slug: string }>();
    const categories: CategoryRow[] = catsRes.results.map((r) => ({
      name: r.name,
      slug: r.slug,
    }));

    const recentRes = await this.env.DB
      .prepare(
        `SELECT slug, title, concept
         FROM interactives
         WHERE published_at IS NOT NULL
         ORDER BY published_at DESC
         LIMIT ?`,
      )
      .bind(RECENT_INTERACTIVES_FOR_DIVERSITY)
      .all<{ slug: string; title: string; concept: string | null }>();
    const recent: RecentInteractive[] = recentRes.results.map((r) => ({
      slug: r.slug,
      title: r.title,
      concept: r.concept,
    }));

    const pieceContext: PieceContextForQuiz = {
      headline: piece.headline,
      underlyingSubject: piece.underlying_subject,
      bodyExcerpt: stripForExcerpt(mdx),
      categories,
    };

    // ── 3. Produce → audit → revise loop ─────────────────────────
    const auditor = await this.subAgent(
      InteractiveAuditorAgent,
      `interactive-auditor-${pieceId}`,
    );

    let cumulativeTokensIn = 0;
    let cumulativeTokensOut = 0;
    let lastQuiz: ValidatedQuiz | null = null;
    let lastAudit: InteractiveAuditResult | null = null;
    let passed = false;
    let declinedInLoop = false;
    let roundsUsed = 0;

    for (let round = 1; round <= INTERACTIVE_MAX_ROUNDS; round += 1) {
      roundsUsed = round;

      // Produce (round 1) or revise (round 2+).
      let produced: ValidatedQuiz | null;
      let tokensIn = 0;
      let tokensOut = 0;

      if (round === 1) {
        const res = await this.produceQuiz(pieceContext, recent);
        produced = res.quiz;
        tokensIn = res.tokensIn;
        tokensOut = res.tokensOut;
      } else {
        if (!lastQuiz || !lastAudit) {
          // Invariant — rounds 2+ require both. Bail loudly.
          throw new Error(
            `generate: round ${round} has no previous quiz or audit to revise from`,
          );
        }
        const res = await this.reviseQuiz(
          lastQuiz,
          lastAudit,
          pieceContext,
          recent,
          round,
        );
        produced = res.quiz;
        tokensIn = res.tokensIn;
        tokensOut = res.tokensOut;
      }

      cumulativeTokensIn += tokensIn;
      cumulativeTokensOut += tokensOut;

      if (!produced) {
        // Decline — Claude returned the empty shape. Treat as terminal.
        declinedInLoop = true;
        break;
      }

      lastQuiz = produced;

      // Audit what was produced.
      const audit = await auditor.audit(
        {
          slug: produced.slug,
          title: produced.title,
          concept: produced.concept,
          questions: produced.questions,
        },
        {
          headline: piece.headline,
          underlyingSubject: piece.underlying_subject,
          bodyExcerpt: pieceContext.bodyExcerpt,
        },
      );
      lastAudit = audit;
      cumulativeTokensIn += audit.tokensIn;
      cumulativeTokensOut += audit.tokensOut;

      if (audit.passed) {
        passed = true;
        break;
      }
      // Failed — if more rounds remain, loop back; otherwise fall
      // through to the max-fail terminal.
    }

    // ── 4. Terminal state handling ───────────────────────────────
    if (declinedInLoop) {
      this.setState({
        ...this.state,
        interactivesDeclined: this.state.interactivesDeclined + 1,
      });
      return {
        pieceId,
        date,
        skipped: false,
        declined: true,
        committed: false,
        auditorMaxFailed: false,
        qualityFlag: null,
        interactiveId: null,
        slug: null,
        title: null,
        concept: null,
        questionCount: 0,
        revisionCount: Math.max(0, roundsUsed - 1),
        roundsUsed,
        voiceScore: lastAudit?.voice.score ?? null,
        finalAudit: lastAudit ? summariseAudit(lastAudit) : null,
        tokensIn: cumulativeTokensIn,
        tokensOut: cumulativeTokensOut,
        durationMs: Date.now() - started,
      };
    }

    // ── 5. Commit path — passed cleanly OR shipped-as-low ────────
    //
    // Both paths fall through to the same commit logic. The only
    // difference is `qualityFlag`: null for clean passes, 'low' when
    // all rounds failed audit (2026-04-24 reversal of 4.5's abandon).
    // `auditorMaxFailed` stays as a terminal-semantics flag so observers
    // + admin surfaces can distinguish shipped-clean vs shipped-low.
    if (!lastQuiz) {
      throw new Error('generate: commit path reached without a lastQuiz');
    }
    const qualityFlag: 'low' | null = passed ? null : 'low';
    const auditorMaxFailed = !passed;

    const finalSlug = await this.resolveFreeSlug(lastQuiz.slug);
    lastQuiz.slug = finalSlug;

    const interactiveId = crypto.randomUUID();
    const publishedAt = Date.now();
    const fileContent = JSON.stringify(
      {
        slug: lastQuiz.slug,
        type: 'quiz',
        title: lastQuiz.title,
        concept: lastQuiz.concept,
        interactiveId,
        sourcePieceId: pieceId,
        publishedAt,
        voiceScore: lastAudit?.voice.score ?? undefined,
        // Only write qualityFlag when 'low'; omit when clean so the
        // content-collection schema's `.optional()` stays the default.
        ...(qualityFlag === 'low' ? { qualityFlag: 'low' } : {}),
        content: {
          type: 'quiz',
          questions: lastQuiz.questions,
        },
      },
      null,
      2,
    ) + '\n';

    const filePath = `content/interactives/${lastQuiz.slug}.json`;

    const publisher = await this.subAgent(
      PublisherAgent,
      `interactive-publisher-${lastQuiz.slug}`,
    );
    const commitMsg = qualityFlag === 'low'
      ? `feat(interactives): ${lastQuiz.title} (${lastQuiz.slug}) [flagged low]`
      : `feat(interactives): ${lastQuiz.title} (${lastQuiz.slug})`;
    await publisher.publishToPath(filePath, fileContent, commitMsg);

    const voiceScore = lastAudit?.voice.score ?? null;
    const revisionCount = roundsUsed - 1;

    await this.env.DB
      .prepare(
        `INSERT INTO interactives
         (id, slug, type, title, concept, source_piece_id, content_json,
          voice_score, quality_flag, revision_count, published_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
      )
      .bind(
        interactiveId,
        lastQuiz.slug,
        'quiz',
        lastQuiz.title,
        lastQuiz.concept,
        pieceId,
        voiceScore,
        qualityFlag,
        revisionCount,
        publishedAt,
        publishedAt,
      )
      .run();

    await this.env.DB
      .prepare(`UPDATE daily_pieces SET interactive_id = ? WHERE id = ?`)
      .bind(interactiveId, pieceId)
      .run();

    // Counter bookkeeping: bump `interactivesGenerated` either way (a
    // shipped-low interactive is still generated content on the site).
    // Bump `interactivesAuditorMaxFailed` only on the low path so the
    // ratio clean-vs-low stays legible in the DO state.
    this.setState({
      ...this.state,
      interactivesGenerated: this.state.interactivesGenerated + 1,
      interactivesAuditorMaxFailed:
        this.state.interactivesAuditorMaxFailed + (auditorMaxFailed ? 1 : 0),
    });

    return {
      pieceId,
      date,
      skipped: false,
      declined: false,
      committed: true,
      auditorMaxFailed,
      qualityFlag,
      interactiveId,
      slug: lastQuiz.slug,
      title: lastQuiz.title,
      concept: lastQuiz.concept,
      questionCount: lastQuiz.questions.length,
      revisionCount,
      roundsUsed,
      voiceScore,
      finalAudit: lastAudit ? summariseAudit(lastAudit) : null,
      tokensIn: cumulativeTokensIn,
      tokensOut: cumulativeTokensOut,
      durationMs: Date.now() - started,
    };
  }

  /**
   * Round 1 — initial produce. Returns null quiz if Claude declined
   * (empty shape). Throws on infrastructure failure or structural
   * validation failure.
   */
  private async produceQuiz(
    pieceContext: PieceContextForQuiz,
    recent: RecentInteractive[],
  ): Promise<{ quiz: ValidatedQuiz | null; tokensIn: number; tokensOut: number }> {
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 3000,
      system: INTERACTIVE_GENERATOR_PROMPT,
      messages: [
        { role: 'user', content: buildInteractivePrompt(pieceContext, recent) },
      ],
    });

    const rawText = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const tokensIn = response.usage?.input_tokens ?? 0;
    const tokensOut = response.usage?.output_tokens ?? 0;

    return {
      quiz: parseAndValidate(rawText),
      tokensIn,
      tokensOut,
    };
  }

  /**
   * Rounds 2+ — revise the previous attempt with auditor feedback.
   * Same system prompt (essence-not-reference rule doesn't relax on
   * retry); the user message carries the prior quiz + the audit
   * violations. Returns null quiz if Claude declines mid-revision.
   */
  private async reviseQuiz(
    previous: ValidatedQuiz,
    audit: InteractiveAuditResult,
    pieceContext: PieceContextForQuiz,
    recent: RecentInteractive[],
    round: number,
  ): Promise<{ quiz: ValidatedQuiz | null; tokensIn: number; tokensOut: number }> {
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });
    const feedback: RevisionFeedback = {
      voice: {
        passed: audit.voice.passed,
        score: audit.voice.score,
        issues: audit.voice.violations,
        suggestions: audit.voice.suggestions,
      },
      structure: {
        passed: audit.structure.passed,
        issues: audit.structure.issues,
        suggestions: audit.structure.suggestions,
      },
      essence: {
        passed: audit.essence.passed,
        issues: audit.essence.violations,
        suggestions: audit.essence.suggestions,
      },
      factual: {
        passed: audit.factual.passed,
        issues: audit.factual.issues,
        suggestions: audit.factual.suggestions,
      },
    };
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 3000,
      system: INTERACTIVE_GENERATOR_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildRevisionPrompt(previous, feedback, pieceContext, recent, round),
        },
      ],
    });

    const rawText = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const tokensIn = response.usage?.input_tokens ?? 0;
    const tokensOut = response.usage?.output_tokens ?? 0;

    return {
      quiz: parseAndValidate(rawText),
      tokensIn,
      tokensOut,
    };
  }

  /**
   * Find a non-colliding slug. Only called on the passed path; a
   * max-failed or declined attempt never reserves a slug.
   */
  private async resolveFreeSlug(base: string): Promise<string> {
    const normalised = normaliseSlug(base);
    if (normalised.length === 0) {
      throw new Error('resolveFreeSlug: empty slug after normalisation');
    }

    const isFree = async (candidate: string): Promise<boolean> => {
      const hit = await this.env.DB
        .prepare('SELECT 1 FROM interactives WHERE slug = ? LIMIT 1')
        .bind(candidate)
        .first<{ 1: number }>();
      return !hit;
    };

    if (await isFree(normalised)) return normalised;
    for (let n = 2; n <= SLUG_COLLISION_MAX_ATTEMPTS; n += 1) {
      const candidate = `${normalised}-${n}`.slice(0, 60);
      if (await isFree(candidate)) return candidate;
    }
    throw new Error(
      `resolveFreeSlug: "${normalised}" and ${SLUG_COLLISION_MAX_ATTEMPTS - 1} numbered variants all taken`,
    );
  }
}

/**
 * Shared parse + validate. Returns null on the decline shape; throws
 * with a specific error message on structural validation failure or
 * non-JSON output.
 */
function parseAndValidate(rawText: string): ValidatedQuiz | null {
  let parsed: RawQuiz;
  try {
    parsed = extractJson<RawQuiz>(rawText);
  } catch {
    throw new Error('parseAndValidate: Claude returned non-JSON output');
  }

  const questionsRaw = Array.isArray(parsed.questions) ? parsed.questions : [];
  const slugRaw = typeof parsed.slug === 'string' ? parsed.slug.trim() : '';
  const titleRaw = typeof parsed.title === 'string' ? parsed.title.trim() : '';

  // Decline shape: all-empty.
  if (questionsRaw.length === 0 && slugRaw === '' && titleRaw === '') {
    return null;
  }

  return validateQuiz(parsed);
}

/**
 * Structural validation of Claude's output. Throws with a specific
 * message on first failure — Director's alarm handler logs verbatim
 * to observer_events, so the message IS the ops signal.
 */
function validateQuiz(raw: RawQuiz): ValidatedQuiz {
  const slug = typeof raw.slug === 'string' ? raw.slug.trim() : '';
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const concept = typeof raw.concept === 'string' ? raw.concept.trim() : '';
  const questionsRaw = Array.isArray(raw.questions) ? raw.questions : [];

  if (slug.length === 0) throw new Error('validateQuiz: empty slug');
  if (title.length === 0) throw new Error('validateQuiz: empty title');
  if (concept.length === 0) throw new Error('validateQuiz: empty concept');
  if (questionsRaw.length < QUIZ_MIN_QUESTIONS || questionsRaw.length > QUIZ_MAX_QUESTIONS) {
    throw new Error(
      `validateQuiz: question count ${questionsRaw.length} out of bounds [${QUIZ_MIN_QUESTIONS}, ${QUIZ_MAX_QUESTIONS}]`,
    );
  }

  const questions: ValidatedQuiz['questions'] = [];
  for (let i = 0; i < questionsRaw.length; i += 1) {
    const q = questionsRaw[i] as RawQuestion;
    const question = typeof q.question === 'string' ? q.question.trim() : '';
    const options = Array.isArray(q.options)
      ? q.options.map((o) => (typeof o === 'string' ? o.trim() : ''))
      : [];
    const correctIndex = typeof q.correctIndex === 'number' && Number.isInteger(q.correctIndex)
      ? q.correctIndex
      : -1;
    const explanation = typeof q.explanation === 'string' ? q.explanation.trim() : '';

    if (question.length === 0) {
      throw new Error(`validateQuiz: question ${i + 1} has empty text`);
    }
    if (options.length < 2 || options.length > 6) {
      throw new Error(
        `validateQuiz: question ${i + 1} has ${options.length} options, must be 2–6`,
      );
    }
    if (options.some((o) => o.length === 0)) {
      throw new Error(`validateQuiz: question ${i + 1} has an empty option`);
    }
    if (correctIndex < 0 || correctIndex >= options.length) {
      throw new Error(
        `validateQuiz: question ${i + 1} correctIndex ${correctIndex} out of bounds for ${options.length} options`,
      );
    }
    if (explanation.length === 0) {
      throw new Error(`validateQuiz: question ${i + 1} has empty explanation`);
    }
    questions.push({ question, options, correctIndex, explanation });
  }

  return { slug, title, concept, questions };
}

/**
 * Compress a full InteractiveAuditResult into a flat summary suitable
 * for observer events. Keeps the top few cross-dimension issues so
 * the admin feed has concrete context without pulling the full JSON.
 */
function summariseAudit(audit: InteractiveAuditResult): FinalAuditSummary {
  const issues: string[] = [
    ...audit.voice.violations.map((v) => `voice: ${v}`),
    ...audit.structure.issues.map((i) => `structure: ${i}`),
    ...audit.essence.violations.map((v) => `essence: ${v}`),
    ...audit.factual.issues.map((i) => `factual: ${i}`),
  ].slice(0, 5);

  return {
    voicePassed: audit.voice.passed,
    voiceScore: audit.voice.score,
    structurePassed: audit.structure.passed,
    essencePassed: audit.essence.passed,
    factualPassed: audit.factual.passed,
    topIssues: issues,
  };
}
