import * as vscode from "vscode";
import {
  databasesChangedSinceLoad,
  environmentDataCache,
  getEnviroNodeData,
  makeTestNodeID,
  projectChangedSinceLoad,
} from "./testData";
import {
  failMessageFor,
  findTestItem,
  globalController,
  refreshAllExtensionData,
  testPaneIsBusy,
  updateDataForEnvironment,
} from "./testPane";
import { normalizePath } from "./utilities";
import { globalTestStatusArray, vcastEnviroFile } from "./vcastTestInterface";

const fs = require("fs");
const path = require("path");

// Refreshes the test pane when an environment changes outside the extension,
// e.g. clicast run in a terminal or by an agent. VectorCAST writes master.db or
// cover.db for every change to tests, results or coverage, and writes
// UNITDATA.VCD last in a build. Reads, including the extension's own data
// loads, write neither.
const quietPeriodMs = 1000;
const quietPeriodTimers = new Map<string, NodeJS.Timeout>();

// Runs check once nothing changed at key for the quiet period and no run or
// full rescan is in progress
function afterQuietPeriod(key: string, check: () => Promise<void>) {
  clearTimeout(quietPeriodTimers.get(key));
  const run = () => {
    if (testPaneIsBusy()) {
      quietPeriodTimers.set(key, setTimeout(run, quietPeriodMs));
      return;
    }
    quietPeriodTimers.delete(key);
    void check();
  };
  quietPeriodTimers.set(key, setTimeout(run, quietPeriodMs));
}

// The last result of each of the environment's tests that has one
function testResults(enviroPath: string): Map<string, string> {
  const prefix = makeTestNodeID(enviroPath, "");
  const results = new Map<string, string>();
  for (const [id, test] of Object.entries(globalTestStatusArray)) {
    if (id.startsWith(prefix) && test.status) {
      results.set(id, `${test.status} ${test.time} ${test.passfail}`);
    }
  }
  return results;
}

// The Testing view shows a test's result only once a test run reports it
function reportNewResults(
  before: Map<string, string>,
  after: Map<string, string>
) {
  const tests = [...after.keys()]
    .filter((id) => after.get(id) !== before.get(id))
    .map(findTestItem)
    .filter((test): test is vscode.TestItem => test !== undefined);
  if (tests.length === 0) return;

  const run = globalController.createTestRun(
    new vscode.TestRunRequest(tests),
    "Run outside VS Code"
  );
  for (const test of tests) {
    const { status, passfail } = globalTestStatusArray[test.id];
    if (status === "passed") {
      run.passed(test);
    } else {
      run.failed(test, failMessageFor(passfail));
    }
  }
  run.end();
}

// Environments built, rebuilt or deleted since their last check
const buildChangedEnvs = new Set<string>();

function onEnvironmentChange(enviroPath: string, buildChanged: boolean) {
  if (buildChanged) buildChangedEnvs.add(enviroPath);
  afterQuietPeriod(enviroPath, () => checkEnvironment(enviroPath));
}

async function checkEnvironment(enviroPath: string) {
  const buildChanged = buildChangedEnvs.delete(enviroPath);
  const enviroData = getEnviroNodeData(enviroPath);
  const builtOnDisk = fs.existsSync(path.join(enviroPath, vcastEnviroFile));
  if (enviroData?.isBuilt && builtOnDisk) {
    if (databasesChangedSinceLoad(enviroData.buildDirectory)) {
      const resultsBefore = testResults(enviroData.buildDirectory);
      await updateDataForEnvironment(enviroData.buildDirectory);
      reportNewResults(resultsBefore, testResults(enviroData.buildDirectory));
    }
  } else if (buildChanged) {
    // A new, newly built or deleted environment changes the tree itself. A
    // rebuild deletes and recreates the directory, so it waits for UNITDATA.VCD.
    const deleted = enviroData && !fs.existsSync(enviroPath);
    if (builtOnDisk || deleted) {
      await refreshAllExtensionData();
    }
  }
}

// VectorCAST writes a Manage project's .vcm file only when the project's
// compilers, testsuites, environments or settings change, and the extension
// reads those only in a full rescan
function onProjectChange(projectFile: string) {
  afterQuietPeriod(projectFile, async () => {
    if (projectChangedSinceLoad(projectFile)) {
      await refreshAllExtensionData();
    }
  });
}

export function setupExternalChangeWatchers(
  context: vscode.ExtensionContext
): void {
  // master.db, cover.db and UNITDATA.VCD sit in the environment's directory
  const environmentFileChanged = (buildChanged: boolean) => (uri: vscode.Uri) =>
    onEnvironmentChange(normalizePath(path.dirname(uri.fsPath)), buildChanged);

  const databaseWatcher = vscode.workspace.createFileSystemWatcher(
    "**/{master,cover}.db"
  );
  const databaseChanged = environmentFileChanged(false);
  databaseWatcher.onDidCreate(databaseChanged, null, context.subscriptions);
  databaseWatcher.onDidChange(databaseChanged, null, context.subscriptions);
  databaseWatcher.onDidDelete(databaseChanged, null, context.subscriptions);

  const buildWatcher = vscode.workspace.createFileSystemWatcher(
    `**/${vcastEnviroFile}`
  );
  const environmentBuilt = environmentFileChanged(true);
  buildWatcher.onDidCreate(environmentBuilt, null, context.subscriptions);

  // When a whole directory is deleted or moved away, VS Code reports only the
  // directory, not the environment files in it
  const deleteWatcher = vscode.workspace.createFileSystemWatcher(
    "**/*",
    true,
    true,
    false
  );
  deleteWatcher.onDidDelete(
    (uri) => {
      const deletedPath = normalizePath(uri.fsPath);
      for (const enviroPath of environmentDataCache.keys()) {
        if (
          enviroPath === deletedPath ||
          enviroPath.startsWith(deletedPath + "/")
        ) {
          onEnvironmentChange(enviroPath, true);
        }
      }
    },
    null,
    context.subscriptions
  );

  const projectWatcher = vscode.workspace.createFileSystemWatcher("**/*.vcm");
  const projectFileChanged = (uri: vscode.Uri) =>
    onProjectChange(normalizePath(uri.fsPath));
  projectWatcher.onDidCreate(projectFileChanged, null, context.subscriptions);
  projectWatcher.onDidChange(projectFileChanged, null, context.subscriptions);
  projectWatcher.onDidDelete(projectFileChanged, null, context.subscriptions);

  context.subscriptions.push(
    databaseWatcher,
    buildWatcher,
    deleteWatcher,
    projectWatcher
  );
}
