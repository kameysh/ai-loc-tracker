import * as vscode from 'vscode';

const SECRET_KEY = 'aiLocTracker.githubPAT';
const PROMPT_SHOWN_KEY = 'aiLocTracker.patPromptShown';

/**
 * Manages the GitHub Personal Access Token stored in VS Code SecretStorage.
 * Provides a guided first-run flow that prompts the user exactly once
 * (unless they explicitly invoke the set-token command again).
 */
export class TokenSetup {
  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly globalState: vscode.Memento
  ) {}

  /**
   * Returns the stored PAT, or null if not configured.
   */
  public async getToken(): Promise<string | null> {
    const token = await this.secrets.get(SECRET_KEY);
    return token ?? null;
  }

  /**
   * Stores a new PAT in SecretStorage.
   */
  public async setToken(token: string): Promise<void> {
    await this.secrets.store(SECRET_KEY, token);
    await this.globalState.update(PROMPT_SHOWN_KEY, true);
  }

  /**
   * Deletes the stored PAT.
   */
  public async clearToken(): Promise<void> {
    await this.secrets.delete(SECRET_KEY);
  }

  /**
   * Interactively prompts the user to enter their GitHub PAT.
   * Called both from the command and from first-run flow.
   * Returns the entered token, or null if cancelled.
   */
  public async promptForToken(): Promise<string | null> {
    const token = await vscode.window.showInputBox({
      title: 'AI LoC Tracker: GitHub Personal Access Token',
      prompt:
        'Enter a GitHub PAT with repo scope to sync stats. ' +
        'Create one at https://github.com/settings/tokens',
      password: true,
      placeHolder: 'ghp_xxxxxxxxxxxxxxxxxxxx',
      validateInput: (value) => {
        if (!value || value.trim().length === 0) return 'Token cannot be empty';
        if (!value.startsWith('ghp_') && !value.startsWith('github_pat_')) {
          return 'Token should start with ghp_ or github_pat_';
        }
        return null;
      },
    });

    if (token) {
      const trimmed = token.trim();
      await this.setToken(trimmed);
      void vscode.window.showInformationMessage(
        'AI LoC Tracker: GitHub token saved. Stats will sync on next file save.'
      );
      return trimmed;
    }
    return null;
  }

  /**
   * Shows a one-time prompt on first activation if no token is configured.
   * Respects the user's choice to dismiss without setting a token.
   */
  public async ensureTokenOnFirstRun(): Promise<void> {
    const alreadyPrompted = this.globalState.get<boolean>(PROMPT_SHOWN_KEY, false);
    if (alreadyPrompted) return;

    const existing = await this.getToken();
    if (existing) {
      await this.globalState.update(PROMPT_SHOWN_KEY, true);
      return;
    }

    // Mark as prompted so we don't nag again
    await this.globalState.update(PROMPT_SHOWN_KEY, true);

    const choice = await vscode.window.showInformationMessage(
      'AI LoC Tracker is active! Set a GitHub PAT to sync your stats to a shared dashboard.',
      'Set Token Now',
      'Later'
    );

    if (choice === 'Set Token Now') {
      await this.promptForToken();
    }
  }
}
