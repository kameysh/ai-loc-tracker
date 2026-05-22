import * as vscode from 'vscode';

import { SourceResolver } from './detection/SourceResolver';
import { CompletionInterceptor } from './detection/CompletionInterceptor';
import { HumanTypingTracker } from './detection/HumanTypingTracker';
import { GitIdentity } from './identity/GitIdentity';
import { LocalStore } from './storage/LocalStore';
import { StatusBar } from './ui/StatusBar';
import { TokenSetup } from './ui/TokenSetup';
import { GitHubSync } from './sync/GitHubSync';

// Buffered sync state — failed syncs are retried on next save
interface PendingSyncState {
  hasPending: boolean;
  failureCount: number;
}

export function activate(context: vscode.ExtensionContext): void {
  console.log('[AI LoC Tracker] Activating...');

  // ── Core services ──────────────────────────────────────────────────────────
  const store = new LocalStore();
  const tokenSetup = new TokenSetup(context.secrets, context.globalState);
  const gitIdentity = new GitIdentity();
  const sourceResolver = new SourceResolver();

  const githubSync = new GitHubSync(() => tokenSetup.getToken());

  const interceptor = new CompletionInterceptor(sourceResolver);
  interceptor.register(context);

  const humanTracker = new HumanTypingTracker(interceptor);
  const statusBar = new StatusBar(store);

  // ── Pending sync buffer ────────────────────────────────────────────────────
  const pendingSync: PendingSyncState = { hasPending: false, failureCount: 0 };

  // ── Identity (resolved lazily) ─────────────────────────────────────────────
  let identityEmail: string | null = null;
  let identityName: string | null = null;

  async function ensureIdentity(): Promise<{ email: string; name: string } | null> {
    if (identityEmail && identityName) {
      return { email: identityEmail, name: identityName };
    }
    try {
      const identity = await gitIdentity.resolve();
      identityEmail = identity.email;
      identityName = identity.name;
      statusBar.setCurrentUser(identity.email);
      return { email: identity.email, name: identity.name };
    } catch (err) {
      console.error('[AI LoC Tracker] Failed to resolve identity:', err);
      return null;
    }
  }

  // ── AI acceptance handler ──────────────────────────────────────────────────
  const aiAcceptSub = interceptor.onAIAccept(async (event) => {
    if (event.source === 'unknown') return;

    const identity = await ensureIdentity();
    if (!identity) return;

    store.recordAILines(
      identity.email,
      identity.name,
      event.source,
      event.linesAdded,
      event.linesRemoved,
      event.language
    );

    statusBar.addAILines(event.source, event.linesAdded, event.linesRemoved);
    pendingSync.hasPending = true;
  });
  context.subscriptions.push(aiAcceptSub);

  // ── Human typing handler ───────────────────────────────────────────────────
  const humanSub = humanTracker.onHumanChange(async (event) => {
    const identity = await ensureIdentity();
    if (!identity) return;

    store.recordHumanLines(
      identity.email,
      identity.name,
      event.linesAdded,
      event.linesRemoved,
      event.language
    );

    statusBar.addHumanLines(event.linesAdded, event.linesRemoved);
    pendingSync.hasPending = true;
  });
  context.subscriptions.push(humanSub);

  // ── File save → GitHub sync ────────────────────────────────────────────────
  const saveSub = vscode.workspace.onDidSaveTextDocument(async () => {
    const syncEnabled = vscode.workspace
      .getConfiguration('aiLocTracker')
      .get<boolean>('syncOnSave', true);

    if (!syncEnabled) return;
    if (!pendingSync.hasPending && pendingSync.failureCount === 0) return;

    const identity = await ensureIdentity();
    if (!identity) return;

    await performSync(identity.email);
  });
  context.subscriptions.push(saveSub);

  async function performSync(currentEmail: string): Promise<void> {
    statusBar.setSyncStatus('syncing');

    // Build the merged payload
    const mergedData = store.mergeRemote(store.getData(), currentEmail);

    const result = await githubSync.push(mergedData);

    if (result.ok) {
      pendingSync.hasPending = false;
      pendingSync.failureCount = 0;
      statusBar.setSyncStatus('ok');
    } else {
      pendingSync.failureCount++;
      statusBar.setSyncStatus('warning');

      if (result.reason === 'no-token') {
        const choice = await vscode.window.showWarningMessage(
          'AI LoC Tracker: GitHub token missing or invalid. Stats are saved locally.',
          'Set Token'
        );
        if (choice === 'Set Token') {
          const token = await tokenSetup.promptForToken();
          if (token) {
            githubSync.invalidateClient();
            // Retry immediately
            await performSync(currentEmail);
          }
        }
      } else if (pendingSync.failureCount === 1) {
        // Only show the warning once per failure run to avoid spam
        void vscode.window.showWarningMessage(
          `AI LoC Tracker: GitHub sync failed (${result.error ?? result.reason}). Will retry on next save.`
        );
      }
    }
  }

  // ── Commands ───────────────────────────────────────────────────────────────
  const setTokenCmd = vscode.commands.registerCommand(
    'ai-loc-tracker.setToken',
    async () => {
      const token = await tokenSetup.promptForToken();
      if (token) {
        githubSync.invalidateClient();
      }
    }
  );
  context.subscriptions.push(setTokenCmd);

  const showStatsCmd = vscode.commands.registerCommand(
    'ai-loc-tracker.showStats',
    async () => {
      const identity = await ensureIdentity();
      showStatsWebview(context, store, identity?.email ?? null);
    }
  );
  context.subscriptions.push(showStatsCmd);

  // ── Register disposables ───────────────────────────────────────────────────
  context.subscriptions.push(
    interceptor,
    humanTracker,
    sourceResolver,
    statusBar
  );

  // ── First-run flow ─────────────────────────────────────────────────────────
  void tokenSetup.ensureTokenOnFirstRun();
  sourceResolver.checkAndWarnMissingExtensions();

  // Pre-warm identity resolution so we're ready on first keystroke
  void ensureIdentity();

  console.log('[AI LoC Tracker] Activated successfully.');
}

export function deactivate(): void {
  console.log('[AI LoC Tracker] Deactivated.');
}

// ── Stats Webview ─────────────────────────────────────────────────────────────

function showStatsWebview(
  _context: vscode.ExtensionContext,
  store: LocalStore,
  currentEmail: string | null
): void {
  const panel = vscode.window.createWebviewPanel(
    'aiLocTrackerStats',
    'AI vs Human LoC Stats',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  panel.webview.html = buildStatsHtml(store, currentEmail);
}

function buildStatsHtml(store: LocalStore, currentEmail: string | null): string {
  const data = store.getData();
  const userStats = currentEmail ? data.users[currentEmail] : null;
  const today = new Date().toISOString().slice(0, 10);
  const todayStats = userStats?.dailyStats[today];

  const allTime = userStats?.totals;
  const byLanguage = userStats?.byLanguage ?? {};

  const languageRows = Object.entries(byLanguage)
    .sort((a, b) => {
      const totalA = a[1].copilot + a[1].gemini + a[1].human;
      const totalB = b[1].copilot + b[1].gemini + b[1].human;
      return totalB - totalA;
    })
    .slice(0, 20)
    .map(([lang, counts]) => {
      const total = counts.copilot + counts.gemini + counts.human;
      const aiPct =
        total > 0 ? Math.round(((counts.copilot + counts.gemini) / total) * 100) : 0;
      return `<tr>
        <td>${escapeHtml(lang)}</td>
        <td>${counts.copilot}</td>
        <td>${counts.gemini}</td>
        <td>${counts.human}</td>
        <td>${aiPct}%</td>
      </tr>`;
    })
    .join('');

  const dailyRows = Object.entries(userStats?.dailyStats ?? {})
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 30)
    .map(([date, counts]) => {
      const total = counts.copilot + counts.gemini + counts.human;
      const aiPct =
        total > 0 ? Math.round(((counts.copilot + counts.gemini) / total) * 100) : 0;
      return `<tr>
        <td>${escapeHtml(date)}</td>
        <td>${counts.copilot}</td>
        <td>${counts.gemini}</td>
        <td>${counts.human}</td>
        <td>${aiPct}%</td>
      </tr>`;
    })
    .join('');

  const allUsers = Object.values(data.users)
    .sort((a, b) => b.lastActive - a.lastActive)
    .map((u) => {
      const aiTotal = u.totals.copilot.added + u.totals.gemini.added;
      const humanTotal = u.totals.human.added;
      const total = aiTotal + humanTotal;
      const aiPct = total > 0 ? Math.round((aiTotal / total) * 100) : 0;
      const isMe = u.email === currentEmail ? ' (you)' : '';
      return `<tr>
        <td>${escapeHtml(u.name)}${escapeHtml(isMe)}</td>
        <td>${aiTotal}</td>
        <td>${humanTotal}</td>
        <td>${aiPct}%</td>
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AI vs Human LoC Stats</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
           background: var(--vscode-editor-background); padding: 20px; max-width: 900px; }
    h1, h2 { color: var(--vscode-titleBar-activeForeground); }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    th { background: var(--vscode-editor-selectionBackground); padding: 8px 12px; text-align: left; }
    td { padding: 6px 12px; border-bottom: 1px solid var(--vscode-widget-border); }
    tr:hover td { background: var(--vscode-list-hoverBackground); }
    .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
    .card { background: var(--vscode-sideBar-background); border: 1px solid var(--vscode-widget-border);
            border-radius: 6px; padding: 16px; }
    .card-label { font-size: 0.85em; opacity: 0.7; }
    .card-value { font-size: 2em; font-weight: bold; margin: 4px 0; }
    .card-sub { font-size: 0.8em; opacity: 0.6; }
    .no-data { opacity: 0.5; font-style: italic; }
    .updated { font-size: 0.8em; opacity: 0.5; margin-bottom: 20px; }
  </style>
</head>
<body>
  <h1>AI vs Human LoC Stats</h1>
  <p class="updated">Last updated: ${new Date(data.lastUpdated).toLocaleString()}</p>

  ${userStats ? `
  <h2>Your Stats — ${escapeHtml(userStats.name)}</h2>
  <div class="summary-grid">
    <div class="card">
      <div class="card-label">Copilot (all-time)</div>
      <div class="card-value">${allTime?.copilot.added ?? 0}</div>
      <div class="card-sub">lines added</div>
    </div>
    <div class="card">
      <div class="card-label">Gemini (all-time)</div>
      <div class="card-value">${allTime?.gemini.added ?? 0}</div>
      <div class="card-sub">lines added</div>
    </div>
    <div class="card">
      <div class="card-label">Human (all-time)</div>
      <div class="card-value">${allTime?.human.added ?? 0}</div>
      <div class="card-sub">lines added</div>
    </div>
  </div>

  ${todayStats ? `
  <h2>Today (${escapeHtml(today)})</h2>
  <div class="summary-grid">
    <div class="card">
      <div class="card-label">Copilot</div>
      <div class="card-value">${todayStats.copilot}</div>
    </div>
    <div class="card">
      <div class="card-label">Gemini</div>
      <div class="card-value">${todayStats.gemini}</div>
    </div>
    <div class="card">
      <div class="card-label">Human</div>
      <div class="card-value">${todayStats.human}</div>
    </div>
  </div>` : ''}

  <h2>By Language</h2>
  ${languageRows ? `
  <table>
    <thead><tr><th>Language</th><th>Copilot</th><th>Gemini</th><th>Human</th><th>AI %</th></tr></thead>
    <tbody>${languageRows}</tbody>
  </table>` : '<p class="no-data">No language data yet.</p>'}

  <h2>Daily History (last 30 days)</h2>
  ${dailyRows ? `
  <table>
    <thead><tr><th>Date</th><th>Copilot</th><th>Gemini</th><th>Human</th><th>AI %</th></tr></thead>
    <tbody>${dailyRows}</tbody>
  </table>` : '<p class="no-data">No daily data yet.</p>'}
  ` : '<p class="no-data">No stats recorded yet. Start coding to begin tracking!</p>'}

  <h2>All Contributors</h2>
  ${allUsers ? `
  <table>
    <thead><tr><th>User</th><th>AI Lines</th><th>Human Lines</th><th>AI %</th></tr></thead>
    <tbody>${allUsers}</tbody>
  </table>` : '<p class="no-data">No contributor data yet.</p>'}
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
