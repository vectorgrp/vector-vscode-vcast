import fs = require("fs");
import * as vscode from "vscode";
import { type Uri } from "vscode";
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
  initializeCodeCoverageFeatures,
  createCoverageStatusBar,
  toggleCoverageAction,
  updateDisplayedCoverage,
  updateCOVdecorations,
} from "./coverage";
import {
  buildTestNodeForFunction,
  initializeTestDecorator,
  updateTestDecorator,
} from "./editorDecorator";
import {
  openMessagePane,
  toggleMessageLog,
  adjustVerboseSetting,
  vectorMessage,
} from "./messagePane";
import { viewResultsReport } from "./reporting";
import {
  getEnviroPathFromID,
  getTestNode,
  type testNodeType,
} from "./testData";
import {
  activateTestPane,
  buildTestPaneContents,
  deleteTests,
  insertBasisPathTests,
  insertATGTests,
  loadTestScript,
  pathToEnviroBeingDebugged,
  pathToProgramBeingDebugged,
  updateCodedTestCases,
  updateDataForEnvironment,
} from "./testPane";
import {
  addLaunchConfiguration,
  addSettingsFileFilter,
  showSettings,
} from "./utilities";
import {
  buildEnvironmentFromScript,
  deleteEnvironment,
  setCodedTestOption,
  openVcastFromEnviroNode,
  openVcastFromVCEfile,
} from "./vcastAdapter";
import { executeWithRealTimeEcho } from "./vcastCommandRunner";
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
  resetCoverageData,
} from "./vcastTestInterface";
import {
  addIncludePath,
  getEnviroNameFromFile,
  openTestScript,
  rebuildEnvironmentCommand,
} from "./vcastUtilities";
import { updateExploreDecorations } from "./fileDecorator";
const path = require("node:path");

const messagePane: vscode.OutputChannel = vscode.window.createOutputChannel(
  "VectorCAST Test Explorer"
);

export function getMessagePane(): vscode.OutputChannel {
  return messagePane;
}

export async function activate(context: vscode.ExtensionContext) {
  // Activation gets called when:
  //  -- VectorCAST environment exists in the workspace
  //  -- "Create VectorCAST Environment" is selected from the Explorer context menu
  //  -- "VectorCAST Test Explorer: Configure" is selected from the command palette (ctrl-shift-p)

  // Handler for "VectorCAST Test Explorer: Configure"
  // The first use of configure will trigger this activate function
  // subsequent uses will trigger configureCommandCalled()
  vscode.commands.registerCommand("vectorcastTestExplorer.configure", () => {
    configureCommandCalled(context);
  });
  vscode.commands.registerCommand("vectorcastTestExplorer.toggleLog", () => {
    toggleMessageLog();
  });

  // We need to install some event handlers so that the user can "fix"
  // a "bad" vcast installation by providing a valid path see logic
  // and comments in this function
  installPreActivationEventHandlers(context);

  // This checks the vcast installation,
  // and if its ok will proceed with full activation
  checkPrerequisites(context);
}

export function configureCommandCalled(context: vscode.ExtensionContext) {
  // Open the extension settings if the user has explicitly called configure
  showSettings();
}

let alreadyConfigured = false;
let installationFilesInitialized = false;
function checkPrerequisites(context: vscode.ExtensionContext) {
  // This function is called from the activate function, and also from the
  // event handler for changes to the vcast installation location.  So in the
  // case that the VectorCAST installation is not found initially, we will get
  // here multiple times

  if (!alreadyConfigured) {
    // Setup the location of vTestInterface.py and other utilities
    if (!installationFilesInitialized) {
      initializeInstallerFiles(context);
      installationFilesInitialized = true;
    }

    if (checkIfInstallationIsOK()) {
      activationLogic(context);
      alreadyConfigured = true;
      vscode.commands.executeCommand(
        "setContext",
        "vectorcastTestExplorer.configured",
        true
      );
      // Default to coverage ON
      toggleCoverageAction();
      // Initialize the verbose setting
      adjustVerboseSetting();
    } else {
      openMessagePane();
    }
  }
}

function activationLogic(context: vscode.ExtensionContext) {
  // Adds all of the command handlers
  configureExtension(context);

  // Setup the decorations for coverage
  initializeCodeCoverageFeatures(context);

  // Initialize the gutter decorator for testable functions
  initializeTestDecorator(context);

  // Initialize the test pane
  activateTestPane(context);

  // Start the language server
  activateLanguageServerClient(context);
}

function configureExtension(context: vscode.ExtensionContext) {
  // This sets up the file explorer decorations for code coverage
  updateExploreDecorations();

  // Command: vectorcastTestExplorer.coverage /////////////////////////////////////////////////////////
  // We create the status bar here, but the showing and updating is done in updateCOVdecorations
  const coverStatusBar: vscode.StatusBarItem = createCoverageStatusBar();
  context.subscriptions.push(coverStatusBar);
  const toggleCoverageCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.coverage",
    () => {
      toggleCoverageAction();
    }
  );
  context.subscriptions.push(toggleCoverageCommand);

  // Command: vectorcastTestExplorer.viewResults////////////////////////////////////////////////////////
  const viewResultsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.viewResults",
    (arguments_: any) => {
      if (arguments_) {
        viewResultsReport(arguments_.id);
      }
    }
  );
  context.subscriptions.push(viewResultsCommand);

  // Command: vectorcastTestExplorer.createTestScript////////////////////////////////////////////////////////
  // This is the callback for the right clicks in the test explorer tree
  const createTestScriptCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.createTestScript",
    (arguments_: any) => {
      if (arguments_) {
        const testNode: testNodeType = getTestNode(arguments_.id);
        newTestScript(testNode);
      }
    }
  );
  context.subscriptions.push(createTestScriptCommand);

  // Command: vectorcastTestExplorer.addCodedTests////////////////////////////////////////////////////////
  // This is the callback for the right clicks in the test explorer tree
  const addCodedTestsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.addCodedTests",
    (arguments_: any) => {
      if (arguments_) {
        addExistingCodedTestFile(arguments_.id);
      }
    }
  );
  context.subscriptions.push(addCodedTestsCommand);

  // Command: vectorcastTestExplorer.generateCodedTests////////////////////////////////////////////////////////
  // This is the callback for the right clicks in the test explorer tree
  const generateCodedTestsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.generateCodedTests",
    (arguments_: any) => {
      if (arguments_) {
        generateNewCodedTestFile(arguments_.id);
      }
    }
  );
  context.subscriptions.push(generateCodedTestsCommand);

  // Command: vectorcastTestExplorer.removeCodedTests////////////////////////////////////////////////////////
  // This is the callback for the right clicks in the test explorer tree

  // adding the ... to nodeList, results in us getting a list of selected tests!
  const removeCodedTestsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.removeCodedTests",
    (...nodeList: any) => {
      if (nodeList) {
        deleteTests(nodeList);
      }
    }
  );
  context.subscriptions.push(removeCodedTestsCommand);

  // Command: vectorcastTestExplorer.insertBasisPathTests////////////////////////////////////////////////////////
  const insertBasisPathTestsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.insertBasisPathTests",
    (arguments_: any) => {
      if (arguments_) {
        const testNode: testNodeType = getTestNode(arguments_.id);
        insertBasisPathTests(testNode);
      }
    }
  );
  context.subscriptions.push(insertBasisPathTestsCommand);

  // Command: vectorcastTestExplorer.insertBasisPathTestsFromEditor////////////////////////////////////////////////////////
  const insertBasisPathTestsFromEditorCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.insertBasisPathTestsFromEditor",
    (arguments_: any) => {
      if (arguments_) {
        const testNode = buildTestNodeForFunction(arguments_);
        if (testNode) insertBasisPathTests(testNode);
        else
          vscode.window.showErrorMessage(
            `Unable to create Basis Path Tests for function at line ${arguments_.lineNumber}`
          );
      }
    }
  );
  context.subscriptions.push(insertBasisPathTestsFromEditorCommand);

  // Command: vectorcastTestExplorer.insertATGTests////////////////////////////////////////////////////////
  const insertATGTestsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.insertATGTests",
    (arguments_: any) => {
      if (arguments_) {
        const testNode: testNodeType = getTestNode(arguments_.id);
        insertATGTests(testNode);
      }
    }
  );
  context.subscriptions.push(insertATGTestsCommand);

  // Command: vectorcastTestExplorer.insertATGTestsFromEditor////////////////////////////////////////////////////////
  const insertATGTestsFromEditorCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.insertATGTestsFromEditor",
    (arguments_: any) => {
      if (arguments_) {
        const testNode = buildTestNodeForFunction(arguments_);
        if (testNode) insertATGTests(testNode);
        else
          vscode.window.showErrorMessage(
            `Unable to create ATG Tests for function at line ${arguments_.lineNumber}`
          );
      }
    }
  );
  context.subscriptions.push(insertATGTestsFromEditorCommand);

  // Command: vectorcastTestExplorer.createTestScriptFromEditor////////////////////////////////////////////////////////
  // This is the callback for right clicks of the source editor flask+ icon
  const createTestScriptFromEditorCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.createTestScriptFromEditor",
    (arguments_: any) => {
      if (arguments_) {
        const testNode = buildTestNodeForFunction(arguments_);
        if (testNode) newTestScript(testNode);
        else
          vscode.window.showErrorMessage(
            `Unable to create test script for function at line ${arguments_.lineNumber}`
          );
      }
    }
  );
  context.subscriptions.push(createTestScriptFromEditorCommand);

  // Command: vectorcastTestExplorer.deleteTest ////////////////////////////////////////////////////////
  const deleteTestCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.deleteTest",
    (...nodeList: any) => {
      // Adding the ... to nodeList, results in us getting a list of selected tests!
      if (nodeList) {
        // Add a confirmation step if the user has selected multiple tests, or
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
  const editTestScriptCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.editTestScript",
    (arguments_: any) => {
      if (arguments_) {
        openTestScript(arguments_.id);
      }
    }
  );
  context.subscriptions.push(editTestScriptCommand);

  // Command: vectorcastTestExplorer.editCodedTest////////////////////////////////////////////////////////
  const editCodedTestCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.editCodedTest",
    (arguments_: any) => {
      if (arguments_) {
        const testNode: testNodeType = getTestNode(arguments_.id);
        openCodedTest(testNode);
      }
    }
  );
  context.subscriptions.push(editCodedTestCommand);

  // Command: vectorcastTestExplorer.loadTestScript////////////////////////////////////////////////////////
  const loadTestScriptCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.loadTestScript",
    () => {
      loadTestScript();
    }
  );
  context.subscriptions.push(loadTestScriptCommand);

  // Command: vectorcastTestExplorer.debugEnviroPath ////////////////////////////////////////////////////////
  // this command is used to return the path to the environment being debugged via
  // the variable: vectorcastTestExplorer.debugEnviroPath that is used in launch.json
  const debugEnviroPathCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.debugEnviroPath",
    () => {
      return pathToEnviroBeingDebugged;
    }
  );
  context.subscriptions.push(debugEnviroPathCommand);

  // Command: vectorcastTestExplorer.debugProgramPath ////////////////////////////////////////////////////////
  // this command is used to return the path to the environment being debugged via
  // the variable: vectorcastTestExplorer.debugProgramPath that is used in launch.json
  const debugProgramPathCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.debugProgramPath",
    () => {
      return pathToProgramBeingDebugged;
    }
  );
  context.subscriptions.push(debugProgramPathCommand);

  // Command: vectorcastTestExplorer.showSettings
  vscode.commands.registerCommand("vectorcastTestExplorer.showSettings", () => {
    showSettings();
  });

  // Command: vectorcastTestExplorer.addLaunchConfiguration ////////////////////////////////////////////////////////
  const addLaunchConfigurationCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.addLaunchConfiguration",
    (arguments_: Uri, argumentList: Uri[]) => {
      // Arg is the actual item that the right click happened on, argList is the list
      // of all items if this is a multi-select.  Since argList is always valid, even for a single
      // selection, we just use this here.
      if (argumentList) {
        // Find the list item that contains launch.json
        for (const element of argumentList) {
          if (element.fsPath.includes(launchFile)) {
            addLaunchConfiguration(element, globalPathToSupportFiles);
          }
        }
      } else {
        // If the arglist is undefined, this might be a right click action in the editor
        const activeEditor = vscode.window.activeTextEditor;
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
  const addIncludePathCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.addIncludePath",
    (arguments_: Uri, argumentList: Uri[]) => {
      // Arg is the actual item that the right click happened on, argList is the list
      // of all items if this is a multi-select.  Since argList is always valid, even for a single
      // selection, we just use this here.
      if (argumentList) {
        // Find the list item that contains c_cpp_properties.json
        for (const element of argumentList) {
          if (element.fsPath.includes(configurationFile)) {
            addIncludePath(element);
          }
        }
      } else {
        // If the arglist is undefined, this might be a right click action in the editor
        const activeEditor = vscode.window.activeTextEditor;
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
  const addSettingsTFileFilterCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.addSettingsFileFilter",
    (arguments_: Uri, argumentList: Uri[]) => {
      // Arg is the actual item that the right click happened on, argList is the list
      // of all items if this is a multi-select.  Since argList is always valid, even for a single
      // selection, we just use this here.
      if (argumentList) {
        addSettingsFileFilter(argumentList[0], globalPathToSupportFiles);
      }
    }
  );
  context.subscriptions.push(addSettingsTFileFilterCommand);

  // Command: vectorcastTestExplorer.openVCAST  ////////////////////////////////////////////////////////
  const openVCAST = vscode.commands.registerCommand(
    "vectorcastTestExplorer.openVCAST",
    (enviroNode: any) => {
      vectorMessage("Starting VectorCAST ...");
      openVcastFromEnviroNode(enviroNode.id, updateDataForEnvironment);
    }
  );
  context.subscriptions.push(openVCAST);

  // Command: vectorcastTestExplorer.openVCASTFromVce  ////////////////////////////////////////////////////////
  const openVCASTFromVce = vscode.commands.registerCommand(
    "vectorcastTestExplorer.openVCASTFromVce",
    (argument: any) => {
      vectorMessage("Starting VectorCAST ...");
      openVcastFromVCEfile(argument.fsPath, updateDataForEnvironment);
    }
  );
  context.subscriptions.push(openVCASTFromVce);

  // Command: vectorcastTestExplorer.buildEnviroFromEnv ////////////////////////////////////////////////////////
  const buildEnviroVCASTCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.buildEnviroFromEnv",
    (argument: Uri) => {
      // Arg is the URI of the .env file that was clicked
      if (argument) {
        const envFilepath = argument.fsPath;
        const buildDirectory = path.dirname(envFilepath);
        const enviroFilename = path.basename(envFilepath);
        const enviroName = getEnviroNameFromFile(envFilepath);
        if (enviroName) {
          if (fs.existsSync(path.join(buildDirectory, enviroName))) {
            vscode.window.showErrorMessage(
              `Environment: ${enviroName} already exists`
            );
          } else {
            buildEnvironmentFromScript(
              buildDirectory,
              enviroFilename.split(".")[0]
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
  const rebuildEnviro = vscode.commands.registerCommand(
    "vectorcastTestExplorer.rebuildEnviro",
    (enviroNode: any) => {
      // This returns the full path to the environment directory
      const enviroPath = getEnviroPathFromID(enviroNode.id);

      const fullCommand = rebuildEnvironmentCommand(enviroPath);
      const commandPieces = fullCommand.split(" ");
      const commandVerb = commandPieces[0];
      commandPieces.shift();

      const unitTestLocation = path.dirname(enviroPath);
      setCodedTestOption(unitTestLocation);

      // This uses the python binding to clicast to do the rebuild
      // We open the message pane to give the user a sense of what's going on
      openMessagePane();
      executeWithRealTimeEcho(
        commandVerb,
        commandPieces,
        unitTestLocation,
        rebuildEnvironmentCallback,
        enviroPath
      );
    }
  );
  context.subscriptions.push(rebuildEnviro);

  // Command: vectorcastTestExplorer.deleteEnviro  ////////////////////////////////////////////////////////
  const deleteEnviro = vscode.commands.registerCommand(
    "vectorcastTestExplorer.deleteEnviro",
    (enviroNode: any) => {
      // This returns the full path to the environment directory
      const enviroPath = getEnviroPathFromID(enviroNode.id);

      // Always ask for confirmation before deleting an environment
      const message =
        "Environment: " +
        enviroPath +
        " will be deleted, and this action cannot be undone.";
      vscode.window
        .showInformationMessage(message, "Delete", "Cancel")
        .then((answer) => {
          if (answer === "Delete") {
            // Execute a clicast call to delete the test
            deleteEnvironment(enviroPath, enviroNode.id);
          }
        });
    }
  );
  context.subscriptions.push(deleteEnviro);

  // Command: vectorcastTestExplorer.setDefaultConfigFile////////////////////////////////////////////////////////
  const selectDefaultConfigFile = vscode.commands.registerCommand(
    "vectorcastTestExplorer.setDefaultConfigFile",
    (fileURI: any) => {
      // We will only get here if the user has selected a CCAST_.CFG file
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
    (e) => {
      resetCoverageData();
      buildTestPaneContents();
      updateCOVdecorations();
    },
    null,
    context.subscriptions
  );

  vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      if (editor) {
        updateDisplayedCoverage();
        updateTestDecorator();
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
    (editor) => {
      // Changing the file will invalidate the
      // coverage and editor annotations
      if (editor) {
        updateCodedTestCases(editor);
        updateCOVdecorations();
        updateTestDecorator();
      }
    },
    null,
    context.subscriptions
  );
}

function installPreActivationEventHandlers(context: vscode.ExtensionContext) {
  // This is separate from configureExtension() because we want to
  // handle some actions before the configuration of the extension is complete
  // Specifically for the case where the user does a create environment action
  // and vcast installation is invalid.

  // Note: there is no existing API to do variable subsctitution for configuration
  // values that could contain things like ${workspaceFolder} so we don't provide support.
  // Here is a starting point for research: https://github.com/microsoft/vscode/issues/46471

  vscode.workspace.onDidChangeConfiguration((event) => {
    // Post configuration, we handle changes to all options ...
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
        event.affectsConfiguration(
          "vectorcastTestExplorer.vectorcastInstallationLocation"
        ) && // If the user changes the path to vcast, we need to reset the values
        // for clicast and vpython path etc.
        checkIfInstallationIsOK()
      ) {
        resetCoverageData();
        buildTestPaneContents();
        updateCOVdecorations();
      }
    }
    // Pre-configuration, we only handle changes to the vcast installation location
    else if (
      event.affectsConfiguration(
        "vectorcastTestExplorer.vectorcastInstallationLocation"
      )
    ) {
      // This call will check if the new value is valid,
      // and if so, perform extension activation
      checkPrerequisites(context);
    }
  });

  // Command: vectorcastTestExplorer.newEnviroVCAST ////////////////////////////////////////////////////////
  const newEnviroVCASTCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.newEnviroVCAST",
    (arguments_: Uri, argumentList: Uri[]) => {
      // Contains a check for already configured, so no work will be done in that case
      checkPrerequisites(context);
      if (
        alreadyConfigured && // Arg is the actual item that the right click happened on, argList is the list
        // of all items if this is a multi-select.  Since argList is always valid, even for a single
        // selection, we just use this here.
        argumentList
      ) {
        newEnvironment(argumentList);
      }
    }
  );
  context.subscriptions.push(newEnviroVCASTCommand);
}

// This method is called when your extension is deactivated
export function deactivate() {
  console.log("The VectorCAST Test Explorer has been de-activated");
  return deactivateLanguageServerClient();
}
