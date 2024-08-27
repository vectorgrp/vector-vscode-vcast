import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver-types";

import {
  clientRequestType,
  globalEnviroDataServerActive,
  setServerState,
  transmitCommand,
  transmitResponseType,
  vcastCommandType,
} from "../src-common/vcastServer";

import fs = require("fs");
import path = require("path");

import { execSync } from "child_process";
import { cleanVPythonOutput } from "../src-common/commonUtilities";
import { getDiagnosticObject } from "./tstValidation";

let testEditorScriptPath: string | undefined = undefined;
let vPythonCommandToUse: string;

export function updateVPythonCommand(newPath: string) {
  vPythonCommandToUse = newPath;
}

export function getVPythonCommand() {
  return vPythonCommandToUse;
}

export function initializePaths(
  extensionRoot: string,
  vpythonPath: string,
  useServer: boolean
) {
  // The client passes the extensionRoot and vpython command in the args to the server
  // see: client.ts:activateLanguageServerClient()

  vPythonCommandToUse = vpythonPath;
  // set the server instance of the globalEnviroDataServerActive flag
  // based on the value passed to us by the client.
  setServerState(useServer);

  const pathToTestEditorInterface = path.join(
    extensionRoot,
    "python",
    "testEditorInterface.py"
  );
  if (fs.existsSync(pathToTestEditorInterface)) {
    console.log(
      `testEditorInterface was found here: ${pathToTestEditorInterface}`
    );
    testEditorScriptPath = `${pathToTestEditorInterface}`;
  } else {
    console.log(
      `testEditorInterface was not found in the expected location: ${pathToTestEditorInterface}`
    );
  }
}

// Get Choice Data Processing -------------------------------------------------------------

export function generateTestScriptDiagnostic(
  connection: any,
  message: string,
  documentUri: string,
  lineNumber: number
) {
  // When we have a coded test file for an environment that does
  // not have mock support, we give the user a helpful diagnostic message
  let diagnostic: Diagnostic = getDiagnosticObject(
    lineNumber,
    0,
    1000,
    message,
    DiagnosticSeverity.Warning
  );
  connection.sendDiagnostics({
    uri: documentUri,
    diagnostics: [diagnostic],
  });
}

export function generateCodedTestDiagnostic(
  connection: any,
  message: string,
  documentUri: string,
  lineNumber: number
) {
  // When we have a coded test file for an environment that does
  // not have mock support, we give the user a helpful diagnostic message
  let diagnostic: Diagnostic = getDiagnosticObject(
    lineNumber,
    0,
    1000,
    message,
    DiagnosticSeverity.Warning
  );
  connection.sendDiagnostics({
    uri: documentUri,
    diagnostics: [diagnostic],
  });
}

// This mirrors the data object returned from the python call to get completion text
export interface choiceDataType {
  choiceKind: string;
  choiceList: string[];
  messages: string[];
  extraText: string;
}
export const emptyChoiceData: choiceDataType = {
  choiceKind: "",
  choiceList: [],
  messages: [],
  extraText: "",
};

async function getChoiceDataFromServer(
  kind: choiceKindType,
  enviroPath: string,
  lineSoFar: string
): Promise<choiceDataType> {
  // We are re-using options for the line fragment in the request

  let commandToUse = vcastCommandType.choiceListTst;
  if (kind === choiceKindType.choiceListCT) {
    commandToUse = vcastCommandType.choiceListCT;
  }
  const requestObject: clientRequestType = {
    command: commandToUse,
    path: enviroPath,
    options: lineSoFar,
  };

  let transmitResponse: transmitResponseType =
    await transmitCommand(requestObject);

  // If the transmit worked ok, and data was returned ...
  if (transmitResponse.success && transmitResponse.returnData) {
    // return data wil be formatted as a choiceDataType
    return transmitResponse.returnData.data;
  } else {
    console.log(transmitResponse.statusText);
    return emptyChoiceData;
  }
}

export enum choiceKindType {
  choiceListTST = "choiceList-tst",
  choiceListCT = "choiceList-ct",
}
export function getChoiceDataFromPython(
  kind: choiceKindType,
  enviroName: string,
  lineSoFar: string
): choiceDataType {
  // NOTE: we cannot use executeCommand() here because it is in the client only!
  // commandOutput is a buffer: (Uint8Array)
  const commandToRun = `${vPythonCommandToUse} ${testEditorScriptPath} ${kind} ${enviroName} "${lineSoFar}"`;
  let commandOutputBuffer = execSync(commandToRun).toString();

  // see comment about ACTUAL-DATA in cleanVPythonOutput
  commandOutputBuffer = cleanVPythonOutput(commandOutputBuffer);

  // two statements to make debugging easy
  const returnData = JSON.parse(commandOutputBuffer);
  return returnData;
}

// Get Choice Data for Line Being Edited
export async function getChoiceData(
  kind: choiceKindType,
  enviroPath: string,
  lineSoFar: string
): Promise<choiceDataType> {
  //

  let jsonData: any;
  if (globalEnviroDataServerActive) {
    jsonData = await getChoiceDataFromServer(kind, enviroPath, lineSoFar);
  } else {
    jsonData = getChoiceDataFromPython(kind, enviroPath, lineSoFar);
  }

  // special processing to handle enviro version miss-match
  if (jsonData.extraText == "MigrationError") {
    // TBD today, would like to put a popup or diagnositc
    // generateTestScriptDiagnostic()
  }

  for (const msg of jsonData.messages) {
    console.log(msg);
  }
  return jsonData;
}

// Get Hover String for Requirement
export async function getHoverStringForRequirement(
  enviroPath: string,
  requirementKey: string
): Promise<any> {
  let returnValue: string = "";
  const jsonData = await getChoiceData(
    choiceKindType.choiceListTST,
    enviroPath,
    "TEST.REQUIREMENT_KEY:"
  );
  for (const msg of jsonData.messages) {
    console.log(msg);
  }
  for (const line of jsonData.choiceList) {
    if (line.startsWith(requirementKey)) {
      // raw data looks like:  <key> ||| <title> ||| <description>
      const pieces = line.split("|||");
      // title often has double quotes in our examples so strip those too
      const title = pieces[1].trim().replace(/['"]+/g, "");
      const description = pieces[2].trim();
      returnValue = `${title} \n\n ${description}`;
      break;
    }
  }
  return returnValue;
}

// --------------------------------------------------------------------------
// Temporary Function for Development
// --------------------------------------------------------------------------
export async function getChoiceListTimingTest(
  enviroPath: string,
  lineSoFar: string
) {
  // Compares the timing for choiceList using the server and vpython
  // To use this, insert a call into getChoiceData()

  let startTime: number = performance.now();
  for (let index = 0; index < 10; index++) {
    await getChoiceDataFromServer(
      choiceKindType.choiceListTST,
      enviroPath,
      lineSoFar
    );
  }
  let endTime: number = performance.now();
  let deltaString: string = ((endTime - startTime) / 1000).toFixed(2);
  console.log(`choiceList via the server 10x took: ${deltaString} seconds`);

  startTime = performance.now();
  for (let index = 0; index < 10; index++) {
    getChoiceDataFromPython(
      choiceKindType.choiceListTST,
      enviroPath,
      lineSoFar
    );
  }
  endTime = performance.now();
  deltaString = ((endTime - startTime) / 1000).toFixed(2);
  console.log(`choiceList via vpython 10x took: ${deltaString} seconds`);
}
