import * as vscode from 'vscode';
import { LocalStore } from '../storage/LocalStore';

interface SessionStats {
  humanAdded: number;
  copilotAdded: number;
  geminiAdded: number;
}

/**
 * Manages the VS Code status bar item showing real-time AI vs Human LoC counts.
 *
 * Display format: $(robot) AI: 234  $(person) Human: 456
 * Tooltip shows breakdown by Copilot vs Gemini.
 *
 * Updates:
 * - Immediately on each tracked change (via update())
 * - Every 30 seconds via a background interval
 */
export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly interval: ReturnType<typeof setInterval>;
  private session: SessionStats = { humanAdded: 0, copilotAdded: 0, geminiAdded: 0 };
  private syncStatus: 'ok' | 'warning' | 'syncing' = 'ok';
  private currentUserEmail: string | null = null;

  constructor(private readonly store: LocalStore) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.item.command = 'ai-loc-tracker.showStats';
    this.item.name = 'AI vs Human LoC';

    this.render();
    this.item.show();

    // Refresh every 30 seconds to keep totals current
    this.interval = setInterval(() => this.render(), 30_000);
  }

  public setCurrentUser(email: string): void {
    this.currentUserEmail = email;
    this.render();
  }

  public addAILines(
    provider: 'copilot' | 'gemini',
    linesAdded: number
  ): void {
    if (provider === 'copilot') {
      this.session.copilotAdded += linesAdded;
    } else {
      this.session.geminiAdded += linesAdded;
    }
    this.render();
  }

  public addHumanLines(linesAdded: number): void {
    this.session.humanAdded += linesAdded;
    this.render();
  }

  public setSyncStatus(status: 'ok' | 'warning' | 'syncing'): void {
    this.syncStatus = status;
    this.render();
  }

  private render(): void {
    const aiTotal = this.session.copilotAdded + this.session.geminiAdded;
    const humanTotal = this.session.humanAdded;

    // Build the status bar text
    const syncIcon = this.syncStatusIcon();
    this.item.text = `$(robot) AI: ${aiTotal}  $(person) Human: ${humanTotal}${syncIcon}`;

    // Build the tooltip with breakdown
    const lines: string[] = [
      'AI vs Human LoC Tracker',
      '',
      `Session totals:`,
      `  Copilot: ${this.session.copilotAdded} lines`,
      `  Gemini:  ${this.session.geminiAdded} lines`,
      `  Human:   ${this.session.humanAdded} lines`,
    ];

    // Add all-time totals if we have a user
    if (this.currentUserEmail) {
      const userStats = this.store.getUserStats(this.currentUserEmail);
      if (userStats) {
        const t = userStats.totals;
        lines.push(
          '',
          'All-time totals:',
          `  Copilot: ${t.copilot.added} added / ${t.copilot.removed} removed`,
          `  Gemini:  ${t.gemini.added} added / ${t.gemini.removed} removed`,
          `  Human:   ${t.human.added} added / ${t.human.removed} removed`
        );
      }
    }

    if (this.syncStatus === 'warning') {
      lines.push('', '⚠ GitHub sync failed — will retry on next save');
    } else if (this.syncStatus === 'syncing') {
      lines.push('', '⟳ Syncing to GitHub...');
    }

    lines.push('', 'Click to view full stats');
    this.item.tooltip = new vscode.MarkdownString(
      lines.map((l) => (l === '' ? '' : l)).join('\n')
    );
  }

  private syncStatusIcon(): string {
    switch (this.syncStatus) {
      case 'warning':
        return ' $(warning)';
      case 'syncing':
        return ' $(sync~spin)';
      default:
        return '';
    }
  }

  public dispose(): void {
    clearInterval(this.interval);
    this.item.dispose();
  }
}
