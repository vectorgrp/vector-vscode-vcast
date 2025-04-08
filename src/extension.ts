import * as vscode from "vscode";
import { Uri } from "vscode";

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

import { viewResultsReport } from "./reporting";

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
} from "./testPane";

import {
  addLaunchConfiguration,
  addSettingsFileFilter,
  showSettings,
} from "./utilities";

import {
  buildEnvironmentFromScript,
  buildProjectEnvironment,
  deleteEnvironment,
  openVcastFromEnviroNode,
  openVcastFromVCEfile,
  rebuildEnvironment,
  removeTestsuiteFromProject,
  importEnvToTestsuite,
  updateAllOpenedProjects,
  openProjectInVcast,
  createTestsuiteInCompiler,
  addCompilerToProject,
  deleteLevel,
  updateProjectData,
  buildIncremental,
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
const path = require("path");
let messagePane: vscode.OutputChannel = vscode.window.createOutputChannel(
  "VectorCAST Test Explorer"
);

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

  // Command: vectorcastTestExplorer.buildProjectEnviro  ////////////////////////////////////////////////////////
  let buildIncrementalCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.buildIncremental",
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

      await buildIncremental(projectPath, displayName, enviroPathList);
    }
  );

  context.subscriptions.push(buildIncrementalCommand);

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
      if (!args || !args.id) {
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

  let addTestsuiteToCompiler = vscode.commands.registerCommand(
    "vectorcastTestExplorer.addTestsuiteToCompiler",
    async (node: any) => {
      const panel = vscode.window.createWebviewPanel(
        "addTestsuiteToCompiler",
        "Add Testsuite to Compiler",
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true }
      );

      panel.webview.html = getTestsuiteWebviewContent();

      panel.webview.onDidReceiveMessage((message) => {
        if (message.command === "submit") {
          const testsuiteName = message.testsuiteName;
          if (!testsuiteName) {
            vscode.window.showErrorMessage("Testsuite name is required.");
            return;
          }
          const projectPath = path.dirname(node.id);
          const compilerName = path.basename(node.id);
          createTestsuiteInCompiler(projectPath, compilerName, testsuiteName);
          panel.dispose();
        } else if (message.command === "cancel") {
          panel.dispose();
        }
      });
    }
  );
  context.subscriptions.push(addTestsuiteToCompiler);

  // Webview HTML content.
  function getTestsuiteWebviewContent() {
    return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
      <title>Add Testsuite to Compiler</title>
      <style>
          body {
              font-family: sans-serif;
              background-color: #1e1e1e;
              color: #d4d4d4;
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
          }
          .modal {
              width: 400px;
              background-color: #252526;
              padding: 20px;
              border-radius: 8px;
              box-shadow: 0 0 10px rgba(0, 0, 0, 0.3);
              text-align: center;
          }
          label {
              display: block;
              text-align: center;
              margin-bottom: 5px;
          }
          input[type="text"] {
              display: block;
              width: 80%;
              margin: 10px auto;
              padding: 10px;
              border: 1px solid #555;
              border-radius: 4px;
              background-color: #3c3c3c;
              color: #d4d4d4;
          }
          button {
              padding: 10px 20px;
              margin: 10px;
              border: none;
              border-radius: 4px;
              cursor: pointer;
          }
          .primary-button {
              background-color: #007acc;
              color: white;
          }
          .cancel-button {
              background-color: #cc4444;
              color: white;
          }
      </style>
  </head>
  <body>
      <div class="modal">
          <h2>Add Testsuite to Compiler</h2>
          <label for="testsuiteInput">Testsuite Name:</label>
          <input type="text" id="testsuiteInput" placeholder="Enter Testsuite Name" />
          <div>
              <button class="primary-button" onclick="submitForm()">OK</button>
              <button class="cancel-button" onclick="cancel()">Cancel</button>
          </div>
      </div>
      <script>
          const vscode = acquireVsCodeApi();
          function submitForm() {
              const testsuiteName = document.getElementById('testsuiteInput').value;
              vscode.postMessage({ command: 'submit', testsuiteName: testsuiteName });
          }
          function cancel() {
              vscode.postMessage({ command: 'cancel' });
          }
      </script>
  </body>
  </html>
  `;
  }

  // Command: vectorcastTestExplorer.buildProjectEnviro  ////////////////////////////////////////////////////////
  let buildProjectEnviro = vscode.commands.registerCommand(
    "vectorcastTestExplorer.buildProjectEnviro",
    (enviroNode: any) => {
      // displayName is the what will be passed as the --level arg value
      const enviroPath = enviroNode.id.split("vcast:")[1];
      const enviroData: environmentNodeDataType = getEnviroNodeData(enviroPath);
      const displayName = enviroData.displayName;
      console.log("Building project environment: " + displayName);

      buildProjectEnvironment(enviroData.projectPath, displayName, enviroPath);
    }
  );
  context.subscriptions.push(buildProjectEnviro);

  // Command: vectorcastTestExplorer.deleteTestsuite  ////////////////////////////////////////////////////////
  let deleteTestsuiteCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.deleteTestsuite",
    (node: any) => {
      const nodeParts = node.id.split("/");
      // compiler/testsuite
      const testsuiteLevel = path.join(
        nodeParts[nodeParts.length - 2],
        nodeParts[nodeParts.length - 1]
      );
      // We need the extra "/" because we cut it out otherwise, which would lead to an ENOENT error when trying to spawn the process
      const projectPath =
        "/" + path.join(...nodeParts.slice(0, nodeParts.length - 2));
      deleteLevel(projectPath, testsuiteLevel);
    }
  );
  context.subscriptions.push(deleteTestsuiteCommand);

  // Command: vectorcastTestExplorer.deleteCompiler ////////////////////////////////////////////////////////
  let deleteCompilerCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.deleteCompiler",
    (node: any) => {
      const compiler = node.id;
      const projectPath = path.dirname(compiler);
      const compilerLevel = path.basename(compiler);
      deleteLevel(projectPath, compilerLevel);
    }
  );
  context.subscriptions.push(deleteCompilerCommand);

  // Command: vectorcastTestExplorer.deleteEnviro  ////////////////////////////////////////////////////////
  let removeTestsuite = vscode.commands.registerCommand(
    "vectorcastTestExplorer.removeTestsuite",
    (enviroNode: any) => {
      // this returns the full path to the environment directory
      let enviroPath = getEnviroPathFromID(enviroNode.id);
      // In case the env is not built, it will be not present in the cache
      if (!enviroPath) {
        // So we check if it is present in the unbuilt list
        // If so, we take the id and split it after "vcast:" to get the path
        // In case that is not possible, we throw an error message
        if (vcastUnbuiltEnviroList.includes(enviroNode.id)) {
          enviroPath = enviroNode.id.split(":")[1];
        } else {
          vscode.window.showErrorMessage(
            `Unable to determine environment path from node: ${enviroNode.id}`
          );
          return;
        }
      }
      removeTestsuiteFromProject(enviroPath, enviroNode.id);
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

  vscode.workspace.onDidChangeWorkspaceFolders(
    async (e) => {
      await refreshAllExtensionData();
      setGlobalProjectIsOpenedChecker();
      setGlobalCompilerAndTestsuites();
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

  // Command: vectorcastTestExplorer.importEnviroToProject ////////////////////////////////////////////////////////
  let importEnviroToProjectCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.importEnviroToProject",
    async (args: vscode.Uri, argList: vscode.Uri[]) => {
      const panel = vscode.window.createWebviewPanel(
        "importEnviroToProject",
        "Import Environment to Project",
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true }
      );

      // Pass the initial list of files (env files) to pre-fill the form.
      panel.webview.html = getImportEnvProjectWebviewContent(argList);

      panel.webview.onDidReceiveMessage(
        async (message) => {
          if (message.command === "importEnvFile") {
            const files = await vscode.window.showOpenDialog({
              canSelectMany: false,
              openLabel: "Select Env File",
              filters: {
                "Env Files": ["env"],
              },
            });
            if (files && files.length > 0) {
              const envFile = files[0].fsPath;
              panel.webview.postMessage({
                command: "envFileSelected",
                envFile,
              });
            }
          } else if (message.command === "submit") {
            const { projectPath, envFiles, testsuiteArgs } = message;
            if (!projectPath || !envFiles || !testsuiteArgs) {
              vscode.window.showErrorMessage(
                "Project Path, Env Files, and Testsuite are required."
              );
              return;
            }

            // Iterate through each Env File and log it.
            envFiles.forEach(async (file: string) => {
              vectorMessage(`Env File: ${file}`);
              await importEnvToTestsuite(projectPath, testsuiteArgs, file);
            });

            // Call your helper to process the new environment.
            // This function should handle adding the environment to the project.

            panel.dispose();
          } else if (message.command === "cancel") {
            panel.dispose();
          }
        },
        undefined,
        context.subscriptions
      );
    }
  );
  context.subscriptions.push(importEnviroToProjectCommand);

  // Command: vectorcastTestExplorer.addEnviroToProject  ////////////////////////////////////////////////////////

  let addEnviroToProject = vscode.commands.registerCommand(
    "vectorcastTestExplorer.addEnviroToProject",
    async (projectNode) => {
      const panel = vscode.window.createWebviewPanel(
        "addEnviroToProject",
        "Add Environment To Project",
        vscode.ViewColumn.Active, // Keeps it central
        { enableScripts: true, retainContextWhenHidden: true } // Makes it act more like a modal
      );

      // Pass an empty array since no env file is provided
      panel.webview.html = getImportEnvProjectWebviewContent([]);

      // Listen for messages from the Webview
      panel.webview.onDidReceiveMessage(async (message) => {
        if (message.command === "submit") {
          const { projectPath, envFiles, testsuiteArgs } = message;
          if (!projectPath || !envFiles || !testsuiteArgs) {
            vscode.window.showErrorMessage(
              "Project Path, Env Files, and Testsuite are required."
            );
            return;
          }

          // Iterate through each Env File and log it.
          envFiles.forEach(async (file: string) => {
            vectorMessage(`Env File: ${file}`);
            await importEnvToTestsuite(projectPath, testsuiteArgs, file);
          });
          panel.dispose(); // Close the webview after submission
        } else if (message.command === "importEnvFile") {
          // Open file picker for .env files
          const uri = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { "Environment Files": ["env"] },
            openLabel: "Select Environment File",
          });

          if (uri && uri.length > 0) {
            // Send selected file path back to webview
            panel.webview.postMessage({
              command: "envFileSelected",
              envFile: uri[0].fsPath,
            });
          }
        } else if (message.command === "cancel") {
          panel.dispose(); // Close the webview if user cancels
        }
      }, undefined);
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
  function getImportEnvProjectWebviewContent(
    argList: vscode.Uri[] | { fsPath: any }[]
  ): string {
    // Convert your globalProjectWebviewComboboxItems to an array for embedding.
    const projectData = JSON.stringify(
      Array.from(globalProjectWebviewComboboxItems.entries())
    );

    // Only use the first file if multiple env files are provided
    const initialEnvFilesArray = argList.map((uri) => uri.fsPath);
    const initialEnvFile =
      initialEnvFilesArray.length > 0 ? initialEnvFilesArray[0] : "";
    const initialEnvFileJson = JSON.stringify(initialEnvFile);

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Create Environment</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: #1e1e1e;
      color: #d4d4d4;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
    }
    .modal {
      width: 700px;
      background-color: #252526;
      padding: 25px;
      border-radius: 8px;
      box-shadow: 0 0 10px rgba(0,0,0,0.3);
      text-align: center;
    }
    h2 {
      color: #ffffff;
      margin-bottom: 15px;
      font-size: 22px;
    }
    label {
      font-size: 16px;
      display: block;
      text-align: left;
      margin-top: 12px;
      margin-bottom: 6px;
    }
    /* Inputs & selects */
    input, select {
      padding: 10px;
      font-size: 14px;
      background-color: #3c3c3c;
      color: #d4d4d4;
      border: 1px solid #555;
      border-radius: 4px;
      width: 100%;
    }
    select option {
      padding: 10px;
      border: 1px solid #555;
      margin: 2px;
    }

    /* Row with input + button: grid with 2 columns: 1fr for input, 60px (or 70px) for button. */
    .single-input-container {
      display: grid;
      grid-template-columns: 1fr 70px; /* enough width for the text "Select" */
      gap: 10px;
      align-items: center;
      width: 100%;
      margin-bottom: 10px;
    }

    /* Row with double input + remove button. 50px for the remove button. */
    .double-input-container {
      display: grid;
      grid-template-columns: 1fr 1fr 50px;
      gap: 10px;
      align-items: center;
      margin-bottom: 10px;
      width: 100%;
    }
    /* The row that has the plus (➕) button. */
    .double-add-row {
      display: grid;
      grid-template-columns: 1fr 1fr 50px;
      gap: 10px;
      width: 100%;
      margin-bottom: 20px;
    }
    .double-add-row button { 
      grid-column: 1; 
      justify-self: start; 
    }

    /* The label row for compiler/testsuite, also with 3 columns. */
    .label-row {
      display: grid;
      grid-template-columns: 1fr 1fr 50px;
      gap: 10px;
      margin-top: 20px;
      margin-bottom: 10px;
      width: 100%;
      font-weight: bold;
      text-align: center;
    }
    .label-row > div {
      display: flex;
      justify-content: center;
      align-items: center;
    }

    /* Buttons */
    button {
      border: none;
      border-radius: 4px;
      font-size: 14px;
      cursor: pointer;
      transition: background-color 0.3s;
    }
    .remove-button {
      background-color: #cc4444;
      color: white;
      border: none;
      border-radius: 4px;
      padding: 10px;
      cursor: pointer;
      transition: background-color 0.3s;
    }
    .remove-button:hover { 
      background-color: #992222; 
    }
    .select-button {
      background-color: #007acc;
      color: white;
      /* Center text horizontally & vertically */
      display: flex;
      align-items: center;
      justify-content: center;
      height: 36px; /* match input height */
      width: 100%;  /* fill the 70px column */
    }
    .add-button {
      background-color: #007acc;
      color: white;
      border: none;
      border-radius: 4px;
      padding: 6px 10px;
      font-size: 14px;
      cursor: pointer;
      transition: background-color 0.3s;
    }
    .add-button:hover { 
      background-color: #005f99; 
    }
    /* Labels for the double row */
    .label-row {
      display: grid;
      grid-template-columns: 1fr 1fr 50px;
      gap: 10px;
      margin-bottom: 10px;
      width: 100%;
      font-weight: bold;
      text-align: center;
    }
    .label-row > div {
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .button-container {
      display: flex;
      justify-content: space-between;
      margin-top: 20px;
    }
    .primary-button {
      background-color: #007acc;
      color: white;
      border: none;
      border-radius: 4px;
      padding: 10px 15px;
      font-size: 16px;
      cursor: pointer;
      transition: background-color 0.3s;
    }
    .primary-button:hover { 
      background-color: #005f99; 
    }
  </style>
</head>
<body>
  <div class="modal">
    <h2>Create Environment in Project</h2>

    <!-- Project Path -->
    <label>Project Path:</label>
    <div class="single-input-container">
      <select id="projectPath"></select>
    </div>

    <!-- Env File with a Select button. 
         The button is 70px wide (from the grid) and uses display:flex 
         so the text "Select" is truly centered. -->
    <label>Env File:</label>
    <div class="single-input-container">
      <input type="text" id="envFileInput" placeholder="Select Env File" readonly />
      <button class="select-button" onclick="importEnvFile()">Select</button>
    </div>

    <!-- Compiler/Testsuite Labels -->
    <div class="label-row">
      <div>Select Compiler</div>
      <div>Select Testsuite</div>
      <div></div>
    </div>

    <!-- Compiler/Testsuite Rows -->
    <div id="compilerContainer"></div>
    <div class="double-add-row">
      <button class="add-button" onclick="addCompilerRow()">➕</button>
    </div>

    <!-- OK/Cancel Buttons -->
    <div class="button-container">
      <button class="primary-button" onclick="cancel()">Cancel</button>
      <button class="primary-button" onclick="submitForm()">OK</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const projectData = ${projectData};
    const projectMap = new Map(projectData);

    // Fill Project Path combobox
    const projectPathSelect = document.getElementById('projectPath');
    projectMap.forEach((value, key) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = key;
      projectPathSelect.appendChild(opt);
    });

    // Import .env file
    function importEnvFile() {
      vscode.postMessage({ command: 'importEnvFile' });
    }

    // Listen for envFileSelected
    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.command === 'envFileSelected') {
        document.getElementById('envFileInput').value = msg.envFile;
      }
    });

    function generateOptions(arr) {
      return arr.map(item => '<option value="' + item + '">' + item + '</option>').join('');
    }

    function addCompilerRow() {
      const selectedProject = projectPathSelect.value;
      const projectInfo = projectMap.get(selectedProject);
      if (!projectInfo) {
        vscode.postMessage({ command: 'error', message: 'No project data available.' });
        return;
      }
      const container = document.getElementById('compilerContainer');
      const row = document.createElement('div');
      row.classList.add('double-input-container');

      const compilerSelect = document.createElement('select');
      compilerSelect.innerHTML = generateOptions(projectInfo.compilers);

      const testsuiteSelect = document.createElement('select');
      testsuiteSelect.innerHTML = generateOptions(projectInfo.testsuites);

      // Delete button
      const removeBtn = document.createElement('button');
      removeBtn.textContent = '✖';
      removeBtn.classList.add('remove-button');
      removeBtn.onclick = () => row.remove();

      row.appendChild(compilerSelect);
      row.appendChild(testsuiteSelect);
      row.appendChild(removeBtn);
      container.appendChild(row);
    }

    // If project changes, update existing rows
    projectPathSelect.addEventListener('change', () => {
      const selectedProject = projectPathSelect.value;
      const projectInfo = projectMap.get(selectedProject);
      if (!projectInfo) return;

      document.querySelectorAll('#compilerContainer .double-input-container').forEach(row => {
        const [compilerSelect, testsuiteSelect] = row.children;
        const currentCompiler = compilerSelect.value;
        const currentTestsuite = testsuiteSelect.value;
        compilerSelect.innerHTML = generateOptions(projectInfo.compilers);
        testsuiteSelect.innerHTML = generateOptions(projectInfo.testsuites);
        compilerSelect.value = projectInfo.compilers.includes(currentCompiler) ? currentCompiler : projectInfo.compilers[0];
        testsuiteSelect.value = projectInfo.testsuites.includes(currentTestsuite) ? currentTestsuite : projectInfo.testsuites[0];
      });
    });

    function submitForm() {
      const projectPath = projectPathSelect.value;
      const envFile = document.getElementById('envFileInput').value;
      const rows = document.querySelectorAll('#compilerContainer .double-input-container');
      const testsuiteArgs = Array.from(rows).map(row => {
        const [compilerSelect, testsuiteSelect] = row.children;
        return compilerSelect.value + '/' + testsuiteSelect.value;
      });
      if (!projectPath || !envFile || testsuiteArgs.some(arg => !arg)) {
        vscode.postMessage({ command: 'error', message: 'Project Path, Env File, and Compiler/Testsuite are required.' });
        return;
      }
      vscode.postMessage({
        command: 'submit',
        projectPath,
        envFiles: [envFile],
        testsuiteArgs
      });
    }

    function cancel() {
      vscode.postMessage({ command: 'cancel' });
    }

    // Pre-fill env file
    const initialEnvFile = ${initialEnvFileJson};
    window.addEventListener('DOMContentLoaded', () => {
      if (initialEnvFile) {
        document.getElementById('envFileInput').value = initialEnvFile;
      }
      // add initial compiler row
      addCompilerRow();
    });
  </script>
</body>
</html>
  `;
  }

  let newEnviroInProjectVCASTCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.newEnviroInProjectVCAST",
    async (args: vscode.Uri, argList: vscode.Uri[]) => {
      const panel = vscode.window.createWebviewPanel(
        "addEnviroToProject",
        "Create Environment in Project",
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true }
      );

      panel.webview.html = getProjectWebviewContent(argList);

      panel.webview.onDidReceiveMessage(async (message) => {
        if (message.command === "submit") {
          const { projectPath, sourceFiles, testsuiteArgs } = message;
          if (!projectPath || !sourceFiles || !testsuiteArgs) {
            vscode.window.showErrorMessage(
              "Compiler Name and Testsuite Name are required."
            );
            return;
          }
          const projectEnvParameters: ProjectEnvParameters = {
            path: projectPath,
            sourceFiles: sourceFiles,
            testsuiteArgs: testsuiteArgs,
          };

          vscode.window.showInformationMessage(
            "Creating environment with Environment Paths: " +
              testsuiteArgs.join(", ") +
              ", Source Files: " +
              sourceFiles.join(", ") +
              " in Project " +
              projectPath
          );

          newEnvironment(argList, projectEnvParameters);

          panel.dispose();
        } else if (message.command === "cancel") {
          panel.dispose();
        }
      }, undefined);
    }
  );
  context.subscriptions.push(newEnviroInProjectVCASTCommand);

  // Webview HTML content.
  function getProjectWebviewContent(argList: vscode.Uri[] | { fsPath: any }[]) {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
      <title>Create Environment</title>
      <style>
        /* Basic reset and styling */
        * { box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          background-color: #1e1e1e;
          color: #d4d4d4;
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
          margin: 0;
        }
        .modal {
          width: 700px;
          background-color: #252526;
          padding: 25px;
          border-radius: 8px;
          box-shadow: 0 0 10px rgba(0,0,0,0.3);
          text-align: center;
        }
        h2 { 
          color: #ffffff; 
          margin-bottom: 15px; 
          font-size: 22px; 
        }
        label {
          font-size: 16px;
          display: block;
          text-align: left;
          margin-top: 12px;
          margin-bottom: 6px;
        }
        input, select {
          padding: 10px;
          font-size: 14px;
          background-color: #3c3c3c;
          color: #d4d4d4;
          border: 1px solid #555;
          border-radius: 4px;
          width: 100%;
          margin-bottom: 10px;
        }
        select option {
          padding: 10px;
          border: 1px solid #555;
          margin: 2px;
        }
        
        /* Layout for single-input rows (Project Path, Source Files) */
        .single-input-container {
          display: grid;
          grid-template-columns: 1fr 50px;
          gap: 10px;
          align-items: center;
          margin-bottom: 10px;
          width: 100%;
        }
        .single-add-row {
          display: grid;
          grid-template-columns: 1fr 50px;
          gap: 10px;
          width: 100%;
          margin-bottom: 20px;
        }
        .single-add-row button { 
          grid-column: 1; 
          justify-self: start; 
        }
        /* Layout for double-input rows (Compiler, Testsuite) */
        .double-input-container {
          display: grid;
          grid-template-columns: 1fr 1fr 50px;
          gap: 10px;
          align-items: center;
          margin-bottom: 10px;
          width: 100%;
        }
        .double-add-row {
          display: grid;
          grid-template-columns: 1fr 1fr 50px;
          gap: 10px;
          width: 100%;
          margin-bottom: 20px;
        }
        .double-add-row button { 
          grid-column: 1; 
          justify-self: start; 
        }
        .remove-button {
          background-color: #cc4444;
          color: white;
          border: none;
          border-radius: 4px;
          padding: 10px;
          cursor: pointer;
          transition: background-color 0.3s;
        }
        .remove-button:hover { 
          background-color: #992222; 
        }
        .add-button {
          background-color: #007acc;
          color: white;
          border: none;
          border-radius: 4px;
          padding: 6px 10px;
          font-size: 14px;
          cursor: pointer;
          transition: background-color 0.3s;
        }
        .add-button:hover { 
          background-color: #005f99; 
        }
        /* Labels for the double row */
        .label-row {
          display: grid;
          grid-template-columns: 1fr 1fr 50px;
          gap: 10px;
          margin-bottom: 10px;
          width: 100%;
          font-weight: bold;
          text-align: center;
        }
        .label-row > div {
          display: flex;
          justify-content: center;
          align-items: center;
        }
        .button-container {
          display: flex;
          justify-content: space-between;
          margin-top: 20px;
        }
        .primary-button {
          background-color: #007acc;
          color: white;
          border: none;
          border-radius: 4px;
          padding: 10px 15px;
          font-size: 16px;
          cursor: pointer;
          transition: background-color 0.3s;
        }
        .primary-button:hover { 
          background-color: #005f99; 
        }
      </style>
    </head>
    <body>
      <div class="modal">
        <h2>Create Environment in Project</h2>
        
        <!-- Project Path Combobox -->
        <label>Project Path:</label>
        <div class="single-input-container">
          <select id="projectPath"></select>
        </div>
        
        <!-- Source Files -->
        <label>Source Files:</label>
        <div id="sourceFilesContainer">
          <div class="single-input-container">
            <input type="text" placeholder="Enter Source File" />
            <button class="remove-button" onclick="this.parentElement.remove()">✖</button>
          </div>
        </div>
        <div class="single-add-row">
          <button class="add-button" onclick="addInputRow('sourceFilesContainer', 'Enter Source File')">➕</button>
        </div>
        
        <!-- Compiler/Testsuite Labels -->
        <div class="label-row">
          <div>Select Compiler</div>
          <div>Select Testsuite</div>
          <div></div>
        </div>
        
        <!-- Compiler/Testsuite Container -->
        <div id="compilerContainer">
          <!-- Initial row will be added dynamically -->
        </div>
        <div class="double-add-row">
          <button class="add-button" onclick="addCompilerRow()">➕</button>
        </div>
        
        <!-- OK/Cancel Buttons -->
        <div class="button-container">
          <button class="primary-button" onclick="cancel()">Cancel</button>
          <button aria-label="importOk" class="primary-button" onclick="submitForm()">OK</button>
        </div>
      </div>
      
      <script>
        const vscode = acquireVsCodeApi();
    
        // globalProjectWebviewComboboxItems is embedded into the webview.
        // It is expected to be a Map<string, { compilers: string[]; testsuites: string[] }>
        const projectData = ${JSON.stringify(Array.from(globalProjectWebviewComboboxItems.entries()))};
        const projectMap = new Map(projectData);
    
        // Populate the Project Path combobox from the keys of the projectMap.
        const projectPathSelect = document.getElementById('projectPath');
        projectMap.forEach(function(value, key) {
          const option = document.createElement('option');
          option.value = key;
          option.textContent = key;
          projectPathSelect.appendChild(option);
        });
    
        // Helper function to generate <option> elements as HTML from an array.
        function generateOptions(arr) {
          let html = '';
          arr.forEach(function(item) {
            html += '<option value="' + item + '">' + item + '</option>';
          });
          return html;
        }
    
        // Adds a new row for Compiler and Testsuite.
        function addCompilerRow() {
          const selectedProject = projectPathSelect.value;
          const projectInfo = projectMap.get(selectedProject);
          if (!projectInfo) {
            vscode.postMessage({ command: 'error', message: 'No project data available for the selected project.' });
            return;
          }
          const container = document.getElementById('compilerContainer');
          const row = document.createElement('div');
          row.classList.add('double-input-container');
    
          const compilerSelect = document.createElement('select');
          compilerSelect.required = true;
          compilerSelect.innerHTML = generateOptions(projectInfo.compilers);
    
          const testsuiteSelect = document.createElement('select');
          testsuiteSelect.required = true;
          testsuiteSelect.innerHTML = generateOptions(projectInfo.testsuites);
    
          const removeButton = document.createElement('button');
          removeButton.textContent = '✖';
          removeButton.classList.add('remove-button');
          removeButton.onclick = function() { row.remove(); };
    
          row.appendChild(compilerSelect);
          row.appendChild(testsuiteSelect);
          row.appendChild(removeButton);
          container.appendChild(row);
        }
    
        // Update existing rows when the Project Path changes.
        projectPathSelect.addEventListener('change', function() {
          const selectedProject = projectPathSelect.value;
          const projectInfo = projectMap.get(selectedProject);
          if (!projectInfo) return;
          const rows = document.querySelectorAll('#compilerContainer .double-input-container');
          rows.forEach(function(row) {
            const compilerSelect = row.children[0];
            const testsuiteSelect = row.children[1];
            const currentCompiler = compilerSelect.value;
            const currentTestsuite = testsuiteSelect.value;
            compilerSelect.innerHTML = generateOptions(projectInfo.compilers);
            testsuiteSelect.innerHTML = generateOptions(projectInfo.testsuites);
            compilerSelect.value = projectInfo.compilers.indexOf(currentCompiler) !== -1 ? currentCompiler : projectInfo.compilers[0];
            testsuiteSelect.value = projectInfo.testsuites.indexOf(currentTestsuite) !== -1 ? currentTestsuite : projectInfo.testsuites[0];
          });
        });
    
        // Adds a new source file input row.
        function addInputRow(containerId, placeholderText) {
          const container = document.getElementById(containerId);
          const row = document.createElement('div');
          row.classList.add('single-input-container');
          const input = document.createElement('input');
          input.type = 'text';
          input.placeholder = placeholderText;
          const removeButton = document.createElement('button');
          removeButton.textContent = '✖';
          removeButton.classList.add('remove-button');
          removeButton.onclick = function() { row.remove(); };
          row.appendChild(input);
          row.appendChild(removeButton);
          container.appendChild(row);
        }
    
        // Submit the form. Combine each row's values into a single string.
        function submitForm() {
          const projectPath = projectPathSelect.value;
          const sourceFiles = Array.from(document.querySelectorAll('#sourceFilesContainer .single-input-container input[type="text"]')).map(function(i) { return i.value; });
          const testsuiteArgs = Array.from(document.querySelectorAll('#compilerContainer .double-input-container')).map(function(row) {
            const compiler = row.children[0].value;
            const testsuite = row.children[1].value;
            return compiler + "/" + testsuite;
          });
          if (!projectPath || testsuiteArgs.some(function(arg) { return !arg; })) {
            vscode.postMessage({ command: 'error', message: 'Project Path, Compiler, and Testsuite are required.' });
            return;
          }
          vscode.postMessage({
            command: 'submit',
            projectPath: projectPath,
            sourceFiles: sourceFiles,
            testsuiteArgs: testsuiteArgs
          });
        }
    
        function cancel() {
          vscode.postMessage({ command: 'cancel' });
        }
    
        // Pre-fill source files if provided.
        const initialSourceFiles = ${JSON.stringify(
          argList.map(function (uri) {
            return uri.fsPath;
          })
        )};
        window.addEventListener('DOMContentLoaded', function() {
          const sourceContainer = document.getElementById('sourceFilesContainer');
          if (initialSourceFiles && initialSourceFiles.length > 0) {
            sourceContainer.innerHTML = '';
            initialSourceFiles.forEach(function(file) {
              const row = document.createElement('div');
              row.classList.add('single-input-container');
              const input = document.createElement('input');
              input.type = 'text';
              input.value = file;
              const removeButton = document.createElement('button');
              removeButton.textContent = '✖';
              removeButton.classList.add('remove-button');
              removeButton.onclick = function() { row.remove(); };
              row.appendChild(input);
              row.appendChild(removeButton);
              sourceContainer.appendChild(row);
            });
          }
          // Add an initial compiler/testsuites row.
          addCompilerRow();
        });
      </script>
    </body>
    </html>
    `;
  }
}

// this method is called when your extension is deactivated
export async function deactivate() {
  await updateAllOpenedProjects();
  await serverProcessController(serverStateType.stopped);
  // delete the server log if it exists
  await deleteServerLog();
  console.log("The VectorCAST Test Explorer has been de-activated");
  return deactivateLanguageServerClient();
}
