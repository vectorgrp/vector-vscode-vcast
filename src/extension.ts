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

import { getEnviroPathFromID, getTestNode, testNodeType } from "./testData";

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
} from "./testPane";

import {
  addLaunchConfiguration,
  addSettingsFileFilter,
  getEnvPathForFilePath,
  showSettings,
  updateCoverageAndRebuildEnv,
  forceLowerCaseDriveLetter,
} from "./utilities";

import {
  buildEnvironmentFromScript,
  deleteEnvironment,
  loadTestScriptIntoEnvironment,
  openVcastFromEnviroNode,
  openVcastFromVCEfile,
  rebuildEnvironment,
} from "./vcastAdapter";

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
} from "./vcastInstallation";

import {
  generateNewCodedTestFile,
  addExistingCodedTestFile,
  newEnvironment,
  newTestScript,
  openCodedTest,
} from "./vcastTestInterface";

import {
  addIncludePath,
  getEnviroNameFromFile,
  openTestScript,
} from "./vcastUtilities";

import fs = require("fs");
const path = require("path");
import { spawn } from "child_process";
import { parse as csvParse } from 'csv-parse/sync';
const excelToJson = require('convert-excel-to-json');
let messagePane: vscode.OutputChannel = vscode.window.createOutputChannel(
  "VectorCAST Test Explorer"
);
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

const GENERATE_REQUIREMENTS_ENABLED: boolean = true;

// Setup the paths to the code2reqs and reqs2tests executables
let CODE2REQS_EXECUTABLE_PATH: string;
let REQS2TESTS_EXECUTABLE_PATH: string;
let REQS2EXCEL_EXECUTABLE_PATH: string;
let REQS2RGW_EXECUTABLE_PATH: string;

function setupAutoreqExecutablePaths(context: vscode.ExtensionContext) {
    CODE2REQS_EXECUTABLE_PATH = vscode.Uri.joinPath(context.extensionUri, "resources", "distribution", "code2reqs").fsPath;
    REQS2TESTS_EXECUTABLE_PATH = vscode.Uri.joinPath(context.extensionUri, "resources", "distribution", "reqs2tests").fsPath;
    REQS2EXCEL_EXECUTABLE_PATH = vscode.Uri.joinPath(context.extensionUri, "resources", "distribution", "reqs2excel").fsPath;
    REQS2RGW_EXECUTABLE_PATH = vscode.Uri.joinPath(context.extensionUri, "resources", "distribution", "reqs2rgw").fsPath;
    
    //CODE2REQS_EXECUTABLE_PATH = "code2reqs";
    //REQS2TESTS_EXECUTABLE_PATH = "reqs2tests";
    //REQS2EXCEL_EXECUTABLE_PATH = "reqs2excel";
}

function setHardcodedEnvVars() {
  for (const [key, value] of Object.entries(HARDCODED_ENV_VARS)) {
    process.env[key] = value;
  }
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
      toggleCoverageAction();
      // initialize the verbose setting
      adjustVerboseSetting();
    } else {
      openMessagePane();
    }
  }
}

const HARDCODED_ENV_VARS: Record<string, string> = {
}

async function getEnvironmentListIncludingUnbuilt(workspacePath: string): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    // Use glob to find all .env files in the workspace
    const glob = require('glob');
    glob('**/*.env', { cwd: workspacePath, nodir: true }, (err: Error, envFiles: string[]) => {
      if (err) {
        reject(err);
        return;
      }
      
      // Convert each .env file to its corresponding environment path
      const envPaths = envFiles.map(envFile => {
        const fullPath = path.join(workspacePath, envFile);
        const dirPath = path.dirname(fullPath);
        const baseName = path.basename(envFile, '.env');
        return path.join(dirPath, baseName);
      });
      
      resolve(envPaths);
    });
  });
}

async function activationLogic(context: vscode.ExtensionContext) {
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
  vscode.commands.executeCommand('setContext', 'vectorcastTestExplorer.generateRequirementsEnabled', GENERATE_REQUIREMENTS_ENABLED);

  // Initialize requirements availability for all environments
  if (workspace.workspaceFolders && workspace.workspaceFolders.length > 0) {
    const envPaths = await getEnvironmentListIncludingUnbuilt(workspace.workspaceFolders[0].uri.fsPath);
    for (const envPath of envPaths) {
      updateRequirementsAvailability(envPath);
    }
  }

  // Setup file watchers for requirements files
  setupRequirementsFileWatchers(context);

  setupAutoreqExecutablePaths(context);
  setHardcodedEnvVars();
}

function setupRequirementsFileWatchers(context: vscode.ExtensionContext) {
  if (workspace.workspaceFolders && workspace.workspaceFolders.length > 0) {
    // Create a file watcher that watches for requirements files changes
    // using a glob pattern to match all reqs.csv and reqs.xlsx files in the workspace
    requirementsFileWatcher = workspace.createFileSystemWatcher('**/reqs.{csv,xlsx}');
    
    // When a requirements file is created
    requirementsFileWatcher.onDidCreate(async (uri) => {
      logCliOperation(`Requirements file created: ${uri.fsPath}`);
      const changeDir = path.dirname(uri.fsPath);
      const envDirName = findEnvironmentInPath(changeDir);
      if (envDirName) {
        const envPath = path.join(changeDir, envDirName);
        updateRequirementsAvailability(envPath);
      }
    }, null, context.subscriptions);
    
    // When a requirements file is deleted
    requirementsFileWatcher.onDidDelete(async (uri) => {
      logCliOperation(`Requirements file deleted: ${uri.fsPath}`);
      const parentDir = path.dirname(uri.fsPath);
      const envDirName = findEnvironmentInPath(parentDir);
      if (envDirName) {
        const envPath = path.join(parentDir, envDirName);
        updateRequirementsAvailability(envPath);
      }
    }, null, context.subscriptions);
    
    // Register the watcher to be disposed when the extension deactivates
    context.subscriptions.push(requirementsFileWatcher);
  }
}
function findEnvironmentInPath(dirPath: string): string | null {
  // Check if the directory contains an environment file
  const envFilePattern = new RegExp(/\.env$/);
  const files = fs.readdirSync(dirPath);

  const envFiles = files.filter(file => envFilePattern.test(file));

  // Now see if there is a directory with the same name as the env file
  for (const file of envFiles) {
    const envName = file.replace(envFilePattern, '');
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
    () => {
      toggleCoverageAction();
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
        await generateTestsFromRequirements(enviroPath, testNode.functionName || testNode.unitName || null);
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
    (...nodeList: any) => {
      // adding the ... to nodeList, results in us getting a list of selected tests!
      if (nodeList) {
        // add a confirmation step if the user has selected multiple tests, or
        // has selected a container node, like an environment, unit, or subprogram
        if (nodeList.length > 1 || nodeList[0].children.size > 0) {
          const message =
            "The selected tests will be deleted, and this action cannot be undone.";
          vscode.window
            .showWarningMessage(message, "Delete", "Cancel")
            .then((answer) => {
              if (answer === "Delete") {
                deleteTests(nodeList);
              }
            });
        } else {
          deleteTests(nodeList);
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
    () => {
      loadTestScript();
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
    (enviroNode: any) => {
      vectorMessage("Starting VectorCAST ...");
      openVcastFromEnviroNode(enviroNode.id, updateDataForEnvironment);
    }
  );
  context.subscriptions.push(openVCAST);

  // Command: vectorcastTestExplorer.openVCASTFromVce  ////////////////////////////////////////////////////////
  let openVCASTFromVce = vscode.commands.registerCommand(
    "vectorcastTestExplorer.openVCASTFromVce",
    (arg: any) => {
      vectorMessage("Starting VectorCAST ...");
      openVcastFromVCEfile(arg.fsPath, updateDataForEnvironment);
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
        const csvPath = path.join(parentDir, 'reqs.csv');
        const xlsxPath = path.join(parentDir, 'reqs.xlsx');
        
        let filePath = "";
        let fileType = "";
        if (fs.existsSync(xlsxPath)) {
          filePath = xlsxPath;
          fileType = "Excel";
        } else if (fs.existsSync(csvPath)) {
          filePath = csvPath;
          fileType = "CSV";
        } else {
          vscode.window.showErrorMessage('Requirements file not found. Generate requirements first.');
          return;
        }

        try {
          const panel = vscode.window.createWebviewPanel(
            'requirementsReport',
            'Requirements Report',
            vscode.ViewColumn.One,
            { enableScripts: true }
          );
          
          panel.webview.html = `<html><body><h1>Loading ${fileType} requirements...</h1></body></html>`;
          const requirements = await parseRequirementsFromFile(filePath);
          const htmlContent = generateRequirementsHtml(requirements);
          panel.webview.html = htmlContent;
        } catch (err) {
          vscode.window.showErrorMessage(`Error generating requirements report: ${err}`);
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
        
        const message = "This will remove all generated requirements files. This action cannot be undone.";
        const choice = await vscode.window.showWarningMessage(message, "Remove", "Cancel");
        
        if (choice === "Remove") {
          const parentDir = path.dirname(enviroPath);
          const filesToRemove = [
            path.join(parentDir, 'reqs.csv'),
            path.join(parentDir, 'reqs.xlsx'),
            path.join(parentDir, 'reqs_converted.csv'),
            path.join(parentDir, 'reqs.html'),
            path.join(parentDir, 'reqs2tests.tst')
          ];

          // Remove files
          for (const file of filesToRemove) {
            if (fs.existsSync(file)) {
              try {
                fs.unlinkSync(file);
              } catch (err) {
                vscode.window.showErrorMessage(`Failed to remove ${file}: ${err}`);
              }
            }
          }

          const generatedRepositoryPath = path.join(parentDir, 'generated_requirement_repository');
          const actualRepositoryPath = findRelevantRequirementGateway(enviroPath);

          // Separately prompt for repository directory removal
          if (fs.existsSync(generatedRepositoryPath) && path.relative(generatedRepositoryPath, actualRepositoryPath) === '') {
            const repoMessage = "Would you also like to remove the auto-generated requirements gateway too?";
            const repoChoice = await vscode.window.showWarningMessage(repoMessage, "Yes", "No");
            
            if (repoChoice === "Yes") {
              try {
                fs.rmdirSync(generatedRepositoryPath, { recursive: true });
              } catch (err) {
                vscode.window.showErrorMessage(`Failed to remove repository directory: ${err}`);
              }
            }
          }

          await refreshAllExtensionData();
          updateRequirementsAvailability(enviroPath);
          vscode.window.showInformationMessage("Requirements removed successfully");
        }
      }
    }
  );
  context.subscriptions.push(removeRequirementsCommand);

  vscode.workspace.onDidChangeWorkspaceFolders(
    async (e) => {
      refreshAllExtensionData();
      // Refresh requirements availability for all environments
      if (workspace.workspaceFolders && workspace.workspaceFolders.length > 0) {
        const envPaths = await getEnvironmentListIncludingUnbuilt(workspace.workspaceFolders[0].uri.fsPath);
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
    (editor) => {
      if (editor) {
        updateDisplayedCoverage();
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
        await updateCodedTestCases(editor);
        updateCOVdecorations();
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
        event.affectsConfiguration(
          "vectorcastTestExplorer.build.coverageKind"
        )
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
          refreshAllExtensionData();
        } else {
          // this will remove the status bar icon and shutdown the server
          // it needs to be in both sides of the if because we want it to run
          // before the "refreshAllExtensionData" call in the TRUE case.
          await initializeServerState();
        }
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
          newEnvironment(argList);
        }
      }
    }
  );
  context.subscriptions.push(newEnviroVCASTCommand);
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
  const configPath = path.join(parentDir, 'CCAST_.CFG');
  
  const configContent = fs.readFileSync(configPath, 'utf-8');
  
  // Check if the config file contains a requirements gateway
  const gatewayMatch = configContent.match(/VCAST_REPOSITORY:\s*(.+)\s*/)

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

  const xlsxPath = path.join(parentDir, 'reqs.xlsx');
  const csvPath = path.join(parentDir, 'reqs.csv');
  const repositoryDir = path.join(parentDir, 'generated_requirement_repository');

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
    const message = "Existing requirements files found. Do you want to overwrite them?";
    const choice = await vscode.window.showWarningMessage(
      message,
      "Overwrite",
      "Cancel"
    );
    
    if (choice !== "Overwrite") {
      return;
    }
  }

  const commandArgs = [
    envPath,
    "--export-excel",
    xlsxPath,
    "--export-repository",
    repositoryDir,
    "--json-events",
    "--combine-related-requirements",
    "--extended-reasoning"
  ];
  
  // Log the command being executed
  const commandString = `${CODE2REQS_EXECUTABLE_PATH} ${commandArgs.join(' ')}`;
  logCliOperation(`Executing command: ${commandString}`);

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Generating Requirements for ${envName.split(".")[0]}`,
    cancellable: true
  }, async (progress, cancellationToken) => {
    let lastProgress = 0;
    let simulatedProgress = 0;
    const simulatedProgressInterval = setInterval(() => {
      if (simulatedProgress < 30 && !cancellationToken.isCancellationRequested) {
        simulatedProgress += 1;
        progress.report({ increment: 1 });
      }
    }, 1000);

    return await new Promise<void>((resolve, reject) => {
      const process = spawn(CODE2REQS_EXECUTABLE_PATH, commandArgs);

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
          logCliOperation(`code2reqs completed successfully with code ${code}`);
          await refreshAllExtensionData();
          updateRequirementsAvailability(enviroPath);

          // Run the showRequirements command to display the generated Excel
          vscode.commands.executeCommand('vectorcastTestExplorer.showRequirements', { id: enviroPath });

          vscode.window.showInformationMessage("Successfully generated requirements for the environment!");
          resolve();
        } else {
          const errorMessage = `Error: code2reqs exited with code ${code}`;
          vscode.window.showErrorMessage(errorMessage);
          logCliError(errorMessage, true);
          reject();
        }
      });
    });
  });
}

async function parseRequirementsFromFile(filePath: string): Promise<any[]> {
  try {
    if (filePath.endsWith('.xlsx')) {
      const result = excelToJson({
        sourceFile: filePath,
      }).Requirements;

      const columnNames: string[] = Object.values(result[0]);

      const requirements = [];

      console.log(columnNames, result)

      for (const row of result.slice(1)) {
        const requirement: Record<string, string> = {};
        for (let i = 0; i < columnNames.length; i++) {
          requirement[columnNames[i]] = Object.values(row)[i] as string;
        }
        requirements.push(requirement);
      }

      return requirements;
    } else {
      const fileContent = await fs.promises.readFile(filePath, 'utf8');
      return csvParse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        ltrim: true,
        quote: '"'
      });
    }
  } catch (error) {
    logCliError(`Failed to parse requirements file: ${error}`, true);
    throw error;
  }
}

async function generateTestsFromRequirements(enviroPath: string, unitOrFunctionName: string | null) {
  const parentDir = path.dirname(enviroPath);
  const lowestDirname = path.basename(enviroPath);
  const envName = `${lowestDirname}.env`;
  const envPath = path.join(parentDir, envName);

  const csvPath = path.join(parentDir, 'reqs.csv');
  const xlsxPath = path.join(parentDir, 'reqs.xlsx');
  const tstPath = path.join(parentDir, 'reqs2tests.tst');

  let reqsFile = "";
  let fileType = "";
  if (fs.existsSync(xlsxPath)) {
    reqsFile = xlsxPath;
    fileType = "Excel";
  } else if (fs.existsSync(csvPath)) {
    reqsFile = csvPath;
    fileType = "CSV";
  } else {
    vscode.window.showErrorMessage('No requirements file found. Please generate requirements first.');
    return;
  }

  // Get the decompose setting from configuration
  const config = vscode.workspace.getConfiguration('vectorcastTestExplorer');
  const decomposeRequirements = config.get<boolean>('decomposeRequirements', true);
  const enableRequirementKeys = findRelevantRequirementGateway(enviroPath) !== null;
  console.log(decomposeRequirements, enableRequirementKeys);

  const commandArgs = [
    envPath,
    reqsFile, // use the chosen requirements file
    ...(unitOrFunctionName ? [unitOrFunctionName] : []),
    "--export-tst",
    tstPath,
    "--retries",
    "1",
    "--batched",
    ...(decomposeRequirements ? [] : ["--no-decomposition"]),
    "--allow-partial",
    "--json-events",
    "--no-automatic-build",
    ...(enableRequirementKeys ? [] : ["--no-requirement-keys"])
  ];
  
  // Log the command being executed
  const commandString = `${REQS2TESTS_EXECUTABLE_PATH} ${commandArgs.join(' ')}`;
  logCliOperation(`Executing command: ${commandString}`);

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Generating Tests from Requirements (${fileType}) for ${envName.split(".")[0]}`,
    cancellable: true
  }, async (progress, cancellationToken) => {
    let lastProgress = 0;
    let simulatedProgress = 0;
    const simulatedProgressInterval = setInterval(() => {
      if (simulatedProgress < 40 && !cancellationToken.isCancellationRequested) {
        simulatedProgress += 1;
        progress.report({ increment: 1 });
      }
    }, 2000);

    return new Promise<void>((resolve, reject) => {
      const process = spawn(REQS2TESTS_EXECUTABLE_PATH, commandArgs);
      console.log(`reqs2tests ${commandArgs.join(' ')}`);

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
          logCliOperation(`reqs2tests completed successfully with code ${code}`);
          await loadTestScriptIntoEnvironment(envName.split('.')[0], tstPath);
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
  });
}

async function importRequirementsFromGateway(enviroPath: string) {
  const parentDir = path.dirname(enviroPath);
  const lowestDirname = path.basename(enviroPath);
  const envName = `${lowestDirname}.env`;
  const envPath = path.join(parentDir, envName);

  // Look for potential requirement gateways
  const repositoryPath = findRelevantRequirementGateway(enviroPath);

  if (!repositoryPath) {
    vscode.window.showErrorMessage("Requirements Gateway either is not specified or does not exist. Aborting.");
    return;
  }

  const gatewayPath = path.join(repositoryPath, 'requirements_gateway');

  const csvPath = path.join(parentDir, 'reqs.csv');
  const xlsxPath = path.join(parentDir, 'reqs.xlsx');
  
  // Check if requirements files already exist
  const xlsxExists = fs.existsSync(xlsxPath);
  const csvExists = fs.existsSync(csvPath);
  
  if (xlsxExists || csvExists) {
    let warningMessage = "Warning: ";
    if (xlsxExists) {
      warningMessage += "An existing Excel requirements file (reqs.xlsx) will be overwritten.";
    } 
    if (csvExists) {
      if (xlsxExists) {
        warningMessage += " Additionally, ";
      }
      warningMessage += "An existing CSV requirements file (reqs.csv) will be ignored as the new Excel file takes precedence.";
    }
    
    const choice = await vscode.window.showWarningMessage(
      warningMessage,
      "Continue",
      "Cancel"
    );
    
    if (choice !== "Continue") {
      return;
    }
  }
  
  const choice = await vscode.window.showInformationMessage("Would you like our system to automatically try to add traceability to the requirements?", "Yes", "No");

  const addTraceability = choice === "Yes";

  const commandArgs = [
    '--requirements-gateway-path', gatewayPath,
    '--output-file', xlsxPath,
    ...(addTraceability ? ['--automatic-traceability'] : []),
    envPath
  ];
  
  // Log the command being executed
  const commandString = `${REQS2EXCEL_EXECUTABLE_PATH} ${commandArgs.join(' ')}`;
  logCliOperation(`Executing command: ${commandString}`);

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Importing Requirements from Gateway`,
    cancellable: true
  }, async (progress, cancellationToken) => {
    let simulatedProgress = 0;
    const simulatedProgressInterval = setInterval(() => {
      if (simulatedProgress < 90 && !cancellationToken.isCancellationRequested) {
        simulatedProgress += 5;
        progress.report({ increment: 5 });
      }
    }, 500);

    return new Promise<void>((resolve, reject) => {
      const process = spawn(REQS2EXCEL_EXECUTABLE_PATH, commandArgs);

      cancellationToken.onCancellationRequested(() => {
        process.kill();
        clearInterval(simulatedProgressInterval);
        logCliOperation("Operation cancelled by user");
        resolve();
      });

      process.stdout.on("data", (data) => {
        const output = data.toString();
        logCliOperation(`reqs2excel: ${output}`);
      });

      process.stderr.on("data", (data) => {
        const errorOutput = data.toString();
        logCliError(`reqs2excel: ${errorOutput}`);
      });

      process.on("close", async (code) => {
        clearInterval(simulatedProgressInterval);
        if (cancellationToken.isCancellationRequested) return;

        if (code === 0) {
          logCliOperation(`reqs2excel completed successfully with code ${code}`);
          
          // Update the requirements availability
          await refreshAllExtensionData();
          updateRequirementsAvailability(enviroPath);
          
          // Show the imported requirements
          vscode.commands.executeCommand('vectorcastTestExplorer.showRequirements', { id: enviroPath });
          
          vscode.window.showInformationMessage("Successfully imported requirements from gateway");
          resolve();
        } else {
          const errorMessage = `Error: reqs2excel exited with code ${code}`;
          vscode.window.showErrorMessage(errorMessage);
          logCliError(errorMessage, true);
          reject();
        }
      });
    });
  });
}

async function populateRequirementsGateway(enviroPath: string) {
  const parentDir = path.dirname(enviroPath);
  const envName = path.basename(enviroPath);
  const envPath = path.join(parentDir, `${envName}.env`);
  const csvPath = path.join(parentDir, 'reqs.csv');
  const xlsxPath = path.join(parentDir, 'reqs.xlsx');
  
  // Check which requirements file exists
  let requirementsFile = "";
  if (fs.existsSync(xlsxPath)) {
    requirementsFile = xlsxPath;
  } else if (fs.existsSync(csvPath)) {
    requirementsFile = csvPath;
  } else {
    vscode.window.showErrorMessage('No requirements file found. Generate requirements first.');
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

  const exportRepository = path.join(parentDir, 'generated_requirement_repository');
  
  // Run reqs2rgw with appropriate parameters
  const commandArgs = [
    envPath,
    requirementsFile,
    '--gateway-path',
    exportRepository
  ];
  
  // Log the command being executed
  const commandString = `${REQS2RGW_EXECUTABLE_PATH} ${commandArgs.join(' ')}`;
  logCliOperation(`Executing command: ${commandString}`);
    
  return new Promise<void>((resolve, reject) => {
    const process = spawn(REQS2RGW_EXECUTABLE_PATH, commandArgs);
    
    process.stdout.on("data", (data) => {
      const output = data.toString().trim();
      logCliOperation(`reqs2rgw: ${output}`);
    });
    
    process.stderr.on("data", (data) => {
      const errorOutput = data.toString().trim();
      logCliError(`reqs2rgw: ${errorOutput}`);
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
          vscode.window.showErrorMessage(`Error updating environment configuration: ${err}`);
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
  let workspaceRoot: string = "";
  if (vscode.workspace) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(
      vscode.Uri.file(enviroPath)
    );
    if (workspaceFolder) workspaceRoot = workspaceFolder.uri.fsPath;
  }

  let enviroDisplayName: string = "";
  if (workspaceRoot.length > 0) {
    enviroDisplayName = path
      .relative(workspaceRoot, enviroPath)
      .replaceAll("\\", "/");
  } else {
    enviroDisplayName = enviroPath.replaceAll("\\", "/");
  }
  const enviroNodeID: string = "vcast:" + enviroDisplayName;

    // the vcast: prefix to allow package.json nodes to control
    // when the VectorCAST context menu should be shown
  
  // Check if this environment has requirements
  const parentDir = path.dirname(enviroPath);
  const csvPath = path.join(parentDir, 'reqs.csv');
  const xlsxPath = path.join(parentDir, 'reqs.xlsx');

  const hasRequirementsFiles = fs.existsSync(csvPath) || fs.existsSync(xlsxPath);
  
  if (hasRequirementsFiles) {
    // Add this environment to the list if not already present
    if (!existingEnvs.includes(enviroNodeID)) {
      const updatedEnvs = [...existingEnvs, enviroNodeID];
      vscode.commands.executeCommand('setContext', 'vectorcastTestExplorer.vcastRequirementsAvailable', updatedEnvs);
      existingEnvs = updatedEnvs;
    }
  } else {
    // Remove this environment from the list if present
    const updatedEnvs = existingEnvs.filter(env => env !== enviroNodeID);
    vscode.commands.executeCommand('setContext', 'vectorcastTestExplorer.vcastRequirementsAvailable', updatedEnvs);
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
            .req-key { font-weight: bold; color: #2980b9; }
            .req-description { margin-top: 10px; color: #333333; }
        </style>
    </head>
    <body>
        <h1>Requirements</h1>
  `;
  
  // Group requirements by function
  const requirementsByFunction: Record<string, any[]> = {};
  for (const req of requirements) {
    const funcName = req.Function || 'Unknown Function';
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
            <div class="req-key">${req.Key || 'No Key'}</div>
            <div class="req-description">${req.Description || 'No Description'}</div>
        </div>
      `;
    }
  }
  
  htmlContent += '</body></html>';
  return htmlContent;
}

