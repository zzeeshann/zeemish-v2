import { Agent } from 'agents';
import type { Env } from './types';

/** Audio brief for a daily piece — the date is the piece identity. */
export interface AudioBrief {
  date: string; // YYYY-MM-DD
}

export interface AudioResult {
  beatAudioPaths: BeatAudio[];
  totalDurationEstimate: number; // seconds
  totalCharacters: number;
}

export interface BeatAudio {
  beatName: string;
  r2Key: string;
  publicUrl: string;
  characterCount: number;
  requestId: string | null;
}

interface AudioProducerState {
  lastResult: AudioResult | null;
}

// Frederick Surrey — calm, British, narrative. Added to "My Voices" so the
// ID is stable against shared-library removals.
const VOICE_ID = 'j9jfwdrw7BRfcR43Qohk';
const MODEL_ID = 'eleven_multilingual_v2';
// 96 kbps MP3 — indistinguishable from 128 for a single voice, ~25%
// smaller R2 footprint + egress.
const OUTPUT_FORMAT = 'mp3_44100_96';
// Hard cost tripwire. One piece cannot spend more than 20,000
// characters of ElevenLabs budget. Sized for a 12-beat newspaper-style
// piece (~200 words/beat + headroom). Budget for a standard 4–6-beat
// piece is well under.
const CHAR_CAP = 20_000;

/**
 * Thrown when a piece's total character count exceeds CHAR_CAP.
 * Director catches this, skips the audio phase (text is already
 * published), and escalates to Observer. Producer refuses to spend
 * money it wasn't authorised for.
 */
export class AudioBudgetExceededError extends Error {
  constructor(public readonly totalChars: number, public readonly cap: number = CHAR_CAP) {
    super(`Piece needs ${totalChars} chars, budget is ${cap}. Aborting audio.`);
    this.name = 'AudioBudgetExceededError';
  }
}

/**
 * AudioProducerAgent — one job: generate MP3 audio from approved MDX.
 *
 * Separation: never touches git, never sets has_audio, never knows
 * Publisher exists. Writes per-beat rows to daily_piece_audio for the
 * downstream Auditor + Publisher to read.
 *
 * Runs AFTER Publisher commits text (newspaper never skips a day).
 * Audio is produced, audited, then Publisher does a second commit
 * splicing the URLs into frontmatter.
 */
export class AudioProducerAgent extends Agent<Env, AudioProducerState> {
  initialState: AudioProducerState = { lastResult: null };

  /**
   * Generate audio for every beat in a piece.
   * Order of operations:
   *   1. Extract beats from MDX, prepare text for TTS
   *   2. Sum characters — abort with AudioBudgetExceededError if > CHAR_CAP
   *   3. For each beat: R2 head-check → generate if missing → R2 put
   *   4. Persist row to daily_piece_audio (upsert)
   *   5. Maintain rolling previous_request_ids window (max 3) for prosodic continuity
   */
  async generateAudio(brief: AudioBrief, mdx: string): Promise<AudioResult> {
    const beats = this.extractBeats(mdx);

    const prepared = beats
      .map((b) => ({ name: b.name, text: this.prepareForTTS(b.content) }))
      .filter((b) => b.text.trim().length > 0);

    const totalCharacters = prepared.reduce((sum, b) => sum + b.text.length, 0);
    if (totalCharacters > CHAR_CAP) {
      throw new AudioBudgetExceededError(totalCharacters);
    }

    const beatAudioPaths: BeatAudio[] = [];
    const priorRequestIds: string[] = [];

    for (const beat of prepared) {
      const r2Key = `audio/daily/${brief.date}/${beat.name}.mp3`;
      const existing = await this.env.AUDIO_BUCKET.head(r2Key);

      let requestId: string | null = null;

      if (!existing) {
        const res = await this.callElevenLabs(beat.text, priorRequestIds);
        await this.env.AUDIO_BUCKET.put(r2Key, res.audio, {
          httpMetadata: { contentType: 'audio/mpeg' },
        });
        requestId = res.requestId;
      }

      const publicUrl = `/${r2Key}`;
      const beatAudio: BeatAudio = {
        beatName: beat.name,
        r2Key,
        publicUrl,
        characterCount: beat.text.length,
        requestId,
      };
      beatAudioPaths.push(beatAudio);

      await this.persistBeatRow(brief.date, beatAudio);

      if (requestId) {
        priorRequestIds.push(requestId);
        if (priorRequestIds.length > 3) priorRequestIds.shift();
      }
    }

    const totalDurationEstimate = Math.round((totalCharacters / 5 / 150) * 60);
    const result: AudioResult = { beatAudioPaths, totalDurationEstimate, totalCharacters };
    this.setState({ lastResult: result });
    return result;
  }

  /**
   * Extract beat names and inner content from MDX.
   *
   * Drafter emits plain markdown with `## kebab-name` section headings.
   * The `<lesson-beat>` tags readers see are added by `rehype-beats.ts`
   * at render time, not in the MDX source — so we parse the heading
   * format directly here.
   *
   * Each `##` heading starts a new beat; the beat name is the raw
   * heading text (kebab-case, matching what rehype-beats uses for the
   * `name` attribute). Content runs until the next `##` or end of MDX.
   * Frontmatter is stripped first.
   */
  private extractBeats(mdx: string): Array<{ name: string; content: string }> {
    const body = mdx.replace(/^---[\s\S]*?\n---\n/, '');
    const beats: Array<{ name: string; content: string }> = [];
    const parts = body.split(/\n## /);
    // parts[0] is content before the first `##` (usually empty or just
    // a whitespace block after frontmatter). Skip it.
    for (let i = 1; i < parts.length; i++) {
      const newline = parts[i].indexOf('\n');
      if (newline === -1) continue;
      const name = parts[i].slice(0, newline).trim();
      const content = parts[i].slice(newline + 1).trim();
      if (name) beats.push({ name, content });
    }
    // Fail loud. If Drafter ever drifts off the `##` convention again
    // (e.g. emits `<beat>` tags), silent zero-beat success would leak
    // through as "audio-producing ✓" with no rows in daily_piece_audio.
    // Throwing here converts that into a visible escalation instead.
    if (beats.length === 0) {
      throw new Error(
        'Audio producer found zero beats in MDX — Drafter likely emitted non-## section syntax. Check the MDX source.',
      );
    }
    return beats;
  }

  /**
   * Strip MDX/HTML and apply pronunciation substitutions.
   *
   * Pronunciation: "Zeemish" → "Zee-mish". ElevenLabs' multilingual v2
   * model doesn't support IPA phonemes (flash_v2 only), but plain-text
   * aliasing works on every model and needs no PLS dictionary upkeep.
   */
  private prepareForTTS(text: string): string {
    const stripped = text
      .replace(/^---[\s\S]*?---/m, '')
      .replace(/<[^>]+>/g, '')
      .replace(/#{1,6}\s/g, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return stripped
      .replace(/\bZeemish\b/g, 'Zee-mish')
      .replace(/\bzeemish\b/g, 'zee-mish');
  }

  /**
   * POST to ElevenLabs TTS. 3-attempt retry with exponential backoff
   * on 5xx / network errors. 4xx errors (bad key, quota, bad voice ID)
   * throw immediately — retrying won't fix them.
   */
  private async callElevenLabs(
    text: string,
    previousRequestIds: string[],
  ): Promise<{ audio: ArrayBuffer; requestId: string | null }> {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=${OUTPUT_FORMAT}`;
    const body = JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: {
        stability: 0.6,
        similarity_boost: 0.75,
        style: 0.3,
        use_speaker_boost: true,
        speed: 0.95,
      },
      ...(previousRequestIds.length > 0 && { previous_request_ids: previousRequestIds }),
    });

    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'xi-api-key': this.env.ELEVENLABS_API_KEY,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
          },
          body,
        });

        if (!response.ok) {
          const errText = await response.text();
          if (response.status >= 400 && response.status < 500) {
            throw new ElevenLabsClientError(response.status, errText);
          }
          throw new Error(`ElevenLabs ${response.status} (transient): ${errText}`);
        }

        const requestId = response.headers.get('request-id');
        const audio = await response.arrayBuffer();
        return { audio, requestId };
      } catch (err) {
        lastError = err;
        if (err instanceof ElevenLabsClientError || attempt === 3) throw err;
        // 1s, 2s for the two retry gaps
        await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
      }
    }
    throw lastError;
  }

  /**
   * Upsert one beat's row into daily_piece_audio. Idempotent — if
   * producer re-runs (manual retry, partial failure recovery), each
   * row is refreshed rather than duplicated.
   */
  private async persistBeatRow(date: string, beat: BeatAudio): Promise<void> {
    await this.env.DB.prepare(
      `INSERT OR REPLACE INTO daily_piece_audio
         (date, beat_name, r2_key, public_url, character_count,
          duration_seconds, request_id, model, voice_id, generated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    )
      .bind(
        date,
        beat.beatName,
        beat.r2Key,
        beat.publicUrl,
        beat.characterCount,
        beat.requestId,
        MODEL_ID,
        VOICE_ID,
        Date.now(),
      )
      .run();
  }
}

/** 4xx from ElevenLabs — don't retry. */
class ElevenLabsClientError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`ElevenLabs ${status}: ${body}`);
    this.name = 'ElevenLabsClientError';
  }
}
