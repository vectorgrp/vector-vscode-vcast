// Boundary editor for one source unit. Drives pyatg's two-stage flow:
// stage 1 (--generate-ranges-sheet) → user edits → stage 2
// (--from-ranges-sheet) → load .tst. See BP_INTEGRATION_PLAN.md.

import * as vscode from "vscode";

import { vectorMessage, openMessagePane } from "./messagePane";
import { executeATGCommandWithProgress } from "./vcastCommandRunner";
import { loadTestScriptIntoEnvironment } from "./vcastAdapter";
import {
  NodeData,
  BoundaryOverride,
  NamedRange,
  findEnviroForSourceFile,
  getBoundaryStageOneCommand,
  getBoundaryStageTwoCommand,
  loadPersistedState,
  parseBoundaryMappingJson,
  savePersistedState,
  writeManualInputsXlsx,
} from "./vcastUtilities";

const fs = require("fs");
const path = require("path");


function _workspaceRootForFile(filePath: string): string | undefined {
  // The workspace folder that contains the file we're operating on
  // owns the shared named-ranges library. Falls back to the first
  // workspace folder when the file is outside any folder (rare).
  const uri = vscode.Uri.file(filePath);
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (folder) return folder.uri.fsPath;
  const folders = vscode.workspace.workspaceFolders || [];
  return folders.length > 0 ? folders[0].uri.fsPath : undefined;
}


export class BPModeManager {
  private currentPanel: vscode.WebviewPanel | undefined = undefined;

  async enter(
    sourceFile: string,
    context: vscode.ExtensionContext
  ): Promise<void> {
    // 1. Find the env that contains this source file.
    const enviroPath = await this.resolveEnvironment(sourceFile);
    if (!enviroPath) {
      vscode.window.showWarningMessage(
        "Boundary mode: no VectorCAST environment found for this file. Build and execute an env first."
      );
      return;
    }

    // 2. Sheet dir + scrub stale Boundaries.csv (would otherwise flip
    // pyatg into manual mode against this run's fresh autogen inputs).
    const sheetDir = path.join(path.dirname(enviroPath), ".bp-sheets");
    if (!fs.existsSync(sheetDir)) {
      fs.mkdirSync(sheetDir, { recursive: true });
    }
    const staleBoundaries = path.join(sheetDir, "Boundaries.csv");
    if (fs.existsSync(staleBoundaries)) fs.unlinkSync(staleBoundaries);
    const sheetSeed = path.join(sheetDir, "sheet.xlsx");
    const mappingJson = path.join(sheetDir, "mapping.json");
    const workspaceRoot = _workspaceRootForFile(sourceFile);

    // 3. Stage 1. atg always exits 1 in --generate-ranges-sheet mode
    // (no tests produced, only sheets); mapping.json existence is the
    // real success signal.
    openMessagePane();
    vectorMessage(`[BP] Stage 1: generating ranges sheet for ${sourceFile}`);
    const stage1 = getBoundaryStageOneCommand(enviroPath, sheetSeed);
    await executeATGCommandWithProgress(
      stage1.command,
      path.dirname(enviroPath),
      stage1.envVars,
      "Boundary Mode: generating inputs sheet"
    );
    // mapping.json is required from pyatg 3285_bp.
    const rows = parseBoundaryMappingJson(mappingJson);
    if (!rows) {
      vscode.window.showErrorMessage(
        `Boundary mode: stage 1 did not produce ${mappingJson}. ` +
          `pyatg must include the "Boundary: emit mapping.json" ` +
          `commit (rdx1-pyatg branch 3285_bp_integration).`
      );
      return;
    }
    vectorMessage(`[BP] Loaded ${rows.length} node(s) from mapping.json.`);
    if (rows.length === 0) {
      vscode.window.showInformationMessage(
        "Boundary mode: no controllable inputs found in this unit."
      );
      return;
    }
    const saved = loadPersistedState(sheetDir, rows, workspaceRoot);
    this.openReviewPanel(context, {
      sourceFile,
      enviroPath,
      sheetDir,
      workspaceRoot,
      rows,
      savedOverrides: saved.overrides,
      savedNamedRanges: saved.namedRanges,
    });
  }

  private async resolveEnvironment(
    sourceFile: string
  ): Promise<string | undefined> {
    const candidates = findEnviroForSourceFile(sourceFile);
    if (candidates.length === 1) {
      return candidates[0];
    }
    if (candidates.length > 1) {
      const pick = await vscode.window.showQuickPick(candidates, {
        placeHolder:
          "Multiple VectorCAST environments contain this file — pick one",
      });
      return pick;
    }
    // No coverage data yet — let the user paste a path.
    const manual = await vscode.window.showInputBox({
      prompt:
        "No VectorCAST environment was discovered automatically. Enter the absolute path to the env directory (the one containing UNITDATA.VCD).",
      ignoreFocusOut: true,
    });
    return manual && manual.trim().length > 0 ? manual.trim() : undefined;
  }

  private openReviewPanel(
    context: vscode.ExtensionContext,
    state: {
      sourceFile: string;
      enviroPath: string;
      sheetDir: string;
      workspaceRoot: string | undefined;
      rows: NodeData[];
      savedOverrides: BoundaryOverride[];
      savedNamedRanges: NamedRange[];
    }
  ): void {
    if (this.currentPanel) {
      this.currentPanel.dispose();
    }
    const panel = vscode.window.createWebviewPanel(
      "vectorcastBoundaryEditor",
      `Boundary Tests: ${path.basename(state.sourceFile)}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "src", "manage", "webviews"),
        ],
      }
    );
    this.currentPanel = panel;

    panel.webview.html = this.buildHtml(panel.webview, context, state);

    panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.command === "generate") {
        const overrides: BoundaryOverride[] = Array.isArray(msg.overrides)
          ? msg.overrides
          : [];
        const namedRanges: NamedRange[] = Array.isArray(msg.namedRanges)
          ? msg.namedRanges
          : [];
        await this.runStageTwo(state, overrides, namedRanges);
        panel.dispose();
      } else if (msg.command === "saveDraft") {
        // Persist state without running stage 2; panel stays open.
        const overrides: BoundaryOverride[] = Array.isArray(msg.overrides)
          ? msg.overrides
          : [];
        const namedRanges: NamedRange[] = Array.isArray(msg.namedRanges)
          ? msg.namedRanges
          : [];
        savePersistedState(
          state.sheetDir,
          state.rows,
          overrides,
          namedRanges,
          state.workspaceRoot
        );
        vectorMessage(
          `[BP] Draft saved: ${overrides.length} override(s), ${namedRanges.length} named range(s).`
        );
      } else if (msg.command === "cancel") {
        panel.dispose();
      }
    });

    panel.onDidDispose(() => {
      if (this.currentPanel === panel) this.currentPanel = undefined;
    });
  }

  private buildHtml(
    webview: vscode.Webview,
    context: vscode.ExtensionContext,
    state: {
      sourceFile: string;
      enviroPath: string;
      sheetDir: string;
      workspaceRoot: string | undefined;
      rows: NodeData[];
      savedOverrides: BoundaryOverride[];
      savedNamedRanges: NamedRange[];
    }
  ): string {
    const resourceRoot = vscode.Uri.joinPath(
      context.extensionUri,
      "src",
      "manage",
      "webviews"
    );
    const htmlPath = vscode.Uri.joinPath(
      resourceRoot,
      "html",
      "boundaryEditor.html"
    ).fsPath;
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(resourceRoot, "css", "boundaryEditor.css")
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        resourceRoot,
        "webviewScripts",
        "boundaryEditor.js"
      )
    );

    const template = fs.readFileSync(htmlPath, "utf8") as string;
    // Embed the source — drives the syntax-highlighted left pane.
    let sourceContent = "";
    try {
      sourceContent = fs.readFileSync(state.sourceFile, "utf8") as string;
    } catch (e) {
      vectorMessage(`[BP] Could not read source ${state.sourceFile}: ${e}`);
    }
    const payload = {
      sourceFile: state.sourceFile,
      enviroPath: state.enviroPath,
      sheetDir: state.sheetDir,
      rows: state.rows,
      savedOverrides: state.savedOverrides,
      savedNamedRanges: state.savedNamedRanges,
      sourceContent,
    };
    return template
      .replace(/\$\{CSP_SOURCE\}/g, webview.cspSource)
      .replace(/\$\{CSS_URI\}/g, cssUri.toString())
      .replace(/\$\{JS_URI\}/g, jsUri.toString())
      .replace(/\$\{PAYLOAD\}/g, JSON.stringify(payload));
  }

  private async runStageTwo(
    state: {
      sourceFile: string;
      enviroPath: string;
      sheetDir: string;
      workspaceRoot: string | undefined;
      rows: NodeData[];
      savedOverrides: BoundaryOverride[];
      savedNamedRanges: NamedRange[];
    },
    overrides: BoundaryOverride[],
    namedRanges: NamedRange[]
  ): Promise<void> {
    // Save first so a stage-2 failure still preserves the user's work.
    savePersistedState(
      state.sheetDir,
      state.rows,
      overrides,
      namedRanges,
      state.workspaceRoot
    );

    // Manual mode iff there's anything for pyatg to override; the
    // presence of Boundaries.csv is what flips it on its side.
    const boundariesPath = path.join(state.sheetDir, "Boundaries.csv");
    const wantsManual = overrides.length > 0 || namedRanges.length > 0;
    if (wantsManual) {
      const { boundariesPath: bp } = writeManualInputsXlsx(
        state.sheetDir,
        state.rows,
        overrides,
        namedRanges
      );
      vectorMessage(
        `[BP] Manual mode: ${overrides.length} override row(s), ` +
          `${namedRanges.length} named range(s); ${bp} present.`
      );
    } else {
      if (fs.existsSync(boundariesPath)) fs.unlinkSync(boundariesPath);
      vectorMessage("[BP] Autogen mode (no overrides).");
    }

    // .tst must be a sibling of the env dir (loadTestScriptIntoEnvironment
    // resolves the env as path.dirname(scriptPath)/enviroName).
    const baseName = path.basename(
      state.sourceFile,
      path.extname(state.sourceFile)
    );
    const scriptPath = path.join(
      path.dirname(state.enviroPath),
      `${baseName}-boundary.tst`
    );
    const stage2 = getBoundaryStageTwoCommand(
      state.enviroPath,
      state.sheetDir,
      scriptPath
    );
    const code2 = await executeATGCommandWithProgress(
      stage2.command,
      path.dirname(state.enviroPath),
      stage2.envVars,
      "Boundary Mode: generating tests"
    );
    if (code2 !== 0) {
      vscode.window.showErrorMessage(
        `Boundary mode: stage 2 (--from-ranges-sheet) failed with exit code ${code2}.`
      );
      return;
    }
    if (!fs.existsSync(scriptPath)) {
      vscode.window.showErrorMessage(
        `Boundary mode: stage 2 succeeded but ${scriptPath} was not produced.`
      );
      return;
    }

    // 3. Load the .tst into the env.
    const enviroName = path.basename(state.enviroPath);
    vectorMessage(`[BP] Loading ${scriptPath} into ${enviroName}`);
    await loadTestScriptIntoEnvironment(enviroName, scriptPath);
  }
}
