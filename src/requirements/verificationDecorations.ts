import * as vscode from "vscode";

import type { VerificationFinding } from "./requirementsChecking";

// Decorations, not Diagnostics — verification findings are an LLM
// snapshot, not ambient truth. Decorations shift with edits and clear
// when the caller drops them; they never claim to be live.

let decorationType: vscode.TextEditorDecorationType | undefined;

const pendingByFile = new Map<
  string,
  Array<{ range: vscode.Range; hover: vscode.MarkdownString }>
>();

export function activateVerificationDecorations(
  context: vscode.ExtensionContext
): void {
  if (decorationType) return;

  decorationType = vscode.window.createTextEditorDecorationType({
    overviewRulerColor: new vscode.ThemeColor("editorWarning.foreground"),
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    light: {
      backgroundColor: "rgba(255, 196, 0, 0.10)",
      borderColor: "rgba(255, 196, 0, 0.45)",
    },
    dark: {
      backgroundColor: "rgba(255, 196, 0, 0.10)",
      borderColor: "rgba(255, 196, 0, 0.45)",
    },
    borderWidth: "0 0 0 2px",
    borderStyle: "solid",
    isWholeLine: true,
  });
  context.subscriptions.push(decorationType);

  // VS Code drops per-editor decorations when the TextEditor is disposed
  // (tab close-and-reopen). Re-stage from the pending map.
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      if (!decorationType) return;
      for (const editor of editors) {
        const staged = pendingByFile.get(editor.document.uri.fsPath) ?? [];
        editor.setDecorations(
          decorationType,
          staged.map((s) => ({ range: s.range, hoverMessage: s.hover }))
        );
      }
    })
  );
}

export function applyVerificationDecorations(
  findings: VerificationFinding[]
): void {
  if (!decorationType) return;

  const byFile = new Map<
    string,
    Array<{ range: vscode.Range; hover: vscode.MarkdownString }>
  >();

  for (const finding of findings) {
    if (!finding.target) continue;
    const target = finding.target;
    const zeroLine = Math.max(0, target.currentLine - 1);
    const range = new vscode.Range(
      zeroLine,
      0,
      zeroLine,
      Number.MAX_SAFE_INTEGER
    );
    const existing = byFile.get(target.file) ?? [];
    existing.push({ range, hover: buildHover(finding) });
    byFile.set(target.file, existing);
  }

  for (const file of pendingByFile.keys()) {
    if (!byFile.has(file)) setForFile(file, []);
  }

  pendingByFile.clear();
  for (const [file, items] of byFile) {
    pendingByFile.set(file, items);
    setForFile(file, items);
  }
}

function setForFile(
  file: string,
  items: Array<{ range: vscode.Range; hover: vscode.MarkdownString }>
): void {
  if (!decorationType) return;
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document.uri.fsPath !== file) continue;
    editor.setDecorations(
      decorationType,
      items.map((s) => ({ range: s.range, hoverMessage: s.hover }))
    );
  }
}

function buildHover(finding: VerificationFinding): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = false;
  md.supportThemeIcons = true;
  const anchor = finding.anchor ?? "";
  md.appendMarkdown(
    `**reqs2check** · _${finding.kind}_${anchor ? ` · \`${anchor}\`` : ""}\n\n`
  );
  md.appendMarkdown(finding.description);
  md.appendMarkdown(
    `\n\n*${finding.function} (${finding.unit})* — edits to this line invalidate the finding.`
  );
  return md;
}

export function clearAllDecorations(): void {
  if (!decorationType) return;
  for (const editor of vscode.window.visibleTextEditors) {
    editor.setDecorations(decorationType, []);
  }
  pendingByFile.clear();
}
