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
} from "./testPane";

import {
  addLaunchConfiguration,
  addSettingsFileFilter,
  getEnvPathForFilePath,
  showSettings,
  updateCoverageAndRebuildEnv,
  forceLowerCaseDriveLetter,
  decodeVar,
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
  getLevelFromNodeId,
  getVcmRoot,
  loadATGLineTest,
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

  /**
   * Register command to open webview for ATG test for a specific line,
   * and provide function + variables extracted from the source file.
   */
  const getATGTestForLineCmd = vscode.commands.registerCommand(
    "vectorcastTestExplorer.getATGTestForLine",
    async (args) => {
      const activeEditor = vscode.window.activeTextEditor;
      let filePath =
        activeEditor?.document.uri.fsPath ?? args?.uri?.fsPath ?? "";
      let lineNumber =
        args?.lineNumber ??
        (activeEditor ? activeEditor.selection.active.line + 1 : "");

      if (!filePath || !lineNumber) {
        vscode.window.showErrorMessage("No file or line number available.");
        return;
      }

      // read file content
      let fileText: string;
      try {
        fileText = fs.readFileSync(filePath, "utf8");
      } catch (err) {
        vscode.window.showErrorMessage("Failed to read file: " + String(err));
        return;
      }

      // find function & variables
      const func = findFunctionAtLine(fileText, Number(lineNumber));
      const vars = extractVariablesFromFile(fileText, func);

      // Get environments for the file - replace with your real implementation
      const globalCoverageData = getGlobalCoverageData();
      const enviroList =
        globalCoverageData.get(filePath)?.enviroList ?? new Map();
      const enviroPaths = Array.from(enviroList.keys());

      // Create webview panel
      const baseDir = resolveWebviewBase(context);
      const panel = vscode.window.createWebviewPanel(
        "getATGTestForLine",
        "Get ATG Test for Line",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.file(baseDir)],
        }
      );

      panel.webview.html = await getATGWebviewContent(
        context,
        panel,
        filePath,
        lineNumber,
        enviroPaths,
        func,
        vars
      );

      panel.webview.onDidReceiveMessage(
        async (msg) => {
          switch (msg.command) {
            case "submit": {
              const { sourceFile, line, enviroPath, variableValues } = msg;

              // Validation checks
              if (!sourceFile || sourceFile.trim() === "") {
                vscode.window.showErrorMessage("Source file path is required.");
                return;
              }
              if (!fs.existsSync(sourceFile)) {
                vscode.window.showErrorMessage(`File not found: ${sourceFile}`);
                return;
              }
              if (!line || isNaN(Number(line)) || Number(line) <= 0) {
                vscode.window.showErrorMessage(
                  "Line number must be a positive integer."
                );
                return;
              }
              if (!enviroPath) {
                vscode.window.showErrorMessage("Please select an environment.");
                return;
              }

              // variableValues is an array of { name, value }
              // Replace with your actual loader - we pass variableValues through
              try {
                await loadATGLineTest(
                  sourceFile,
                  Number(line),
                  enviroPath,
                  variableValues
                );
                vscode.window.showInformationMessage(
                  `Fetching ATG test for ${sourceFile}:${line} in environment ${enviroPath}`
                );
              } catch (err) {
                vscode.window.showErrorMessage(
                  "Failed to load ATG test: " + String(err)
                );
              }

              panel.dispose();
              break;
            }
            case "cancel":
              panel.dispose();
              break;
          }
        },
        undefined,
        context.subscriptions
      );
    }
  );

  context.subscriptions.push(getATGTestForLineCmd);
}

/* ===================================================================
 Helper: findFunctionAtLine
 - returns { name, params, startLine, endLine, code, selectedLine }
   where code is the function source (from signature to closing brace)
   and selectedLine is 1-based line index inside that function corresponding to the selected file line.
 - If no function found, returns code = whole file and selectedLine = requested line
 =================================================================== */
function findFunctionAtLine(fileText: string, lineNumber: number) {
  const text = fileText;
  const totalLines = text.split(/\r?\n/).length;

  // Heuristic regex to find function signatures followed by '{'
  // groups: (return/type+qualifiers) (name) (params)
  const funcRegex =
    /([A-Za-z_][\w\s\*\&:<>,\[\]]*?)\s+([A-Za-z_]\w*)\s*\(([^\)]*)\)\s*\{/g;
  let match: RegExpExecArray | null;
  const funcCandidates: Array<{
    name: string;
    paramsRaw: string;
    startIndex: number;
    startLine: number;
  }> = [];

  while ((match = funcRegex.exec(text))) {
    const before = text.slice(0, match.index);
    const startLine = before.split(/\r?\n/).length;
    funcCandidates.push({
      name: match[2],
      paramsRaw: match[3],
      startIndex: match.index,
      startLine,
    });
  }

  // For each candidate, find matching closing brace with depth counting
  for (const c of funcCandidates) {
    const openPos = text.indexOf("{", c.startIndex);
    if (openPos < 0) continue;
    let depth = 0;
    let endPos = -1;
    for (let p = openPos; p < text.length; ++p) {
      const ch = text[p];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          endPos = p;
          break;
        }
      }
    }
    if (endPos === -1) continue; // skip if can't find end

    const endLine = text.slice(0, endPos).split(/\r?\n/).length;

    // If requested line is inside this function block
    if (lineNumber >= c.startLine && lineNumber <= endLine) {
      const code = text.slice(c.startIndex, endPos + 1);
      const params = parseParamNames(c.paramsRaw);
      const selectedLine = lineNumber - c.startLine + 1; // 1-based inside function
      return {
        name: c.name,
        params,
        startLine: c.startLine,
        endLine,
        code,
        selectedLine,
      };
    }
  }

  // fallback: nearest preceding function
  let lastFunc = null;
  for (const c of funcCandidates) {
    if (c.startLine <= lineNumber) lastFunc = c;
    else break;
  }
  if (lastFunc) {
    // try to find end
    const openPos = text.indexOf("{", lastFunc.startIndex);
    let endPos = -1;
    if (openPos >= 0) {
      let depth = 0;
      for (let p = openPos; p < text.length; ++p) {
        const ch = text[p];
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            endPos = p;
            break;
          }
        }
      }
    }
    const code =
      endPos >= 0
        ? text.slice(lastFunc.startIndex, endPos + 1)
        : text.slice(lastFunc.startIndex);
    const params = parseParamNames(lastFunc.paramsRaw);
    const selectedLine = Math.max(1, lineNumber - lastFunc.startLine + 1);
    return {
      name: lastFunc.name,
      params,
      startLine: lastFunc.startLine,
      endLine:
        endPos >= 0 ? text.slice(0, endPos).split(/\r?\n/).length : totalLines,
      code,
      selectedLine,
    };
  }

  // no function found: return whole file as code and selectedLine as the requested line
  return {
    name: null,
    params: [],
    startLine: 1,
    endLine: totalLines,
    code: fileText,
    selectedLine: lineNumber,
  };
}

/* -------------------------
 parseParamNames
 parse parameter list text into parameter names (best-effort)
 "int a, const char *s" => ["a","s"]
 ------------------------- */
function parseParamNames(paramsRaw: string): string[] {
  if (!paramsRaw || paramsRaw.trim() === "") return [];
  // naive split at commas, but handle commas inside templates by counting <> (simple)
  const parts: string[] = [];
  let depthAng = 0;
  let cur = "";
  for (let i = 0; i < paramsRaw.length; ++i) {
    const ch = paramsRaw[i];
    if (ch === "<") depthAng++;
    else if (ch === ">") depthAng = Math.max(0, depthAng - 1);
    if (ch === "," && depthAng === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim() !== "") parts.push(cur);

  const names: string[] = [];
  for (let p of parts) {
    p = p.trim();
    if (!p) continue;
    // remove default value
    p = p.split("=")[0].trim();
    const toks = p.split(/\s+/).filter(Boolean);
    if (toks.length === 0) continue;
    let last = toks[toks.length - 1];
    // strip pointer/reference symbols
    last = last.replace(/^[\*\&]+/, "").replace(/[\*\&]+$/, "");
    if (/^[A-Za-z_]\w*$/.test(last)) names.push(last);
  }
  return names;
}

/* ===================================================================
 extractVariablesFromFile - heuristic-based variable extraction
 Returns an array of variable names (unique, sorted)
 - includes function params passed in funcInfo.params
 - finds typed declarations and assignment targets
 =================================================================== */
function extractVariablesFromFile(fileText: string, funcInfo: any): string[] {
  const vars = new Set<string>();

  // 1) function params
  if (funcInfo && Array.isArray(funcInfo.params)) {
    for (const p of funcInfo.params) vars.add(p);
  }

  // 2) typed declarations - heuristic
  const typePattern =
    "\\b(?:unsigned|signed|short|long|int|float|double|char|bool|auto|void|size_t|ssize_t|struct|class|enum)\\b";
  const declRegex = new RegExp(
    "(" +
      typePattern +
      "[\\w\\s\\*\\&:<>,\\[\\]]*?)\\s+([A-Za-z_]\\w*)(\\s*(?:[=,;\\[])?)",
    "g"
  );
  let m: RegExpExecArray | null;
  while ((m = declRegex.exec(fileText))) {
    const name = m[2];
    if (name && !isKeyword(name)) vars.add(name);

    // try to capture subsequent comma-separated names on same declaration line
    const post = fileText.slice(
      m.index + m[0].length,
      m.index + m[0].length + 200
    );
    const commaMatch = post.match(/^([^;\n]*)/);
    if (commaMatch) {
      const rest = commaMatch[1];
      const moreNames = [...rest.matchAll(/\b([A-Za-z_]\w*)\b/g)].map(
        (x) => x[1]
      );
      for (const nm of moreNames) {
        if (!isKeyword(nm)) vars.add(nm);
      }
    }
  }

  // 3) assignment targets
  const assignRegex = /\b([A-Za-z_]\w*)\s*=/g;
  while ((m = assignRegex.exec(fileText))) {
    const name = m[1];
    if (!isKeyword(name)) vars.add(name);
  }

  // 4) pointer declarations
  const pointerRegex = new RegExp(
    "\\b(?:int|char|float|double|long|short|unsigned|signed|auto)\\b[^;\\n]*[\\*\\&]\\s*([A-Za-z_]\\w*)",
    "g"
  );
  while ((m = pointerRegex.exec(fileText))) {
    const name = m[1];
    if (!isKeyword(name)) vars.add(name);
  }

  // remove function names
  const funcNameRegex = /([A-Za-z_]\w*)\s*\([^\)]*\)\s*\{/g;
  const fns = new Set<string>();
  while ((m = funcNameRegex.exec(fileText))) {
    fns.add(m[1]);
  }
  for (const f of fns) vars.delete(f);

  // drop common tokens
  const drop = [
    "int",
    "char",
    "float",
    "double",
    "long",
    "short",
    "unsigned",
    "signed",
    "const",
    "volatile",
    "struct",
    "class",
    "enum",
    "auto",
    "void",
  ];
  for (const k of drop) vars.delete(k);

  return Array.from(vars).sort((a, b) => a.localeCompare(b));
}

/* -------------------------
 small helper to filter out keywords captured by heuristics
 ------------------------- */
function isKeyword(w: string) {
  const kws = new Set([
    "for",
    "while",
    "if",
    "else",
    "switch",
    "case",
    "return",
    "break",
    "continue",
    "goto",
    "sizeof",
    "typedef",
    "static",
    "extern",
    "inline",
    "constexpr",
    "namespace",
    "using",
  ]);
  return kws.has(w);
}

/* ===================================================================
 getATGWebviewContent - load html + inject variables
 Note: html file should include placeholders {{ cssUri }} and {{ scriptUri }}
 =================================================================== */
async function getATGWebviewContent(
  context: vscode.ExtensionContext,
  panel: vscode.WebviewPanel,
  sourceFile: string,
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

  html = html.replace(
    /<head>/,
    `<head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}' ${panel.webview.cspSource};">
    <script nonce="${nonce}">
      window.defaultSourceFile = ${JSON.stringify(sourceFile)};
      window.defaultLineNumber = ${JSON.stringify(lineNumber)};
      window.enviroPaths = ${JSON.stringify(enviroPaths)};
      window.fileFunction = ${JSON.stringify(funcInfo)};
      window.fileVariables = ${JSON.stringify(variables)};
    </script>`
  );

  html = html.replace("{{ cssUri }}", cssUri.toString());
  html = html.replace(
    "{{ scriptUri }}",
    `<script nonce="${nonce}" src="${scriptUri}"></script>`
  );

  return html;
}

// this method is called when your extension is deactivated
export async function deactivate() {
  await serverProcessController(serverStateType.stopped);
  // delete the server log if it exists
  await deleteServerLog();
  console.log("The VectorCAST Test Explorer has been de-activated");
  return deactivateLanguageServerClient();
}
