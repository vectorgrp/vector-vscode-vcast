import * as vscode from "vscode";
import { dumpTestScriptFile } from "../vcastAdapter";
import { convertTestScriptContents } from "../vcastUtilities";
import { testNodeType } from "../testData";
import {
  enterReviewMode,
  exitReviewMode,
  updateDisplayedCoverage,
} from "../coverage";
import {
  closeConnection,
  globalEnviroDataServerActive,
} from "../../src-common/vcastServer";
import { logCliError } from "./requirementsLog";
import { runReqs2xTool } from "./processRunner";
import { TESTS2CHECK_EXECUTABLE_PATH } from "./requirementsExecutables";
import {
  lastToolError,
  parseTests2checkResult,
  RequirementData,
  reviewLineColors,
  reviewMarkdown,
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
 * Highlights the code the requirement needs, by whether this test ran it
 * (tests2check's ran_lines, not the coverage of all tests)
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

let reviewComments: vscode.CommentController | undefined;
let reviewThread: vscode.CommentThread | undefined;

export function reviewInProgress(): boolean {
  return reviewThread !== undefined;
}

/**
 * Shows the review as a comment thread on the given line, replacing the
 * previous review's thread.
 */
function showReviewThread(
  sourceFileUri: vscode.Uri,
  line: number,
  reqData: RequirementData,
  context: vscode.ExtensionContext
): void {
  if (!reviewComments) {
    reviewComments = vscode.comments.createCommentController(
      "vectorcastTestReview",
      "Requirements Check"
    );
    context.subscriptions.push(reviewComments);
  }
  reviewThread?.dispose();

  const body = new vscode.MarkdownString(reviewMarkdown(reqData));
  reviewThread = reviewComments.createCommentThread(
    sourceFileUri,
    new vscode.Range(line, 0, line, 0),
    [
      {
        body,
        mode: vscode.CommentMode.Preview,
        author: {
          name: "AI-generated requirements check. Review before relying on it.",
        },
      },
    ]
  );
  reviewThread.label = `Requirements check: ${reqData.title}`;
  reviewThread.canReply = false;
  reviewThread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
}

/**
 * Ends the review: removes its comment and highlights and shows the coverage
 * of all tests again.
 */
export async function endReview(): Promise<void> {
  reviewThread?.dispose();
  reviewThread = undefined;
  disposeCriticalLineDecorations();
  await exitReviewMode();
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
 * Opens the source file with requirement highlighting. Returns whether the
 * gutter shows the test's own coverage; if that could not be read it keeps
 * showing the coverage of all tests.
 */
export async function openSourceFileWithHighlight(
  sourceFilePath: string,
  reqData: RequirementData,
  context: vscode.ExtensionContext,
  testId: string,
  enviroPath: string
): Promise<boolean> {
  const sourceFileUri = vscode.Uri.file(sourceFilePath);
  const document = await vscode.workspace.openTextDocument(sourceFileUri);

  // Position cursor near the requirement line
  const reviewPosition = new vscode.Position(
    Math.max(0, reqData.lineNumber - 1),
    0
  );

  // Open document
  const editor = await vscode.window.showTextDocument(document, {
    viewColumn: vscode.ViewColumn.One,
    preview: false,
    preserveFocus: false,
    selection: new vscode.Range(reviewPosition, reviewPosition),
  });

  // The comment's close button is the only way out of review mode, so the
  // comment comes first, and a failure anywhere ends the review again rather
  // than leaving the gutter on one test's coverage.
  try {
    showReviewThread(sourceFileUri, reviewPosition.line, reqData, context);
    highlightCriticalLines(editor, document, reqData);
    const perTestCoverageShown = await enterReviewMode(
      testId,
      sourceFilePath,
      enviroPath
    );
    if (!perTestCoverageShown) {
      vscode.window.showWarningMessage(
        "The coverage of this test alone could not be read, so the gutter keeps showing the coverage of all tests. See the VectorCAST Test Explorer log for the reason."
      );
    }
    // Update coverage decorations to show review mode coverage
    await updateDisplayedCoverage();
    return perTestCoverageShown;
  } catch (error) {
    await endReview();
    throw error;
  }
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
 * Runs tests2check for one test, which executes it, and returns what the
 * review shows, or null (after telling the user why) when there is nothing to
 * review.
 */
export async function fetchRequirementCoverageData(
  enviroPath: string,
  gatewayPath: string,
  testName: string,
  unitName: string,
  functionStartLine: number = 0
): Promise<RequirementData | null> {
  return vscode.window.withProgress<RequirementData | null>(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Checking test against requirements",
      cancellable: true,
    },
    async (_progress, cancellationToken) => {
      // tests2check executes the test with clicast, so in server mode the
      // server must not hold the environment open meanwhile.
      if (globalEnviroDataServerActive) await closeConnection(enviroPath);
      try {
        const { stdout, stderr, exitCode, cancelled } = await runReqs2xTool({
          exe: TESTS2CHECK_EXECUTABLE_PATH,
          // The review needs the result even when the test passes.
          args: [
            "-e",
            enviroPath,
            gatewayPath,
            "-t",
            testName,
            "-F",
            "--json",
            "--no-failures-only",
          ],
          llm: true,
          captureOutput: true,
          allowNonZeroExit: true,
          cancellationToken,
        });
        if (cancelled) return null;
        if (exitCode !== 0) {
          // tests2check says why, e.g. that the test is linked to no requirement.
          vscode.window.showWarningMessage(
            `Cannot check ${testName}: ${lastToolError(stderr ?? "")}`
          );
          logCliError(stderr ?? "");
          return null;
        }

        const results = JSON.parse(stdout ?? "");
        if (!Array.isArray(results) || results.length === 0) {
          vscode.window.showWarningMessage(
            `tests2check returned no result for ${testName}.`
          );
          return null;
        }

        // -t matches test names across the whole environment.
        if (results.length > 1) {
          vscode.window.showInformationMessage(
            `More than one test in this environment is named ${testName}, so the requirements check cannot tell which one to check.`
          );
          return null;
        }

        return parseTests2checkResult(
          results[0],
          testName,
          unitName,
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
