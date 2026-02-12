import * as vscode from "vscode";
import { workspace } from "vscode";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { parse as csvParse } from "csv-parse/sync";
import { vcastInstallationDirectory } from "../vcastInstallation";
import { exeFilename, normalizePath, showSettings } from "../utilities";
import {
  LLM2CHECK_EXECUTABLE_PATH,
  logCliError,
  logCliOperation,
  TEST2CHECK_EXECUTABLE_PATH,
} from "./requirementsOperations";
import { makeEnviroNodeID } from "../testPane";
import { dumpTestScriptFile } from "../vcastAdapter";
import { convertTestScriptContents } from "../vcastUtilities";
import { testNodeType } from "../testData";
import {
  enterReviewMode,
  exitReviewMode,
  updateDisplayedCoverage,
} from "../coverage";
import { getCoverageDataForFile } from "../vcastTestInterface";

const path = require("path");
const fs = require("fs");
const excelToJson = require("convert-excel-to-json");

const NECCESSARY_REQS2X_EXECUTABLES = [
  "code2reqs",
  "reqs2tests",
  "panreq",
  "llm2check",
];

export let alreadyInitializedFileWatchers: boolean = false;
export let requirementsFileWatcher: vscode.FileSystemWatcher | undefined;

let existingEnvs: string[] = [];

/**
 * Find the most relevant requirement gateway for a given environment path
 * @param enviroPath The environment path
 * @returns The most relevant gateway path, or null if none found
 */
export function findRelevantRequirementGateway(
  enviroPath: string
): string | null {
  const parentDir = path.dirname(enviroPath);
  const configPath = path.join(parentDir, "CCAST_.CFG");

  const configContent = fs.readFileSync(configPath, "utf-8");

  const gatewayMatch = configContent.match(/VCAST_REPOSITORY:\s*(.+)\s*/);

  if (gatewayMatch == null) {
    return null;
  }

  // Expand variables before checking existence
  const rawGatewayPath = gatewayMatch[1].trim();
  const gatewayPath = expandEnvVars(rawGatewayPath);

  if (!fs.existsSync(gatewayPath)) {
    return null;
  }

  return rawGatewayPath;
}

export async function parseRequirementsFromFile(
  filePath: string
): Promise<any[]> {
  try {
    if (filePath.endsWith(".xlsx")) {
      const result = excelToJson({
        sourceFile: filePath,
      }).Requirements;

      const columnNames: string[] = Object.values(result[0]);

      const requirements = [];

      console.log(columnNames, result);

      for (const row of result.slice(1)) {
        const requirement: Record<string, string> = {};
        for (let i = 0; i < columnNames.length; i++) {
          requirement[columnNames[i]] = Object.values(row)[i] as string;
        }
        requirements.push(requirement);
      }

      return requirements;
    } else {
      const fileContent = await fs.promises.readFile(filePath, "utf8");
      return csvParse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        ltrim: true,
        quote: '"',
      });
    }
  } catch (error) {
    logCliError(`Failed to parse requirements file: ${error}`, true);
    throw error;
  }
}

export function findEnvironmentInPath(dirPath: string): string | null {
  // dirPath will be the path were the requirements are, but the env files are in the parent folder
  const parentDir = path.dirname(dirPath);

  // the folder is named reqs-<envName>, so we cut out the correct env name to find the corresponding env file
  const baseFolder = path.basename(dirPath);
  const envName = baseFolder.split("reqs-")[1];

  // Check if the directory contains an environment file
  const files = fs.readdirSync(parentDir);
  const envFiles = files.filter((file: string) =>
    file.endsWith(`${envName}.env`)
  );

  // Now see if there is a directory with the same name as the env file
  for (const file of envFiles) {
    // remove ".env"
    const envName = file.slice(0, -4);
    const envDirPath = path.join(parentDir, envName);
    if (fs.existsSync(envDirPath) && fs.lstatSync(envDirPath).isDirectory()) {
      return envDirPath;
    }
  }
  return null;
}

export function setupRequirementsFileWatchers(
  context: vscode.ExtensionContext
) {
  if (alreadyInitializedFileWatchers) {
    return;
  }
  alreadyInitializedFileWatchers = true;

  if (workspace.workspaceFolders && workspace.workspaceFolders.length > 0) {
    // Create a file watcher that watches for requirements files changes
    // using a glob pattern to match all reqs.csv and reqs.xlsx files in the workspace
    requirementsFileWatcher = workspace.createFileSystemWatcher(
      "**/reqs-*/reqs.{csv,xlsx}"
    );

    // When a requirements file is created
    requirementsFileWatcher.onDidCreate(
      async (uri) => {
        logCliOperation(`Requirements file created: ${uri.fsPath}`);
        const changeDir = path.dirname(uri.fsPath);
        const envDirPath = findEnvironmentInPath(changeDir);
        if (envDirPath) {
          updateRequirementsAvailability(envDirPath);
        }
      },
      null,
      context.subscriptions
    );

    // When a requirements file is deleted
    requirementsFileWatcher.onDidDelete(
      async (uri) => {
        logCliOperation(`Requirements file deleted: ${uri.fsPath}`);
        const parentDir = path.dirname(uri.fsPath);
        const envDirPath = findEnvironmentInPath(parentDir);
        if (envDirPath) {
          updateRequirementsAvailability(envDirPath);
        }
      },
      null,
      context.subscriptions
    );

    // Register the watcher to be disposed when the extension deactivates
    context.subscriptions.push(requirementsFileWatcher);
  }
}

export function updateRequirementsAvailability(enviroPath: string) {
  const nodeID = makeEnviroNodeID(normalizePath(enviroPath));

  // the vcast: prefix to allow package.json nodes to control
  // when the VectorCAST context menu should be shown

  // Check if this environment has requirements
  const parentDir = path.dirname(enviroPath);
  const enviroNameWithExt = path.basename(enviroPath);
  // remove ".env" if present
  const enviroNameWithoutExt = enviroNameWithExt.replace(/\.env$/, "");
  const envReqsFolderPath = path.join(
    parentDir,
    `reqs-${enviroNameWithoutExt}`
  );

  const csvPath = path.join(envReqsFolderPath, "reqs.csv");
  const xlsxPath = path.join(envReqsFolderPath, "reqs.xlsx");

  const hasRequirementsFiles =
    fs.existsSync(csvPath) || fs.existsSync(xlsxPath);

  if (hasRequirementsFiles) {
    // Add this environment to the list if not already present
    if (!existingEnvs.includes(nodeID)) {
      const updatedEnvs = [...existingEnvs, nodeID];
      vscode.commands.executeCommand(
        "setContext",
        "vectorcastTestExplorer.vcastRequirementsAvailable",
        updatedEnvs
      );
      existingEnvs = updatedEnvs;
    }
  } else {
    // Remove this environment from the list if present
    const updatedEnvs = existingEnvs.filter((env) => env !== nodeID);
    vscode.commands.executeCommand(
      "setContext",
      "vectorcastTestExplorer.vcastRequirementsAvailable",
      updatedEnvs
    );
    existingEnvs = updatedEnvs;
  }
}

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

  // Resolve the location of the reqs2x executables according to the following priority:

  // 1. Reqs2X path setting
  const config = vscode.workspace.getConfiguration(
    "vectorcastTestExplorer.reqs2x"
  );
  const installationLocation = config.get<string>("installationLocation");

  if (installationLocation && pathHasAllExecutables(installationLocation)) {
    return vscode.Uri.file(installationLocation);
  }

  // 2. VectorCAST installation path setting
  if (pathHasAllExecutables(vcastInstallationDirectory)) {
    return vscode.Uri.file(vcastInstallationDirectory);
  }

  // 3. Search in vsixResourceBasePath

  // We need to check if we are on CI because in that case we have to use an alternate base dir to the resource files
  const isCI = process.env.HOME?.startsWith("/github") ?? false;

  // Base dir of the resource files should be here (see run-tests-workflow.yml/Pull latest reqs2tests release)
  const vsixResourceBasePath = `${process.env.GITHUB_WORKSPACE}/vsix`;

  // Check existence for debugging reasons
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
 * Generate HTML from requirements data
 */
export function generateRequirementsHtml(requirements: any[]): string {
  let htmlContent = `
      <html>
      <head>
          <title>Requirements</title>
          <style>
              body { font-family: Arial, sans-serif; margin: 20px; background-color: #ffffff; color: #000000; }
              h1 { color: #2c3e50; }
              h2 { color: #34495e; margin-top: 30px; }
              .requirement { background-color: #f7f7f7; padding: 15px; margin: 10px 0; border-radius: 5px; }
              .req-id { font-weight: bold; color: #2980b9; }
              .req-description { margin-top: 10px; color: #333333; }
          </style>
      </head>
      <body>
          <h1>Requirements</h1>
    `;

  // Group requirements by function
  const requirementsByFunction: Record<string, any[]> = {};
  for (const req of requirements) {
    const funcName = req.Function || req.Module || "Unknown Function";
    if (!requirementsByFunction[funcName]) {
      requirementsByFunction[funcName] = [];
    }
    requirementsByFunction[funcName].push(req);
  }

  // Generate HTML content for each function
  for (const [funcName, reqs] of Object.entries(requirementsByFunction)) {
    htmlContent += `<h2>${funcName}</h2>`;
    for (const req of reqs) {
      htmlContent += `
          <div class="requirement">
              <div class="req-id">${req.ID || "No ID"}</div>
              <div class="req-description">${
                req.Description || "No Description"
              }</div>
          </div>
        `;
    }
  }

  htmlContent += "</body></html>";
  return htmlContent;
}

export interface LLMProviderSettingsResult {
  provider: string | null;
  env: Record<string, string>;
  missing: string[];
}

export function isLLMProviderEnvironmentUsable(): Promise<{
  usable: boolean;
  problem: string | null;
}> {
  const processEnv = { ...process.env };

  const gatheredSettings = gatherLLMProviderSettings();
  for (const [k, v] of Object.entries(gatheredSettings.env)) {
    if (v) processEnv[k] = v;
  }

  if (
    vscode.workspace
      .getConfiguration("vectorcastTestExplorer.reqs2x")
      .get<boolean>("modelCompatibilityMode", false)
  ) {
    processEnv.VCAST_REQS2X_MODEL_COMPATIBILITY_MODE = "1";
  }

  const proc = spawn(LLM2CHECK_EXECUTABLE_PATH, ["--json"], {
    env: processEnv,
  });

  return new Promise((resolve) => {
    let output = "";
    proc.stdout.on("data", (data) => {
      output += data.toString();
    });

    proc.on("close", () => {
      try {
        const result = JSON.parse(output);
        resolve({ usable: result.usable, problem: result.problem || null });
      } catch (e) {
        console.error(`Failed to parse llm2check output: ${e}`);
        resolve({ usable: false, problem: "Failed to parse llm2check output" });
      }
    });
  });
}

export function gatherLLMProviderSettings(): LLMProviderSettingsResult {
  const config = vscode.workspace.getConfiguration("vectorcastTestExplorer");

  const provider = config.get<string>("reqs2x.provider");
  const baseEnv: Record<string, string> = {};
  const missing: string[] = [];

  if (!provider) {
    missing.push("Provider (reqs2x.provider)");
    return { provider: null, env: baseEnv, missing };
  }

  function need(value: string | undefined, label: string, envVarName: string) {
    if (!value) {
      missing.push(label);
      return;
    }
    baseEnv[envVarName] = value;
  }

  function optional(value: string | undefined, envVarName: string) {
    if (value) {
      baseEnv[envVarName] = value;
    }
  }

  if (provider === "azure_openai") {
    need(
      config.get<string>("reqs2x.azure.baseUrl"),
      "Azure Base URL",
      "VCAST_REQS2X_AZURE_OPENAI_BASE_URL"
    );
    need(
      config.get<string>("reqs2x.azure.apiKey"),
      "Azure API Key",
      "VCAST_REQS2X_AZURE_OPENAI_API_KEY"
    );
    need(
      config.get<string>("reqs2x.azure.deployment"),
      "Azure Deployment",
      "VCAST_REQS2X_AZURE_OPENAI_DEPLOYMENT"
    );
    need(
      config.get<string>("reqs2x.azure.modelName"),
      "Azure Model Name",
      "VCAST_REQS2X_AZURE_OPENAI_MODEL_NAME"
    );
    need(
      config.get<string>("reqs2x.azure.apiVersion"),
      "Azure API Version",
      "VCAST_REQS2X_AZURE_OPENAI_API_VERSION"
    );
    optional(
      config.get<string>("reqs2x.azure.reasoningModelName"),
      "VCAST_REQS2X_REASONING_AZURE_OPENAI_MODEL_NAME"
    );
    optional(
      config.get<string>("reqs2x.azure.reasoningDeployment"),
      "VCAST_REQS2X_REASONING_AZURE_OPENAI_DEPLOYMENT"
    );
  } else if (provider === "openai") {
    optional(
      config.get<string>("reqs2x.openai.baseUrl"),
      "VCAST_REQS2X_OPENAI_BASE_URL"
    );
    need(
      config.get<string>("reqs2x.openai.apiKey"),
      "OpenAI API Key",
      "VCAST_REQS2X_OPENAI_API_KEY"
    );
    need(
      config.get<string>("reqs2x.openai.modelName"),
      "OpenAI Model Name",
      "VCAST_REQS2X_OPENAI_MODEL_NAME"
    );
    optional(
      config.get<string>("reqs2x.openai.reasoningModelName"),
      "VCAST_REQS2X_REASONING_OPENAI_MODEL_NAME"
    );
  } else if (provider === "anthropic") {
    need(
      config.get<string>("reqs2x.anthropic.apiKey"),
      "Anthropic API Key",
      "VCAST_REQS2X_ANTHROPIC_API_KEY"
    );
    need(
      config.get<string>("reqs2x.anthropic.modelName"),
      "Anthropic Model Name",
      "VCAST_REQS2X_ANTHROPIC_MODEL_NAME"
    );
    optional(
      config.get<string>("reqs2x.anthropic.reasoningModelName"),
      "VCAST_REQS2X_REASONING_ANTHROPIC_MODEL_NAME"
    );
  } else if (provider === "litellm") {
    need(
      config.get<string>("reqs2x.litellm.modelName"),
      "LiteLLM Model Name",
      "VCAST_REQS2X_LITELLM_MODEL_NAME"
    );
    optional(
      config.get<string>("reqs2x.litellm.reasoningModelName"),
      "VCAST_REQS2X_REASONING_LITELLM_MODEL_NAME"
    );

    const litellmProviderEnvVarsString = config.get<string>(
      "reqs2x.litellm.providerEnvVars",
      ""
    );
    const entries = litellmProviderEnvVarsString
      .split(",")
      .map((pair) => pair.split("="))
      .filter((kv) => kv[0].trim().length);

    if (entries.some((entryValues) => entryValues.length !== 2)) {
      missing.push(
        "LiteLLM Provider Environment Variables must be KEY=VALUE pairs"
      );
    } else {
      for (const [key, value] of entries) {
        baseEnv[key.trim()] = value.trim();
      }
    }
  } else {
    missing.push("Unsupported provider value");
  }

  return { provider, env: baseEnv, missing };
}

export async function performLLMProviderUsableCheck(): Promise<boolean> {
  const { usable, problem } = await isLLMProviderEnvironmentUsable();

  const gatheredSettings = gatherLLMProviderSettings();

  if (!usable) {
    // TODO: Error based on what the problem was i.e. missing stuff or something else
    const causedByMissing = problem?.includes(
      "No provider configuration found"
    );

    let errorMessage: string;

    if (causedByMissing) {
      errorMessage = `Required information to run Reqs2X with currently selected LLM provider (${gatheredSettings.provider}) is missing: ${gatheredSettings.missing.join(", ")}`;
    } else {
      errorMessage = `The current LLM provider settings for Reqs2X (either set in the extension or in the environment) are not usable: ${problem}`;
    }

    vscode.window
      .showErrorMessage(errorMessage, "Open Settings")
      .then((choice) => {
        if (choice === "Open Settings") {
          showSettings();
        }
      });

    return false;
  }

  return true;
}

export async function createProcessEnvironment(): Promise<NodeJS.ProcessEnv> {
  const processEnv = { ...process.env };

  // Setup correct VectorCAST directory variable
  processEnv.VSCODE_VECTORCAST_DIR = vcastInstallationDirectory;

  // Setup LLM provider settings
  const gatheredSettings = gatherLLMProviderSettings();

  for (const [k, v] of Object.entries(gatheredSettings.env)) {
    if (v) processEnv[k] = v;
  }

  // Add non-provider specific settings (language, debug) here
  const config = vscode.workspace.getConfiguration(
    "vectorcastTestExplorer.reqs2x"
  );
  const languageCode = config.get<string>("generationLanguage", "en");
  processEnv.VCAST_REQS2X_RESPONSE_LANGUAGE = languageCode;

  if (config.get<boolean>("outputDebugInfo", false)) {
    processEnv.VCAST_REQS2X_LOG_LEVEL = "debug";
  }

  if (config.get<boolean>("modelCompatibilityMode", false)) {
    processEnv.VCAST_REQS2X_MODEL_COMPATIBILITY_MODE = "1";
  }

  // Return the constructed environment
  return processEnv;
}

export async function spawnWithVcastEnv(
  command: string,
  args: string[],
  options: any = {}
): Promise<ChildProcessWithoutNullStreams> {
  const checkSuccessful = await performLLMProviderUsableCheck(); // Check if the LLM provider settings are usable

  if (!checkSuccessful) {
    throw new Error("LLM provider settings are not usable");
  }

  const env = await createProcessEnvironment();
  return spawn(command, args, { ...options, env });
}

export function expandEnvVars(inputPath: string): string {
  return inputPath.replace(/\$\(([^)]+)\)/g, (match, varName) => {
    const value = process.env[varName];

    if (!value) {
      vscode.window.showWarningMessage(
        `Environment variable "${varName}" in VCAST_REPOSITORY is not defined.`
      );
      // leave it as-is
      return match;
    }

    return value;
  });
}

export interface RequirementData {
  title: string;
  description: string;
  lineNumber: number;
  importantLineStart: number;
  importantLineEnd: number;
  coverageStatus: string;
  expectedLines: number[];
  actualLines: number[];
}

// State Management
export let activeHighlightDecoration: vscode.TextEditorDecorationType | null =
  null;

/**
 * Wraps a single line of text into an array of lines, each <= maxWidth chars
 */
function wrapText(text: string, maxWidth: number): string[] {
  if (text.length <= maxWidth) {
    return [text];
  }

  const lines: string[] = [];
  const words = text.split(" ");
  let current = "";

  for (const word of words) {
    // Word itself is longer than maxWidth — hard break it
    if (word.length > maxWidth) {
      if (current) {
        lines.push(current);
        current = "";
      }
      let remaining = word;
      while (remaining.length > maxWidth) {
        lines.push(remaining.slice(0, maxWidth));
        remaining = remaining.slice(maxWidth);
      }
      current = remaining;
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

/**
 * Creates a formatted text box containing requirement information.
 * Guarantees nothing escapes the box — title and description are both wrapped.
 */
export function createRequirementInfoBox(reqData: RequirementData): string {
  const BOX_WIDTH = 66; // total inner width (between the ║ borders)
  const PADDING = 2; // spaces on each side inside the border
  const TEXT_WIDTH = BOX_WIDTH - PADDING * 2; // usable text width = 62

  const topBorder = "╔" + "═".repeat(BOX_WIDTH) + "╗";
  const midBorder = "╠" + "═".repeat(BOX_WIDTH) + "╣";
  const bottomBorder = "╚" + "═".repeat(BOX_WIDTH) + "╝";
  const divider = "║  " + "─".repeat(TEXT_WIDTH) + "  ║";

  const formatLine = (text = ""): string => {
    // Should never exceed TEXT_WIDTH after wrapping
    const safe = text.length > TEXT_WIDTH ? text.slice(0, TEXT_WIDTH) : text;
    return "║  " + safe.padEnd(TEXT_WIDTH) + "  ║";
  };

  // Wraps a block of text (may contain \n) and returns boxed lines
  const formatBlock = (text: string): string[] => {
    const lines: string[] = [];

    for (const paragraph of text.split(/\r?\n/)) {
      if (!paragraph.trim()) {
        lines.push(formatLine());
        continue;
      }
      for (const wrapped of wrapText(paragraph, TEXT_WIDTH)) {
        lines.push(formatLine(wrapped));
      }
    }

    return lines;
  };

  return [
    "",
    topBorder,
    ...formatBlock(reqData.title),
    midBorder,
    formatLine("DESCRIPTION"),
    divider,
    ...formatBlock(reqData.description),
    bottomBorder,
    "",
  ].join("\n");
}

/**
 * Finds the line number containing the test name in the TST script
 */
export function findTestNameLine(tstContent: string, testName: string): number {
  const lines = tstContent.split("\n");
  const searchPattern = `TEST.NAME:${testName}`;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(searchPattern)) {
      return i;
    }
  }

  return 0; // Default to top of file if not found
}

// Decoration Types for highlighted critical lines
let activeUncoveredDecoration: vscode.TextEditorDecorationType | undefined;
let activePartiallyCoveredDecoration:
  | vscode.TextEditorDecorationType
  | undefined;
let activeCoveredDecoration: vscode.TextEditorDecorationType | undefined;

/**
 * Creates a decoration type for a given coverage state
 */
function createCoverageDecoration(
  bgColor: string,
  gutterColor: string
): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({
    backgroundColor: bgColor,
    isWholeLine: true,
    before: {
      contentText: "",
      border: `4px solid ${gutterColor}`,
      margin: "0 6px 0 0",
    },
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
 * Highlights critical lines individually based on coverage status
 */
export function highlightCriticalLines(
  editor: vscode.TextEditor,
  document: vscode.TextDocument,
  reqData: RequirementData,
  sourceFilePath: string
): void {
  // Dispose all previous decorations via shared helper
  disposeCriticalLineDecorations();

  const coverageData = getCoverageDataForFile(sourceFilePath);

  if (!coverageData?.hasCoverageData) {
    return;
  }

  // --- Decoration types ---
  activeUncoveredDecoration = createCoverageDecoration(
    "rgba(243, 74, 51, 0.15)", // red bg
    "#f34a33" // red gutter
  );
  activePartiallyCoveredDecoration = createCoverageDecoration(
    "rgba(245, 166, 35, 0.15)", // orange/yellow bg
    "#f5a623" // orange/yellow gutter
  );
  activeCoveredDecoration = createCoverageDecoration(
    "rgba(87, 184, 89, 0.15)", // green bg
    "#57b859" // green gutter
  );

  // Build a Set of critical line numbers for fast lookup
  const criticalLines = new Set<number>();
  for (
    let line = reqData.importantLineStart;
    line <= reqData.importantLineEnd;
    line++
  ) {
    criticalLines.add(line);
  }

  // Bucket each critical line into its coverage category
  const uncoveredSet = new Set(coverageData.uncovered);
  const partiallyCoveredSet = new Set(coverageData.partiallyCovered);
  const coveredSet = new Set(coverageData.covered);

  const uncoveredRanges: vscode.Range[] = [];
  const partiallyCoveredRanges: vscode.Range[] = [];
  const coveredRanges: vscode.Range[] = [];

  for (const line of criticalLines) {
    // Guard: skip lines beyond the document
    if (line > document.lineCount) {
      continue;
    }

    const range = lineToRange(document, line);

    if (uncoveredSet.has(line)) {
      uncoveredRanges.push(range);
    } else if (partiallyCoveredSet.has(line)) {
      partiallyCoveredRanges.push(range);
    } else if (coveredSet.has(line)) {
      coveredRanges.push(range);
    }
    // Lines not present in any coverage array are left un-decorated
  }

  // Apply all three decoration sets in one pass
  editor.setDecorations(activeUncoveredDecoration, uncoveredRanges);
  editor.setDecorations(
    activePartiallyCoveredDecoration,
    partiallyCoveredRanges
  );
  editor.setDecorations(activeCoveredDecoration, coveredRanges);
}

/**
 * Shows the requirement info box as a peek window
 * Automatically clears highlights when the peek window is closed
 */
export async function showRequirementPeekBox(
  sourceFileUri: vscode.Uri,
  peekPosition: vscode.Position,
  reqData: RequirementData,
  context: vscode.ExtensionContext
): Promise<void> {
  const virtualDocUri = vscode.Uri.parse("requirement-info:Requirement Info");
  const infoBoxContent = createRequirementInfoBox(reqData);

  // Create content provider for the virtual document
  const provider = new (class implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(): string {
      return infoBoxContent;
    }
  })();

  const providerDisposable =
    vscode.workspace.registerTextDocumentContentProvider(
      "requirement-info",
      provider
    );

  await vscode.workspace.openTextDocument(virtualDocUri);

  // Show peek window
  await vscode.commands.executeCommand(
    "editor.action.peekLocations",
    sourceFileUri,
    peekPosition,
    [new vscode.Location(virtualDocUri, new vscode.Position(0, 0))],
    "peek"
  );

  // Disable line numbers in peek window
  setTimeout(() => {
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.scheme === "requirement-info") {
        editor.options = {
          ...editor.options,
          lineNumbers: vscode.TextEditorLineNumbersStyle.Off,
        };
      }
    }
  }, 0);

  // Listen for when the peek window is closed and clear highlights + exit review mode
  const disposable = vscode.window.onDidChangeVisibleTextEditors(
    async (editors) => {
      const peekWindowOpen = editors.some(
        (editor) => editor.document.uri.scheme === "requirement-info"
      );

      if (!peekWindowOpen) {
        // Clear ALL coverage highlight decorations
        disposeCriticalLineDecorations();

        // Also clear the legacy single decoration if somehow still set
        if (activeHighlightDecoration) {
          activeHighlightDecoration.dispose();
          setActiveHighlightDecoration(null);
        }

        // Exit review mode and refresh normal coverage
        await exitReviewMode();
        updateDisplayedCoverage();

        // Clean up this listener
        disposable.dispose();
      }
    }
  );
  context.subscriptions.push(disposable);

  // Clean up provider after peek window is shown
  setTimeout(() => {
    providerDisposable.dispose();
  }, 1000);
}

/**
 * Disposes all active critical line decorations (all three coverage states)
 */
export function disposeCriticalLineDecorations(): void {
  activeUncoveredDecoration?.dispose();
  activePartiallyCoveredDecoration?.dispose();
  activeCoveredDecoration?.dispose();
  activeUncoveredDecoration = undefined;
  activePartiallyCoveredDecoration = undefined;
  activeCoveredDecoration = undefined;
}

/**
 * Opens the source file with requirement highlighting
 */
export async function openSourceFileWithHighlight(
  sourceFilePath: string,
  reqData: RequirementData,
  context: vscode.ExtensionContext,
  testName: string
): Promise<void> {
  const sourceFileUri = vscode.Uri.file(sourceFilePath);
  const document = await vscode.workspace.openTextDocument(sourceFileUri);

  // Position cursor near the requirement line
  const peekPosition = new vscode.Position(
    Math.max(0, reqData.lineNumber - 1),
    0
  );

  // Open document
  const editor = await vscode.window.showTextDocument(document, {
    preview: false,
    preserveFocus: false,
    selection: new vscode.Range(peekPosition, peekPosition),
  });

  // Enter review mode BEFORE applying decorations
  enterReviewMode(
    testName,
    reqData.expectedLines || [],
    reqData.actualLines || [],
    sourceFilePath
  );

  // Apply the green highlight to critical lines
  highlightCriticalLines(editor, document, reqData, sourceFilePath);

  // Show the peek box
  await showRequirementPeekBox(sourceFileUri, peekPosition, reqData, context);

  // Update coverage decorations to show review mode coverage
  await updateDisplayedCoverage();
}

/**
 * Opens the TST script and jumps to the test definition
 */
export async function openTstScriptAtTest(
  testNode: testNodeType,
  scriptPath: string
): Promise<void> {
  const commandStatus = await dumpTestScriptFile(testNode, scriptPath);

  if (commandStatus.errorCode !== 0) {
    return;
  }

  convertTestScriptContents(scriptPath);

  const tstScriptUri = vscode.Uri.file(scriptPath);
  const tstDocument = await vscode.workspace.openTextDocument(tstScriptUri);

  // Find the test name line in the script
  let targetLine = 0;
  if (testNode.testName) {
    const tstContent = tstDocument.getText();
    targetLine = findTestNameLine(tstContent, testNode.testName);
  }

  // Open document and jump to test definition
  const position = new vscode.Position(targetLine, 0);
  const selection = new vscode.Range(position, position);

  await vscode.window.showTextDocument(tstDocument, {
    viewColumn: vscode.ViewColumn.Beside,
    selection: selection,
    preview: false,
    preserveFocus: false,
  });
}

export function setActiveHighlightDecoration(
  decoration: vscode.TextEditorDecorationType | null
): void {
  activeHighlightDecoration = decoration;
}

/**
 * Fetches the requirements Data for a specific Test
 */
export async function fetchRequirementCoverageData(
  enviroPath: string,
  envRGWPath: string,
  testName: string,
  unitName: string,
  testNode: testNodeType,
  functionStartLine: number = 0
): Promise<RequirementData | null> {
  return vscode.window.withProgress<RequirementData | null>(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Retrieving requirement coverage data",
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: "Running test2check…" });

      const commandArgs = [
        "-e",
        enviroPath,
        envRGWPath,
        "-f",
        testName,
        "--json",
      ];

      try {
        const process = await spawnWithVcastEnv(
          TEST2CHECK_EXECUTABLE_PATH,
          commandArgs
        );

        const stdoutData: string[] = [];
        const stderrData: string[] = [];

        process.stdout.on("data", (data) => {
          stdoutData.push(data.toString());
        });

        process.stderr.on("data", (data) => {
          stderrData.push(data.toString());
          logCliError(`test2check: ${data.toString()}`);
        });

        await new Promise<void>((resolve, reject) => {
          process.on("close", (code: number) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`test2check exited with code ${code}`));
            }
          });
        });

        progress.report({ message: "Processing coverage results…" });

        const output = stdoutData.join("");
        if (!output.trim()) return null;

        const jsonData = JSON.parse(output);
        if (!Array.isArray(jsonData) || jsonData.length === 0) return null;

        if (jsonData.length > 1) {
          vscode.window.showInformationMessage(
            "This test is associated with multiple requirements. Coverage Review currently supports only one requirement per test."
          );
          return null;
        }

        const testResult = jsonData[0];
        const expectedCoverage = testResult.expected_coverage || {};
        const actualCoverage = testResult.actual_coverage || [];

        const unitCoverage = actualCoverage.find((cov: any) => {
          const covUnitBase = path.basename(cov.unit, path.extname(cov.unit));
          return covUnitBase === unitName || cov.unit === unitName;
        });

        let expectedLines: number[] = [];
        for (const funcKey in expectedCoverage) {
          const funcCoverage = expectedCoverage[funcKey];
          if (Array.isArray(funcCoverage)) {
            const unitExpected = funcCoverage.find(
              (cov: any) => cov.unit === unitName
            );
            if (unitExpected?.lines) {
              expectedLines = unitExpected.lines;
            }
          }
        }

        const minLine = expectedLines.length ? Math.min(...expectedLines) : 0;
        const maxLine = expectedLines.length ? Math.max(...expectedLines) : 0;

        return {
          title: testResult.name || testName,
          description: `${testNode.notes}`,
          lineNumber: functionStartLine,
          // + 1 Because Critical LInes are 0 Indexed
          importantLineStart: minLine + 1,
          importantLineEnd: maxLine + 1,
          coverageStatus: "covered",
          expectedLines,
          actualLines: unitCoverage?.lines || [],
        };
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
