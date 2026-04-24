/**
 * <quiz-card> — multiple-choice quiz Web Component.
 *
 * Parses its JSON payload from a child
 * `<script type="application/json" data-quiz-content>` — server-
 * rendered by the /interactives/[slug]/ route — and renders an
 * interactive Q-by-Q experience with a final results screen.
 *
 * Progressive enhancement: if this script never loads, the element
 * stays inert and the server-rendered `<noscript>` inside it surfaces
 * the full quiz as a readable Q&A list. When JS upgrades the element,
 * the `<noscript>` block is hidden naturally by the browser; we render
 * our interactive UI into a freshly-inserted container.
 *
 * Events:
 *   - on mount: POST `interactive_started` (fire-and-forget)
 *   - on finish: POST `interactive_completed` with score + per-question
 *     correctness array
 *   Endpoint is /api/interactive/track, landing in sub-task 4.7.
 *   Until then calls fail silently (caught + ignored).
 */

interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

interface QuizContent {
  type: 'quiz';
  questions: QuizQuestion[];
}

class QuizCard extends HTMLElement {
  private content: QuizContent | null = null;
  private interactiveId = '';
  private container: HTMLDivElement | null = null;
  private currentIndex = 0;
  private selections: (number | null)[] = [];
  private startedFired = false;

  connectedCallback() {
    const parsed = this.readPayload();
    if (!parsed) return;

    this.content = parsed;
    this.interactiveId = this.getAttribute('data-interactive-id') ?? '';
    this.selections = new Array(parsed.questions.length).fill(null);

    this.container = document.createElement('div');
    this.container.className = 'quiz';
    this.appendChild(this.container);

    this.renderQuestion();

    if (!this.startedFired) {
      this.startedFired = true;
      this.postEvent('interactive_started', {});
    }
  }

  private readPayload(): QuizContent | null {
    const script = this.querySelector(
      'script[data-quiz-content]',
    ) as HTMLScriptElement | null;
    if (!script) return null;
    try {
      const parsed = JSON.parse(script.textContent ?? '') as QuizContent;
      if (parsed.type !== 'quiz' || !Array.isArray(parsed.questions)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private renderQuestion() {
    if (!this.container || !this.content) return;
    const { questions } = this.content;
    const q = questions[this.currentIndex];
    const isLast = this.currentIndex === questions.length - 1;
    const selected = this.selections[this.currentIndex];

    this.container.innerHTML = '';
    const frag = document.createDocumentFragment();

    const counter = document.createElement('p');
    counter.className = 'quiz-counter';
    counter.textContent = `Question ${this.currentIndex + 1} of ${questions.length}`;
    frag.appendChild(counter);

    const qEl = document.createElement('h2');
    qEl.className = 'quiz-question';
    qEl.textContent = q.question;
    frag.appendChild(qEl);

    const list = document.createElement('div');
    list.className = 'quiz-options';
    list.setAttribute('role', 'radiogroup');
    list.setAttribute('aria-label', q.question);

    q.options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quiz-option';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', selected === idx ? 'true' : 'false');
      if (selected === idx) btn.setAttribute('data-selected', '');
      btn.textContent = opt;
      btn.addEventListener('click', () => {
        this.selections[this.currentIndex] = idx;
        this.renderQuestion();
      });
      list.appendChild(btn);
    });
    frag.appendChild(list);

    const actions = document.createElement('div');
    actions.className = 'quiz-actions';

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'quiz-next';
    nextBtn.textContent = isLast ? 'See results' : 'Next question';
    nextBtn.disabled = selected === null;
    nextBtn.addEventListener('click', () => {
      if (this.selections[this.currentIndex] === null) return;
      if (isLast) {
        this.renderResults();
      } else {
        this.currentIndex += 1;
        this.renderQuestion();
        this.container?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    actions.appendChild(nextBtn);
    frag.appendChild(actions);

    this.container.appendChild(frag);
  }

  private renderResults() {
    if (!this.container || !this.content) return;
    const { questions } = this.content;

    const correctness = this.selections.map((sel, i) =>
      sel !== null && sel === questions[i].correctIndex ? 1 : 0,
    );
    const score = correctness.reduce((a, b) => a + b, 0);

    this.postEvent('interactive_completed', {
      score,
      per_question_correctness: correctness,
    });

    this.container.innerHTML = '';
    const frag = document.createDocumentFragment();

    const summary = document.createElement('div');
    summary.className = 'quiz-summary';
    const scoreEl = document.createElement('p');
    scoreEl.className = 'quiz-score';
    scoreEl.innerHTML = `<span class="quiz-score-num">${score}</span><span class="quiz-score-total"> of ${questions.length} correct</span>`;
    summary.appendChild(scoreEl);
    frag.appendChild(summary);

    const list = document.createElement('ol');
    list.className = 'quiz-review';

    questions.forEach((q, i) => {
      const item = document.createElement('li');
      item.className = 'quiz-review-item';
      const correct = correctness[i] === 1;
      item.setAttribute('data-correct', correct ? 'true' : 'false');

      const qHeader = document.createElement('p');
      qHeader.className = 'quiz-review-q';
      const mark = document.createElement('span');
      mark.className = 'quiz-review-mark';
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = correct ? '✓' : '✗';
      qHeader.appendChild(mark);
      qHeader.appendChild(document.createTextNode(' ' + q.question));
      item.appendChild(qHeader);

      const userIdx = this.selections[i];
      if (userIdx !== null) {
        const userAns = document.createElement('p');
        userAns.className = 'quiz-review-user';
        userAns.textContent = `Your answer: ${q.options[userIdx]}`;
        item.appendChild(userAns);
      }

      if (!correct) {
        const right = document.createElement('p');
        right.className = 'quiz-review-correct';
        right.textContent = `Correct answer: ${q.options[q.correctIndex]}`;
        item.appendChild(right);
      }

      const exp = document.createElement('p');
      exp.className = 'quiz-review-exp';
      exp.textContent = q.explanation;
      item.appendChild(exp);

      list.appendChild(item);
    });
    frag.appendChild(list);

    this.container.appendChild(frag);
    this.container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private postEvent(eventType: string, extra: Record<string, unknown>) {
    if (!this.interactiveId) return;
    const body = JSON.stringify({
      interactive_id: this.interactiveId,
      event_type: eventType,
      ...extra,
    });
    fetch('/api/interactive/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      // Endpoint lands in sub-task 4.7. Until then, 404 is expected — swallow.
    });
  }
}

customElements.define('quiz-card', QuizCard);

export { QuizCard };
