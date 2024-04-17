// This module contains all interactions with a VectorCAST environment via clicast or vcastqt

import * as vscode from "vscode";

import { execSync, spawn } from "child_process";

import {
  buildEnvironmentCallback,
  deleteEnvironmentCallback,
} from "./callbacks";
import { openMessagePane, vectorMessage } from "./messagePane";
import {
  getClicastArgsFromTestNode,
  getClicastArgsFromTestNodeAsList,
  getEnviroNameFromID,
  getEnviroPathFromID,
  getTestNode,
  testNodeType,
} from "./testData";

import {
  commandStatusType,
  executeClicastCommandUsingServer,
  executeClicastWithProgress,
  executeCommandSync,
  executeVPythonScript,
  executeWithRealTimeEcho,
  getJsonDataFromTestInterface,
} from "./vcastCommandRunner";

import {
  atgCommandToUse,
  clicastCommandToUse,
  vcastCommandToUse,
} from "./vcastInstallation";

import {
  getVcastInterfaceCommand,
  getRebuildEnviroCommand,
} from "./vcastUtilities";

import {
  clientRequestType,
  closeConnection,
  transmitCommand,
  transmitResponseType,
  vcastCommandType,
} from "../src-common/vcastServer";

// This is the core extension version of the flag, set on
// initialization or when the setting value is changed.
export let globalEnviroServerActive: boolean = false;

const path = require("path");

// ------------------------------------------------------------------------------------
// Direct clicast Calls
// ------------------------------------------------------------------------------------

// Check License - no server logic needed --------------------------------------------
export function vcastLicenseOK(): boolean {
  const commandToRun = `${clicastCommandToUse} tools has_license`;
  let commandStatus: commandStatusType = executeCommandSync(
    commandToRun,
    process.cwd(),
    false
  );
  return commandStatus.errorCode == 0;
}

// Build Environment - no server logic neeeded ----------------------------------------
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

// Delete Environment - server logic included -----------------------------------------
export async function deleteEnvironment(
  enviroPath: string,
  enviroNodeID: string
) {
  const enclosingDirectory = path.dirname(enviroPath);

  // if we are in server mode, close any existing connection to the environment
  if (globalEnviroServerActive) await closeConnection(enviroPath);

  // this returns the environment directory name without any nesting
  let vcastArgs: string[] = ["-e" + getEnviroNameFromID(enviroNodeID)];
  vcastArgs.push("enviro"); // Generate Basis Path Tests Script and Load into Environment (via callback)

  vcastArgs.push("delete");
  executeWithRealTimeEcho(
    clicastCommandToUse,
    vcastArgs,
    enclosingDirectory,
    deleteEnvironmentCallback,
    enviroNodeID
  );
}

// Load Test Script - server logic included -----------------------------------------
export async function loadTestScriptIntoEnvironment(
  enviroName: string,
  scriptPath: string
) {
  // call clicast to load the test script
  let loadScriptArgs: string = `-e${enviroName} test script run ${scriptPath}`;

  let commandStatus: commandStatusType;
  // using server ....
  if (globalEnviroServerActive) {
    const enviroPath = path.join(path.dirname(scriptPath), enviroName);
    commandStatus = await executeClicastCommandUsingServer(
      clicastCommandToUse,
      enviroPath,
      loadScriptArgs
    );
  } else {
    commandStatus = executeCommandSync(
      `${clicastCommandToUse} ${loadScriptArgs}`,
      path.dirname(scriptPath)
    );
  }

  // if the script load fails, executeCommandSync or executeClicastCommand
  // will open the message pane.  If the load passes, we want to give the
  // user an indication that it worked ...
  if (commandStatus.errorCode == 0) {
    vectorMessage("Script loaded successfully ...");
    // Maybe this will be annoying to users, but I think
    // it's good to know when the load is complete.
    vscode.window.showInformationMessage(`Test script loaded successfully`);

    // this API allows a timeout for the message, but I think its too subtle
    // becuase it is only shown in the status bar
    //vscode.window.setStatusBarMessage  (`Test script loaded successfully`, 5000);
  }
}

// Delete Test Case - server logic included ---------------------------------------
export async function deleteSingleTest(
  testNodeID: string
): Promise<commandStatusType> {
  const testNode: testNodeType = getTestNode(testNodeID);
  const clicastArgs: string = getClicastArgsFromTestNode(testNode);
  let deleteTestArgs = `${clicastArgs} test delete`;

  // special vcast case for delete ALL tests for the environment
  // when no unit, subprogram or test is provided, you have to give YES to delete all
  if (testNode.unitName.length == 0 && testNode.functionName.length == 0) {
    deleteTestArgs += " YES";
  }

  // using server ....
  let commandStatus: commandStatusType;
  if (globalEnviroServerActive) {
    commandStatus = await executeClicastCommandUsingServer(
      clicastCommandToUse,
      testNode.enviroPath,
      deleteTestArgs
    );
  } else {
    commandStatus = executeCommandSync(
      `${clicastCommandToUse} ${deleteTestArgs}`,
      path.dirname(testNode.enviroPath)
    );
  }

  return commandStatus;
}

// Set Coded Test Option - no server logic needed -----------------------------------
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

// Add New or Existing Coded Test - server logic included ---------------------------
export enum codedTestAction {
  add = "add",
  new = "new",
}
export async function addCodedTestToEnvironment(
  enviroPath: string,
  testNode: testNodeType,
  action: codedTestAction,
  userFilePath: string
): Promise<commandStatusType> {
  //
  const enclosingDirectory = path.dirname(enviroPath);
  const clicastArgs = getClicastArgsFromTestNode(testNode);
  let codedTestArgs: string = `${clicastArgs} test coded ${action} ${userFilePath}`;

  let commandStatus: commandStatusType;
  if (globalEnviroServerActive) {
    commandStatus = await executeClicastCommandUsingServer(
      clicastCommandToUse,
      enviroPath,
      codedTestArgs
    );
  } else {
    commandStatus = executeCommandSync(
      `${clicastCommandToUse} ${codedTestArgs}`,
      enclosingDirectory
    );
  }

  // update the passed in testNode with the coded test file
  testNode.testFile = userFilePath;
  return commandStatus;
}

// Create Test Script - server logic included ----------------------------------------
export async function dumptestScriptFile(
  testNode: testNodeType,
  scriptPath: string
): Promise<commandStatusType> {
  const enclosingDirectory = path.dirname(testNode.enviroPath);
  const clicastArgs = getClicastArgsFromTestNode(testNode);
  let dumpScriptArgs: string = `${clicastArgs} test script create ${scriptPath}`;

  let commandStatus: commandStatusType;
  if (globalEnviroServerActive) {
    commandStatus = await executeClicastCommandUsingServer(
      clicastCommandToUse,
      testNode.enviroPath,
      dumpScriptArgs
    );
  } else {
    commandStatus = executeCommandSync(
      `${clicastCommandToUse} ${dumpScriptArgs}`,
      enclosingDirectory
    );
  }

  return commandStatus;
}

// Refresh Coded Test List From File - server logic included -------------------------
export async function refreshCodedTests(
  enviroPath: string,
  enviroNodeID: string
): Promise<commandStatusType> {
  // refresh the coded test file for this environment
  // note: the same file should never be associated with more than one unit

  const testNode = getTestNode(enviroNodeID);
  const enclosingDirectory = path.dirname(enviroPath);
  const clicastArgs = getClicastArgsFromTestNode(testNode);
  let refreshCodedArgs: string = `${clicastArgs} test coded refresh`;

  let commandStatus: commandStatusType;
  if (globalEnviroServerActive) {
    commandStatus = await executeClicastCommandUsingServer(
      clicastCommandToUse,
      enviroPath,
      refreshCodedArgs
    );
  } else {
    commandStatus = executeCommandSync(
      `${clicastCommandToUse} ${refreshCodedArgs}`,
      enclosingDirectory
    );
  }
  return commandStatus;
}

// Generate Basis Path Test Script and Load into Environment (via callback) ------------
// Server logic to close existing connection is included
export async function runBasisPathCommands(
  testNode: testNodeType,
  testScriptPath: string,
  loadScriptCallBack: any
) {
  // Execute Clicas tWith Progress() uses spawn() which needs the args as a list
  let argList: string[] = [];
  argList.push(`${clicastCommandToUse}`);
  argList = argList.concat(getClicastArgsFromTestNodeAsList(testNode));
  argList = argList.concat(["tool", "auto_test", `${testScriptPath}`]);

  // if we are in server mode, close any existing connection to the environment
  // because the time benefit of using the server for this is negligible and
  // getting a nice progress dialog would be impossible.
  const enviroPath = path.join(
    path.dirname(testScriptPath),
    testNode.enviroName
  );
  if (globalEnviroServerActive) await closeConnection(enviroPath);

  // Since it can be slow to generate basis path tests, we use a progress dialog
  // and since we don't want to show all of the stdout messages, we use a
  // regex filter for what to show
  const messageFilter = /.*Generating test cases for.*/;

  executeClicastWithProgress(
    "Generating Basis Path Tests: ",
    argList,
    testNode.enviroName,
    testScriptPath,
    messageFilter,
    loadScriptCallBack
  );
}

// ------------------------------------------------------------------------------------
// Direct ATG Call
// ------------------------------------------------------------------------------------

// Generate ATG Test Script and Load into Environment (via callback)
// Server logic to close existing connection is included
export async function runATGCommands(
  testNode: testNodeType,
  testScriptPath: string,
  loadScriptCallBack: any
) {
  // Execute Clicast With Progress() uses spawn() which needs the args as a list
  let argList: string[] = [];
  argList.push(`${atgCommandToUse}`);
  argList = argList.concat(getClicastArgsFromTestNodeAsList(testNode));

  // -F tells atg to NOT use regex for the -s (sub-program) option
  // since we always use the "full" sub-program name, we always set -F
  argList.push("-F");

  // if we are using over-loaded syntax, then we need to add the -P (parameterized) option
  if (testNode.functionName.includes("(")) {
    argList.push("-P");
  }
  argList.push(`${testScriptPath}`);

  // if we are in server mode, close any existing connection to the environment
  // because the time benefit of using the server for this is negligible and
  // getting a nice progress dialog would be impossible.
  const enviroPath = path.join(
    path.dirname(testScriptPath),
    testNode.enviroName
  );
  if (globalEnviroServerActive) await closeConnection(enviroPath);

  // Since it can be slow to generate ATG tests, we use a progress dialog
  // and since we don't want to show all of the stdout messages, we use a
  // regex filter for what to show
  const messageFilter = /Subprogram:.*/;

  executeClicastWithProgress(
    "Generating ATG Tests: ",
    argList,
    testNode.enviroName,
    testScriptPath,
    messageFilter,
    loadScriptCallBack
  );
}

// ------------------------------------------------------------------------------------
// Direct vcastqt Calls
// ------------------------------------------------------------------------------------

// Open vcastqt in options dialog mode - no server logic needed -----------------------
// In the future we might create a native VS Code dialog for this
export function openVcastOptionsDialog(cwd: string) {
  execSync(`${vcastCommandToUse} -lc -o`, { cwd: cwd });
}

// Open VectorCAST for an environment directory --------------------------------------
// Server logic to close existing connection is included
export async function openVcastFromEnviroNode(
  enviroNodeID: string,
  callback: any
) {
  // this returns the environment directory name without any nesting
  let vcastArgs: string[] = ["-e " + getEnviroNameFromID(enviroNodeID)];

  // this returns the full path to the environment directory
  const enviroPath = getEnviroPathFromID(enviroNodeID);
  const enclosingDirectory = path.dirname(enviroPath);

  // close any existing clicast connection to this environment
  if (globalEnviroServerActive) await closeConnection(enviroPath);

  // we use spawn directly to control the detached and shell args
  let vcast = spawn(vcastCommandToUse, vcastArgs, {
    cwd: enclosingDirectory,
    detached: true,
    shell: true,
    windowsHide: true,
  });
  vcast.on("exit", function (code: any) {
    callback(enviroPath);
  });
}

// Open VectorCAST for a .vce file ---------------------------------------------------
// Server logic to close existing connection is included
export async function openVcastFromVCEfile(vcePath: string, callback: any) {
  // split vceFile path into the CWD and the Environment
  const vceFilename = path.basename(vcePath);
  let vcastArgs: string[] = ["-e " + vceFilename];

  var dotIndex = vcePath.lastIndexOf(".");
  const enviroPath = vcePath.slice(0, dotIndex);

  const enclosingDirectory = path.dirname(vcePath);

  // close any existing clicast connection to this environment
  if (globalEnviroServerActive) await closeConnection(enviroPath);

  // we use spawn directly to control the detached and shell args
  let vcast = spawn(vcastCommandToUse, vcastArgs, {
    cwd: enclosingDirectory,
    detached: true,
    shell: true,
    windowsHide: true,
  });
  vcast.on("exit", function (code: any) {
    callback(enviroPath);
  });
}

// ------------------------------------------------------------------------------------
// Direct vpython calls
// ------------------------------------------------------------------------------------

// Get Environment Data ---------------------------------------------------------------
function getEnviroDataFromPython(enviroPath: string): any {
  // This function will return the environment data for a single directory
  // by calling vpython with the appropriate command
  const commandToRun = getVcastInterfaceCommand(
    vcastCommandType.getEnviroData,
    enviroPath
  );
  let jsonData = getJsonDataFromTestInterface(commandToRun, enviroPath);
  return jsonData;
}

async function getEnviroDataFromServer(enviroPath: string): Promise<any> {
  //
  const requestObject: clientRequestType = {
    command: vcastCommandType.getEnviroData,
    clicast: clicastCommandToUse,
    path: enviroPath,
  };

  let transmitResponse: transmitResponseType = await transmitCommand(
    requestObject
  );
  if (transmitResponse.success) {
    return transmitResponse.returnData;
  } else {
    vectorMessage(transmitResponse.statusText);
    return undefined;
  }
}

export async function getDataForEnvironment(enviroPath: string): Promise<any> {
  // what we get back is a JSON formatted string (if the command works)
  // that has two sub-fields: testData, and unitData
  vectorMessage("Processing environment data for: " + enviroPath);

  let jsonData: any;
  if (globalEnviroServerActive) {
    jsonData = await getEnviroDataFromServer(enviroPath);
  } else {
    jsonData = getEnviroDataFromPython(enviroPath);
  }

  return jsonData;
}

// Execute Test ------------------------------------------------------------------------
export function executeTest(
  enviroPath: string,
  nodeID: string,
  generateReport: boolean
): commandStatusType {
  let commandToRun: string = "";
  if (generateReport) {
    commandToRun = getVcastInterfaceCommand(
      vcastCommandType.executeTestReport,
      enviroPath,
      nodeID
    );
  } else {
    commandToRun = getVcastInterfaceCommand(
      vcastCommandType.executeTest,
      enviroPath,
      nodeID
    );
  }
  const startTime: number = performance.now();
  const commandStatus = executeVPythonScript(commandToRun, enviroPath);

  // added this timing info to help with performance tuning - interesting to leave in
  const endTime: number = performance.now();
  const deltaString: string = ((endTime - startTime) / 1000).toFixed(2);
  vectorMessage(`Execution via vPython took: ${deltaString} seconds`);

  return commandStatus;
}

// Get Execution Report ----------------------------------------------------------------
export function getTestExecutionReport(
  testID: string,
  CWD: string
): commandStatusType {
  const commandToRun = getVcastInterfaceCommand(
    vcastCommandType.report,
    CWD,
    testID
  );
  const commandStatus: commandStatusType = executeVPythonScript(
    commandToRun,
    CWD
  );
  return commandStatus;
}

// Rebuild Environment -----------------------------------------------------------------
export function rebuildEnvironment(
  enviroPath: string,
  rebuildEnvironmentCallback: any
) {
  const fullCommand = getRebuildEnviroCommand(enviroPath);
  let commandPieces = fullCommand.split(" ");
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
