import { Agent } from 'agents';
import type { Env } from './types';

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

interface EngagementAnalystState {
  lastReport: EngagementReport | null;
}

/**
 * EngagementAnalystAgent — watches reader engagement data.
 * Identifies underperforming lessons (low completion, sharp drop-offs)
 * and signals the Reviser to propose improvements.
 *
 * Runs on schedule (daily) via Director, or on demand.
 */
export class EngagementAnalystAgent extends Agent<Env, EngagementAnalystState> {
  initialState: EngagementAnalystState = { lastReport: null };

  /** Analyse engagement for a course over the last N days */
  async analyse(courseId: string, days = 7): Promise<EngagementReport> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().slice(0, 10);

    // Get aggregated engagement per lesson
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

    // Identify underperforming lessons (completion < 50% with ≥ 10 views)
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

    // Top lessons by completion rate
    const topLessons = [...metrics]
      .filter((m) => m.views >= 5)
      .sort((a, b) => b.completionRate - a.completionRate)
      .slice(0, 3);

    const report: EngagementReport = {
      courseId,
      underperformingLessons: underperforming,
      topLessons,
      totalViews,
      totalCompletions,
      overallCompletionRate,
    };

    this.setState({ lastReport: report });
    return report;
  }
}
