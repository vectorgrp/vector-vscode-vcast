// Which tests a person reviewed, and which need review.
//
// VectorCAST flags a test as needing review when a requirement it is linked
// to changed. It keeps the flag in the requirements gateway; marking the test
// as reviewed clears it. Any other test can be marked as reviewed too, which
// VectorCAST has no place for: that mark is kept with the workspace, until it
// is taken back, the test is gone or VectorCAST flags the test.

import * as vscode from "vscode";
import {
  compoundOnlyString,
  getClicastArgsFromTestNodeAsList,
  getTestNode,
  testNodeCache,
  testNodeType,
} from "../testData";
import { findTestItem, makeEnviroNodeID } from "../testPane";
import { logCliError } from "./requirementsLog";
import { reqs2xUsable } from "./requirementsOperations";
import { runGatewayClicast } from "./rgwIo";
import { resolveRequirementsGatewayInnerDir } from "./rgwPath";
import {
  parseReviewFlags,
  reviewFlagKey,
  staleReviewMarks,
} from "./testReviewData";

const path = require("path");
const fs = require("fs");

// "Mark as Reviewed" and "Mark as Not Reviewed" of the test tree, which the
// links in a requirements check run too. Their argument names the node.
export const MARK_TEST_COMMAND = "vectorcastTestExplorer.markTestAsReviewed";
export const UNMARK_TEST_COMMAND =
  "vectorcastTestExplorer.markTestAsNotReviewed";

// The flagged tests, by node ID: the keys of their changed requirements.
const flaggedTests = new Map<string, string[]>();
// The node IDs of the tests marked as reviewed. No flagged test is among them.
const reviewedTests = new Set<string>();
const REVIEWED_TESTS_KEY = "vectorcastTestExplorer.reviewedTests";
let reviewMarkStore: vscode.Memento | undefined;

/** Reads the marks of earlier sessions. Called before the test tree is built. */
export function initializeReviewMarks(context: vscode.ExtensionContext): void {
  reviewMarkStore = context.workspaceState;
  const saved = reviewMarkStore.get<unknown>(REVIEWED_TESTS_KEY);
  for (const testId of Array.isArray(saved) ? saved : []) {
    reviewedTests.add(testId);
  }
}

function saveReviewMarks(): void {
  void reviewMarkStore?.update(REVIEWED_TESTS_KEY, [...reviewedTests]);
}

const changeEmitter = new vscode.EventEmitter<void>();
/** Fires when the flags and marks were read again or a mark changed. */
export const onDidChangeReviewFlags = changeEmitter.event;

/** The keys of the changed requirements a test needs review for; none if it does not. */
export function requirementsNeedingReview(testId: string): string[] {
  return flaggedTests.get(testId) ?? [];
}

export function isReviewed(testId: string): boolean {
  return reviewedTests.has(testId);
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
// above them. Nothing else is said there: VS Code builds a node's tooltip and
// what a screen reader says of it from its description in place of its name.
// So a reviewed test shows it in its menu only, and the nodes above flagged
// tests, which are found by their names, say nothing.
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

// The nodes above flagged tests, by the path of each environment in the tree.
const parentsOfFlagged = new Map<string, string[]>();

function setContext(key: string, nodeIds: string[]): void {
  void vscode.commands.executeCommand(
    "setContext",
    `vectorcastTestExplorer.${key}`,
    nodeIds
  );
}

/**
 * Reads which tests of the environment VectorCAST flags for review and shows
 * it, with the tests marked as reviewed, in the test tree, the open
 * requirements check and its report. Called when the environment's tree is
 * built (with its new node, which is not in the tree yet) and after anything
 * that changes the flags or the marks.
 */
export function refreshReviewFlags(
  enviroPath: string,
  enviroItem?: vscode.TestItem
): void {
  const enviroNodeID = makeEnviroNodeID(enviroPath);
  const prefix = `${enviroNodeID}|`;
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
    const keys = flags.get(
      reviewFlagKey(
        node.unitName ?? "",
        node.functionName ?? "",
        node.testName.replace(compoundOnlyString, "")
      )
    );
    if (keys) flaggedTests.set(id, keys);
  }
  // Whether a test is gone is only told when the tree was just built.
  const stale = staleReviewMarks(
    reviewedTests,
    prefix,
    flaggedTests,
    enviroItem ? tests : undefined
  );
  for (const id of stale) reviewedTests.delete(id);
  if (stale.length) saveReviewMarks();

  const item = enviroItem ?? findTestItem(enviroNodeID);
  if (item) parentsOfFlagged.set(enviroPath, annotateTree(item));
  else parentsOfFlagged.delete(enviroPath);
  setContext(
    "nodesWithTestsNeedingReview",
    [...parentsOfFlagged.values()].flat()
  );
  setContext("reviewedTests", [...reviewedTests]);
  changeEmitter.fire();
}

/**
 * Reads the flags of every environment of the test tree again: whether they
 * are shown changed, as the requirements features were turned on or off.
 */
export function refreshAllReviewFlags(): void {
  for (const enviroPath of [...parentsOfFlagged.keys()]) {
    refreshReviewFlags(enviroPath);
  }
}

const testNameOf = (testId: string): string =>
  (getTestNode(testId)?.testName ?? testId).replace(compoundOnlyString, "");

// "PLACE_ORDER.001", "3 tests"
const named = (testIds: string[]): string =>
  testIds.length === 1 ? testNameOf(testIds[0]) : `${testIds.length} tests`;

function refreshEnvirosOf(testIds: string[]): void {
  const enviroPaths = testIds.map((id) => getTestNode(id)?.enviroPath);
  for (const enviroPath of new Set(enviroPaths)) {
    if (enviroPath) refreshReviewFlags(enviroPath);
  }
}

// Clears VectorCAST's flag on the tests: one clicast call each. clicast exits
// with 0 even when it marked nothing, so whether it worked shows in the
// flags, which are read again.
async function clearReviewFlags(flagged: string[]): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Marking ${named(flagged)} as reviewed`,
    },
    async () => {
      try {
        for (const id of flagged) {
          const node = getTestNode(id);
          await runGatewayClicast(node.enviroPath, [
            // Unquoted, as no shell reads them
            ...getClicastArgsFromTestNodeAsList(node, true),
            "RGw",
            "Testcase",
            "Mark_as_reviewed",
          ]);
        }
      } catch (error) {
        logCliError(`Could not run clicast: ${error}`);
      }
    }
  );
  refreshEnvirosOf(flagged);
}

/**
 * Marks as reviewed what the node of the test tree stands for: the test, or
 * the flagged tests under an environment, unit or function. On a flagged test
 * this clears VectorCAST's flag, which cannot be undone, so several of those
 * are marked only after the user confirmed.
 */
export async function markAsReviewed(nodeId: string): Promise<void> {
  const underNode = (id: string) =>
    id.startsWith(`${nodeId}|`) || id.startsWith(`${nodeId}.`);
  await markTestsAsReviewed(
    getTestNode(nodeId)?.testName
      ? [nodeId]
      : [...flaggedTests.keys()].filter(underNode)
  );
}

/** As above, for the tests themselves. Says so when one could not be marked. */
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
    const more = names.length > 10 ? `\n… and ${names.length - 10} more` : "";
    const choice = await vscode.window.showWarningMessage(
      `Mark ${flagged.length} tests as reviewed?`,
      {
        modal: true,
        detail:
          `${names.slice(0, 10).join("\n")}${more}\n\n` +
          "A requirement each of them is linked to changed. Marking them " +
          "says that you checked they still fit it, and cannot be undone.",
      },
      confirm
    );
    if (choice !== confirm) return;
  }
  if (flagged.length) await clearReviewFlags(flagged);

  // A test VectorCAST still flags could not be marked.
  const failed = flagged.filter((id) => flaggedTests.has(id));
  const marked = tests.filter((id) => !failed.includes(id));
  for (const id of marked) reviewedTests.add(id);
  if (failed.length) {
    vscode.window.showWarningMessage(
      `Could not mark ${failed.map(testNameOf).join(", ")} as reviewed. ` +
        'The "VectorCAST Requirement Test Generation Operations" output says what clicast reported.'
    );
  }
  if (marked.length === 0) return;
  saveReviewMarks();
  refreshEnvirosOf(marked);
  vscode.window.setStatusBarMessage(
    `$(pass) Marked ${named(marked)} as reviewed`,
    5000
  );
}

/**
 * Takes the reviewed mark of the tests back. A flag that marking them
 * cleared stays cleared: VectorCAST cannot set it again.
 */
export function unmarkTestsAsReviewed(testIds: string[]): void {
  const marked = testIds.filter((id) => reviewedTests.delete(id));
  if (marked.length === 0) return;
  saveReviewMarks();
  refreshEnvirosOf(marked);
  vscode.window.setStatusBarMessage(
    `$(circle-slash) ${named(marked)}: no longer marked as reviewed`,
    5000
  );
}
