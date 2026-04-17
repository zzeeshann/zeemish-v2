/**
 * <made-drawer> — client-side behaviour for the "How this was made"
 * transparency drawer.
 *
 * Responsibilities:
 *   1. Open/close state (click affordance, close button, Escape, backdrop)
 *   2. Fetch /api/daily/{date}/made on first open, cache for the session
 *   3. Render the envelope: piece summary, timeline, rounds, rules, candidates
 *   4. URL hash deep-link (`#made` opens; closing clears)
 *   5. Focus trap + body scroll lock while open
 *
 * The markup scaffold is server-rendered by src/components/MadeBy.astro;
 * this component only populates `[data-made-body]` once data arrives.
 */

import { auditTier, auditTierLabel } from '../lib/audit-tier';
import { pipelineStepLabel } from '../lib/pipeline-steps';
import type { MadeEnvelope, MadeFactClaim } from '../lib/made-by';

/**
 * Voice-contract rules and a list of keyword fragments. A rule "lights
 * up" when any of its keywords appears (case-insensitive) in any
 * violation string across any audit round. This is a best-effort honest
 * link between what the auditor flagged and which rule it falls under —
 * we don't invent a per-rule pass/fail, we just surface the match.
 */
const VOICE_RULES: { label: string; keywords: string[] }[] = [
  { label: 'Plain English', keywords: ['jargon', 'plain english'] },
  { label: 'No tribe words', keywords: ['tribe word', 'mindfulness', 'journey', 'empower', 'transform', 'wellness', 'unlock', 'dive in', 'embrace', 'lean into', 'unpack', 'holistic', 'optimize', 'curate', 'intentional'] },
  { label: 'Short sentences', keywords: ['long sentence', 'padded', 'run-on'] },
  { label: 'Specific beats general', keywords: ['general', 'vague', 'specific'] },
  { label: 'No flattery', keywords: ['flattery', 'praise', 'congratulat'] },
  { label: 'Trust the reader', keywords: ['hedging', 'over-explain', 'might', 'perhaps'] },
];

const STRUCTURE_RULES: { label: string; keywords: string[] }[] = [
  { label: 'Hook: one screen, curiosity only', keywords: ['hook'] },
  { label: 'Teaching: one idea per beat', keywords: ['beat', 'teaching'] },
  { label: 'Practice: only when concrete', keywords: ['practice', 'exercise'] },
  { label: 'Close: one sentence, no CTA', keywords: ['close', 'cta', 'call to action', 'summary'] },
];

class MadeDrawer extends HTMLElement {
  private date = '';
  private envelope: MadeEnvelope | null = null;
  private loading = false;
  private openerEl: HTMLButtonElement | null = null;
  private closeEl: HTMLButtonElement | null = null;
  private backdropEl: HTMLElement | null = null;
  private panelEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private lastFocus: HTMLElement | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private hashHandler: (() => void) | null = null;

  connectedCallback() {
    this.date = this.getAttribute('data-date') ?? '';
    this.openerEl = this.querySelector('[data-made-open]');
    this.closeEl = this.querySelector('[data-made-close]');
    this.backdropEl = this.querySelector('[data-made-backdrop]');
    this.panelEl = this.querySelector('.made-panel');
    this.bodyEl = this.querySelector('[data-made-body]');

    this.openerEl?.addEventListener('click', (e) => {
      e.preventDefault();
      this.open();
    });
    this.closeEl?.addEventListener('click', (e) => {
      e.preventDefault();
      this.close();
    });
    this.backdropEl?.addEventListener('click', () => this.close());

    // Fetch the envelope on mount so the teaser counts under the button
    // are accurate *and* the drawer opens instantly. Single request,
    // cached per session.
    this.load().then(() => this.updateTeaser());

    // Auto-open when URL hash is #made on page load
    if (window.location.hash === '#made') {
      // defer so layout settles first
      requestAnimationFrame(() => this.open());
    }
    this.hashHandler = () => {
      if (window.location.hash === '#made' && !this.hasAttribute('data-open')) this.open();
      if (window.location.hash !== '#made' && this.hasAttribute('data-open')) this.close();
    };
    window.addEventListener('hashchange', this.hashHandler);
  }

  private updateTeaser() {
    const teaserEl = this.querySelector<HTMLElement>('[data-made-teaser]');
    if (!teaserEl || !this.envelope) return;
    const rounds = this.envelope.rounds.length;
    const cands = this.envelope.candidates.total;
    const parts = ['13 agents'];
    if (rounds > 0) parts.push(`${rounds} ${rounds === 1 ? 'audit round' : 'audit rounds'}`);
    if (cands > 0) parts.push(`${cands} candidates`);
    teaserEl.textContent = parts.join(' · ');
  }

  disconnectedCallback() {
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    if (this.hashHandler) {
      window.removeEventListener('hashchange', this.hashHandler);
      this.hashHandler = null;
    }
    document.body.classList.remove('made-locked');
  }

  private async open() {
    if (!this.panelEl) return;
    this.lastFocus = document.activeElement as HTMLElement | null;
    this.setAttribute('data-open', '');
    this.panelEl.removeAttribute('hidden');
    document.body.classList.add('made-locked');

    // Reflect in URL — but only if not already #made (avoid hashchange loop)
    if (window.location.hash !== '#made') {
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}#made`);
    }

    // Keyboard: Escape + focus trap
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
        return;
      }
      if (e.key === 'Tab') this.trapFocus(e);
    };
    window.addEventListener('keydown', this.keyHandler);

    // Focus first focusable inside the panel (the close button)
    setTimeout(() => this.closeEl?.focus(), 30);

    // If the mount-time load already finished, render now.
    if (this.envelope) {
      this.render();
    } else if (!this.loading) {
      await this.load();
    }
  }

  private close() {
    if (!this.panelEl) return;
    this.removeAttribute('data-open');
    this.panelEl.setAttribute('hidden', '');
    document.body.classList.remove('made-locked');

    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    // Clear #made from the URL without reloading
    if (window.location.hash === '#made') {
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }

    this.lastFocus?.focus();
  }

  private trapFocus(e: KeyboardEvent) {
    if (!this.panelEl) return;
    const focusables = this.panelEl.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  private async load() {
    if (!this.bodyEl) return;
    this.loading = true;
    try {
      const res = await fetch(`/api/daily/${this.date}/made`);
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      this.envelope = await res.json();
      this.render();
    } catch {
      this.bodyEl.innerHTML = `<p class="made-list-empty" style="padding: 2rem 0">Couldn't load the making-of right now. Try again in a moment.</p>`;
    } finally {
      this.loading = false;
    }
  }

  private render() {
    if (!this.bodyEl || !this.envelope) return;
    const env = this.envelope;

    const html: string[] = [];

    // --- Piece summary -------------------------------------------------
    if (env.piece) {
      const p = env.piece;
      const tier = p.tier ?? auditTier(p.voiceScore, p.qualityFlag);
      html.push(`
        <section class="made-piece">
          <p class="made-piece-headline">${escapeHtml(p.headline)}</p>
          <p class="made-piece-meta">
            ${p.voiceScore != null ? `<span>Voice ${p.voiceScore}/100</span><span class="sep">·</span>` : ''}
            <span class="made-tier made-tier-${tier}">${auditTierLabel(tier)}</span>
            ${p.wordCount != null ? `<span class="sep">·</span><span>${p.wordCount} words</span>` : ''}
            ${p.beatCount != null ? `<span class="sep">·</span><span>${p.beatCount} beats</span>` : ''}
          </p>
        </section>
      `);
    }

    // --- Timeline ------------------------------------------------------
    if (env.timeline.length > 0) {
      const start = env.timeline[0].t;
      // Each phase logs a 'running' row and a terminal row (done / failed /
      // skipped). Collapse pairs into one row per phase. Prefer the terminal
      // row for status, detail, and timestamp; fall back to the running row
      // when the phase is still in progress.
      const collapsed = collapseTimeline(env.timeline);
      html.push(`
        <section class="made-section">
          <h3 class="made-section-header">Timeline</h3>
          <ol class="made-timeline">
            ${collapsed.map((s) => renderStep(s, start)).join('')}
          </ol>
        </section>
      `);
    }

    // --- Rounds --------------------------------------------------------
    if (env.rounds.length > 0) {
      html.push(`
        <section class="made-section">
          <h3 class="made-section-header">What the auditors said</h3>
          ${env.rounds.map((r, i) => renderRound(r, i === env.rounds.length - 1)).join('')}
        </section>
      `);
    }

    // --- Rules (voice contract) ---------------------------------------
    const allViolations = collectViolations(env);
    html.push(`
      <section class="made-section">
        <h3 class="made-section-header">Rules applied</h3>
        <p class="made-section-note">Every piece is held to these. The dots that light up are the ones today's audit flagged something adjacent to.</p>
        <div class="made-rules">
          <p class="made-rules-title">Voice contract — non-negotiables</p>
          <ul class="made-rules-list">
            ${VOICE_RULES.map((r) => renderRule(r, allViolations)).join('')}
          </ul>
          <p class="made-rules-title" style="margin-top:0.875rem">Lesson structure</p>
          <ul class="made-rules-list">
            ${STRUCTURE_RULES.map((r) => renderRule(r, allViolations)).join('')}
          </ul>
          <p class="made-rules-footer">
            Full contract: <a href="https://github.com/zzeeshann/zeemish-v2/blob/main/content/voice-contract.md" target="_blank" rel="noopener">voice-contract.md</a>
          </p>
        </div>
      </section>
    `);

    // --- Candidates ----------------------------------------------------
    if (env.candidates.total > 0) {
      html.push(`
        <section class="made-section">
          <h3 class="made-section-header">What Scanner surfaced</h3>
          <p class="made-section-note">${env.candidates.total} candidates today. Curator picked the one above. We don't store <em>why</em> — only what was considered.</p>
          <div class="made-candidates" data-made-candidates>
            <button class="made-candidates-toggle" type="button" data-made-candidates-toggle>
              <span>Also considered (${env.candidates.alsoConsidered.length})</span>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <div class="made-candidates-body">
              ${env.candidates.alsoConsidered.map(renderCandidate).join('')}
            </div>
          </div>
        </section>
      `);
    }

    // --- Commit link ---------------------------------------------------
    if (env.piece?.commitUrl || env.piece?.filePath) {
      const published = env.piece.publishedAt
        ? new Date(env.piece.publishedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
        : null;
      html.push(`
        <section class="made-section">
          <h3 class="made-section-header">The final commit</h3>
          <p class="made-commit">
            ${published ? `Published ${escapeHtml(published)} as ` : 'Published as '}
            ${env.piece.filePath ? `<code>${escapeHtml(env.piece.filePath)}</code>` : ''}
            ${env.piece.commitUrl ? ` <a href="${env.piece.commitUrl}" target="_blank" rel="noopener">View commit on GitHub →</a>` : ''}
          </p>
        </section>
      `);
    }

    this.bodyEl.innerHTML = html.join('');

    // Wire up candidates toggle
    const candToggle = this.bodyEl.querySelector<HTMLButtonElement>('[data-made-candidates-toggle]');
    const candWrap = this.bodyEl.querySelector<HTMLElement>('[data-made-candidates]');
    candToggle?.addEventListener('click', () => {
      if (!candWrap) return;
      if (candWrap.hasAttribute('data-expanded')) {
        candWrap.removeAttribute('data-expanded');
      } else {
        candWrap.setAttribute('data-expanded', '');
      }
    });
  }
}

// --- Render helpers (pure functions, kept outside the class) ---------

/**
 * Collapse paired running/done rows per phase into a single displayable
 * row. Each phase (scanning, curating, drafting, auditing_rN, …) writes
 * a 'running' row when it starts and a terminal row (done/failed/skipped)
 * when it ends. Showing both doubles the timeline length with no extra
 * information — prefer the terminal row (richer data) and keep the
 * 'running' row only when a phase is still in progress at fetch time.
 */
function collapseTimeline(
  steps: MadeEnvelope['timeline'],
): MadeEnvelope['timeline'] {
  const byStep = new Map<string, MadeEnvelope['timeline'][number]>();
  const order: string[] = [];
  for (const s of steps) {
    if (!byStep.has(s.step)) {
      order.push(s.step);
      byStep.set(s.step, s);
      continue;
    }
    const prev = byStep.get(s.step)!;
    // Terminal status always wins over 'running'. If both are terminal
    // (shouldn't happen for a well-formed run), keep the latest.
    const prevTerminal = prev.status !== 'running';
    const thisTerminal = s.status !== 'running';
    if (thisTerminal || (!prevTerminal && s.t > prev.t)) {
      byStep.set(s.step, s);
    }
  }
  return order.map((k) => byStep.get(k)!);
}

function renderStep(s: MadeEnvelope['timeline'][number], startMs: number): string {
  const label = pipelineStepLabel(s.step);
  const state = s.status === 'done' ? 'done' : s.status === 'failed' ? 'failed' : 'running';
  const rel = relativeTime(s.t - startMs);
  const detail = stepDetail(s);

  return `
    <li class="made-step" data-state="${state}">
      <span class="made-step-dot" aria-hidden="true"></span>
      <div>
        <span class="made-step-label">${escapeHtml(label)}<span class="made-step-time">${rel}</span></span>
        ${detail ? `<p class="made-step-detail">${detail}</p>` : ''}
      </div>
    </li>
  `;
}

function stepDetail(s: MadeEnvelope['timeline'][number]): string {
  const d = s.data ?? {};
  const parts: string[] = [];
  if (d.candidateCount != null) parts.push(`${d.candidateCount} candidates`);
  if (d.headline) parts.push(`"${escapeHtml(String(d.headline))}"`);
  if (d.wordCount != null && d.beatCount != null) parts.push(`${d.wordCount} words · ${d.beatCount} beats`);
  if (d.voiceScore != null) {
    const bits = [`Voice ${d.voiceScore}/100`];
    if (d.factsPassed != null) bits.push(`Facts ${d.factsPassed ? '✓' : '✗'}`);
    if (d.structurePassed != null) bits.push(`Structure ${d.structurePassed ? '✓' : '✗'}`);
    parts.push(bits.join(' · '));
  }
  if (d.qualityFlag === 'low') parts.push('published with tier <strong>Rough</strong>');
  return parts.join(' · ');
}

function renderRound(r: MadeEnvelope['rounds'][number], isLatest: boolean): string {
  const voiceTier = auditTier(r.voice.score ?? null);
  const voiceVerdict = r.voice.score != null
    ? `${auditTierLabel(voiceTier)} · ${r.voice.score}/100`
    : (r.voice.passed ? 'Passing' : 'Mixed');
  const voiceCls = voiceTier === 'polished' ? 'made-gate-verdict-ok' : 'made-gate-verdict-mixed';
  const barCls = voiceTier === 'polished' ? '' : 'made-gate-bar-fill-muted';

  return `
    <div class="made-round">
      <div class="made-round-header">
        <span class="made-round-title">${isLatest ? 'Final round' : `Round ${r.round}`}</span>
        <span class="made-round-summary">${r.voice.violations.length + r.structure.issues.length + r.fact.claims.length} notes</span>
      </div>

      <div class="made-gate">
        <div class="made-gate-head">
          <span class="made-gate-label">Voice</span>
          <span class="made-gate-verdict ${voiceCls}">${escapeHtml(voiceVerdict)}</span>
        </div>
        ${r.voice.score != null ? `
          <div class="made-gate-bar"><div class="made-gate-bar-fill ${barCls}" style="width:${Math.max(0, Math.min(100, r.voice.score))}%"></div></div>
        ` : ''}
        ${renderStringList(r.voice.violations, 'No violations flagged.')}
      </div>

      <div class="made-gate">
        <div class="made-gate-head">
          <span class="made-gate-label">Facts</span>
          <span class="made-gate-verdict ${r.fact.passed ? 'made-gate-verdict-ok' : 'made-gate-verdict-mixed'}">${r.fact.passed ? 'Passing' : 'Mixed'}</span>
        </div>
        ${renderClaims(r.fact.claims)}
      </div>

      <div class="made-gate">
        <div class="made-gate-head">
          <span class="made-gate-label">Structure</span>
          <span class="made-gate-verdict ${r.structure.passed ? 'made-gate-verdict-ok' : 'made-gate-verdict-mixed'}">${r.structure.passed ? 'Passing' : 'Mixed'}</span>
        </div>
        ${renderStringList(r.structure.issues, 'No structural issues.')}
      </div>
    </div>
  `;
}

function renderStringList(items: string[], emptyNote: string): string {
  if (items.length === 0) return `<p class="made-list-empty">${escapeHtml(emptyNote)}</p>`;
  return `<ul class="made-list">${items.map((it) => `<li>${escapeHtml(it)}</li>`).join('')}</ul>`;
}

function renderClaims(claims: MadeFactClaim[]): string {
  if (claims.length === 0) return `<p class="made-list-empty">No claims reviewed.</p>`;
  return `<ul class="made-list">${claims.map((c) => {
    const statusCls = c.status === 'verified' ? 'made-claim-verified'
      : c.status === 'unverified' ? 'made-claim-unverified'
      : c.status === 'contested' || c.status === 'incorrect' ? 'made-claim-contested'
      : 'made-claim-unverified';
    return `
      <li>
        <div class="made-claim">
          <span>${escapeHtml(c.claim)}</span>
          ${c.status ? `<span class="made-claim-status ${statusCls}">${escapeHtml(c.status)}</span>` : ''}
          ${c.note ? `<span class="made-claim-note">${escapeHtml(c.note)}</span>` : ''}
        </div>
      </li>
    `;
  }).join('')}</ul>`;
}

function renderCandidate(c: MadeEnvelope['candidates']['alsoConsidered'][number]): string {
  const title = c.url
    ? `<a href="${c.url}" target="_blank" rel="noopener">${escapeHtml(c.headline)}</a>`
    : escapeHtml(c.headline);
  const meta: string[] = [];
  if (c.source) meta.push(escapeHtml(c.source));
  if (c.category) meta.push(escapeHtml(c.category));
  if (c.teachabilityScore != null) meta.push(`teach ${c.teachabilityScore}`);
  return `
    <div class="made-candidate">
      <span class="made-candidate-headline">${title}</span>
      ${meta.length > 0 ? `<span class="made-candidate-meta">${meta.join(' · ')}</span>` : ''}
    </div>
  `;
}

function renderRule(
  rule: { label: string; keywords: string[] },
  allViolations: string[],
): string {
  const hit = allViolations.some((v) => {
    const low = v.toLowerCase();
    return rule.keywords.some((k) => low.includes(k.toLowerCase()));
  });
  return `<li class="made-rule"${hit ? ' data-hit' : ''}>${escapeHtml(rule.label)}</li>`;
}

function collectViolations(env: MadeEnvelope): string[] {
  const out: string[] = [];
  for (const r of env.rounds) {
    out.push(...r.voice.violations);
    out.push(...r.structure.issues);
  }
  return out;
}

function relativeTime(diffMs: number): string {
  if (diffMs <= 0) return 'start';
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `+${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `+${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `+${hrs}h ${mins % 60}m`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

customElements.define('made-drawer', MadeDrawer);

export { MadeDrawer };
