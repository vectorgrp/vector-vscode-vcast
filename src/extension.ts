import * as vscode from "vscode";
import { Uri } from "vscode";

import {
  activateLanguageServerClient,
  deactivateLanguageServerClient,
} from "./client";
import {
  initializeCodeCoverageFeatures,
  createCoverageStatusBar,
  toggleCoverageAction,
  updateDisplayedCoverage,
  updateCOVdecorations,
} from "./coverage";
import {
  initializeTestDecorator,
  updateTestDecorator,
} from "./editorDecorator";
import {
  deleteEnvironmentCallback,
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
import { getEnviroNameFromID, getEnviroPathFromID } from "./testData";
import {
  activateTestPane,
  pathToEnviroBeingDebugged,
  loadTestScript,
  openTestScript,
  buildTestPaneContents,
} from "./testPane";
import {
  deleteTests,
  newEnvironment,
  newTestScript,
  resetCoverageData,
} from "./vcastTestInterface";
import {
  addLaunchConfiguration,
  addSettingsFileFilter,
  checkIfInstallationIsOK,
  executeClicastCommand,
  initializeInstallerFiles,
  vcastCommandtoUse,
} from "./utilities";

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

  // initialize the test pane
  activateTestPane(context);

  // initialize the gutter decorator for testable functions
  initializeTestDecorator (context);

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
  let createTestScriptCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.createTestScript",
    (args: any) => {
      if (args) {
        newTestScript(args.id);
      }
    }
  );
  context.subscriptions.push(createTestScriptCommand);


    // Command: vectorcastTestExplorer.createTestScriptForLine////////////////////////////////////////////////////////
    let createTestScriptForLineCommand = vscode.commands.registerCommand(
      "vectorcastTestExplorer.createTestScriptForLine",
      (args: any) => {
        if (args) {
          // TBD - TODAY - Convert args to what newTestScript wants
          newTestScript(args.id);
        }
      }
    );
    context.subscriptions.push(createTestScriptForLineCommand);

  // Command: vectorcastTestExplorer.deleteTest ////////////////////////////////////////////////////////
  let deleteTestCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.deleteTest",
    (...args: any) => {
      // adding the ... to args, results in us getting a list of selected tests!
      if (args) {
        deleteTests(args);
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
        updateDataForEnvironment,
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

  vscode.workspace.onDidSaveTextDocument(
    (editor) => {
      // changing the file might invalidate the coverage
      if (editor) {
        updateCOVdecorations();
      }
    },
    null,
    context.subscriptions
  );

  vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("vectorcastTestExplorer.decorateExplorer")) {
      updateExploreDecorations();
    }
    if (event.affectsConfiguration("vectorcastTestExplorer.verboseLogging")) {
      adjustVerboseSetting();
    }
    if (
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
