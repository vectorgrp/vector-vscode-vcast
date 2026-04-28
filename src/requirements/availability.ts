import * as vscode from "vscode";
import { normalizePath } from "../utilities";
import { makeEnviroNodeID } from "../testPane";
import { testNodeCache } from "../testData";
import { findRelevantRequirementGateway } from "./rgwPath";

const path = require("path");

// Tracks node IDs (env + descendants) currently flagged as having
// requirements available. Sub-node IDs are included so the
// `testId in vcastRequirementsAvailable` check on `Generate Tests from
// Requirements` matches when the user right-clicks a unit / function / test
// inside an env that has requirements.
let availableNodeIds: string[] = [];

/**
 * Collect every node ID descended from `envNodeID` that's currently in
 * the test cache. Sub-node IDs follow the convention
 * `<envID>|<unit>[.<func>[.<test>]]`, so a prefix filter is enough.
 */
function descendantNodeIds(envNodeID: string): string[] {
  const prefix = `${envNodeID}|`;
  const out: string[] = [];
  for (const id of testNodeCache.keys()) {
    if (typeof id === "string" && id.startsWith(prefix)) {
      out.push(id);
    }
  }
  return out;
}

function setAvailableContext(ids: string[]) {
  vscode.commands.executeCommand(
    "setContext",
    "vectorcastTestExplorer.vcastRequirementsAvailable",
    ids
  );
  availableNodeIds = ids;
}

/**
 * Update the `vectorcastTestExplorer.vcastRequirementsAvailable` context key
 * for an environment. Includes descendants discovered in `testNodeCache` so
 * sub-node menu enablements (Generate Tests from Requirements) work too.
 *
 * Call this after the env's tree has been processed (descendants exist in
 * the cache); otherwise only the env ID gets added until the tree is built.
 */
export function updateRequirementsAvailability(enviroPath: string) {
  const envNodeID = makeEnviroNodeID(normalizePath(enviroPath));
  const hasRequirements = findRelevantRequirementGateway(enviroPath) !== null;
  const idsForThisEnv = [envNodeID, ...descendantNodeIds(envNodeID)];

  if (hasRequirements) {
    let updated = availableNodeIds.slice();
    let changed = false;
    for (const id of idsForThisEnv) {
      if (!updated.includes(id)) {
        updated.push(id);
        changed = true;
      }
    }
    if (changed) setAvailableContext(updated);
  } else {
    const drop = new Set(idsForThisEnv);
    const updated = availableNodeIds.filter((id) => !drop.has(id));
    if (updated.length !== availableNodeIds.length) setAvailableContext(updated);
  }
}

/**
 * Re-evaluate availability for every environment in the workspace. Used by
 * the file-system watchers below — out-of-band edits (the user deletes the
 * RGW from a terminal, edits CCAST_.CFG, etc.) don't tell us which env was
 * affected, and the eval is cheap enough to just do everything.
 */
async function refreshAllRequirementsAvailability(): Promise<void> {
  const envFiles = await vscode.workspace.findFiles("**/*.env");
  for (const uri of envFiles) {
    const envDir = path.dirname(uri.fsPath);
    const envName = path.basename(uri.fsPath, ".env");
    updateRequirementsAvailability(path.join(envDir, envName));
  }
}

/**
 * Watch for out-of-band RGW changes so the menu enablement stays in sync
 * with the filesystem:
 *  - `requirements_gateway/requirements.json` create/delete: the RGW
 *    appearing or disappearing.
 *  - `CCAST_.CFG` create/change/delete: the user pointing VCAST_REPOSITORY
 *    somewhere else (or unsetting it).
 *
 * Watchers are registered on `context.subscriptions` so they're disposed
 * with the extension.
 */
export function setupRequirementsFileWatchers(
  context: vscode.ExtensionContext
): void {
  const refresh = () => {
    void refreshAllRequirementsAvailability();
  };

  const rgwWatcher = vscode.workspace.createFileSystemWatcher(
    "**/requirements_gateway/requirements.json"
  );
  rgwWatcher.onDidCreate(refresh, null, context.subscriptions);
  rgwWatcher.onDidDelete(refresh, null, context.subscriptions);
  context.subscriptions.push(rgwWatcher);

  const cfgWatcher = vscode.workspace.createFileSystemWatcher("**/CCAST_.CFG");
  cfgWatcher.onDidChange(refresh, null, context.subscriptions);
  cfgWatcher.onDidCreate(refresh, null, context.subscriptions);
  cfgWatcher.onDidDelete(refresh, null, context.subscriptions);
  context.subscriptions.push(cfgWatcher);
}
