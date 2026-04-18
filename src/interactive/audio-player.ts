/**
 * <audio-player> — beat-aware MP3 player that syncs with <lesson-shell>.
 *
 * Reads a JSON-encoded map of { beatName → publicUrl } from the
 * `data-audio-beats` attribute. Plays the clip for the currently-
 * visible beat. Listens for `lesson-beat:change` (fired by
 * <lesson-shell> on navigation) to swap clips. Emits
 * `audio-player:ended` when a clip finishes so <lesson-shell> can
 * auto-advance to the next beat.
 *
 * Progressive enhancement: if JS fails or the data is missing, the
 * server-rendered "Audio unavailable" state stays visible — readers
 * still get the piece as text.
 */
interface AudioBeatsMap {
  [beatName: string]: string;
}

class AudioPlayer extends HTMLElement {
  private audio: HTMLAudioElement | null = null;
  private audioBeats: AudioBeatsMap = {};
  private currentBeat: string | null = null;

  private playBtn: HTMLButtonElement | null = null;
  private progressEl: HTMLElement | null = null;
  private progressFill: HTMLElement | null = null;
  private timeEl: HTMLElement | null = null;

  private beatChangeHandler: EventListener | null = null;

  connectedCallback() {
    try {
      const raw = this.getAttribute('data-audio-beats') ?? '{}';
      this.audioBeats = JSON.parse(raw);
    } catch {
      this.audioBeats = {};
    }

    const beatNames = Object.keys(this.audioBeats);
    if (beatNames.length === 0) return;

    this.playBtn = this.querySelector('[data-play-btn]');
    this.progressEl = this.querySelector('[data-progress]');
    this.progressFill = this.querySelector('[data-progress-fill]');
    this.timeEl = this.querySelector('[data-time]');

    this.audio = new Audio();
    this.audio.preload = 'metadata';

    // Initial beat: prefer the one <lesson-shell> has marked visible,
    // fall back to first in the map.
    const visibleBeat = document.querySelector(
      'lesson-beat[data-visible]',
    ) as HTMLElement | null;
    const initialName = visibleBeat?.getAttribute('name') ?? null;
    const startBeat =
      initialName && this.audioBeats[initialName] ? initialName : beatNames[0];
    this.loadBeat(startBeat);

    this.audio.addEventListener('timeupdate', () => this.updateProgress());
    this.audio.addEventListener('loadedmetadata', () => this.updateProgress());
    this.audio.addEventListener('ended', () => this.onEnded());
    this.audio.addEventListener('play', () => this.updatePlayIcon());
    this.audio.addEventListener('pause', () => this.updatePlayIcon());
    this.audio.addEventListener('error', () => this.onLoadError());

    this.playBtn?.addEventListener('click', () => this.toggle());
    this.progressEl?.addEventListener('click', (e) =>
      this.seekFromClick(e as MouseEvent),
    );

    this.beatChangeHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { beatName?: string } | undefined;
      const name = detail?.beatName;
      if (name && this.audioBeats[name]) this.switchToBeat(name);
    };
    window.addEventListener('lesson-beat:change', this.beatChangeHandler);
  }

  disconnectedCallback() {
    this.audio?.pause();
    if (this.beatChangeHandler) {
      window.removeEventListener('lesson-beat:change', this.beatChangeHandler);
      this.beatChangeHandler = null;
    }
  }

  private loadBeat(beatName: string) {
    if (!this.audio) return;
    const url = this.audioBeats[beatName];
    if (!url) return;
    this.currentBeat = beatName;
    this.audio.src = url;
    this.resetProgressUI();
  }

  private switchToBeat(beatName: string) {
    if (beatName === this.currentBeat) return;
    const wasPlaying = !!this.audio && !this.audio.paused;
    this.loadBeat(beatName);
    if (wasPlaying) {
      this.audio?.play().catch(() => {
        // autoplay blocked — user can press play manually
      });
    }
  }

  private toggle() {
    if (!this.audio) return;
    if (this.audio.paused) {
      this.audio.play().catch(() => {});
    } else {
      this.audio.pause();
    }
  }

  private onEnded() {
    window.dispatchEvent(
      new CustomEvent('audio-player:ended', {
        detail: { beatName: this.currentBeat },
      }),
    );
  }

  private onLoadError() {
    if (this.timeEl) this.timeEl.textContent = 'unavailable';
    // Don't throw — degrade to text-only silently.
  }

  private updateProgress() {
    if (!this.audio) return;
    const dur = this.audio.duration;
    const cur = this.audio.currentTime;
    if (this.progressFill && isFinite(dur) && dur > 0) {
      this.progressFill.style.width = `${(cur / dur) * 100}%`;
    }
    if (this.timeEl) this.timeEl.textContent = formatTime(cur);
  }

  private resetProgressUI() {
    if (this.progressFill) this.progressFill.style.width = '0%';
    if (this.timeEl) this.timeEl.textContent = '0:00';
  }

  private updatePlayIcon() {
    if (!this.audio || !this.playBtn) return;
    const playing = !this.audio.paused;
    this.playBtn.setAttribute(
      'aria-label',
      playing ? 'Pause audio' : 'Play audio',
    );
    this.playBtn.innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
  }

  private seekFromClick(e: MouseEvent) {
    if (!this.audio || !this.progressEl || !this.audio.duration) return;
    const rect = this.progressEl.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    this.audio.currentTime = this.audio.duration * pct;
  }
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const PLAY_SVG =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 3L13 8L4 13V3Z" /></svg>';
const PAUSE_SVG =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="4" y="3" width="2.5" height="10" rx="0.5"/><rect x="9.5" y="3" width="2.5" height="10" rx="0.5"/></svg>';

customElements.define('audio-player', AudioPlayer);

export { AudioPlayer };
