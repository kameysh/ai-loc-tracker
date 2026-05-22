import * as vscode from 'vscode';
import { Octokit } from '@octokit/rest';
import { DashboardData } from '../storage/LocalStore';

const DATA_PATH = 'data/stats.json';
const COMMIT_MESSAGE = 'chore: update ai-loc-tracker stats';

export type SyncResult =
  | { ok: true }
  | { ok: false; reason: 'no-token' | 'network' | 'conflict' | 'unknown'; error?: string };

interface RepoCoords {
  owner: string;
  repo: string;
}

/**
 * Syncs the merged DashboardData to a GitHub repository using the REST API.
 *
 * Flow:
 * 1. GET current file content + SHA
 * 2. Merge remote data with local (preserving other users)
 * 3. PUT updated content using the retrieved SHA
 *
 * Uses @octokit/rest with the user's stored PAT.
 * Handles 409 conflict (SHA mismatch) by retrying once with fresh SHA.
 */
export class GitHubSync {
  private octokit: Octokit | null = null;

  constructor(private readonly getToken: () => Promise<string | null>) {}

  private async getOctokit(): Promise<Octokit | null> {
    const token = await this.getToken();
    if (!token) return null;

    // Re-use cached instance if token hasn't changed
    if (!this.octokit) {
      this.octokit = new Octokit({ auth: token });
    }
    return this.octokit;
  }

  /** Call this when the token changes so the cached client is refreshed. */
  public invalidateClient(): void {
    this.octokit = null;
  }

  private parseRepo(repoString: string): RepoCoords | null {
    const parts = repoString.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    return { owner: parts[0], repo: parts[1] };
  }

  /**
   * Pushes the merged stats to GitHub.
   * Returns a SyncResult indicating success or failure reason.
   */
  public async push(mergedData: DashboardData): Promise<SyncResult> {
    const octokit = await this.getOctokit();
    if (!octokit) {
      return { ok: false, reason: 'no-token' };
    }

    const config = vscode.workspace.getConfiguration('aiLocTracker');
    const repoString = config.get<string>('githubRepo', 'kameysh/ai-loc-tracker');
    const coords = this.parseRepo(repoString);
    if (!coords) {
      return {
        ok: false,
        reason: 'unknown',
        error: `Invalid githubRepo config: "${repoString}"`,
      };
    }

    return this.pushWithCoords(octokit, coords, mergedData, false);
  }

  private async pushWithCoords(
    octokit: Octokit,
    coords: RepoCoords,
    mergedData: DashboardData,
    isRetry: boolean
  ): Promise<SyncResult> {
    try {
      // Step 1: Fetch current file to get SHA (needed for PUT)
      let currentSha: string | undefined;
      let remoteDashboard: DashboardData | null = null;

      try {
        const response = await octokit.repos.getContent({
          owner: coords.owner,
          repo: coords.repo,
          path: DATA_PATH,
        });

        const fileData = response.data;
        if (!Array.isArray(fileData) && fileData.type === 'file') {
          currentSha = fileData.sha;
          if (fileData.content) {
            const decoded = Buffer.from(fileData.content, 'base64').toString('utf8');
            try {
              remoteDashboard = JSON.parse(decoded) as DashboardData;
            } catch {
              // Remote file is corrupt — we'll overwrite
            }
          }
        }
      } catch (err: unknown) {
        // 404 is fine — file doesn't exist yet, we'll create it
        if (!isOctokitError(err) || err.status !== 404) {
          throw err;
        }
      }

      // Step 2: Merge remote data with the merged data we were given
      // (mergedData already has the current user's latest stats merged in)
      let finalData = mergedData;
      if (remoteDashboard) {
        finalData = mergeRemotePreserveOthers(remoteDashboard, mergedData);
      }

      // Step 3: PUT the updated content
      const content = Buffer.from(
        JSON.stringify(finalData, null, 2)
      ).toString('base64');

      await octokit.repos.createOrUpdateFileContents({
        owner: coords.owner,
        repo: coords.repo,
        path: DATA_PATH,
        message: COMMIT_MESSAGE,
        content,
        ...(currentSha ? { sha: currentSha } : {}),
      });

      return { ok: true };
    } catch (err: unknown) {
      if (isOctokitError(err)) {
        if (err.status === 409 && !isRetry) {
          // SHA conflict — retry once with a fresh fetch
          return this.pushWithCoords(octokit, coords, mergedData, true);
        }
        if (err.status === 401 || err.status === 403) {
          return {
            ok: false,
            reason: 'no-token',
            error: 'GitHub authentication failed. Please update your PAT.',
          };
        }
        return {
          ok: false,
          reason: 'network',
          error: `GitHub API error ${err.status}: ${err.message}`,
        };
      }

      if (isNetworkError(err)) {
        return {
          ok: false,
          reason: 'network',
          error: `Network error: ${String(err)}`,
        };
      }

      return {
        ok: false,
        reason: 'unknown',
        error: String(err),
      };
    }
  }

  /**
   * Fetches the remote stats.json for merging before a push.
   * Returns null if not found or on error.
   */
  public async fetchRemote(): Promise<DashboardData | null> {
    const octokit = await this.getOctokit();
    if (!octokit) return null;

    const config = vscode.workspace.getConfiguration('aiLocTracker');
    const repoString = config.get<string>('githubRepo', 'kameysh/ai-loc-tracker');
    const coords = this.parseRepo(repoString);
    if (!coords) return null;

    try {
      const response = await octokit.repos.getContent({
        owner: coords.owner,
        repo: coords.repo,
        path: DATA_PATH,
      });

      const fileData = response.data;
      if (!Array.isArray(fileData) && fileData.type === 'file' && fileData.content) {
        const decoded = Buffer.from(fileData.content, 'base64').toString('utf8');
        return JSON.parse(decoded) as DashboardData;
      }
    } catch {
      // File doesn't exist or network error
    }
    return null;
  }
}

/**
 * Merges two DashboardData objects.
 * `incoming` (local merged data) wins for any users it contains.
 * Other users from `base` (remote) are preserved.
 */
function mergeRemotePreserveOthers(
  base: DashboardData,
  incoming: DashboardData
): DashboardData {
  return {
    lastUpdated: Date.now(),
    version: '1.0.0',
    users: {
      ...base.users,
      ...incoming.users,
    },
  };
}

interface OctokitError {
  status: number;
  message: string;
}

function isOctokitError(err: unknown): err is OctokitError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    typeof (err as OctokitError).status === 'number'
  );
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('network') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('timeout') ||
    msg.includes('fetch')
  );
}
