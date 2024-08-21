// This module contains all interactions with a VectorCAST environment via clicast or vcastqt

import * as vscode from "vscode";

import { execSync, spawn } from "child_process";

import {
  buildEnvironmentCallback,
  deleteEnvironmentCallback,
} from "./callbacks";
import { errorLevel, openMessagePane, vectorMessage } from "./messagePane";
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
  convertServerResponseToCommandStatus,
  executeClicastCommandUsingServer,
  executeCommandWithProgress,
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
  getClientRequestObject,
  getRebuildOptionsString,
  getVcastInterfaceCommand,
} from "./vcastUtilities";

import {
  clientRequestType,
  closeConnection,
  globalEnviroDataServerActive,
  serverIsAlive,
  setServerState,
  transmitCommand,
  transmitResponseType,
  vcastCommandType,
} from "../src-common/vcastServer";

const path = require("path");

export async function initializeServerState() {
  // This function is called during initialization to check if the enviro
  // data server is alive and if so configure the extension to use it

  // Set the client instance of the globalEnviroDataServerActive
  // flag if we can ping the server
  setServerState(await serverIsAlive());
  if (globalEnviroDataServerActive) {
    vectorMessage("VectorCAST Environment Data Server is Active ...");
  } else {
    vectorMessage("VectorCAST Environment Data Server is NOT Active ...");
  }
}

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
  if (globalEnviroDataServerActive) await closeConnection(enviroPath);

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
  if (globalEnviroDataServerActive) {
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
    // because it is only shown in the status bar
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
  if (globalEnviroDataServerActive) {
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
  if (globalEnviroDataServerActive) {
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
  if (globalEnviroDataServerActive) {
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

// Get CBT Test Names - server logic included ----------------------------------------
export async function getCBTNamesFromFile(
  filePath: string,
  enviroPath: string
): Promise<any> {
  // this function will return the CBT test names as a JSON object
  // containing a "tests" field that is a list of

  let returnData;
  if (globalEnviroDataServerActive) {
    const requestObject = getClientRequestObject(
      vcastCommandType.parseCBT,
      filePath
    );

    let transmitResponse: transmitResponseType =
      await transmitCommand(requestObject);

    if (transmitResponse.success && transmitResponse.returnData) {
      returnData = transmitResponse.returnData.data;
    } else {
      vectorMessage(transmitResponse.statusText);
      return undefined;
    }
  } else {
    const commandToRun = getVcastInterfaceCommand(
      vcastCommandType.parseCBT,
      filePath
    );
    returnData = getJsonDataFromTestInterface(commandToRun, enviroPath);
  }

  return returnData;
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
  if (globalEnviroDataServerActive) {
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
  if (globalEnviroDataServerActive) await closeConnection(enviroPath);

  // Since it can be slow to generate basis path tests, we use a progress dialog
  // and since we don't want to show all of the stdout messages, we use a
  // regex filter for what to show
  const messageFilter = /.*Generating test cases for.*/;
  const startOfRealMessages = "VectorCAST Copyright";

  executeCommandWithProgress(
    "Generating Basis Path Tests: ",
    argList,
    testNode.enviroName,
    testScriptPath,
    startOfRealMessages,
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
  if (globalEnviroDataServerActive) await closeConnection(enviroPath);

  // Since it can be slow to generate ATG tests, we use a progress dialog
  // and since we don't want to show all of the stdout messages, we use a
  // regex filter for what to show
  const messageFilter = /Subprogram:.*/;
  const startOfRealMessages = "Processing unit:";

  executeCommandWithProgress(
    "Generating ATG Tests: ",
    argList,
    testNode.enviroName,
    testScriptPath,
    startOfRealMessages,
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
  if (globalEnviroDataServerActive) await closeConnection(enviroPath);

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
  if (globalEnviroDataServerActive) await closeConnection(enviroPath);

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
// Server logic is in a separate function below
export async function getDataForEnvironment(enviroPath: string): Promise<any> {
  // what we get back is a JSON formatted string (if the command works)
  // that has two sub-fields: testData, and unitData
  vectorMessage("Processing environment data for: " + enviroPath);

  let jsonData: any;
  if (globalEnviroDataServerActive) {
    jsonData = await getEnviroDataFromServer(enviroPath);
  } else {
    jsonData = getEnviroDataFromPython(enviroPath);
  }

  return jsonData;
}

// vPython Logic
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

// Server Logic
async function getEnviroDataFromServer(enviroPath: string): Promise<any> {
  //
  const requestObject: clientRequestType = {
    command: vcastCommandType.getEnviroData,
    clicast: clicastCommandToUse,
    path: enviroPath,
  };

  let transmitResponse: transmitResponseType =
    await transmitCommand(requestObject);

  // tansmitResponse.returnData is an object with exitCode and data properties
  // for getEnviroData we might have a version missmatch if the enviro is newer
  // than the version of vcast we are using, so handle that here
  if (transmitResponse.success) {
    const returnData = transmitResponse.returnData;
    if (returnData.exitCode == 0) {
      return returnData.data;
    } else {
      vectorMessage(returnData.data.text.join("\n"));
      return undefined;
    }
  } else {
    await vectorMessage(transmitResponse.statusText);
    openMessagePane();
    return undefined;
  }
}

// Execute Test ------------------------------------------------------------------------
// Server logic is in a separate function below
export async function executeTest(
  enviroPath: string,
  nodeID: string
): Promise<commandStatusType> {
  //
  let vcastCommand: vcastCommandType = vcastCommandType.executeTest;

  let commandStatus: commandStatusType;
  const startTime: number = performance.now();
  if (globalEnviroDataServerActive) {
    commandStatus = await executeTestViaServer(
      vcastCommand,
      enviroPath,
      nodeID
    );
  } else {
    commandStatus = executeTestViaPython(vcastCommand, enviroPath, nodeID);
  }

  // added this timing info to help with performance tuning - interesting to leave in
  const endTime: number = performance.now();
  const deltaString: string = ((endTime - startTime) / 1000).toFixed(2);
  vectorMessage(`Execution of test took: ${deltaString} seconds (TS)`);

  return commandStatus;
}

// Server Logic
async function executeTestViaServer(
  vcastCommand: vcastCommandType,
  enviroPath: string,
  nodeID: string
): Promise<commandStatusType> {
  //
  const requestObject = getClientRequestObject(
    vcastCommand,
    enviroPath,
    nodeID
  );

  let transmitResponse: transmitResponseType =
    await transmitCommand(requestObject);

  return convertServerResponseToCommandStatus(transmitResponse);
}

// vPython Logic
function executeTestViaPython(
  vcastCommand: vcastCommandType,
  enviroPath: string,
  nodeID: string
): commandStatusType {
  //
  const commandToRun = getVcastInterfaceCommand(
    vcastCommand,
    enviroPath,
    nodeID
  );

  const commandStatus = executeVPythonScript(commandToRun, enviroPath, false);
  return commandStatus;
}

// Get Execution Report ----------------------------------------------------------------
// Server logic is in a separate function below
export async function getTestExecutionReport(
  enviroPath: string,
  testID: string
): Promise<commandStatusType> {
  if (globalEnviroDataServerActive) {
    return await getTestExecutionReportFromServer(testID, enviroPath);
  } else {
    return getTestExecutionReportFromPython(testID, enviroPath);
  }
}

// Server Logic
async function getTestExecutionReportFromServer(
  enviroPath: string,
  nodeID: string
): Promise<commandStatusType> {
  //
  const requestObject = getClientRequestObject(
    vcastCommandType.report,
    enviroPath,
    nodeID
  );

  let transmitResponse: transmitResponseType =
    await transmitCommand(requestObject);

  return convertServerResponseToCommandStatus(transmitResponse);
}

// python logic
function getTestExecutionReportFromPython(
  enviroPath: string,
  testID: string
): commandStatusType {
  //
  const commandToRun = getVcastInterfaceCommand(
    vcastCommandType.report,
    enviroPath,
    testID
  );
  const commandStatus: commandStatusType = executeVPythonScript(
    commandToRun,
    enviroPath
  );
  return commandStatus;
}

// Rebuild Environment -----------------------------------------------------------------
// Server logic is in a separate function below
export async function rebuildEnvironment(
  enviroPath: string,
  rebuildEnvironmentCallback: any
) {
  setCodedTestOption(path.dirname(enviroPath));

  if (globalEnviroDataServerActive) {
    rebuildEnvironmentUsingServer(enviroPath, rebuildEnvironmentCallback);
  } else {
    rebuildEnvironmentUsingPython(enviroPath, rebuildEnvironmentCallback);
  }
}

export async function rebuildEnvironmentUsingPython(
  enviroPath: string,
  rebuildEnvironmentCallback: any
) {
  // this returns a string including the vpython command
  const commandToRun = getVcastInterfaceCommand(
    vcastCommandType.rebuild,
    enviroPath
  );
  const optionString = `--options=${getRebuildOptionsString()}`;

  // executeWithRealTimeEcho uses spawn which needs an arg list so create list
  let commandPieces = commandToRun.split(" ");
  // add the option string
  commandPieces.push(optionString);
  // pop the first arg which is the vpython command
  const commandVerb = commandPieces[0];
  commandPieces.shift();

  const unitTestLocation = path.dirname(enviroPath);

  // This uses the python binding to clicast to do the rebuild
  // We open the message pane to give the user a sense of what's going on
  openMessagePane();
  vectorMessage (`Rebuilding environment command: ${commandVerb} ${commandPieces.join(" ")}`,errorLevel.trace);
  executeWithRealTimeEcho(
    commandVerb,
    commandPieces,
    unitTestLocation,
    rebuildEnvironmentCallback,
    enviroPath
  );
}

export async function rebuildEnvironmentUsingServer(
  enviroPath: string,
  rebuildEnvironmentCallback: any
) {
  const requestObject: clientRequestType = {
    command: vcastCommandType.rebuild,
    clicast: clicastCommandToUse,
    path: enviroPath,
    options: getRebuildOptionsString(),
  };

  // We don't know how long this will take, so we just
  // use a running rabbit style progress bar
  let transmitResponse = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Rebuilding environment: ${path.basename(enviroPath)}... `,
      cancellable: false,
    },
    async (progress): Promise<transmitResponseType> => {
      progress.report({ increment: 25 });
      let transmitResponse = await transmitCommand(requestObject);
      progress.report({ increment: 100 });
      return transmitResponse;
    }
  );

  const commandStatus = convertServerResponseToCommandStatus(transmitResponse);
  // in the server case, we cannot echo the rebuild output to the message pane
  // in real-time as we do in the Python case, so show it here!
  vectorMessage("-".repeat(100));
  vectorMessage(commandStatus.stdout);

  // call the callback to update the test explorer pane
  rebuildEnvironmentCallback(enviroPath, commandStatus.errorCode);
}
