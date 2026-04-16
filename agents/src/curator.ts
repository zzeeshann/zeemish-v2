import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env, LessonBrief } from './types';
import { CURATOR_SYSTEM_PROMPT, buildCuratorPrompt } from './shared/prompts';

interface CuratorState {
  lastBrief: LessonBrief | null;
}

/**
 * CuratorAgent — plans individual lessons within a course.
 * Takes a subject + course context → produces a lesson brief.
 */
export class CuratorAgent extends Agent<Env, CuratorState> {
  initialState: CuratorState = { lastBrief: null };

  async planLesson(
    subject: string,
    courseTitle: string,
    lessonNumber: number,
    existingLessons: string[],
    voiceContract: string,
  ): Promise<LessonBrief> {
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2000,
      system: CURATOR_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildCuratorPrompt(subject, courseTitle, lessonNumber, existingLessons, voiceContract),
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    // Extract JSON from response (may be wrapped in markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Curator did not return valid JSON');
    }

    const brief: LessonBrief = JSON.parse(jsonMatch[0]);
    this.setState({ lastBrief: brief });
    return brief;
  }
}
