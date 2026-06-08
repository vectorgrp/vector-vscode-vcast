// Boundary-processor mode (pyatg #3285): orchestrates the two-stage atg
// flow (--generate-ranges-sheet → user review → --from-ranges-sheet) for
// a single source unit. Iteration 1 is read-only — the webview shows the
// inputs that pyatg discovered and the "Generate" button writes a
// default Boundaries.csv where every row is <AUTO_GENERATE>. The full
// per-row editing UI lands in iteration 2 (see BP_INTEGRATION_PLAN.md).

import * as vscode from "vscode";

import { vectorMessage, openMessagePane } from "./messagePane";
import { executeATGCommandWithProgress } from "./vcastCommandRunner";
import { loadTestScriptIntoEnvironment } from "./vcastAdapter";
import {
  BoundaryMappingRow,
  findEnviroForSourceFile,
  getBoundaryStageOneCommand,
  getBoundaryStageTwoCommand,
  parseBoundaryMappingCsv,
} from "./vcastUtilities";

const fs = require("fs");
const path = require("path");

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

    // 2. Set up the sheet directory inside the env directory.
    const sheetDir = path.join(path.dirname(enviroPath), ".bp-sheets");
    if (!fs.existsSync(sheetDir)) {
      fs.mkdirSync(sheetDir, { recursive: true });
    }
    const sheetSeed = path.join(sheetDir, "sheet.xlsx");
    const mappingCsv = path.join(sheetDir, "mapping.csv");

    // 3. Run stage 1: --generate-ranges-sheet. Note: atg always prints
    // "ERROR: ATG has not generated any tests" and exits 1 at the end of
    // this mode because no tests are produced — only sheets. Treat
    // mapping.csv existence as the real success criterion.
    openMessagePane();
    vectorMessage(`[BP] Stage 1: generating ranges sheet for ${sourceFile}`);
    const stage1 = getBoundaryStageOneCommand(enviroPath, sheetSeed);
    await executeATGCommandWithProgress(
      stage1.command,
      path.dirname(enviroPath),
      stage1.envVars,
      "Boundary Mode: generating inputs sheet"
    );
    if (!fs.existsSync(mappingCsv)) {
      vscode.window.showErrorMessage(
        `Boundary mode: stage 1 did not produce ${mappingCsv}. See the VectorCAST Test Explorer message pane for atg output.`
      );
      return;
    }

    // 4. Parse mapping.csv and open the read-only review webview.
    const rows = parseBoundaryMappingCsv(mappingCsv);
    if (rows.length === 0) {
      vscode.window.showInformationMessage(
        "Boundary mode: no controllable inputs found in this unit."
      );
      return;
    }
    this.openReviewPanel(context, {
      sourceFile,
      enviroPath,
      sheetDir,
      rows,
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
      rows: BoundaryMappingRow[];
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
        await this.runStageTwo(state);
        panel.dispose();
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
      rows: BoundaryMappingRow[];
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
    const payload = {
      sourceFile: state.sourceFile,
      enviroPath: state.enviroPath,
      sheetDir: state.sheetDir,
      rows: state.rows,
    };
    return template
      .replace(/\$\{CSP_SOURCE\}/g, webview.cspSource)
      .replace(/\$\{CSS_URI\}/g, cssUri.toString())
      .replace(/\$\{JS_URI\}/g, jsUri.toString())
      .replace(/\$\{PAYLOAD\}/g, JSON.stringify(payload));
  }

  private async runStageTwo(state: {
    sourceFile: string;
    enviroPath: string;
    sheetDir: string;
    rows: BoundaryMappingRow[];
  }): Promise<void> {
    // Iteration 1: no per-row overrides — autogen mode is selected by the
    // absence of Boundaries.csv. Make sure any stale one is gone.
    const staleBoundaries = path.join(state.sheetDir, "Boundaries.csv");
    if (fs.existsSync(staleBoundaries)) fs.unlinkSync(staleBoundaries);

    // Run --from-ranges-sheet, producing the .tst. The .tst must be a
    // sibling of the env directory because loadTestScriptIntoEnvironment
    // resolves the env as path.dirname(scriptPath)/enviroName.
    const scriptPath = path.join(
      path.dirname(state.enviroPath),
      `boundary-${Date.now()}.tst`
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
