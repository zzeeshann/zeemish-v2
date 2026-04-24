/**
 * <lesson-shell> — orchestrates beat-by-beat navigation.
 *
 * On connectedCallback:
 * 1. Finds all child <lesson-beat> elements
 * 2. Hides all but the active beat
 * 3. Renders prev/next buttons and a progress indicator
 * 4. Stores current beat in sessionStorage so refresh resumes
 * 5. POSTs beat changes to /api/progress/beat (fire-and-forget)
 * 6. POSTs lesson complete when reader finishes the last beat
 *
 * Progressive enhancement: without JS, all beats render as a
 * long scroll. This component adds the beat-switching behaviour.
 */
interface InteractivePagePayload {
  slug: string;
  title: string;
  questionCount: number | null;
}

class LessonShell extends HTMLElement {
  private beats: HTMLElement[] = [];
  private currentIndex = 0;
  private nav: HTMLElement | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private audioEndedHandler: EventListener | null = null;
  private audioFirstPlayHandler: EventListener | null = null;
  private interactive: InteractivePagePayload | null = null;
  private interactiveOfferedFired = false;

  private get storageKey(): string {
    return `zeemish-beat:${window.location.pathname}`;
  }

  /**
   * Extract content info from URL: /daily/{date}/{slug}/
   *
   * `piece_id` is injected as `data-piece-id` on this element by the
   * rehype-beats build-time plugin, sourced from MDX frontmatter.
   * Undefined on pre-Phase-7 HTML bundles — engagement tracking still
   * works via the per-piece-date PK row for those, but post-migration
   * code paths prefer piece_id for multi-per-day correctness.
   */
  private get lessonInfo(): { course_slug: string; lesson_number: number; piece_date: string; piece_id: string | undefined } | null {
    const dailyMatch = window.location.pathname.match(/\/daily\/(\d{4}-\d{2}-\d{2})\//);
    if (dailyMatch) {
      const pieceId = this.dataset.pieceId;
      return {
        course_slug: 'daily',
        lesson_number: 0,
        piece_date: dailyMatch[1],
        piece_id: pieceId && pieceId.length > 0 ? pieceId : undefined,
      };
    }
    return null;
  }

  connectedCallback() {
    this.beats = Array.from(this.querySelectorAll('lesson-beat'));
    if (this.beats.length === 0) return;

    // Read the interactive payload embedded in the page (sub-task 4.6).
    // Present only when the piece has a passing interactive generated
    // by the post-publish agent chain. Absent pieces simply don't get
    // the last-beat prompt.
    const dataEl = document.querySelector('script[data-page-interactive]');
    if (dataEl && dataEl.textContent) {
      try {
        const parsed = JSON.parse(dataEl.textContent) as InteractivePagePayload;
        if (parsed && typeof parsed.slug === 'string' && parsed.slug.length > 0) {
          this.interactive = parsed;
        }
      } catch {
        // Malformed payload — degrade silently, no prompt.
      }
    }

    // Restore position from sessionStorage
    const saved = sessionStorage.getItem(this.storageKey);
    if (saved !== null) {
      const parsed = parseInt(saved, 10);
      if (parsed >= 0 && parsed < this.beats.length) {
        this.currentIndex = parsed;
      }
    }

    // Mark shell as active — CSS uses this to hide non-visible beats
    this.setAttribute('data-active', '');

    // Track view
    this.trackEngagement('view');

    // Build navigation bar
    this.nav = document.createElement('nav');
    this.nav.className = 'beat-nav';
    this.nav.setAttribute('aria-label', 'Lesson navigation');
    this.appendChild(this.nav);

    // Keyboard navigation: ← / → to move between beats. Ignore if the
    // reader is typing in an input or the Zita chat is focused.
    this.keyHandler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (target && target.closest && target.closest('zita-chat')) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.go(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (this.currentIndex === this.beats.length - 1) {
          window.location.href = '/daily/';
        } else {
          this.go(1);
        }
      }
    };
    window.addEventListener('keydown', this.keyHandler);

    // Auto-advance when <audio-player> finishes the current beat's
    // clip. Last beat is a no-op — we don't jump to /daily/ from audio.
    this.audioEndedHandler = () => {
      if (this.currentIndex < this.beats.length - 1) this.go(1);
    };
    window.addEventListener('audio-player:ended', this.audioEndedHandler);

    // Track audio engagement once per session (first play in this view).
    this.audioFirstPlayHandler = () => this.trackEngagement('audio_play');
    window.addEventListener('audio-player:firstplay', this.audioFirstPlayHandler);

    this.render();
  }

  disconnectedCallback() {
    this.nav?.remove();
    this.removeAttribute('data-active');
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    if (this.audioEndedHandler) {
      window.removeEventListener('audio-player:ended', this.audioEndedHandler);
      this.audioEndedHandler = null;
    }
    if (this.audioFirstPlayHandler) {
      window.removeEventListener('audio-player:firstplay', this.audioFirstPlayHandler);
      this.audioFirstPlayHandler = null;
    }
    // Show all beats again when component disconnects
    for (const beat of this.beats) {
      beat.removeAttribute('data-visible');
    }
  }

  private render() {
    // Update beat visibility
    for (let i = 0; i < this.beats.length; i++) {
      if (i === this.currentIndex) {
        this.beats[i].setAttribute('data-visible', '');
      } else {
        this.beats[i].removeAttribute('data-visible');
      }
    }

    // Save position locally and to server
    sessionStorage.setItem(this.storageKey, this.currentIndex.toString());
    this.saveProgressToServer();

    // Update navigation
    if (!this.nav) return;

    const isFirst = this.currentIndex === 0;
    const isLast = this.currentIndex === this.beats.length - 1;

    // Interactive prompt — small, subtle link above the Prev/Finish
    // row when this piece has a passing interactive AND the reader is
    // on the last beat. Not a required step; Finish button unchanged.
    const interactivePrompt = isLast && this.interactive
      ? `
        <div class="beat-nav-interactive">
          <a
            class="beat-nav-interactive-link"
            href="/interactives/${escapeHtml(this.interactive.slug)}/"
            aria-label="Open the interactive quiz: ${escapeHtml(this.interactive.title)}${
              this.interactive.questionCount
                ? ` (${this.interactive.questionCount} questions)`
                : ''
            }"
          >
            <span class="beat-nav-interactive-label">See if it landed</span>
            <span class="beat-nav-interactive-arrow" aria-hidden="true">→</span>
          </a>
        </div>
      `
      : '';

    this.nav.innerHTML = `
      ${interactivePrompt}
      <div class="beat-nav-inner">
        <button class="beat-nav-btn beat-nav-prev" ${isFirst ? 'disabled' : ''} aria-label="Previous beat">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M10 12L6 8L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Previous
        </button>
        <span class="beat-nav-progress" aria-live="polite">
          ${this.currentIndex + 1} of ${this.beats.length}
        </span>
        <button class="beat-nav-btn beat-nav-next" aria-label="${isLast ? 'Finish' : 'Next beat'}">
          ${isLast ? 'Finish' : 'Next'}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M6 4L10 8L6 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
      <div class="beat-nav-bar">
        <div class="beat-nav-fill" style="width: ${((this.currentIndex + 1) / this.beats.length) * 100}%"></div>
      </div>
    `;

    // Fire `interactive_offered` once per session per piece on reach.
    if (isLast && this.interactive && !this.interactiveOfferedFired) {
      const storageKey = `zeemish-interactive-offered:${this.interactive.slug}`;
      if (!sessionStorage.getItem(storageKey)) {
        sessionStorage.setItem(storageKey, '1');
        fetch('/api/interactive/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            interactive_id: null, // resolved server-side from slug in 4.7
            interactive_slug: this.interactive.slug,
            event_type: 'interactive_offered',
          }),
          keepalive: true,
        }).catch(() => {
          // Endpoint lands in 4.7. Until then, 404 silently.
        });
      }
      this.interactiveOfferedFired = true;
    }

    // Attach listeners
    const prevBtn = this.nav.querySelector('.beat-nav-prev');
    const nextBtn = this.nav.querySelector('.beat-nav-next');
    prevBtn?.addEventListener('click', () => this.go(-1));
    nextBtn?.addEventListener('click', () => {
      if (this.currentIndex === this.beats.length - 1) {
        // Finish — navigate to daily archive
        window.location.href = '/daily/';
      } else {
        this.go(1);
      }
    });

    // Announce the current beat so <audio-player> can swap clips.
    const currentName = this.beats[this.currentIndex]?.getAttribute('name') ?? null;
    window.dispatchEvent(
      new CustomEvent('lesson-beat:change', {
        detail: { beatName: currentName, index: this.currentIndex, total: this.beats.length },
      }),
    );
  }

  private go(direction: -1 | 1) {
    const next = this.currentIndex + direction;
    if (next < 0 || next >= this.beats.length) return;
    this.currentIndex = next;
    this.render();
    // Scroll to top of the shell so the reader starts at the top of the new beat
    this.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Fire-and-forget POST to save beat progress. Silently fails if offline. */
  private saveProgressToServer() {
    const info = this.lessonInfo;
    if (!info) return;

    const beat = this.beats[this.currentIndex]?.getAttribute('name') ?? `beat-${this.currentIndex}`;
    const isLast = this.currentIndex === this.beats.length - 1;

    // Save current beat position
    fetch('/api/progress/beat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...info, beat }),
    }).catch(() => {}); // silent fail

    // If they reached the last beat, mark lesson complete + track engagement
    if (isLast) {
      fetch('/api/progress/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(info),
      }).catch(() => {});
      this.trackEngagement('complete');
    }
  }

  /** Fire-and-forget engagement tracking */
  private trackEngagement(eventType: string, beat?: string) {
    const info = this.lessonInfo;
    if (!info) return;

    fetch('/api/engagement/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        course_id: info.course_slug,
        lesson_id: info.piece_date ?? `${info.course_slug}/${info.lesson_number}`,
        piece_id: info.piece_id,
        event_type: eventType,
        beat,
      }),
    }).catch(() => {});
  }
}

/** Defensive HTML escaping for attributes and text inserted into
 *  the nav template. Slug and title come from content collection
 *  (validated Zod shape) so the risk is low, but escaping keeps
 *  the innerHTML injection safe regardless. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

customElements.define('lesson-shell', LessonShell);

export { LessonShell };
