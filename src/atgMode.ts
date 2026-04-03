import * as vscode from "vscode";
import { vectorMessage } from "./messagePane";
import { getFunctionDataForLine } from "./editorDecorator";
import { getGlobalCoverageData } from "./vcastTestInterface";
import { loadATGLineTest } from "./vcastUtilities";
import { getVcastInterfaceCommandForVariableInfo } from "./vcastUtilities";
import { getJsonDataFromTestInterface } from "./vcastCommandRunner";
import {
  clicastCommandToUse,
  globalTestInterfacePath,
  vPythonCommandToUse,
} from "./vcastInstallation";

const path = require("path");

// ─── Types ───────────────────────────────────────────────────────────

interface VariableInfo {
  displayType: string;
  kind: string;
  enumValues: string[];
  children: Map<string, VariableInfo>;
}

interface ArrayEntry {
  index: string;
  value: string;
}

interface SelectedVariable {
  displayType: string;
  kind: string;
  enumValues: string[];
  value: string;
  entries: ArrayEntry[];
}

// ─── Variable Lookup ─────────────────────────────────────────────────

function buildLookupFromNodes(
  nodes: any[],
  target: Map<string, VariableInfo>
) {
  if (!nodes) return;
  for (const node of nodes) {
    const entry: VariableInfo = {
      displayType: node.displayType || "",
      kind: node.kind || "unknown",
      enumValues: node.enumValues || [],
      children: new Map(),
    };
    if (node.children && node.children.length > 0) {
      buildLookupFromNodes(node.children, entry.children);
    }
    target.set(node.name, entry);
  }
}

function lookupPath(
  variableLookup: Map<string, VariableInfo>,
  pathStr: string
): VariableInfo | null {
  const parts = pathStr.split(".");
  let current = variableLookup;
  let info: VariableInfo | null = null;
  for (const part of parts) {
    const entry = current.get(part);
    if (!entry) return null;
    info = entry;
    current = entry.children;
  }
  return info;
}

// ─── ATG Mode Manager ────────────────────────────────────────────────

export class ATGModeManager {
  isActive = false;
  filePath = "";
  targetLine = 0;
  truthValue: "True" | "False" | "" = "";
  targetIsDecision = false;
  funcStartLine = 0;
  funcEndLine = 0;
  selectedVars = new Map<string, SelectedVariable>();
  variableLookup = new Map<string, VariableInfo>();

  private disposables: vscode.Disposable[] = [];
  private statusBarItem: vscode.StatusBarItem | null = null;
  private sidebarView: ATGSidebarViewProvider | null = null;

  // Decoration types
  private targetLineDeco: vscode.TextEditorDecorationType | null = null;
  private clickableDeco: vscode.TextEditorDecorationType | null = null;
  private selectedDeco: vscode.TextEditorDecorationType | null = null;
  private crossHighlightDeco: vscode.TextEditorDecorationType | null = null;

  // Cached decoration ranges for click detection
  private clickableRanges: { range: vscode.Range; path: string }[] = [];

  setSidebarView(view: ATGSidebarViewProvider) {
    this.sidebarView = view;
  }

  async enter(
    editor: vscode.TextEditor,
    lineNumber: number,
    _context: vscode.ExtensionContext
  ) {
    if (this.isActive) this.exit();

    this.isActive = true;
    this.filePath = editor.document.uri.fsPath;
    this.targetLine = lineNumber;
    this.truthValue = "";
    this.targetIsDecision = this.checkIsDecisionLine(lineNumber);
    this.selectedVars.clear();
    this.variableLookup.clear();
    this.clickableRanges = [];

    vscode.commands.executeCommand(
      "setContext",
      "vectorcastTestExplorer.atgModeActive",
      true
    );

    // Find function data and boundaries
    const funcData = getFunctionDataForLine(this.filePath, lineNumber);
    this.findFunctionBounds(editor, funcData?.functionName);

    // Fetch variable data from DataAPI
    if (funcData) {
      try {
        const command = getVcastInterfaceCommandForVariableInfo(
          funcData.enviroPath,
          this.filePath,
          funcData.functionName
        );
        const jsonData = getJsonDataFromTestInterface(
          command,
          funcData.enviroPath
        );
        if (jsonData) {
          buildLookupFromNodes(jsonData.parameters, this.variableLookup);
          buildLookupFromNodes(jsonData.globals, this.variableLookup);
        }
      } catch {
        vectorMessage("ATG Mode: Could not fetch variable info");
      }
    }

    // Create decoration types
    this.targetLineDeco = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: "rgba(0, 122, 204, 0.10)",
      borderWidth: "0 0 0 3px",
      borderStyle: "solid",
      borderColor: "#007acc",
      gutterIconPath: _context.asAbsolutePath("./images/dark/beaker-plus.svg"),
      gutterIconSize: "contain",
    });

    this.clickableDeco = vscode.window.createTextEditorDecorationType({
      textDecoration: "underline dashed rgba(156, 220, 254, 0.4)",
      cursor: "pointer",
    });

    this.selectedDeco = vscode.window.createTextEditorDecorationType({
      backgroundColor: "rgba(78, 201, 176, 0.18)",
      textDecoration: "underline solid #4ec9b0",
      borderRadius: "2px",
    });

    this.crossHighlightDeco = vscode.window.createTextEditorDecorationType({
      backgroundColor: "rgba(78, 201, 176, 0.30)",
      borderRadius: "2px",
    });

    // Build decorations
    this.rebuildDecorations(editor);

    // Status bar
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.updateStatusBar();
    this.statusBarItem.show();
    this.disposables.push(this.statusBarItem);

    // Mouse click detection on decorated ranges
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (
          !this.isActive ||
          e.textEditor.document.uri.fsPath !== this.filePath ||
          e.kind !== vscode.TextEditorSelectionChangeKind.Mouse
        )
          return;

        const pos = e.selections[0]?.active;
        if (!pos) return;

        // Check if click is on a clickable variable range
        for (const item of this.clickableRanges) {
          if (item.range.contains(pos)) {
            // Don't toggle if it's in the selected set and user might be
            // trying to place cursor. Use a small delay to avoid double-triggers.
            const clickedLine = item.range.start.line;
            setTimeout(() => {
              if (!this.isActive) return;
              this.toggleVariable(item.path, clickedLine);
            }, 50);
            return;
          }
        }

        // Check if click is at column 0 (gutter click to move target)
        // Gutter clicks select the whole line, placing cursor at start of NEXT line
        if (pos.character === 0) {
          const newLine = pos.line; // 0-based, but actually the line after the clicked one
          if (
            newLine >= this.funcStartLine &&
            newLine <= this.funcEndLine &&
            newLine !== this.targetLine
          ) {
            this.setTargetLine(newLine);
          }
        }
      })
    );

    // Active editor changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((e) => {
        if (e && this.isActive && e.document.uri.fsPath === this.filePath) {
          this.rebuildDecorations(e);
        }
      })
    );

    // Reveal sidebar
    if (this.sidebarView) {
      this.sidebarView.notifyListChanged();
      vscode.commands.executeCommand(
        "vectorcastTestExplorer.atgSelectedVars.focus"
      );
    }

    // Fetch clangd locals asynchronously
    this.fetchLocalsAsync(funcData?.enviroPath);

    vectorMessage(
      `ATG Mode: Active on line ${lineNumber} of ${path.basename(this.filePath)}`
    );
  }

  exit() {
    this.isActive = false;

    vscode.commands.executeCommand(
      "setContext",
      "vectorcastTestExplorer.atgModeActive",
      false
    );

    // Clear decorations
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      if (this.targetLineDeco) editor.setDecorations(this.targetLineDeco, []);
      if (this.clickableDeco) editor.setDecorations(this.clickableDeco, []);
      if (this.selectedDeco) editor.setDecorations(this.selectedDeco, []);
      if (this.crossHighlightDeco)
        editor.setDecorations(this.crossHighlightDeco, []);
    }
    this.targetLineDeco?.dispose();
    this.clickableDeco?.dispose();
    this.selectedDeco?.dispose();
    this.crossHighlightDeco?.dispose();
    this.targetLineDeco = null;
    this.clickableDeco = null;
    this.selectedDeco = null;
    this.crossHighlightDeco = null;

    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.statusBarItem = null;
    this.clickableRanges = [];

    this.selectedVars.clear();
    this.variableLookup.clear();

    if (this.sidebarView) {
      this.sidebarView.notifyListChanged();
      // Collapse the sidebar panel by focusing the editor
      vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
    }

    vectorMessage("ATG Mode: Exited");
  }

  toggleVariable(fullPath: string, clickedLine?: number) {
    if (this.selectedVars.has(fullPath)) {
      this.selectedVars.delete(fullPath);
    } else {
      const info = lookupPath(this.variableLookup, fullPath);
      if (info && info.kind === "struct") return; // by-value struct, not assignable

      // Detect array: trust kind from lookup, but also check if the
      // variable is subscripted on the clicked line (handles cases where
      // type info is missing or not yet loaded)
      const defaultIndex = this.getDefaultIndexFromLine(fullPath, clickedLine);
      const isArray = info?.kind === "array" || defaultIndex !== "";
      const defaultEntries: ArrayEntry[] = [];

      if (isArray) {
        defaultEntries.push({ index: defaultIndex, value: "" });
      }

      this.selectedVars.set(fullPath, {
        displayType: info?.displayType || "",
        kind: isArray ? "array" : info?.kind || "unknown",
        enumValues: info?.enumValues || [],
        value: "",
        entries: defaultEntries,
      });
    }

    this.refreshAfterChange();
  }

  setVariableValue(fullPath: string, value: string) {
    const v = this.selectedVars.get(fullPath);
    if (v) {
      v.value = value;
      this.updateStatusBar();
    }
  }

  removeVariable(fullPath: string) {
    this.selectedVars.delete(fullPath);
    this.refreshAfterChange();
  }

  addArrayEntry(fullPath: string) {
    const v = this.selectedVars.get(fullPath);
    if (v) {
      v.entries.push({ index: "", value: "" });
      this.updateStatusBar();
      if (this.sidebarView) this.sidebarView.notifyListChanged();
    }
  }

  removeArrayEntry(fullPath: string, entryIndex: number) {
    const v = this.selectedVars.get(fullPath);
    if (v && entryIndex >= 0 && entryIndex < v.entries.length) {
      v.entries.splice(entryIndex, 1);
      this.updateStatusBar();
      if (this.sidebarView) this.sidebarView.notifyListChanged();
    }
  }

  updateArrayEntry(
    fullPath: string,
    entryIndex: number,
    field: "index" | "value",
    fieldValue: string
  ) {
    const v = this.selectedVars.get(fullPath);
    if (v && entryIndex >= 0 && entryIndex < v.entries.length) {
      v.entries[entryIndex][field] = fieldValue;
      this.updateStatusBar();
    }
  }

  setTargetLine(line: number) {
    this.targetLine = line;
    this.targetIsDecision = this.checkIsDecisionLine(line);
    this.truthValue = "";
    this.updateStatusBar();
    const editor = vscode.window.activeTextEditor;
    if (editor) this.rebuildDecorations(editor);
    if (this.sidebarView) this.sidebarView.notifyListChanged();
    vectorMessage(`ATG Mode: Target line → ${line}`);
  }

  setTruthValue(value: "True" | "False" | "") {
    this.truthValue = value;
    this.updateStatusBar();
    if (this.sidebarView) this.sidebarView.notifyListChanged();
    vectorMessage(`ATG Mode: Truth value → ${value || "auto"}`);
  }

  async fetchTest() {
    if (!this.isActive) return;

    const enviroPath = this.getEnviroPath();
    if (!enviroPath) {
      vscode.window.showWarningMessage("No environment found");
      return;
    }

    const variableValues: { name: string; value: string }[] = [];
    for (const [name, info] of this.selectedVars) {
      if (info.kind === "array" && info.entries.length > 0) {
        for (const entry of info.entries) {
          if (entry.index.trim() && entry.value.trim()) {
            variableValues.push({
              name: `${name}[${entry.index.trim()}]`,
              value: entry.value.trim(),
            });
          }
        }
      } else if (info.value.trim()) {
        variableValues.push({ name, value: info.value.trim() });
      }
    }

    const filePath = this.filePath;
    const targetLine = this.targetLine;
    const truthValue = this.targetIsDecision ? this.truthValue : "";

    this.exit();

    await loadATGLineTest(
      filePath,
      targetLine,
      enviroPath,
      variableValues,
      truthValue
    );
  }

  // Called by sidebar for cross-highlighting
  highlightVariableInEditor(fullPath: string | null) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.crossHighlightDeco) return;

    if (!fullPath) {
      editor.setDecorations(this.crossHighlightDeco, []);
      return;
    }

    // Find all ranges matching this path
    const ranges = this.clickableRanges
      .filter((r) => r.path === fullPath)
      .map((r) => r.range);
    editor.setDecorations(this.crossHighlightDeco, ranges);
  }

  getSelectedVarsForSidebar(): {
    path: string;
    displayType: string;
    kind: string;
    enumValues: string[];
    value: string;
    entries: ArrayEntry[];
  }[] {
    const result: any[] = [];
    for (const [p, info] of this.selectedVars) {
      result.push({
        path: p,
        displayType: info.displayType,
        kind: info.kind,
        enumValues: info.enumValues,
        value: info.value,
        entries: info.entries,
      });
    }
    return result;
  }

  // ─── Private ─────────────────────────────────────────────────────

  private checkIsDecisionLine(line: number): boolean {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return false;
    const text = editor.document.lineAt(line - 1).text.trimStart();
    return /^(if|else\s+if|while|for|switch)\s*\(/.test(text) ||
      /}\s*while\s*\(/.test(text) ||
      /\?\s*.*\s*:/.test(text);
  }

  private getDefaultIndexFromLine(
    fullPath: string,
    lineIdx?: number
  ): string {
    if (lineIdx === undefined) return "";
    const editor = vscode.window.activeTextEditor;
    if (!editor) return "";
    const lineText = editor.document.lineAt(lineIdx).text;
    const escaped = fullPath.replace(/\./g, "\\.");
    const regex = new RegExp(`${escaped}\\s*\\[\\s*([^\\]]+)\\s*\\]`);
    const m = regex.exec(lineText);
    return m ? m[1].trim() : "";
  }

  private refreshAfterChange() {
    const editor = vscode.window.activeTextEditor;
    if (editor) this.rebuildDecorations(editor);
    this.updateStatusBar();
    if (this.sidebarView) this.sidebarView.notifyListChanged();
  }

  private rebuildDecorations(editor: vscode.TextEditor) {
    if (!this.isActive) return;

    const doc = editor.document;
    const text = doc.getText();
    const lines = text.split(/\r?\n/);

    // Target line
    if (this.targetLineDeco) {
      editor.setDecorations(this.targetLineDeco, [
        new vscode.Range(this.targetLine - 1, 0, this.targetLine - 1, 0),
      ]);
    }

    // Find all identifier positions within the function
    const clickableRanges: vscode.DecorationOptions[] = [];
    const selectedRanges: vscode.DecorationOptions[] = [];
    this.clickableRanges = [];

    const identRegex = /\b([a-zA-Z_]\w*)\b/g;

    for (
      let lineIdx = this.funcStartLine - 1;
      lineIdx < Math.min(this.funcEndLine, lines.length);
      lineIdx++
    ) {
      const line = lines[lineIdx];
      if (!line) continue;

      let match;
      identRegex.lastIndex = 0;
      while ((match = identRegex.exec(line)) !== null) {
        const name = match[1];
        const col = match.index;

        // Resolve full dotted path
        const fullPath = this.resolvePathFromLine(line, col, name);
        const info = lookupPath(this.variableLookup, fullPath);

        // Check if it's after -> or . (field access)
        const before = line.substring(0, col).trimEnd();
        const isFieldAccess =
          before.endsWith("->") || before.endsWith(".");

        // Determine if clickable
        let isClickable = false;
        if (info && info.kind !== "struct") {
          isClickable = true;
        } else if (!info && isFieldAccess) {
          isClickable = true; // unknown field, allow anyway
        }

        // Skip identifiers that are the prefix of a member access
        // (e.g., skip "zzz" in "zzz->f" since "zzz" is a pointer struct)
        if (info && info.kind === "struct") continue;
        // Also skip if the next non-whitespace char is -> or .
        const afterIdent = line.substring(col + name.length).trimStart();
        if (
          afterIdent.startsWith("->") ||
          (afterIdent.startsWith(".") && !afterIdent.startsWith(".."))
        ) {
          // This identifier is followed by member access - it's a struct/pointer
          // being dereferenced. Only skip if it's a by-value struct.
          if (info && info.kind === "struct") continue;
          // If it's a pointer, it IS clickable (you can assign to the pointer)
          // but we still show the hint
        }

        if (!isClickable) continue;

        const range = new vscode.Range(
          lineIdx,
          col,
          lineIdx,
          col + name.length
        );

        const isSelected = this.selectedVars.has(fullPath);
        const dispType = info?.displayType || "unknown";
        const tooltip = new vscode.MarkdownString(
          `**${fullPath}** : \`${dispType}\` — *click to ${isSelected ? "remove" : "add"}*`
        );

        if (isSelected) {
          selectedRanges.push({ range, hoverMessage: tooltip });
        } else {
          clickableRanges.push({ range, hoverMessage: tooltip });
        }

        this.clickableRanges.push({ range, path: fullPath });
      }
    }

    if (this.clickableDeco)
      editor.setDecorations(this.clickableDeco, clickableRanges);
    if (this.selectedDeco)
      editor.setDecorations(this.selectedDeco, selectedRanges);
  }

  private resolvePathFromLine(
    line: string,
    col: number,
    name: string
  ): string {
    const segments = [name];
    let pos = col;

    while (pos > 0) {
      let p = pos - 1;
      while (p >= 0 && /\s/.test(line[p])) p--;

      if (p >= 1 && line[p - 1] === "-" && line[p] === ">") {
        p -= 2;
      } else if (p >= 0 && line[p] === ".") {
        p--;
      } else {
        break;
      }

      while (p >= 0 && /\s/.test(line[p])) p--;

      let identEnd = p + 1;
      while (p >= 0 && /[a-zA-Z0-9_]/.test(line[p])) p--;
      p++;

      if (p < identEnd) {
        segments.unshift(line.substring(p, identEnd));
        pos = p;
      } else {
        break;
      }
    }

    return segments.join(".");
  }

  private findFunctionBounds(
    editor: vscode.TextEditor,
    functionName?: string
  ) {
    const lines = editor.document.getText().split(/\r?\n/);
    this.funcStartLine = 1;
    this.funcEndLine = lines.length;

    if (!functionName) return;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(functionName) && /\(/.test(lines[i])) {
        this.funcStartLine = i + 1;
        let depth = 0;
        for (let j = i; j < lines.length; j++) {
          for (const ch of lines[j]) {
            if (ch === "{") depth++;
            if (ch === "}") {
              depth--;
              if (depth === 0) {
                this.funcEndLine = j + 1;
                break;
              }
            }
          }
          if (depth === 0 && this.funcEndLine > 1) break;
        }
        break;
      }
    }
  }

  private updateStatusBar() {
    if (!this.statusBarItem) return;
    const n = this.selectedVars.size;
    const tv = this.truthValue ? ` [${this.truthValue}]` : "";
    this.statusBarItem.text = `$(beaker) ATG Line ${this.targetLine}${tv} | ${n} var${n !== 1 ? "s" : ""} | $(check) Fetch | $(close) Exit`;
    this.statusBarItem.command = "vectorcastTestExplorer.atgShowMenu";
    this.statusBarItem.tooltip = "ATG Selection Mode — click for options";
  }

  private getEnviroPath(): string | null {
    const coverageData = getGlobalCoverageData();
    const fileData = coverageData.get(this.filePath);
    if (fileData && fileData.enviroList) {
      const paths = Array.from(fileData.enviroList.keys());
      return paths[0] || null;
    }
    return null;
  }

  private fetchLocalsAsync(enviroPath?: string) {
    if (!enviroPath) return;

    const commandToRun = `${vPythonCommandToUse} ${globalTestInterfacePath}  --mode=getLocalVariables --clicast=${clicastCommandToUse} --path=${enviroPath} --options="${JSON.stringify({ sourceFile: this.filePath, targetLine: this.targetLine }).replaceAll('"', '\\"')}"`;
    const { exec } = require("child_process");
    exec(
      commandToRun,
      { cwd: path.dirname(enviroPath) },
      (error: any, stdout: string) => {
        if (error || !this.isActive) return;
        try {
          const cleanOutput = stdout
            .substring(stdout.indexOf("ACTUAL-DATA") + "ACTUAL-DATA".length)
            .trim();
          const data = JSON.parse(cleanOutput);
          if (data.locals && data.locals.length > 0) {
            buildLookupFromNodes(data.locals, this.variableLookup);
            const editor = vscode.window.activeTextEditor;
            if (editor) this.rebuildDecorations(editor);
          }
        } catch {
          // Silently ignore
        }
      }
    );
  }
}

// ─── Sidebar WebviewView Provider ────────────────────────────────────

export class ATGSidebarViewProvider implements vscode.WebviewViewProvider {
  private webviewView: vscode.WebviewView | null = null;

  constructor(
    private manager: ATGModeManager,
    _extensionUri: vscode.Uri
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this.webviewView = webviewView;
    webviewView.webview.options = { enableScripts: true };

    webviewView.webview.onDidReceiveMessage((message) => {
      vectorMessage(`ATG Sidebar: received message '${message.command}'`);
      switch (message.command) {
        case "removeVariable":
          this.manager.removeVariable(message.path);
          break;
        case "updateValue":
          this.manager.setVariableValue(message.path, message.value);
          break;
        case "fetchTest":
          this.manager.fetchTest();
          break;
        case "cancel":
          this.manager.exit();
          break;
        case "setTruthValue":
          this.manager.setTruthValue(message.value);
          break;
        case "addArrayEntry":
          this.manager.addArrayEntry(message.path);
          break;
        case "removeArrayEntry":
          this.manager.removeArrayEntry(message.path, message.entryIndex);
          break;
        case "updateArrayEntry":
          this.manager.updateArrayEntry(
            message.path,
            message.entryIndex,
            message.field,
            message.fieldValue
          );
          break;
        case "highlightInEditor":
          this.manager.highlightVariableInEditor(message.path);
          break;
        case "clearHighlight":
          this.manager.highlightVariableInEditor(null);
          break;
      }
    });

    this.renderFull();
  }

  notifyListChanged() {
    if (!this.webviewView) {
      vectorMessage("ATG Sidebar: webviewView not resolved yet");
      return;
    }

    if (!this.manager.isActive) {
      // Send a clear message first, then rebuild
      this.webviewView.webview.postMessage({
        command: "updateVars",
        vars: [],
        targetLine: 0,
        fileName: "",
        isActive: false,
      });
      this.renderFull();
      return;
    }

    const vars = this.manager.getSelectedVarsForSidebar();
    this.webviewView.webview.postMessage({
      command: "updateVars",
      vars,
      targetLine: this.manager.targetLine,
      truthValue: this.manager.truthValue,
      isDecision: this.manager.targetIsDecision,
      fileName: this.manager.filePath
        ? path.basename(this.manager.filePath)
        : "",
      isActive: true,
    });
  }

  private renderFull() {
    if (!this.webviewView) return;
    this.webviewView.webview.html = this.getHtml();
  }

  private getHtml(): string {
    const isActive = this.manager.isActive;

    return `<!DOCTYPE html>
<html>
<head>
<style>
  body { background: #1e1e1e; color: #d4d4d4; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 8px; margin: 0; font-size: 13px; }
  .header { color: #9cdcfe; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .info { color: #888; font-size: 11px; margin-bottom: 12px; }
  .inactive { color: #666; font-style: italic; padding: 16px 0; }
  .inactive p { margin-bottom: 8px; font-size: 12px; }

  #varList { min-height: 20px; }
  .sv-item { display: flex; align-items: center; gap: 6px; padding: 5px 4px; min-height: 30px; border-radius: 3px; }
  .sv-item:hover { background: rgba(78, 201, 176, 0.08); }
  .sv-name { color: #9cdcfe; font-family: "Courier New", monospace; font-size: 12px; font-weight: 500; min-width: 50px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .badge { font-size: 10px; padding: 1px 5px; border-radius: 3px; flex-shrink: 0; white-space: nowrap; }
  .badge.int { background: #1a3a5c; color: #6cb6ff; }
  .badge.float { background: #3a2a1a; color: #e6a855; }
  .badge.enum { background: #1a3a2a; color: #6bc96b; }
  .badge.bool { background: #1a3a3a; color: #6bcbcb; }
  .badge.array { background: #1a2a3a; color: #7aafdf; }
  .badge.unknown { background: #2a2a2a; color: #888; }
  input, select { flex: 1; min-width: 50px; background: #3c3c3c; color: #d4d4d4; border: 1px solid #555; border-radius: 3px; padding: 3px 6px; font-size: 12px; }
  input:focus, select:focus { border-color: #007acc; outline: none; }
  .rm { background: transparent; color: #666; border: none; cursor: pointer; font-size: 14px; padding: 2px 6px; border-radius: 3px; flex-shrink: 0; }
  .rm:hover { color: #cc4444; background: rgba(204,68,68,0.15); }
  .actions { display: flex; gap: 8px; margin-top: 12px; }
  .btn { border: none; border-radius: 4px; cursor: pointer; font-size: 13px; padding: 7px 14px; }
  .btn-fetch { background: #007acc; color: white; }
  .btn-fetch:hover { background: #005f99; }
  .btn-cancel { background: #3c3c3c; color: #d4d4d4; }
  .btn-cancel:hover { background: #4c4c4c; }
  .empty { color: #666; font-size: 12px; font-style: italic; padding: 8px 0; }
  .truth-row { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
  .truth-label { color: #888; font-size: 11px; white-space: nowrap; }
  .truth-btn { background: #2d2d2d; color: #999; border: 1px solid #444; border-radius: 3px; cursor: pointer; font-size: 11px; padding: 2px 8px; }
  .truth-btn:hover { background: #3c3c3c; }
  .truth-btn.active { background: #264f78; color: #fff; border-color: #007acc; }
  .arr-entries { margin: 2px 0 4px 16px; }
  .arr-entry { display: flex; align-items: center; gap: 4px; margin-bottom: 3px; }
  .arr-entry input { min-width: 30px; }
  .arr-entry .idx-input { max-width: 45px; flex: 0 0 45px; text-align: center; }
  .arr-entry .val-input { flex: 1; }
  .arr-entry .idx-label { color: #888; font-size: 11px; flex-shrink: 0; }
  .add-entry { background: transparent; color: #007acc; border: 1px dashed #007acc; border-radius: 3px; cursor: pointer; font-size: 11px; padding: 2px 8px; margin-top: 2px; }
  .add-entry:hover { background: rgba(0, 122, 204, 0.1); }
</style>
</head>
<body>
  <div id="activeView" style="display:${isActive ? "block" : "none"}">
    <div class="header" id="headerText">ATG Target</div>
    <div class="truth-row" id="truthRow" style="display:none">
      <span class="truth-label">Decision:</span>
      <button class="truth-btn active" id="tvAuto" onclick="setTruth('')">Auto</button>
      <button class="truth-btn" id="tvTrue" onclick="setTruth('True')">True</button>
      <button class="truth-btn" id="tvFalse" onclick="setTruth('False')">False</button>
    </div>
    <div class="info">Click underlined variables in the editor to select them</div>
    <div id="varList"></div>
    <div class="actions">
      <button class="btn btn-fetch" onclick="vsc.postMessage({command:'fetchTest'})">Fetch Test</button>
      <button class="btn btn-cancel" onclick="vsc.postMessage({command:'cancel'})">Cancel</button>
    </div>
  </div>
  <div id="inactiveView" style="display:${isActive ? "none" : "block"}">
    <div class="inactive">
      <p>ATG mode is not active.</p>
      <p>Right-click a line number in the editor and select "ATG Test for Line" to begin.</p>
    </div>
  </div>
<script>
  const vsc = acquireVsCodeApi();

  function renderVarList(vars) {
    const el = document.getElementById('varList');
    if (!vars || vars.length === 0) {
      el.innerHTML = '<div class="empty">No variables selected yet.</div>';
      return;
    }
    el.innerHTML = '';
    vars.forEach(v => {
      const row = document.createElement('div');
      row.className = 'sv-item';
      row.onmouseenter = () => vsc.postMessage({command:'highlightInEditor', path: v.path});
      row.onmouseleave = () => vsc.postMessage({command:'clearHighlight'});

      const name = document.createElement('span');
      name.className = 'sv-name';
      name.textContent = v.path;
      name.title = v.path;
      row.appendChild(name);

      const badge = document.createElement('span');
      badge.className = 'badge ' + (v.kind || 'unknown');
      badge.textContent = v.displayType || v.kind || '?';
      row.appendChild(badge);

      if (v.kind === 'array' && v.entries) {
        // Array: no inline input, just the remove button on the header row
        const rm = document.createElement('button');
        rm.className = 'rm';
        rm.textContent = '\\u00d7';
        rm.title = 'Remove ' + v.path;
        rm.onclick = () => vsc.postMessage({command:'removeVariable', path: v.path});
        row.appendChild(rm);
        el.appendChild(row);

        // Render index/value entry rows below
        const entriesDiv = document.createElement('div');
        entriesDiv.className = 'arr-entries';
        v.entries.forEach((entry, ei) => {
          const entryRow = document.createElement('div');
          entryRow.className = 'arr-entry';

          const lbl = document.createElement('span');
          lbl.className = 'idx-label';
          lbl.textContent = v.path + '[';
          entryRow.appendChild(lbl);

          const idxInp = document.createElement('input');
          idxInp.className = 'idx-input';
          idxInp.type = 'text';
          idxInp.value = entry.index || '';
          idxInp.placeholder = 'idx';
          idxInp.oninput = () => vsc.postMessage({command:'updateArrayEntry', path: v.path, entryIndex: ei, field: 'index', fieldValue: idxInp.value});
          entryRow.appendChild(idxInp);

          const lbl2 = document.createElement('span');
          lbl2.className = 'idx-label';
          lbl2.textContent = '] =';
          entryRow.appendChild(lbl2);

          const valInp = document.createElement('input');
          valInp.className = 'val-input';
          valInp.type = 'text';
          valInp.value = entry.value || '';
          valInp.placeholder = 'value';
          valInp.oninput = () => vsc.postMessage({command:'updateArrayEntry', path: v.path, entryIndex: ei, field: 'value', fieldValue: valInp.value});
          entryRow.appendChild(valInp);

          const erm = document.createElement('button');
          erm.className = 'rm';
          erm.textContent = '\\u00d7';
          erm.title = 'Remove entry';
          erm.onclick = () => vsc.postMessage({command:'removeArrayEntry', path: v.path, entryIndex: ei});
          entryRow.appendChild(erm);

          entriesDiv.appendChild(entryRow);
        });

        const addBtn = document.createElement('button');
        addBtn.className = 'add-entry';
        addBtn.textContent = '+ index';
        addBtn.onclick = () => vsc.postMessage({command:'addArrayEntry', path: v.path});
        entriesDiv.appendChild(addBtn);

        el.appendChild(entriesDiv);
      } else {
        if (v.kind === 'enum' && v.enumValues && v.enumValues.length > 0) {
          const sel = document.createElement('select');
          sel.innerHTML = '<option value="">--</option>' +
            v.enumValues.map(e => '<option value="'+e+'"'+(v.value===e?' selected':'')+'>'+e+'</option>').join('');
          sel.onchange = () => vsc.postMessage({command:'updateValue', path: v.path, value: sel.value});
          row.appendChild(sel);
        } else if (v.kind === 'bool') {
          const sel = document.createElement('select');
          sel.innerHTML = '<option value="">--</option><option value="true"'+(v.value==='true'?' selected':'')+'>true</option><option value="false"'+(v.value==='false'?' selected':'')+'>false</option>';
          sel.onchange = () => vsc.postMessage({command:'updateValue', path: v.path, value: sel.value});
          row.appendChild(sel);
        } else {
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.value = v.value || '';
          inp.placeholder = v.displayType || 'value';
          inp.oninput = () => vsc.postMessage({command:'updateValue', path: v.path, value: inp.value});
          row.appendChild(inp);
        }

        const rm = document.createElement('button');
        rm.className = 'rm';
        rm.textContent = '\\u00d7';
        rm.title = 'Remove ' + v.path;
        rm.onclick = () => vsc.postMessage({command:'removeVariable', path: v.path});
        row.appendChild(rm);

        el.appendChild(row);
      }
    });
  }

  function setTruth(val) {
    vsc.postMessage({command:'setTruthValue', value: val});
  }

  function updateTruthButtons(val) {
    document.getElementById('tvAuto').className = 'truth-btn' + (val === '' ? ' active' : '');
    document.getElementById('tvTrue').className = 'truth-btn' + (val === 'True' ? ' active' : '');
    document.getElementById('tvFalse').className = 'truth-btn' + (val === 'False' ? ' active' : '');
  }

  window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.command === 'updateVars') {
      document.getElementById('activeView').style.display = msg.isActive ? 'block' : 'none';
      document.getElementById('inactiveView').style.display = msg.isActive ? 'none' : 'block';
      document.getElementById('headerText').textContent = 'ATG Target: ' + (msg.fileName || '') + ':' + (msg.targetLine || '');
      document.getElementById('truthRow').style.display = msg.isDecision ? 'flex' : 'none';
      updateTruthButtons(msg.truthValue || '');
      renderVarList(msg.vars);
    }
  });

  // Initial render
  renderVarList([]);
</script>
</body>
</html>`;
  }
}
