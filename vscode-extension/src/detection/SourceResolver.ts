import * as vscode from 'vscode';

export type SuggestionSource = 'copilot' | 'gemini' | 'unknown';

const COPILOT_EXTENSION_ID = 'GitHub.copilot';
const GEMINI_EXTENSION_ID = 'google.geminicodeassist';

/**
 * Resolves which AI extension (Copilot or Gemini) is currently providing
 * the visible inline suggestion. Uses a combination of:
 * 1. Tracking which extension last registered activity
 * 2. Checking which extensions are installed/active
 * 3. Priority ordering when both are active
 */
export class SourceResolver implements vscode.Disposable {
  private lastSuggestionSource: SuggestionSource = 'unknown';
  private lastCopilotActivity = 0;
  private lastGeminiActivity = 0;
  private readonly disposables: vscode.Disposable[] = [];
  private copilotAvailable = false;
  private geminiAvailable = false;
  private hasWarnedAboutMissingExtensions = false;

  constructor() {
    this.detectAvailableExtensions();
    this.wireActivityListeners();
  }

  private detectAvailableExtensions(): void {
    const copilotExt = vscode.extensions.getExtension(COPILOT_EXTENSION_ID);
    const geminiExt = vscode.extensions.getExtension(GEMINI_EXTENSION_ID);

    this.copilotAvailable = copilotExt !== undefined && copilotExt.isActive;
    this.geminiAvailable = geminiExt !== undefined && geminiExt.isActive;
  }

  private wireActivityListeners(): void {
    // Re-detect extensions whenever they are installed/activated
    const extChangeSub = vscode.extensions.onDidChange(() => {
      this.detectAvailableExtensions();
      this.checkAndWarnMissingExtensions();
    });
    this.disposables.push(extChangeSub);

    // Heuristic: track visible range changes as a proxy for suggestion activity.
    // Copilot and Gemini both trigger inline suggestion renders on selection change.
    const rangeChangeSub = vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      if (!e.visibleRanges || e.visibleRanges.length === 0) return;
      // We can't definitively distinguish here; this updates timestamps
      // so the "last active" heuristic has fresh data.
      this.refreshSourceFromContext();
    });
    this.disposables.push(rangeChangeSub);

    // Track cursor movement — both extensions respond to cursor position
    const selectionSub = vscode.window.onDidChangeTextEditorSelection(() => {
      this.refreshSourceFromContext();
    });
    this.disposables.push(selectionSub);
  }

  /**
   * Refreshes which source is "current" based on installed extensions.
   * When only one is installed, the answer is deterministic.
   * When both are installed, we track which one last showed activity
   * by monitoring their internal state changes.
   */
  private refreshSourceFromContext(): void {
    const copilotExt = vscode.extensions.getExtension(COPILOT_EXTENSION_ID);
    const geminiExt = vscode.extensions.getExtension(GEMINI_EXTENSION_ID);

    const copilotActive = copilotExt?.isActive ?? false;
    const geminiActive = geminiExt?.isActive ?? false;

    this.copilotAvailable = copilotActive;
    this.geminiAvailable = geminiActive;

    if (copilotActive && !geminiActive) {
      this.lastSuggestionSource = 'copilot';
      this.lastCopilotActivity = Date.now();
    } else if (geminiActive && !copilotActive) {
      this.lastSuggestionSource = 'gemini';
      this.lastGeminiActivity = Date.now();
    } else if (copilotActive && geminiActive) {
      // Both active: check for Copilot pending completions as a proxy
      const hasCopilotPending = this.checkCopilotPending(copilotExt);
      if (hasCopilotPending) {
        this.lastSuggestionSource = 'copilot';
        this.lastCopilotActivity = Date.now();
      } else {
        // Fall through to last-active heuristic
        if (this.lastCopilotActivity >= this.lastGeminiActivity) {
          this.lastSuggestionSource = 'copilot';
        } else {
          this.lastSuggestionSource = 'gemini';
        }
      }
    }
  }

  private checkCopilotPending(
    copilotExt: vscode.Extension<unknown> | undefined
  ): boolean {
    if (!copilotExt?.isActive) return false;
    try {
      // Copilot exports an object; presence of getCompletionItems indicates
      // it is in an active request cycle
      const exports = copilotExt.exports as Record<string, unknown>;
      return typeof exports?.['getCompletionItems'] === 'function';
    } catch {
      return false;
    }
  }

  /**
   * Called right before we intercept Tab to accept a suggestion.
   * Returns the best guess at which AI provided the visible suggestion.
   */
  public resolveCurrentSource(): SuggestionSource {
    // Re-read extension state synchronously at intercept time
    const copilotExt = vscode.extensions.getExtension(COPILOT_EXTENSION_ID);
    const geminiExt = vscode.extensions.getExtension(GEMINI_EXTENSION_ID);

    const copilotActive = copilotExt?.isActive ?? false;
    const geminiActive = geminiExt?.isActive ?? false;

    if (copilotActive && !geminiActive) {
      return 'copilot';
    }
    if (geminiActive && !copilotActive) {
      return 'gemini';
    }
    if (copilotActive && geminiActive) {
      // Both active: use activity recency
      const hasCopilotPending = this.checkCopilotPending(copilotExt);
      if (hasCopilotPending) return 'copilot';
      return this.lastSuggestionSource !== 'unknown'
        ? this.lastSuggestionSource
        : 'copilot'; // default to copilot if ambiguous
    }

    return 'unknown';
  }

  /**
   * Explicitly record that a particular source showed a suggestion.
   * Called when we have stronger evidence (e.g., from suggestion accept flow).
   */
  public recordSourceActivity(source: SuggestionSource): void {
    this.lastSuggestionSource = source;
    if (source === 'copilot') this.lastCopilotActivity = Date.now();
    if (source === 'gemini') this.lastGeminiActivity = Date.now();
  }

  public checkAndWarnMissingExtensions(): void {
    if (this.hasWarnedAboutMissingExtensions) return;
    if (!this.copilotAvailable && !this.geminiAvailable) {
      this.hasWarnedAboutMissingExtensions = true;
      void vscode.window.showInformationMessage(
        'AI LoC Tracker: Install GitHub Copilot or Gemini Code Assist to start tracking AI contributions.'
      );
    }
  }

  public isCopilotAvailable(): boolean {
    return this.copilotAvailable;
  }

  public isGeminiAvailable(): boolean {
    return this.geminiAvailable;
  }

  public isAnyAIAvailable(): boolean {
    return this.copilotAvailable || this.geminiAvailable;
  }

  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
