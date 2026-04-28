import * as vscode from "vscode";
import { exeFilename, showSettings } from "../utilities";
import { refreshAllExtensionData } from "../testPane";
import { loadTestScriptIntoEnvironment } from "../vcastAdapter";

const path = require("path");
const fs = require("fs");

let reqs2XFeatureEnabled: boolean = false;

export const GENERATE_REQUIREMENTS_ENABLED: boolean = true;

let CODE2REQS_EXECUTABLE_PATH: string;
let REQS2TESTS_EXECUTABLE_PATH: string;

export let PANREQ_EXECUTABLE_PATH: string;
export let LLM2CHECK_EXECUTABLE_PATH: string;

const cliOutputChannel: vscode.OutputChannel = vscode.window.createOutputChannel(
  "VectorCAST Requirement Test Generation Operations"
);

export function logCliOperation(message: string): void {
  const timestamp = new Date().toLocaleTimeString();
  cliOutputChannel.appendLine(`[${timestamp}] ${message}`);
}

export function logCliError(
  message: string,
  show: boolean | null = null
): void {
  const timestamp = new Date().toLocaleTimeString();
  cliOutputChannel.appendLine(`[${timestamp}] ${message}`);
  if (show) {
    cliOutputChannel.show();
  }
}

export function initializeReqs2X(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration(
    "vectorcastTestExplorer.reqs2x"
  );
  reqs2XFeatureEnabled = config.get<boolean>("enableReqs2xFeature") || false;

  let featureEnabled: boolean = false;

  if (reqs2XFeatureEnabled) {
    const successful = setupReqs2XExecutablePaths(context);
    if (!successful) {
      vscode.window
        .showErrorMessage(
          "Could not find the reqs2X executables anywhere, disabling Reqs2X. Please check your settings.",
          "Open Settings"
        )
        .then((selection) => {
          if (selection === "Open Settings") showSettings();
        });
    } else {
      featureEnabled = true;
    }
  }

  vscode.commands.executeCommand(
    "setContext",
    "vectorcastTestExplorer.reqs2xFeatureEnabled",
    featureEnabled
  );
}

function setupReqs2XExecutablePaths(context: vscode.ExtensionContext): boolean {
  // Lazy import to break the circular dependency:
  // availability → requirementsOperations (for log helpers) → availability.
  const {
    getAutoreqExecutableDirectory,
  } = require("./availability") as typeof import("./availability");

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

  return true;
}

export async function generateRequirements(enviroPath: string) {
  const {
    defaultRequirementGatewayPath,
    findRelevantRequirementGateway,
    setVcastRepositoryInConfig,
  } = require("./rgwPath") as typeof import("./rgwPath");
  const { updateRequirementsAvailability } =
    require("./availability") as typeof import("./availability");
  const { runReqs2xTool } =
    require("./processRunner") as typeof import("./processRunner");

  const parentDir = path.dirname(enviroPath);
  const lowestDirname = path.basename(enviroPath);
  const envName = `${lowestDirname}.env`;
  const envPath = path.join(parentDir, envName);

  // Resolve the RGW path: use an already-configured VCAST_REPOSITORY if set,
  // otherwise fall back to the extension's default location and write it into
  // CCAST_.CFG so subsequent operations find the same gateway.
  let repositoryDir = findRelevantRequirementGateway(enviroPath);
  if (repositoryDir) {
    const choice = await vscode.window.showWarningMessage(
      `Warning: An existing requirements gateway was found at ${repositoryDir}. Generating requirements will overwrite it.`,
      "Continue",
      "Cancel"
    );
    if (choice !== "Continue") return;
  } else {
    repositoryDir = defaultRequirementGatewayPath(enviroPath);
    fs.mkdirSync(path.dirname(repositoryDir), { recursive: true });
    setVcastRepositoryInConfig(enviroPath, repositoryDir);
  }

  const config = vscode.workspace.getConfiguration(
    "vectorcastTestExplorer.reqs2x"
  );
  const generateHighLevelRequirements = config.get<boolean>(
    "generateHighLevelRequirements",
    false
  );
  const reorder = config.get<boolean>("reorder", true);

  const args = [
    "-e",
    envPath,
    "--export-repository",
    repositoryDir,
    "--json-events",
    ...(generateHighLevelRequirements
      ? ["--generate-high-level-requirements"]
      : []),
    ...(reorder ? [] : ["--no-reorder"]),
  ];

  try {
    const { cancelled } = await runReqs2xTool({
      exe: CODE2REQS_EXECUTABLE_PATH,
      args,
      llm: true,
      progress: {
        title: `Generating Requirements for ${envName.split(".")[0]}`,
        logPrefix: "code2reqs",
      },
    });
    if (cancelled) return;

    await refreshAllExtensionData();
    updateRequirementsAvailability(enviroPath);
    vscode.commands.executeCommand("vectorcastTestExplorer.showRequirements", {
      id: enviroPath,
    });
    vscode.window.showInformationMessage(
      "Successfully generated requirements for the environment!"
    );
  } catch (err) {
    const message = `Error: ${err instanceof Error ? err.message : String(err)}`;
    vscode.window.showErrorMessage(message);
    logCliError(message, true);
  }
}

export async function generateTestsFromRequirements(
  enviroPath: string,
  unitOrFunctionName: string | null
) {
  const { findRelevantRequirementGateway } =
    require("./rgwPath") as typeof import("./rgwPath");
  const { readRGWBundle, inferTraceability } =
    require("./rgwIo") as typeof import("./rgwIo");
  const { runReqs2xTool } =
    require("./processRunner") as typeof import("./processRunner");

  const parentDir = path.dirname(enviroPath);
  const lowestDirname = path.basename(enviroPath);
  const envName = `${lowestDirname}.env`;
  const envPath = path.join(parentDir, envName);

  // tstPath must be in the same parent directory as the .env. If the .tst is
  // stored inside reqs-<envName>, VectorCAST treats the environment as
  // read-only and refuses to load it.
  const tstPath = path.join(parentDir, "reqs2tests.tst");

  const gatewayPath = findRelevantRequirementGateway(enviroPath);
  if (!gatewayPath) {
    vscode.window.showErrorMessage(
      "No requirements gateway found. Please generate requirements first."
    );
    return;
  }

  // Test generation needs per-requirement traceability — reqs2tests routes
  // each requirement to its mapped function. If the RGW has none, offer to
  // infer it now rather than letting reqs2tests no-op or fail downstream.
  const bundle = readRGWBundle(enviroPath);
  if (bundle) {
    const hasAnyFunction = Object.values(bundle.traceability).some(
      (entry) => entry?.function != null
    );
    if (!hasAnyFunction) {
      const choice = await vscode.window.showWarningMessage(
        "None of the requirements trace to a function. Test generation requires per-requirement traceability. Would you like to infer it automatically first?",
        "Infer traceability",
        "Cancel"
      );
      if (choice !== "Infer traceability") return;
      try {
        const refreshed = await inferTraceability(
          enviroPath,
          bundle.gatewayPath
        );
        if (!refreshed) return; // user cancelled the inference progress
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to infer traceability: ${err}`);
        return;
      }
    }
  }

  const config = vscode.workspace.getConfiguration(
    "vectorcastTestExplorer.reqs2x"
  );
  const decomposeRequirements = config.get<boolean>(
    "decomposeRequirements",
    true
  );
  const noTestExamples = config.get<boolean>("noTestExamples", false);
  const reorder = config.get<boolean>("reorder", true);
  const funcDefs = config.get<boolean>("functionDefinitions", true);
  const allowUUTStubs = config.get<boolean>("enableUutStubbing", true);

  const retries = config.get<number>("retries", 2);
  if (retries < 1) {
    vscode.window.showErrorMessage(
      "Retries must be greater than or equal to 1. Please check your settings."
    );
    return;
  }

  const args = [
    "-e",
    envPath,
    gatewayPath,
    ...(unitOrFunctionName ? ["-f", unitOrFunctionName] : []),
    "--export-tst",
    tstPath,
    "--retries",
    retries.toString(),
    "--batched",
    ...(decomposeRequirements ? [] : ["--no-requirement-decomposition"]),
    ...(noTestExamples ? ["--no-test-examples"] : []),
    ...(reorder ? [] : ["--no-reorder"]),
    ...(funcDefs ? [] : ["--no-func-defs"]),
    ...(allowUUTStubs ? [] : ["--no-allow-uut-stubs"]),
    "--allow-partial",
    "--json-events",
    "--requirement-keys",
  ];

  try {
    const { cancelled } = await runReqs2xTool({
      exe: REQS2TESTS_EXECUTABLE_PATH,
      args,
      llm: true,
      progress: {
        title: `Generating Requirement Tests for ${envName.split(".")[0]}`,
        logPrefix: "reqs2tests",
      },
    });
    if (cancelled) return;

    await loadTestScriptIntoEnvironment(envName.split(".")[0], tstPath);
    await refreshAllExtensionData();
    vscode.window.showInformationMessage(
      "Successfully generated tests for the requirements!"
    );
  } catch (err) {
    const message = `Error: ${err instanceof Error ? err.message : String(err)}`;
    vscode.window.showErrorMessage(message);
    logCliError(message, true);
  }
}
