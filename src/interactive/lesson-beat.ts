/**
 * <lesson-beat> — a semantic container for one beat of a lesson.
 * The lesson-shell parent manages visibility. This element just
 * holds content and exposes a `name` attribute for identification.
 *
 * Without JS (progressive enhancement), all beats are visible
 * as normal block elements — the lesson reads as a long scroll.
 */
class LessonBeat extends HTMLElement {
  static get observedAttributes() {
    return ['name'];
  }

  get beatName(): string {
    return this.getAttribute('name') ?? '';
  }
}

customElements.define('lesson-beat', LessonBeat);

export { LessonBeat };
