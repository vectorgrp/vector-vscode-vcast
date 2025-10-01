import * as vscode from "vscode";
import { Uri, workspace } from "vscode";

import { rebuildEnvironmentCallback } from "./callbacks";

import {
  activateLanguageServerClient,
  deactivateLanguageServerClient,
} from "./client";

import {
  updateConfigurationOption,
  updateUnitTestLocationOption,
} from "./configuration";

import {
  createCoverageStatusBar,
  hideStatusBarCoverage,
  initializeCodeCoverageFeatures,
  toggleCoverageAction,
  updateDisplayedCoverage,
  updateCOVdecorations,
} from "./coverage";

import {
  buildTestNodeForFunction,
  initializeTestDecorator,
  updateTestDecorator,
} from "./editorDecorator";

import { updateExploreDecorations } from "./fileDecorator";

import {
  openMessagePane,
  toggleMessageLog,
  adjustVerboseSetting,
  vectorMessage,
} from "./messagePane";

import { viewMCDCReport, viewResultsReport } from "./reporting";

import {
  environmentDataCache,
  environmentNodeDataType,
  getEnviroNodeData,
  getEnviroPathFromID,
  getTestNode,
  testNodeType,
} from "./testData";

import {
  activateTestPane,
  deleteTests,
  insertBasisPathTests,
  insertATGTests,
  loadTestScript,
  pathToEnviroBeingDebugged,
  pathToProgramBeingDebugged,
  refreshAllExtensionData,
  updateCodedTestCases,
  updateDataForEnvironment,
  vcastUnbuiltEnviroList,
  globalProjectWebviewComboboxItems,
  setGlobalProjectIsOpenedChecker,
  setGlobalCompilerAndTestsuites,
  loadTestScriptButton,
  makeEnviroNodeID,
} from "./testPane";

import {
  addLaunchConfiguration,
  addSettingsFileFilter,
  getEnvPathForFilePath,
  showSettings,
  updateCoverageAndRebuildEnv,
  forceLowerCaseDriveLetter,
  decodeVar,
  normalizePath,
} from "./utilities";

import {
  buildEnvironmentFromScript,
  deleteEnvironment,
  loadTestScriptIntoEnvironment,
  openVcastFromEnviroNode,
  openVcastFromVCEfile,
  rebuildEnvironment,
  openProjectInVcast,
  deleteLevel,
} from "./vcastAdapter";

import {
  buildProjectEnvironment,
  removeTestsuiteFromProject,
  importEnvToTestsuite,
  createTestsuiteInCompiler,
  addCompilerToProject,
  updateProjectData,
  buildExecuteIncremental,
  cleanProjectEnvironment,
  addEnvToTestsuite,
  deleteEnvironmentFromProject,
  createNewCompilerInProject,
  createNewProject,
} from "./manage/manageSrc/manageCommands";

import {
  deleteServerLog,
  displayServerLog,
  initializeVcastDataServer,
  initializeServerState,
  serverProcessController,
  serverStateType,
  toggleDataServerState,
} from "./vcastDataServer";

import {
  checkIfInstallationIsOK,
  configurationFile,
  launchFile,
  globalPathToSupportFiles,
  initializeInstallerFiles,
  vcastInstallationDirectory,
} from "./vcastInstallation";

import {
  generateNewCodedTestFile,
  addExistingCodedTestFile,
  newEnvironment,
  newTestScript,
  openCodedTest,
  ProjectEnvParameters,
} from "./vcastTestInterface";

import {
  addIncludePath,
  envIsEmbeddedInProject,
  getEnviroNameFromFile,
  getLevelFromNodeId,
  getVcmRoot,
  openProjectFromEnviroPath,
  openTestScript,
} from "./vcastUtilities";

import fs = require("fs");
import {
  compilerTagList,
  getNonce,
  resolveWebviewBase,
  setCompilerList,
} from "./manage/manageSrc/manageUtils";

const path = require("path");
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { parse as csvParse } from "csv-parse/sync";
const excelToJson = require("convert-excel-to-json");

let messagePane: vscode.OutputChannel = vscode.window.createOutputChannel(
  "VectorCAST Test Explorer"
);

/**
 * Decodes a Base64-encoded variable name.
 */
function decodeAndRemoveDeveloperEnvs() {
  // Base64-encoded variable names
  const encodedVars: string[] = [
    "VkNBU1RfVVNJTkdfSEVBRExFU1NfTU9ERQ",
    "VkNBU1RfVVNFX0NJX0xJQ0VOU0VT",
  ];

  for (const encoded of encodedVars) {
    const varName = decodeVar(encoded);
    delete process.env[varName];
  }
}
// Add a new output channel for CLI operations
let cliOutputChannel: vscode.OutputChannel = vscode.window.createOutputChannel(
  "VectorCAST Requirement Test Generation Operations"
);

export function getMessagePane(): vscode.OutputChannel {
  return messagePane;
}

function logCliOperation(message: string): void {
  const timestamp = new Date().toLocaleTimeString();
  cliOutputChannel.appendLine(`[${timestamp}] ${message}`);
}

function logCliError(message: string, show: boolean | null = null): void {
  const timestamp = new Date().toLocaleTimeString();
  cliOutputChannel.appendLine(`[${timestamp}] ${message}`);

  if (show) {
    cliOutputChannel.show();
  }
}

let reqs2XFeatureEnabled: boolean = false;

const GENERATE_REQUIREMENTS_ENABLED: boolean = true;

// Setup the paths to the reqs2x executables
let CODE2REQS_EXECUTABLE_PATH: string;
let REQS2TESTS_EXECUTABLE_PATH: string;
let PANREQ_EXECUTABLE_PATH: string;
let LLM2CHECK_EXECUTABLE_PATH: string;

const NECCESSARY_REQS2X_EXECUTABLES = [
  "code2reqs",
  "reqs2tests",
  "panreq",
  "llm2check",
];

function initializeReqs2X(context: vscode.ExtensionContext) {
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

function getAutoreqExecutableDirectory(
  context: vscode.ExtensionContext
): vscode.Uri | undefined {
  const pathHasAllExecutables = (dirPath: string): boolean => {
    return NECCESSARY_REQS2X_EXECUTABLES.every((exe) =>
      fs.existsSync(vscode.Uri.joinPath(vscode.Uri.file(dirPath), exe).fsPath)
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

function setupReqs2XExecutablePaths(context: vscode.ExtensionContext): boolean {
  const baseUri = getAutoreqExecutableDirectory(context);

  if (!baseUri) {
    return false;
  }

  CODE2REQS_EXECUTABLE_PATH = vscode.Uri.joinPath(baseUri, "code2reqs").fsPath;
  REQS2TESTS_EXECUTABLE_PATH = vscode.Uri.joinPath(
    baseUri,
    "reqs2tests"
  ).fsPath;
  PANREQ_EXECUTABLE_PATH = vscode.Uri.joinPath(baseUri, "panreq").fsPath;
  LLM2CHECK_EXECUTABLE_PATH = vscode.Uri.joinPath(baseUri, "llm2check").fsPath;

  return true;
}

let requirementsFileWatcher: vscode.FileSystemWatcher | undefined;

export async function activate(context: vscode.ExtensionContext) {
  // activation gets called when:
  //  -- VectorCAST environment exists in the workspace
  //  -- "Create VectorCAST Environment" is selected from the Explorer context menu
  //  -- "VectorCAST Test Explorer: Configure" is selected from the command palette (ctrl-shift-p)

  // Handler for "VectorCAST Test Explorer: Configure"
  // The first use of configure will trigger this activate function
  // subsequent uses will trigger configureCommandCalled()
  vscode.commands.registerCommand("vectorcastTestExplorer.configure", () => {
    configureCommandCalled(context);
  });
  vscode.commands.registerCommand("vectorcastTestExplorer.toggleLog", () =>
    toggleMessageLog()
  );

  // we need to install some event handlers so that the user can "fix"
  // a "bad" vcast installation by providing a valid path see logic
  // and comments in this function
  await installPreActivationEventHandlers(context);

  // this checks the vcast installation,
  // and if its ok will proceed with full activation
  await checkPrerequisites(context);
}

export function configureCommandCalled(context: vscode.ExtensionContext) {
  // open the extension settings if the user has explicitly called configure
  showSettings();
}

let alreadyConfigured: boolean = false;
let installationFilesInitialized: boolean = false;
async function checkPrerequisites(context: vscode.ExtensionContext) {
  // this function is called from the activate function, and also from the
  // event handler for changes to the vcast installation location.  So in the
  // case that the VectorCAST installation is not found initially, we will get
  // here multiple times

  if (!alreadyConfigured) {
    // setup the location of vTestInterface.py and other utilities
    if (!installationFilesInitialized) {
      initializeInstallerFiles(context);
      installationFilesInitialized = true;
    }

    if (await checkIfInstallationIsOK()) {
      activationLogic(context);
      alreadyConfigured = true;
      vscode.commands.executeCommand(
        "setContext",
        "vectorcastTestExplorer.configured",
        true
      );
      // default to coverage ON
      await toggleCoverageAction();
      // initialize the verbose setting
      adjustVerboseSetting();

      // Sets the list for all available compilers
      await setCompilerList();
    } else {
      openMessagePane();
    }
  }
}

async function getEnvironmentListIncludingUnbuilt(
  workspacePath: string
): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    // Use glob to find all .env files in the workspace
    const glob = require("glob");
    glob(
      "**/*.env",
      { cwd: workspacePath, nodir: true },
      (err: Error, envFiles: string[]) => {
        if (err) {
          reject(err);
          return;
        }

        // Convert each .env file to its corresponding environment path
        const envPaths = envFiles.map((envFile) => {
          const fullPath = path.join(workspacePath, envFile);
          const dirPath = path.dirname(fullPath);
          const baseName = path.basename(envFile, ".env");
          return path.join(dirPath, baseName);
        });

        resolve(envPaths);
      }
    );
  });
}

async function activationLogic(context: vscode.ExtensionContext) {
  // remove developer env variables
  decodeAndRemoveDeveloperEnvs();

  // adds all of the command handlers
  configureExtension(context);

  // setup the decorations for coverage
  initializeCodeCoverageFeatures(context);

  // initialize the gutter decorator for testable functions
  initializeTestDecorator(context);

  await initializeVcastDataServer();

  // initialize the test pane
  activateTestPane(context);

  // start the language server
  activateLanguageServerClient(context);

  // Enable/disable the requirement generation component of the extension
  vscode.commands.executeCommand(
    "setContext",
    "vectorcastTestExplorer.generateRequirementsEnabled",
    GENERATE_REQUIREMENTS_ENABLED
  );

  // Initialize requirements availability for all environments
  if (workspace.workspaceFolders && workspace.workspaceFolders.length > 0) {
    const envPaths = await getEnvironmentListIncludingUnbuilt(
      workspace.workspaceFolders[0].uri.fsPath
    );
    for (const envPath of envPaths) {
      updateRequirementsAvailability(envPath);
    }
  }

  initializeReqs2X(context);
}

let alreadyInitializedFileWatchers: boolean = false;
function setupRequirementsFileWatchers(context: vscode.ExtensionContext) {
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
function findEnvironmentInPath(dirPath: string): string | null {
  // Check if the directory contains an environment file
  const files = fs.readdirSync(dirPath);
  const envFiles = files.filter((file) => file.endsWith(".env"));

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

function configureExtension(context: vscode.ExtensionContext) {
  // this sets up the file explorer decorations for code coverage
  updateExploreDecorations();

  // Command: vectorcastTestExplorer.coverage /////////////////////////////////////////////////////////
  // We create the status bar here, but the showing and updating is done in updateCOVdecorations
  const coverStatusBar: vscode.StatusBarItem = createCoverageStatusBar();
  context.subscriptions.push(coverStatusBar);
  let toggleCoverageCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.coverage",
    async () => {
      await toggleCoverageAction();
    }
  );
  context.subscriptions.push(toggleCoverageCommand);

  // Command: vectorcastTestExplorer.toggleVcastServerState ////////////////////////////////////////////////
  let toggleDataServerCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.toggleVcastServerState",
    async () => {
      await toggleDataServerState();
    }
  );
  context.subscriptions.push(toggleDataServerCommand);

  // Command: vectorcastTestExplorer.displayServerLog ////////////////////////////////////////////////
  let displayServerLogCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.displayServerLog",
    () => {
      displayServerLog();
    }
  );
  context.subscriptions.push(displayServerLogCommand);

  // Command: vectorcastTestExplorer.viewResults////////////////////////////////////////////////////////
  let viewResultsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.viewResults",
    (args: any) => {
      if (args) {
        viewResultsReport(args.id);
      }
    }
  );
  context.subscriptions.push(viewResultsCommand);

  // Command: vectorcastTestExplorer.createTestScript////////////////////////////////////////////////////////
  // This is the callback for the right clicks in the test explorer tree
  let createTestScriptCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.createTestScript",
    (args: any) => {
      if (args) {
        const testNode: testNodeType = getTestNode(args.id);
        newTestScript(testNode);
      }
    }
  );
  context.subscriptions.push(createTestScriptCommand);

  // Command: vectorcastTestExplorer.addCodedTests////////////////////////////////////////////////////////
  // This is the callback for the right clicks in the test explorer tree
  let addCodedTestsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.addCodedTests",
    (args: any) => {
      if (args) {
        addExistingCodedTestFile(args.id);
      }
    }
  );
  context.subscriptions.push(addCodedTestsCommand);

  // Command: vectorcastTestExplorer.generateCodedTests////////////////////////////////////////////////////////
  // This is the callback for the right clicks in the test explorer tree
  let generateCodedTestsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.generateCodedTests",
    (args: any) => {
      if (args) {
        generateNewCodedTestFile(args.id);
      }
    }
  );
  context.subscriptions.push(generateCodedTestsCommand);

  // Command: vectorcastTestExplorer.removeCodedTests////////////////////////////////////////////////////////
  // This is the callback for the right clicks in the test explorer tree

  // adding the ... to nodeList, results in us getting a list of selected tests!
  let removeCodedTestsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.removeCodedTests",
    (...nodeList: any) => {
      if (nodeList) {
        deleteTests(nodeList);
      }
    }
  );
  context.subscriptions.push(removeCodedTestsCommand);

  // Command: vectorcastTestExplorer.insertBasisPathTests////////////////////////////////////////////////////////
  let insertBasisPathTestsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.insertBasisPathTests",
    (args: any) => {
      if (args) {
        const testNode: testNodeType = getTestNode(args.id);
        insertBasisPathTests(testNode);
      }
    }
  );
  context.subscriptions.push(insertBasisPathTestsCommand);

  // Command: vectorcastTestExplorer.insertBasisPathTestsFromEditor////////////////////////////////////////////////////////
  let insertBasisPathTestsFromEditorCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.insertBasisPathTestsFromEditor",
    (args: any) => {
      if (args) {
        const testNode = buildTestNodeForFunction(args);
        if (testNode) insertBasisPathTests(testNode);
        else
          vscode.window.showErrorMessage(
            `Unable to create Basis Path Tests for function at line ${args.lineNumber}`
          );
      }
    }
  );
  context.subscriptions.push(insertBasisPathTestsFromEditorCommand);

  // Command: vectorcastTestExplorer.insertATGTests////////////////////////////////////////////////////////
  let insertATGTestsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.insertATGTests",
    (args: any) => {
      if (args) {
        const testNode: testNodeType = getTestNode(args.id);
        insertATGTests(testNode);
      }
    }
  );
  context.subscriptions.push(insertATGTestsCommand);

  // Command: vectorcastTestExplorer.insertATGTestsFromEditor////////////////////////////////////////////////////////
  let insertATGTestsFromEditorCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.insertATGTestsFromEditor",
    (args: any) => {
      if (args) {
        const testNode = buildTestNodeForFunction(args);
        if (testNode) insertATGTests(testNode);
        else
          vscode.window.showErrorMessage(
            `Unable to create ATG Tests for function at line ${args.lineNumber}`
          );
      }
    }
  );
  context.subscriptions.push(insertATGTestsFromEditorCommand);

  let generateRequirementsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.generateRequirements",
    (args: any) => {
      if (args) {
        const testNode: testNodeType = getTestNode(args.id);
        const enviroPath = testNode.enviroPath;
        generateRequirements(enviroPath);
      }
    }
  );
  context.subscriptions.push(generateRequirementsCommand);

  let generateRequirementsTestsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.generateTestsFromRequirements",
    async (args: any) => {
      if (args) {
        const testNode: testNodeType = getTestNode(args.id);
        const enviroPath = testNode.enviroPath;
        await generateTestsFromRequirements(
          enviroPath,
          testNode.functionName || testNode.unitName || null
        );
      }
    }
  );
  context.subscriptions.push(generateRequirementsTestsCommand);

  let importRequirementsFromGatewayCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.importRequirementsFromGateway",
    (args: any) => {
      if (args) {
        const testNode: testNodeType = getTestNode(args.id);
        const enviroPath = testNode.enviroPath;
        importRequirementsFromGateway(enviroPath);
      }
    }
  );
  context.subscriptions.push(importRequirementsFromGatewayCommand);

  let populateRequirementsGatewayCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.populateRequirementsGateway",
    async (args: any) => {
      if (args) {
        const testNode: testNodeType = getTestNode(args.id);
        const enviroPath = testNode.enviroPath;
        await populateRequirementsGateway(enviroPath);
      }
    }
  );
  context.subscriptions.push(populateRequirementsGatewayCommand);

  let testLLMConfigurationCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.testLLMConfiguration",
    async (args: any) => {
      const checkSuccessful = await performLLMProviderUsableCheck();

      if (checkSuccessful) {
        vscode.window.showInformationMessage(
          "LLM configuration test was successful."
        );
      } else {
        vscode.window.showErrorMessage("LLM configuration test failed.");
      }
    }
  );
  context.subscriptions.push(testLLMConfigurationCommand);

  // Command: vectorcastTestExplorer.createTestScriptFromEditor////////////////////////////////////////////////////////
  // This is the callback for right clicks of the source editor flask+ icon
  let createTestScriptFromEditorCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.createTestScriptFromEditor",
    (args: any) => {
      if (args) {
        const testNode = buildTestNodeForFunction(args);
        if (testNode) newTestScript(testNode);
        else
          vscode.window.showErrorMessage(
            `Unable to create test script for function at line ${args.lineNumber}`
          );
      }
    }
  );
  context.subscriptions.push(createTestScriptFromEditorCommand);

  // Command: vectorcastTestExplorer.deleteTest ////////////////////////////////////////////////////////
  let deleteTestCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.deleteTest",
    async (...nodeList: any) => {
      if (nodeList) {
        if (nodeList.length > 1 || nodeList[0].children.size > 0) {
          const message =
            "The selected tests will be deleted, and this action cannot be undone.";
          const answer = await vscode.window.showWarningMessage(
            message,
            "Delete",
            "Cancel"
          );

          if (answer === "Delete") {
            await deleteTests(nodeList);
          }
        } else {
          await deleteTests(nodeList);
        }
      }
    }
  );
  context.subscriptions.push(deleteTestCommand);

  // Command: vectorcastTestExplorer.editTestScript////////////////////////////////////////////////////////
  let editTestScriptCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.editTestScript",
    (args: any) => {
      if (args) {
        openTestScript(args.id);
      }
    }
  );
  context.subscriptions.push(editTestScriptCommand);

  // Command: vectorcastTestExplorer.editCodedTest////////////////////////////////////////////////////////
  let editCodedTestCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.editCodedTest",
    (args: any) => {
      if (args) {
        const testNode: testNodeType = getTestNode(args.id);
        openCodedTest(testNode);
      }
    }
  );
  context.subscriptions.push(editCodedTestCommand);

  // Command: vectorcastTestExplorer.loadTestScript////////////////////////////////////////////////////////
  let loadTestScriptCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.loadTestScript",
    async () => {
      await loadTestScriptButton();
    }
  );
  context.subscriptions.push(loadTestScriptCommand);

  // Command: vectorcastTestExplorer.debugEnviroPath ////////////////////////////////////////////////////////
  // this command is used to return the path to the environment being debugged via
  // the variable: vectorcastTestExplorer.debugEnviroPath that is used in launch.json
  let debugEnviroPathCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.debugEnviroPath",
    () => {
      return pathToEnviroBeingDebugged;
    }
  );
  context.subscriptions.push(debugEnviroPathCommand);

  // Command: vectorcastTestExplorer.debugProgramPath ////////////////////////////////////////////////////////
  // this command is used to return the path to the environment being debugged via
  // the variable: vectorcastTestExplorer.debugProgramPath that is used in launch.json
  let debugProgramPathCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.debugProgramPath",
    () => {
      return pathToProgramBeingDebugged;
    }
  );
  context.subscriptions.push(debugProgramPathCommand);

  // Command: vectorcastTestExplorer.showSettings
  vscode.commands.registerCommand("vectorcastTestExplorer.showSettings", () =>
    showSettings()
  );

  // Command: vectorcastTestExplorer.addLaunchConfiguration ////////////////////////////////////////////////////////
  let addLaunchConfigurationCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.addLaunchConfiguration",
    (args: Uri, argList: Uri[]) => {
      // arg is the actual item that the right click happened on, argList is the list
      // of all items if this is a multi-select.  Since argList is always valid, even for a single
      // selection, we just use this here.
      if (argList) {
        // find the list item that contains launch.json
        for (let i = 0; i < argList.length; i++) {
          if (argList[i].fsPath.includes(launchFile)) {
            addLaunchConfiguration(argList[i], globalPathToSupportFiles);
          }
        }
      } else {
        // if the arglist is undefined, this might be a right click action in the editor
        let activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
          const filePath = activeEditor.document.uri.toString();
          if (filePath.endsWith(launchFile)) {
            addLaunchConfiguration(
              activeEditor.document.uri,
              globalPathToSupportFiles
            );
          }
        }
      }
    }
  );
  context.subscriptions.push(addLaunchConfigurationCommand);

  // Command: vectorcastTestExplorer.addIncludePath ////////////////////////////////////////////////////////
  let addIncludePathCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.addIncludePath",
    (args: Uri, argList: Uri[]) => {
      // arg is the actual item that the right click happened on, argList is the list
      // of all items if this is a multi-select.  Since argList is always valid, even for a single
      // selection, we just use this here.
      if (argList) {
        // find the list item that contains c_cpp_properties.json
        for (let i = 0; i < argList.length; i++) {
          if (argList[i].fsPath.includes(configurationFile)) {
            addIncludePath(argList[i]);
          }
        }
      } else {
        // if the arglist is undefined, this might be a right click action in the editor
        let activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
          const filePath = activeEditor.document.uri.toString();
          if (filePath.endsWith(configurationFile)) {
            addIncludePath(activeEditor.document.uri);
          }
        }
      }
    }
  );
  context.subscriptions.push(addIncludePathCommand);

  // Command: vectorcastTestExplorer.addSettingsFileFilter ////////////////////////////////////////////////////////
  let addSettingsTFileFilterCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.addSettingsFileFilter",
    (args: Uri, argList: Uri[]) => {
      // arg is the actual item that the right click happened on, argList is the list
      // of all items if this is a multi-select.  Since argList is always valid, even for a single
      // selection, we just use this here.
      if (argList) {
        addSettingsFileFilter(argList[0], globalPathToSupportFiles);
      }
    }
  );
  context.subscriptions.push(addSettingsTFileFilterCommand);

  // Command: vectorcastTestExplorer.openVCAST  ////////////////////////////////////////////////////////
  let openVCAST = vscode.commands.registerCommand(
    "vectorcastTestExplorer.openVCAST",
    async (enviroNode: any) => {
      vectorMessage("Starting VectorCAST ...");
      // If the Env is embedded in a project, we want to open the whole project
      const enviroPath = enviroNode.id.split("vcast:")[1];
      if (envIsEmbeddedInProject(enviroPath)) {
        await openProjectFromEnviroPath(enviroPath);
      } else {
        openVcastFromEnviroNode(enviroNode.id, updateDataForEnvironment);
      }
    }
  );
  context.subscriptions.push(openVCAST);

  // Command: vectorcastTestExplorer.openVCASTFromVce  ////////////////////////////////////////////////////////
  let openVCASTFromVce = vscode.commands.registerCommand(
    "vectorcastTestExplorer.openVCASTFromVce",
    async (arg: any) => {
      vectorMessage("Starting VectorCAST ...");
      const dotIndex = arg.fsPath.lastIndexOf(".");
      const enviroPath = arg.fsPath.slice(0, dotIndex);
      if (envIsEmbeddedInProject(enviroPath)) {
        await openProjectFromEnviroPath(enviroPath);
      } else {
        openVcastFromVCEfile(arg.fsPath, updateDataForEnvironment);
      }
    }
  );
  context.subscriptions.push(openVCASTFromVce);

  // Command: vectorcastTestExplorer.buildEnviroFromEnv ////////////////////////////////////////////////////////
  let buildEnviroVCASTCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.buildEnviroFromEnv",
    (arg: Uri) => {
      // arg is the URI of the .env file that was clicked
      if (arg) {
        const envFilepath = arg.fsPath;
        const buildDirectory = path.dirname(envFilepath);
        const enviroFilename = path.basename(envFilepath);
        const enviroName = getEnviroNameFromFile(envFilepath);
        if (enviroName) {
          if (!fs.existsSync(path.join(buildDirectory, enviroName))) {
            buildEnvironmentFromScript(
              buildDirectory,
              enviroFilename.split(".")[0]
            );
          } else {
            vscode.window.showErrorMessage(
              `Environment: ${enviroName} already exists`
            );
          }
        } else {
          vscode.window.showErrorMessage(
            `Unable to determine environment name from file: ${envFilepath}`
          );
        }
      }
    }
  );
  context.subscriptions.push(buildEnviroVCASTCommand);

  // Command: vectorcastTestExplorer.rebuildEnviro  ////////////////////////////////////////////////////////
  let rebuildEnviro = vscode.commands.registerCommand(
    "vectorcastTestExplorer.rebuildEnviro",
    (enviroNode: any) => {
      // this returns the full path to the environment directory
      const enviroPath = getEnviroPathFromID(enviroNode.id);
      rebuildEnvironment(enviroPath, rebuildEnvironmentCallback);
    }
  );
  context.subscriptions.push(rebuildEnviro);

  let updateProjectLevelCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.updateProjectEnvironment",
    async (enviroNode: any) => {
      const enviroPath = getEnviroPathFromID(enviroNode.id);
      // Check if the result is valid
      if (enviroPath) {
        await updateProjectData(enviroPath, true);
      } else {
        vectorMessage(`Unable to find Environment ${enviroNode.id}`);
      }
    }
  );
  context.subscriptions.push(updateProjectLevelCommand);

  // Command: vectorcastTestExplorer.buildExecuteIncremental  ////////////////////////////////////////////////////////
  let buildExecuteIncrementalCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.buildExecuteIncremental",
    async (enviroNode: any) => {
      const enviroPathList: string[] = [];
      let projectPath = "";
      let displayName = "";

      // In case the Node id starts with vcast:, it is an environment node and the id is the build path
      if (enviroNode.id.includes("vcast:")) {
        const enviroPath = enviroNode.id.split("vcast:")[1];
        enviroPathList.push(enviroPath);
        const enviroData = getEnviroNodeData(enviroPath);
        ({ displayName, projectPath } = enviroData);
      } else {
        // Otherwise it's either a project, compiler or testsuite node
        projectPath = enviroNode.id.split(".vcm")[0] + ".vcm";
        const projectData = getLevelFromNodeId(enviroNode.id);
        displayName = projectData.level;

        // Collect all relevant environment paths
        for (const [envPath, envValue] of environmentDataCache) {
          // If projectPath == enviroNode.id -> Project Node, otherwise we have to check
          // if the current displayName is part of the envValue.displayName (compiler, testsuite)
          if (
            envValue.projectPath === projectPath &&
            (projectPath === enviroNode.id ||
              envValue.displayName.includes(displayName))
          ) {
            enviroPathList.push(envPath);
          }
        }
      }

      await buildExecuteIncremental(
        projectPath,
        displayName,
        enviroPathList,
        enviroNode.id
      );
      await refreshAllExtensionData();
    }
  );

  context.subscriptions.push(buildExecuteIncrementalCommand);

  let openProjectInVectorCAST = vscode.commands.registerCommand(
    "vectorcastTestExplorer.openProjectInVectorCAST",
    async (node: any) => {
      // this returns the full path to the environment directory
      const result = getVcmRoot(node.id);

      // Check if the result is valid
      if (result) {
        const { rootPath, vcmName } = result;
        vectorMessage(`Opening ${vcmName} in VectorCAST...`);
        await openProjectInVcast(rootPath, vcmName);
      } else {
        vectorMessage(`Unable to open project ${node.id}`);
      }
    }
  );
  context.subscriptions.push(openProjectInVectorCAST);

  let addCompilerToProjectCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.addCompilerToProject",
    async (args: any) => {
      // Verify that the command was invoked from a node with an 'id' property.
      if (!args?.id) {
        vscode.window.showErrorMessage("No project node provided.");
        return;
      }
      //project file path
      const projectFilePath = args.id;

      // Open a file dialog so the user can select a .CFG file.
      const cfgFiles = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: "Select VectorCAST Configuration (.CFG) file",
        filters: {
          "CFG Files": ["cfg"],
          "All Files": ["*"],
        },
      });

      if (!cfgFiles || cfgFiles.length === 0) {
        vscode.window.showInformationMessage("No CFG file selected.");
        return;
      }

      // Get the first selected file's path.
      const pathToCFG = cfgFiles[0].fsPath;

      await addCompilerToProject(projectFilePath, pathToCFG);
    }
  );
  context.subscriptions.push(addCompilerToProjectCommand);

  const addTestsuiteToCompiler = vscode.commands.registerCommand(
    "vectorcastTestExplorer.addTestsuiteToCompiler",
    async (node: any) => {
      const manageWebviewSrcDir = resolveWebviewBase(context);
      const panel = vscode.window.createWebviewPanel(
        "addTestsuiteToCompiler",
        "Add Testsuite to Compiler",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.file(manageWebviewSrcDir)],
        }
      );

      panel.webview.html = await getTestsuiteWebviewContent(context, panel);

      // --- Dispatch Table ---
      const dispatch: Record<string, (msg?: any) => Promise<void> | void> = {
        submit: handleSubmit,
        cancel: () => panel.dispose(),
      };

      panel.webview.onDidReceiveMessage(
        (message) => dispatch[message.command]?.(message),
        undefined,
        context.subscriptions
      );

      // --- Handlers ---
      function handleSubmit(message: { testsuiteName?: string }): void {
        const { testsuiteName } = message;

        if (!testsuiteName) {
          vscode.window.showErrorMessage("Testsuite name is required.");
          return;
        }

        const projectPath = path.dirname(node.id);
        const compilerName = path.basename(node.id);

        createTestsuiteInCompiler(projectPath, compilerName, testsuiteName);
        panel.dispose();
      }
    }
  );

  context.subscriptions.push(addTestsuiteToCompiler);

  // Webview HTML content.
  async function getTestsuiteWebviewContent(
    context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel
  ): Promise<string> {
    const base = resolveWebviewBase(context);

    // on-disk locations
    const cssOnDisk = vscode.Uri.file(
      path.join(base, "css", "addTestsuite.css")
    );
    const scriptOnDisk = vscode.Uri.file(
      path.join(base, "webviewScripts", "addTestsuite.js")
    );
    const htmlPath = path.join(base, "html", "addTestsuite.html");

    // webview URIs
    const cssUri = panel.webview.asWebviewUri(cssOnDisk);
    const scriptUri = panel.webview.asWebviewUri(scriptOnDisk);

    // read template
    let html = fs.readFileSync(htmlPath, "utf8");

    // build CSP + nonce
    const nonce = getNonce();
    const cspMeta = `
      <meta http-equiv="Content-Security-Policy"
            content="default-src 'none';
                     style-src ${panel.webview.cspSource};
                     script-src 'nonce-${nonce}' ${panel.webview.cspSource};">
    `;

    // inject CSP
    html = html.replace(/<head>/, `<head>${cspMeta}`);

    // replace placeholders and add nonce to script tag
    html = html
      .replace(/{{\s*cssUri\s*}}/g, cssUri.toString())
      .replace(
        /<script src="{{\s*scriptUri\s*}}"><\/script>/,
        `<script nonce="${nonce}" src="${scriptUri}"></script>`
      );

    return html;
  }

  // Command: vectorcastTestExplorer.buildProjectEnviro  ////////////////////////////////////////////////////////
  let buildProjectEnviro = vscode.commands.registerCommand(
    "vectorcastTestExplorer.buildProjectEnviro",
    async (enviroNode: any) => {
      // displayName is the what will be passed as the --level arg value
      const enviroPath = enviroNode.id.split("vcast:")[1];
      const enviroData: environmentNodeDataType = getEnviroNodeData(enviroPath);
      const displayName = enviroData.displayName;
      console.log("Building project environment: " + displayName);

      await buildProjectEnvironment(
        enviroData.projectPath,
        displayName,
        enviroPath
      );
    }
  );
  context.subscriptions.push(buildProjectEnviro);

  let deleteTestsuiteCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.deleteTestsuite",
    async (node: any) => {
      const nodeParts = node.id.split("/");
      // compiler/testsuite
      // Can't do path.join because on windows the level would be with the wrong "\"
      const testsuiteLevel =
        nodeParts[nodeParts.length - 2] + "/" + nodeParts[nodeParts.length - 1];
      // Join the path without the testsuite level
      const joinedPath = path.join(...nodeParts.slice(0, nodeParts.length - 2));
      // Add a leading slash for non-Windows platforms
      const projectPath =
        process.platform === "win32" ? joinedPath : "/" + joinedPath;
      await deleteLevel(projectPath, testsuiteLevel);
    }
  );
  context.subscriptions.push(deleteTestsuiteCommand);

  // Command: vectorcastTestExplorer.deleteCompiler ////////////////////////////////////////////////////////
  let deleteCompilerCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.deleteCompiler",
    async (node: any) => {
      const compiler = node.id;
      const projectPath = path.dirname(compiler);
      const compilerLevel = path.basename(compiler);
      await deleteLevel(projectPath, compilerLevel);
    }
  );
  context.subscriptions.push(deleteCompilerCommand);

  // Command: vectorcastTestExplorer.deleteEnviroFromProject  ////////////////////////////////////////////////////////
  let deleteEnviroFromProject = vscode.commands.registerCommand(
    "vectorcastTestExplorer.deleteEnviroFromProject",
    async (enviroNode: any) => {
      const enviroPath = enviroNode.id.split("vcast:")[1];
      const enviroName = path.basename(enviroPath);
      const enviroData: environmentNodeDataType = getEnviroNodeData(enviroPath);
      // always ask for confirmation before deleting an environment
      const message =
        "Environment: " +
        enviroName +
        " will be deleted from the project, and this action cannot be undone.";
      vscode.window
        .showInformationMessage(message, "Delete", "Cancel")
        .then(async (answer) => {
          if (answer === "Delete") {
            // Delete the env completely from the project
            await deleteEnvironmentFromProject(
              enviroData.projectPath,
              enviroName
            );
          }
        });
    }
  );
  context.subscriptions.push(deleteEnviroFromProject);

  // Command: vectorcastTestExplorer.removeTestsuite  ////////////////////////////////////////////////////////
  let removeTestsuite = vscode.commands.registerCommand(
    "vectorcastTestExplorer.removeTestsuite",
    async (enviroNode: any) => {
      // this returns the full path to the environment directory
      let enviroPath = getEnviroPathFromID(enviroNode.id);
      // In case the env is not built, it will be not present in the cache
      if (!enviroPath) {
        // So we check if it is present in the unbuilt list
        // If so, we take the id and split it after "vcast:" to get the path
        // In case that is not possible, we throw an error message
        if (vcastUnbuiltEnviroList.includes(enviroNode.id)) {
          const parts = enviroNode.id.split(":");
          enviroPath = parts.slice(1).join(":");
        } else {
          vscode.window.showErrorMessage(
            `Unable to determine environment path from node: ${enviroNode.id}`
          );
          return;
        }
      }
      await removeTestsuiteFromProject(enviroPath, enviroNode.id);
    }
  );
  context.subscriptions.push(removeTestsuite);

  // Command: vectorcastTestExplorer.deleteEnviro  ////////////////////////////////////////////////////////
  let deleteEnviro = vscode.commands.registerCommand(
    "vectorcastTestExplorer.deleteEnviro",
    (enviroNode: any) => {
      // this returns the full path to the environment directory
      const enviroPath = getEnviroPathFromID(enviroNode.id);

      // always ask for confirmation before deleting an environment
      const message =
        "Environment: " +
        enviroPath +
        " will be deleted, and this action cannot be undone.";
      vscode.window
        .showInformationMessage(message, "Delete", "Cancel")
        .then((answer) => {
          if (answer === "Delete") {
            // execute a clicast call to delete the test
            deleteEnvironment(enviroPath, enviroNode.id);
          }
        });
    }
  );
  context.subscriptions.push(deleteEnviro);

  // Command: vectorcastTestExplorer.cleanEnviro  ////////////////////////////////////////////////////////
  let cleanEnviro = vscode.commands.registerCommand(
    "vectorcastTestExplorer.cleanEnviro",
    (enviroNode: any) => {
      // this returns the full path to the environment directory
      const enviroPath = getEnviroPathFromID(enviroNode.id);
      const enviroData: environmentNodeDataType = getEnviroNodeData(enviroPath);
      const displayName = enviroData.displayName;
      const projectPath = enviroData.projectPath;

      // always ask for confirmation before deleting an environment
      const message =
        "Environment: " +
        enviroPath +
        " will be cleaned, and this action cannot be undone.";
      vscode.window
        .showInformationMessage(message, "Clean Environment", "Cancel")
        .then(async (answer) => {
          if (answer === "Clean Environment") {
            // execute a manage call to clean the env
            await cleanProjectEnvironment(
              enviroPath,
              enviroNode.id,
              projectPath,
              displayName
            );
          }
        });
    }
  );
  context.subscriptions.push(cleanEnviro);

  // Command: vectorcastTestExplorer.setDefaultConfigFile////////////////////////////////////////////////////////
  let selectDefaultConfigFile = vscode.commands.registerCommand(
    "vectorcastTestExplorer.setDefaultConfigFile",
    (fileURI: any) => {
      // we will only get here if the user has selected a CCAST_.CFG file
      // all we do is replace the current value of the configurationLocation option
      // no validity checking is needed.
      if (fileURI) {
        const settings = vscode.workspace.getConfiguration(
          "vectorcastTestExplorer"
        );
        settings.update(
          "configurationLocation",
          fileURI.fsPath,
          vscode.ConfigurationTarget.Workspace
        );
      }
    }
  );
  context.subscriptions.push(selectDefaultConfigFile);

  // This command appears in the context menu of the vscode gutter (same as Add Breakpoint) and
  // generates the MCDC report.
  let getMCDCReportCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.viewMCDCReport",
    async (args) => {
      const activeEditor = vscode.window.activeTextEditor;
      let fileFromUri = forceLowerCaseDriveLetter(args.uri.fsPath);

      if (activeEditor || fileFromUri) {
        // Get the file name and remove the extension --> For the UNIT parameter.
        // Prioritize activeEditor for user convenience—it reflects the file in focus.
        // Fallback to fileFromUri ensures the command works
        // (if the focus is on no file --> activeEditor undefined --> command wont work)
        // But we still can get the file üath from where it s called via the uri
        const filePath = activeEditor
          ? activeEditor.document.uri.fsPath
          : fileFromUri;
        const enviroPath = getEnvPathForFilePath(filePath);
        const fileName = path.parse(filePath).name;
        if (enviroPath) {
          viewMCDCReport(enviroPath, fileName, args.lineNumber);
        } else {
          vscode.window.showErrorMessage(
            `Did not find environment name ${enviroPath} or path for file: ${filePath}`
          );
        }
      }
    }
  );
  context.subscriptions.push(getMCDCReportCommand);

  let showRequirementsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.showRequirements",
    async (args: any) => {
      if (args) {
        const testNode: testNodeType = getTestNode(args.id);
        const enviroPath = testNode.enviroPath;

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

        let filePath = "";
        let fileType = "";
        if (fs.existsSync(xlsxPath)) {
          filePath = xlsxPath;
          fileType = "Excel";
        } else if (fs.existsSync(csvPath)) {
          filePath = csvPath;
          fileType = "CSV";
        } else {
          vscode.window.showErrorMessage(
            "Requirements file not found. Generate requirements first."
          );
          return;
        }

        try {
          const panel = vscode.window.createWebviewPanel(
            "requirementsReport",
            "Requirements Report",
            vscode.ViewColumn.One,
            { enableScripts: true }
          );

          panel.webview.html = `<html><body><h1>Loading ${fileType} requirements...</h1></body></html>`;
          const requirements = await parseRequirementsFromFile(filePath);
          const htmlContent = generateRequirementsHtml(requirements);
          panel.webview.html = htmlContent;
        } catch (err) {
          vscode.window.showErrorMessage(
            `Error generating requirements report: ${err}`
          );
        }
      }
    }
  );
  context.subscriptions.push(showRequirementsCommand);

  let removeRequirementsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.removeRequirements",
    async (args: any) => {
      if (args) {
        const testNode: testNodeType = getTestNode(args.id);
        const enviroPath = testNode.enviroPath;

        const message =
          "This will remove all generated requirements files. This action cannot be undone.";
        const choice = await vscode.window.showWarningMessage(
          message,
          "Remove",
          "Cancel"
        );

        if (choice === "Remove") {
          const parentDir = path.dirname(enviroPath);
          const enviroNameWithExt = path.basename(enviroPath);
          // remove ".env" if present
          const enviroNameWithoutExt = enviroNameWithExt.replace(/\.env$/, "");
          const envReqsFolderPath = path.join(
            parentDir,
            `reqs-${enviroNameWithoutExt}`
          );

          const filesToRemove = [
            path.join(envReqsFolderPath, "reqs.csv"),
            path.join(envReqsFolderPath, "reqs.xlsx"),
            path.join(envReqsFolderPath, "reqs_converted.csv"),
            path.join(envReqsFolderPath, "reqs.html"),
            path.join(envReqsFolderPath, "reqs2tests.tst"),
          ];

          // Remove files
          for (const file of filesToRemove) {
            if (fs.existsSync(file)) {
              try {
                fs.unlinkSync(file);
              } catch (err) {
                vscode.window.showErrorMessage(
                  `Failed to remove ${file}: ${err}`
                );
              }
            }
          }

          const generatedRepositoryPath = path.join(
            envReqsFolderPath,
            "generated_requirement_repository"
          );
          const actualRepositoryPath =
            findRelevantRequirementGateway(enviroPath);

          // Separately prompt for repository directory removal
          if (
            fs.existsSync(generatedRepositoryPath) &&
            path.relative(generatedRepositoryPath, actualRepositoryPath) === ""
          ) {
            const repoMessage =
              "Would you also like to remove the auto-generated requirements gateway too?";
            const repoChoice = await vscode.window.showWarningMessage(
              repoMessage,
              "Yes",
              "No"
            );

            if (repoChoice === "Yes") {
              try {
                fs.rmdirSync(generatedRepositoryPath, { recursive: true });
              } catch (err) {
                vscode.window.showErrorMessage(
                  `Failed to remove repository directory: ${err}`
                );
              }
            }
          }

          await refreshAllExtensionData();
          updateRequirementsAvailability(enviroPath);
          vscode.window.showInformationMessage(
            "Requirements removed successfully"
          );
        }
      }
    }
  );
  context.subscriptions.push(removeRequirementsCommand);

  vscode.workspace.onDidChangeWorkspaceFolders(
    async (e) => {
      await refreshAllExtensionData();
      setGlobalProjectIsOpenedChecker();
      setGlobalCompilerAndTestsuites();
      // Refresh requirements availability for all environments
      if (workspace.workspaceFolders && workspace.workspaceFolders.length > 0) {
        const envPaths = await getEnvironmentListIncludingUnbuilt(
          workspace.workspaceFolders[0].uri.fsPath
        );
        for (const envPath of envPaths) {
          updateRequirementsAvailability(envPath);
        }
      }
    },
    null,
    context.subscriptions
  );

  vscode.window.onDidChangeActiveTextEditor(
    // this function gets called when the user changes the
    // active editor, including when closing an editor
    // in which case the "editor" parameter will be undefined
    async (editor) => {
      if (editor) {
        await updateDisplayedCoverage();
        updateTestDecorator();
      } else {
        hideStatusBarCoverage();
      }
    },
    null,
    context.subscriptions
  );

  // This works nicely to remove the decorations when
  // the user has auto-save ON, but not if they don't.
  // There is another event called onDidChangeTextDocument
  // that gets invoked when the user edits, but to determine
  // if the file has changed we compute the checksum of the file
  // and since the file on disk has not changed, we would keep the
  // decorations anyway.
  vscode.workspace.onDidSaveTextDocument(
    async (editor) => {
      // changing the file will invalidate the
      // coverage and editor annotations
      if (editor) {
        // Check if file ends with .tst and has "build" in its path
        // We want to load the test script automatically when the user saves
        const filePath = editor.uri.fsPath;
        if (filePath.endsWith(".tst") && alreadyConfigured) {
          await loadTestScript();
        }
        await updateCodedTestCases(editor);
        await updateCOVdecorations();
        updateTestDecorator();
      }
    },
    null,
    context.subscriptions
  );
}

async function installPreActivationEventHandlers(
  context: vscode.ExtensionContext
) {
  // this is separate from configureExtension() because we want to
  // handle some actions before the configuration of the extension is complete
  // Specifically for the case where the user does a create environment action
  // and vcast installation is invalid.

  // Note: there is no existing API to do variable substitution for configuration
  // values that could contain things like ${workspaceFolder} so we don't provide support.
  // Here is a starting point for research: https://github.com/microsoft/vscode/issues/46471

  vscode.workspace.onDidChangeConfiguration(async (event) => {
    // post configuration, we handle changes to all options ...
    if (alreadyConfigured) {
      // This function gets triggered when any option at any level (user, workspace, etc.)
      // gets changed.  The event parameter does not indicate what level has been
      // edited but you can use the

      if (
        event.affectsConfiguration("vectorcastTestExplorer.decorateExplorer")
      ) {
        updateExploreDecorations();
      } else if (
        event.affectsConfiguration("vectorcastTestExplorer.verboseLogging")
      ) {
        adjustVerboseSetting();
      } else if (
        event.affectsConfiguration(
          "vectorcastTestExplorer.configurationLocation"
        )
      ) {
        updateConfigurationOption();
      } else if (
        event.affectsConfiguration("vectorcastTestExplorer.unitTestLocation")
      ) {
        updateUnitTestLocationOption();
      } else if (
        event.affectsConfiguration("vectorcastTestExplorer.useDataServer")
      ) {
        initializeServerState();
      } else if (
        event.affectsConfiguration("vectorcastTestExplorer.build.coverageKind")
      ) {
        await updateCoverageAndRebuildEnv();
      } else if (
        event.affectsConfiguration(
          "vectorcastTestExplorer.vectorcastInstallationLocation"
        )
      ) {
        // if the user changes the path to vcast, we need to reset the values
        // for clicast and vpython path etc.
        if (await checkIfInstallationIsOK()) {
          await initializeServerState();
          await refreshAllExtensionData();
        } else {
          // this will remove the status bar icon and shutdown the server
          // it needs to be in both sides of the if because we want it to run
          // before the "refreshAllExtensionData" call in the TRUE case.
          await initializeServerState();
        }
      } else if (
        event.affectsConfiguration(
          "vectorcastTestExplorer.reqs2x.installationLocation"
        ) ||
        event.affectsConfiguration(
          "vectorcastTestExplorer.reqs2x.enableReqs2xFeature"
        )
      ) {
        // If the user changes the path to reqs2x or tries to enable or disable the feature, we re-initialize
        initializeReqs2X(context);
      }
    }
    // pre-configuration, we only handle changes to the vcast installation location
    else if (
      event.affectsConfiguration(
        "vectorcastTestExplorer.vectorcastInstallationLocation"
      )
    ) {
      // this call will check if the new value is valid,
      // and if so, perform extension activation
      await checkPrerequisites(context);
      await initializeServerState();
    }
  });

  // Command: vectorcastTestExplorer.newEnviroVCAST ////////////////////////////////////////////////////////
  let newEnviroVCASTCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.newEnviroVCAST",
    async (args: Uri, argList: Uri[]) => {
      // contains a check for already configured, so no work will be done in that case
      await checkPrerequisites(context);
      if (alreadyConfigured) {
        // arg is the actual item that the right click happened on, argList is the list
        // of all items if this is a multi-select.  Since argList is always valid, even for a single
        // selection, we just use this here.
        if (argList) {
          await newEnvironment(argList);
        }
      }
    }
  );
  context.subscriptions.push(newEnviroVCASTCommand);

  const importEnviroToProject = vscode.commands.registerCommand(
    "vectorcastTestExplorer.importEnviroToProject",
    async (_args: vscode.Uri, argList: vscode.Uri[]) => {
      const manageWebviewSrcDir = resolveWebviewBase(context);
      const panel = vscode.window.createWebviewPanel(
        "importEnviroToProject",
        "Import Environment to Project",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.file(manageWebviewSrcDir)],
        }
      );

      panel.webview.html = await getImportEnvWebviewContent(
        context,
        panel,
        argList
      );

      // --- Dispatch Table ---
      const dispatch: Record<string, (msg?: any) => Promise<void> | void> = {
        importEnvFile: handleImportEnvFile,
        submit: handleSubmit,
        cancel: () => panel.dispose(),
      };

      panel.webview.onDidReceiveMessage(
        (message) => dispatch[message.command]?.(message),
        undefined,
        context.subscriptions
      );

      // --- Handlers ---
      async function handleImportEnvFile(): Promise<void> {
        const files = await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { "Env Files": ["env"] },
          openLabel: "Select Env File",
        });

        if (files?.length) {
          panel.webview.postMessage({
            command: "envFileSelected",
            envFile: files[0].fsPath,
          });
        }
      }

      async function handleSubmit(message: {
        projectPath?: string;
        envFiles?: string[];
        testsuiteArgs?: string[];
      }): Promise<void> {
        const { projectPath, envFiles = [], testsuiteArgs = [] } = message;

        if (!projectPath || !envFiles.length || !testsuiteArgs.length) {
          vscode.window.showErrorMessage(
            "Project Path, Env Files, and Testsuite are required."
          );
          return;
        }

        for (const file of envFiles) {
          if (!fs.existsSync(file)) {
            vscode.window.showInformationMessage(
              `Environment file ${file} does not exist.`
            );
            return;
          }

          for (const level of testsuiteArgs) {
            vectorMessage(`Env File: ${file}`);
            await importEnvToTestsuite(projectPath, level, file);
          }
        }

        panel.dispose();
      }
    }
  );

  context.subscriptions.push(importEnviroToProject);

  // Command: vectorcastTestExplorer.addEnviroToProject
  const addEnviroToProject = vscode.commands.registerCommand(
    "vectorcastTestExplorer.addEnviroToProject",
    async (_projectNode: any) => {
      const manageWebviewSrcDir = resolveWebviewBase(context);
      const panel = vscode.window.createWebviewPanel(
        "addEnviroToProject",
        "Add Environment To Project",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.file(manageWebviewSrcDir)],
        }
      );

      panel.webview.html = await getImportEnvWebviewContent(context, panel, []);

      // --- Command dispatch table ---
      const dispatch: Record<string, (msg?: any) => Promise<void> | void> = {
        importEnvFile: handleImportEnvFile,
        submit: handleSubmit,
        cancel: () => panel.dispose(),
      };

      // --- Message handler ---
      panel.webview.onDidReceiveMessage(
        (message) => dispatch[message.command]?.(message),
        undefined,
        context.subscriptions
      );

      // --- Handlers ---
      async function handleImportEnvFile() {
        const [uri] =
          (await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { "Environment Files": ["env"] },
            openLabel: "Select Environment File",
          })) ?? [];

        if (uri) {
          panel.webview.postMessage({
            command: "envFileSelected",
            envFile: uri.fsPath,
          });
        }
      }

      async function handleSubmit(message: {
        projectPath?: string;
        envFiles?: string[];
        testsuiteArgs?: string[];
      }): Promise<void> {
        const { projectPath, envFiles = [], testsuiteArgs = [] } = message;

        if (!projectPath || !envFiles.length || !testsuiteArgs.length) {
          vscode.window.showErrorMessage(
            "Project Path, Env Files, and Testsuite are required."
          );
          return;
        }

        if (envFiles.length > 1) {
          vscode.window.showInformationMessage(
            "Multiple Env Files selected. Only the first one will be used."
          );
        }

        const envFile = envFiles[0];

        // this should not happen as we click on the envs, but in case the user manually changes something
        if (!fs.existsSync(envFile)) {
          vscode.window.showInformationMessage(
            `Environment file ${envFile} does not exist.`
          );
          return;
        }

        for (const [index, level] of testsuiteArgs.entries()) {
          vectorMessage(`Env File: ${envFile}`);

          if (index === 0) {
            await importEnvToTestsuite(projectPath, level, envFile);
          } else {
            const envName = path.basename(envFile, ".env");
            await addEnvToTestsuite(projectPath, level, envName);
          }
        }

        panel.dispose();
      }
    }
  );

  context.subscriptions.push(addEnviroToProject);

  /**
   * Returns the HTML content for the webview.
   * It builds a form that allows the user to select:
   *   - a Project Path (populated from a global combobox map),
   *   - Env Files (with pre-filled values from the argList), and
   *   - a set of Compiler/Testsuite rows.
   *
   * The label "Source Files" is replaced with "Env Files" in this version.
   */
  async function getImportEnvWebviewContent(
    context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
    argList: vscode.Uri[]
  ): Promise<string> {
    const base = resolveWebviewBase(context);

    // on-disk resource locations
    const cssOnDisk = vscode.Uri.file(path.join(base, "css", "importEnv.css"));
    const scriptOnDisk = vscode.Uri.file(
      path.join(base, "webviewScripts", "importEnv.js")
    );
    const htmlPath = path.join(base, "html", "importEnv.html");

    // convert to webview URIs
    const cssUri = panel.webview.asWebviewUri(cssOnDisk);
    const scriptUri = panel.webview.asWebviewUri(scriptOnDisk);

    // prepare dynamic data
    const projectData = JSON.stringify(
      Array.from(globalProjectWebviewComboboxItems.entries())
    );
    const initialEnvFile = JSON.stringify(argList[0]?.fsPath ?? "");

    // load the template
    let html = fs.readFileSync(htmlPath, "utf8");

    // inject CSP + nonce
    const nonce = getNonce();
    const cspMeta = `
      <meta http-equiv="Content-Security-Policy"
            content="default-src 'none';
                     style-src ${panel.webview.cspSource};
                     script-src 'nonce-${nonce}' ${panel.webview.cspSource};">
    `;
    html = html.replace(/<head>/, `<head>${cspMeta}`);

    // inject URIs + data
    html = html
      .replace(/{{\s*cssUri\s*}}/g, cssUri.toString())
      .replace(
        /<script src="{{\s*scriptUri\s*}}"><\/script>/,
        `<script nonce="${nonce}" src="${scriptUri}"></script>`
      )
      .replace(
        /<\/head>/,
        `  <script nonce="${nonce}">
         window.projectData = ${projectData};
         window.initialEnvFile = ${initialEnvFile};
        </script>\n</head>`
      );

    return html;
  }

  const newEnviroInProjectVCASTCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.newEnviroInProjectVCAST",
    async (_args: vscode.Uri, argList: vscode.Uri[]) => {
      const manageWebviewSrcDir = resolveWebviewBase(context);
      const panel = vscode.window.createWebviewPanel(
        "newEnvProject",
        "Create Environment in Project",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.file(manageWebviewSrcDir)],
        }
      );

      panel.webview.html = await getNewEnvWebviewContent(
        context,
        panel,
        argList
      );

      // --- Dispatch Table ---
      const dispatch: Record<string, (msg?: any) => Promise<void> | void> = {
        submit: handleSubmit,
        cancel: () => panel.dispose(),
      };

      panel.webview.onDidReceiveMessage(
        (message) => dispatch[message.command]?.(message),
        undefined,
        context.subscriptions
      );

      // --- Handlers ---
      async function handleSubmit(message: {
        projectPath?: string;
        sourceFiles?: string[];
        testsuiteArgs?: string[];
      }): Promise<void> {
        const { projectPath, sourceFiles = [], testsuiteArgs = [] } = message;

        if (!projectPath || !testsuiteArgs.length) {
          vscode.window.showErrorMessage(
            "Compiler Name and Testsuite Name are required."
          );
          return;
        }

        // Validate file existence
        for (const file of sourceFiles) {
          if (!fs.existsSync(file)) {
            vscode.window.showInformationMessage(
              `Source file ${file} does not exist.`
            );
            return;
          }
        }

        const params: ProjectEnvParameters = {
          path: projectPath,
          sourceFiles,
          testsuiteArgs,
        };

        vscode.window.showInformationMessage(
          `Creating environment in ${projectPath} with ${testsuiteArgs.join(
            ", "
          )} and sources ${sourceFiles.join(", ")}`
        );

        await newEnvironment(argList, params);
        panel.dispose();
      }
    }
  );

  context.subscriptions.push(newEnviroInProjectVCASTCommand);

  async function getNewEnvWebviewContent(
    context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
    argList: vscode.Uri[]
  ): Promise<string> {
    const base = resolveWebviewBase(context);
    const cssOnDisk = vscode.Uri.file(
      path.join(base, "css", "newEnvProject.css")
    );
    const scriptOnDisk = vscode.Uri.file(
      path.join(base, "webviewScripts", "newEnvProject.js")
    );
    const htmlPath = path.join(base, "html", "newEnvProject.html");

    const cssUri = panel.webview.asWebviewUri(cssOnDisk);
    const scriptUri = panel.webview.asWebviewUri(scriptOnDisk);

    const projectData = JSON.stringify(
      Array.from(globalProjectWebviewComboboxItems.entries())
    );
    const initialSourceFiles = JSON.stringify(argList.map((u) => u.fsPath));

    let html = fs.readFileSync(htmlPath, "utf8");

    const nonce = getNonce();
    const csp = `
      <meta http-equiv="Content-Security-Policy"
            content="default-src 'none';
                     style-src ${panel.webview.cspSource};
                     script-src 'nonce-${nonce}' ${panel.webview.cspSource};">
    `;
    html = html.replace(/<head>/, `<head>${csp}`);

    html = html
      .replace(/{{\s*cssUri\s*}}/g, cssUri.toString())
      .replace(
        /<script src="{{\s*scriptUri\s*}}"><\/script>/,
        `<script nonce="${nonce}" src="${scriptUri}"></script>`
      )
      .replace(
        /<\/head>/,
        `<script nonce="${nonce}">
           window.projectData = ${projectData};
           window.initialSourceFiles = ${initialSourceFiles};
         </script>\n</head>`
      );

    return html;
  }

  const createNewProjectCmd = vscode.commands.registerCommand(
    "vectorcastTestExplorer.createNewProject",
    async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders?.length) {
        vscode.window.showErrorMessage("Open a folder first.");
        return;
      }
      const workspaceRoot = workspaceFolders[0].uri.fsPath;

      const baseDir = resolveWebviewBase(context);
      const panel = vscode.window.createWebviewPanel(
        "newProject",
        "Create New Project",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.file(baseDir)],
        }
      );

      panel.webview.html = await getNewProjectWebviewContent(
        context,
        panel,
        workspaceRoot
      );

      panel.webview.onDidReceiveMessage(
        async (msg) => {
          switch (msg.command) {
            case "browseForDir": {
              const folderUris = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: "Select Target Folder",
              });
              if (folderUris?.length) {
                panel.webview.postMessage({
                  command: "setTargetDir",
                  targetDir: folderUris[0].fsPath,
                });
              }
              break;
            }
            case "submit":
              await handleSubmit(msg);
              break;
            case "cancel":
              panel.dispose();
              break;
          }
        },
        undefined,
        context.subscriptions
      );

      async function handleSubmit(message: {
        projectName?: string;
        compilerName?: string;
        targetDir?: string;
      }) {
        const { projectName, compilerName, targetDir } = message;
        // Make sure that Inputs have to be filled and the compiler tag is found
        if (!projectName) {
          vscode.window.showErrorMessage("Project Name is required.");
          return;
        }
        if (!compilerName) {
          vscode.window.showErrorMessage("Compiler selection is required.");
          return;
        }
        const compilerTag = compilerTagList[compilerName];
        if (!compilerTag) {
          vscode.window.showErrorMessage(
            `No compiler tag found for "${compilerName}".`
          );
          return;
        }

        const base = targetDir ?? workspaceRoot;
        const projectPath = path.join(base, projectName);

        vscode.window.showInformationMessage(
          `Creating project "${projectName}" at ${projectPath} using ${compilerName}.`
        );
        await createNewProject(projectPath, compilerTag);
        panel.dispose();
      }
    }
  );

  context.subscriptions.push(createNewProjectCmd);

  async function getNewProjectWebviewContent(
    context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
    workspaceRoot: string
  ): Promise<string> {
    const base = resolveWebviewBase(context);
    const cssOnDisk = vscode.Uri.file(path.join(base, "css", "newProject.css"));
    const scriptOnDisk = vscode.Uri.file(
      path.join(base, "webviewScripts", "newProject.js")
    );
    const htmlPath = path.join(base, "html", "newProject.html");

    const cssUri = panel.webview.asWebviewUri(cssOnDisk);
    const scriptUri = panel.webview.asWebviewUri(scriptOnDisk);

    const compilersJson = JSON.stringify(Object.keys(compilerTagList));
    // pass default targetDir as workspace root
    const workspaceJson = JSON.stringify(workspaceRoot);

    let html = fs.readFileSync(htmlPath, "utf8");
    const nonce = getNonce();
    html = html.replace(
      /<head>/,
      `<head>
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${
          panel.webview.cspSource
        }; script-src 'nonce-${nonce}' ${panel.webview.cspSource};">
        <script nonce="${nonce}">
          window.compilerData = ${compilersJson};
          window.defaultDir   = ${workspaceJson};
        </script>`
    );
    html = html.replace("{{ cssUri }}", cssUri.toString());
    html = html.replace(
      "{{ scriptUri }}",
      `<script nonce="${nonce}" src="${scriptUri}"></script>`
    );

    return html;
  }

  const newCompilerCmd = vscode.commands.registerCommand(
    "vectorcastTestExplorer.newCompilerInProjectVCAST",
    async (args: any) => {
      // Retrieve project path from the clicked node's 'id'
      const projectPath: string | undefined = args?.id;
      if (!projectPath) {
        vscode.window.showErrorMessage("No project node provided.");
        return;
      }

      // Create webview panel
      const baseDir = resolveWebviewBase(context);
      const panel = vscode.window.createWebviewPanel(
        "newCompiler",
        "Create Compiler in Project",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.file(baseDir)],
        }
      );

      // Load HTML into webview
      panel.webview.html = await getNewCompilerWebviewContent(
        context,
        panel,
        projectPath
      );

      // Dispatch table
      const dispatch: Record<string, (msg?: any) => Promise<void> | void> = {
        submit: handleSubmit,
        cancel: () => panel.dispose(),
      };

      panel.webview.onDidReceiveMessage(
        (message) => dispatch[message.command]?.(message),
        undefined,
        context.subscriptions
      );

      // Handle submission
      async function handleSubmit(message: { compilerName?: string }) {
        const compilerName = message.compilerName;
        if (!compilerName) {
          vscode.window.showErrorMessage("Compiler Name is required.");
          return;
        }

        const compilerTemplate = compilerTagList[compilerName];
        if (!compilerTemplate) {
          vscode.window.showErrorMessage(
            `Compiler Template Name was not found for ${compilerName}.`
          );
          return;
        }

        if (projectPath) {
          vscode.window.showInformationMessage(
            `Adding compiler ${compilerName} to project ${projectPath}`
          );
          await createNewCompilerInProject(projectPath, compilerTemplate);
        } else {
          vscode.window.showErrorMessage(
            "Project Path is not defined. Cannot add compiler."
          );
          return;
        }
        panel.dispose();
      }
    }
  );

  context.subscriptions.push(newCompilerCmd);

  async function getNewCompilerWebviewContent(
    context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
    projectPath: string
  ): Promise<string> {
    const base = resolveWebviewBase(context);
    const cssOnDisk = vscode.Uri.file(
      path.join(base, "css", "newCompiler.css")
    );
    const scriptOnDisk = vscode.Uri.file(
      path.join(base, "webviewScripts", "newCompiler.js")
    );
    const htmlPath = path.join(base, "html", "newCompiler.html");

    const cssUri = panel.webview.asWebviewUri(cssOnDisk);
    const scriptUri = panel.webview.asWebviewUri(scriptOnDisk);

    // For demo, hard‑coded compiler list
    const compilerList = JSON.stringify(Object.keys(compilerTagList));
    const projectDir = path.resolve(projectPath);
    const projectName = JSON.stringify(path.basename(projectDir));

    let html = fs.readFileSync(htmlPath, "utf8");
    const nonce = getNonce();
    const csp = `
      <meta http-equiv="Content-Security-Policy"
            content="default-src 'none';
                     style-src ${panel.webview.cspSource};
                     script-src 'nonce-${nonce}' ${panel.webview.cspSource};">
    `;
    html = html.replace(/<head>/, `<head>${csp}`);

    html = html
      .replace(/{{\s*cssUri\s*}}/g, cssUri.toString())
      .replace(
        /<script src="{{\s*scriptUri\s*}}"><\/script>/,
        `<script nonce="${nonce}" src="${scriptUri}"></script>`
      )
      .replace(
        /<\/head>/,
        `<script nonce="${nonce}">
           window.projectName = ${projectName};
           window.compilerData = ${compilerList};
         </script>\n</head>`
      );

    return html;
  }
}

// this method is called when your extension is deactivated
export async function deactivate() {
  if (requirementsFileWatcher) {
    requirementsFileWatcher.dispose();
  }

  await serverProcessController(serverStateType.stopped);
  // delete the server log if it exists
  await deleteServerLog();
  console.log("The VectorCAST Test Explorer has been de-activated");
  return deactivateLanguageServerClient();
}

/**
 * Find the most relevant requirement gateway for a given environment path
 * @param enviroPath The environment path
 * @returns The most relevant gateway path, or null if none found
 */
function findRelevantRequirementGateway(enviroPath: string): string | null {
  const parentDir = path.dirname(enviroPath);
  const configPath = path.join(parentDir, "CCAST_.CFG");

  const configContent = fs.readFileSync(configPath, "utf-8");

  // Check if the config file contains a requirements gateway
  const gatewayMatch = configContent.match(/VCAST_REPOSITORY:\s*(.+)\s*/);

  if (gatewayMatch == null) {
    return null;
  }

  const gatewayPath = gatewayMatch[1].trim();

  if (!fs.existsSync(gatewayPath)) {
    return null;
  }

  return gatewayPath;
}

async function generateRequirements(enviroPath: string) {
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

  const config = vscode.workspace.getConfiguration("vectorcastTestExplorer");
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

async function parseRequirementsFromFile(filePath: string): Promise<any[]> {
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

async function generateTestsFromRequirements(
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
            reject();
          }
        });
      });
    }
  );
}

async function importRequirementsFromGateway(enviroPath: string) {
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
            reject();
          }
        });
      });
    }
  );
}

async function populateRequirementsGateway(enviroPath: string) {
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

  const process = await spawnWithVcastEnv(PANREQ_EXECUTABLE_PATH, commandArgs);

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
        logCliOperation(`reqs2rgw completed successfully with code ${code}`);

        try {
          // Refresh environment data
          await refreshAllExtensionData();

          vscode.window.showInformationMessage(
            `Successfully populated requirements gateway at ${exportRepository}`
          );
          resolve();
        } catch (err) {
          vscode.window.showErrorMessage(
            `Error updating environment configuration: ${err}`
          );
          reject(err);
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

let existingEnvs: string[] = [];
function updateRequirementsAvailability(enviroPath: string) {
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

/**
 * Generate HTML from requirements data
 */
function generateRequirementsHtml(requirements: any[]): string {
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
    const funcName = req.Function || "Unknown Function";
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

interface LLMProviderSettingsResult {
  provider: string | null;
  env: Record<string, string>;
  missing: string[];
}

function isLLMProviderEnvironmentUsable(): Promise<{
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

function gatherLLMProviderSettings(): LLMProviderSettingsResult {
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

async function performLLMProviderUsableCheck(): Promise<boolean> {
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

async function createProcessEnvironment(): Promise<NodeJS.ProcessEnv> {
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

async function spawnWithVcastEnv(
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
