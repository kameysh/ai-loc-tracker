import * as vscode from 'vscode';
import { LocalStore } from '../storage/LocalStore';

const TODAY = () => new Date().toISOString().slice(0, 10);

export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly interval: ReturnType<typeof setInterval>;
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

    this.interval = setInterval(() => this.render(), 10_000);
  }

  public setCurrentUser(email: string): void {
    this.currentUserEmail = email;
    this.render();
  }

  // Called after every tracked change so the status bar re-reads the store
  public addAILines(_provider: 'copilot' | 'gemini', _added: number, _removed: number): void {
    this.render();
  }

  public addHumanLines(_added: number, _removed: number): void {
    this.render();
  }

  public setSyncStatus(status: 'ok' | 'warning' | 'syncing'): void {
    this.syncStatus = status;
    this.render();
  }

  private render(): void {
    // Read today's net directly from the local store — always in sync with what will be pushed
    const today = TODAY();
    let humanToday = 0, copilotToday = 0, geminiToday = 0;
    let humanAllTime = 0, copilotAllTime = 0, geminiAllTime = 0;

    if (this.currentUserEmail) {
      const userStats = this.store.getUserStats(this.currentUserEmail);
      if (userStats) {
        const day = userStats.dailyStats[today];
        if (day) {
          humanToday   = Math.max(0, day.human);
          copilotToday = Math.max(0, day.copilot);
          geminiToday  = Math.max(0, day.gemini);
        }
        const t = userStats.totals;
        humanAllTime   = Math.max(0, t.human.added   - t.human.removed);
        copilotAllTime = Math.max(0, t.copilot.added - t.copilot.removed);
        geminiAllTime  = Math.max(0, t.gemini.added  - t.gemini.removed);
      }
    }

    const aiToday    = copilotToday + geminiToday;
    const syncIcon   = this.syncStatusIcon();
    this.item.text   = `$(robot) AI: ${aiToday}  $(person) Human: ${humanToday}${syncIcon}`;

    const lines: string[] = [
      'AI vs Human LoC Tracker',
      '',
      `Today (${today}):`,
      `  Copilot: ${copilotToday} lines`,
      `  Gemini:  ${geminiToday} lines`,
      `  Human:   ${humanToday} lines`,
      '',
      'All-time net:',
      `  Copilot: ${copilotAllTime} lines`,
      `  Gemini:  ${geminiAllTime} lines`,
      `  Human:   ${humanAllTime} lines`,
    ];

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
