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
  getEnvironmentList,  // Add this import
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
let messagePane: vscode.OutputChannel = vscode.window.createOutputChannel(
  "VectorCAST Test Explorer"
);

export function getMessagePane(): vscode.OutputChannel {
  return messagePane;
}


// Setup the paths to the code2reqs and reqs2tests executables
let CODE2REQS_EXECUTABLE_PATH: string;
let REQS2TESTS_EXECUTABLE_PATH: string;
let MANAGE_ENV_EXECUTABLE_PATH: string;

function setupAutoreqExecutablePaths(context: vscode.ExtensionContext) {
    CODE2REQS_EXECUTABLE_PATH = vscode.Uri.joinPath(context.extensionUri, "resources", "distribution", "code2reqs").fsPath;
    REQS2TESTS_EXECUTABLE_PATH = vscode.Uri.joinPath(context.extensionUri, "resources", "distribution", "reqs2tests").fsPath;
    MANAGE_ENV_EXECUTABLE_PATH = vscode.Uri.joinPath(context.extensionUri, "resources", "distribution", "manage_env").fsPath;
    //CODE2REQS_EXECUTABLE_PATH = "code2reqs";
    //REQS2TESTS_EXECUTABLE_PATH = "reqs2tests";
    //MANAGE_ENV_EXECUTABLE_PATH = "manage_env";
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

const REQUIRED_ENV_VARS = {
    'OPENAI_API_KEY': 'Azure OpenAI API Key',
    'OPENAI_GENERATION_DEPLOYMENT': 'Azure OpenAI Model Deployment Name for Generation',
    'OPENAI_ADVANCED_GENERATION_DEPLOYMENT': 'Azure OpenAI Model Deployment Name for Advanced Generation',
    'OPENAI_API_BASE': 'Azure OpenAI API Endpoint URL'
} as const;

async function promptForMissingEnvVars(showSuccessMessage: boolean = false, forcePromptAll: boolean = false): Promise<boolean> {
    let allSet = true;
    const values = await listEnvironmentStoreValues();
    
    for (const [key, description] of Object.entries(REQUIRED_ENV_VARS)) {
        // Only prompt if value is missing or if we're forcing a prompt for all values
        if (!values || !values[key] || forcePromptAll) {
            const value = await vscode.window.showInputBox({
                prompt: `Please enter your ${description}`,
                placeHolder: key === 'OPENAI_API_BASE' ? 'https://your-resource.openai.azure.com/' : undefined,
                value: values?.[key] || '',  // Pre-fill with existing value if available
                password: key === 'OPENAI_API_KEY',
                ignoreFocusOut: true
            });
            
            if (!value) {  // User cancelled
                allSet = false;
                break;
            }
            
            const success = await setEnvironmentStoreValue(key, value);
            if (!success) {
                vscode.window.showErrorMessage(`Failed to store ${description}`);
                allSet = false;
                break;
            }
        }
    }
    
    if (allSet && showSuccessMessage) {
        vscode.window.showInformationMessage('Azure OpenAI settings configured successfully');
    }
    
    return allSet;
}

async function checkApiSettings(): Promise<void> {
    const values = await listEnvironmentStoreValues();
    const missingVars = Object.entries(REQUIRED_ENV_VARS)
        .filter(([key]) => !values || !values[key])
        .map(([_, desc]) => desc);
    
    if (missingVars.length > 0) {
        const message = 'Some required Azure OpenAI settings are missing. These are needed for requirements generation.';
        const configure = 'Configure Now';
        const later = 'Later';
        
        const choice = await vscode.window.showWarningMessage(message, configure, later);
        if (choice === configure) {
            await promptForMissingEnvVars(true);
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

  // Initialize requirements availability for all environments
  if (workspace.workspaceFolders && workspace.workspaceFolders.length > 0) {
    const envPaths = await getEnvironmentList(workspace.workspaceFolders[0].uri.fsPath);
    for (const envPath of envPaths) {
      updateRequirementsAvailability(envPath);
    }
  }

  setupAutoreqExecutablePaths(context);
  
  // Add this line at the end of activationLogic
  await checkApiSettings();
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
        await generateTestsFromRequirements(enviroPath);
      }
    }
  );
  context.subscriptions.push(generateRequirementsTestsCommand);

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
    (args: any) => {
      if (args) {
        const testNode: testNodeType = getTestNode(args.id);
        const enviroPath = testNode.enviroPath;
        const parentDir = path.dirname(enviroPath);
        const htmlPath = path.join(parentDir, 'reqs.html');

        if (fs.existsSync(htmlPath)) {
          const panel = vscode.window.createWebviewPanel(
            'requirementsReport',
            'Requirements Report',
            vscode.ViewColumn.One,
            { enableScripts: true }
          );

          fs.readFile(htmlPath, 'utf8', (err, data) => {
            if (err) {
              vscode.window.showErrorMessage(`Error reading HTML report: ${err.message}`);
              return;
            }
            panel.webview.html = data;
          });
        } else {
          vscode.window.showErrorMessage('Requirements report not found. Generate requirements first.');
        }
      }
    }
  );
  context.subscriptions.push(showRequirementsCommand);

  // Update the command registration
  let configureAPISettingsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.configureAPISettings",
    async () => {
        await promptForMissingEnvVars(true, true);  // Added true for forcePromptAll
    }
  );
  context.subscriptions.push(configureAPISettingsCommand);

  vscode.workspace.onDidChangeWorkspaceFolders(
    async (e) => {
      refreshAllExtensionData();
      // Refresh requirements availability for all environments
      if (workspace.workspaceFolders && workspace.workspaceFolders.length > 0) {
        const envPaths = await getEnvironmentList(workspace.workspaceFolders[0].uri.fsPath);
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
  await serverProcessController(serverStateType.stopped);
  // delete the server log if it exists
  await deleteServerLog();
  console.log("The VectorCAST Test Explorer has been de-activated");
  return deactivateLanguageServerClient();
}

async function generateRequirements(enviroPath: string) {
  // Check for required environment variables first
  if (!await promptForMissingEnvVars()) {
    vscode.window.showErrorMessage('Required API settings are missing. Please configure them first.');
    return;
  }

  const parentDir = path.dirname(enviroPath);
  const lowestDirname = path.basename(enviroPath);
  const envName = `${lowestDirname}.env`;
  const envPath = path.join(parentDir, envName);

  const csvPath = path.join(parentDir, 'reqs.csv');
  const htmlPath = path.join(parentDir, 'reqs.html');
  const repositoryDir = path.join(parentDir, 'requirement_repository');

  const commandArgs = [
    envPath,
    "--export-csv",
    csvPath,
    "--export-html",
    htmlPath,
    "--export-repository",
    repositoryDir,
    "--json-events",
  ];

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Generating Requirements for ${envName.split(".")[0]}`,
    cancellable: false
  }, async (progress) => {
    let lastProgress = 0;
    let simulatedProgress = 0;
    const simulatedProgressInterval = setInterval(() => {
      if (simulatedProgress < 30) {
        simulatedProgress += 1;
        progress.report({ increment: 1 });
      }
    }, 1000); // Update every second for 30 seconds

    return await new Promise<void>((resolve, reject) => {
      const process = spawn(CODE2REQS_EXECUTABLE_PATH, commandArgs);

      process.stdout.on("data", (data) => {
        const lines = data.toString().split("\n");
        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            if (json.event === "progress" && json.value !== undefined) {
              // Scale the remaining 70% based on the actual progress
              const scaledProgress = json.value * 0.7;
              const increment = (scaledProgress - lastProgress) * 100;
              if (increment > 0) {
                progress.report({ increment });
                lastProgress = scaledProgress;
              }
            } else if (json.event === "problem" && json.value !== undefined) {
              vscode.window.showWarningMessage(json.value);
            }
          } catch (e) {
            console.log(line); // Handle non-JSON output if necessary
          }
        }
      });

      process.stderr.on("data", (data) => {
        console.error(`Stderr: ${data}`);
      });

      process.on("close", async (code) => {
        clearInterval(simulatedProgressInterval);
        if (code === 0) {
          // Display the HTML report in a webview
          const panel = vscode.window.createWebviewPanel(
            'requirementsReport',
            'Generated Requirements',
            vscode.ViewColumn.One,
            { enableScripts: true }
          );

          fs.readFile(htmlPath, 'utf8', (err, data) => {
            if (err) {
              vscode.window.showErrorMessage(`Error reading HTML report: ${err.message}`);
              reject();
              return;
            }
            panel.webview.html = data;
          });

          await refreshAllExtensionData();
          updateRequirementsAvailability(enviroPath);

          vscode.window.showInformationMessage("Successfully generated requirements for the environment!");

          resolve();
        } else {
          vscode.window.showErrorMessage(`Error: code2reqs exited with code ${code}`);
          reject();
        }
      });
    });
  });
}

async function generateTestsFromRequirements(enviroPath: string) {
  // Check for required environment variables first
  if (!await promptForMissingEnvVars()) {
    vscode.window.showErrorMessage('Required API settings are missing. Please configure them first.');
    return;
  }

  const currentDir = enviroPath;
  const parentDir = path.dirname(currentDir);
  const lowestDirname = path.basename(currentDir);
  const envName = `${lowestDirname}.env`;
  const envPath = path.join(parentDir, envName);

  const csvPath = path.join(parentDir, 'reqs.csv');
  const tstPath = path.join(parentDir, 'reqs2tests.tst');

  const commandArgs = [
    envPath,
    csvPath,
    "--export-tst",
    tstPath,
    "--retries",
    "1",
    "--batched",
    "--allow-partial",
    "--export-env",
    "--json-events",
  ];

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Generating Tests from Requirements for ${envName.split(".")[0]}`,
    cancellable: false
  }, async (progress) => {
    let lastProgress = 0;
    let simulatedProgress = 0;
    const simulatedProgressInterval = setInterval(() => {
      if (simulatedProgress < 40) {
        simulatedProgress += 1;
        progress.report({ increment: 1 });
      }
    }, 1000); // Update every second for 30 seconds

    return new Promise<void>((resolve, reject) => {
      const process = spawn(REQS2TESTS_EXECUTABLE_PATH, commandArgs);

      process.stdout.on("data", (data) => {
        const lines = data.toString().split("\n");
        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            if (json.event === "progress" && json.value !== undefined) {
              // Scale the remaining 70% based on the actual progress
              const scaledProgress = json.value * 0.6;
              const increment = (scaledProgress - lastProgress) * 100;
              if (increment > 0) {
                progress.report({ increment });
                lastProgress = scaledProgress;
              }
            } else if (json.event === "problem" && json.value !== undefined) {
              vscode.window.showWarningMessage(json.value);
            }
          } catch (e) {
            console.log(line);
          }
        }
      });

      process.stderr.on("data", (data) => {
        console.error(`Stderr: ${data}`);
      });

      process.on("close", async (code) => {
        clearInterval(simulatedProgressInterval);
        if (code === 0) {
          await refreshAllExtensionData();

          vscode.window.showInformationMessage(
            "Successfully generated tests for the requirements!"
          );
          resolve();
        } else {
          vscode.window.showErrorMessage(`Error: reqs2tests exited with code ${code}`);
          reject();
        }
      });
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

  console.log(enviroNodeID + " " + enviroPath + " " + csvPath + " " + fs.existsSync(csvPath))
  
  if (fs.existsSync(csvPath)) {
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

async function setEnvironmentStoreValue(key: string, value: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        const process = spawn(MANAGE_ENV_EXECUTABLE_PATH, ['set', key, value]);
        
        process.stdout.on('data', (data) => {
            console.log(`manage_env stdout: ${data}`);
        });

        process.stderr.on('data', (data) => {
            console.error(`manage_env stderr: ${data}`);
        });

        process.on('close', (code) => {
            resolve(code === 0);
        });
    });
}

async function getEnvironmentStoreValue(key: string): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
        const process = spawn(MANAGE_ENV_EXECUTABLE_PATH, ['get', key]);
        let output = '';
        
        process.stdout.on('data', (data) => {
            output += data.toString();
        });

        process.stderr.on('data', (data) => {
            console.error(`manage_env stderr: ${data}`);
        });

        process.on('close', (code) => {
            if (code === 0) {
                resolve(output.trim());
            } else {
                resolve(null);
            }
        });
    });
}

async function listEnvironmentStoreValues(): Promise<Record<string, string> | null> {
    return new Promise<Record<string, string> | null>((resolve) => {
        const process = spawn(MANAGE_ENV_EXECUTABLE_PATH, ['list']);
        let output = '';
        
        process.stdout.on('data', (data) => {
            output += data.toString();
        });

        process.stderr.on('data', (data) => {
            console.error(`manage_env stderr: ${data}`);
        });

        process.on('close', (code) => {
            if (code === 0) {
                try {
                    const result = JSON.parse(output.trim());
                    resolve(result);
                } catch (e) {
                    console.error('Failed to parse JSON output:', e);
                    resolve(null);
                }
            } else {
                resolve(null);
            }
        });
    });
}

