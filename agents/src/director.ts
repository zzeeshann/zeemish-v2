import { Agent } from 'agents';
import { VoiceAuditorAgent } from './voice-auditor';
import { StructureEditorAgent } from './structure-editor';
import { FactCheckerAgent } from './fact-checker';
import { IntegratorAgent } from './integrator';
import { PublisherAgent } from './publisher';
import { ObserverAgent } from './observer';
import { ScannerAgent } from './scanner';
import { CuratorAgent } from './curator';
import { DrafterAgent } from './drafter';
import type { Env, DirectorState, DirectorPhase, DailyPieceBrief } from './types';
import type { VoiceAuditResult } from './voice-auditor';
import type { StructureAuditResult } from './structure-editor';
import type { FactCheckResult } from './fact-checker';

const MAX_REVISIONS = 3;

/**
 * DirectorAgent — pure orchestrator.
 *
 * Does NOT call Claude. Does NOT pick stories. Does NOT draft MDX.
 * Only routes work between agents:
 *
 *   Scanner → Curator → Drafter → [Voice, Structure, Fact] → Integrator → Publisher
 *
 * Audio Producer + Auditor are paused (by design, for cost control)
 * and deliberately excluded from this pipeline.
 *
 * Scheduled at 2:00 AM UTC weekdays.
 */
export class DirectorAgent extends Agent<Env, DirectorState> {
  initialState: DirectorState = {
    status: 'idle',
    currentPhase: null,
    currentTask: null,
    lastDailyPiece: null,
    error: null,
  };

  /** Set up daily scheduled run — cancel any old schedules first */
  async onStart() {
    const existing = await this.getSchedules();
    for (const schedule of existing) {
      await this.cancelSchedule(schedule.id);
    }
    // One schedule: daily piece at 2:00 AM UTC
    await this.schedule('0 2 * * *', 'dailyRun', { type: 'daily-piece' });
  }

  /**
   * Daily run — scheduled at 2:00 AM UTC.
   * Weekdays: news-driven piece.
   * Weekends: skip.
   */
  async dailyRun() {
    const dayOfWeek = new Date().getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    if (isWeekend) return;

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

    // Guard: skip if today's piece already exists
    const existing = await this.env.DB
      .prepare('SELECT id FROM daily_pieces WHERE date = ? LIMIT 1')
      .bind(today)
      .first();
    if (existing) return null;

    // Clear previous run's log
    await this.env.DB.prepare('DELETE FROM pipeline_log WHERE run_id = ?').bind(today).run().catch(() => {});

    // ─── Phase 1: Scanner ────────────────────────────────────────────
    this.enterPhase('scanner', `daily/${today}`);
    await this.logStep(today, 'scanning', 'running', {});
    const scanner = await this.subAgent(ScannerAgent, 'scanner');
    const candidates = await scanner.scan();
    await this.logStep(today, 'scanning', 'done', { candidateCount: candidates.length });

    if (candidates.length === 0) {
      await this.logStep(today, 'skipped', 'done', { reason: 'No candidates found' });
      const observer = await this.subAgent(ObserverAgent, 'observer');
      await observer.logError('daily', 0, 'Scanner found no candidates');
      this.exitToIdle();
      return null;
    }

    // ─── Phase 2: Curator ────────────────────────────────────────────
    this.enterPhase('curator');
    await this.logStep(today, 'curating', 'running', {});
    const curator = await this.subAgent(CuratorAgent, 'curator');
    const recentPieces = await this.getRecentDailyPieces(30);
    const curatorResult = await curator.curate(candidates, recentPieces);

    if (curatorResult.skip) {
      await this.logStep(today, 'skipped', 'done', { reason: curatorResult.reason });
      const observer = await this.subAgent(ObserverAgent, 'observer');
      await observer.logError('daily', 0, curatorResult.reason);
      this.exitToIdle();
      return null;
    }

    const brief = curatorResult.brief;
    await this.logStep(today, 'curating', 'done', {
      headline: brief.headline, subject: brief.underlyingSubject, newsSource: brief.newsSource,
    });

    // Mark selected candidate in D1
    if (curatorResult.selectedCandidateId) {
      await this.env.DB
        .prepare('UPDATE daily_candidates SET selected = 1, teachability_score = 100 WHERE id = ?')
        .bind(curatorResult.selectedCandidateId)
        .run().catch(() => {});
    }

    // ─── Phase 3: Drafter ────────────────────────────────────────────
    this.enterPhase('drafter');
    await this.logStep(today, 'drafting', 'running', {});
    const drafter = await this.subAgent(DrafterAgent, 'drafter');
    const { mdx, wordCount } = await drafter.draft(brief);
    await this.logStep(today, 'drafting', 'done', {
      wordCount, beatCount: brief.beats?.length ?? 0,
    });

    // ─── Phase 4: Auditors (parallel, up to MAX_REVISIONS rounds) ─────
    this.enterPhase('auditors');
    const taskId = `daily/${today}`;
    let currentMdx = mdx;
    let passed = false;
    let lastVoiceScore = 0;
    let totalRounds = 0;
    let failedGates: string[] = [];

    for (let round = 1; round <= MAX_REVISIONS; round++) {
      totalRounds = round;
      await this.logStep(today, `auditing_r${round}`, 'running', { round });
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

      await this.logStep(today, `auditing_r${round}`, failedGates.length === 0 ? 'done' : 'failed', {
        round, voiceScore: lastVoiceScore,
        voicePassed: voiceResult.passed, factsPassed: factResult.passed, structurePassed: structureResult.passed,
        violations: voiceResult.violations?.slice(0, 3),
      });

      if (voiceResult.passed && structureResult.passed && factResult.passed) {
        passed = true;
        break;
      }

      // ─── Integrator: revise if any gate failed ──────────────────────
      if (round < MAX_REVISIONS) {
        this.enterPhase('integrator');
        await this.logStep(today, `revising_r${round}`, 'running', { round, failedGates });
        const integrator = await this.subAgent(IntegratorAgent, 'integrator-daily');
        const revision = await integrator.revise(currentMdx, voiceResult, structureResult, factResult);
        currentMdx = revision.revisedMdx;
        await this.logStep(today, `revising_r${round}`, 'done', { round });
        this.enterPhase('auditors'); // back to audit for next round
      }
    }

    // ─── Phase 5: Publisher ──────────────────────────────────────────
    const observer = await this.subAgent(ObserverAgent, 'observer');
    if (passed) {
      this.enterPhase('publisher');
      await this.logStep(today, 'publishing', 'running', {});
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

      await this.logStep(today, 'publishing', 'done', { commitUrl: publishResult.commitUrl, filePath: publishResult.filePath });
      await this.logStep(today, 'done', 'done', { headline: brief.headline, date: today, voiceScore: lastVoiceScore, revisions: totalRounds - 1 });

      await observer.logPublished('daily', 0, brief.headline, lastVoiceScore, totalRounds - 1, publishResult.commitUrl);
      this.setState({
        ...this.state, status: 'idle', currentPhase: null, currentTask: null,
        lastDailyPiece: { title: brief.headline, date: today },
      });
    } else {
      await this.logStep(today, 'error', 'failed', { headline: brief.headline, failedGates, voiceScore: lastVoiceScore, rounds: totalRounds });
      await observer.logEscalation('daily', 0, brief.headline, lastVoiceScore, totalRounds, failedGates);
      this.setState({ ...this.state, status: 'error', currentPhase: null, currentTask: null, error: 'Daily piece failed audit' });
    }

    return { brief, mdx: currentMdx };
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

  /** Move Director into a new pipeline phase */
  private enterPhase(phase: DirectorPhase, task?: string): void {
    this.setState({
      ...this.state,
      status: 'running',
      currentPhase: phase,
      ...(task !== undefined ? { currentTask: task } : {}),
    });
  }

  /** Reset Director to idle after a skip/no-op */
  private exitToIdle(): void {
    this.setState({ ...this.state, status: 'idle', currentPhase: null, currentTask: null });
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

  /** Write a step to the pipeline_log table for the admin monitor */
  private async logStep(
    runId: string,
    step: string,
    status: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.env.DB
        .prepare('INSERT INTO pipeline_log (id, run_id, step, status, data, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), runId, step, status, JSON.stringify(data), Date.now())
        .run();
    } catch { /* pipeline log shouldn't break the pipeline */ }
  }
}
