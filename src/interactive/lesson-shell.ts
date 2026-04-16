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
class LessonShell extends HTMLElement {
  private beats: HTMLElement[] = [];
  private currentIndex = 0;
  private nav: HTMLElement | null = null;

  private get storageKey(): string {
    return `zeemish-beat:${window.location.pathname}`;
  }

  /** Extract course slug and lesson number from the URL: /courses/{course}/{lesson}/ */
  private get lessonInfo(): { course_slug: string; lesson_number: number } | null {
    const match = window.location.pathname.match(/\/courses\/([^/]+)\/(\d+)\/?/);
    if (!match) return null;
    return { course_slug: match[1], lesson_number: parseInt(match[2], 10) };
  }

  connectedCallback() {
    this.beats = Array.from(this.querySelectorAll('lesson-beat'));
    if (this.beats.length === 0) return;

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

    // Build navigation bar
    this.nav = document.createElement('nav');
    this.nav.className = 'beat-nav';
    this.nav.setAttribute('aria-label', 'Lesson navigation');
    this.appendChild(this.nav);

    this.render();
  }

  disconnectedCallback() {
    this.nav?.remove();
    this.removeAttribute('data-active');
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

    this.nav.innerHTML = `
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
        <button class="beat-nav-btn beat-nav-next" ${isLast ? 'disabled' : ''} aria-label="${isLast ? 'Last beat' : 'Next beat'}">
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

    // Attach listeners
    const prevBtn = this.nav.querySelector('.beat-nav-prev');
    const nextBtn = this.nav.querySelector('.beat-nav-next');
    prevBtn?.addEventListener('click', () => this.go(-1));
    nextBtn?.addEventListener('click', () => this.go(1));
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

    // If they reached the last beat, mark lesson complete
    if (isLast) {
      fetch('/api/progress/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(info),
      }).catch(() => {});
    }
  }
}

customElements.define('lesson-shell', LessonShell);

export { LessonShell };
