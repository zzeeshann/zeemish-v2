import { Agent } from 'agents';
import type { Env, LessonBrief } from './types';

export interface AudioResult {
  beatAudioPaths: BeatAudio[];
  totalDurationEstimate: number; // seconds
}

export interface BeatAudio {
  beatName: string;
  r2Key: string;
  publicUrl: string;
  characterCount: number;
}

interface AudioProducerState {
  lastResult: AudioResult | null;
}

// Frederick Surrey — calm, British, narrative. The Zeemish voice.
const VOICE_ID = 'j9jfwdrw7BRfcR43Qohk';
const MODEL_ID = 'eleven_multilingual_v2';

/**
 * AudioProducerAgent — generates MP3 audio for each beat via ElevenLabs.
 * Saves to R2, returns public URLs. Audio is generated ONCE per lesson
 * and served to all readers from R2 (zero cost per play).
 */
export class AudioProducerAgent extends Agent<Env, AudioProducerState> {
  initialState: AudioProducerState = { lastResult: null };

  /**
   * Generate audio for all beats in a lesson.
   * Extracts text from each <lesson-beat>, sends to ElevenLabs,
   * saves MP3 to R2, returns paths.
   */
  async generateAudio(
    brief: LessonBrief,
    mdx: string,
  ): Promise<AudioResult> {
    // Extract text content from each beat
    const beats = this.extractBeats(mdx);
    const beatAudioPaths: BeatAudio[] = [];

    for (const beat of beats) {
      // Strip MDX/HTML tags to get plain text for TTS
      const plainText = this.stripTags(beat.content);
      if (!plainText.trim()) continue;

      // Generate audio via ElevenLabs
      const audioBuffer = await this.callElevenLabs(plainText);

      // Save to R2
      const r2Key = `audio/${brief.courseSlug}/${String(brief.lessonNumber).padStart(2, '0')}/${beat.name}.mp3`;
      await this.env.AUDIO_BUCKET.put(r2Key, audioBuffer, {
        httpMetadata: { contentType: 'audio/mpeg' },
      });

      beatAudioPaths.push({
        beatName: beat.name,
        r2Key,
        publicUrl: `/audio/${r2Key}`, // Will be served via R2 public access or a Worker
        characterCount: plainText.length,
      });
    }

    // Rough duration estimate: ~150 words/min, ~5 chars/word
    const totalChars = beatAudioPaths.reduce((sum, b) => sum + b.characterCount, 0);
    const totalDurationEstimate = Math.round((totalChars / 5 / 150) * 60);

    const result: AudioResult = { beatAudioPaths, totalDurationEstimate };
    this.setState({ lastResult: result });
    return result;
  }

  /** Extract beat names and content from MDX */
  private extractBeats(mdx: string): Array<{ name: string; content: string }> {
    const beats: Array<{ name: string; content: string }> = [];
    const regex = /<lesson-beat\s+name="([^"]+)">([\s\S]*?)<\/lesson-beat>/g;
    let match;
    while ((match = regex.exec(mdx)) !== null) {
      beats.push({ name: match[1], content: match[2] });
    }
    return beats;
  }

  /** Strip HTML/MDX tags and frontmatter to get plain text */
  private stripTags(text: string): string {
    return text
      .replace(/^---[\s\S]*?---/m, '') // frontmatter
      .replace(/<[^>]+>/g, '') // HTML tags
      .replace(/#{1,6}\s/g, '') // markdown headings
      .replace(/\*\*(.*?)\*\*/g, '$1') // bold
      .replace(/\*(.*?)\*/g, '$1') // italic
      .replace(/\n{3,}/g, '\n\n') // excess newlines
      .trim();
  }

  /** Call ElevenLabs Text-to-Speech API */
  private async callElevenLabs(text: string): Promise<ArrayBuffer> {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': this.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: MODEL_ID,
          voice_settings: {
            stability: 0.6, // Slightly varied, not robotic
            similarity_boost: 0.75, // Stay close to Frederick's natural voice
            style: 0.3, // Mild style — calm, not dramatic
          },
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ElevenLabs API error (${response.status}): ${error}`);
    }

    return response.arrayBuffer();
  }
}
