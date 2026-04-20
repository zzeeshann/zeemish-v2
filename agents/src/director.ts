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
import { AudioProducerAgent, AudioBudgetExceededError } from './audio-producer';
import { AudioAuditorAgent } from './audio-auditor';
import { LearnerAgent } from './learner';
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
 * Audio runs AFTER the text piece is committed (ship-and-retry —
 * a newspaper never skips a day). Flow: AudioProducer → AudioAuditor
 * → Publisher.publishAudio (second commit splicing audioBeats into
 * frontmatter). Any audio failure is observed + retryable from the
 * admin dashboard; the text piece stays permanent either way.
 *
 * Scheduled at 2:00 AM UTC every day.
 */
export class DirectorAgent extends Agent<Env, DirectorState> {
  initialState: DirectorState = {
    status: 'idle',
    currentPhase: null,
    currentTask: null,
    lastDailyPiece: null,
    error: null,
  };

  /**
   * Set up the daily 2am UTC run. Cron schedules in the Agents SDK are
   * idempotent on (callback, cron, payload), so calling this on every DO
   * start is safe — duplicates are deduped, not appended.
   *
   * Do NOT cancel existing schedules first. The SDK's alarm() handler runs
   * super.alarm() (which triggers onStart) BEFORE scanning the schedule
   * table for due rows. Cancelling here on the 2am wake-up would delete the
   * very row that just fired, and the re-created row's `time` would jump to
   * tomorrow's 2am — silently swallowing today's run forever.
   */
  async onStart() {
    await this.schedule('0 2 * * *', 'dailyRun', { type: 'daily-piece' });
  }

  /**
   * Daily run — scheduled at 2:00 AM UTC, every day including weekends.
   * News-driven piece. If the news is thin, Curator's skip path logs
   * "No teachable stories" via Observer and the day is left blank.
   */
  async dailyRun() {
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
   *
   * Guard: by default, skips if today's piece already exists (protects the
   * scheduled 2am run from double-publishing on a cron hiccup).
   *
   * @param force — pass true from manual admin triggers to bypass the guard
   *   and always run the full pipeline. Useful during development when you
   *   want to test end-to-end even after today's piece has published.
   */
  async triggerDailyPiece(force = false): Promise<{ brief: DailyPieceBrief; mdx: string } | null> {
    // Keep the Director DO alive across the multi-phase pipeline. Agents
    // SDK documents eviction "after ~70-140s of inactivity" and our text
    // pipeline alone runs ~100-110s — audio always straddled the cliff.
    // `keepAlive()` fires a 30s heartbeat alarm that resets the inactivity
    // timer. Held until the end of the method via the try/finally; the
    // disposer stops the heartbeat so the DO can hibernate normally when
    // we're done. See DECISIONS 2026-04-19 "DO eviction root cause".
    const keepAliveDispose = await this.keepAlive();
    try {
    const today = new Date().toISOString().slice(0, 10);

    // Guard: skip if today's piece already exists (bypassed when force=true)
    if (!force) {
      const existing = await this.env.DB
        .prepare('SELECT id FROM daily_pieces WHERE date = ? LIMIT 1')
        .bind(today)
        .first();
      if (existing) return null;
    }

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
    // Director owns the publication date — the brief represents "what to
    // teach," not "when to publish." Overriding here means Drafter's
    // date-force in MDX frontmatter can never drift from Director's run date,
    // regardless of what Claude put in the brief.
    brief.date = today;
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
        (await this.subAgent(StructureEditorAgent, `struct-daily-r${round}`)).review(currentMdx, today),
        (await this.subAgent(FactCheckerAgent, `fact-daily-r${round}`)).check(currentMdx),
      ]);

      await this.saveAuditResults(taskId, round, voiceResult, structureResult, factResult);

      // "No silent failure" (architecture §3.2): if the fact-checker's web
      // search was down, surface it via Observer. Pipeline continues with
      // first-pass Claude assessment, but Zishan needs to know.
      if (!factResult.searchAvailable) {
        const obs = await this.subAgent(ObserverAgent, 'observer');
        await obs.logError(
          'fact-check',
          0,
          'Web search unavailable — fact-check used first-pass Claude assessment only',
        ).catch(() => {});
      }

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
        const integrator = await this.subAgent(IntegratorAgent, `integrator-daily-${today}`);
        const revision = await integrator.revise(currentMdx, voiceResult, structureResult, factResult);
        currentMdx = revision.revisedMdx;
        await this.logStep(today, `revising_r${round}`, 'done', { round });
        this.enterPhase('auditors'); // back to audit for next round
      }
    }

    // ─── Phase 5: Publisher ──────────────────────────────────────────
    //
    // Publish-anyway on audit failure: previously the else branch stopped
    // here with Director in 'error' state and no piece for the day. A
    // daily-cadence product can't have "no piece" days. Instead, when gates
    // fail after max revisions, we stamp `qualityFlag: "low"` into the MDX
    // frontmatter and publish the best revision we have. Library + recent
    // queries filter it out of the archive; /daily/YYYY-MM-DD/ still
    // renders it with a banner so the day isn't blank. Hard rule intact:
    // we never revise a piece after publish — a low piece is permanent,
    // just filtered from archive views.
    const observer = await this.subAgent(ObserverAgent, 'observer');
    const qualityFlag: 'low' | null = passed ? null : 'low';

    // Splice `voiceScore` into frontmatter for EVERY publish (not only on
    // failure). The reader-facing audit tier (polished / solid / rough)
    // is derived from this number at render time, so it must be present
    // in the MDX whether the piece passed or not. Same regex pattern
    // Drafter uses for `date`.
    currentMdx = currentMdx.replace(
      /^(---\n[\s\S]*?)(\n---\n)/,
      `$1\nvoiceScore: ${lastVoiceScore}$2`,
    );

    if (!passed) {
      // Splice `qualityFlag: "low"` into the frontmatter too. No longer
      // drives archive filtering (see 2026-04-17 soften-quality decision)
      // but kept as a fallback signal for the tier helper and for
      // admin/operator tooling.
      currentMdx = currentMdx.replace(
        /^(---\n[\s\S]*?)(\n---\n)/,
        `$1\nqualityFlag: "low"$2`,
      );
      // Log escalation — Zishan still needs to know when a piece shipped
      // low. Publisher runs after this so the Observer entry exists
      // regardless of whether the git commit succeeds.
      await observer.logEscalation('daily', 0, brief.headline, lastVoiceScore, totalRounds, failedGates);
    }

    this.enterPhase('publisher');
    await this.logStep(today, 'publishing', 'running', { qualityFlag });
    const publisher = await this.subAgent(PublisherAgent, `publisher-daily-${today}`);
    const slug = brief.headline.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    const filePath = `content/daily-pieces/${today}-${slug}.mdx`;
    const commitMsg = passed
      ? `feat(daily): ${today} — ${brief.headline}`
      : `feat(daily): ${today} — ${brief.headline} [tier: rough, unresolved: ${failedGates.join('/')}]`;

    const publishResult = await publisher.publishToPath(filePath, currentMdx, commitMsg);

    // Log to daily_pieces table. fact_check_passed reflects the last
    // audit round, not an assumption.
    const factsPassed = failedGates.includes('facts') ? 0 : 1;
    await this.env.DB
      .prepare(
        `INSERT INTO daily_pieces (id, date, headline, underlying_subject, source_story, word_count, beat_count, voice_score, fact_check_passed, quality_flag, published_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), today, brief.headline, brief.underlyingSubject, brief.newsSource ?? '',
        currentMdx.split(/\s+/).length, brief.beats?.length ?? 0, lastVoiceScore, factsPassed, qualityFlag, Date.now(), Date.now())
      .run().catch(() => {});

    await this.logStep(today, 'publishing', 'done', { commitUrl: publishResult.commitUrl, filePath: publishResult.filePath, qualityFlag });
    await this.logStep(today, 'done', 'done', {
      headline: brief.headline,
      date: today,
      voiceScore: lastVoiceScore,
      revisions: totalRounds - 1,
      qualityFlag,
      ...(passed ? {} : { failedGates }),
    });

    // Observer notification — differentiated so the admin feed shows a
    // low-quality publish distinctly from a clean one (escalation already
    // logged above in the !passed branch).
    if (passed) {
      await observer.logPublished('daily', 0, brief.headline, lastVoiceScore, totalRounds - 1, publishResult.commitUrl);
    }

    // ─── Post-publish producer-side learning (P1.3, off-pipeline) ────
    // Right after publishing done, kick the Learner to read the full
    // quality record and write producer-origin rows into `learnings`
    // for tomorrow's Drafter to see. Scheduled (not awaited) so it
    // never blocks the ship. Non-retriable by design — if it fails,
    // the scheduled method logs to observer_events and moves on. Fires
    // before the audio schedule so alarm ordering is deterministic.
    await this.schedule(1, 'analyseProducerSignalsScheduled', {
      date: today,
      title: brief.headline,
    });

    // ─── Post-publish self-reflection (P1.4, off-pipeline) ───────────
    // Drafter reviews the final MDX as a peer editor would — captures
    // the "what felt thin / what would I do differently" signal that
    // writers normally lose. Writes source='self-reflection' learnings
    // that compound with producer + reader signals in the same feed.
    // Metered on each run so cost/latency drift is visible before it
    // matters. Same off-pipeline + non-retriable posture as the
    // Learner. Brief is carried in the payload (small) so the
    // reflection prompt has the original ask alongside the MDX.
    await this.schedule(1, 'reflectOnPieceScheduled', {
      date: today,
      title: brief.headline,
      filePath: publishResult.filePath,
      brief,
    });

    // ─── Audio pipeline (ship-and-retry, text already live) ──────────
    // Schedule audio to run in an alarm-triggered invocation instead of
    // inline. Cloudflare docs: HTTP-triggered DO invocations get evicted
    // after ~30s of compute between incoming network requests (our text
    // phase alone is ~100s, making the audio tail unsafe). Alarm handlers
    // have a separate 15-minute wall-clock budget and are a fresh DO
    // invocation — exactly the boundary we need. The text piece is
    // already permanent either way; audio is ship-and-retry. See
    // DECISIONS 2026-04-19 "Audio via alarm, not inline".
    await this.schedule(2, 'runAudioPipelineScheduled', {
      date: today,
      filePath: publishResult.filePath,
      title: brief.headline,
    });

    this.setState({
      ...this.state, status: 'idle', currentPhase: null, currentTask: null,
      lastDailyPiece: { title: brief.headline, date: today },
    });

    return { brief, mdx: currentMdx };
    } finally {
      keepAliveDispose();
    }
  }

  /**
   * Alarm callback — runs the Learner's post-publish producer analysis
   * in a fresh DO invocation, off the main publishing path. Scheduled
   * by `triggerDailyPiece` right after `publishing done`.
   *
   * Non-retriable by design: if anything throws (DB read, Claude call,
   * JSON parse), we log to observer_events and return. The piece is
   * already live; a missed iteration of the learning loop isn't
   * catastrophic and retry logic is exactly the kind of defensive
   * plumbing that turns into mystery failures later.
   *
   * Overflow handling: Learner caps writes at PRODUCER_LEARNINGS_WRITE_CAP
   * and returns the overflow count. If non-zero, we log a visibility
   * warn — usually a signal that the analysis restated one pattern
   * multiple ways and the prompt needs tightening.
   */
  async analyseProducerSignalsScheduled(payload: {
    date: string;
    title: string;
  }): Promise<void> {
    const { date, title } = payload;
    const observer = await this.subAgent(ObserverAgent, 'observer');
    try {
      const learner = await this.subAgent(LearnerAgent, 'learner');
      const result = await learner.analysePiecePostPublish(date);
      if (result.overflowCount > 0) {
        await observer
          .logLearnerOverflow(date, title, result.written, result.overflowCount)
          .catch(() => { /* observer write failure never blocks */ });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      await observer
        .logLearnerFailure(date, title, reason)
        .catch(() => { /* observer write failure never blocks */ });
      // non-retriable: logged, moving on
    }
  }

  /**
   * Alarm callback — runs the Drafter's post-publish self-reflection
   * in a fresh DO invocation. Scheduled by `triggerDailyPiece` right
   * after `publishing done` alongside the Learner's producer analysis.
   *
   * Re-reads the committed MDX from GitHub rather than carrying it in
   * the payload — keeps the scheduled payload small. The brief IS in
   * the payload (a few KB) because the reflection prompt wants the
   * original ask alongside what was produced.
   *
   * Non-retriable on failure: logs to observer_events and returns.
   * On success, logs a single metered info event with
   * tokens-in/out + latency so cost drift is visible over time.
   */
  async reflectOnPieceScheduled(payload: {
    date: string;
    title: string;
    filePath: string;
    brief: DailyPieceBrief;
  }): Promise<void> {
    const { date, title, filePath, brief } = payload;
    const observer = await this.subAgent(ObserverAgent, 'observer');
    try {
      const publisher = await this.subAgent(PublisherAgent, `scheduled-reader-${date}`);
      const current = await publisher.readPublishedMdx(filePath);
      if (!current) {
        console.error(`reflectOnPieceScheduled: MDX not found at ${filePath} for ${date}`);
        await observer
          .logReflectionFailure(date, title, `MDX not found at ${filePath}`)
          .catch(() => { /* observer write failure never blocks */ });
        return;
      }
      const drafter = await this.subAgent(DrafterAgent, 'drafter');
      const result = await drafter.reflect(brief, current.mdx, date);
      await observer
        .logReflectionMetered(date, title, result)
        .catch(() => { /* observer write failure never blocks */ });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      await observer
        .logReflectionFailure(date, title, reason)
        .catch(() => { /* observer write failure never blocks */ });
      // non-retriable: logged, moving on
    }
  }

  /**
   * Alarm callback — runs the audio pipeline in a fresh DO invocation.
   *
   * Invoked by the Agents SDK scheduler after `triggerDailyPiece` (or
   * `retryAudio`) calls `this.schedule(1, 'runAudioPipelineScheduled',
   * payload)`. Running under an alarm gives us up to 15 minutes of wall
   * time — plenty for all 6-12 beats × ~10-15s each of ElevenLabs
   * latency, well clear of the ~30s compute-between-requests eviction
   * risk that hits HTTP-triggered invocations.
   *
   * Re-reads the committed MDX from GitHub rather than carrying it in
   * the payload — scheduled payloads live in SQLite and stay small.
   */
  async runAudioPipelineScheduled(payload: {
    date: string;
    filePath: string;
    title: string;
  }): Promise<void> {
    const { date, filePath, title } = payload;

    const publisher = await this.subAgent(PublisherAgent, `scheduled-reader-${date}`);
    const current = await publisher.readPublishedMdx(filePath);
    if (!current) {
      // Piece was deleted or renamed between scheduling and firing —
      // nothing to do. Log it and exit cleanly.
      console.error(`runAudioPipelineScheduled: MDX not found at ${filePath} for ${date}`);
      const observer = await this.subAgent(ObserverAgent, 'observer');
      await observer.logAudioFailure(
        date,
        title,
        'producer',
        `Scheduled audio skipped — MDX not found at ${filePath}`,
      );
      return;
    }

    await this.runAudioPipeline(date, current.mdx, filePath, title);
  }

  /**
   * Run the audio pipeline AFTER the text piece has been committed.
   *
   * Ship-and-retry semantics: any failure here is logged to Observer
   * as an escalation and returns cleanly. Text stays live regardless.
   * Admin can retry audio from the dashboard (Phase 7).
   *
   * Flow: audio-producer → audio-auditor → audio-publisher (second
   * commit splicing audioBeats into MDX frontmatter). audioBeats is
   * metadata, not content — the "published pieces are permanent"
   * rule governs teaching content, not frontmatter metadata like
   * voiceScore or audioBeats.
   */
  private async runAudioPipeline(
    date: string,
    mdx: string,
    filePath: string,
    title: string,
  ): Promise<void> {
    const observer = await this.subAgent(ObserverAgent, 'observer');

    // ─── audio-producer (chunked) ───────────────────────────────────
    // Single-call producer blew the ~30s DO RPC ceiling once pieces got
    // to ~3+ beats (ElevenLabs 10-15s/beat × 6 beats > 30s). Now we
    // call producer.generateAudioChunk in a bounded loop — each call
    // processes at most MAX_BEATS_PER_CHUNK new beats, stays well under
    // the ceiling, and persists rows incrementally. The loop ends when
    // D1's row count reaches `totalBeats`. See DECISIONS 2026-04-19
    // "Audio RPC wall-clock budget" for why chunking over alarms.
    const MAX_BEATS_PER_CHUNK = 2;
    const MAX_CHUNK_ITERATIONS = 10; // safety belt for runaway loops
    this.enterPhase('audio-producer');
    await this.logStep(date, 'audio-producing', 'running', {});
    let totalBeats = 0;
    let totalCharacters = 0;
    let chunkIterations = 0;
    try {
      const producer = await this.subAgent(AudioProducerAgent, `audio-producer-${date}`);
      while (true) {
        if (++chunkIterations > MAX_CHUNK_ITERATIONS) {
          throw new Error(
            `Audio pipeline exceeded ${MAX_CHUNK_ITERATIONS} chunk iterations — likely stuck`,
          );
        }
        const chunk = await producer.generateAudioChunk({ date }, mdx, MAX_BEATS_PER_CHUNK);
        totalBeats = chunk.totalBeats;
        totalCharacters = chunk.totalCharacters;
        if (chunk.completedCount >= totalBeats) break;
        if (chunk.processedBeats.length === 0) {
          // No progress and still incomplete — producer is stuck
          throw new Error(
            `Producer made no progress at ${chunk.completedCount}/${totalBeats} beats`,
          );
        }
      }
    } catch (err) {
      const reason = err instanceof AudioBudgetExceededError
        ? `Over ${err.cap}-char cap (would spend ${err.totalChars} chars)`
        : err instanceof Error ? err.message : 'Producer failed';
      await this.logStep(date, 'audio-producing', 'failed', { reason });
      await observer.logAudioFailure(date, title, 'producer', reason);
      return;
    }
    await this.logStep(date, 'audio-producing', 'done', {
      beatCount: totalBeats,
      totalCharacters,
      durationEstimate: Math.round((totalCharacters / 5 / 150) * 60),
      chunks: chunkIterations,
    });

    // ─── audio-auditor ──────────────────────────────────────────────
    this.enterPhase('audio-auditor');
    await this.logStep(date, 'audio-auditing', 'running', {});
    const auditor = await this.subAgent(AudioAuditorAgent, `audio-auditor-${date}`);
    const auditResult = await auditor.audit({ date });
    await this.logStep(date, 'audio-auditing', auditResult.passed ? 'done' : 'failed', {
      passed: auditResult.passed,
      beatCount: auditResult.beatCount,
      totalCharacters: auditResult.totalCharacters,
      totalSizeBytes: auditResult.totalSizeBytes,
      issueCount: auditResult.issues.length,
      majorIssues: auditResult.issues.filter((i) => i.severity === 'major').map((i) => i.issue),
    });
    if (!auditResult.passed) {
      const majorReasons = auditResult.issues
        .filter((i) => i.severity === 'major')
        .map((i) => i.issue)
        .join('; ');
      await observer.logAudioFailure(date, title, 'auditor', majorReasons);
      return;
    }

    // ─── audio-publisher (second commit) ────────────────────────────
    // Source of truth for the audioBeats map is D1 — covers the full
    // set of beats regardless of how many chunks produced them, plus
    // any beats from prior partial runs picked up via R2 head-check.
    this.enterPhase('audio-publisher');
    await this.logStep(date, 'audio-publishing', 'running', {});
    const allBeatsRes = await this.env.DB
      .prepare(
        `SELECT beat_name, public_url FROM daily_piece_audio
         WHERE date = ? ORDER BY generated_at ASC`,
      )
      .bind(date)
      .all<{ beat_name: string; public_url: string }>();
    const audioBeats: Record<string, string> = Object.fromEntries(
      allBeatsRes.results.map((r) => [r.beat_name, r.public_url]),
    );
    const finalBeatCount = allBeatsRes.results.length;
    try {
      const publisher = await this.subAgent(PublisherAgent, `audio-publisher-${date}`);
      const publishResult = await publisher.publishAudio(filePath, audioBeats);
      await this.env.DB
        .prepare('UPDATE daily_pieces SET has_audio = 1 WHERE date = ?')
        .bind(date)
        .run()
        .catch(() => {});
      await this.logStep(date, 'audio-publishing', 'done', {
        commitUrl: publishResult.commitUrl,
        beatCount: finalBeatCount,
      });
      await observer.logAudioPublished(
        date,
        title,
        finalBeatCount,
        totalCharacters,
        publishResult.commitUrl,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Publisher failed';
      await this.logStep(date, 'audio-publishing', 'failed', { reason });
      await observer.logAudioFailure(date, title, 'publisher', reason);
    }
  }

  /**
   * Re-run the audio pipeline for an already-published piece. Invoked
   * from the admin dashboard's "Retry audio" button after an earlier
   * audio failure (observer escalation).
   *
   * Validates inputs, then schedules `runAudioPipelineScheduled` to run
   * in an alarm-triggered invocation (15-minute wall budget) instead of
   * running inline. Same reason as triggerDailyPiece: HTTP-triggered
   * invocations risk eviction after ~30s of compute between incoming
   * requests; alarms get a fresh budget. Returns quickly — admin UI
   * polls pipeline_log / daily_piece_audio for progress.
   *
   * Idempotent — if audio already landed, Producer's R2 head-check
   * skips generation, Auditor re-verifies, Publisher's splice is a no-op.
   */
  async retryAudio(date: string): Promise<void> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`retryAudio: invalid date "${date}"`);
    }

    const piece = await this.env.DB
      .prepare('SELECT headline FROM daily_pieces WHERE date = ? LIMIT 1')
      .bind(date)
      .first<{ headline: string }>();
    if (!piece) throw new Error(`retryAudio: no piece published on ${date}`);

    // filePath lives in the publishing.done step's data column.
    const pubRow = await this.env.DB
      .prepare(
        `SELECT data FROM pipeline_log
         WHERE run_id = ? AND step = 'publishing' AND status = 'done'
         ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(date)
      .first<{ data: string | null }>();
    if (!pubRow?.data) throw new Error(`retryAudio: no publishing.done row for ${date}`);
    let filePath: string | null = null;
    try {
      filePath = JSON.parse(pubRow.data)?.filePath ?? null;
    } catch { /* malformed JSON */ }
    if (!filePath) throw new Error(`retryAudio: no filePath in publishing.done for ${date}`);

    // Schedule audio to fire in an alarm-triggered invocation (15-min wall
    // budget). Validation above catches common error paths before the
    // alarm is scheduled — so the caller sees failures synchronously.
    await this.schedule(1, 'runAudioPipelineScheduled', {
      date,
      filePath,
      title: piece.headline,
    });
  }

  /**
   * "Start over" audio variant — wipe every trace of a prior audio
   * attempt (R2 objects, daily_piece_audio rows, has_audio flag,
   * audio-* pipeline_log entries), then call retryAudio. Used when the
   * existing audio is bad (wrong content, truncated clips, stale voice
   * settings) and a clean regenerate is safer than resuming.
   *
   * Text piece itself is untouched — this only resets the audio-side
   * state. Admin dashboard's "Start over" button invokes this path.
   */
  async retryAudioFresh(date: string): Promise<void> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`retryAudioFresh: invalid date "${date}"`);
    }

    // keepAlive is reference-counted inside the SDK — nesting with the
    // inner retryAudio() call is safe; the heartbeat stops only when all
    // refs are disposed.
    const keepAliveDispose = await this.keepAlive();
    try {
      // Wipe R2 clips for this date (audio/daily/YYYY-MM-DD/*.mp3)
      const prefix = `audio/daily/${date}/`;
      const listed = await this.env.AUDIO_BUCKET.list({ prefix });
      await Promise.all(
        listed.objects.map((obj) => this.env.AUDIO_BUCKET.delete(obj.key)),
      );

      // Wipe D1 beat rows
      await this.env.DB
        .prepare('DELETE FROM daily_piece_audio WHERE date = ?')
        .bind(date)
        .run();

      // Clear has_audio on the piece so dashboard + site reflect "pending"
      await this.env.DB
        .prepare('UPDATE daily_pieces SET has_audio = 0 WHERE date = ?')
        .bind(date)
        .run()
        .catch(() => {});

      // Clear audio-* pipeline_log rows so the timeline resets cleanly.
      // Text-phase rows (scanning, curating, drafting, auditing_*,
      // publishing, done) stay — they describe a published piece that
      // remains published.
      await this.env.DB
        .prepare("DELETE FROM pipeline_log WHERE run_id = ? AND step LIKE 'audio%'")
        .bind(date)
        .run();

      // Delegate to existing retryAudio — it handles MDX read + audio pipeline
      await this.retryAudio(date);
    } finally {
      keepAliveDispose();
    }
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
