import * as vscode from "vscode";
import { dumpTestScriptFile } from "../vcastAdapter";
import { convertTestScriptContents } from "../vcastUtilities";
import { testNodeType } from "../testData";
import {
  enterReviewMode,
  exitReviewMode,
  updateDisplayedCoverage,
} from "../coverage";
import { logCliError } from "./requirementsLog";
import { runReqs2xTool } from "./processRunner";
import { TESTS2CHECK_EXECUTABLE_PATH } from "./requirementsExecutables";
import {
  createRequirementInfoBox,
  parseTests2checkResult,
  RequirementData,
} from "./testReviewData";

// State Management
export let activeHighlightDecoration: vscode.TextEditorDecorationType | null =
  null;

/**
 * Finds the line number containing the test name in the TST script
 */
export function findTestNameLine(tstContent: string, testName: string): number {
  const lines = tstContent.split("\n");
  const searchPattern = `TEST.NAME:${testName}`;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(searchPattern)) {
      return i;
    }
  }

  return 0; // Default to top of file if not found
}

// Decoration Types for highlighted critical lines
let activeUncoveredDecoration: vscode.TextEditorDecorationType | undefined;
let activeCoveredDecoration: vscode.TextEditorDecorationType | undefined;

/**
 * Creates a decoration type for a given coverage state
 */
function createCoverageDecoration(
  bgColor: string
): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({
    backgroundColor: bgColor,
    isWholeLine: true,
  });
}

/**
 * Converts a 1-based line number to a single-line vscode.Range
 */
function lineToRange(
  document: vscode.TextDocument,
  lineNumber: number
): vscode.Range {
  const line = lineNumber - 1; // Convert to 0-based
  return new vscode.Range(
    new vscode.Position(line, 0),
    new vscode.Position(line, document.lineAt(line).text.length)
  );
}

/**
 * Highlights critical lines individually based on coverage status
 * Uses test-specific actualLines from tests2check rather than global coverage
 */
export function highlightCriticalLines(
  editor: vscode.TextEditor,
  document: vscode.TextDocument,
  reqData: RequirementData
): void {
  // Dispose all previous decorations via shared helper
  disposeCriticalLineDecorations();

  if (!reqData.actualLines || reqData.actualLines.length === 0) {
    return;
  }

  // --- Decoration types ---
  activeUncoveredDecoration = createCoverageDecoration(
    "rgba(243, 74, 51, 0.15)" // red bg
  );
  activeCoveredDecoration = createCoverageDecoration(
    "rgba(87, 184, 89, 0.15)" // green bg
  );

  // Build a Set of critical line numbers for fast lookup (1-based)
  const criticalLines = new Set<number>();
  for (
    let line = reqData.importantLineStart;
    line <= reqData.importantLineEnd;
    line++
  ) {
    criticalLines.add(line);
  }

  // actualLines from tests2check are 0-based, convert to 1-based
  const actualLinesSet = new Set<number>(
    reqData.actualLines.map((line) => line + 1)
  );

  // expectedLines from tests2check are 0-based, convert to 1-based
  const expectedLinesSet = new Set<number>(
    (reqData.expectedLines || []).map((line) => line + 1)
  );

  const uncoveredRanges: vscode.Range[] = [];
  const coveredRanges: vscode.Range[] = [];

  for (const line of criticalLines) {
    // Guard: skip lines beyond the document
    if (line > document.lineCount) {
      continue;
    }

    const range = lineToRange(document, line);

    if (actualLinesSet.has(line)) {
      coveredRanges.push(range);
    } else if (expectedLinesSet.has(line)) {
      uncoveredRanges.push(range);
    }
    // Lines not in expectedLines or actualLines are non-executable — skip them
  }

  // Apply both decoration sets in one pass
  editor.setDecorations(activeUncoveredDecoration, uncoveredRanges);
  editor.setDecorations(activeCoveredDecoration, coveredRanges);
}

/**
 * Shows the requirement info box as a peek window
 * Automatically clears highlights when the peek window is closed
 */
export async function showRequirementPeekBox(
  sourceFileUri: vscode.Uri,
  peekPosition: vscode.Position,
  reqData: RequirementData,
  context: vscode.ExtensionContext
): Promise<void> {
  const virtualDocUri = vscode.Uri.parse("requirement-info:Requirement Info");
  const infoBoxContent = createRequirementInfoBox(reqData);

  // Create content provider for the virtual document
  const provider = new (class implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(): string {
      return infoBoxContent;
    }
  })();

  const providerDisposable =
    vscode.workspace.registerTextDocumentContentProvider(
      "requirement-info",
      provider
    );

  await vscode.workspace.openTextDocument(virtualDocUri);

  // Show peek window
  await vscode.commands.executeCommand(
    "editor.action.peekLocations",
    sourceFileUri,
    peekPosition,
    [new vscode.Location(virtualDocUri, new vscode.Position(0, 0))],
    "peek"
  );

  // Disable line numbers in peek window
  setTimeout(() => {
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.scheme === "requirement-info") {
        editor.options = {
          ...editor.options,
          lineNumbers: vscode.TextEditorLineNumbersStyle.Off,
        };
      }
    }
  }, 0);

  // Listen for when the peek window is closed and clear highlights + exit review mode
  const disposable = vscode.window.onDidChangeVisibleTextEditors(
    async (editors) => {
      const peekWindowOpen = editors.some(
        (editor) => editor.document.uri.scheme === "requirement-info"
      );

      if (!peekWindowOpen) {
        // Clear ALL coverage highlight decorations
        disposeCriticalLineDecorations();

        // Also clear the legacy single decoration if somehow still set
        if (activeHighlightDecoration) {
          activeHighlightDecoration.dispose();
          setActiveHighlightDecoration(null);
        }

        // Exit review mode and refresh normal coverage
        await exitReviewMode();
        updateDisplayedCoverage();

        // Clean up this listener
        disposable.dispose();
      }
    }
  );
  context.subscriptions.push(disposable);

  // Clean up provider after peek window is shown
  setTimeout(() => {
    providerDisposable.dispose();
  }, 1000);
}

/**
 * Disposes all active critical line decorations
 */
export function disposeCriticalLineDecorations(): void {
  activeUncoveredDecoration?.dispose();
  activeCoveredDecoration?.dispose();
  activeUncoveredDecoration = undefined;
  activeCoveredDecoration = undefined;
}

/**
 * Opens the source file with requirement highlighting
 */
export async function openSourceFileWithHighlight(
  sourceFilePath: string,
  reqData: RequirementData,
  context: vscode.ExtensionContext,
  testId: string
): Promise<void> {
  const sourceFileUri = vscode.Uri.file(sourceFilePath);
  const document = await vscode.workspace.openTextDocument(sourceFileUri);

  // Position cursor near the requirement line
  const peekPosition = new vscode.Position(
    Math.max(0, reqData.lineNumber - 1),
    0
  );

  // Open document
  const editor = await vscode.window.showTextDocument(document, {
    preview: false,
    preserveFocus: false,
    selection: new vscode.Range(peekPosition, peekPosition),
  });

  // Enter review mode BEFORE applying decorations
  enterReviewMode(testId, sourceFilePath);

  // Apply the green highlight to critical lines
  highlightCriticalLines(editor, document, reqData);

  // Show the peek box
  await showRequirementPeekBox(sourceFileUri, peekPosition, reqData, context);

  // Update coverage decorations to show review mode coverage
  await updateDisplayedCoverage();
}

/**
 * Opens the TST script and jumps to the test definition
 */
export async function openTstScriptAtTest(
  testNode: testNodeType,
  scriptPath: string
): Promise<void> {
  const commandStatus = await dumpTestScriptFile(testNode, scriptPath);

  if (commandStatus.errorCode !== 0) {
    return;
  }

  convertTestScriptContents(scriptPath);

  const tstScriptUri = vscode.Uri.file(scriptPath);
  const tstDocument = await vscode.workspace.openTextDocument(tstScriptUri);

  // Find the test name line in the script
  let targetLine = 0;
  if (testNode.testName) {
    const tstContent = tstDocument.getText();
    targetLine = findTestNameLine(tstContent, testNode.testName);
  }

  // Open document and jump to test definition
  const position = new vscode.Position(targetLine, 0);
  const selection = new vscode.Range(position, position);

  await vscode.window.showTextDocument(tstDocument, {
    viewColumn: vscode.ViewColumn.Beside,
    selection: selection,
    preview: false,
    preserveFocus: false,
  });
}

export function setActiveHighlightDecoration(
  decoration: vscode.TextEditorDecorationType | null
): void {
  activeHighlightDecoration = decoration;
}

/**
 * Runs tests2check for one test and returns what the review shows, or null
 * (after telling the user why) when there is nothing to review.
 */
export async function fetchRequirementCoverageData(
  enviroPath: string,
  gatewayPath: string,
  testName: string,
  unitName: string,
  notes: string,
  functionStartLine: number = 0
): Promise<RequirementData | null> {
  return vscode.window.withProgress<RequirementData | null>(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Reviewing requirement test",
      cancellable: false,
    },
    async () => {
      try {
        const { stdout } = await runReqs2xTool({
          exe: TESTS2CHECK_EXECUTABLE_PATH,
          args: [
            "-e",
            enviroPath,
            gatewayPath,
            "-f",
            testName,
            "--json",
            "--justification",
          ],
          llm: true,
          captureOutput: true,
        });

        const results = JSON.parse(stdout ?? "");
        if (!Array.isArray(results) || results.length === 0) {
          vscode.window.showWarningMessage(
            `tests2check returned no result for ${testName}.`
          );
          return null;
        }

        // -f matches test names across the whole environment.
        if (results.length > 1) {
          vscode.window.showInformationMessage(
            `More than one test in this environment is named ${testName}, so the review cannot tell which one to show.`
          );
          return null;
        }

        return parseTests2checkResult(
          results[0],
          testName,
          unitName,
          notes,
          functionStartLine
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showWarningMessage(
          `Failed to get requirement data: ${msg}`
        );
        logCliError(msg);
        return null;
      }
    }
  );
}
