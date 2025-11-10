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
} from "./requirementsOperations";
import { makeEnviroNodeID } from "../testPane";

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

  return gatewayPath;
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
  // Check if the directory contains an environment file
  const files = fs.readdirSync(dirPath);
  const envFiles = files.filter((file: string) => file.endsWith(".env"));

  // Now see if there is a directory with the same name as the env file
  for (const file of envFiles) {
    // remove ".env"
    const envName = file.slice(0, -4);
    const envDirPath = path.join(dirPath, envName);
    if (fs.existsSync(envDirPath) && fs.lstatSync(envDirPath).isDirectory()) {
      return envName;
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
    requirementsFileWatcher =
      workspace.createFileSystemWatcher("**/reqs.{csv,xlsx}");

    // When a requirements file is created
    requirementsFileWatcher.onDidCreate(
      async (uri) => {
        logCliOperation(`Requirements file created: ${uri.fsPath}`);
        const changeDir = path.dirname(uri.fsPath);
        const envDirName = findEnvironmentInPath(changeDir);
        if (envDirName) {
          const envPath = path.join(changeDir, envDirName);
          updateRequirementsAvailability(envPath);
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
        const envDirName = findEnvironmentInPath(parentDir);
        if (envDirName) {
          const envPath = path.join(parentDir, envDirName);
          updateRequirementsAvailability(envPath);
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
    // Leave it unchanged if not found
    return value ? value : match;
  });
}
