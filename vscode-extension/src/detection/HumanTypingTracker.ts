import * as vscode from 'vscode';
import { CompletionInterceptor } from './CompletionInterceptor';

export interface HumanChangeEvent {
  linesAdded: number;
  linesRemoved: number;
  language: string;
  timestamp: number;
}

type HumanChangeListener = (event: HumanChangeEvent) => void;

/**
 * Tracks human-typed changes by listening to onDidChangeTextDocument.
 * Changes that occur within AI_DEBOUNCE_MS of an AI suggestion accept
 * are excluded, since they belong to the AI accept operation.
 *
 * We count net line changes:
 *   linesAdded   = number of '\n' in inserted text  (new lines from typing)
 *   linesRemoved = lines replaced/deleted by the change range
 */
const AI_DEBOUNCE_MS = 100;

export class HumanTypingTracker implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly listeners: Set<HumanChangeListener> = new Set();

  constructor(private readonly interceptor: CompletionInterceptor) {
    const sub = vscode.workspace.onDidChangeTextDocument((e) =>
      this.handleDocumentChange(e)
    );
    this.disposables.push(sub);
  }

  public onHumanChange(listener: HumanChangeListener): vscode.Disposable {
    this.listeners.add(listener);
    return new vscode.Disposable(() => this.listeners.delete(listener));
  }

  private handleDocumentChange(e: vscode.TextDocumentChangeEvent): void {
    // Ignore non-file documents (output channels, virtual docs, etc.)
    if (e.document.uri.scheme !== 'file') return;
    // Ignore changes with no content modifications
    if (e.contentChanges.length === 0) return;

    const now = Date.now();
    // Exclude changes within the debounce window after an AI accept
    if (now - this.interceptor.lastAcceptTime < AI_DEBOUNCE_MS) return;

    let linesAdded = 0;
    let linesRemoved = 0;

    for (const change of e.contentChanges) {
      // Lines removed: lines spanned by the replaced range
      const rangeLines = change.range.end.line - change.range.start.line;
      linesRemoved += rangeLines;

      // Lines added: newlines in the inserted text
      const insertedNewlines = countNewlines(change.text);
      linesAdded += insertedNewlines;
    }

    // Normalize: only report net-positive contributions
    // (e.g., typing a new line: linesAdded=1, linesRemoved=0)
    if (linesAdded === 0 && linesRemoved === 0) return;

    const event: HumanChangeEvent = {
      linesAdded,
      linesRemoved,
      language: e.document.languageId,
      timestamp: now,
    };

    this.emit(event);
  }

  private emit(event: HumanChangeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[AI LoC Tracker] Error in HumanChangeListener:', err);
      }
    }
  }

  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}

function countNewlines(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') count++;
  }
  return count;
}
