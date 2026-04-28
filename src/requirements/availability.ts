import * as vscode from "vscode";
import { vcastInstallationDirectory } from "../vcastInstallation";
import { exeFilename, normalizePath } from "../utilities";
import { makeEnviroNodeID } from "../testPane";
import { testNodeCache } from "../testData";
import { findRelevantRequirementGateway } from "./rgwPath";
import { logCliError, logCliOperation } from "./requirementsOperations";

const fs = require("fs");

const NECCESSARY_REQS2X_EXECUTABLES = [
  "code2reqs",
  "reqs2tests",
  "panreq",
  "llm2check",
];

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
 * Resolve where the Reqs2X executables (code2reqs, reqs2tests, panreq,
 * llm2check) live on disk. Priority:
 *   1. The `reqs2x.installationLocation` setting if it contains all binaries.
 *   2. The configured VectorCAST installation directory.
 *   3. The bundled CI/VSIX resource path.
 */
export function getAutoreqExecutableDirectory(
  context: vscode.ExtensionContext
): vscode.Uri | undefined {
  const pathHasAllExecutables = (dirPath: string): boolean => {
    return NECCESSARY_REQS2X_EXECUTABLES.every((exe) =>
      fs.existsSync(
        vscode.Uri.joinPath(vscode.Uri.file(dirPath), exeFilename(exe)).fsPath
      )
    );
  };

  const config = vscode.workspace.getConfiguration(
    "vectorcastTestExplorer.reqs2x"
  );
  const installationLocation = config.get<string>("installationLocation");

  if (installationLocation && pathHasAllExecutables(installationLocation)) {
    return vscode.Uri.file(installationLocation);
  }

  if (pathHasAllExecutables(vcastInstallationDirectory)) {
    return vscode.Uri.file(vcastInstallationDirectory);
  }

  const isCI = process.env.HOME?.startsWith("/github") ?? false;
  const vsixResourceBasePath = `${process.env.GITHUB_WORKSPACE}/vsix`;

  if (!fs.existsSync(vsixResourceBasePath)) {
    logCliError(
      `VSIX resource folder not found at expected path: ${vsixResourceBasePath}`
    );
  } else {
    logCliOperation(`Found VSIX resource folder at: ${vsixResourceBasePath}`);
  }

  const vsixBaseURI = isCI
    ? vscode.Uri.file(vsixResourceBasePath)
    : context.extensionUri;

  if (pathHasAllExecutables(vsixBaseURI.fsPath)) {
    return vscode.Uri.joinPath(vsixBaseURI, "resources", "distribution");
  }

  return undefined;
}
