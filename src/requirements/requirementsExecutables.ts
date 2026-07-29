import * as vscode from "vscode";
import { vcastInstallationDirectory } from "../vcastInstallation";
import { exeFilename } from "../utilities";
import { logCliError, logCliOperation } from "./requirementsLog";
import { runReqs2xTool } from "./processRunner";

const fs = require("fs");

const NECESSARY_REQS2X_EXECUTABLES = [
  "code2reqs",
  "reqs2tests",
  "panreq",
  "llm2check",
];

// Resolved at activation time via setupReqs2XExecutablePaths. Mutable
// module-level state so the rest of the requirements modules can depend on
// fixed names without each having to know how the binaries were located.
export let CODE2REQS_EXECUTABLE_PATH: string = "";
export let REQS2TESTS_EXECUTABLE_PATH: string = "";
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
  PANREQ_EXECUTABLE_PATH = vscode.Uri.joinPath(
    baseUri,
    exeFilename("panreq")
  ).fsPath;
  LLM2CHECK_EXECUTABLE_PATH = vscode.Uri.joinPath(
    baseUri,
    exeFilename("llm2check")
  ).fsPath;

  // A different binary may have been resolved; drop the cached help output.
  helpTextCache.clear();

  return true;
}

// Resolved exe path -> its `--help` output. The promise itself is cached so
// concurrent callers share one subprocess, and a failed probe stays cached as
// empty rather than re-running (and re-waiting out the timeout) every call.
const helpTextCache = new Map<string, Promise<string>>();

function reqs2xHelpText(exe: string): Promise<string> {
  const cached = helpTextCache.get(exe);
  if (cached) return cached;

  const probe = (async () => {
    try {
      const result = await runReqs2xTool({
        exe,
        args: ["--help"],
        captureOutput: true,
        allowNonZeroExit: true,
        timeoutMs: 10000,
      });
      return `${result.stdout ?? ""}${result.stderr ?? ""}`;
    } catch (err) {
      logCliError(`reqs2x capability probe failed for ${exe}: ${err}`);
      return "";
    }
  })();

  helpTextCache.set(exe, probe);
  return probe;
}

/**
 * Whether the resolved binary accepts `flag`, per its `--help`. The Reqs2X tools
 * ship with VectorCAST and are versioned independently of this extension, so an
 * older installation may predate a flag we would otherwise pass. Resolves to
 * `false` when unknown, so callers degrade instead of passing something the
 * binary rejects.
 */
async function reqs2xSupportsFlag(
  exe: string,
  flag: string
): Promise<boolean> {
  if (!exe) return false;
  return (await reqs2xHelpText(exe)).includes(flag);
}

/**
 * Filter `flags` down to those the binary accepts. One probe covers all of
 * them, since the help output is cached per binary. Reporting what is missing is
 * left to callers, which know whether the user actually asked for it.
 */
export async function reqs2xSupportedFlags(
  exe: string,
  flags: string[]
): Promise<Set<string>> {
  if (!exe) return new Set();
  const help = await reqs2xHelpText(exe);
  return new Set(flags.filter((flag) => help.includes(flag)));
}

// Recent enough that the installed Reqs2X may not have them, so they get probed
// before use.
export const RECENT_REQS2TESTS_FLAGS = [
  "--fast",
  "--max-test-examples",
  "--test-examples-sources",
];

export async function panreqSupportsOnlyUntraced(): Promise<boolean> {
  return reqs2xSupportsFlag(PANREQ_EXECUTABLE_PATH, "--only-untraced");
}

// Also recent; probed separately because it gates a command, not an argument.
export async function reqs2testsSupportsDelta(): Promise<boolean> {
  return reqs2xSupportsFlag(REQS2TESTS_EXECUTABLE_PATH, "--only-delta");
}
