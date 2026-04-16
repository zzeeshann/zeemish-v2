/**
 * <zita-chat> — Socratic learning guide widget.
 *
 * A minimal chat interface that sits at the bottom of lesson pages.
 * Sends messages to /api/zita/chat with lesson context.
 * Displays Zita's short, question-driven responses.
 *
 * Attributes:
 *   course - course slug (e.g. "body")
 *   lesson - lesson number (e.g. "3")
 *   title  - lesson title (for context)
 */
class ZitaChat extends HTMLElement {
  private isOpen = false;
  private messages: Array<{ role: string; text: string }> = [];

  get course(): string { return this.getAttribute('course') ?? ''; }
  get lesson(): string { return this.getAttribute('lesson') ?? ''; }
  get lessonTitle(): string { return this.getAttribute('title') ?? ''; }

  connectedCallback() {
    this.innerHTML = `
      <div class="zita-toggle">
        <button class="zita-toggle-btn" aria-label="Ask Zita">
          <span class="zita-icon">?</span>
          <span class="zita-label">Ask Zita</span>
        </button>
      </div>
      <div class="zita-panel" hidden>
        <div class="zita-header">
          <span class="zita-name">Zita</span>
          <span class="zita-desc">Your learning guide</span>
          <button class="zita-close" aria-label="Close">×</button>
        </div>
        <div class="zita-messages">
          <div class="zita-msg zita-msg-assistant">
            What are you thinking about from this lesson?
          </div>
        </div>
        <form class="zita-input">
          <input type="text" placeholder="Ask something..." autocomplete="off" />
          <button type="submit" aria-label="Send">→</button>
        </form>
      </div>
    `;

    // Toggle open/close
    this.querySelector('.zita-toggle-btn')?.addEventListener('click', () => this.toggle());
    this.querySelector('.zita-close')?.addEventListener('click', () => this.toggle());

    // Submit message
    this.querySelector('.zita-input')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = this.querySelector('.zita-input input') as HTMLInputElement;
      if (input.value.trim()) {
        this.sendMessage(input.value.trim());
        input.value = '';
      }
    });
  }

  private toggle() {
    this.isOpen = !this.isOpen;
    const panel = this.querySelector('.zita-panel') as HTMLElement;
    const toggle = this.querySelector('.zita-toggle') as HTMLElement;
    if (this.isOpen) {
      panel?.removeAttribute('hidden');
      toggle?.setAttribute('hidden', '');
      (this.querySelector('.zita-input input') as HTMLInputElement)?.focus();
    } else {
      panel?.setAttribute('hidden', '');
      toggle?.removeAttribute('hidden');
    }
  }

  private async sendMessage(text: string) {
    // Add user message to UI
    this.addMessageToUI('user', text);

    // Show typing indicator
    const typing = document.createElement('div');
    typing.className = 'zita-msg zita-msg-assistant zita-typing';
    typing.textContent = '...';
    this.querySelector('.zita-messages')?.appendChild(typing);
    this.scrollToBottom();

    try {
      const res = await fetch('/api/zita/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          course_slug: this.course,
          lesson_number: parseInt(this.lesson, 10),
          lesson_title: this.lessonTitle,
        }),
      });

      typing.remove();

      if (res.ok) {
        const data = await res.json();
        this.addMessageToUI('assistant', data.reply);
      } else {
        this.addMessageToUI('assistant', 'Something went wrong. Try again?');
      }
    } catch {
      typing.remove();
      this.addMessageToUI('assistant', 'I\'m offline right now. Try again later.');
    }
  }

  private addMessageToUI(role: string, text: string) {
    const msg = document.createElement('div');
    msg.className = `zita-msg zita-msg-${role}`;
    msg.textContent = text;
    this.querySelector('.zita-messages')?.appendChild(msg);
    this.scrollToBottom();
  }

  private scrollToBottom() {
    const container = this.querySelector('.zita-messages');
    if (container) container.scrollTop = container.scrollHeight;
  }
}

customElements.define('zita-chat', ZitaChat);

export { ZitaChat };
