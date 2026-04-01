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

import {
  viewMCDCReport,
  viewResultsReport,
  viewResultsReportVC,
} from "./reporting";

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
} from "./testPane";

import {
  addLaunchConfiguration,
  addSettingsFileFilter,
  getEnvPathForFilePath,
  showSettings,
  updateCoverageAndRebuildEnv,
  forceLowerCaseDriveLetter,
  decodeVar,
  getFullEnvReport,
} from "./utilities";

import {
  buildEnvironmentFromScript,
  deleteEnvironment,
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
} from "./vcastInstallation";

import {
  findRelevantRequirementGateway,
  generateRequirementsHtml,
  parseRequirementsFromFile,
  performLLMProviderUsableCheck,
  requirementsFileWatcher,
  updateRequirementsAvailability,
} from "./requirements/requirementsUtils";

import {
  GENERATE_REQUIREMENTS_ENABLED,
  generateRequirements,
  generateTestsFromRequirements,
  importRequirementsFromGateway,
  initializeReqs2X,
  populateRequirementsGateway,
} from "./requirements/requirementsOperations";

import {
  generateNewCodedTestFile,
  addExistingCodedTestFile,
  newEnvironment,
  newTestScript,
  openCodedTest,
  ProjectEnvParameters,
  getGlobalCoverageData,
} from "./vcastTestInterface";

import {
  addIncludePath,
  envIsEmbeddedInProject,
  getEnviroNameFromFile,
  getEnvironmentData,
  getLevelFromNodeId,
  loadATGLineTest,
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

let messagePane: vscode.OutputChannel = vscode.window.createOutputChannel(
  "VectorCAST Test Explorer"
);

let selectedEnvStatusBarObject: vscode.StatusBarItem | undefined;

export function getMessagePane(): vscode.OutputChannel {
  return messagePane;
}

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

  selectedEnvStatusBarObject = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    10
  );
  selectedEnvStatusBarObject.command = "myext.selectEnvStatus";
  selectedEnvStatusBarObject.tooltip = "Select environment for current file";
  context.subscriptions.push(selectedEnvStatusBarObject);
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

  // Command: vectorcastTestExplorer.getEnvFullReport  ////////////////////////////////////////////////////////
  let getEnvFullReportCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.getEnvFullReport",
    async (enviroNode: any) => {
      const enviroPath = enviroNode.id.split("vcast:")[1];
      const enviroData: environmentNodeDataType = getEnviroNodeData(enviroPath);

      // Execute process
      const reportPathHTML = await getFullEnvReport(
        enviroData.buildDirectory,
        enviroPath
      );

      // View report
      viewResultsReportVC(reportPathHTML);
    }
  );
  context.subscriptions.push(getEnvFullReportCommand);

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

  // Command: vectorcastTestExplorer.openSourceFileFromTestpaneCommand
  let openSourceFileFromTestpaneCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.openSourceFileFromTestpaneCommand",
    async (args: any) => {
      if (args) {
        const testNode: testNodeType = getTestNode(args.id);
        if (testNode) {
          const enviroPath = testNode.enviroPath;
          const unitName = testNode.unitName;
          const functionName = testNode.functionName;
          const envData = await getEnvironmentData(enviroPath);

          if (envData.unitData) {
            for (const unitInfo of envData.unitData) {
              // Extract unit name from path to match against unitName
              const pathBasename = path.basename(
                unitInfo.path,
                path.extname(unitInfo.path)
              );

              if (pathBasename === unitName) {
                const sourcePath = unitInfo.path;
                const uri = vscode.Uri.file(sourcePath);

                // Determine the line number to open at (0 = top default)
                let lineNumber = 0;

                // If functionName is defined, try to find it in the function list
                if (functionName && unitInfo.functionList) {
                  for (const func of unitInfo.functionList) {
                    if (
                      func.name === functionName &&
                      func.startLine !== undefined
                    ) {
                      lineNumber = func.startLine;
                      break;
                    }
                  }
                }

                // Open the document at the specified line
                const document = await vscode.workspace.openTextDocument(uri);
                const position = new vscode.Position(
                  Math.max(0, lineNumber - 1),
                  0
                );
                const selection = new vscode.Range(position, position);

                await vscode.window.showTextDocument(document, {
                  preview: false, // open as a real tab
                  preserveFocus: false,
                  selection: selection,
                });

                break;
              }
            }
          } else {
            vscode.window.showErrorMessage(
              `Could not find environment data for: ${enviroPath}`
            );
          }
        } else {
          vscode.window.showErrorMessage(
            `Unable to open Source File for Node: ${args.id}`
          );
        }
      }
    }
  );
  context.subscriptions.push(openSourceFileFromTestpaneCommand);

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

  // Command: vectorcastTestExplorer.getATGTestForLine /////////////////////////////////////////////
  let getATGTestForLineCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.getATGTestForLine",
    async () => {
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor) {
        vscode.window.showWarningMessage("No active editor found.");
        return;
      }

      const filePath = activeEditor.document.uri.fsPath;
      const lineNumber = activeEditor.selection.active.line + 1;
      const fileText = activeEditor.document.getText();

      // Find environments for this file
      const coverageData = getGlobalCoverageData();
      const fileData = coverageData.get(filePath);
      let enviroPaths: string[] = [];
      if (fileData && fileData.enviroList) {
        enviroPaths = Array.from(fileData.enviroList.keys());
      }

      if (enviroPaths.length === 0) {
        vscode.window.showWarningMessage(
          `No environments found for ${path.basename(filePath)}`
        );
        return;
      }

      // Parse function at line
      const funcInfo = findFunctionAtLine(fileText, lineNumber);

      // Extract variables
      const variables = extractVariablesFromFile(fileText, funcInfo);

      // Create webview panel
      const panel = vscode.window.createWebviewPanel(
        "atgLineTest",
        `ATG Line Test: ${path.basename(filePath)}:${lineNumber}`,
        vscode.ViewColumn.One,
        { enableScripts: true }
      );

      panel.webview.html = await getATGWebviewContent(
        context,
        panel,
        filePath,
        lineNumber,
        enviroPaths,
        funcInfo,
        variables
      );

      panel.webview.onDidReceiveMessage(
        async (message: any) => {
          if (message.command === "submit") {
            const sourceFile = message.sourceFile;
            const line = parseInt(message.line, 10);
            const enviroPath = message.enviroPath;
            const variableValues = message.variableValues;

            if (!sourceFile || !line || !enviroPath) {
              vscode.window.showWarningMessage(
                "Missing required fields for ATG line test."
              );
              return;
            }

            panel.dispose();
            await loadATGLineTest(sourceFile, line, enviroPath, variableValues);
          } else if (message.command === "cancel") {
            panel.dispose();
          }
        },
        undefined,
        context.subscriptions
      );
    }
  );
  context.subscriptions.push(getATGTestForLineCommand);
}

function findFunctionAtLine(fileText: string, lineNumber: number) {
  const lines = fileText.split(/\r?\n/);

  // Try to find a C/C++ function definition that encloses the given line
  // Pattern matches: returnType [qualifier::]*functionName(params) {
  const funcDefRegex =
    /^[\w\s\*&:<>,]+?\s+((?:\w+::)*\w+)\s*\(([^)]*)\)\s*(?:const\s*)?(?:override\s*)?(?:noexcept\s*)?\{?\s*$/;

  let bestMatch: any = null;

  for (let i = 0; i < lines.length; i++) {
    const match = funcDefRegex.exec(lines[i]);
    if (match && i < lineNumber) {
      // Find matching closing brace
      const startLine = i + 1; // 1-based
      const endLine = findMatchingBrace(lines, i);
      if (endLine >= lineNumber) {
        // This function encloses our target line
        const funcName = match[1];
        const params = parseParamNames(match[2]);
        const code = lines.slice(i, endLine).join("\n");
        bestMatch = {
          name: funcName,
          params: params,
          startLine: startLine,
          endLine: endLine,
          code: code,
          selectedLine: lineNumber - i, // relative to function start
        };
      }
    }
  }

  if (!bestMatch) {
    // Return file-level fallback
    const startLine = Math.max(1, lineNumber - 10);
    const endLine = Math.min(lines.length, lineNumber + 10);
    return {
      name: null,
      params: [],
      startLine: startLine,
      endLine: endLine,
      code: lines.slice(startLine - 1, endLine).join("\n"),
      selectedLine: lineNumber - startLine + 1,
    };
  }

  return bestMatch;
}

function findMatchingBrace(lines: string[], startIdx: number): number {
  let depth = 0;
  let inString = false;
  let stringChar = "";
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    inLineComment = false;

    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      const next = j + 1 < line.length ? line[j + 1] : "";

      if (inBlockComment) {
        if (ch === "*" && next === "/") {
          inBlockComment = false;
          j++;
        }
        continue;
      }
      if (inLineComment) continue;
      if (inString) {
        if (ch === "\\" && j + 1 < line.length) {
          j++;
          continue;
        }
        if (ch === stringChar) inString = false;
        continue;
      }

      if (ch === "/" && next === "/") {
        inLineComment = true;
        continue;
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        j++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = true;
        stringChar = ch;
        continue;
      }

      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) return i + 1; // 1-based line number
      }
    }
  }

  return lines.length;
}

function parseParamNames(paramsRaw: string): string[] {
  if (!paramsRaw || paramsRaw.trim() === "" || paramsRaw.trim() === "void")
    return [];

  const params: string[] = [];
  let depth = 0;
  let current = "";

  for (const ch of paramsRaw) {
    if (ch === "<" || ch === "(") depth++;
    if (ch === ">" || ch === ")") depth--;
    if (ch === "," && depth === 0) {
      params.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) params.push(current.trim());

  return params
    .map((p) => {
      // Extract just the parameter name (last word after type)
      const tokens = p
        .replace(/[*&]/g, " ")
        .trim()
        .split(/\s+/);
      return tokens[tokens.length - 1];
    })
    .filter((n) => n && !isKeyword(n));
}

function extractVariablesFromFile(
  fileText: string,
  funcInfo: any
): string[] {
  const vars = new Set<string>();

  // Add function parameters
  if (funcInfo.params) {
    for (const p of funcInfo.params) {
      vars.add(p);
    }
  }

  // Scan function code for local variables
  const codeLines = (funcInfo.code || "").split(/\r?\n/);
  const typePattern =
    /\b(?:int|float|double|char|short|long|unsigned|signed|bool|size_t|uint\d+_t|int\d+_t|auto|const|static|volatile|struct|class|enum)\b/;
  const assignPattern = /^\s*(\w+)\s*=[^=]/;

  for (const line of codeLines) {
    const trimmed = line.trim();

    // Skip comments and preprocessor
    if (trimmed.startsWith("//") || trimmed.startsWith("#")) continue;

    // Typed declarations
    if (typePattern.test(trimmed)) {
      const tokens = trimmed.split(/[;,={}()\[\]]+/);
      for (const token of tokens) {
        const words = token.trim().split(/\s+/);
        const lastWord = words[words.length - 1]
          ?.replace(/[*&]/g, "")
          .trim();
        if (lastWord && /^\w+$/.test(lastWord) && !isKeyword(lastWord)) {
          vars.add(lastWord);
        }
      }
    }

    // Assignment targets
    const assignMatch = assignPattern.exec(trimmed);
    if (assignMatch && !isKeyword(assignMatch[1])) {
      vars.add(assignMatch[1]);
    }
  }

  return [...vars].sort();
}

function isKeyword(w: string): boolean {
  const keywords = new Set([
    "auto",
    "break",
    "case",
    "char",
    "const",
    "continue",
    "default",
    "do",
    "double",
    "else",
    "enum",
    "extern",
    "float",
    "for",
    "goto",
    "if",
    "int",
    "long",
    "register",
    "return",
    "short",
    "signed",
    "sizeof",
    "static",
    "struct",
    "switch",
    "typedef",
    "union",
    "unsigned",
    "void",
    "volatile",
    "while",
    "bool",
    "class",
    "namespace",
    "template",
    "this",
    "true",
    "false",
    "nullptr",
    "new",
    "delete",
    "try",
    "catch",
    "throw",
    "virtual",
    "override",
    "final",
    "public",
    "private",
    "protected",
    "inline",
    "constexpr",
    "noexcept",
    "using",
    "typename",
  ]);
  return keywords.has(w);
}

async function getATGWebviewContent(
  context: vscode.ExtensionContext,
  panel: vscode.WebviewPanel,
  filePath: string,
  lineNumber: number,
  enviroPaths: string[],
  funcInfo: any,
  variables: string[]
): Promise<string> {
  const base = resolveWebviewBase(context);
  const cssOnDisk = vscode.Uri.file(
    path.join(base, "css", "getATGTestForLine.css")
  );
  const scriptOnDisk = vscode.Uri.file(
    path.join(base, "webviewScripts", "getATGTestForLine.js")
  );
  const htmlPath = path.join(base, "html", "getATGTestForLine.html");

  const cssUri = panel.webview.asWebviewUri(cssOnDisk);
  const scriptUri = panel.webview.asWebviewUri(scriptOnDisk);

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
      /{{\s*scriptUri\s*}}/,
      `<script nonce="${nonce}" src="${scriptUri}"></script>`
    )
    .replace(
      /<\/head>/,
      `<script nonce="${nonce}">
         window.defaultSourceFile = ${JSON.stringify(filePath)};
         window.defaultLineNumber = ${JSON.stringify(String(lineNumber))};
         window.enviroPaths = ${JSON.stringify(enviroPaths)};
         window.fileFunction = ${JSON.stringify(funcInfo)};
         window.fileVariables = ${JSON.stringify(variables)};
       </script>\n</head>`
    );

  return html;
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
