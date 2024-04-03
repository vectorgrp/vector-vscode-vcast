// This module contains all interactions with a VectorCAST environment via clicast or vpython
// The functions are organized alpabetically by the command

import * as vscode from "vscode";

import { buildEnvironmentCallback, deleteEnvironmentCallback } from "./helper";
import { openMessagePane, vectorMessage } from "./messagePane";

import { getEnviroNameFromID, getTestNode, testNodeType } from "./testData";
import { commandStatusType, executeCommandSync } from "./utilities";

import {
  clicastCommandToUse,
  executeWithRealTimeEcho,
  getClicastArgsFromTestNode,
} from "./vcastUtilities";

const path = require("path");

// Delete Environment
export function deleteEnvironment(enviroPath: string, enviroNodeID: string) {
  const enclosingDirectory = path.dirname(enviroPath);

  // this returns the environment directory name without any nesting
  let vcastArgs: string[] = ["-e" + getEnviroNameFromID(enviroNodeID)];
  vcastArgs.push("enviro");
  vcastArgs.push("delete");
  executeWithRealTimeEcho(
    clicastCommandToUse,
    vcastArgs,
    enclosingDirectory,
    deleteEnvironmentCallback,
    enviroNodeID
  );
}

// Delete Test Case
export function deleteSingleTest(testNodeID: string): commandStatusType {
  const testNode: testNodeType = getTestNode(testNodeID);
  const clicastArgs: string = getClicastArgsFromTestNode(testNode);
  let commandToRun = `${clicastCommandToUse} ${clicastArgs} test delete`;

  // special vcast case for delete ALL tests for the environment
  // when no unit, subprogram or test is provided, you have to give YES to delete all
  if (testNode.unitName.length == 0 && testNode.functionName.length == 0) {
    commandToRun += " YES";
  }

  let commandStatus: commandStatusType = executeCommandSync(
    commandToRun,
    path.dirname(testNode.enviroPath)
  );

  return commandStatus;
}

// Refresh Coded Test List From File
export function refreshCodedTests(
  enviroPath: string,
  enviroNodeID: string
): commandStatusType {
  // refresh the coded test file for this environment
  // note: the same file should never be associated with more than one unit

  const testNode = getTestNode(enviroNodeID);
  const enclosingDirectory = path.dirname(enviroPath);

  let commandToRun: string = `${clicastCommandToUse} ${getClicastArgsFromTestNode(
    testNode
  )} test coded refresh`;
  const refreshCommandStatus = executeCommandSync(
    commandToRun,
    enclosingDirectory
  );
  return refreshCommandStatus;
}

// Build Environment
export function buildEnvironmentFromScript(
  unitTestLocation: string,
  enviroName: string
) {
  // this function is separate and exported because it's used when we
  // create environments from source files and from .env files

  // this call runs clicast in the background
  const enviroPath = path.join(unitTestLocation, enviroName);
  const clicastArgs = ["-lc", "env", "build", enviroName + ".env"];
  // This is long running commands so we open the message pane to give the user a sense of what is going on.
  openMessagePane();
  executeWithRealTimeEcho(
    clicastCommandToUse,
    clicastArgs,
    unitTestLocation,
    buildEnvironmentCallback,
    enviroPath
  );
}

// Check License
export function vcastLicenseOK(): boolean {
  const commandToRun = `${clicastCommandToUse} tools has_license`;
  let commandStatus: commandStatusType = executeCommandSync(
    commandToRun,
    process.cwd(),
    false
  );
  return commandStatus.errorCode == 0;
}

// Set Coded Test Option
export function setCodedTestOption(unitTestLocation: string) {
  // This gets called before every build and rebuild environment
  // to make sure that the CFG file has the right value for coded testing.
  // This is easier than keeping track of n CFG files and their values
  // and I think that the coded test option will be removed soon.

  const settings = vscode.workspace.getConfiguration("vectorcastTestExplorer");
  if (settings.get("build.enableCodedTesting", false)) {
    // force the coded test option on
    executeCommandSync(
      `${clicastCommandToUse} option VCAST_CODED_TESTS_SUPPORT true`,
      unitTestLocation
    );
  } else {
    // force the coded test option off
    executeCommandSync(
      `${clicastCommandToUse} option VCAST_CODED_TESTS_SUPPORT false`,
      unitTestLocation
    );
  }
}

// Add New or Existing Coded Test File to Environment based on action
export enum codedTestAction {
  add = "add",
  new = "new",
}
export function addCodedTestToEnvironment(
  enviroPath: string,
  testNode: testNodeType,
  action: codedTestAction,
  userFilePath: string
): commandStatusType {
  const enclosingDirectory = path.dirname(enviroPath);

  let commandToRun: string = `${clicastCommandToUse} ${getClicastArgsFromTestNode(
    testNode
  )} test coded ${action}} ${userFilePath}`;

  const commandStatus = executeCommandSync(commandToRun, enclosingDirectory);
  return commandStatus;
}

// Dump the Test Script from an Environment
export function dumptestScriptFile(
  testNode: testNodeType,
  scriptPath: string
): commandStatusType {
  const enclosingDirectory = path.dirname(testNode.enviroPath);
  const clicastArgs = getClicastArgsFromTestNode(testNode);

  let commandToRun: string = `${clicastCommandToUse} ${clicastArgs} test script create ${scriptPath}`;
  const commandStatus = executeCommandSync(commandToRun, enclosingDirectory);

  return commandStatus;
}

// Load the Test Script into the Environment
export async function loadScriptIntoEnvironment(
  enviroName: string,
  scriptPath: string
) {
  // call clicast to load the test script
  const enviroArg = `-e${enviroName}`;
  let commandToRun: string = `${clicastCommandToUse} ${enviroArg} test script run ${scriptPath}`;

  const commandStatus = executeCommandSync(
    commandToRun,
    path.dirname(scriptPath)
  );

  // if the script load fails, executeCommandSync will open the message pane ...
  // if the load passes, we want to give the user an indication that it worked
  if (commandStatus.errorCode == 0) {
    vectorMessage("Script loaded successfully ...");
    // Maybe this will be annoying to users, but I think
    // it's good to know when the load is complete.
    vscode.window.showInformationMessage(`Test script loaded successfully`);

    // this API allows a timeout for the message, but I think its too subtle
    //vscode.window.setStatusBarMessage  (`Test script loaded successfully`, 5000);
  }
}


