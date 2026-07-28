import * as vscode from "vscode";
import { showSettings } from "../utilities";
import { refreshAllExtensionData } from "../testPane";
import { loadTestScriptIntoEnvironment } from "../vcastAdapter";
import { updateRequirementsAvailability } from "./availability";
import { logCliError } from "./requirementsLog";
import {
  CODE2REQS_EXECUTABLE_PATH,
  PANREQ_EXECUTABLE_PATH,
  REQS2TESTS_EXECUTABLE_PATH,
  setupReqs2XExecutablePaths,
} from "./requirementsExecutables";
import { runReqs2xTool } from "./processRunner";
import {
  defaultRequirementGatewayPath,
  findRelevantRequirementGateway,
  setVcastRepositoryInConfig,
} from "./rgwPath";
import {
  hasCompleteAndUsableRGW,
  inferTraceability,
  readRGWBundle,
} from "./rgwIo";

const path = require("path");
const fs = require("fs");

let reqs2XFeatureEnabled: boolean = false;

// Authoritative "Reqs2X can actually run" flag: the feature is enabled in
// settings AND all reqs2X executables were resolved on disk. Set by
// initializeReqs2X and mirrored to the `reqs2xFeatureEnabled` context key (which
// gates the menus); this exported copy lets extension code make the same check.
export let reqs2xUsable = false;

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

  reqs2xUsable = featureEnabled;
  vscode.commands.executeCommand(
    "setContext",
    "vectorcastTestExplorer.reqs2xFeatureEnabled",
    featureEnabled
  );
}

export async function generateRequirements(enviroPath: string) {
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
  const args = [
    "-e",
    envPath,
    "--export-repository",
    repositoryDir,
    "--json-events",
    ...(generateHighLevelRequirements
      ? ["--generate-high-level-requirements"]
      : []),
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
  const proceed = await offerTraceabilityInferenceIfMissing(enviroPath, {
    prompt:
      "None of the requirements trace to a function. Test generation requires per-requirement traceability. Would you like to infer it automatically first?",
    cancelMeansAbort: true,
  });
  if (!proceed) return;

  const config = vscode.workspace.getConfiguration(
    "vectorcastTestExplorer.reqs2x"
  );
  const decomposeRequirements = config.get<boolean>(
    "decomposeRequirements",
    true
  );
  const noTestExamples = config.get<boolean>("noTestExamples", false);
  const funcDefs = config.get<boolean>("functionDefinitions", true);
  const allowUUTStubs = config.get<boolean>("enableUutStubbing", true);
  const batched = config.get<boolean>("batched", true);

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
    batched ? "--batched" : "--no-batched",
    ...(decomposeRequirements ? [] : ["--no-requirement-decomposition"]),
    ...(noTestExamples ? ["--no-test-examples"] : []),
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

/**
 * If the bundle has no traceability for any requirement, prompt the user to
 * run --infer-traceability. Returns true if the caller should proceed (either
 * we already had traceability, the user accepted and inference succeeded, or
 * `cancelMeansAbort` is false and the user declined). Returns false to
 * abort the caller's flow.
 */
async function offerTraceabilityInferenceIfMissing(
  enviroPath: string,
  options: { prompt: string; cancelMeansAbort: boolean }
): Promise<boolean> {
  const bundle = readRGWBundle(enviroPath);
  if (!bundle) return true; // nothing to evaluate; let caller continue

  const hasAnyFunction = Object.values(bundle.traceability).some(
    (entry) => entry?.function != null
  );
  if (hasAnyFunction) return true;

  const choice = await vscode.window.showWarningMessage(
    options.prompt,
    "Infer traceability",
    options.cancelMeansAbort ? "Cancel" : "Skip"
  );

  if (choice !== "Infer traceability") {
    return !options.cancelMeansAbort;
  }

  try {
    const refreshed = await inferTraceability(enviroPath, bundle.gatewayPath);
    if (!refreshed) return false; // user cancelled the inference progress
    return true;
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to infer traceability: ${err}`);
    return false;
  }
}

const EXT_TO_FORMAT: Record<string, string> = {
  ".xlsx": "excel",
  ".csv": "csv",
  ".json": "json",
};

/**
 * Import a requirements file (xlsx / csv / json) into the env's RGW.
 * Sets up the default gateway location if VCAST_REPOSITORY is unset, runs
 * panreq with the standard cancellable progress notification, then
 * refreshes the test pane and the availability context key.
 *
 * Returns whether the import actually completed (false on user cancel of
 * the progress, panreq failure, or other thrown errors). Does not show
 * success messages — caller decides whether/how to celebrate.
 */
export async function importRequirementsFromPath(
  enviroPath: string,
  sourcePath: string,
  options: { progressTitle: string }
): Promise<boolean> {
  const parentDir = path.dirname(enviroPath);
  const envPath = path.join(parentDir, `${path.basename(enviroPath)}.env`);

  let gatewayPath = findRelevantRequirementGateway(enviroPath);
  if (!gatewayPath) {
    gatewayPath = defaultRequirementGatewayPath(enviroPath);
    fs.mkdirSync(path.dirname(gatewayPath), { recursive: true });
    setVcastRepositoryInConfig(enviroPath, gatewayPath);
  }

  try {
    const { cancelled } = await runReqs2xTool({
      exe: PANREQ_EXECUTABLE_PATH,
      args: [
        sourcePath,
        gatewayPath,
        "--target-format",
        "rgw",
        "--target-env",
        envPath,
        "--json-events",
      ],
      progress: { title: options.progressTitle, logPrefix: "panreq" },
    });
    if (cancelled) return false;

    await refreshAllExtensionData();
    updateRequirementsAvailability(enviroPath);
    return true;
  } catch (err) {
    const message = `Error: ${err instanceof Error ? err.message : String(err)}`;
    vscode.window.showErrorMessage(message);
    logCliError(message, true);
    return false;
  }
}

export async function importRequirements(enviroPath: string) {
  const sourceUris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: "Import Requirements",
    filters: {
      "Requirements files": ["xlsx", "csv", "json"],
      "Excel (*.xlsx)": ["xlsx"],
      "CSV (*.csv)": ["csv"],
      "JSON (*.json)": ["json"],
    },
  });
  if (!sourceUris || sourceUris.length === 0) return;
  const sourcePath = sourceUris[0].fsPath;

  const ext = path.extname(sourcePath).toLowerCase();
  if (!EXT_TO_FORMAT[ext]) {
    vscode.window.showErrorMessage(
      `Unsupported import format: ${ext}. Use .xlsx, .csv, or .json.`
    );
    return;
  }

  // If a gateway already exists we ask first — the user may have come here
  // by mistake. The actual setup-and-run happens in the shared helper.
  const existingGateway = findRelevantRequirementGateway(enviroPath);
  if (existingGateway) {
    const choice = await vscode.window.showWarningMessage(
      `Importing will overwrite the existing requirements gateway at ${existingGateway}.`,
      "Continue",
      "Cancel"
    );
    if (choice !== "Continue") return;
  }

  const enviroName = path.basename(enviroPath);
  const ok = await importRequirementsFromPath(enviroPath, sourcePath, {
    progressTitle: `Importing Requirements for ${enviroName}`,
  });
  if (!ok) return;

  vscode.window.showInformationMessage(
    `Successfully imported requirements from ${path.basename(sourcePath)}`
  );

  // Same prompt as generateTestsFromRequirements: imported requirements
  // typically lack code traceability. Skip-vs-infer; "Skip" leaves the user
  // free to set traceability manually in the editor later.
  await offerTraceabilityInferenceIfMissing(enviroPath, {
    prompt:
      "None of the imported requirements trace to a function. Would you like to infer traceability automatically?",
    cancelMeansAbort: false,
  });
}

export async function exportRequirements(enviroPath: string) {
  if (!hasCompleteAndUsableRGW(enviroPath)) {
    vscode.window.showErrorMessage("No requirements available to export.");
    return;
  }
  const gatewayPath = findRelevantRequirementGateway(enviroPath)!;

  const parentDir = path.dirname(enviroPath);
  const lowestDirname = path.basename(enviroPath);
  const envName = `${lowestDirname}.env`;
  const envPath = path.join(parentDir, envName);

  const targetUri = await vscode.window.showSaveDialog({
    saveLabel: "Export Requirements",
    defaultUri: vscode.Uri.file(
      path.join(parentDir, `${lowestDirname}-requirements.csv`)
    ),
    filters: {
      "CSV (*.csv)": ["csv"],
      "Excel (*.xlsx)": ["xlsx"],
      "JSON (*.json)": ["json"],
    },
  });
  if (!targetUri) return;
  const targetPath = targetUri.fsPath;

  const ext = path.extname(targetPath).toLowerCase();
  const targetFormat = EXT_TO_FORMAT[ext];
  if (!targetFormat) {
    vscode.window.showErrorMessage(
      `Unsupported export format: ${ext}. Use .xlsx, .csv, or .json.`
    );
    return;
  }

  const args = [
    gatewayPath,
    targetPath,
    "--target-format",
    targetFormat,
    "--target-env",
    envPath,
    "--json-events",
  ];

  try {
    const { cancelled } = await runReqs2xTool({
      exe: PANREQ_EXECUTABLE_PATH,
      args,
      progress: {
        title: `Exporting Requirements for ${lowestDirname}`,
        logPrefix: "panreq",
      },
    });
    if (cancelled) return;

    const choice = await vscode.window.showInformationMessage(
      `Successfully exported requirements to ${path.basename(targetPath)}`,
      "Reveal in File Explorer"
    );
    if (choice === "Reveal in File Explorer") {
      vscode.commands.executeCommand(
        "revealFileInOS",
        vscode.Uri.file(targetPath)
      );
    }
  } catch (err) {
    const message = `Error: ${err instanceof Error ? err.message : String(err)}`;
    vscode.window.showErrorMessage(message);
    logCliError(message, true);
  }
}
