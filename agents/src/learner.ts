import { Agent } from 'agents';
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './types';
import { writeLearning } from './shared/learnings';
import { extractJson } from './shared/parse-json';
import { LEARNER_ANALYSE_PROMPT } from './learner-prompt';

// --- Types (merged from EngagementAnalyst + Learner) ---

export interface EngagementReport {
  courseId: string;
  underperformingLessons: UnderperformingLesson[];
  topLessons: LessonMetric[];
  totalViews: number;
  totalCompletions: number;
  overallCompletionRate: number;
}

export interface UnderperformingLesson {
  lessonId: string;
  views: number;
  completions: number;
  completionRate: number;
  dropOffBeat: string | null;
  reason: string;
}

export interface LessonMetric {
  lessonId: string;
  views: number;
  completions: number;
  completionRate: number;
}

export interface EngagementLearning {
  lessonId: string;
  problem: string;
  learnings: string[];
}

interface LearnerState {
  learningsWritten: number;
  lastReport: EngagementReport | null;
}

/**
 * LearnerAgent — watches reader engagement data and writes patterns
 * into the learnings database for future pieces.
 *
 * Two jobs, one agent:
 * 1. Analyse engagement (completions, drop-offs, audio vs text, return rate)
 * 2. Extract actionable learnings from underperforming pieces
 *
 * Does NOT touch published pieces. Published content is permanent.
 * All improvements feed forward into future pieces only.
 */
export class LearnerAgent extends Agent<Env, LearnerState> {
  initialState: LearnerState = { learningsWritten: 0, lastReport: null };

  // --- Engagement analysis ---

  /** Analyse engagement for a content stream over the last N days */
  async analyse(courseId: string, days = 7): Promise<EngagementReport> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().slice(0, 10);

    const result = await this.env.DB
      .prepare(
        `SELECT lesson_id,
                SUM(views) as total_views,
                SUM(completions) as total_completions,
                GROUP_CONCAT(drop_off_beat) as drop_off_beats
         FROM engagement
         WHERE course_id = ? AND date >= ?
         GROUP BY lesson_id
         ORDER BY lesson_id`,
      )
      .bind(courseId, sinceStr)
      .all<{
        lesson_id: string;
        total_views: number;
        total_completions: number;
        drop_off_beats: string | null;
      }>();

    const metrics: LessonMetric[] = result.results.map((r) => ({
      lessonId: r.lesson_id,
      views: r.total_views,
      completions: r.total_completions,
      completionRate: r.total_views > 0 ? Math.round((r.total_completions / r.total_views) * 100) : 0,
    }));

    const totalViews = metrics.reduce((sum, m) => sum + m.views, 0);
    const totalCompletions = metrics.reduce((sum, m) => sum + m.completions, 0);
    const overallCompletionRate = totalViews > 0 ? Math.round((totalCompletions / totalViews) * 100) : 0;

    const underperforming: UnderperformingLesson[] = result.results
      .filter((r) => r.total_views >= 10 && (r.total_completions / r.total_views) < 0.5)
      .map((r) => {
        const rate = Math.round((r.total_completions / r.total_views) * 100);
        const mostCommonDropOff = r.drop_off_beats
          ?.split(',')
          .filter(Boolean)
          .reduce((acc: Record<string, number>, beat: string) => {
            acc[beat] = (acc[beat] || 0) + 1;
            return acc;
          }, {});
        const topDropOff = mostCommonDropOff
          ? Object.entries(mostCommonDropOff).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null
          : null;

        return {
          lessonId: r.lesson_id,
          views: r.total_views,
          completions: r.total_completions,
          completionRate: rate,
          dropOffBeat: topDropOff,
          reason: rate < 30
            ? 'Very low completion rate'
            : topDropOff
              ? `Sharp drop-off at beat: ${topDropOff}`
              : 'Below average completion',
        };
      });

    const topLessons = [...metrics]
      .filter((m) => m.views >= 5)
      .sort((a, b) => b.completionRate - a.completionRate)
      .slice(0, 3);

    const report: EngagementReport = {
      courseId, underperformingLessons: underperforming, topLessons,
      totalViews, totalCompletions, overallCompletionRate,
    };

    this.setState({ ...this.state, lastReport: report });
    return report;
  }

  // --- Learning extraction ---

  /** Analyse an underperforming piece and extract learnings for future pieces */
  async analyseAndLearn(lessonData: UnderperformingLesson): Promise<EngagementLearning> {
    const client = new Anthropic({ apiKey: this.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1500,
      system: LEARNER_ANALYSE_PROMPT,
      messages: [
        {
          role: 'user',
          content: `## Underperforming piece
- Piece: ${lessonData.lessonId}
- Completion rate: ${lessonData.completionRate}%
- Views: ${lessonData.views}
- Drop-off beat: ${lessonData.dropOffBeat ?? 'unknown'}
- Problem: ${lessonData.reason}

Extract learnings for future pieces. What should the Drafter do differently next time?`,
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
    let parsed: { learnings: string[] };
    try {
      parsed = extractJson<{ learnings: string[] }>(text);
    } catch {
      parsed = { learnings: [] };
    }

    for (const learning of parsed.learnings) {
      try {
        await writeLearning(
          this.env.DB,
          'engagement',
          learning,
          {
            lessonId: lessonData.lessonId,
            completionRate: lessonData.completionRate,
            dropOffBeat: lessonData.dropOffBeat,
          },
          70,
          'reader',
        );
      } catch { /* learning write shouldn't break */ }
    }

    this.setState({ ...this.state, learningsWritten: this.state.learningsWritten + parsed.learnings.length });

    return {
      lessonId: lessonData.lessonId,
      problem: lessonData.reason,
      learnings: parsed.learnings,
    };
  }
}
