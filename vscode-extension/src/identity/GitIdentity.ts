import * as vscode from 'vscode';
import { execSync } from 'child_process';

export interface UserIdentity {
  name: string;
  email: string;
  source: 'git' | 'settings' | 'machineId';
}

/**
 * Resolves the current user's name and email.
 *
 * Priority order:
 * 1. VS Code extension settings (aiLocTracker.userName / aiLocTracker.userEmail)
 * 2. Git config (git config --get user.name / user.email) from workspace root
 * 3. VS Code machineId as fallback email
 */
export class GitIdentity {
  private cached: UserIdentity | null = null;
  

  public async resolve(): Promise<UserIdentity> {
    if (this.cached) return this.cached;

    // 1. Try extension settings first
    const config = vscode.workspace.getConfiguration('aiLocTracker');
    const settingsName = config.get<string>('userName', '').trim();
    const settingsEmail = config.get<string>('userEmail', '').trim();

    if (settingsName && settingsEmail) {
      this.cached = { name: settingsName, email: settingsEmail, source: 'settings' };
      return this.cached;
    }

    // 2. Try git config from workspace root
    const workspaceRoot = this.getWorkspaceRoot();
    if (workspaceRoot) {
      const gitIdentity = this.readGitConfig(workspaceRoot);
      if (gitIdentity) {
        // Fill in any missing pieces from settings
        const name = settingsName || gitIdentity.name;
        const email = settingsEmail || gitIdentity.email;
        if (name && email) {
          this.cached = { name, email, source: 'git' };
          return this.cached;
        }
      }
    }

    // 3. Fallback: prompt user to configure identity
    const identity = await this.promptForIdentity();
    this.cached = identity;
    return identity;
  }

  /** Clears the cache so identity is re-resolved on next call. */
  public invalidate(): void {
    this.cached = null;
  }

  private getWorkspaceRoot(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;
    return folders[0].uri.fsPath;
  }

  private readGitConfig(cwd: string): { name: string; email: string } | null {
    try {
      const name = execSync('git config --get user.name', {
        cwd,
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      const email = execSync('git config --get user.email', {
        cwd,
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      if (name && email) return { name, email };
      return null;
    } catch {
      // git not available or not a git repo
      return null;
    }
  }

  private async promptForIdentity(): Promise<UserIdentity> {
    const choice = await vscode.window.showWarningMessage(
      'AI LoC Tracker: Could not determine your git identity. Please configure your name and email.',
      'Open Settings',
      'Use Machine ID'
    );

    if (choice === 'Open Settings') {
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'aiLocTracker'
      );
      // After user closes settings, try again
      const config = vscode.workspace.getConfiguration('aiLocTracker');
      const name = config.get<string>('userName', '').trim();
      const email = config.get<string>('userEmail', '').trim();
      if (name && email) {
        return { name, email, source: 'settings' };
      }
    }

    // Fallback: use machineId
    const machineId = vscode.env.machineId;
    return {
      name: `User-${machineId.slice(0, 8)}`,
      email: `${machineId}@vscode-machine`,
      source: 'machineId',
    };
  }
}
