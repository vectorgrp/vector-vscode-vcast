import * as vscode from "vscode";
import { dumpTestScriptFile } from "../vcastAdapter";
import {
  convertTestScriptContents,
  getEnvironmentData,
} from "../vcastUtilities";
import { compoundOnlyString, testNodeCache, testNodeType } from "../testData";
import { updateDataForEnvironment } from "../testPane";
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
import { findRelevantRequirementGateway } from "./rgwPath";
import {
  findTestLine,
  lastToolError,
  parseTests2checkResult,
  RequirementData,
  requirementFailures,
  reviewLineColors,
  reviewMarkdown,
} from "./testReviewData";

const path = require("path");

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
 * Opens the test script beside the source, at the test. A fresh check writes the
 * script for this test alone; a stored one opens the script its batch check
 * wrote, which its problems point into.
 */
async function openTstScriptAtTest(
  testNode: testNodeType,
  fresh: boolean
): Promise<void> {
  const scriptPath = testNode.enviroPath + ".tst";
  if (fresh) {
    clearRequirementsProblems(testNode.enviroPath);
    const commandStatus = await dumpTestScriptFile(testNode, scriptPath);
    if (commandStatus.errorCode !== 0) return;
    convertTestScriptContents(scriptPath);
  }

  const tstDocument = await vscode.workspace.openTextDocument(
    vscode.Uri.file(scriptPath)
  );
  const line = findTestLine(
    tstDocument.getText(),
    testNode.unitName,
    testNode.functionName,
    testNode.testName
  );
  const position = new vscode.Position(line, 0);
  await vscode.window.showTextDocument(tstDocument, {
    viewColumn: vscode.ViewColumn.Two,
    selection: new vscode.Range(position, position),
    preview: false,
    preserveFocus: false,
  });
}

/**
 * The unit's source file and the line its function starts on (0 when there is
 * no function), from the environment's data; undefined after telling the user.
 */
function unitSource(
  envData: any,
  unitName: string,
  functionName: string
): { path: string; functionLine: number } | undefined {
  const unit = envData?.unitData?.find(
    (candidate: { path: string }) =>
      candidate.path &&
      path.basename(candidate.path, path.extname(candidate.path)) === unitName
  );
  if (!unit?.path) {
    vscode.window.showWarningMessage(
      `Could not find source file for unit: ${unitName}`
    );
    return undefined;
  }

  const fn = unit.functionList?.find(
    (candidate: { name: string; startLine?: number }) =>
      candidate.name === functionName && candidate.startLine !== undefined
  );
  return { path: unit.path, functionLine: fn?.startLine ?? 0 };
}

/**
 * Shows a test's requirements check: the source with the lines the requirements
 * need highlighted and the check as a comment, and the test script beside it.
 */
async function showRequirementsCheck(
  context: vscode.ExtensionContext,
  testId: string,
  testNode: testNodeType,
  reqData: RequirementData,
  sourcePath: string,
  fresh: boolean
): Promise<void> {
  // Close the sidebar for more screen space
  await vscode.commands.executeCommand("workbench.action.closeSidebar");
  const switchingTests = reviewInProgress();
  const perTestCoverageShown = await openSourceFileWithHighlight(
    sourcePath,
    reqData,
    context,
    testId,
    testNode.enviroPath
  );
  await openTstScriptAtTest(testNode, fresh);

  if (!switchingTests && perTestCoverageShown) {
    vscode.window.showWarningMessage(
      `Only ${testNode.testName}'s coverage is shown while its requirements check is open. Close the comment to see all coverage again.`
    );
  }
}

/**
 * Runs tests2check, which executes the tests, on the tests ``selection`` picks,
 * and returns its results, or null after telling the user why there are none.
 * ``what`` names the tests in those messages.
 */
async function runTests2check(
  enviroPath: string,
  gatewayPath: string,
  selection: string[],
  what: string,
  title: string
): Promise<any[] | null> {
  return vscode.window.withProgress<any[] | null>(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: true,
    },
    async (_progress, cancellationToken) => {
      // tests2check executes the tests with clicast, so in server mode the
      // server must not hold the environment open meanwhile.
      if (globalEnviroDataServerActive) await closeConnection(enviroPath);
      try {
        const { stdout, stderr, exitCode, cancelled } = await runReqs2xTool({
          exe: TESTS2CHECK_EXECUTABLE_PATH,
          // The check shows passing tests too.
          args: [
            "-e",
            enviroPath,
            gatewayPath,
            ...selection,
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
          // tests2check says why, e.g. that no test is linked to a requirement.
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
 * Checks one test against its requirements, which executes it, and shows the
 * check.
 */
export async function checkTestAgainstRequirements(
  context: vscode.ExtensionContext,
  testId: string,
  testNode: testNodeType
): Promise<void> {
  const { enviroPath, unitName, functionName, testName } = testNode;
  const envData = await getEnvironmentData(enviroPath);
  const gatewayPath = findRelevantRequirementGateway(enviroPath);
  if (!envData?.unitData || !gatewayPath) {
    vscode.window.showWarningMessage(
      "Failed to retrieve environment test data. Aborting the requirements check."
    );
    return;
  }

  const source = unitSource(envData, unitName, functionName);
  if (!source) return;

  const results = await runTests2check(
    enviroPath,
    gatewayPath,
    ["-t", testName, "-F"],
    testName,
    "Checking test against requirements"
  );
  // tests2check executed the test, so its status and coverage changed.
  await updateDataForEnvironment(enviroPath);
  if (!results) return;

  // -t matches test names across the whole environment.
  if (results.length > 1) {
    vscode.window.showInformationMessage(
      `More than one test in this environment is named ${testName}, so the requirements check cannot tell which one to check.`
    );
    return;
  }

  const reqData = parseTests2checkResult(
    results[0],
    testName,
    unitName,
    source.functionLine
  );
  await showRequirementsCheck(
    context,
    testId,
    testNode,
    reqData,
    source.path,
    true
  );
}

// What a batch check found: its problems on the tests in the environment's
// script, and the check of each failing test, by the script line its problems
// are on, for their quick fix.
let requirementsProblems: vscode.DiagnosticCollection | undefined;
const problemSource = "Requirements check";

interface StoredCheck {
  testId: string;
  testNode: testNodeType;
  reqData: RequirementData;
  sourcePath: string;
}
const storedChecks = new Map<string, StoredCheck>();
const storedCheckKey = (scriptPath: string, line: number) =>
  `${vscode.Uri.file(scriptPath).fsPath}:${line}`;

function clearRequirementsProblems(enviroPath: string): void {
  const scriptPath = vscode.Uri.file(enviroPath + ".tst").fsPath;
  requirementsProblems?.delete(vscode.Uri.file(scriptPath));
  for (const key of [...storedChecks.keys()]) {
    if (key.startsWith(scriptPath + ":")) storedChecks.delete(key);
  }
}

/**
 * Registers the Problems entries of batch checks and their quick fix, which
 * shows the stored check of the failing test.
 */
export function registerRequirementsProblems(
  context: vscode.ExtensionContext
): void {
  requirementsProblems =
    vscode.languages.createDiagnosticCollection(problemSource);
  context.subscriptions.push(
    requirementsProblems,
    vscode.languages.registerCodeActionsProvider(
      { pattern: "**/*.tst" },
      {
        provideCodeActions(document, _range, codeActionContext) {
          const lines = new Set(
            codeActionContext.diagnostics
              .filter((diagnostic) => diagnostic.source === problemSource)
              .map((diagnostic) => diagnostic.range.start.line)
          );
          return [...lines].flatMap((line) => {
            const key = storedCheckKey(document.uri.fsPath, line);
            const stored = storedChecks.get(key);
            if (!stored) return [];
            const action = new vscode.CodeAction(
              `Show the requirements check for ${stored.testNode.testName}`,
              vscode.CodeActionKind.QuickFix
            );
            action.command = {
              command: "vectorcastTestExplorer.showStoredRequirementsCheck",
              title: action.title,
              arguments: [key],
            };
            return [action];
          });
        },
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    ),
    vscode.commands.registerCommand(
      "vectorcastTestExplorer.showStoredRequirementsCheck",
      async (key: string) => {
        const stored = storedChecks.get(key);
        if (stored) {
          await showRequirementsCheck(
            context,
            stored.testId,
            stored.testNode,
            stored.reqData,
            stored.sourcePath,
            false
          );
        }
      }
    )
  );
}

// The tests below an environment, unit or function node, by node ID, that a
// requirements check can run on their own.
function testsBelow(node: testNodeType): Map<string, testNodeType> {
  const tests = new Map<string, testNodeType>();
  for (const [testId, test] of testNodeCache.entries() as Iterable<
    [string, testNodeType]
  >) {
    if (
      test.testName &&
      test.enviroPath === node.enviroPath &&
      (!node.unitName || test.unitName === node.unitName) &&
      (!node.functionName || test.functionName === node.functionName) &&
      !testId.includes("<<COMPOUND>>") &&
      !testId.includes("<<INIT>>") &&
      !testId.includes("coded_tests_driver") &&
      !test.testName.endsWith(compoundOnlyString)
    ) {
      tests.set(testId, test);
    }
  }
  return tests;
}

/**
 * Checks every test below an environment, unit or function node against its
 * requirements, which executes them. Each requirement a test fails becomes a
 * problem on the test in the environment's script, whose quick fix shows that
 * test's check.
 */
export async function checkTestsBelowAgainstRequirements(
  node: testNodeType
): Promise<void> {
  const scope = node.functionName || node.unitName || node.enviroName;
  const gatewayPath = findRelevantRequirementGateway(node.enviroPath);
  const envData = await getEnvironmentData(node.enviroPath);
  if (!envData?.unitData || !gatewayPath) {
    vscode.window.showWarningMessage(
      "Failed to retrieve environment test data. Aborting the requirements check."
    );
    return;
  }

  if (!node.unitName) {
    const choice = await vscode.window.showWarningMessage(
      `Check every test of ${scope} against its requirements? This runs each test and asks the language model about each linked requirement, which takes a while and costs tokens.`,
      { modal: true },
      "Check"
    );
    if (choice !== "Check") return;
  }

  const tests = testsBelow(node);
  if (tests.size === 0) {
    vscode.window.showInformationMessage(`${scope} has no tests to check.`);
    return;
  }

  // A whole environment needs no list, which could outgrow a command line.
  const names = [...new Set([...tests.values()].map((test) => test.testName))];
  const selection = node.unitName ? ["-t", names.join(";"), "-F"] : [];
  clearRequirementsProblems(node.enviroPath);
  const results = await runTests2check(
    node.enviroPath,
    gatewayPath,
    selection,
    `the tests of ${scope}`,
    `Checking the tests of ${scope} against requirements`
  );
  // tests2check executed the tests, so their status and coverage changed.
  await updateDataForEnvironment(node.enviroPath);
  if (!results) return;

  // -t matches test names across the whole environment.
  const idOf = (result: any) =>
    `vcast:${node.enviroPath}|${result.unit}.${result.subprogram}.${result.name}`;
  const checked = results.filter((result) => tests.has(idOf(result)));

  const scriptPath = node.enviroPath + ".tst";
  if ((await dumpTestScriptFile(node, scriptPath)).errorCode !== 0) return;
  convertTestScriptContents(scriptPath);
  const script = (
    await vscode.workspace.openTextDocument(vscode.Uri.file(scriptPath))
  ).getText();

  const problems: vscode.Diagnostic[] = [];
  for (const failure of requirementFailures(checked)) {
    const line = findTestLine(
      script,
      failure.unit,
      failure.subprogram,
      failure.name
    );
    const problem = new vscode.Diagnostic(
      new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
      `${failure.name} fails ${failure.key}: ${failure.explanation}`,
      vscode.DiagnosticSeverity.Error
    );
    problem.source = problemSource;
    problems.push(problem);

    const key = storedCheckKey(scriptPath, line);
    const result = checked.find((test) => idOf(test) === idOf(failure));
    const source = unitSource(envData, failure.unit, failure.subprogram);
    if (!storedChecks.has(key) && result && source) {
      storedChecks.set(key, {
        testId: idOf(failure),
        testNode: tests.get(idOf(failure))!,
        reqData: parseTests2checkResult(
          result,
          failure.name,
          failure.unit,
          source.functionLine
        ),
        sourcePath: source.path,
      });
    }
  }
  requirementsProblems?.set(vscode.Uri.file(scriptPath), problems);

  const passed = checked.filter((result) => result.verdict === "PASS").length;
  const failed = checked.length - passed;
  const summary = `Requirements check of ${scope}: ${passed} of ${checked.length} tests pass.`;
  if (failed === 0) {
    vscode.window.showInformationMessage(summary);
  } else if (
    (await vscode.window.showWarningMessage(
      `${summary} The failures are in the Problems view.`,
      "Show Problems"
    )) === "Show Problems"
  ) {
    await vscode.commands.executeCommand("workbench.actions.view.problems");
  }
}
