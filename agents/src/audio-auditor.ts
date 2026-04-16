import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './types';
import type { BeatAudio } from './audio-producer';

export interface AudioAuditResult {
  passed: boolean;
  issues: AudioIssue[];
}

export interface AudioIssue {
  beatName: string;
  issue: string;
  severity: 'minor' | 'major';
}

interface AudioAuditorState {
  lastResult: AudioAuditResult | null;
}

/**
 * AudioAuditorAgent — checks generated audio quality.
 *
 * Since we can't easily do STT round-trip in a Worker,
 * this agent does a simpler but still useful check:
 * 1. Verifies all beat audio files exist in R2
 * 2. Checks file sizes are reasonable (not empty, not too large)
 * 3. Verifies character counts match expected lengths
 *
 * A more sophisticated version (STT round-trip) can be added later
 * when Cloudflare Workers AI supports speech-to-text.
 */
export class AudioAuditorAgent extends Agent<Env, AudioAuditorState> {
  initialState: AudioAuditorState = { lastResult: null };

  async audit(beatAudioPaths: BeatAudio[]): Promise<AudioAuditResult> {
    const issues: AudioIssue[] = [];

    for (const beat of beatAudioPaths) {
      // Check file exists in R2
      const obj = await this.env.AUDIO_BUCKET.head(beat.r2Key);

      if (!obj) {
        issues.push({
          beatName: beat.beatName,
          issue: `Audio file not found in R2: ${beat.r2Key}`,
          severity: 'major',
        });
        continue;
      }

      // Check file size — MP3 at ~128kbps is ~16KB per second
      // A 30-second beat should be ~480KB, a 5-minute beat ~4.8MB
      const sizeKB = (obj.size ?? 0) / 1024;

      if (sizeKB < 10) {
        issues.push({
          beatName: beat.beatName,
          issue: `Audio file suspiciously small (${Math.round(sizeKB)}KB) — may be empty or corrupt`,
          severity: 'major',
        });
      }

      if (sizeKB > 20_000) {
        issues.push({
          beatName: beat.beatName,
          issue: `Audio file very large (${Math.round(sizeKB / 1024)}MB) — may contain errors`,
          severity: 'minor',
        });
      }

      // Check character count makes sense (should have generated some text)
      if (beat.characterCount < 50) {
        issues.push({
          beatName: beat.beatName,
          issue: `Very short text (${beat.characterCount} chars) — beat may be too brief for audio`,
          severity: 'minor',
        });
      }
    }

    const hasMajorIssues = issues.some((i) => i.severity === 'major');
    const result: AudioAuditResult = {
      passed: !hasMajorIssues,
      issues,
    };

    this.setState({ lastResult: result });
    return result;
  }
}
