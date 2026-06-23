import * as vscode from "vscode";
import { vcastInstallationDirectory } from "../vcastInstallation";
import { exeFilename } from "../utilities";
import { logCliError, logCliOperation } from "./requirementsLog";
import { runReqs2xTool } from "./processRunner";

const fs = require("fs");

// Missing any of these disables the entire Reqs2X feature.
const NECESSARY_REQS2X_EXECUTABLES = [
  "code2reqs",
  "reqs2tests",
  "panreq",
  "llm2check",
];

// Resolved alongside the required set but absence does NOT disable the
// feature; each has its own availability probe (e.g.
// `isReqs2checkAvailable`) so the UI can hide just that surface.

// Resolved at activation time via setupReqs2XExecutablePaths. Mutable
// module-level state so the rest of the requirements modules can depend on
// fixed names without each having to know how the binaries were located.
export let CODE2REQS_EXECUTABLE_PATH: string = "";
export let REQS2TESTS_EXECUTABLE_PATH: string = "";
export let REQS2CHECK_EXECUTABLE_PATH: string = "";
export let PANREQ_EXECUTABLE_PATH: string = "";
export let LLM2CHECK_EXECUTABLE_PATH: string = "";

/**
 * Resolve the on-disk directory containing the Reqs2X executables. Priority:
 *   1. `reqs2x.installationLocation` setting (if it has every binary).
 *   2. The configured VectorCAST installation directory.
 *   3. The bundled CI/VSIX resource path.
 */
export function getAutoreqExecutableDirectory(
  context: vscode.ExtensionContext
): vscode.Uri | undefined {
  const pathHasAllExecutables = (dirPath: string): boolean => {
    return NECESSARY_REQS2X_EXECUTABLES.every((exe) =>
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

/**
 * Populate the four executable-path module bindings. Returns false if the
 * binaries can't be located so the caller can disable the feature gracefully.
 */
export function setupReqs2XExecutablePaths(
  context: vscode.ExtensionContext
): boolean {
  const baseUri = getAutoreqExecutableDirectory(context);
  if (!baseUri) return false;

  CODE2REQS_EXECUTABLE_PATH = vscode.Uri.joinPath(
    baseUri,
    exeFilename("code2reqs")
  ).fsPath;
  REQS2TESTS_EXECUTABLE_PATH = vscode.Uri.joinPath(
    baseUri,
    exeFilename("reqs2tests")
  ).fsPath;
  REQS2CHECK_EXECUTABLE_PATH = vscode.Uri.joinPath(
    baseUri,
    exeFilename("reqs2check")
  ).fsPath;
  PANREQ_EXECUTABLE_PATH = vscode.Uri.joinPath(
    baseUri,
    exeFilename("panreq")
  ).fsPath;
  LLM2CHECK_EXECUTABLE_PATH = vscode.Uri.joinPath(
    baseUri,
    exeFilename("llm2check")
  ).fsPath;

  // Different baseUri may have resolved; drop cached probes.
  onlyUntracedSupport = undefined;
  reqs2checkAvailability = undefined;

  return true;
}

let reqs2checkAvailability: boolean | undefined;

export function isReqs2checkAvailable(): boolean {
  if (reqs2checkAvailability !== undefined) return reqs2checkAvailability;
  reqs2checkAvailability = Boolean(
    REQS2CHECK_EXECUTABLE_PATH && fs.existsSync(REQS2CHECK_EXECUTABLE_PATH)
  );
  logCliOperation(
    `reqs2check availability: ${reqs2checkAvailability ? "yes" : "no"}`
  );
  return reqs2checkAvailability;
}

let onlyUntracedSupport: boolean | undefined; // undefined until first probed
let onlyUntracedProbe: Promise<boolean> | undefined;

/**
 * Probe (once, cached) whether the resolved `panreq` supports `--only-untraced`
 * by scanning `panreq --help`. `panreq` ships with VectorCAST and is versioned
 * independently of this extension, so an older one may predate the flag. Any
 * failure resolves to `false` — callers then fall back to full inference rather
 * than passing a flag the binary would reject.
 */
export async function panreqSupportsOnlyUntraced(): Promise<boolean> {
  if (onlyUntracedSupport !== undefined) return onlyUntracedSupport;
  if (onlyUntracedProbe) return onlyUntracedProbe;
  if (!PANREQ_EXECUTABLE_PATH) return false;

  onlyUntracedProbe = (async () => {
    let supported = false;
    try {
      const result = await runReqs2xTool({
        exe: PANREQ_EXECUTABLE_PATH,
        args: ["--help"],
        captureOutput: true,
        allowNonZeroExit: true,
        timeoutMs: 10000,
      });
      const help = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      supported = help.includes("--only-untraced");
    } catch (err) {
      logCliError(`panreq capability probe failed: ${err}`);
    }
    onlyUntracedSupport = supported;
    onlyUntracedProbe = undefined;
    logCliOperation(
      `panreq --only-untraced support: ${supported ? "yes" : "no"}`
    );
    return supported;
  })();

  return onlyUntracedProbe;
}
