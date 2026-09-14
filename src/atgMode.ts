import * as vscode from "vscode";
import { errorLevel, vectorMessage } from "./messagePane";
import { getFunctionDataForLine } from "./editorDecorator";
import {
  getCoverageDataForFile,
  getGlobalCoverageData,
} from "./vcastTestInterface";
import { loadATGLineTest } from "./vcastUtilities";
import { getVcastInterfaceCommandForVariableInfo } from "./vcastUtilities";
import { getJsonDataFromTestInterface } from "./vcastCommandRunner";
import {
  atgAvailable,
  clicastCommandToUse,
  globalTestInterfacePath,
  vPythonCommandToUse,
} from "./vcastInstallation";
import { getNonce, resolveWebviewBase } from "./webviewUtils";
import {
  ArrayEntry,
  ClickableToken,
  KnownVariable,
  SelectedVariable,
  VariableInfo,
  buildLookupFromNodes,
  buildVariableValues,
  choosePreviewWindow,
  computeClickableTokens,
  decisionExtent,
  findFunctionBounds,
  flattenLookup,
  getDefaultIndexFromLineText,
  isDecisionLineText,
  lookupPath,
} from "./atgLineLogic";

const path = require("path");
const fs = require("fs");

export const ATG_MODE_ACTIVE_CONTEXT = "vectorcastTestExplorer.atgModeActive";

/** Everything the panel webview needs to render. Sent as one message. */
export interface ATGPanelState {
  isActive: boolean;
  fileName: string;
  functionName: string;
  enviroName: string;
  targetLine: number;
  truthValue: "True" | "False" | "";
  isDecision: boolean;
  funcStartLine: number;
  funcEndLine: number;
  /** 1-based line number of lines[0]. */
  previewStart: number;
  lines: string[];
  tokens: ClickableToken[];
  /** Statement/branch lines within the preview. Empty means "no coverage data, allow any line". */
  targetable: number[];
  variables: {
    path: string;
    displayType: string;
    kind: string;
    enumValues: string[];
    value: string;
    entries: ArrayEntry[];
  }[];
  known: KnownVariable[];
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
  functionName = "";
  selectedVars = new Map<string, SelectedVariable>();
  variableLookup = new Map<string, VariableInfo>();

  private document: vscode.TextDocument | null = null;
  private enviroPath: string | undefined;
  private tokens: ClickableToken[] = [];
  private disposables: vscode.Disposable[] = [];
  private statusBarItem: vscode.StatusBarItem | null = null;
  private panelView: ATGLinePanelViewProvider | null = null;
  private docChangeTimer: NodeJS.Timeout | null = null;

  // Decoration types
  private targetLineDeco: vscode.TextEditorDecorationType | null = null;
  private clickableDeco: vscode.TextEditorDecorationType | null = null;
  private selectedDeco: vscode.TextEditorDecorationType | null = null;
  private crossHighlightDeco: vscode.TextEditorDecorationType | null = null;

  setPanelView(view: ATGLinePanelViewProvider) {
    this.panelView = view;
  }

  async enter(
    editor: vscode.TextEditor,
    lineNumber: number,
    context: vscode.ExtensionContext
  ) {
    // Same policy the editor/lineNumber/context menu is gated on: atg must
    // have been found, licensed, and be a supported version. This command is
    // also reachable from the command palette, which has no such gating, so
    // bail out before the user does the work of selecting variables.
    if (!atgAvailable) {
      vscode.window.showWarningMessage(
        "ATG is not available: no licensed, supported 'atg' was found in the VectorCAST installation."
      );
      return;
    }

    if (this.isActive) this.exit();

    this.isActive = true;
    this.document = editor.document;
    this.filePath = editor.document.uri.fsPath;
    this.targetLine = lineNumber;
    this.truthValue = "";
    this.targetIsDecision = this.checkIsDecisionLine(lineNumber);
    this.selectedVars.clear();
    this.variableLookup.clear();
    this.tokens = [];

    // Find function data and boundaries
    const funcData = getFunctionDataForLine(this.filePath, lineNumber);
    this.functionName = funcData?.functionName ?? "";
    this.enviroPath = funcData?.enviroPath ?? this.getEnviroPath() ?? undefined;
    const bounds = findFunctionBounds(this.documentLines(), this.functionName);
    this.funcStartLine = bounds.start;
    this.funcEndLine = bounds.end;

    // Fetch parameter / global data from the DataAPI (synchronous, fast)
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
          buildLookupFromNodes(
            jsonData.parameters,
            this.variableLookup,
            "parameter"
          );
          buildLookupFromNodes(jsonData.globals, this.variableLookup, "global");
        }
      } catch {
        vectorMessage("ATG Mode: Could not fetch variable info");
      }
    }

    // Decoration types (light/dark aware gutter icon)
    this.targetLineDeco = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: "rgba(87, 184, 89, 0.22)",
      borderWidth: "0 0 0 3px",
      borderStyle: "solid",
      borderColor: "#57b859",
      overviewRulerColor: "#57b859",
      overviewRulerLane: vscode.OverviewRulerLane.Full,
      gutterIconSize: "contain",
      light: {
        gutterIconPath: context.asAbsolutePath(
          "./images/light/beaker-plus.svg"
        ),
      },
      dark: {
        gutterIconPath: context.asAbsolutePath("./images/dark/beaker-plus.svg"),
      },
    });

    this.clickableDeco = vscode.window.createTextEditorDecorationType({
      textDecoration: "underline dashed rgba(156, 220, 254, 0.45)",
      cursor: "pointer",
    });

    this.selectedDeco = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor(
        "editor.findMatchHighlightBackground"
      ),
      textDecoration: "underline solid",
      borderRadius: "2px",
    });

    this.crossHighlightDeco = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor(
        "editor.wordHighlightStrongBackground"
      ),
      borderRadius: "2px",
    });

    this.rebuildDecorations();

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
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (
          !this.isActive ||
          event.textEditor.document.uri.fsPath !== this.filePath ||
          event.kind !== vscode.TextEditorSelectionChangeKind.Mouse
        )
          return;

        const clickPosition = event.selections[0]?.active;
        if (!clickPosition) return;

        // Click on a clickable identifier toggles it
        for (const tok of this.tokens) {
          if (
            tok.line - 1 === clickPosition.line &&
            clickPosition.character >= tok.start &&
            clickPosition.character <= tok.end
          ) {
            const clickedLine = tok.line;
            setTimeout(() => {
              if (!this.isActive) return;
              this.toggleVariable(tok.path, clickedLine);
            }, 50);
            return;
          }
        }
      })
    );

    // Re-apply decorations when the file is (re)opened in another editor
    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors(() => {
        if (this.isActive) this.rebuildDecorations();
      })
    );

    // Keep tokens / preview in sync if the user edits the file meanwhile
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (!this.isActive || event.document.uri.fsPath !== this.filePath)
          return;
        if (this.docChangeTimer) clearTimeout(this.docChangeTimer);
        this.docChangeTimer = setTimeout(() => {
          this.docChangeTimer = null;
          if (!this.isActive) return;
          const bounds = findFunctionBounds(
            this.documentLines(),
            this.functionName
          );
          this.funcStartLine = bounds.start;
          this.funcEndLine = bounds.end;
          this.refreshAfterChange();
        }, 300);
      })
    );

    // Show the panel
    await vscode.commands.executeCommand(
      "setContext",
      ATG_MODE_ACTIVE_CONTEXT,
      true
    );
    if (this.panelView) {
      await this.panelView.reveal();
      this.panelView.notifyStateChanged();
    }

    // The panel just took space at the bottom; bring the target line back into
    // view at the top of the editor and hand focus back to the code.
    setTimeout(() => void this.revealTargetAtTop(), 150);

    // Fetch clangd locals asynchronously
    this.fetchLocalsAsync(this.enviroPath);

    vectorMessage(
      `ATG Mode: Active on line ${lineNumber} of ${path.basename(this.filePath)}`
    );
  }

  exit() {
    const wasActive = this.isActive;
    this.isActive = false;

    vscode.commands.executeCommand(
      "setContext",
      ATG_MODE_ACTIVE_CONTEXT,
      false
    );

    for (const editor of this.editorsForFile()) {
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

    if (this.docChangeTimer) {
      clearTimeout(this.docChangeTimer);
      this.docChangeTimer = null;
    }
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables = [];
    this.statusBarItem = null;
    this.tokens = [];

    this.selectedVars.clear();
    this.variableLookup.clear();
    this.document = null;

    if (this.panelView) {
      this.panelView.notifyStateChanged();
      // Give focus back to the editor; the panel view hides itself via its
      // `when` clause once the context key is cleared.
      vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
    }

    if (wasActive) vectorMessage("ATG Mode: Exited");
  }

  /**
   * Add or remove a variable. `clickedLine` (1-based) is used to pick up a
   * default array index from the clicked source line.
   */
  toggleVariable(fullPath: string, clickedLine?: number) {
    if (this.selectedVars.has(fullPath)) {
      this.selectedVars.delete(fullPath);
      this.refreshAfterChange();
      return;
    }
    this.addVariable(fullPath, clickedLine);
  }

  /** Add a variable (no-op if already selected). */
  addVariable(fullPath: string, clickedLine?: number) {
    if (this.selectedVars.has(fullPath)) return;

    const info = lookupPath(this.variableLookup, fullPath);
    if (info && info.kind === "struct") return; // by-value struct, not assignable

    // Detect array: trust kind from lookup, but also check if the variable is
    // subscripted on the clicked line (handles missing / not yet loaded types)
    const defaultIndex = this.getDefaultIndexFromLine(fullPath, clickedLine);
    const isArray = info?.kind === "array" || defaultIndex !== "";
    const defaultEntries: ArrayEntry[] = [];
    if (isArray) defaultEntries.push({ index: defaultIndex, value: "" });

    this.selectedVars.set(fullPath, {
      displayType: info?.displayType || "",
      kind: isArray ? "array" : info?.kind || "unknown",
      enumValues: info?.enumValues || [],
      value: "",
      entries: defaultEntries,
    });

    this.refreshAfterChange();
  }

  setVariableValue(fullPath: string, value: string) {
    const variable = this.selectedVars.get(fullPath);
    if (variable) {
      variable.value = value;
      this.updateStatusBar();
    }
  }

  removeVariable(fullPath: string) {
    if (this.selectedVars.delete(fullPath)) this.refreshAfterChange();
  }

  addArrayEntry(fullPath: string) {
    const variable = this.selectedVars.get(fullPath);
    if (variable) {
      variable.entries.push({ index: "", value: "" });
      this.updateStatusBar();
      this.panelView?.notifyStateChanged();
    }
  }

  removeArrayEntry(fullPath: string, entryIndex: number) {
    const variable = this.selectedVars.get(fullPath);
    if (variable && entryIndex >= 0 && entryIndex < variable.entries.length) {
      variable.entries.splice(entryIndex, 1);
      this.updateStatusBar();
      this.panelView?.notifyStateChanged();
    }
  }

  updateArrayEntry(
    fullPath: string,
    entryIndex: number,
    field: "index" | "value",
    fieldValue: string
  ) {
    const variable = this.selectedVars.get(fullPath);
    if (variable && entryIndex >= 0 && entryIndex < variable.entries.length) {
      variable.entries[entryIndex][field] = fieldValue;
      this.updateStatusBar();
    }
  }

  /** Move the target line (1-based). Returns false if the line is not allowed. */
  setTargetLine(line: number): boolean {
    if (!this.isActive) return false;
    if (line < this.funcStartLine || line > this.funcEndLine) {
      vscode.window.showWarningMessage(
        `Line ${line} is outside ${this.functionName || "the current function"} (lines ${this.funcStartLine}-${this.funcEndLine}).`
      );
      return false;
    }
    const targetable = this.getTargetableLines();
    if (targetable.size > 0 && !targetable.has(line)) {
      vscode.window.showWarningMessage(
        `Line ${line} is not a statement or branch line, ATG cannot target it.`
      );
      return false;
    }
    this.targetLine = line;
    this.targetIsDecision = this.checkIsDecisionLine(line);
    this.truthValue = "";
    this.refreshAfterChange();
    vectorMessage(`ATG Mode: Target line → ${line}`);
    return true;
  }

  setTruthValue(value: "True" | "False" | "") {
    this.truthValue = value;
    this.updateStatusBar();
    this.panelView?.notifyStateChanged();
    vectorMessage(`ATG Mode: Truth value → ${value || "auto"}`);
  }

  /** After the panel opened, show the target line at the top of the editor. */
  private async revealTargetAtTop() {
    if (!this.isActive || !this.document) return;
    const editor = this.editorsForFile()[0];
    if (!editor) return;
    try {
      const focused = await vscode.window.showTextDocument(this.document, {
        viewColumn: editor.viewColumn,
        preserveFocus: false,
        preview: false,
      });
      const line = Math.min(this.targetLine, this.document.lineCount) - 1;
      focused.revealRange(
        new vscode.Range(line, 0, line, 0),
        vscode.TextEditorRevealType.AtTop
      );
    } catch {
      // editor may have been closed meanwhile
    }
  }

  /** Reveal a source line in the editor without stealing focus from the panel. */
  async revealLine(line: number) {
    if (!this.document) return;
    const clamped = Math.min(Math.max(1, line), this.document.lineCount);
    const range = this.document.lineAt(clamped - 1).range;
    try {
      const editor = await vscode.window.showTextDocument(this.document, {
        preserveFocus: true,
        preview: false,
        viewColumn: this.editorsForFile()[0]?.viewColumn,
      });
      editor.revealRange(
        range,
        vscode.TextEditorRevealType.InCenterIfOutsideViewport
      );
    } catch {
      // editor may have been closed
    }
  }

  async fetchTest() {
    if (!this.isActive) return;

    const enviroPath = this.enviroPath ?? this.getEnviroPath();
    if (!enviroPath) {
      vscode.window.showWarningMessage("No environment found");
      return;
    }

    const variableValues = buildVariableValues(this.selectedVars);
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

  // Called by the panel for cross-highlighting
  highlightVariableInEditor(fullPath: string | null) {
    if (!this.crossHighlightDeco) return;
    const ranges = fullPath
      ? this.tokens
          .filter((token) => token.path === fullPath)
          .map(
            (token) =>
              new vscode.Range(
                token.line - 1,
                token.start,
                token.line - 1,
                token.end
              )
          )
      : [];
    for (const editor of this.editorsForFile()) {
      editor.setDecorations(this.crossHighlightDeco, ranges);
    }
  }

  getPanelState(): ATGPanelState {
    if (!this.isActive || !this.document) {
      return {
        isActive: false,
        fileName: "",
        functionName: "",
        enviroName: "",
        targetLine: 0,
        truthValue: "",
        isDecision: false,
        funcStartLine: 0,
        funcEndLine: 0,
        previewStart: 1,
        lines: [],
        tokens: [],
        targetable: [],
        variables: [],
        known: [],
      };
    }

    const allLines = this.documentLines();
    const previewWindow = choosePreviewWindow(
      this.funcStartLine,
      this.funcEndLine,
      this.targetLine
    );
    const lines = allLines.slice(previewWindow.start - 1, previewWindow.end);
    const tokens = this.tokens.filter(
      (token) =>
        token.line >= previewWindow.start && token.line <= previewWindow.end
    );
    const targetable = [...this.getTargetableLines()]
      .filter(
        (lineNumber) =>
          lineNumber >= previewWindow.start && lineNumber <= previewWindow.end
      )
      .sort((first, second) => first - second);

    const variables = [];
    for (const [variablePath, info] of this.selectedVars) {
      variables.push({
        path: variablePath,
        displayType: info.displayType,
        kind: info.kind,
        enumValues: info.enumValues,
        value: info.value,
        entries: info.entries,
      });
    }

    return {
      isActive: true,
      fileName: path.basename(this.filePath),
      functionName: this.functionName,
      enviroName: this.enviroPath ? path.basename(this.enviroPath) : "",
      targetLine: this.targetLine,
      truthValue: this.truthValue,
      isDecision: this.targetIsDecision,
      funcStartLine: this.funcStartLine,
      funcEndLine: this.funcEndLine,
      previewStart: previewWindow.start,
      lines,
      tokens,
      targetable,
      variables,
      known: flattenLookup(this.variableLookup),
    };
  }

  // ─── Private ─────────────────────────────────────────────────────

  private documentLines(): string[] {
    return this.document ? this.document.getText().split(/\r?\n/) : [];
  }

  private editorsForFile(): vscode.TextEditor[] {
    return vscode.window.visibleTextEditors.filter(
      (editor) => editor.document.uri.fsPath === this.filePath
    );
  }

  private checkIsDecisionLine(line: number): boolean {
    if (!this.document || line < 1 || line > this.document.lineCount)
      return false;
    return isDecisionLineText(this.document.lineAt(line - 1).text);
  }

  private getDefaultIndexFromLine(fullPath: string, line?: number): string {
    if (line === undefined || !this.document) return "";
    if (line < 1 || line > this.document.lineCount) return "";
    return getDefaultIndexFromLineText(
      this.document.lineAt(line - 1).text,
      fullPath
    );
  }

  /** Statement + branch lines for the file, or an empty set if unknown. */
  private getTargetableLines(): Set<number> {
    try {
      const cov = getCoverageDataForFile(this.filePath);
      return new Set<number>([
        ...(cov.allStatements || []),
        ...(cov.allBranches || []),
      ]);
    } catch {
      return new Set<number>();
    }
  }

  private refreshAfterChange() {
    this.rebuildDecorations();
    this.updateStatusBar();
    this.panelView?.notifyStateChanged();
  }

  private rebuildDecorations() {
    if (!this.isActive || !this.document) return;

    this.tokens = computeClickableTokens(
      this.documentLines(),
      this.funcStartLine,
      this.funcEndLine,
      this.variableLookup
    );

    const clickable: vscode.DecorationOptions[] = [];
    const selected: vscode.DecorationOptions[] = [];
    for (const tok of this.tokens) {
      const range = new vscode.Range(
        tok.line - 1,
        tok.start,
        tok.line - 1,
        tok.end
      );
      const isSelected = this.selectedVars.has(tok.path);
      const dispType = tok.displayType || "unknown";
      const hover = new vscode.MarkdownString(
        `**${tok.path}** : \`${dispType}\` — *click to ${isSelected ? "remove" : "add"}*`
      );
      (isSelected ? selected : clickable).push({ range, hoverMessage: hover });
    }

    // Highlight the whole decision statement, not just its first line
    const extent = decisionExtent(this.documentLines(), this.targetLine);
    const targetRange: vscode.Range[] = [];
    for (
      let lineNumber = extent.start;
      lineNumber <= extent.end;
      lineNumber++
    ) {
      targetRange.push(new vscode.Range(lineNumber - 1, 0, lineNumber - 1, 0));
    }
    for (const editor of this.editorsForFile()) {
      if (this.targetLineDeco)
        editor.setDecorations(this.targetLineDeco, targetRange);
      if (this.clickableDeco)
        editor.setDecorations(this.clickableDeco, clickable);
      if (this.selectedDeco) editor.setDecorations(this.selectedDeco, selected);
    }
  }

  private updateStatusBar() {
    if (!this.statusBarItem) return;
    const constraintCount = this.selectedVars.size;
    const outcomeSuffix = this.truthValue ? ` [${this.truthValue}]` : "";
    this.statusBarItem.text = `$(beaker) ATG line ${this.targetLine}${outcomeSuffix} · ${constraintCount} constraint${constraintCount !== 1 ? "s" : ""}`;
    this.statusBarItem.command = "vectorcastTestExplorer.atgShowMenu";
    this.statusBarItem.tooltip =
      "ATG Test for Line is active — click for actions";
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

    const options = JSON.stringify({
      sourceFile: this.filePath,
      targetLine: this.targetLine,
    }).replaceAll('"', '\\"');
    const commandToRun = `${vPythonCommandToUse} ${globalTestInterfacePath}  --mode=getLocalVariables --clicast=${clicastCommandToUse} --path=${enviroPath} --options="${options}"`;
    const { exec } = require("child_process");
    const requestedFor = this.filePath;
    exec(
      commandToRun,
      { cwd: path.dirname(enviroPath) },
      (error: any, stdout: string) => {
        if (error || !this.isActive || this.filePath !== requestedFor) return;
        try {
          const marker = "ACTUAL-DATA";
          const idx = stdout.indexOf(marker);
          const cleanOutput = (
            idx >= 0 ? stdout.substring(idx + marker.length) : stdout
          ).trim();
          const data = JSON.parse(cleanOutput);
          if (data.locals && data.locals.length > 0) {
            buildLookupFromNodes(data.locals, this.variableLookup, "local");
            this.refreshAfterChange();
          }
        } catch {
          // Locals are a best-effort enrichment; ignore parse failures.
        }
      }
    );
  }
}

// ─── Panel WebviewView Provider ──────────────────────────────────────

export class ATGLinePanelViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = "vectorcastTestExplorer.atgLinePanel";
  static readonly containerId = "vectorcastATGLine";

  private view: vscode.WebviewView | null = null;
  private revealedAt = 0;

  constructor(
    private manager: ATGModeManager,
    private context: vscode.ExtensionContext
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _resolveContext: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this.view = webviewView;

    let base: string | null = null;
    try {
      base = resolveWebviewBase(this.context, "manage", "webviews");
    } catch (err) {
      vectorMessage(
        `ATG panel: could not locate webview assets: ${(err as Error).message}`,
        errorLevel.error
      );
    }

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: base ? [vscode.Uri.file(base)] : [],
    };
    webviewView.webview.html = base
      ? this.getHtml(webviewView.webview, base)
      : this.getFallbackHtml();

    webviewView.webview.onDidReceiveMessage((message) =>
      this.handleMessage(message)
    );
    // Hiding the view (switching panel tab, closing the panel, "Hide")
    // is the same as pressing Cancel. Ignore the burst of visibility events
    // that can accompany the view being created.
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) return;
      if (Date.now() - this.revealedAt < 1000) return;
      if (this.manager.isActive) this.manager.exit();
    });
    webviewView.onDidDispose(() => {
      if (this.view === webviewView) this.view = null;
      if (this.manager.isActive) this.manager.exit();
    });
  }

  isResolved(): boolean {
    return this.view !== null;
  }

  /**
   * Bring the panel view to the front. The view only exists while the
   * atgModeActive context key is set, and VS Code materialises it
   * asynchronously after the key flips, so retry briefly if the first focus
   * request lands before the view is registered.
   */
  async reveal() {
    const focusView = () =>
      vscode.commands.executeCommand(
        `${ATGLinePanelViewProvider.viewId}.focus`
      );
    const openContainer = () =>
      vscode.commands.executeCommand(
        `workbench.view.extension.${ATGLinePanelViewProvider.containerId}`
      );

    this.revealedAt = Date.now();
    for (let attempt = 0; attempt < 5 && !this.view; attempt++) {
      try {
        await focusView();
      } catch {
        try {
          await openContainer();
        } catch {
          // fall through to the retry / timeout below
        }
      }
      if (this.view) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (!this.view) {
      vectorMessage(
        "ATG panel: the view did not open automatically. Open the 'ATG Test for Line' tab in the bottom panel.",
        errorLevel.warn
      );
    }
  }

  notifyStateChanged() {
    if (!this.view) return;
    this.view.webview.postMessage({
      command: "state",
      state: this.manager.getPanelState(),
    });
  }

  private handleMessage(message: any) {
    if (!message || typeof message.command !== "string") return;
    vectorMessage(`ATG panel: '${message.command}'`, errorLevel.trace);

    switch (message.command) {
      case "ready":
        this.notifyStateChanged();
        break;
      case "toggleVariable":
        this.manager.toggleVariable(String(message.path), toLine(message.line));
        break;
      case "addVariable":
        this.manager.addVariable(String(message.path));
        break;
      case "removeVariable":
        this.manager.removeVariable(String(message.path));
        break;
      case "updateValue":
        this.manager.setVariableValue(
          String(message.path),
          String(message.value ?? "")
        );
        break;
      case "addArrayEntry":
        this.manager.addArrayEntry(String(message.path));
        break;
      case "removeArrayEntry":
        this.manager.removeArrayEntry(
          String(message.path),
          Number(message.entryIndex)
        );
        break;
      case "updateArrayEntry":
        if (message.field === "index" || message.field === "value") {
          this.manager.updateArrayEntry(
            String(message.path),
            Number(message.entryIndex),
            message.field,
            String(message.fieldValue ?? "")
          );
        }
        break;
      case "setTruthValue":
        if (
          message.value === "True" ||
          message.value === "False" ||
          message.value === ""
        ) {
          this.manager.setTruthValue(message.value);
        }
        break;
      case "revealLine": {
        const line = toLine(message.line);
        if (line !== undefined) this.manager.revealLine(line);
        break;
      }
      case "highlightInEditor":
        this.manager.highlightVariableInEditor(
          message.path ? String(message.path) : null
        );
        break;
      case "clearHighlight":
        this.manager.highlightVariableInEditor(null);
        break;
      case "fetchTest":
        this.manager.fetchTest();
        break;
      case "cancel":
        this.manager.exit();
        break;
    }
  }

  private getHtml(webview: vscode.Webview, base: string): string {
    const cssOnDisk = vscode.Uri.file(
      path.join(base, "css", "atgLinePanel.css")
    );
    const scriptOnDisk = vscode.Uri.file(
      path.join(base, "webviewScripts", "atgLinePanel.js")
    );
    const htmlPath = path.join(base, "html", "atgLinePanel.html");

    const cssUri = webview.asWebviewUri(cssOnDisk);
    const scriptUri = webview.asWebviewUri(scriptOnDisk);
    const nonce = getNonce();

    let html: string = fs.readFileSync(htmlPath, "utf8");

    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';">`;
    html = html.replace(/<head>/i, `<head>${csp}`);
    html = html.replace(/{{\s*cssUri\s*}}/g, cssUri.toString());
    html = html.replace(
      /<script\s+src="{{\s*scriptUri\s*}}"><\/script>/i,
      `<script nonce="${nonce}" src="${scriptUri}"></script>`
    );
    return html;
  }

  private getFallbackHtml(): string {
    return `<!DOCTYPE html><html><body style="font-family:var(--vscode-font-family);color:var(--vscode-errorForeground);padding:12px">
The ATG panel assets could not be found. See the VectorCAST Test Explorer output for details.
</body></html>`;
  }
}

function toLine(value: unknown): number | undefined {
  const lineNumber = Number(value);
  return Number.isInteger(lineNumber) && lineNumber > 0
    ? lineNumber
    : undefined;
}
