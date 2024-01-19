import * as vscode from "vscode";
import { Uri } from "vscode";

import {
  activateLanguageServerClient,
  deactivateLanguageServerClient,
} from "./client";

import {
  updateConfigurationOption
} from "./configuration"

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
  deleteEnvironmentCallback,
  rebuildEnvironmentCallback,
  updateDataForEnvironment,
  showSettings,
} from "./helper";

import {
  openMessagePane,
  toggleMessageLog,
  adjustVerboseSetting,
  vectorMessage,
} from "./messagePane";

import { viewResultsReport } from "./reporting";

import { 
  getEnviroNameFromID, 
  getEnviroPathFromID, 
  getTestNode,
  testNodeType
} from "./testData";

import {
  activateTestPane,
  buildTestPaneContents,
  deleteTests,
  insertBasisPathTests,
  insertATGTests,
  loadTestScript,
  pathToEnviroBeingDebugged,
  updateCodedTestCases,
} from "./testPane";

import {
  addLaunchConfiguration,
  addSettingsFileFilter,
  checkIfInstallationIsOK,
  initializeInstallerFiles,
} from "./utilities";

import {
  buildEnvironmentFromScript,
  newCodedTest,
  newEnvironment,
  newTestScript,
  openCodedTest,
  resetCoverageData,
} from "./vcastTestInterface";

import {
  executeClicastCommand,
  openTestScript,
  vcastCommandtoUse,
} from "./vcastUtilities";


import { updateExploreDecorations } from "./fileDecorator";

const spawn = require("child_process").spawn;
const path = require("path");
let messagePane: vscode.OutputChannel = vscode.window.createOutputChannel(
  "VectorCAST Test Explorer"
);

export function getMessagePane(): vscode.OutputChannel {
  return messagePane;
}
export async function activate(context: vscode.ExtensionContext) {
  // activation gets called when vectorcastTestExplorer.configure is called
  // currently from the ctrl-p menu,

  // dummy command to be used for activation
  vscode.commands.registerCommand("vectorcastTestExplorer.configure", () => {
    checkPrerequisites(context);
  });
  vscode.commands.registerCommand("vectorcastTestExplorer.toggleLog", () =>
    toggleMessageLog()
  );
  checkPrerequisites(context);
}

let alreadyConfigured: boolean = false;
export function checkPrerequisites(context: vscode.ExtensionContext) {
  if (!alreadyConfigured) {
    
    // setup the location of vTestInterface.py and other utilities
    initializeInstallerFiles(context);

    if (checkIfInstallationIsOK()) {
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

function activationLogic(context: vscode.ExtensionContext) {
  // adds all of the command handlers
  configureExtension(context);

  // setup the decorations for coverage
  initializeCodeCoverageFeatures(context);

  // initialize the gutter decorator for testable functions
  initializeTestDecorator(context);

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
        newCodedTest(args.id);
      }
    }
  );
  context.subscriptions.push(addCodedTestsCommand);

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
        const testNode = buildTestNodeForFunction (args);
        if (testNode)
          insertBasisPathTests(testNode);
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
        const testNode = buildTestNodeForFunction (args);
        if (testNode)
          insertATGTests(testNode);
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
        const testNode = buildTestNodeForFunction (args);
        if (testNode)
          newTestScript(testNode);
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
        }
        else {
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
        addLaunchConfiguration(argList[0]);
      }
    }
  );
  context.subscriptions.push(addLaunchConfigurationCommand);

  // Command: vectorcastTestExplorer.addSettingsFileFilter ////////////////////////////////////////////////////////
  let addSettingsTFileFilterCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.addSettingsFileFilter",
    (args: Uri, argList: Uri[]) => {
      // arg is the actual item that the right click happened on, argList is the list
      // of all items if this is a multi-select.  Since argList is always valid, even for a single
      // selection, we just use this here.
      if (argList) {
        addSettingsFileFilter(argList[0]);
      }
    }
  );
  context.subscriptions.push(addSettingsTFileFilterCommand);

  // Command: vectorcastTestExplorer.openVCAST  ////////////////////////////////////////////////////////
  let openVCAST = vscode.commands.registerCommand(
    "vectorcastTestExplorer.openVCAST",
    (enviroNode: any) => {
      // this returns the environment directory name without any nesting
      let vcastArgs: string[] = ["-e " + getEnviroNameFromID(enviroNode.id)];
      // this returns the full path to the environment directory
      const enviroPath = getEnviroPathFromID(enviroNode.id);
      const enclosingDirectory = path.dirname(enviroPath);

      vectorMessage("Starting VectorCAST ...");

      const commandToRun = vcastCommandtoUse;
      // we use spawn directly to control the detached and shell args
      let vcast = spawn(commandToRun, vcastArgs, {
        cwd: enclosingDirectory,
        detached: true,
        shell: true,
        windowsHide: true,
      });
      vcast.on("exit", function (code: any) {
        updateDataForEnvironment(enviroPath);
      });
    }
  );
  context.subscriptions.push(openVCAST);


    // Command: vectorcastTestExplorer.openVCASTFromVce  ////////////////////////////////////////////////////////
    let openVCASTFromVce = vscode.commands.registerCommand(
      "vectorcastTestExplorer.openVCASTFromVce",
      (arg: any) => {
        // split vceFile path into the CWD and the Environame
        const vcePath = arg.fsPath;
        const cwd = path.dirname (vcePath);
        const enviroName = path.basename (vcePath);
        let vcastArgs: string[] = ["-e " + enviroName];
  
        vectorMessage("Starting VectorCAST ...");
  
        const commandToRun = vcastCommandtoUse;
        // we use spawn directly to control the detached and shell args
        let vcast = spawn(commandToRun, vcastArgs, {
          cwd: cwd,
          detached: true,
          shell: true,
          windowsHide: true,
        });
        vcast.on("exit", function (code: any) {
          updateDataForEnvironment(vcePath.split (".")[0]);
        });
      }
    );
    context.subscriptions.push(openVCASTFromVce);

  // Command: vectorcastTestExplorer.newEnviroVCAST ////////////////////////////////////////////////////////
  let newEnviroVCASTCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.newEnviroVCAST",
    (args: Uri, argList: Uri[]) => {
      // arg is the actual item that the right click happened on, argList is the list
      // of all items if this is a multi-select.  Since argList is always valid, even for a single
      // selection, we just use this here.
      if (argList) {
        newEnvironment(argList);
      }
    }
  );
  context.subscriptions.push(newEnviroVCASTCommand);

  // Command: vectorcastTestExplorer.buildEnviroFromEnv ////////////////////////////////////////////////////////
  let buildEnviroVCASTCommand = vscode.commands.registerCommand("vectorcastTestExplorer.buildEnviroFromEnv",(arg: Uri) => {
      // arg is the URI of the .env file that was clicked
      if (arg) {
        const envFilepath = arg.fsPath;
        const directory = path.dirname(envFilepath);
        const enviroName = path.basename(envFilepath);
        buildEnvironmentFromScript (directory, enviroName.split (".")[0]);
      }
    });
  context.subscriptions.push(buildEnviroVCASTCommand);


  // Command: vectorcastTestExplorer.rebuildEnviro  ////////////////////////////////////////////////////////
  let rebuildEnviro = vscode.commands.registerCommand(
    "vectorcastTestExplorer.rebuildEnviro",
    (enviroNode: any) => {
      // this returns the full path to the environment directory
      const enviroPath = getEnviroPathFromID(enviroNode.id);
      const enclosingDirectory = path.dirname(enviroPath);

      // this returns the environment directory name without any nesting
      let vcastArgs: string[] = ["-e" + getEnviroNameFromID(enviroNode.id)];
      vcastArgs.push("enviro");
      vcastArgs.push("re_build");
      // This is long running commands so we open the message pane to give the user a sense of what is going on.
      openMessagePane();
      executeClicastCommand(
        vcastArgs,
        enclosingDirectory,
        rebuildEnvironmentCallback,
        enviroPath
      );
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
            const enclosingDirectory = path.dirname(enviroPath);

            // this returns the environment directory name without any nesting
            let vcastArgs: string[] = [
              "-e" + getEnviroNameFromID(enviroNode.id),
            ];
            vcastArgs.push("enviro");
            vcastArgs.push("delete");
            executeClicastCommand(
              vcastArgs,
              enclosingDirectory,
              deleteEnvironmentCallback,
              enviroNode.id
            );
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
          const settings = vscode.workspace.getConfiguration("vectorcastTestExplorer");
          settings.update ("configurationLocation", fileURI.fsPath, vscode.ConfigurationTarget.Workspace);
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
        updateTestDecorator ();
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
      // changing the file will invalidate the 
      // coverage and editor annotations
      if (editor) {
        updateCodedTestCases (editor);
        updateCOVdecorations();
        updateTestDecorator ();
      }
    },
    null,
    context.subscriptions
  );


  vscode.workspace.onDidChangeConfiguration((event) => {
    // This function gets triggered when any option at any level (user, workspace, etc.)
    // gets changed.  The event parameter does not indicate what level has been
    // edited but you can use the 

    if (event.affectsConfiguration("vectorcastTestExplorer.decorateExplorer")) {
      updateExploreDecorations();
    }
    else if (event.affectsConfiguration("vectorcastTestExplorer.verboseLogging")) {
      adjustVerboseSetting();
    }
    else if (event.affectsConfiguration("vectorcastTestExplorer.configurationLocation")){
      updateConfigurationOption (event);
    }
    else if (
      event.affectsConfiguration(
        "vectorcastTestExplorer.vectorcastInstallationLocation"
      )
    ) {
      // if the user changes the path to vcast, we need to reset the values
      // for clicast and vpython path etc.
      if (checkIfInstallationIsOK()) {
        resetCoverageData();
        buildTestPaneContents();
        updateCOVdecorations();
      }
    }
  });
}

// this method is called when your extension is deactivated
export function deactivate() {
  console.log("The VectorCAST Test Explorer has been de-activated");
  return deactivateLanguageServerClient();
}
