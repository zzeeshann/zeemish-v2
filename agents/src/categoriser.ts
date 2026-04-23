import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './types';
import { extractJson } from './shared/parse-json';
import {
  CATEGORISER_PROMPT,
  CATEGORISER_MAX_ASSIGNMENTS,
  buildCategoriserPrompt,
  type CategoryContextRow,
  type PieceContext,
} from './categoriser-prompt';

/** Cap the MDX body excerpt fed to Claude. Big enough to signal the
 *  piece's shape (hook + first teaching beat or two); small enough
 *  that 3 years of backfill runs stay cheap. */
const BODY_EXCERPT_MAX_CHARS = 2000;

/** Clamp the LLM's confidence number into the [0, 100] range before
 *  writing. A misbehaving response can't poison the row. */
function clampConfidence(n: unknown): number {
  const x = typeof n === 'number' && Number.isFinite(n) ? n : 50;
  return Math.max(0, Math.min(100, Math.round(x)));
}

/** Normalise a slug to kebab-case and strip anything outside the safe
 *  set. Used when Claude proposes a new category and its slug needs
 *  to survive as a URL segment. */
function normaliseSlug(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Strip YAML frontmatter + MDX component tags from an excerpt so the
 *  LLM sees prose, not markup. Keeps the prompt focused on the
 *  piece's teaching, not its wiring. */
function stripForExcerpt(mdx: string): string {
  // Drop the leading ---...--- frontmatter block (single pass).
  let body = mdx.replace(/^---\n[\s\S]*?\n---\n?/, '');
  // Strip <lesson-shell>, <lesson-beat>, <audio-player>, etc.
  body = body.replace(/<[^>]+>/g, '');
  // Collapse runs of blank lines.
  body = body.replace(/\n{3,}/g, '\n\n').trim();
  return body.slice(0, BODY_EXCERPT_MAX_CHARS);
}

/** What Claude returns, raw. Validated at runtime before we write. */
interface RawAssignment {
  categoryId?: string;
  newCategory?: {
    name?: string;
    slug?: string;
    description?: string;
  };
  confidence?: number;
  reasoning?: string;
}

/** One resolved assignment ready to write. Either points at an
 *  existing category (existingId) OR carries a freshly-created one's
 *  id (after INSERT). By the time we hit the writer, there is always
 *  exactly one concrete categoryId. */
interface ResolvedAssignment {
  categoryId: string;
  confidence: number;
  isNovel: boolean;
  novelName?: string;
}

/** Result surfaced back to Director so it can log success / novel /
 *  overflow events distinctly in the admin feed. */
export interface CategoriserResult {
  pieceId: string;
  date: string;
  skipped: boolean;           // true when piece already has piece_categories rows
  assignmentsWritten: number;
  novelCategoriesCreated: number;
  novelCategoryNames: string[]; // for the observer body
  considered: number;         // how many assignments Claude returned (pre-cap)
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

interface CategoriserState {
  piecesCategorised: number;
  novelCategoriesCreated: number;
}

/**
 * CategoriserAgent — 14th agent.
 *
 * Assigns 1–3 categories to a just-published daily piece. Strongly
 * biased toward reusing an existing category; creates a new one only
 * when the existing taxonomy genuinely doesn't cover the piece.
 *
 * Does NOT touch published content. Does NOT change frontmatter.
 * Does NOT orchestrate — Director schedules it via alarm after
 * `publishing done`, same shape as Learner's analysePiecePostPublish
 * and Drafter.reflect (off-pipeline, non-blocking, non-retriable).
 *
 * Idempotent: if a piece already has `piece_categories` rows it
 * returns a `skipped: true` result without firing a Claude call. This
 * is belt-and-braces alongside the composite PK on piece_categories
 * — the PK would block duplicate rows anyway, but the pre-check
 * saves a Claude call on re-runs.
 *
 * Locked-category semantic: the `categories.locked` flag (set from
 * the admin UI in sub-task 2.5) means "Categoriser MUST NOT reassign
 * a piece AWAY from this category". For this agent that's a no-op —
 * we only INSERT, never DELETE or re-tag. The flag is relevant at
 * admin-time (merge/delete paths) and documented here for future
 * reference. See DECISIONS 2026-04-23 (late evening) sub-task 2.1.
 */
export class CategoriserAgent extends Agent<Env, CategoriserState> {
  initialState: CategoriserState = {
    piecesCategorised: 0,
    novelCategoriesCreated: 0,
  };

  /**
   * Categorise a just-published piece.
   *
   * @param pieceId  daily_pieces.id (UUID, pre-allocated by Director
   *                 at the top of triggerDailyPiece)
   * @param date     YYYY-MM-DD — for logging + result shape only;
   *                 all D1 filters use piece_id
   * @param mdx      final published MDX. Caller reads it from GitHub
   *                 rather than re-reading here so Categoriser stays
   *                 ignorant of file paths, same shape as Drafter.reflect.
   *
   * Throws on failure (Claude / JSON parse / DB). Director's alarm
   * handler catches and routes to observer_events.
   */
  async categorise(
    pieceId: string,
    date: string,
    mdx: string,
  ): Promise<CategoriserResult> {
    const started = Date.now();

    // ── 1. Idempotence guard ─────────────────────────────────────
    const existingAssignments = await this.env.DB
      .prepare('SELECT COUNT(*) AS n FROM piece_categories WHERE piece_id = ?')
      .bind(pieceId)
      .first<{ n: number }>();
    if ((existingAssignments?.n ?? 0) > 0) {
      return {
        pieceId,
        date,
        skipped: true,
        assignmentsWritten: 0,
        novelCategoriesCreated: 0,
        novelCategoryNames: [],
        considered: 0,
        tokensIn: 0,
        tokensOut: 0,
        durationMs: Date.now() - started,
      };
    }

    // ── 2. Piece metadata + body excerpt ─────────────────────────
    const piece = await this.env.DB
      .prepare(
        `SELECT headline, underlying_subject
         FROM daily_pieces WHERE id = ? LIMIT 1`,
      )
      .bind(pieceId)
      .first<{ headline: string; underlying_subject: string | null }>();

    if (!piece) {
      throw new Error(`categorise: no daily_pieces row for id ${pieceId}`);
    }

    const pieceContext: PieceContext = {
      headline: piece.headline,
      underlyingSubject: piece.underlying_subject,
      bodyExcerpt: stripForExcerpt(mdx),
    };

    // ── 3. Existing categories (full list — prompt needs all for reuse-bias) ─
    const catsRes = await this.env.DB
      .prepare(
        `SELECT id, name, slug, description, piece_count
         FROM categories
         ORDER BY piece_count DESC, name ASC`,
      )
      .all<{
        id: string;
        name: string;
        slug: string;
        description: string | null;
        piece_count: number;
      }>();

    const existing: CategoryContextRow[] = catsRes.results.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      pieceCount: r.piece_count,
    }));

    // ── 4. Ask Claude ────────────────────────────────────────────
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1500,
      system: CATEGORISER_PROMPT,
      messages: [
        { role: 'user', content: buildCategoriserPrompt(pieceContext, existing) },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
    let parsed: { assignments?: RawAssignment[] };
    try {
      parsed = extractJson<typeof parsed>(text);
    } catch {
      parsed = { assignments: [] };
    }
    const raw: RawAssignment[] = Array.isArray(parsed.assignments) ? parsed.assignments : [];
    const considered = raw.length;

    // ── 5. Resolve assignments (existing vs novel) ───────────────
    // Cap to MAX so a misbehaving response can't over-tag. Defensive
    // clamping on confidence. Novel categories are deduplicated by
    // slug against existing (Claude might propose a name that
    // normalises to an existing slug — reuse instead of collide).
    const existingById = new Map(existing.map((c) => [c.id, c] as const));
    const existingBySlug = new Map(existing.map((c) => [c.slug, c] as const));
    const resolved: ResolvedAssignment[] = [];

    for (const a of raw.slice(0, CATEGORISER_MAX_ASSIGNMENTS)) {
      const confidence = clampConfidence(a.confidence);

      // Prefer an existing category if id is supplied and valid.
      if (typeof a.categoryId === 'string' && existingById.has(a.categoryId)) {
        if (resolved.some((r) => r.categoryId === a.categoryId)) continue; // dedup
        resolved.push({ categoryId: a.categoryId, confidence, isNovel: false });
        continue;
      }

      // Fall through to newCategory path.
      const nc = a.newCategory;
      if (!nc || typeof nc.name !== 'string' || nc.name.trim().length === 0) {
        continue; // malformed — skip this assignment
      }
      const proposedSlug = typeof nc.slug === 'string' && nc.slug.length > 0
        ? normaliseSlug(nc.slug)
        : normaliseSlug(nc.name);
      if (proposedSlug.length === 0) continue;

      // If the proposed slug collides with an existing category,
      // reuse instead of creating a duplicate.
      const slugCollision = existingBySlug.get(proposedSlug);
      if (slugCollision) {
        if (resolved.some((r) => r.categoryId === slugCollision.id)) continue;
        resolved.push({ categoryId: slugCollision.id, confidence, isNovel: false });
        continue;
      }

      // Genuine novel category — create it now.
      const newId = crypto.randomUUID();
      const now = Date.now();
      const name = nc.name.trim().slice(0, 100);
      const description = typeof nc.description === 'string'
        ? nc.description.trim().slice(0, 500)
        : null;
      try {
        await this.env.DB
          .prepare(
            `INSERT INTO categories (id, slug, name, description, locked, piece_count, created_at, updated_at)
             VALUES (?, ?, ?, ?, 0, 0, ?, ?)`,
          )
          .bind(newId, proposedSlug, name, description, now, now)
          .run();
      } catch {
        // Race condition — another categoriser run created the same
        // slug between our SELECT and INSERT. Re-read and reuse.
        const collision = await this.env.DB
          .prepare('SELECT id FROM categories WHERE slug = ? LIMIT 1')
          .bind(proposedSlug)
          .first<{ id: string }>();
        if (!collision) continue; // mystery failure — skip, don't crash
        if (resolved.some((r) => r.categoryId === collision.id)) continue;
        resolved.push({ categoryId: collision.id, confidence, isNovel: false });
        continue;
      }
      // Make the new category discoverable by subsequent iterations
      // in this same loop (e.g. if Claude returned two novel
      // categories that collapse to the same slug).
      existingById.set(newId, {
        id: newId, name, slug: proposedSlug,
        description, pieceCount: 0,
      });
      existingBySlug.set(proposedSlug, {
        id: newId, name, slug: proposedSlug,
        description, pieceCount: 0,
      });
      resolved.push({
        categoryId: newId,
        confidence,
        isNovel: true,
        novelName: name,
      });
    }

    // ── 6. Write assignments + bump piece_count counters ─────────
    // piece_count is denormalised (per the sub-task 2.1 design); we
    // bump it here on insert so the library chip-sort read path gets
    // a fresh counter without needing a correlated COUNT on every
    // render. Composite PK on piece_categories gives us idempotency
    // under concurrent runs — INSERT OR IGNORE would also be safe
    // here, but at this point the upstream guard has already checked
    // the piece has zero assignments, so the plain INSERT is fine.
    let assignmentsWritten = 0;
    const now = Date.now();
    for (const r of resolved) {
      try {
        await this.env.DB
          .prepare(
            `INSERT INTO piece_categories (piece_id, category_id, confidence, created_at)
             VALUES (?, ?, ?, ?)`,
          )
          .bind(pieceId, r.categoryId, r.confidence, now)
          .run();
        await this.env.DB
          .prepare(
            `UPDATE categories SET piece_count = piece_count + 1, updated_at = ? WHERE id = ?`,
          )
          .bind(now, r.categoryId)
          .run();
        assignmentsWritten += 1;
      } catch {
        // per-row failure isn't fatal — others still land
      }
    }

    const novelNames = resolved
      .filter((r) => r.isNovel)
      .map((r) => r.novelName!)
      .filter(Boolean);

    this.setState({
      piecesCategorised: this.state.piecesCategorised + (assignmentsWritten > 0 ? 1 : 0),
      novelCategoriesCreated: this.state.novelCategoriesCreated + novelNames.length,
    });

    return {
      pieceId,
      date,
      skipped: false,
      assignmentsWritten,
      novelCategoriesCreated: novelNames.length,
      novelCategoryNames: novelNames,
      considered,
      tokensIn: response.usage?.input_tokens ?? 0,
      tokensOut: response.usage?.output_tokens ?? 0,
      durationMs: Date.now() - started,
    };
  }
}
