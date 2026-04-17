import { Agent } from 'agents';
import type { Env } from './types';

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
 * HARD RULE: never overwrites existing files. Published content is permanent.
 */
export class PublisherAgent extends Agent<Env, PublisherState> {
  initialState: PublisherState = { lastPublish: null };

  /** Publish to a specific file path (daily pieces) */
  async publishToPath(filePath: string, mdx: string, commitMessage: string): Promise<PublishResult> {
    // HARD RULE: published content is permanent. Never overwrite.
    const existingSha = await this.getFileSha(filePath);
    if (existingSha) {
      throw new Error(`Refused to overwrite published piece: ${filePath}`);
    }

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

  /** Check if a file exists in the repo */
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
}
