import { Agent } from 'agents';
import type { Env } from './types';

export interface NewsCandidate {
  id: string;
  headline: string;
  source: string;
  category: string;
  summary: string;
  url: string;
}

interface ScannerState {
  lastScanned: number | null;
  candidateCount: number;
}

// Google News RSS feeds — free, no API key needed
const RSS_FEEDS: Record<string, string> = {
  TOP: 'https://news.google.com/rss?hl=en&gl=US&ceid=US:en',
  TECHNOLOGY: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB?hl=en&gl=US&ceid=US:en',
  SCIENCE: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp0Y1RjU0FtVnVHZ0pWVXlnQVAB?hl=en&gl=US&ceid=US:en',
  BUSINESS: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB?hl=en&gl=US&ceid=US:en',
  HEALTH: 'https://news.google.com/rss/topics/CAAqIQgKIhtDQkFTRGdvSUwyMHZNR3QwTlRFU0FtVnVLQUFQAQ?hl=en&gl=US&ceid=US:en',
  WORLD: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx1YlY4U0FtVnVHZ0pWVXlnQVAB?hl=en&gl=US&ceid=US:en',
};

/**
 * ScannerAgent — fetches news from Google News RSS daily.
 * Parses headlines, deduplicates, stores candidates in D1.
 * The Director then picks the most teachable story.
 */
export class ScannerAgent extends Agent<Env, ScannerState> {
  initialState: ScannerState = { lastScanned: null, candidateCount: 0 };

  /** Scan all RSS feeds and store candidates. `pieceId` is the
   *  run-scoped UUID pre-allocated by Director at the top of
   *  triggerDailyPiece — stamped onto every candidate row so the
   *  admin per-piece view can filter candidates by piece_id at
   *  multi-per-day cadence. Orphan piece_ids (scanner-skipped runs)
   *  are acceptable; readers filter on daily_pieces.id JOIN where
   *  needed. See DECISIONS 2026-04-22 "piece_id columns on day-keyed
   *  tables". */
  async scan(pieceId: string): Promise<NewsCandidate[]> {
    const today = new Date().toISOString().slice(0, 10);
    const allCandidates: NewsCandidate[] = [];
    const seenHeadlines = new Set<string>();

    // Optional env override — lets ops change feeds without a redeploy.
    // Malformed JSON silently falls back to the hardcoded defaults below.
    let feeds: Record<string, string> = RSS_FEEDS;
    if (this.env.SCANNER_RSS_FEEDS_JSON) {
      try {
        feeds = JSON.parse(this.env.SCANNER_RSS_FEEDS_JSON);
      } catch {
        feeds = RSS_FEEDS;
      }
    }

    for (const [category, feedUrl] of Object.entries(feeds)) {
      try {
        const candidates = await this.fetchFeed(feedUrl, category);
        for (const c of candidates) {
          // Deduplicate by headline similarity
          const key = c.headline.toLowerCase().slice(0, 60);
          if (!seenHeadlines.has(key)) {
            seenHeadlines.add(key);
            allCandidates.push(c);
          }
        }
      } catch {
        // One feed failing shouldn't stop others
      }
    }

    // Store in D1
    const now = Date.now();
    for (const candidate of allCandidates.slice(0, 50)) {
      try {
        await this.env.DB
          .prepare(
            `INSERT OR IGNORE INTO daily_candidates (id, date, headline, source, category, summary, url, created_at, piece_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(candidate.id, today, candidate.headline, candidate.source, candidate.category, candidate.summary, candidate.url, now, pieceId)
          .run();
      } catch { /* continue */ }
    }

    this.setState({ lastScanned: now, candidateCount: allCandidates.length });
    return allCandidates.slice(0, 50);
  }

  /** Get today's candidates from D1 */
  async getTodayCandidates(): Promise<NewsCandidate[]> {
    const today = new Date().toISOString().slice(0, 10);
    const result = await this.env.DB
      .prepare('SELECT * FROM daily_candidates WHERE date = ? ORDER BY created_at')
      .bind(today)
      .all<NewsCandidate & { date: string; created_at: number }>();
    return result.results;
  }

  /** Fetch and parse a Google News RSS feed */
  private async fetchFeed(url: string, category: string): Promise<NewsCandidate[]> {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Zeemish/1.0 (news aggregator for educational content)' },
    });

    if (!response.ok) return [];
    const xml = await response.text();

    // Simple XML parsing — extract <item> elements
    const items: NewsCandidate[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const itemXml = match[1];
      const title = this.extractTag(itemXml, 'title');
      const link = this.extractTag(itemXml, 'link');
      const description = this.extractTag(itemXml, 'description');
      const source = this.extractTag(itemXml, 'source');

      if (title) {
        items.push({
          id: crypto.randomUUID(),
          headline: this.cleanHtml(title),
          source: source || category,
          category,
          summary: this.cleanHtml(description || '').slice(0, 500),
          url: link || '',
        });
      }
    }

    return items.slice(0, 15); // Max 15 per feed
  }

  private extractTag(xml: string, tag: string): string {
    const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
    return match?.[1]?.trim() ?? '';
  }

  private cleanHtml(text: string): string {
    return text
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }
}
