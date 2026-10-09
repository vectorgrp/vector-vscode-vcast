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
  reviewLineColors,
} from "./testReviewData";

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

  activeUncoveredDecoration = createCoverageDecoration(
    "rgba(243, 74, 51, 0.15)" // red bg
  );
  activeCoveredDecoration = createCoverageDecoration(
    "rgba(87, 184, 89, 0.15)" // green bg
  );

  const { covered, uncovered } = reviewLineColors(reqData);
  const ranges = (lines: number[]) =>
    lines
      .filter((line) => line <= document.lineCount)
      .map((line) => lineToRange(document, line));
  editor.setDecorations(activeUncoveredDecoration, ranges(uncovered));
  editor.setDecorations(activeCoveredDecoration, ranges(covered));
}

// Every review box gets its own URI: VS Code keeps serving a document that is
// already open instead of asking the provider again.
let reviewBox: { uri: string; text: string; shown: boolean } | undefined;
let reviewBoxProvider: vscode.Disposable | undefined;
let reviewBoxCount = 0;

export function reviewInProgress(): boolean {
  return reviewBox !== undefined;
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
  if (!reviewBoxProvider) {
    reviewBoxProvider = vscode.workspace.registerTextDocumentContentProvider(
      "requirement-info",
      {
        provideTextDocumentContent: (uri) =>
          uri.toString() === reviewBox?.uri ? reviewBox.text : "",
      }
    );
    // The review ends when its box, once shown, is closed
    const reviewEnd = vscode.window.onDidChangeVisibleTextEditors(
      async (editors) => {
        if (!reviewBox) {
          return;
        }
        const uri = reviewBox.uri;
        if (editors.some((editor) => editor.document.uri.toString() === uri)) {
          reviewBox.shown = true;
          return;
        }
        if (!reviewBox.shown) {
          return;
        }
        reviewBox = undefined;
        disposeCriticalLineDecorations();
        await exitReviewMode();
        updateDisplayedCoverage();
      }
    );
    context.subscriptions.push(reviewBoxProvider, reviewEnd);
  }

  reviewBoxCount += 1;
  const virtualDocUri = vscode.Uri.from({
    scheme: "requirement-info",
    path: reqData.title,
    query: String(reviewBoxCount),
  });
  reviewBox = {
    uri: virtualDocUri.toString(),
    text: createRequirementInfoBox(reqData),
    shown: false,
  };

  await vscode.workspace.openTextDocument(virtualDocUri);

  // Asked again at the same position, peekLocations closes the previous box
  // instead of replacing it.
  await vscode.commands.executeCommand("closeReferenceSearch");

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
  testId: string,
  enviroPath: string
): Promise<void> {
  // This review replaces any previous one, so that one's box closing must not
  // end this review.
  reviewBox = undefined;

  const sourceFileUri = vscode.Uri.file(sourceFilePath);
  const document = await vscode.workspace.openTextDocument(sourceFileUri);

  // Position cursor near the requirement line
  const peekPosition = new vscode.Position(
    Math.max(0, reqData.lineNumber - 1),
    0
  );

  // Open document
  const editor = await vscode.window.showTextDocument(document, {
    viewColumn: vscode.ViewColumn.One,
    preview: false,
    preserveFocus: false,
    selection: new vscode.Range(peekPosition, peekPosition),
  });

  // Enter review mode BEFORE applying decorations
  await enterReviewMode(testId, sourceFilePath, enviroPath);

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
    viewColumn: vscode.ViewColumn.Two,
    selection: selection,
    preview: false,
    preserveFocus: false,
  });
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
