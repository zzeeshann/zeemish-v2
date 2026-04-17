import { Agent } from 'agents';
import type { Env, LessonBrief } from './types';

export interface PublishResult {
  published: boolean;
  filePath: string;
  commitSha: string;
  commitUrl: string;
}

interface PublisherState {
  lastPublish: PublishResult | null;
}

const REPO_OWNER = 'zzeeshann';
const REPO_NAME = 'zeemish-v2';
const BRANCH = 'main';

/**
 * PublisherAgent — commits approved MDX files to the GitHub repo.
 * Uses the GitHub Contents API to create/update files directly,
 * which triggers the GitHub Actions deploy pipeline automatically.
 */
export class PublisherAgent extends Agent<Env, PublisherState> {
  initialState: PublisherState = { lastPublish: null };

  async publish(brief: LessonBrief, mdx: string): Promise<PublishResult> {
    const slug = this.slugify(brief.title);
    const filePath = `content/lessons/${brief.courseSlug}/${String(brief.lessonNumber).padStart(2, '0')}-${slug}.mdx`;
    const commitMessage = `feat(lesson): ${brief.courseSlug}/${brief.lessonNumber} — ${brief.title} (agent-authored)`;

    // Check if file already exists (to get its SHA for updates)
    const existingSha = await this.getFileSha(filePath);

    // Create or update the file via GitHub Contents API
    const response = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${this.env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'zeemish-agents',
        },
        body: JSON.stringify({
          message: commitMessage,
          content: btoa(unescape(encodeURIComponent(mdx))), // Base64 encode (handles UTF-8)
          branch: BRANCH,
          ...(existingSha ? { sha: existingSha } : {}),
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${error}`);
    }

    const data = await response.json() as {
      commit: { sha: string; html_url: string };
      content: { path: string };
    };

    const result: PublishResult = {
      published: true,
      filePath: data.content.path,
      commitSha: data.commit.sha,
      commitUrl: data.commit.html_url,
    };

    this.setState({ lastPublish: result });
    return result;
  }

  /** Publish to a specific file path (for daily pieces) */
  async publishToPath(filePath: string, mdx: string, commitMessage: string): Promise<PublishResult> {
    const existingSha = await this.getFileSha(filePath);

    const response = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${this.env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': 'zeemish-agents',
        },
        body: JSON.stringify({
          message: commitMessage,
          content: btoa(unescape(encodeURIComponent(mdx))),
          branch: BRANCH,
          ...(existingSha ? { sha: existingSha } : {}),
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub API error (${response.status}): ${error}`);
    }

    const data = await response.json() as {
      commit: { sha: string; html_url: string };
      content: { path: string };
    };

    const result: PublishResult = {
      published: true,
      filePath: data.content.path,
      commitSha: data.commit.sha,
      commitUrl: data.commit.html_url,
    };

    this.setState({ lastPublish: result });
    return result;
  }

  /** Check if a file exists in the repo and get its SHA (needed for updates) */
  private async getFileSha(filePath: string): Promise<string | null> {
    const response = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}?ref=${BRANCH}`,
      {
        headers: {
          'Authorization': `Bearer ${this.env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'zeemish-agents',
        },
      },
    );

    if (response.status === 404) return null;
    if (!response.ok) return null;

    const data = await response.json() as { sha: string };
    return data.sha;
  }

  /** Convert a title to a URL-safe slug */
  private slugify(title: string): string {
    return title
      .toLowerCase()
      .replace(/['']/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
}
