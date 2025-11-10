import * as vscode from "vscode";
import { exeFilename, showSettings } from "../utilities";
import {
  findRelevantRequirementGateway,
  getAutoreqExecutableDirectory,
  setupRequirementsFileWatchers,
  spawnWithVcastEnv,
  updateRequirementsAvailability,
} from "./requirementsUtils";
import { refreshAllExtensionData } from "../testPane";
import { loadTestScriptIntoEnvironment } from "../vcastAdapter";

const path = require("path");
const fs = require("fs");

let reqs2XFeatureEnabled: boolean = false;

export const GENERATE_REQUIREMENTS_ENABLED: boolean = true;

// Setup the paths to the reqs2x executables
let CODE2REQS_EXECUTABLE_PATH: string;
let REQS2TESTS_EXECUTABLE_PATH: string;
let PANREQ_EXECUTABLE_PATH: string;

export let LLM2CHECK_EXECUTABLE_PATH: string;

// Add a new output channel for CLI operations
let cliOutputChannel: vscode.OutputChannel = vscode.window.createOutputChannel(
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
    setupRequirementsFileWatchers(context);
    const successful = setupReqs2XExecutablePaths(context);
    if (!successful) {
      // Tell the user that we couldn't find the executables as an error popup and offer to open settings
      vscode.window
        .showErrorMessage(
          "Could not find the reqs2X executables anywhere, disabling Reqs2X. Please check your settings.",
          "Open Settings"
        )
        .then((selection) => {
          if (selection === "Open Settings") {
            showSettings();
          }
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
  const baseUri = getAutoreqExecutableDirectory(context);

  if (!baseUri) {
    return false;
  }

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
  const parentDir = path.dirname(enviroPath);
  const lowestDirname = path.basename(enviroPath);
  const envName = `${lowestDirname}.env`;
  const envPath = path.join(parentDir, envName);

  // remove ".env" if present
  const enviroNameWithoutExt = envName.replace(/\.env$/, "");
  const envReqsFolderPath = path.join(
    parentDir,
    `reqs-${enviroNameWithoutExt}`
  );

  // Ensure the requirements folder exists
  if (!fs.existsSync(envReqsFolderPath)) {
    fs.mkdirSync(envReqsFolderPath, { recursive: true });
  }

  const xlsxPath = path.join(envReqsFolderPath, "reqs.xlsx");
  const csvPath = path.join(envReqsFolderPath, "reqs.csv");
  const repositoryDir = path.join(
    envReqsFolderPath,
    "generated_requirement_repository"
  );

  // Check for existing gateway
  const existingGateway = findRelevantRequirementGateway(enviroPath);
  if (existingGateway) {
    const warningMessage = `Warning: An existing requirements gateway was found at ${existingGateway}. Generating requirements will switch the environment gateway to a new one.`;
    const choice = await vscode.window.showWarningMessage(
      warningMessage,
      "Continue",
      "Cancel"
    );

    if (choice !== "Continue") {
      return;
    }
  }

  // Check for existing reqs.csv or reqs.xlsx
  if (fs.existsSync(xlsxPath) || fs.existsSync(csvPath)) {
    const message =
      "Existing requirements files found. Do you want to overwrite them?";
    const choice = await vscode.window.showWarningMessage(
      message,
      "Overwrite",
      "Cancel"
    );

    if (choice !== "Overwrite") {
      return;
    }
  }

  const config = vscode.workspace.getConfiguration(
    "vectorcastTestExplorer.reqs2x"
  );
  const generateHighLevelRequirements = config.get<boolean>(
    "generateHighLevelRequirements",
    false
  );

  const commandArgs = [
    "-e",
    envPath,
    "--export-excel",
    xlsxPath,
    "--export-repository",
    repositoryDir,
    "--json-events",
    //"--combine-related-requirements",
    //"--extended-reasoning"
  ];

  if (generateHighLevelRequirements) {
    commandArgs.push("--generate-high-level-requirements");
  }

  // Log the command being executed
  const commandString = `${CODE2REQS_EXECUTABLE_PATH} ${commandArgs.join(" ")}`;
  logCliOperation(`Executing command: ${commandString}`);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Generating Requirements for ${envName.split(".")[0]}`,
      cancellable: true,
    },
    async (progress, cancellationToken) => {
      let lastProgress = 0;
      let simulatedProgress = 0;
      const simulatedProgressInterval = setInterval(() => {
        if (
          simulatedProgress < 30 &&
          !cancellationToken.isCancellationRequested
        ) {
          simulatedProgress += 1;
          progress.report({ increment: 1 });
        }
      }, 1000);

      const process = await spawnWithVcastEnv(
        CODE2REQS_EXECUTABLE_PATH,
        commandArgs
      );

      return await new Promise<void>((resolve, reject) => {
        cancellationToken.onCancellationRequested(() => {
          process.kill();
          clearInterval(simulatedProgressInterval);
          logCliOperation("Operation cancelled by user");
          resolve();
        });

        process.stdout.on("data", (data) => {
          if (cancellationToken.isCancellationRequested) return;
          const output = data.toString();

          const lines = output.split("\n");
          for (const line of lines) {
            try {
              const json = JSON.parse(line);
              if (json.event === "progress" && json.value !== undefined) {
                const scaledProgress = json.value * 0.7;
                const increment = (scaledProgress - lastProgress) * 100;
                if (increment > 0) {
                  progress.report({ increment });
                  lastProgress = scaledProgress;
                }
              } else if (json.event === "problem" && json.value !== undefined) {
                vscode.window.showWarningMessage(json.value);
                logCliOperation(`Warning: ${json.value}`);
              }
            } catch (e) {
              if (line) {
                logCliOperation(`code2reqs: ${line}`);
              }
            }
          }
        });

        process.stderr.on("data", (data) => {
          const errorOutput = data.toString();
          logCliError(`code2reqs: ${errorOutput}`);
          console.error(`Stderr: ${errorOutput}`);
        });

        process.on("close", async (code) => {
          clearInterval(simulatedProgressInterval);
          if (cancellationToken.isCancellationRequested) return;
          if (code === 0) {
            logCliOperation(
              `code2reqs completed successfully with code ${code}`
            );
            await refreshAllExtensionData();
            updateRequirementsAvailability(enviroPath);
            // Run the showRequirements command to display the generated Excel
            vscode.commands.executeCommand(
              "vectorcastTestExplorer.showRequirements",
              { id: enviroPath }
            );
            vscode.window.showInformationMessage(
              "Successfully generated requirements for the environment!"
            );
            resolve();
          } else {
            const errorMessage = `Error: code2reqs exited with code ${code}`;
            vscode.window.showErrorMessage(errorMessage);
            logCliError(errorMessage, true);
            reject(new Error(errorMessage));
          }
        });
      });
    }
  );
}

export async function generateTestsFromRequirements(
  enviroPath: string,
  unitOrFunctionName: string | null
) {
  const parentDir = path.dirname(enviroPath);
  const lowestDirname = path.basename(enviroPath);
  const envName = `${lowestDirname}.env`;
  const envPath = path.join(parentDir, envName);

  // remove ".env" if present
  const enviroNameWithoutExt = envName.replace(/\.env$/, "");
  const envReqsFolderPath = path.join(
    parentDir,
    `reqs-${enviroNameWithoutExt}`
  );

  // Ensure the requirements folder exists
  if (!fs.existsSync(envReqsFolderPath)) {
    fs.mkdirSync(envReqsFolderPath, { recursive: true });
  }

  const csvPath = path.join(envReqsFolderPath, "reqs.csv");
  const xlsxPath = path.join(envReqsFolderPath, "reqs.xlsx");

  // tstPath must be in the same parent directory as the .env.
  // If the .tst is stored inside reqs-<envName>, VectorCAST treats the
  // environment as read-only and refuses to load it. Therefore we place
  // reqs2tests.tst directly under parentDir, alongside <envName>.env.
  const tstPath = path.join(parentDir, "reqs2tests.tst");

  let reqsFile = "";
  let fileType = "";
  if (fs.existsSync(xlsxPath)) {
    reqsFile = xlsxPath;
    fileType = "Excel";
  } else if (fs.existsSync(csvPath)) {
    reqsFile = csvPath;
    fileType = "CSV";
  } else {
    vscode.window.showErrorMessage(
      "No requirements file found. Please generate requirements first."
    );
    return;
  }

  // Get the decompose setting from configuration
  const config = vscode.workspace.getConfiguration("vectorcastTestExplorer");
  const decomposeRequirements = config.get<boolean>(
    "decomposeRequirements",
    true
  );
  const enableRequirementKeys =
    findRelevantRequirementGateway(enviroPath) !== null;
  console.log(decomposeRequirements, enableRequirementKeys);

  const commandArgs = [
    "-e",
    envPath,
    reqsFile, // use the chosen requirements file
    ...(unitOrFunctionName ? ["-f", unitOrFunctionName] : []),
    "--export-tst",
    tstPath,
    "--retries",
    "1",
    "--batched",
    ...(decomposeRequirements ? [] : ["--no-requirement-decomposition"]),
    "--allow-partial",
    "--json-events",
    ...(enableRequirementKeys ? ["--requirement-keys"] : []),
  ];

  // Log the command being executed
  const commandString = `${REQS2TESTS_EXECUTABLE_PATH} ${commandArgs.join(
    " "
  )}`;
  logCliOperation(`Executing command: ${commandString}`);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Generating Tests from Requirements (${fileType}) for ${
        envName.split(".")[0]
      }`,
      cancellable: true,
    },
    async (progress, cancellationToken) => {
      let lastProgress = 0;
      let simulatedProgress = 0;
      const simulatedProgressInterval = setInterval(() => {
        if (
          simulatedProgress < 40 &&
          !cancellationToken.isCancellationRequested
        ) {
          simulatedProgress += 1;
          progress.report({ increment: 1 });
        }
      }, 2000);

      const process = await spawnWithVcastEnv(
        REQS2TESTS_EXECUTABLE_PATH,
        commandArgs
      );

      return new Promise<void>((resolve, reject) => {
        console.log(`reqs2tests ${commandArgs.join(" ")}`);

        cancellationToken.onCancellationRequested(() => {
          process.kill();
          clearInterval(simulatedProgressInterval);
          logCliOperation("Operation cancelled by user");
          resolve();
        });

        process.stdout.on("data", (data) => {
          if (cancellationToken.isCancellationRequested) return;
          const output = data.toString();

          const lines = output.split("\n");
          for (const line of lines) {
            try {
              const json = JSON.parse(line);
              if (json.event === "progress" && json.value !== undefined) {
                const scaledProgress = json.value * 0.6;
                const increment = (scaledProgress - lastProgress) * 100;
                if (increment > 0) {
                  progress.report({ increment });
                  lastProgress = scaledProgress;
                }
              } else if (json.event === "problem" && json.value !== undefined) {
                if (json.value.includes("Individual")) {
                  return;
                }
                vscode.window.showWarningMessage(json.value);
                logCliOperation(`Warning: ${json.value}`);
              }
            } catch (e) {
              if (line) {
                logCliOperation(`reqs2tests: ${line}`);
              }
            }
          }
        });

        process.stderr.on("data", (data) => {
          const errorOutput = data.toString();
          logCliError(`reqs2tests: ${errorOutput}`);
          console.error(`Stderr: ${errorOutput}`);
        });

        process.on("close", async (code) => {
          clearInterval(simulatedProgressInterval);
          if (cancellationToken.isCancellationRequested) return;

          if (code === 0) {
            logCliOperation(
              `reqs2tests completed successfully with code ${code}`
            );
            await loadTestScriptIntoEnvironment(envName.split(".")[0], tstPath);
            await refreshAllExtensionData();

            vscode.window.showInformationMessage(
              "Successfully generated tests for the requirements!"
            );
            resolve();
          } else {
            const errorMessage = `Error: reqs2tests exited with code ${code}`;
            vscode.window.showErrorMessage(errorMessage);
            logCliError(errorMessage, true);
            reject(new Error(errorMessage));
          }
        });
      });
    }
  );
}

export async function importRequirementsFromGateway(enviroPath: string) {
  const parentDir = path.dirname(enviroPath);
  const lowestDirname = path.basename(enviroPath);
  const envName = `${lowestDirname}.env`;
  const envPath = path.join(parentDir, envName);

  // Determine (or create) the requirements folder used elsewhere in the extension
  const enviroNameWithoutExt = lowestDirname.replace(/\.env$/, "");
  const envReqsFolderPath = path.join(
    parentDir,
    `reqs-${enviroNameWithoutExt}`
  );
  if (!fs.existsSync(envReqsFolderPath)) {
    fs.mkdirSync(envReqsFolderPath, { recursive: true });
  }

  // Look for requirement gateway
  const repositoryPath = findRelevantRequirementGateway(enviroPath);
  if (!repositoryPath) {
    vscode.window.showErrorMessage(
      "Requirements Gateway either is not specified or does not exist. Aborting."
    );
    return;
  }

  // Target files INSIDE the reqs-<env> folder (align with generate/remove logic)
  const csvPath = path.join(envReqsFolderPath, "reqs.csv");
  const xlsxPath = path.join(envReqsFolderPath, "reqs.xlsx");

  // Check if requirements files already exist
  const xlsxExists = fs.existsSync(xlsxPath);
  const csvExists = fs.existsSync(csvPath);

  if (xlsxExists || csvExists) {
    let warningMessage = "Warning: ";
    if (xlsxExists) {
      warningMessage +=
        "An existing Excel requirements file (reqs.xlsx) will be overwritten.";
    }
    if (csvExists) {
      if (xlsxExists) warningMessage += " Additionally, ";
      warningMessage +=
        "An existing CSV requirements file (reqs.csv) will be ignored as the new Excel file takes precedence.";
    }

    const choice = await vscode.window.showWarningMessage(
      warningMessage,
      "Continue",
      "Cancel"
    );
    if (choice !== "Continue") return;
  }

  const choice = await vscode.window.showInformationMessage(
    "Would you like the system to automatically try to add traceability to the requirements?",
    "Yes",
    "No"
  );
  const addTraceability = choice === "Yes";

  const commandArgs = [
    repositoryPath,
    xlsxPath,
    "--target-format",
    "excel",
    ...(addTraceability ? ["--infer-traceability"] : []),
    "--target-env",
    envPath,
  ];

  const commandString = `${PANREQ_EXECUTABLE_PATH} ${commandArgs.join(" ")}`;
  logCliOperation(`Executing command: ${commandString}`);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Importing Requirements from Gateway`,
      cancellable: true,
    },
    async (progress, cancellationToken) => {
      let simulatedProgress = 0;
      const simulatedProgressInterval = setInterval(() => {
        if (
          simulatedProgress < 90 &&
          !cancellationToken.isCancellationRequested
        ) {
          simulatedProgress += 5;
          progress.report({ increment: 5 });
        }
      }, 500);

      const proc = await spawnWithVcastEnv(PANREQ_EXECUTABLE_PATH, commandArgs);

      return new Promise<void>((resolve, reject) => {
        cancellationToken.onCancellationRequested(() => {
          proc.kill();
          clearInterval(simulatedProgressInterval);
          logCliOperation("Operation cancelled by user");
          resolve();
        });

        proc.stdout.on("data", (d) => {
          const out = d.toString();
          logCliOperation(`panreq: ${out.trim()}`);
        });

        proc.stderr.on("data", (d) => {
          const errOut = d.toString();
          logCliError(`panreq: ${errOut.trim()}`);
        });

        proc.on("close", async (code) => {
          clearInterval(simulatedProgressInterval);
          if (cancellationToken.isCancellationRequested) return;

          if (code === 0) {
            logCliOperation(
              `reqs2excel completed successfully with code ${code}`
            );
            await refreshAllExtensionData();
            updateRequirementsAvailability(enviroPath);
            vscode.commands.executeCommand(
              "vectorcastTestExplorer.showRequirements",
              { id: enviroPath }
            );
            vscode.window.showInformationMessage(
              "Successfully imported requirements from gateway"
            );
            resolve();
          } else {
            const msg = `Error: reqs2excel exited with code ${code}`;
            vscode.window.showErrorMessage(msg);
            logCliError(msg, true);
            reject(new Error(msg));
          }
        });
      });
    }
  );
}

export async function populateRequirementsGateway(enviroPath: string) {
  const parentDir = path.dirname(enviroPath);
  const envName = path.basename(enviroPath);
  const envPath = path.join(parentDir, envName);

  // remove ".env" if present
  const enviroNameWithoutExt = envName.replace(/\.env$/, "");
  const envReqsFolderPath = path.join(
    parentDir,
    `reqs-${enviroNameWithoutExt}`
  );

  const csvPath = path.join(envReqsFolderPath, "reqs.csv");
  const xlsxPath = path.join(envReqsFolderPath, "reqs.xlsx");

  // Check which requirements file exists
  let requirementsFile = "";
  if (fs.existsSync(xlsxPath)) {
    requirementsFile = xlsxPath;
  } else if (fs.existsSync(csvPath)) {
    requirementsFile = csvPath;
  } else {
    vscode.window.showErrorMessage(
      "No requirements file found. Generate requirements first."
    );
    return;
  }

  // Check if there is an existing requirements gateway
  const existingGateway = findRelevantRequirementGateway(enviroPath);
  if (existingGateway) {
    const warningMessage = `Warning: An existing requirements gateway was found at ${existingGateway}. Generating requirements will switch the environment gateway to a new one.`;
    const choice = await vscode.window.showWarningMessage(
      warningMessage,
      "Continue",
      "Cancel"
    );

    if (choice !== "Continue") {
      return;
    }
  }

  const exportRepository = path.join(
    envReqsFolderPath,
    "generated_requirement_repository"
  );

  const commandArgs = [
    requirementsFile,
    exportRepository,
    "--target-format",
    "rgw",
    "--target-env",
    envPath,
  ];

  // Log the command being executed
  const commandString = `${PANREQ_EXECUTABLE_PATH} ${commandArgs.join(" ")}`;
  logCliOperation(`Executing command: ${commandString}`);

  // Show progress while running
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Populating Requirements Gateway...",
      cancellable: false,
    },
    async (progress) => {
      const process = await spawnWithVcastEnv(
        PANREQ_EXECUTABLE_PATH,
        commandArgs
      );

      return new Promise<void>((resolve, reject) => {
        process.stdout.on("data", (data) => {
          const output = data.toString().trim();
          logCliOperation(`panreq: ${output}`);
        });

        process.stderr.on("data", (data) => {
          const errorOutput = data.toString().trim();
          logCliError(`panreq: ${errorOutput}`);
        });

        process.on("close", async (code) => {
          if (code === 0) {
            logCliOperation(
              `reqs2rgw completed successfully with code ${code}`
            );

            try {
              await refreshAllExtensionData();
              vscode.window.showInformationMessage(
                `Successfully populated requirements gateway at ${exportRepository}`
              );
              resolve();
            } catch (err) {
              const error = err instanceof Error ? err : new Error(String(err));
              vscode.window.showErrorMessage(
                `Error updating environment configuration: ${error.message}`
              );
              reject(error);
            }
          } else {
            const errorMessage = `Error: reqs2rgw exited with code ${code}`;
            vscode.window.showErrorMessage(errorMessage);
            logCliError(errorMessage, true);
            reject(new Error(errorMessage));
          }
        });
      });
    }
  );
}
