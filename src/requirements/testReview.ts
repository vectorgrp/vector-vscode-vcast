import * as vscode from "vscode";
import { dumpTestScriptFile } from "../vcastAdapter";
import { convertTestScriptContents } from "../vcastUtilities";
import { getTestNode, testNodeType } from "../testData";
import {
  enterReviewMode,
  exitReviewMode,
  reviewedTestsOnLine,
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
  groupMarkdown,
  lastToolError,
  lineHoverMarkdown,
  LineRunner,
  parseTests2checkResult,
  RequirementData,
  ReviewedTest,
  reviewLineColors,
  reviewMarkdown,
} from "./testReviewData";
import { checkReportHtml, ReportGroup } from "./testReviewReport";
import { getNonce } from "../webviewUtils";

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
 * Highlights the code the requirements need, by whether the reviewed tests
 * ran it (tests2check's ran_lines, not the coverage of all tests)
 */
export function highlightCriticalLines(
  editor: vscode.TextEditor,
  document: vscode.TextDocument,
  reqData: RequirementData | RequirementData[]
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

// What a review shows: one test, or the tests of a function or unit.
export interface ReviewTarget {
  title: string;
  // 1-based line the comment sits at (the function's first line), 0 for the top
  lineNumber: number;
  sourcePath: string;
  enviroPath: string;
  tests: ReviewedTest[];
}

// The command a hover's test links run: this test's review alone.
export const FOCUS_REVIEW_TEST_COMMAND =
  "vectorcastTestExplorer.focusReviewTest";

let reviewComments: vscode.CommentController | undefined;
let reviewThread: vscode.CommentThread | undefined;
let currentReview: ReviewTarget | undefined;

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
  target: ReviewTarget,
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

  const content =
    target.tests.length === 1
      ? reviewMarkdown(target.tests[0].data)
      : groupMarkdown(target.title, target.tests);
  const body = new vscode.MarkdownString(
    focusLineMarkdown(target.title) + content
  );
  body.supportThemeIcons = true;
  // The group comment's table
  body.supportHtml = true;
  body.isTrusted = { enabledCommands: [FOCUS_COMMAND] };
  // VS Code opens its Comments view the first time it shows a thread with
  // comments unless comments.openView says otherwise; the extension sets that
  // default to "never" (package.json), since the review should only jump to
  // the comment in the source. Creating the thread empty, with the comment
  // following, keeps the view closed where a user chose "firstFile" and the
  // widget shows before the comment arrives.
  reviewThread = reviewComments.createCommentThread(
    sourceFileUri,
    new vscode.Range(line, 0, line, 0),
    []
  );
  reviewThread.label = `Requirements check: ${target.title}`;
  reviewThread.canReply = false;
  reviewThread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
  reviewThread.comments = [
    {
      body,
      mode: vscode.CommentMode.Preview,
      author: {
        name: "AI-generated requirements check. Review before relying on it.",
      },
    },
  ];
}

// What the review can be focused on: the units, functions and tests of the
// last batch check. Empty after a single check from the test tree.
export interface FocusChoice {
  kind: "unit" | "function" | "test";
  label: string;
  description: string;
  target: ReviewTarget;
  // The test whose script opens beside the source
  scriptOf?: testNodeType;
}

// "Focus on": the command of the thread's title button and of the line at the
// top of the comment; it shows after a batch check, which gives choices.
const FOCUS_COMMAND = "vectorcastTestExplorer.focusReview";
const FOCUS_CHOICES_CONTEXT = "vectorcastTestExplorer.reviewFocusChoices";
let focusChoices: FocusChoice[] = [];

export function setFocusChoices(choices: FocusChoice[]): void {
  focusChoices = choices;
  void vscode.commands.executeCommand(
    "setContext",
    FOCUS_CHOICES_CONTEXT,
    choices.length > 1
  );
}

const CHOICE_ICONS: Record<FocusChoice["kind"], string> = {
  unit: "symbol-file",
  function: "symbol-method",
  test: "beaker",
};

// The button's look; exactly the form VS Code's sanitizer keeps in a
// comment: color, then background-color, theme variables only.
const SHOWN_STYLE =
  ' style="color:var(--vscode-button-foreground);background-color:var(--vscode-button-background);"';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// What the review shows, as a heading, and a button-colored swap icon that
// opens the picker; the title button alone is easy to miss.
function focusLineMarkdown(shownTitle: string): string {
  if (focusChoices.length < 2) return "";
  return (
    `### Focus on: ${escapeHtml(shownTitle)} ` +
    `<span${SHOWN_STYLE}>&nbsp;[$(arrow-swap)](command:${FOCUS_COMMAND} "Change the unit, function or test the requirements check shows")&nbsp;</span>\n\n`
  );
}

/**
 * "Focus on": lets the user pick a unit, function or test of the last batch
 * check and shows its review, with the coverage of just that.
 */
export async function pickReviewFocus(
  context: vscode.ExtensionContext
): Promise<void> {
  if (focusChoices.length === 0) return;
  const items = focusChoices.map((choice) => ({
    label: `$(${CHOICE_ICONS[choice.kind]}) ${choice.label}`,
    description: choice.description,
    choice,
  }));
  const current = items.find(
    (item) => item.choice.target.title === currentReview?.title
  );
  const quickPick = vscode.window.createQuickPick<(typeof items)[number]>();
  quickPick.title = "Focus the requirements check on";
  quickPick.placeholder = "A unit, a function or a single test";
  quickPick.matchOnDescription = true;
  quickPick.items = items;
  if (current) quickPick.activeItems = [current];
  const picked = await new Promise<FocusChoice | undefined>((resolve) => {
    quickPick.onDidAccept(() => {
      resolve(quickPick.selectedItems[0]?.choice);
      quickPick.hide();
    });
    quickPick.onDidHide(() => {
      resolve(undefined);
      quickPick.dispose();
    });
    quickPick.show();
  });
  if (!picked) return;
  await openReview(picked.target, context);
  if (picked.scriptOf) {
    await openTstScriptAtTest(
      picked.scriptOf,
      picked.target.enviroPath + ".tst"
    );
  }
}

/**
 * Ends the review: removes its comment and highlights and shows the coverage
 * of all tests again.
 */
export async function endReview(): Promise<void> {
  reviewThread?.dispose();
  reviewThread = undefined;
  currentReview = undefined;
  setFocusChoices([]);
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
 * Opens the source file with the review's comment and highlighting, and the
 * reviewed tests' coverage in the gutter. Returns whether the gutter shows
 * that coverage; if it could not be read, or none of the tests was found in
 * the test tree, it keeps showing the coverage of all tests.
 */
export async function openReview(
  target: ReviewTarget,
  context: vscode.ExtensionContext
): Promise<boolean> {
  const sourceFileUri = vscode.Uri.file(target.sourcePath);
  const document = await vscode.workspace.openTextDocument(sourceFileUri);

  // Position cursor near the requirement line
  const reviewPosition = new vscode.Position(
    Math.max(0, target.lineNumber - 1),
    0
  );

  // Open document
  const editor = await vscode.window.showTextDocument(document, {
    viewColumn: vscode.ViewColumn.One,
    preview: false,
    preserveFocus: false,
    selection: new vscode.Range(reviewPosition, reviewPosition),
  });
  // The comment hangs below this line: centered, it stays in view.
  editor.revealRange(
    new vscode.Range(reviewPosition, reviewPosition),
    vscode.TextEditorRevealType.InCenter
  );

  // The comment's close button is the only way out of review mode, so the
  // comment comes first, and a failure anywhere ends the review again rather
  // than leaving the gutter on one test's coverage.
  try {
    showReviewThread(sourceFileUri, reviewPosition.line, target, context);
    currentReview = target;
    highlightCriticalLines(
      editor,
      document,
      target.tests.map((test) => test.data)
    );
    const testIds = target.tests.flatMap((test) =>
      test.testId ? [test.testId] : []
    );
    let perTestCoverageShown = false;
    if (testIds.length) {
      perTestCoverageShown = await enterReviewMode(
        testIds,
        target.sourcePath,
        target.enviroPath
      );
      if (!perTestCoverageShown) {
        vscode.window.showWarningMessage(
          "The coverage of the reviewed tests alone could not be read, so the gutter keeps showing the coverage of all tests. See the VectorCAST Test Explorer log for the reason."
        );
      }
    } else {
      await exitReviewMode();
      vscode.window.showWarningMessage(
        `${target.title} was not found in the test tree, so the gutter shows the coverage of all tests.`
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
 * Narrows the review to one of its tests: the hover links' command.
 */
export async function focusReviewTest(
  testId: string,
  context: vscode.ExtensionContext
): Promise<void> {
  const test = currentReview?.tests.find(
    (candidate) => candidate.testId === testId
  );
  if (!currentReview || !test) return;
  await openReview(
    {
      title: test.data.title,
      lineNumber: currentReview.lineNumber,
      sourcePath: currentReview.sourcePath,
      enviroPath: currentReview.enviroPath,
      tests: [test],
    },
    context
  );
  const testNode = getTestNode(testId);
  if (testNode) {
    await openTstScriptAtTest(testNode, currentReview.enviroPath + ".tst");
  }
}

/**
 * While a review is open, hovering a line of its file says whether the
 * requirements under review need it and which of the reviewed tests ran it.
 */
export function registerReviewHover(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { scheme: "file" },
      {
        provideHover(document, position) {
          const review = currentReview;
          if (
            !review ||
            document.uri.fsPath.toLowerCase() !==
              review.sourcePath.toLowerCase()
          )
            return undefined;
          const line = position.line + 1;
          const ran: LineRunner[] = reviewedTestsOnLine(line).map(
            ({ name, status }) => {
              const testId = `vcast:${review.enviroPath}|${name}`;
              const test = review.tests.find(
                (candidate) => candidate.testId === testId
              );
              return { title: test?.data.title ?? name, status, testId };
            }
          );
          const markdown = lineHoverMarkdown(ran, FOCUS_REVIEW_TEST_COMMAND);
          if (!markdown) return undefined;
          const body = new vscode.MarkdownString(markdown);
          body.isTrusted = { enabledCommands: [FOCUS_REVIEW_TEST_COMMAND] };
          return new vscode.Hover(body);
        },
      }
    )
  );
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
 * Runs tests2check on the tests `selector` picks (its -t/-u/-s arguments;
 * none for every test of the environment), which executes them, and returns
 * its results, or null (after telling the user why) when there are none to
 * show. `what` names the checked tests in the messages.
 */
async function runTests2check(
  enviroPath: string,
  gatewayPath: string,
  selector: string[],
  what: string
): Promise<any[] | null> {
  return vscode.window.withProgress<any[] | null>(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Checking ${what} against requirements`,
      cancellable: true,
    },
    async (_progress, cancellationToken) => {
      // tests2check executes the tests with clicast, so in server mode the
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
            ...selector,
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
            `Cannot check ${what}: ${lastToolError(stderr ?? "")}`
          );
          logCliError(stderr ?? "");
          return null;
        }

        const results = JSON.parse(stdout ?? "");
        if (!Array.isArray(results) || results.length === 0) {
          vscode.window.showWarningMessage(
            `tests2check returned no result for ${what}.`
          );
          return null;
        }
        return results;
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

/**
 * Checks one test, which executes it, and returns what the review shows, or
 * null (after telling the user why) when there is nothing to review.
 */
export async function fetchRequirementCoverageData(
  enviroPath: string,
  gatewayPath: string,
  testName: string,
  unitName: string,
  functionStartLine: number = 0
): Promise<RequirementData | null> {
  const results = await runTests2check(
    enviroPath,
    gatewayPath,
    ["-t", testName, "-F"],
    testName
  );
  if (!results) return null;

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
}

/**
 * Checks every linked test of the environment, or of the given unit or
 * function, and returns tests2check's results, or null (after telling the
 * user why) when there are none.
 */
export async function fetchRequirementChecks(
  enviroPath: string,
  gatewayPath: string,
  scope: { unitName?: string; functionName?: string },
  what: string
): Promise<any[] | null> {
  const selector: string[] = [];
  if (scope.unitName) selector.push("-u", scope.unitName);
  if (scope.functionName) selector.push("-s", scope.functionName);
  if (selector.length) selector.push("-F");
  return runTests2check(enviroPath, gatewayPath, selector, what);
}

// The one report panel, reused by every batch check.
let reportPanel: vscode.WebviewPanel | undefined;
let reportHandlers: CheckReportHandlers | undefined;

/** Brings the last report back, if there is one. */
export function revealCheckReport(): void {
  reportPanel?.reveal();
}

export interface CheckReportHandlers {
  // "Open review" on a test
  openReview: (testId: string) => Promise<void>;
  // "Review" on a unit (no function name) or a function
  openGroupReview: (unitName: string, functionName?: string) => Promise<void>;
}

/**
 * Shows the verdicts of a batch check, grouped by function, in a webview;
 * its buttons call the handlers.
 */
export function showCheckReport(
  context: vscode.ExtensionContext,
  scope: string,
  groups: ReportGroup[],
  handlers: CheckReportHandlers
): void {
  reportHandlers = handlers;
  if (!reportPanel) {
    reportPanel = vscode.window.createWebviewPanel(
      "vectorcastRequirementsCheck",
      "Requirements check",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    reportPanel.onDidDispose(
      () => {
        reportPanel = undefined;
      },
      null,
      context.subscriptions
    );
    reportPanel.webview.onDidReceiveMessage(
      (message) => {
        if (!reportHandlers) return;
        if (
          message?.type === "open-review" &&
          typeof message.testId === "string"
        )
          void reportHandlers.openReview(message.testId);
        if (
          message?.type === "open-group-review" &&
          typeof message.unitName === "string"
        )
          void reportHandlers.openGroupReview(
            message.unitName,
            typeof message.functionName === "string"
              ? message.functionName
              : undefined
          );
      },
      undefined,
      context.subscriptions
    );
  }
  reportPanel.title = `Requirements check: ${scope}`;
  reportPanel.webview.html = checkReportHtml({
    scope,
    groups,
    nonce: getNonce(),
    cspSource: reportPanel.webview.cspSource,
  });
  reportPanel.reveal();
}
