import * as vscode from "vscode";
import { dumpTestScriptFile } from "../vcastAdapter";
import { convertTestScriptContents } from "../vcastUtilities";
import { getTestNode, testNodeType } from "../testData";
import {
  getCoverageDataForFile,
  globalTestStatusArray,
} from "../vcastTestInterface";
import {
  enterReviewMode,
  exitReviewMode,
  linesRanByReviewedTests,
  reviewedTestsOnLine,
  updateDisplayedCoverage,
} from "../coverage";
import { findTestItem, runTests } from "../testPane";
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
  ranLinesFromCoverage,
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
  // Runs the check that produced this review again
  rerun?: () => Promise<void>;
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

  const body = commentBody(target);
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
  reviewThread.label = threadLabel(target);
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

function commentBody(target: ReviewTarget): vscode.MarkdownString {
  const content =
    target.tests.length === 1
      ? reviewMarkdown(target.tests[0].data)
      : groupMarkdown(target.title, target.tests);
  const body = new vscode.MarkdownString(
    staleLineMarkdown(target) + focusLineMarkdown(target.title) + content
  );
  body.supportThemeIcons = true;
  // The group comment's table
  body.supportHtml = true;
  body.isTrusted = {
    enabledCommands: [FOCUS_COMMAND, RERUN_COMMAND, REFRESH_COMMAND],
  };
  return body;
}

function threadLabel(target: ReviewTarget): string {
  const stale = target.tests.some(
    (test) => test.testId && staleTests.has(test.testId)
  );
  return `Requirements check: ${target.title}${stale ? " (out of date)" : ""}`;
}

// ---- Out-of-date checks ------------------------------------------------

// A test as its environment reported it when it was checked.
interface TestSnapshot {
  notes: string;
  time: string;
  status: string;
  passfail: string;
}

const RERUN_COMMAND = "vectorcastTestExplorer.rerunRequirementsCheck";
const REFRESH_COMMAND = "vectorcastTestExplorer.refreshReviewCoverage";
let checkedTests = new Map<string, TestSnapshot>();
let checkedEnviroPath: string | undefined;
let staleTests = new Set<string>();
// Tests whose lines and gutter were refreshed from a new run, while their
// verdicts are still those of the last check.
let coverageRefreshed = new Set<string>();

function snapshotOf(testId: string): TestSnapshot | undefined {
  const data = globalTestStatusArray[testId];
  if (!data) return undefined;
  return {
    notes: data.notes ?? "",
    time: data.time ?? "",
    status: data.status ?? "",
    passfail: data.passfail ?? "",
  };
}

/**
 * Records what a check saw of its tests, to tell later whether the
 * environment's test data changed under it. A batch check records all its
 * tests and replaces the earlier record; a single check records its one test
 * and keeps the others'.
 */
export function recordCheckedTests(
  enviroPath: string,
  testIds: string[],
  replace: boolean
): void {
  if (replace || checkedEnviroPath !== enviroPath) {
    checkedTests = new Map();
    staleTests = new Set();
    coverageRefreshed = new Set();
  }
  checkedEnviroPath = enviroPath;
  for (const testId of testIds) {
    const snapshot = snapshotOf(testId);
    if (snapshot) checkedTests.set(testId, snapshot);
    staleTests.delete(testId);
    coverageRefreshed.delete(testId);
  }
}

/**
 * After the environment's test data was reloaded: the checked tests whose
 * notes, run or result changed, or that are gone, are out of date, and the
 * open review and report say so. Called by the test pane.
 */
export function markChangedTestsStale(enviroPath: string): void {
  if (checkedEnviroPath !== enviroPath) return;
  let changed = false;
  for (const [testId, before] of checkedTests) {
    if (staleTests.has(testId)) continue;
    const now = snapshotOf(testId);
    if (
      !now ||
      now.notes !== before.notes ||
      now.time !== before.time ||
      now.status !== before.status ||
      now.passfail !== before.passfail
    ) {
      staleTests.add(testId);
      changed = true;
    }
  }
  if (!changed) return;
  if (reviewThread && currentReview) {
    reviewThread.comments = [
      { ...reviewThread.comments[0], body: commentBody(currentReview) },
    ];
    reviewThread.label = threadLabel(currentReview);
  }
  void reportPanel?.webview.postMessage({
    type: "stale",
    testIds: [...staleTests],
  });
}

// A highlighted notice at the top of a review. A comment keeps theme colors
// on an inline span only (a block's style is stripped), so the notice is a
// paragraph whose text sits on a colored span; the Markdown in it (icons,
// links) still renders.
function noticeMarkdown(background: string, content: string): string {
  return (
    `<span style="background-color:var(--vscode-inputValidation-${background});">` +
    `&nbsp;${content}&nbsp;</span>\n\n`
  );
}

// Our own button images: a comment cannot style a theme icon into a button,
// but it shows images, and data: URIs are allowed. Each is a blue rounded box
// (VS Code's default button blue) with a white symbol.
const BUTTON_BOX = "<rect width='24' height='18' rx='3' fill='#0e639c'/>";
const RERUN_TEST_SVG =
  // a circular arrow around a run triangle: run the test again
  `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='18' viewBox='0 0 24 18'>${BUTTON_BOX}` +
  "<g fill='none' stroke='#fff' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'>" +
  "<path d='M17.5 9a5.5 5.5 0 1 1-1.6-3.9'/><path d='M16.2 2.6v2.8h-2.8'/></g>" +
  "<path d='M10.6 6.6v4.8l3.8-2.4z' fill='#fff'/></svg>";
const RERUN_CHECK_SVG =
  // a requirements page with a check mark: check the test against it again
  `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='18' viewBox='0 0 24 18'>${BUTTON_BOX}` +
  "<g fill='none' stroke='#fff' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'>" +
  "<path d='M8 3h6l2.5 2.5V15H8z'/><path d='M14 3v2.5h2.5'/>" +
  "<path d='M9.8 10.2l1.7 1.7 3-3.3'/></g></svg>";

function imageButton(svg: string, command: string, tooltip: string): string {
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  // An HTML image, as only that keeps align. "absmiddle" centers it on the
  // caption's text; "middle" would center it on the text's baseline, and
  // without align it sits on the baseline.
  return `[<img src="${src}" width="24" height="18" align="absmiddle" alt="${tooltip}" title="${tooltip}">](command:${command} "${tooltip}")`;
}

// The warning at the top of a review whose tests changed since the check,
// or the note that their coverage was refreshed since. Below it one line per
// action, each button captioned with what it does: re-running the tests only
// updates the coverage, re-running the check also gets new verdicts.
function staleLineMarkdown(target: ReviewTarget): string {
  const rerunTests = `${imageButton(RERUN_TEST_SVG, REFRESH_COMMAND, "Run the tests again and update the lines and the gutter; the verdicts stay")} &nbsp;Re-run the test`;
  const rerunCheck = target.rerun
    ? `${imageButton(RERUN_CHECK_SVG, RERUN_COMMAND, "Check again with tests2check, with new verdicts; takes longer")} &nbsp;Re-run test check against requirements`
    : "";
  const actions = (lines: string[]) =>
    lines
      .filter((line) => line)
      .map((line) => `&nbsp;&nbsp;${line}\n\n`)
      .join("");
  const changed = target.tests.filter(
    (test) => test.testId && staleTests.has(test.testId)
  );
  if (changed.length) {
    const names = changed.map((test) => test.data.title).join(", ");
    return (
      noticeMarkdown(
        "warningBackground",
        `$(warning) **Out of date:** ${names} changed since this check.`
      ) + actions([rerunTests, rerunCheck])
    );
  }
  const refreshed = target.tests.filter(
    (test) => test.testId && coverageRefreshed.has(test.testId)
  );
  if (refreshed.length) {
    const names = refreshed.map((test) => test.data.title).join(", ");
    return (
      noticeMarkdown(
        "infoBackground",
        `$(info) **Coverage refreshed:** ${names} ran again; the verdicts are still from the last check.`
      ) + actions([rerunCheck])
    );
  }
  return "";
}

/**
 * The comment's "Refresh the coverage only" link: runs the reviewed tests
 * the normal way, then recolors the requirements' lines and the gutter from
 * their new coverage. The verdicts, which need tests2check, stay.
 */
export async function refreshReviewCoverage(
  context: vscode.ExtensionContext
): Promise<void> {
  const review = currentReview;
  if (!review) return;
  const items = review.tests.flatMap((test) => {
    const item = test.testId ? findTestItem(test.testId) : undefined;
    return item ? [item] : [];
  });
  if (items.length === 0) {
    vscode.window.showInformationMessage(
      "None of the reviewed tests is in the test tree, so there is nothing to run."
    );
    return;
  }
  const cancellation = new vscode.CancellationTokenSource();
  try {
    await runTests(new vscode.TestRunRequest(items), cancellation.token);
  } finally {
    cancellation.dispose();
  }

  // The run reloaded the test data, which marked these tests out of date;
  // with their coverage read anew they are current again, verdicts apart.
  const testIds = items.map((item) => item.id);
  recordCheckedTests(review.enviroPath, testIds, false);
  for (const testId of testIds) coverageRefreshed.add(testId);

  // Shows the review again, which reads the new per-test coverage, then
  // recolors the requirements' lines from it.
  await openReview(review, context);
  const ran = linesRanByReviewedTests();
  const summary = getCoverageDataForFile(review.sourcePath);
  const coverable = new Set([
    ...summary.covered,
    ...summary.uncovered,
    ...summary.partiallyCovered,
  ]);
  for (const test of review.tests) {
    if (!test.testId || !ran.has(test.testId)) continue;
    test.data.ranLines = ranLinesFromCoverage(
      test.data.expectedLines,
      ran.get(test.testId)!,
      coverable
    );
  }
  const editor = vscode.window.visibleTextEditors.find(
    (candidate) =>
      candidate.document.uri.fsPath.toLowerCase() ===
      review.sourcePath.toLowerCase()
  );
  if (editor) {
    highlightCriticalLines(
      editor,
      editor.document,
      review.tests.map((test) => test.data)
    );
  }
  if (reviewThread) {
    reviewThread.comments = [
      { ...reviewThread.comments[0], body: commentBody(review) },
    ];
    reviewThread.label = threadLabel(review);
  }
  // Whatever got the focus meanwhile, the reviewed file shows the new coverage.
  await updateDisplayedCoverage();
}

/** The comment's re-run link. */
export async function rerunReview(): Promise<void> {
  await currentReview?.rerun?.();
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
  await closeReviewScript();
}

// The test script the review opened beside the source, to close with it.
let reviewScriptUri: vscode.Uri | undefined;

async function closeReviewScript(): Promise<void> {
  const uri = reviewScriptUri;
  reviewScriptUri = undefined;
  if (!uri) return;
  const tabs = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter(
      (tab) =>
        tab.input instanceof vscode.TabInputText &&
        tab.input.uri.toString() === uri.toString()
    );
  if (tabs.length) await vscode.window.tabGroups.close(tabs, true);
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
      rerun: currentReview.rerun,
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
  reviewScriptUri = tstScriptUri;
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
  functionStartLine: number = 0,
  subunitFile?: string
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
    functionStartLine,
    subunitFile
  );
}

/**
 * Checks the linked tests among `testNames`, or every linked test of the
 * environment when there are none, and returns tests2check's results, or null
 * (after telling the user why) when there are none.
 *
 * Tests are picked by name, not with tests2check's -u/-s: those select the
 * requirements traced to a unit or function, so they miss tests whose
 * requirements carry no tracing (an imported gateway) and pick up tests
 * elsewhere that are linked to this function's requirements.
 */
export async function fetchRequirementChecks(
  enviroPath: string,
  gatewayPath: string,
  testNames: string[] | undefined,
  what: string
): Promise<any[] | null> {
  const selector = testNames?.length
    ? ["-t", [...new Set(testNames)].join(";"), "-F"]
    : [];
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
  // "Re-run check" on an out-of-date report
  rerun: () => Promise<void>;
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
        if (message?.type === "rerun") void reportHandlers.rerun();
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
