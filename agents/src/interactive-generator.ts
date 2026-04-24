import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './types';
import { extractJson } from './shared/parse-json';
import { PublisherAgent } from './publisher';
import {
  INTERACTIVE_GENERATOR_PROMPT,
  GENERATOR_BODY_EXCERPT_MAX_CHARS,
  QUIZ_MIN_QUESTIONS,
  QUIZ_MAX_QUESTIONS,
  buildInteractivePrompt,
  type PieceContextForQuiz,
  type RecentInteractive,
  type CategoryRow,
} from './interactive-generator-prompt';

/** Number of recently-published interactives to show Claude for the
 *  diversity nudge. Small — the prompt just needs to know "have I
 *  recently taught this?", not a full catalogue. */
const RECENT_INTERACTIVES_FOR_DIVERSITY = 10;

/** Max attempts at suffixing a colliding slug (`-2`, `-3`, …) before
 *  giving up. Five is generous; in practice Claude's slug is derived
 *  from concept, and two different pieces producing the same concept
 *  slug is already the signal to decline or diverge. */
const SLUG_COLLISION_MAX_ATTEMPTS = 5;

/** Strip YAML frontmatter + MDX component tags so the generator sees
 *  teaching prose, not markup. Mirrors the Categoriser helper. */
function stripForExcerpt(mdx: string): string {
  let body = mdx.replace(/^---\n[\s\S]*?\n---\n?/, '');
  body = body.replace(/<[^>]+>/g, '');
  body = body.replace(/\n{3,}/g, '\n\n').trim();
  return body.slice(0, GENERATOR_BODY_EXCERPT_MAX_CHARS);
}

/** Normalise a slug to kebab-case. Defensive — Claude is asked to
 *  return kebab-case, but a malformed response can't poison the URL
 *  space. */
function normaliseSlug(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Shape Claude returns. Validated structurally before anything writes. */
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

/** Validated quiz ready to write. */
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

/** Result surfaced back to Director. */
export interface InteractiveGeneratorResult {
  pieceId: string;
  date: string;
  skipped: boolean;            // true when piece already has interactive_id
  declined: boolean;           // true when Claude returned the empty shape
  committed: boolean;          // true when file + D1 writes landed
  interactiveId: string | null;
  slug: string | null;
  title: string | null;
  concept: string | null;
  questionCount: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

interface InteractiveGeneratorState {
  interactivesGenerated: number;
  interactivesDeclined: number;
}

/**
 * InteractiveGeneratorAgent — 15th agent.
 *
 * Produces a standalone-teaching multiple-choice quiz for a just-
 * published daily piece. The quiz teaches the UNDERLYING CONCEPT —
 * it does not reference the piece. A stranger landing on the quiz's
 * URL should find it useful without having read the piece.
 *
 * Does NOT touch the published piece's content. Does NOT orchestrate —
 * Director schedules it via alarm right after `publishing done`, same
 * shape as Categoriser and Drafter.reflect (off-pipeline, non-
 * blocking, non-retriable).
 *
 * Write path: commits a JSON file to `content/interactives/<slug>.json`
 * via Publisher's `publishToPath`, then INSERTs an `interactives` row
 * in D1 and UPDATEs `daily_pieces.interactive_id`. The file is the
 * source of truth for rendering (sub-task 4.2 decision); the D1 row
 * holds queryable metadata.
 *
 * 4.4 ships STRUCTURAL validation only — JSON shape + counts + index
 * bounds + non-empty strings. The real voice / essence / fact audit
 * lives in InteractiveAuditor (sub-task 4.5), which will wrap this
 * agent's output with up to 3 revision rounds before the commit. For
 * now the prompt's "essence not reference" rule is the quality bar;
 * a structurally-valid but off-concept quiz would still commit.
 *
 * Idempotence:
 *  - Pre-flight check: `daily_pieces.interactive_id` IS NOT NULL →
 *    short-circuit with `skipped: true`, no Claude call.
 *  - Claude's `decline` path (`questions: []`) → no commit, no D1
 *    write, returns `declined: true`. Observer sees it.
 *  - Slug collision: append `-2`, `-3`, … up to 5 attempts. If Claude
 *    keeps proposing an existing slug, that's a signal the concept is
 *    duplicated; fail rather than pollute.
 *
 * Fail-silent posture: throws on failure. Director's alarm catches +
 * routes to `observer.logInteractiveGeneratorFailure`. Piece is live
 * regardless; no interactive is the degraded-but-fine state.
 */
export class InteractiveGeneratorAgent extends Agent<Env, InteractiveGeneratorState> {
  initialState: InteractiveGeneratorState = {
    interactivesGenerated: 0,
    interactivesDeclined: 0,
  };

  /**
   * Generate an interactive for a just-published piece.
   *
   * @param pieceId  daily_pieces.id (UUID)
   * @param date     YYYY-MM-DD — for logging + file path context
   * @param mdx      final published MDX. Caller reads from GitHub so
   *                 the agent stays ignorant of file paths.
   */
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
        interactiveId: piece.interactive_id,
        slug: null,
        title: null,
        concept: null,
        questionCount: 0,
        tokensIn: 0,
        tokensOut: 0,
        durationMs: Date.now() - started,
      };
    }

    // ── 2. Gather context: categories + recent interactives ──────
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

    // ── 3. Ask Claude ────────────────────────────────────────────
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

    let parsed: RawQuiz;
    try {
      parsed = extractJson<RawQuiz>(rawText);
    } catch {
      throw new Error('generate: Claude returned non-JSON output');
    }

    // ── 4. Decline path: empty shape signals intentional skip ────
    const questionsRaw = Array.isArray(parsed.questions) ? parsed.questions : [];
    const slugRaw = typeof parsed.slug === 'string' ? parsed.slug.trim() : '';
    const titleRaw = typeof parsed.title === 'string' ? parsed.title.trim() : '';
    const conceptRaw = typeof parsed.concept === 'string' ? parsed.concept.trim() : '';

    if (questionsRaw.length === 0 && slugRaw === '' && titleRaw === '') {
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
        interactiveId: null,
        slug: null,
        title: null,
        concept: null,
        questionCount: 0,
        tokensIn,
        tokensOut,
        durationMs: Date.now() - started,
      };
    }

    // ── 5. Structural validation ─────────────────────────────────
    const quiz = validateQuiz(parsed);
    // validateQuiz throws on failure — caught by Director's alarm
    // handler and routed to observer.logInteractiveGeneratorFailure.

    // ── 6. Slug collision resolution ─────────────────────────────
    const finalSlug = await this.resolveFreeSlug(quiz.slug);
    quiz.slug = finalSlug;

    // ── 7. Build the content-collection JSON file ────────────────
    const interactiveId = crypto.randomUUID();
    const publishedAt = Date.now();
    const fileContent = JSON.stringify(
      {
        slug: quiz.slug,
        type: 'quiz',
        title: quiz.title,
        concept: quiz.concept,
        interactiveId,
        sourcePieceId: pieceId,
        publishedAt,
        content: {
          type: 'quiz',
          questions: quiz.questions,
        },
      },
      null,
      2,
    ) + '\n';

    const filePath = `content/interactives/${quiz.slug}.json`;

    // ── 8. Commit via Publisher (refuses overwrite, good) ────────
    // Per-interactive publisher stub: keeps SDK state scoped so a
    // failed commit on one interactive can't bleed into another.
    // Matches Director's per-piece scoping pattern.
    const publisher = await this.subAgent(
      PublisherAgent,
      `interactive-publisher-${quiz.slug}`,
    );
    const commitMsg = `feat(interactives): ${quiz.title} (${quiz.slug})`;
    await publisher.publishToPath(filePath, fileContent, commitMsg);

    // ── 9. D1 writes (file is source of truth; row is metadata) ─
    // content_json stays NULL per the 4.2 decision — file is
    // authoritative. voice_score + quality_flag stay NULL until 4.5's
    // auditor populates them. revision_count stays 0 for a fresh
    // generation.
    await this.env.DB
      .prepare(
        `INSERT INTO interactives
         (id, slug, type, title, concept, source_piece_id, content_json,
          voice_score, quality_flag, revision_count, published_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0, ?, ?)`,
      )
      .bind(
        interactiveId,
        quiz.slug,
        'quiz',
        quiz.title,
        quiz.concept,
        pieceId,
        publishedAt,
        publishedAt,
      )
      .run();

    await this.env.DB
      .prepare(`UPDATE daily_pieces SET interactive_id = ? WHERE id = ?`)
      .bind(interactiveId, pieceId)
      .run();

    this.setState({
      ...this.state,
      interactivesGenerated: this.state.interactivesGenerated + 1,
    });

    return {
      pieceId,
      date,
      skipped: false,
      declined: false,
      committed: true,
      interactiveId,
      slug: quiz.slug,
      title: quiz.title,
      concept: quiz.concept,
      questionCount: quiz.questions.length,
      tokensIn,
      tokensOut,
      durationMs: Date.now() - started,
    };
  }

  /**
   * Find a non-colliding slug. If the base collides, suffix `-2`,
   * `-3`, … up to SLUG_COLLISION_MAX_ATTEMPTS. Throws on exhaustion —
   * that many collisions means the concept itself is over-represented
   * and the generator should have declined; failing loudly surfaces
   * the pattern to ops.
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
 * Structural validation of Claude's output. Lives outside the class
 * so it's trivially unit-testable and so the agent method stays
 * readable. Throws with a specific message on first failure — the
 * Director's alarm handler logs the message verbatim to
 * observer_events, so the message IS the ops signal.
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
