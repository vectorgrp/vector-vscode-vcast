import * as vscode from "vscode";

// needed for parsing json files with comments
import * as jsonc from "jsonc-parser";

import { Uri } from "vscode";

import { errorLevel, vectorMessage } from "./messagePane";
import { getGlobalCoverageData } from "./vcastTestInterface";
import { rebuildEnvironment } from "./vcastAdapter";
import { rebuildEnvironmentCallback } from "./callbacks";
import { CachedWorkspaceData, EnviroData } from "./testPane";
import { executeWithRealTimeEchoWithProgress } from "./vcastCommandRunner";
import { getVectorCastInstallationLocation } from "./vcastInstallation";

const fs = require("fs");
const glob = require("glob");
const os = require("os");
const path = require("path");

// options used for reading json-c files
export const jsoncParseOptions: jsonc.ParseOptions = {
  allowTrailingComma: true,
  disallowComments: false,
  allowEmptyContent: false,
};
// note: we don't use this programmatically but it is useful for debugging
export var jsoncParseErrors: jsonc.ParseError[] = []; // not using programmatically, for debug only
export const jsoncModificationOptions: jsonc.ModificationOptions = {
  formattingOptions: { tabSize: 4, insertSpaces: true },
};

// The testInterface is delivered in the .vsix
// in the sub-directory "python"

// The VectorCAST extensions for settings and launch are delivered in the .vsix
// in the sub-directory "support"

export interface jsonDataType {
  jsonData: any;
  jsonDataAsString: string;
}

/**
 * Retrieves the environment path associated with a given file path.
 *
 * @param {string} filePath - The file path for which the environment path is needed.
 * @returns {string | null} The environment path if found, otherwise null.
 */
export function getEnvPathForFilePath(filePath: string): string | null {
  const globalCoverageMap = getGlobalCoverageData();
  const fileData = globalCoverageMap.get(filePath);
  if (fileData?.enviroList) {
    // Retrieve the first environment key, if it exists
    const envKey = Array.from(fileData.enviroList.keys())[0];
    if (envKey) {
      // Return the full environment key (entire path)
      return envKey;
    }
  }
  return null;
}

export function loadLaunchFile(jsonPath: string): jsonDataType | undefined {
  // this function takes the path to a launch.json
  // and returns the contents, or an empty list of configurations
  // if we cannot read the file
  let returnValue: jsonDataType | undefined = undefined;

  // Requires json-c parsing to handle comments etc.
  const existingContents = fs.readFileSync(jsonPath).toString();
  // note that jsonc.parse returns "real json" without the comments
  const existingJSONdata = jsonc.parse(
    existingContents,
    jsoncParseErrors,
    jsoncParseOptions
  );

  if (existingJSONdata) {
    returnValue = {
      jsonData: existingJSONdata,
      jsonDataAsString: existingContents,
    };
  }
  return returnValue;
}

/**
 *  Decodes a base64 encoded string.
 * @param b64 - The base64 encoded string to decode.
 * @returns The decoded string.
 */
export function decodeVar(b64: string): string {
  return Buffer.from(b64, "base64").toString("utf-8");
}

export function addLaunchConfiguration(
  fileUri: Uri,
  pathToSupportFiles: string
) {
  // This function adds the VectorCAST Harness Debug configuration to any
  // launch.json file that the user right clicks on

  const jsonPath = fileUri.fsPath;
  const existingLaunchData: jsonDataType | undefined = loadLaunchFile(jsonPath);

  const vectorJSON = JSON.parse(
    fs.readFileSync(path.join(pathToSupportFiles, "vcastLaunchTemplate.json"))
  );

  // if we have a well formatted launch file with an array of configurations ...
  if (
    existingLaunchData &&
    existingLaunchData.jsonData.configurations &&
    existingLaunchData.jsonData.configurations.length > 0
  ) {
    // Remember that the vectorJSON data has the "configurations" level which is an array
    const vectorConfiguration = vectorJSON.configurations[0];

    // now loop through launch.json to make sure it does not already have the vector config
    let needToAddVectorLaunchConfig = true;

    for (const existingConfig of existingLaunchData.jsonData.configurations) {
      if (existingConfig.name == vectorConfiguration.name) {
        vscode.window.showInformationMessage(
          `File: ${jsonPath}, already contains a ${vectorConfiguration.name} configuration`
        );
        needToAddVectorLaunchConfig = false;
        break;
      }
    }
    if (needToAddVectorLaunchConfig) {
      const whereToInsert = existingLaunchData.jsonData.configurations.length;
      let jsonDataAsString = existingLaunchData.jsonDataAsString;
      const jsoncEdits = jsonc.modify(
        jsonDataAsString,
        ["configurations", whereToInsert],
        vectorConfiguration,
        jsoncModificationOptions
      );
      jsonDataAsString = jsonc.applyEdits(jsonDataAsString, jsoncEdits);
      fs.writeFileSync(jsonPath, jsonDataAsString);
    }
  } else {
    // if the existing file is empty or does not contain a "configurations" section,
    // simply insert the vector config.  This allows the user to start with an empty file
    fs.writeFileSync(jsonPath, JSON.stringify(vectorJSON, null, 4));
  }
}

const filesExcludeString = "files.exclude";
export function addSettingsFileFilter(
  fileUri: Uri,
  pathToSupportFiles: string
) {
  const filePath = fileUri.fsPath;
  let existingJSON;
  let existingJSONasString: string;

  try {
    // Requires json-c parsing to handle comments etc.
    existingJSONasString = fs.readFileSync(filePath).toString();
    // note that jsonc.parse returns "real json" without the comments
    existingJSON = jsonc.parse(
      existingJSONasString,
      jsoncParseErrors,
      jsoncParseOptions
    );
  } catch {
    vscode.window.showErrorMessage(
      `Could not load the existing ${path.basename(
        filePath
      )}, check for syntax errors`
    );
    return;
  }

  // if the file does not have a "files.exclude" section, add one
  if (!existingJSON.hasOwnProperty(filesExcludeString)) {
    // we don't need to modify the existing jsonAsString
    // because it will do the insert of a new section for us
    existingJSON[filesExcludeString] = {};
  }

  // Remember that the vectorJSON data has the "configurations" level which is an array
  const vectorJSON = JSON.parse(
    fs.readFileSync(path.join(pathToSupportFiles, "vcastSettings.json"))
  );

  // now check if the vector filters are already in the files.exclude object
  if (
    existingJSON[filesExcludeString].hasOwnProperty("vectorcast-filter-start")
  ) {
    vscode.window.showInformationMessage(
      `File: ${filePath}, already contains the VectorCAST exclude patterns`
    );
  } else {
    const mergedExcludeList = Object.assign(
      existingJSON["files.exclude"],
      vectorJSON["files.exclude"]
    );
    const jsoncEdits = jsonc.modify(
      existingJSONasString,
      [filesExcludeString],
      mergedExcludeList,
      jsoncModificationOptions
    );
    existingJSONasString = jsonc.applyEdits(existingJSONasString, jsoncEdits);

    fs.writeFileSync(filePath, existingJSONasString);
  }
}

export interface statusMessageType {
  fullLines: string;
  remainderText: string;
}
export function processCommandOutput(
  remainderTextFromLastCall: string,
  newTextFromThisCall: string
): statusMessageType {
  // The purpose of this function is to process the raw text that comes
  // from the spawned process and to split it into full lines and a "remainder"
  // The caller will keep the remainder around until the next data comes in
  // and then pass that in with the new text.

  let returnObject: statusMessageType = { fullLines: "", remainderText: "" };
  const candidateString = remainderTextFromLastCall + newTextFromThisCall;

  if (candidateString.endsWith("\n"))
    // if we got all full lines, there is no remainder
    returnObject.fullLines = candidateString.slice(
      0,
      candidateString.length - 1
    );
  else if (candidateString.includes("\n")) {
    // if there is at least one \n then we have full lines and a remainder
    const whereToSplit = candidateString.lastIndexOf("\n");
    returnObject.fullLines = candidateString.substring(0, whereToSplit);
    returnObject.remainderText = candidateString.substring(
      whereToSplit + 1,
      candidateString.length
    );
  } else {
    // otherwise we have only a remainder
    returnObject.remainderText = candidateString;
  }

  return returnObject;
}

export function exeFilename(basename: string): string {
  if (os.platform() == "win32") return basename + ".exe";
  else return basename;
}

export function forceLowerCaseDriveLetter(path?: string): string {
  // There is an issue with drive letter case between TS and Python
  // On windows, the drive letter is always lower case here in TS
  // but in python, the calls to abspath, and realpath force the
  // drive letter to be upper case.

  if (path) {
    const platform = os.platform();
    if (platform == "win32") {
      if (path.charAt(1) == ":") {
        const driveLetter = path.charAt(0).toLowerCase();
        return driveLetter + path.slice(1, path.length);
      }
    }
    return path;
  } else return "";
}

export function normalizePath(path: string): string {
  // This function is used to fix the drive letter AS WELL AS
  // replace any backslashes with forward slashes

  let returnPath = path;
  if (os.platform() == "win32") {
    returnPath = forceLowerCaseDriveLetter(path).replace(/\\/g, "/");
  }
  return returnPath;
}

// Source file extensions the extension supports for VectorCAST environments.
// Ada (.adb/.ads) is included, but note that Ada is not a built-in VS Code
// language, so we key off the file extension rather than the editor languageId
// (an unopened Ada file resolves to languageId "plaintext").
export const supportedSourceExtensions = [
  ".c",
  ".cpp",
  ".cc",
  ".cxx",
  ".adb",
  ".ads",
];

export function isSupportedSourceFile(filePath: string): boolean {
  return supportedSourceExtensions.includes(
    path.extname(filePath).toLowerCase()
  );
}

// Ada source file extensions. Ada support is currently partial: existing Ada
// environments work (test tree, execution, coverage), but CREATING new Ada
// environments/projects is disabled for now (see notifyAdaFeatureDisabled)
// because parts of the toolchain (e.g. reqs2X / code2reqs) do not yet
// support Ada.
export const adaSourceExtensions = [".adb", ".ads"];

export function isAdaSourceFile(filePath: string): boolean {
  return adaSourceExtensions.includes(path.extname(filePath).toLowerCase());
}

/**
 * Best-effort detection of an Ada environment from its .env file, before it is
 * built (we cannot use the DataAPI is_ada flag until the env exists). We look
 * for the GNAT compiler and/or a GNAT project (.gpr) parent library.
 * @param envFilePath
 * @returns
 */
export function enviroFileIsAda(envFilePath: string): boolean {
  try {
    const contents = fs.readFileSync(envFilePath, "utf8");
    for (const rawLine of contents.split(/\r?\n/)) {
      const line = rawLine.trim().toUpperCase();
      if (line.startsWith("ENVIRO.COMPILER:")) {
        if (line.split(":")[1]?.trim() === "GNAT") return true;
      }
      if (line.startsWith("ENVIRO.PARENT_LIB:") && line.endsWith(".GPR")) {
        return true;
      }
    }
  } catch {
    // If we cannot read the file, do not block.
  }
  return false;
}

/**
 * Compiler-agnostic detection of a BUILT Ada environment.
 * We check the build working directory (the env directory's parent, where it is
 * written) and the env directory itself, to be robust.
 * @param enviroPath path to the built environment directory
 * @returns true if the environment is Ada
 */
export function builtEnviroIsAda(enviroPath: string): boolean {
  const adaHarnessConfig = "ADACAST_.CFG";
  const candidates = [
    path.join(path.dirname(enviroPath), adaHarnessConfig),
    path.join(enviroPath, adaHarnessConfig),
  ];
  return candidates.some((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
}

const adaConfigFilename = "ADACAST_.CFG";

// Derive the VectorCAST Ada UNIT name from a source file.
//
// Two dash-named-on-disk cases look identical by filename but are different
// units:
//   - a CHILD unit  (warehouse-orders.adb -> package WAREHOUSE.ORDERS) is its
//     own unit; the name is the dash->dot, upper-cased base name.
//   - a SEPARATE SUBUNIT (calculator-power.adb -> "separate (Calculator) ...")
//     is NOT a unit of its own; it folds into its PARENT (CALCULATOR). Marking
//     the subunit as a UUT makes VectorCAST fail ("cannot find the source file
//     for CALCULATOR.POWER").
//
// We disambiguate by content: if the file has a `separate (Parent)` clause it is
// a subunit and we return the parent unit; otherwise we use the file base name.
// VectorCAST reports Ada unit names in upper case.
const SEPARATE_CLAUSE = /^\s*separate\s*\(\s*([A-Za-z0-9_.]+)\s*\)/im;

export function adaUnitNameFromFile(filePath: string): string {
  try {
    const contents = fs.readFileSync(filePath, "utf8");
    const match = SEPARATE_CLAUSE.exec(contents);
    if (match) return match[1].toUpperCase();
  } catch {
    // fall through to the file-name based derivation
  }
  const base = path.basename(filePath, path.extname(filePath));
  return base.replace(/-/g, ".").toUpperCase();
}

// Best-effort check that a host GNAT toolchain is available on PATH. We only
// support GNAT-on-host for Ada environment creation, and the build (which shells
// out to the compiler via the CFG) needs gnat/gprbuild reachable.
export function isGnatAvailable(): boolean {
  const { execSync } = require("child_process");
  for (const probe of ["gnatls --version", "gnat --version"]) {
    try {
      execSync(probe, { stdio: "ignore" });
      return true;
    } catch {
      // try the next probe
    }
  }
  return false;
}

// Ensure a minimal GNAT-on-host ADACAST_.CFG exists in the given directory.
// Leaves an existing config untouched (the user may have a customized one).
export function ensureAdaConfigurationFile(cwd: string): void {
  const configPath = path.join(cwd, adaConfigFilename);
  if (fs.existsSync(configPath)) {
    vectorMessage(`Using the existing Ada configuration file: ${configPath}`);
    return;
  }
  vectorMessage(`Creating a GNAT (host) Ada configuration file: ${configPath}`);
  fs.writeFileSync(
    configPath,
    "COMPILATION_SYSTEM: GNAT\nTARGET_VARIANT: HOST\n"
  );
}

// Generate a minimal GNAT project (.gpr) in `cwd` whose Source_Dirs point at
// the given Ada source directories, and return its file name. Ada environments
// are built in a different directory than the sources (e.g. unitTests/), and
// ENVIRO.SEARCH_LIST is NOT enough for Ada. VectorCAST needs the units in an
// Ada "library". Referencing this GPR via ENVIRO.PARENT_LIB lets clicast build
// the library itself (no separate gprbuild step required). The project/file
// name must be a valid Ada identifier, so the environment name is sanitized.
export function generateAdaProjectFile(
  cwd: string,
  enviroName: string,
  sourceDirs: string[]
): string {
  let base = enviroName.replace(/[^A-Za-z0-9_]/g, "_");
  if (!/^[A-Za-z]/.test(base)) base = `vc_${base}`;
  const gprFileName = `${base}.gpr`;
  // GPR accepts forward slashes on all platforms; absolute dirs are fine.
  const dirs = sourceDirs
    .map((dir) => `"${dir.replace(/\\/g, "/")}"`)
    .join(", ");
  const contents =
    `project ${base} is\n` +
    `   for Source_Dirs use (${dirs});\n` +
    `   for Object_Dir use "${base}_obj";\n` +
    `end ${base};\n`;
  fs.writeFileSync(path.join(cwd, gprFileName), contents);
  return gprFileName;
}

// Confirm (modal) that the user wants to proceed with the GNAT-only Ada path,
// and that GNAT is actually available. Returns true only if we should continue.
// `action` is a short verb phrase, e.g. "Create an Ada environment".
export async function confirmAdaGnatCreation(action: string): Promise<boolean> {
  if (!isGnatAvailable()) {
    const message =
      `${action}: no GNAT toolchain was found on PATH. Only GNAT on the ` +
      `host is supported for Ada; install GNAT / add it to PATH and retry.`;
    vscode.window.showErrorMessage(message);
    vectorMessage(message, errorLevel.warn);
    return false;
  }
  // Non-modal info message; the user must click "Continue" to proceed
  // (dismissing it aborts).
  const answer = await vscode.window.showInformationMessage(
    `${action}: only GNAT on the host is currently supported for Ada ` +
      `environments. Do you wish to continue?`,
    "Continue",
    "Cancel"
  );
  return answer === "Continue";
}

// Show a popup AND log to the output panel explaining that an Ada action is
// currently disabled. Used to gate features that do not work for Ada yet (e.g.
// ATG test generation) while the rest of the toolchain catches up.
export function notifyAdaFeatureDisabled(action: string): void {
  const message =
    `${action} is currently disabled for Ada. Existing Ada environments ` +
    `still work, but this action is not supported for Ada yet.`;
  // Popup for the user ...
  vscode.window.showErrorMessage(message);
  // ... and a record in the output panel (warn does not trigger its own
  // popup, so this does not double up with the showErrorMessage above).
  vectorMessage(message, errorLevel.warn);
}

/**
 * this function returns a single line range DecorationOption
 * @param lineIndex line index to be used for the range
 * @returns DecorationOptions for the line
 */
export function getRangeOption(lineIndex: number): vscode.DecorationOptions {
  // If we start the extension with a cpp file opened and in focus, lineIndex is -1 because the cursor is not
  // on a line. We need to set it to 0 in that case
  if (lineIndex < 0) {
    lineIndex = 0;
  }
  const startPos = new vscode.Position(lineIndex, 0);
  const endPos = new vscode.Position(lineIndex, 0);
  return { range: new vscode.Range(startPos, endPos) };
}

export function openFileWithLineSelected(
  filePath: string,
  lineNumber: number,
  viewColumn: vscode.ViewColumn = vscode.ViewColumn.One
) {
  const locationToHighlight: vscode.Range = new vscode.Range(
    new vscode.Position(lineNumber, 0),
    new vscode.Position(lineNumber, 200)
  );

  let viewOptions: vscode.TextDocumentShowOptions = {
    viewColumn: viewColumn,
    preserveFocus: false,
    selection: locationToHighlight,
  };
  vscode.workspace.openTextDocument(filePath).then(
    (doc: vscode.TextDocument) => {
      vscode.window.showTextDocument(doc, viewOptions);
    },
    (error: any) => {
      vectorMessage(error.message, errorLevel.error);
    }
  );
}

export function quote(name: string) {
  // if name contains <<COMPOUND>>, <<INIT>> or parenthesis
  // we need to quote the name so that the shell does not interpret it.

  if (
    name.includes("<") ||
    name.includes(">") ||
    name.includes("(") ||
    name.includes(")")
  ) {
    return '"' + name + '"';
  } else return name;
}

export function showSettings() {
  console.log("VectorCAST Test Explorer show settings called ...");
  // previously, I was using: "VectorCAST Test Explorer" as the "filter" in this call, but
  // that resulted in a couple of extra settings, and the wrong order being displayed
  // through trial and error, I found that this gives what we want
  vscode.commands.executeCommand(
    "workbench.action.openWorkspaceSettings",
    "@ext:vectorgroup.vectorcasttestexplorer"
  );
}

export function removeFilePattern(enviroPath: string, pattern: string) {
  const options = {
    cwd: path.dirname(enviroPath),
    absolute: true,
    strict: false,
  };
  let fileList = glob.sync(`${path.basename(enviroPath)}${pattern}`, options);
  for (let filePath of fileList) {
    fs.unlinkSync(filePath);
  }
}

/**
 * Cleans the message we want to show in the output. The Test Results pane handles logs differently.
 * @param testResultString Test result we want to clean
 * @returns Cleaned message, ready for the Test Results pane
 */
export function cleanTestResultsPaneMessage(testResultString: string) {
  let cleanedOutput = testResultString.split("\n");

  // Determine the leading spaces in the second line
  // We want that the first line is left-aligned, and all subsequent lines are aligned to the second line
  let secondLine = cleanedOutput[1] || "";
  let secondLinePadding = secondLine.match(/^(\s*)/)?.[0] || "";

  // Align all lines after the first one to match the second line's padding
  let alignedOutput = cleanedOutput
    .map((line, index) => {
      // First line stays unmodified
      if (index === 0) {
        return line.trim();
      }
      // Apply second line padding to subsequent lines
      return secondLinePadding + line.trim();
    })
    .join("\r\n");

  return alignedOutput;
}

/**
 * Updates the env file with the new settings from the VSCode settings
 */
export async function updateCoverageAndRebuildEnv() {
  const globalCoverageMap = getGlobalCoverageData();
  const mapValues = [...globalCoverageMap.values()];
  let envArray: string[] = [];

  for (let envValues of mapValues) {
    for (let enviroPath of envValues["enviroList"].keys()) {
      // If multiple units are in the env, the env is there multiple times
      if (!envArray.includes(enviroPath)) {
        envArray.push(enviroPath);
      }
    }
  }
  // Now rebuild every env so that the coverage is updated
  for (let enviroPath of envArray) {
    await rebuildEnvironment(enviroPath, rebuildEnvironmentCallback);
  }
}

/**
 * Returns the root of the opened workspace.
 */
export function getWorkspaceRootPaths(): string[] {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return [];
  return folders.map((f) => f.uri.fsPath);
}

/**
 * Merges multiple workspace responses into a single CachedWorkspaceData object.
 */
export async function mergeWorkspaceEnvResponses(
  responses: CachedWorkspaceData[]
): Promise<CachedWorkspaceData> {
  const allErrors: string[] = [];
  const allEnvs: EnviroData[] = [];

  for (const resp of responses) {
    if (!resp) continue;
    if (resp.errors) {
      allErrors.push(...resp.errors);
    }
    if (resp.enviro) {
      allEnvs.push(...resp.enviro);
    }
  }

  return {
    enviro: allEnvs,
    errors: allErrors.length ? allErrors : undefined,
  };
}

export async function getFullEnvReport(
  buildDirectory: string,
  enviroPath: string
): Promise<string> {
  // Derive environment name
  const envName = path.basename(enviroPath);
  const cwd = path.dirname(buildDirectory);

  // Build HTML output path
  const htmlReportPath = path.join(
    buildDirectory,
    `${envName}_full_report.html`
  );

  // Get VectorCAST installation directory
  const vectorcastDir = getVectorCastInstallationLocation();
  if (!vectorcastDir) {
    vscode.window.showErrorMessage(
      "VECTORCAST_DIR environment variable is not set."
    );
    throw new Error("VECTORCASTDIR not set");
  }

  // Build command and arguments
  const command = path.join(vectorcastDir, "clicast");
  const args = ["-e", envName, "report", "custom", "full", htmlReportPath];

  // Optional: progress message for the VSCode UI
  const vscodeMessage = `Generating full environment report for '${envName}'...`;

  // Execute with progress + live output
  await executeWithRealTimeEchoWithProgress(command, args, cwd, vscodeMessage);

  // Return the generated HTML file path
  return htmlReportPath;
}
