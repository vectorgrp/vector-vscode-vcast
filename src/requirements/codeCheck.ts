// Checks the code of an environment against its requirements with reqs2check
// and shows what it finds: as comments in the code, in a report and, through
// `CodeCheck`, on the requirements in the requirements editor.

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  closeConnection,
  globalEnviroDataServerActive,
} from "../../src-common/vcastServer";
import { getTestNode } from "../testData";
import { getNonce } from "../webviewUtils";
import { CodeCheckComments, FindingComment } from "./codeCheckComments";
import {
  CheckedFunction,
  checkedFunctionFrom,
  CheckScope,
  commentLineOf,
  GatewayContent,
  inScope,
  isInFile,
  mergeCheckedFunctions,
  openFindings,
  parseReqs2checkOutput,
  RequirementCheck,
  requirementChecks,
  requirementsChanged,
  SourceLine,
  tracedRequirements,
} from "./codeCheckData";
import { codeCheckReportHtml } from "./codeCheckReport";
import { CodeCheckStore } from "./codeCheckStore";
import { runReqs2xTool } from "./processRunner";
import { REQS2CHECK_EXECUTABLE_PATH } from "./requirementsExecutables";
import { logCliError } from "./requirementsLog";
import { findRelevantRequirementGateway } from "./rgwPath";
import { lastToolError } from "./testReviewData";

// Finds where a function of an environment starts, if its unit's source file
// is known.
export type FunctionLocator = (
  unit: string,
  functionName: string
) => SourceLine | undefined;

/** What the rest of the extension uses of the code check. */
export interface CodeCheck {
  /** Fires with the path of the environment whose check changed. */
  onDidChange: vscode.Event<string>;
  /** How each checked requirement of the environment fared, by key. */
  requirementChecks(enviroPath: string): Record<string, RequirementCheck>;
  /** Checks the environment, or the unit or function of `scope`. */
  run(enviroPath: string, scope?: CheckScope): Promise<void>;
  /** Shows a checked function's findings in its source, beside the caller. */
  showInCode(
    enviroPath: string,
    unit: string,
    functionName: string
  ): Promise<void>;
  /** The requirements changed: the functions checked against others are out of date. */
  requirementsChangedTo(enviroPath: string, gateway: GatewayContent): void;
}

export function activateCodeCheck(
  context: vscode.ExtensionContext,
  locateFunctionsOf: (enviroPath: string) => Promise<FunctionLocator>
): CodeCheck {
  const store = new CodeCheckStore(context.workspaceState);
  restoreChecks(store);
  const comments = new CodeCheckComments(context, store);
  const reports = new Map<string, vscode.WebviewPanel>();
  const running = new Set<string>();

  async function run(enviroPath: string, scope: CheckScope = {}) {
    if (running.has(enviroPath)) {
      vscode.window.showInformationMessage(
        `A check of ${path.basename(enviroPath)} is still running.`
      );
      return;
    }
    running.add(enviroPath);
    try {
      await check(enviroPath, scope);
    } finally {
      running.delete(enviroPath);
    }
  }

  async function check(enviroPath: string, scope: CheckScope) {
    const gatewayPath = findRelevantRequirementGateway(enviroPath);
    if (!gatewayPath) {
      vscode.window.showWarningMessage(
        `No requirements gateway was found for ${enviroPath}, so there are no requirements to check against.`
      );
      return;
    }
    const what = scope.function ?? scope.unit ?? path.basename(enviroPath);
    // Taken before the check, so an edit made while it runs counts as later.
    const checkedAt = Date.now();
    const reported = await runReqs2check(enviroPath, gatewayPath, scope, what);
    if (!reported) return;

    const locate = await locateFunctionsOf(enviroPath);
    const checked = reported.map((entry) => {
      const result = checkedFunctionFrom(entry, checkedAt);
      result.start = locate(result.unit, result.name);
      return result;
    });
    const known = store.get(enviroPath);
    const dismissed = known?.dismissed ?? [];
    store.set(enviroPath, {
      functions: mergeCheckedFunctions(known?.functions ?? [], checked, scope),
      dismissed,
    });

    if (checked.length === 0) {
      vscode.window.showInformationMessage(
        `No requirement is traced to ${what}, so there was nothing to check.`
      );
      return;
    }
    // A single function shows in the code, anything more in the report.
    const single = scope.function && checked.length === 1 ? checked[0] : null;
    if (single && openFindings(single, dismissed).length === 0) {
      vscode.window.showInformationMessage(
        `The check found nothing in ${what} that differs from its requirements.`
      );
    } else if (single && commentLineOf(single)) {
      await comments.reveal(enviroPath, single, vscode.ViewColumn.Active);
    } else {
      showReport(enviroPath);
    }
  }

  function showReport(enviroPath: string): void {
    let panel = reports.get(enviroPath);
    if (!panel) {
      panel = vscode.window.createWebviewPanel(
        "vectorcastCodeCheck",
        `Code against requirements: ${path.basename(enviroPath)}`,
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      panel.onDidDispose(
        () => reports.delete(enviroPath),
        null,
        context.subscriptions
      );
      panel.webview.onDidReceiveMessage(
        (message) => handleReportMessage(enviroPath, message),
        null,
        context.subscriptions
      );
      reports.set(enviroPath, panel);
    }
    renderReport(enviroPath);
    panel.reveal();
  }

  // Shows the check as it is now; a cleared one closes its report.
  function renderReport(enviroPath: string): void {
    const panel = reports.get(enviroPath);
    const check = store.get(enviroPath);
    if (!panel) return;
    if (!check?.functions.length) {
      panel.dispose();
      return;
    }
    panel.webview.html = codeCheckReportHtml({
      enviroName: path.basename(enviroPath),
      check,
      nonce: getNonce(),
      cspSource: panel.webview.cspSource,
    });
  }

  // The report's buttons; see buttonHtml in codeCheckReport.ts.
  function handleReportMessage(enviroPath: string, message: any): void {
    const { type, unit, function: name, id } = message ?? {};
    if (type === "recheck") {
      void run(enviroPath, { unit, function: name });
    } else if (type === "show") {
      void showInCode(enviroPath, unit, name);
    } else if (type === "dismiss" || type === "restore") {
      setDismissed(enviroPath, id, type === "dismiss");
    } else if (type === "clear") {
      const check = store.get(enviroPath);
      // What was dismissed stays so in the next check.
      if (check) store.set(enviroPath, { ...check, functions: [] });
    }
  }

  async function showInCode(enviroPath: string, unit: string, name: string) {
    const checked = store
      .get(enviroPath)
      ?.functions.find((known) => inScope(known, { unit, function: name }));
    if (checked) {
      await comments.reveal(enviroPath, checked, vscode.ViewColumn.Beside);
    }
  }

  function setDismissed(enviroPath: string, id: string, dismissed: boolean) {
    const check = store.get(enviroPath);
    if (!check || typeof id !== "string") return;
    const others = check.dismissed.filter((candidate) => candidate !== id);
    store.set(enviroPath, {
      ...check,
      dismissed: dismissed ? [...others, id] : others,
    });
  }

  // Marks the functions `changed` picks, in the environments given, as out
  // of date.
  function markStale(
    enviroPaths: string[],
    changed: (checked: CheckedFunction) => boolean
  ): void {
    for (const enviroPath of enviroPaths) {
      const check = store.get(enviroPath);
      const outdated = check?.functions.filter(
        (checked) => !checked.stale && changed(checked)
      );
      if (!check || !outdated?.length) continue;
      for (const checked of outdated) checked.stale = true;
      store.set(enviroPath, check);
    }
  }

  context.subscriptions.push(
    store.onDidChange(renderReport),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.contentChanges.length === 0) return;
      const file = event.document.uri.fsPath;
      markStale(store.environments, (checked) => isInFile(checked, file));
    }),
    // From the test explorer: an environment, a unit or a function
    vscode.commands.registerCommand(
      "vectorcastTestExplorer.checkCodeAgainstRequirements",
      async (node?: { id: string }) => {
        const testNode = node && getTestNode(node.id);
        if (!testNode) return;
        await run(testNode.enviroPath, {
          unit: testNode.unitName || undefined,
          function: testNode.functionName || undefined,
        });
      }
    ),
    // From a comment thread's title
    vscode.commands.registerCommand(
      "vectorcastTestExplorer.recheckCodeAgainstRequirements",
      async (thread: vscode.CommentThread) => {
        const subject = comments.subjectOf(thread);
        if (subject) await run(subject.enviroPath, subject);
      }
    ),
    // From a comment thread's title, or from the command palette
    vscode.commands.registerCommand(
      "vectorcastTestExplorer.showCodeCheckReport",
      async (thread?: vscode.CommentThread) => {
        const enviroPath =
          (thread && comments.subjectOf(thread)?.enviroPath) ??
          (await pickCheckedEnvironment(store));
        if (enviroPath) showReport(enviroPath);
      }
    ),
    // From a finding's comment
    vscode.commands.registerCommand(
      "vectorcastTestExplorer.dismissCodeCheckFinding",
      (comment: FindingComment) =>
        setDismissed(comment.enviroPath, comment.findingId, true)
    )
  );

  return {
    onDidChange: store.onDidChange,
    requirementChecks: (enviroPath) => requirementChecks(store.get(enviroPath)),
    run,
    showInCode,
    requirementsChangedTo: (enviroPath, gateway) => {
      const requirements = tracedRequirements(gateway);
      markStale([enviroPath], (checked) =>
        requirementsChanged(checked, requirements)
      );
    },
  };
}

// The environment whose report to show: the checked one, or the user's pick
// when there are several.
async function pickCheckedEnvironment(
  store: CodeCheckStore
): Promise<string | undefined> {
  const checked = store.environments.filter(
    (enviroPath) => store.get(enviroPath)!.functions.length > 0
  );
  if (checked.length === 0) {
    vscode.window.showInformationMessage(
      "No environment's code has been checked against its requirements yet."
    );
  }
  if (checked.length <= 1) return checked[0];
  const picked = await vscode.window.showQuickPick(
    checked.map((enviroPath) => ({
      label: path.basename(enviroPath),
      description: enviroPath,
    })),
    { title: "Show the check of the code against the requirements of" }
  );
  return picked?.description;
}

// After a reload: forgets the checks of environments that are gone, and
// marks the functions whose source was saved since they were checked.
function restoreChecks(store: CodeCheckStore): void {
  for (const enviroPath of store.environments) {
    const check = store.get(enviroPath)!;
    if (!fs.existsSync(enviroPath)) {
      store.set(enviroPath, undefined);
      continue;
    }
    for (const checked of check.functions) {
      const file = checked.start?.file;
      if (file && savedSince(file, checked.checkedAt)) checked.stale = true;
    }
  }
}

// A file that is gone counts as changed.
function savedSince(file: string, time: number): boolean {
  try {
    return fs.statSync(file).mtimeMs > time;
  } catch {
    return true;
  }
}

/**
 * Runs reqs2check on `scope` and returns the functions it reports, each with
 * its requirements and findings, or null (after telling the user why) when
 * the check did not finish. `what` names the scope in the messages.
 */
async function runReqs2check(
  enviroPath: string,
  gatewayPath: string,
  scope: CheckScope,
  what: string
): Promise<any[] | null> {
  // As for tests2check: not while a clicast server holds the environment open.
  if (globalEnviroDataServerActive) await closeConnection(enviroPath);
  try {
    const { stdout, stderr, exitCode, cancelled } = await runReqs2xTool({
      exe: REQS2CHECK_EXECUTABLE_PATH,
      args: [
        "-e",
        enviroPath,
        gatewayPath,
        ...(scope.unit ? ["--unit", scope.unit] : []),
        ...(scope.function ? ["--subprogram", scope.function] : []),
        "--fixed-string-match",
        "--json",
        "--json-events",
        // The functions without findings too: their requirements passed.
        "--no-failures-only",
      ],
      llm: true,
      captureOutput: true,
      allowNonZeroExit: true,
      progress: {
        title: `Checking ${what} against its requirements`,
        logPrefix: "reqs2check",
      },
    });
    if (cancelled) return null;
    if (exitCode !== 0) {
      vscode.window.showWarningMessage(
        `Cannot check ${what}: ${lastToolError(stderr ?? "")}`
      );
      return null;
    }
    return parseReqs2checkOutput(stdout ?? "");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    vscode.window.showWarningMessage(`Failed to check ${what}: ${reason}`);
    logCliError(reason);
    return null;
  }
}
