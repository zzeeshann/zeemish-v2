import { Agent } from 'agents';
import { VoiceAuditorAgent } from './voice-auditor';
import { StructureEditorAgent } from './structure-editor';
import { FactCheckerAgent } from './fact-checker';
import { IntegratorAgent } from './integrator';
import { PublisherAgent } from './publisher';
import { ObserverAgent } from './observer';
import { ScannerAgent } from './scanner';
import type { Env, DirectorState, DailyPieceBrief } from './types';
import type { VoiceAuditResult } from './voice-auditor';
import type { StructureAuditResult } from './structure-editor';
import type { FactCheckResult } from './fact-checker';

import { VOICE_CONTRACT } from './shared/voice-contract';
import { DAILY_DIRECTOR_PROMPT, DAILY_DRAFTER_PROMPT, buildDailyDirectorPrompt, buildDailyDrafterPrompt } from './shared/prompts';
import { extractJson } from './shared/parse-json';
import Anthropic from '@anthropic-ai/sdk';

const MAX_REVISIONS = 3;

/**
 * DirectorAgent — the top-level supervisor.
 *
 * Daily pieces ONLY. No course lessons.
 * Scheduled at 2:00 AM UTC weekdays.
 *
 * Pipeline: Scanner → Director picks story → Draft → 3 auditors in parallel
 * → Integrator revises if needed → Publisher commits to GitHub
 */
export class DirectorAgent extends Agent<Env, DirectorState> {
  initialState: DirectorState = {
    status: 'idle',
    currentTask: null,
    lastDailyPiece: null,
    error: null,
  };

  /** Set up daily scheduled run — cancel any old schedules first */
  async onStart() {
    // Cancel ALL existing schedules (clears any stale 8am course schedule)
    const existing = await this.getSchedules();
    for (const schedule of existing) {
      await this.cancelSchedule(schedule.id);
    }
    // Set the one schedule we want: daily piece at 2:00 AM UTC
    await this.schedule('0 2 * * *', 'dailyRun', { type: 'daily-piece' });
  }

  /**
   * Daily run — scheduled at 2:00 AM UTC.
   * Weekdays: news-driven piece.
   * Weekends: skip (for now).
   */
  async dailyRun() {
    const dayOfWeek = new Date().getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    if (isWeekend) return; // Skip weekends for now

    try {
      await this.triggerDailyPiece();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Daily run failed';
      const observer = await this.subAgent(ObserverAgent, 'observer');
      await observer.logError('daily', 0, message);
    }
  }

  /**
   * Produce one daily teaching piece from today's news.
   * Guards: won't produce if today's piece already exists.
   */
  async triggerDailyPiece(): Promise<{ brief: DailyPieceBrief; mdx: string } | null> {
    const today = new Date().toISOString().slice(0, 10);

    // GUARD: check if today's piece already exists in D1
    const existing = await this.env.DB
      .prepare('SELECT id FROM daily_pieces WHERE date = ? LIMIT 1')
      .bind(today)
      .first();
    if (existing) {
      return null; // Already published today — don't duplicate
    }

    // Step 1: Scanner fetches news
    this.setState({ ...this.state, status: 'scanning', currentTask: `daily/${today}` });
    const scanner = await this.subAgent(ScannerAgent, 'scanner');
    const candidates = await scanner.scan();

    if (candidates.length === 0) {
      const observer = await this.subAgent(ObserverAgent, 'observer');
      await observer.logError('daily', 0, 'Scanner found no candidates');
      this.setState({ ...this.state, status: 'idle', currentTask: null });
      return null;
    }

    // Step 2: Director picks the best story
    this.setState({ ...this.state, status: 'curating' });
    const recentPieces = await this.getRecentDailyPieces(30);
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });

    const evalResponse = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 3000,
      system: DAILY_DIRECTOR_PROMPT,
      messages: [{ role: 'user', content: buildDailyDirectorPrompt(candidates, recentPieces) }],
    });

    const evalText = evalResponse.content[0].type === 'text' ? evalResponse.content[0].text : '{}';
    const brief = extractJson<DailyPieceBrief & { skip?: boolean; selectedCandidateId?: string }>(evalText);

    if (brief.skip) {
      const observer = await this.subAgent(ObserverAgent, 'observer');
      await observer.logError('daily', 0, 'No teachable stories today — skipping');
      this.setState({ ...this.state, status: 'idle', currentTask: null });
      return null;
    }

    // Mark selected candidate in D1
    if (brief.selectedCandidateId) {
      await this.env.DB
        .prepare('UPDATE daily_candidates SET selected = 1, teachability_score = 100 WHERE id = ?')
        .bind(brief.selectedCandidateId)
        .run().catch(() => {});
    }

    // Step 3: Draft the piece
    this.setState({ ...this.state, status: 'drafting' });
    const draftResponse = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 8000,
      system: DAILY_DRAFTER_PROMPT,
      messages: [{ role: 'user', content: buildDailyDrafterPrompt(brief as DailyPieceBrief, VOICE_CONTRACT) }],
    });
    const mdx = draftResponse.content[0].type === 'text' ? draftResponse.content[0].text : '';

    // Step 4: Audit (3 gates in parallel, up to 3 revision rounds)
    this.setState({ ...this.state, status: 'auditing' });
    const taskId = `daily/${today}`;
    let currentMdx = mdx;
    let passed = false;
    let lastVoiceScore = 0;
    let totalRounds = 0;
    let failedGates: string[] = [];

    for (let round = 1; round <= MAX_REVISIONS; round++) {
      totalRounds = round;
      const [voiceResult, structureResult, factResult] = await Promise.all([
        (await this.subAgent(VoiceAuditorAgent, `voice-daily-r${round}`)).audit(currentMdx),
        (await this.subAgent(StructureEditorAgent, `struct-daily-r${round}`)).review(currentMdx),
        (await this.subAgent(FactCheckerAgent, `fact-daily-r${round}`)).check(currentMdx),
      ]);

      await this.saveAuditResults(taskId, round, voiceResult, structureResult, factResult);
      lastVoiceScore = voiceResult.score ?? 0;
      failedGates = [];
      if (!voiceResult.passed) failedGates.push('voice');
      if (!structureResult.passed) failedGates.push('structure');
      if (!factResult.passed) failedGates.push('facts');

      if (voiceResult.passed && structureResult.passed && factResult.passed) {
        passed = true;
        break;
      }

      if (round < MAX_REVISIONS) {
        this.setState({ ...this.state, status: 'revising' });
        const integrator = await this.subAgent(IntegratorAgent, 'integrator-daily');
        const revision = await integrator.revise(currentMdx, voiceResult, structureResult, factResult);
        currentMdx = revision.revisedMdx;
      }
    }

    // Step 5: Publish if passed
    const observer = await this.subAgent(ObserverAgent, 'observer');
    if (passed) {
      this.setState({ ...this.state, status: 'publishing' });
      const publisher = await this.subAgent(PublisherAgent, `publisher-daily-${today}`);
      const slug = brief.headline.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
      const filePath = `content/daily-pieces/${today}-${slug}.mdx`;
      const commitMsg = `feat(daily): ${today} — ${brief.headline}`;

      const publishResult = await publisher.publishToPath(filePath, currentMdx, commitMsg);

      // Log to daily_pieces table with actual audit data
      await this.env.DB
        .prepare(
          `INSERT INTO daily_pieces (id, date, headline, underlying_subject, source_story, word_count, beat_count, voice_score, fact_check_passed, published_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), today, brief.headline, brief.underlyingSubject, brief.newsSource ?? '',
          currentMdx.split(/\s+/).length, brief.beats?.length ?? 0, lastVoiceScore, 1, Date.now(), Date.now())
        .run().catch(() => {});

      await observer.logPublished('daily', 0, brief.headline, lastVoiceScore, totalRounds - 1, publishResult.commitUrl);
      this.setState({
        ...this.state, status: 'idle', currentTask: null,
        lastDailyPiece: { title: brief.headline, date: today },
      });
    } else {
      await observer.logEscalation('daily', 0, brief.headline, lastVoiceScore, totalRounds, failedGates);
      this.setState({ ...this.state, status: 'idle', currentTask: null, error: 'Daily piece failed audit' });
    }

    return { brief: brief as DailyPieceBrief, mdx: currentMdx };
  }

  getStatus(): DirectorState {
    return this.state;
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/status') {
      return new Response(JSON.stringify(this.getStatus()), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  }

  /** Get recent daily piece headlines to avoid repetition */
  private async getRecentDailyPieces(days: number): Promise<string[]> {
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);
      const result = await this.env.DB
        .prepare('SELECT headline FROM daily_pieces WHERE date >= ? ORDER BY date DESC')
        .bind(since.toISOString().slice(0, 10))
        .all<{ headline: string }>();
      return result.results.map((r) => r.headline);
    } catch { return []; }
  }

  /** Save audit results to D1 for durable audit trail */
  private async saveAuditResults(
    taskId: string,
    round: number,
    voice: VoiceAuditResult,
    structure: StructureAuditResult,
    facts: FactCheckResult,
  ): Promise<void> {
    const now = Date.now();
    const draftId = `${taskId}-r${round}`;
    try {
      await this.env.DB.batch([
        this.env.DB.prepare(
          'INSERT INTO audit_results (id, task_id, draft_id, auditor, passed, score, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(crypto.randomUUID(), taskId, draftId, 'voice', voice.passed ? 1 : 0, voice.score, JSON.stringify(voice.violations), now),
        this.env.DB.prepare(
          'INSERT INTO audit_results (id, task_id, draft_id, auditor, passed, score, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(crypto.randomUUID(), taskId, draftId, 'structure', structure.passed ? 1 : 0, null, JSON.stringify(structure.issues), now),
        this.env.DB.prepare(
          'INSERT INTO audit_results (id, task_id, draft_id, auditor, passed, score, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(crypto.randomUUID(), taskId, draftId, 'fact', facts.passed ? 1 : 0, null, JSON.stringify(facts.claims), now),
      ]);
    } catch { /* audit logging shouldn't break the pipeline */ }
  }
}
