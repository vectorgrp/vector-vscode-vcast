// Which tests a person reviewed, and which need review.
//
// VectorCAST flags a test as needing review when a requirement it is linked
// to changed since. It keeps the flag in the requirements gateway and sets it
// when it imports a changed requirement; a person who checked that the test
// still fits the requirement clears it by marking the test as reviewed.
//
// Any other test can be marked as reviewed too. VectorCAST has no place for
// that, so the mark is the extension's own, kept with the workspace. It
// stays until it is taken back, the test is gone, or a changed requirement
// flags the test.
//
// This module reads the flags, keeps the marks, shows the flags in the test
// tree and marks tests as reviewed.

import * as vscode from "vscode";
import {
  compoundOnlyString,
  getClicastArgsFromTestNodeAsList,
  getTestNode,
  testNodeCache,
  testNodeType,
} from "../testData";
import { findTestItem, makeEnviroNodeID } from "../testPane";
import { clicastCommandToUse } from "../vcastInstallation";
import {
  closeConnection,
  globalEnviroDataServerActive,
} from "../../src-common/vcastServer";
import { runReqs2xTool } from "./processRunner";
import { logCliError } from "./requirementsLog";
import { reqs2xUsable } from "./requirementsOperations";
import {
  findRequirementGatewayConfig,
  resolveRequirementsGatewayInnerDir,
} from "./rgwPath";
import {
  parseReviewFlags,
  reviewFlagKey,
  staleReviewMarks,
} from "./testReviewData";

const path = require("path");
const fs = require("fs");

// The flagged tests, by node ID: the keys of their changed requirements.
const flaggedTests = new Map<string, string[]>();
// The tests marked as reviewed, by node ID: when (an ISO date and time).
const reviewedTests = new Map<string, string>();
const REVIEWED_TESTS_KEY = "vectorcastTestExplorer.reviewedTests";
let reviewMarkStore: vscode.Memento | undefined;

/**
 * Reads the tests marked as reviewed in earlier sessions. Called on
 * activation, before the test tree is built.
 */
export function initializeReviewMarks(context: vscode.ExtensionContext): void {
  reviewMarkStore = context.workspaceState;
  reviewedTests.clear();
  const saved = reviewMarkStore.get<Record<string, unknown>>(
    REVIEWED_TESTS_KEY,
    {}
  );
  for (const [testId, at] of Object.entries(saved ?? {})) {
    if (typeof at === "string") reviewedTests.set(testId, at);
  }
}

function saveReviewMarks(): void {
  void reviewMarkStore?.update(
    REVIEWED_TESTS_KEY,
    Object.fromEntries(reviewedTests)
  );
}

const changeEmitter = new vscode.EventEmitter<void>();
/** Fires when a test was flagged for review, marked as reviewed or unmarked. */
export const onDidChangeReviewFlags = changeEmitter.event;

/** The keys of the changed requirements a test needs review for; none if it does not. */
export function requirementsNeedingReview(testId: string): string[] {
  return flaggedTests.get(testId) ?? [];
}

/**
 * When the test was marked as reviewed (an ISO date and time); undefined if
 * it is not, or a changed requirement flagged it since.
 */
export function reviewedAt(testId: string): string | undefined {
  return reviewedTests.get(testId);
}

// The tests of an environment the gateway flags, by `reviewFlagKey`. None
// when the environment has no gateway or the gateway knows none of its tests.
function readReviewFlags(enviroPath: string): Map<string, string[]> {
  const gatewayDir = resolveRequirementsGatewayInnerDir(enviroPath);
  if (!gatewayDir) return new Map();
  const exportDir = path.join(gatewayDir, "export_data");
  const wanted = `${path.basename(enviroPath)}.json`.toLowerCase();
  try {
    const file = (fs.readdirSync(exportDir) as string[]).find(
      (name) => name.toLowerCase() === wanted
    );
    if (!file) return new Map();
    return parseReviewFlags(
      JSON.parse(fs.readFileSync(path.join(exportDir, file), "utf-8"))
    );
  } catch {
    // No tests recorded yet, or VectorCAST is writing the file right now.
    return new Map();
  }
}

const NEEDS_REVIEW = "needs review";

// Says in the tree which tests need review, and returns the IDs of the nodes
// above them. Only this is said there, and only on the tests: VS Code builds
// a node's tooltip and what a screen reader says of it from its description
// in place of its name. So a test marked as reviewed, which most tests end up
// as, shows it in its context menu only ("Mark as Not Reviewed"), and the
// nodes above flagged tests, which are found by their names, say nothing.
function annotateTree(enviroItem: vscode.TestItem): string[] {
  const parents: string[] = [];
  const annotate = (item: vscode.TestItem): number => {
    let count = 0;
    item.children.forEach((child) => {
      count += annotate(child);
    });
    if (count > 0) parents.push(item.id);
    const flagged = flaggedTests.has(item.id);
    if (flagged) item.description = NEEDS_REVIEW;
    // Only a description of ours is removed. With an empty text: VS Code
    // keeps showing a description that is set back to undefined.
    else if (item.description === NEEDS_REVIEW) item.description = "";
    return count + (flagged ? 1 : 0);
  };
  annotate(enviroItem);
  return parents;
}

// The nodes above flagged tests, by environment node ID, for the context
// menu's "Mark Tests as Reviewed".
const parentsOfFlagged = new Map<string, string[]>();
// The environments of the test tree
const shownEnviros = new Set<string>();
// What was last shown of each environment's flags and marks, by environment
// node ID, to tell when it changed.
const shownStates = new Map<string, string>();

function publishContext(): void {
  void vscode.commands.executeCommand(
    "setContext",
    "vectorcastTestExplorer.testsNeedingReview",
    [...flaggedTests.keys()]
  );
  void vscode.commands.executeCommand(
    "setContext",
    "vectorcastTestExplorer.nodesWithTestsNeedingReview",
    [...parentsOfFlagged.values()].flat()
  );
  // For "Mark as Reviewed" on the tests that are not, and its opposite.
  void vscode.commands.executeCommand(
    "setContext",
    "vectorcastTestExplorer.reviewedTests",
    [...reviewedTests.keys()]
  );
}

/**
 * Reads which tests of the environment VectorCAST flags for review and shows
 * it, with the tests marked as reviewed, in the test tree, the open
 * requirements check and its report. Called when the environment's tree is
 * built (with its new node, which is not in the tree yet) and after anything
 * that changes the flags or the marks: saving the requirements, marking a
 * test as reviewed or taking that back.
 */
export function refreshReviewFlags(
  enviroPath: string,
  enviroItem?: vscode.TestItem
): void {
  const enviroNodeID = makeEnviroNodeID(enviroPath);
  const prefix = `${enviroNodeID}|`;
  const ofEnviro = () =>
    [
      ...[...flaggedTests].map(([id, keys]) => `${id}\n${keys.join("\n")}`),
      ...[...reviewedTests].map(([id, at]) => `${id}\nreviewed ${at}`),
    ]
      .filter((entry) => entry.startsWith(prefix))
      .sort()
      .join("\n\n");
  const before = shownStates.get(enviroNodeID) ?? "";

  for (const id of [...flaggedTests.keys()]) {
    if (id.startsWith(prefix)) flaggedTests.delete(id);
  }
  // The flags are VectorCAST's, but they are shown with the requirements
  // features only.
  const flags = reqs2xUsable ? readReviewFlags(enviroPath) : new Map();
  const tests = new Set<string>();
  for (const [id, node] of testNodeCache as Map<unknown, testNodeType>) {
    if (typeof id !== "string" || !id.startsWith(prefix)) continue;
    if (!node?.testName) continue;
    tests.add(id);
    const keys = flags.size
      ? flags.get(
          reviewFlagKey(
            node.unitName ?? "",
            node.functionName ?? "",
            node.testName.replace(compoundOnlyString, "")
          )
        )
      : undefined;
    if (keys) flaggedTests.set(id, keys);
  }
  // A changed requirement takes a test's mark back. So does a test that is
  // gone, which is only told when the tree was just built.
  const stale = staleReviewMarks(
    reviewedTests.keys(),
    prefix,
    flaggedTests,
    enviroItem ? tests : undefined
  );
  for (const id of stale) reviewedTests.delete(id);
  if (stale.length) saveReviewMarks();

  const item = enviroItem ?? findTestItem(enviroNodeID);
  if (item) {
    shownEnviros.add(enviroPath);
    parentsOfFlagged.set(enviroNodeID, annotateTree(item));
  } else {
    shownEnviros.delete(enviroPath);
    parentsOfFlagged.delete(enviroNodeID);
  }
  publishContext();
  const now = ofEnviro();
  shownStates.set(enviroNodeID, now);
  if (now !== before) changeEmitter.fire();
}

/**
 * Reads the flags of every environment of the test tree again: whether they
 * are shown changed, as the requirements features were turned on or off.
 */
export function refreshAllReviewFlags(): void {
  for (const enviroPath of [...shownEnviros]) refreshReviewFlags(enviroPath);
}

// The flagged tests among those of a tree node: the test itself, or every
// test under an environment, unit or function.
export function flaggedTestsUnder(nodeId: string): string[] {
  if (flaggedTests.has(nodeId)) return [nodeId];
  const node: testNodeType | undefined = getTestNode(nodeId);
  if (!node || node.testName) return [];
  return [...flaggedTests.keys()].filter((id) => {
    const test: testNodeType | undefined = getTestNode(id);
    return (
      test?.enviroNodeID === node.enviroNodeID &&
      (!node.unitName || test.unitName === node.unitName) &&
      (!node.functionName || test.functionName === node.functionName)
    );
  });
}

const testNameOf = (testId: string): string =>
  (getTestNode(testId)?.testName ?? testId).replace(compoundOnlyString, "");

// Shows the flags and marks of the tests' environments as they are now.
function refreshEnvirosOf(testIds: string[]): void {
  const enviroPaths = new Set(
    testIds.flatMap((id) => {
      const enviroPath = getTestNode(id)?.enviroPath;
      return enviroPath ? [enviroPath] : [];
    })
  );
  for (const enviroPath of enviroPaths) refreshReviewFlags(enviroPath);
}

// Clears VectorCAST's flag on the flagged tests, which runs clicast once per
// test. Whether it worked shows in the flags, which are read again.
async function clearReviewFlags(flagged: string[]): Promise<void> {
  const byEnviro = new Map<string, string[]>();
  for (const id of flagged) {
    const { enviroPath } = getTestNode(id);
    byEnviro.set(enviroPath, [...(byEnviro.get(enviroPath) ?? []), id]);
  }
  await vscode.window.withProgress(
    {
      location:
        flagged.length > 1
          ? vscode.ProgressLocation.Notification
          : vscode.ProgressLocation.Window,
      title: "Marking as reviewed",
    },
    async (progress) => {
      for (const [enviroPath, ids] of byEnviro) {
        // A clicast server still holding the environment would write its own
        // copy of the flags over the cleared ones when it closes.
        if (globalEnviroDataServerActive) await closeConnection(enviroPath);
        // -lc reads only CCAST_.CFG, -lada only ADACAST_.CFG.
        const language = findRequirementGatewayConfig(
          enviroPath
        )?.configPath.endsWith("ADACAST_.CFG")
          ? "-lada"
          : "-lc";
        for (const id of ids) {
          progress.report({
            message: testNameOf(id),
            increment: 100 / flagged.length,
          });
          try {
            // VectorCAST marks one test per call.
            await runReqs2xTool({
              exe: clicastCommandToUse,
              args: [
                language,
                // Unquoted, as no shell reads them
                ...getClicastArgsFromTestNodeAsList(getTestNode(id), true),
                "RGw",
                "Testcase",
                "Mark_as_reviewed",
              ],
              cwd: path.dirname(enviroPath),
              captureOutput: true,
              allowNonZeroExit: true,
            });
          } catch (error) {
            logCliError(`Could not run clicast: ${error}`);
          }
        }
        // clicast exits with 0 even when it marked nothing, so what tells is
        // the flag itself.
        refreshReviewFlags(enviroPath);
      }
    }
  );
}

/**
 * Marks the tests as reviewed. On a test VectorCAST flags for review this
 * clears the flag, which cannot be undone, so several of those are marked
 * only after the user confirmed. Says so when a test could not be marked.
 */
export async function markTestsAsReviewed(testIds: string[]): Promise<void> {
  const tests = [...new Set(testIds)].filter((id) => getTestNode(id)?.testName);
  if (tests.length === 0) {
    vscode.window.showInformationMessage(
      "No test here is flagged for review, so there is nothing to mark."
    );
    return;
  }
  const flagged = tests.filter((id) => flaggedTests.has(id));
  if (flagged.length > 1) {
    const confirm = "Mark as Reviewed";
    const names = flagged.map(testNameOf);
    const shown = names.slice(0, 10).join("\n");
    const more = names.length > 10 ? `\n… and ${names.length - 10} more` : "";
    const choice = await vscode.window.showWarningMessage(
      `Mark ${flagged.length} tests as reviewed?`,
      {
        modal: true,
        detail:
          `${shown}${more}\n\n` +
          "A requirement each of them is linked to changed. Marking them " +
          "says that you checked they still fit it, and cannot be undone.",
      },
      confirm
    );
    if (choice !== confirm) return;
  }
  if (flagged.length) await clearReviewFlags(flagged);

  // A test VectorCAST still flags was not marked.
  const failed = flagged.filter((id) => flaggedTests.has(id));
  const marked = tests.filter((id) => !failed.includes(id));
  const at = new Date().toISOString();
  for (const id of marked) reviewedTests.set(id, at);
  if (marked.length) {
    saveReviewMarks();
    refreshEnvirosOf(marked);
  }

  if (failed.length) {
    vscode.window.showWarningMessage(
      `Could not mark ${failed.map(testNameOf).join(", ")} as reviewed. ` +
        'The "VectorCAST Requirement Test Generation Operations" output says what clicast reported.'
    );
  }
  if (marked.length) {
    vscode.window.setStatusBarMessage(
      marked.length === 1
        ? `$(pass) Marked ${testNameOf(marked[0])} as reviewed`
        : `$(pass) Marked ${marked.length} tests as reviewed`,
      5000
    );
  }
}

/**
 * Takes the reviewed mark of the tests back. A flag that marking them
 * cleared stays cleared: VectorCAST cannot set it again.
 */
export function unmarkTestsAsReviewed(testIds: string[]): void {
  const marked = [...new Set(testIds)].filter((id) => reviewedTests.has(id));
  if (marked.length === 0) return;
  for (const id of marked) reviewedTests.delete(id);
  saveReviewMarks();
  refreshEnvirosOf(marked);
  vscode.window.setStatusBarMessage(
    marked.length === 1
      ? `$(circle-slash) ${testNameOf(marked[0])} is no longer marked as reviewed`
      : `$(circle-slash) ${marked.length} tests are no longer marked as reviewed`,
    5000
  );
}
