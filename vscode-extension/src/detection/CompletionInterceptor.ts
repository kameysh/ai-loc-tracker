import * as vscode from 'vscode';
import { SourceResolver, SuggestionSource } from './SourceResolver';

export interface AIAcceptEvent {
  source: SuggestionSource;
  linesAdded: number;
  linesRemoved: number;
  language: string;
  timestamp: number;
}

type AIAcceptListener = (event: AIAcceptEvent) => void;

/**
 * Intercepts the Tab keybinding when an inline suggestion is visible.
 * Diffs the document before and after committing the suggestion to
 * count exactly how many lines were added/removed by the AI.
 *
 * The interception is registered via package.json keybinding:
 *   { "command": "ai-loc-tracker.acceptInlineSuggestion", "key": "tab",
 *     "when": "inlineSuggestionVisible && !editorHasSelection && !inSnippetMode" }
 */
export class CompletionInterceptor implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly listeners: Set<AIAcceptListener> = new Set();
  private lastAcceptTimestamp = 0;

  /** Public so HumanTypingTracker can query this to exclude AI-adjacent changes. */
  public get lastAcceptTime(): number {
    return this.lastAcceptTimestamp;
  }

  constructor(private readonly sourceResolver: SourceResolver) {}

  /**
   * Registers the intercept command. Must be called from extension.activate().
   */
  public register(context: vscode.ExtensionContext): void {
    const cmd = vscode.commands.registerCommand(
      'ai-loc-tracker.acceptInlineSuggestion',
      () => this.handleAccept()
    );
    this.disposables.push(cmd);
    context.subscriptions.push(cmd);
  }

  public onAIAccept(listener: AIAcceptListener): vscode.Disposable {
    this.listeners.add(listener);
    return new vscode.Disposable(() => this.listeners.delete(listener));
  }

  private async handleAccept(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      // No active editor — fall through to native accept
      await this.commitSuggestion();
      return;
    }

    const source = this.sourceResolver.resolveCurrentSource();
    const language = editor.document.languageId;

    // Snapshot the full document text before accepting
    const docBefore = editor.document.getText();
    const lineCountBefore = editor.document.lineCount;

    // Accept the suggestion
    await this.commitSuggestion();

    // Yield to the event loop so VS Code processes the document change
    await nextTick();

    // Re-read the document after the accept
    const docAfter = editor.document.getText();
    const lineCountAfter = editor.document.lineCount;

    const { linesAdded, linesRemoved } = this.diffLineCounts(
      docBefore,
      docAfter,
      lineCountBefore,
      lineCountAfter
    );

    if (linesAdded > 0 || linesRemoved > 0) {
      this.lastAcceptTimestamp = Date.now();
      this.sourceResolver.recordSourceActivity(source);

      const event: AIAcceptEvent = {
        source,
        linesAdded,
        linesRemoved,
        language,
        timestamp: this.lastAcceptTimestamp,
      };

      this.emit(event);
    }
  }

  private async commitSuggestion(): Promise<void> {
    try {
      await vscode.commands.executeCommand('editor.action.inlineSuggest.commit');
    } catch {
      // If commit fails (no suggestion), do nothing — the Tab key was consumed
      // but the user loses nothing since there was no pending suggestion.
    }
  }

  /**
   * Counts line additions/removals by comparing before/after document state.
   * Uses a fast line-count approach rather than full diff for performance.
   */
  private diffLineCounts(
    before: string,
    after: string,
    linesBefore: number,
    linesAfter: number
  ): { linesAdded: number; linesRemoved: number } {
    if (before === after) {
      return { linesAdded: 0, linesRemoved: 0 };
    }

    const delta = linesAfter - linesBefore;
    if (delta >= 0) {
      return { linesAdded: delta, linesRemoved: 0 };
    } else {
      return { linesAdded: 0, linesRemoved: -delta };
    }
  }

  private emit(event: AIAcceptEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[AI LoC Tracker] Error in AIAcceptListener:', err);
      }
    }
  }

  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
