import * as vscode from "vscode";
import {
  CheckedFunction,
  commentLineOf,
  findingMarkdown,
  kindLabel,
  lineAfterEdits,
  openFindings,
  sameIgnoringCase,
  SourceLine,
} from "./codeCheckData";
import { CodeCheckStore } from "./codeCheckStore";
import { AI_DISCLAIMER } from "./reportPage";

// A comment of ours: one finding.
export interface FindingComment extends vscode.Comment {
  enviroPath: string;
  findingId: string;
}

// The function a thread of ours is about.
export interface ThreadSubject {
  enviroPath: string;
  unit: string;
  function: string;
}

const rangeOf = ({ line }: SourceLine) =>
  new vscode.Range(line - 1, 0, line - 1, 0);

/**
 * The findings in the code: per function with findings a comment thread, one
 * comment per finding, and a mark on the lines the findings are about. A
 * thread starts folded, so a check of many functions does not flood the
 * editor; `reveal` unfolds one.
 */
export class CodeCheckComments {
  // The menus in package.json go by this ID.
  private readonly controller = vscode.comments.createCommentController(
    "vectorcastCodeCheck",
    "Code against requirements"
  );
  private readonly lineMark = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: "rgba(255, 196, 0, 0.12)",
    overviewRulerColor: new vscode.ThemeColor("editorWarning.foreground"),
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  });
  private readonly threads = new Map<
    string,
    { thread: vscode.CommentThread; subject: ThreadSubject }
  >();

  constructor(
    context: vscode.ExtensionContext,
    private readonly store: CodeCheckStore
  ) {
    context.subscriptions.push(
      this.controller,
      this.lineMark,
      store.onDidChange((enviroPath) => this.show(enviroPath)),
      // An editor loses its marks when it is closed.
      vscode.window.onDidChangeVisibleTextEditors(() => this.markLines()),
      vscode.workspace.onDidChangeTextDocument((event) =>
        this.followEdits(event)
      )
    );
    for (const enviroPath of store.environments) this.show(enviroPath);
  }

  /** The function a thread is about, for the commands of its title. */
  subjectOf(thread: vscode.CommentThread): ThreadSubject | undefined {
    return [...this.threads.values()].find((entry) => entry.thread === thread)
      ?.subject;
  }

  /** Opens the function's source at its findings, with their thread unfolded. */
  async reveal(
    enviroPath: string,
    checked: CheckedFunction,
    viewColumn: vscode.ViewColumn
  ): Promise<void> {
    const line = commentLineOf(checked);
    if (!line) return;
    const key = threadKey(enviroPath, checked);
    const folded = this.threads.get(key)?.thread;
    // Where edits moved the findings since the check
    const range = folded?.range ?? rangeOf(line);
    await vscode.window.showTextDocument(vscode.Uri.file(line.file), {
      viewColumn,
      preview: false,
      selection: range,
    });
    // An editor only heeds the state a thread is created with, so the
    // function gets a new, unfolded one.
    folded?.dispose();
    this.threads.delete(key);
    this.show(enviroPath, { key, range });
  }

  // Keeps the threads of an edited file on their lines.
  private followEdits(event: vscode.TextDocumentChangeEvent): void {
    const edits = event.contentChanges.map(({ range, text }) => ({
      startLine: range.start.line,
      endLine: range.end.line,
      endCharacter: range.end.character,
      text,
    }));
    for (const { thread } of this.threads.values()) {
      if (thread.uri.toString() !== event.document.uri.toString()) continue;
      const line = lineAfterEdits(thread.range.start.line, edits);
      if (line !== thread.range.start.line) {
        thread.range = new vscode.Range(line, 0, line, 0);
      }
    }
  }

  // Brings an environment's threads and the line marks in line with the
  // store. A new thread is folded, except the one to show `unfolded`.
  private show(
    enviroPath: string,
    unfolded?: { key: string; range: vscode.Range }
  ): void {
    const check = this.store.get(enviroPath);
    const shown = new Set<string>();
    for (const checked of check?.functions ?? []) {
      const findings = openFindings(checked, check!.dismissed);
      const line = commentLineOf(checked);
      if (findings.length === 0 || !line) continue;

      const key = threadKey(enviroPath, checked);
      shown.add(key);
      const subject = {
        enviroPath,
        unit: checked.unit,
        function: checked.name,
      };
      const isUnfolded = unfolded?.key === key;
      const thread =
        this.threads.get(key)?.thread ??
        this.createThread(
          key,
          subject,
          vscode.Uri.file(line.file),
          isUnfolded ? unfolded.range : rangeOf(line),
          isUnfolded
        );
      // An out-of-date function's thread is where the edits moved it.
      if (!checked.stale) thread.range = rangeOf(line);
      thread.label = `${checked.name}${checked.stale ? " (out of date)" : ""} · ${AI_DISCLAIMER}`;
      thread.comments = findings.map(
        (finding): FindingComment => ({
          enviroPath,
          findingId: finding.id,
          author: { name: kindLabel(finding.kind) },
          label: finding.requirementKey,
          body: new vscode.MarkdownString(findingMarkdown(finding, checked)),
          mode: vscode.CommentMode.Preview,
        })
      );
    }
    for (const [key, { thread, subject }] of this.threads) {
      if (subject.enviroPath === enviroPath && !shown.has(key)) {
        thread.dispose();
        this.threads.delete(key);
      }
    }
    this.markLines();
  }

  private createThread(
    key: string,
    subject: ThreadSubject,
    file: vscode.Uri,
    range: vscode.Range,
    isUnfolded: boolean
  ): vscode.CommentThread {
    const thread = this.controller.createCommentThread(file, range, []);
    thread.canReply = false;
    thread.collapsibleState = isUnfolded
      ? vscode.CommentThreadCollapsibleState.Expanded
      : vscode.CommentThreadCollapsibleState.Collapsed;
    this.threads.set(key, { thread, subject });
    return thread;
  }

  // Marks the lines the open findings are about in the visible editors; not
  // those of an out-of-date function, whose lines may have moved.
  private markLines(): void {
    const lines = this.store.environments.flatMap((enviroPath) => {
      const check = this.store.get(enviroPath)!;
      return check.functions
        .filter(
          (checked) =>
            !checked.stale && openFindings(checked, check.dismissed).length > 0
        )
        .flatMap((checked) => checked.findingLines);
    });
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(
        this.lineMark,
        lines
          .filter(({ file }) =>
            sameIgnoringCase(file, editor.document.uri.fsPath)
          )
          .map(rangeOf)
      );
    }
  }
}

function threadKey(enviroPath: string, checked: CheckedFunction): string {
  return [enviroPath, checked.unit, checked.name].join("|");
}
