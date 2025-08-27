import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver-types";

import {
  clientRequestType,
  globalEnviroDataServerActive,
  setGLobalServerState,
  transmitCommand,
  transmitResponseType,
  vcastCommandType,
} from "../src-common/vcastServer";

import * as os from "os";
import fs = require("fs");
import path = require("path");

import { execSync } from "child_process";
import { cleanVectorcastOutput } from "../src-common/commonUtilities";
import { getDiagnosticObject } from "./tstValidation";

let testEditorScriptPath: string | undefined = undefined;
let vcDirInstallationLocation: string;
let vPythonCommandToUse: string;
export let clicastCommandToUse: string;

export function exeFilename(base: string): string {
  // We assume it's windows --> .exe, if it's not, we remove the .exe
  // THis lets the unit tests succeed with 100%
  let name = base;
  if (os.platform() !== "win32") {
    // normalize for non-Windows
    name = name.replace(/\.exe$/i, "");
  }
  return name;
}

export function updateVCDirCommandForLanguageServer(newPath: string) {
  vcDirInstallationLocation = newPath;
  const newVPython = path.join(
    vcDirInstallationLocation,
    exeFilename("vpython.exe")
  );
  const newClicast = path.join(
    vcDirInstallationLocation,
    exeFilename("clicast.exe")
  );
  if (fs.existsSync(newVPython)) {
    updateVPythonCommandForLanguageServer(newVPython);
  } else {
    console.log(
      `Could not find vPython for the VectorCAST Installation Location: ${vcDirInstallationLocation}`
    );
  }

  if (fs.existsSync(newClicast)) {
    updateClicastCommandForLanguageServer(newClicast);
  } else {
    console.log(
      `Could not find clicast for the VectorCAST Installation Location: ${vcDirInstallationLocation}`
    );
  }
}

export function updateVPythonCommandForLanguageServer(newPath: string) {
  vPythonCommandToUse = newPath;
}

export function getVPythonCommand() {
  return vPythonCommandToUse;
}

export function updateClicastCommandForLanguageServer(newCommand: string) {
  clicastCommandToUse = newCommand;
}

export function getClicastCommand() {
  return clicastCommandToUse;
}

export function initializePaths(
  extensionRoot: string,
  vcDir: string,
  useServer: boolean
) {
  // The client passes the extensionRoot and vpython command in the args to the server
  // see: client.ts:activateLanguageServerClient()

  const vPythonPath = path.join(vcDir, exeFilename("vpython.exe"));
  console.log("VectorCAST Language Server is Active ...");
  if (fs.existsSync(vPythonPath)) {
    console.log(`  using vpython: ${vPythonPath}`);
  } else {
    console.log(`  unable to find vpython in: ${vPythonPath}`);
  }
  console.log(`  using VectorCAST data server: ${useServer}`);

  updateVCDirCommandForLanguageServer(vcDir);

  // set the server instance of the globalEnviroDataServerActive flag
  // based on the value passed to us by the client.
  setGLobalServerState(useServer);

  const pathToTestEditorInterface = path.join(
    extensionRoot,
    "python",
    "testEditorInterface.py"
  );
  if (fs.existsSync(pathToTestEditorInterface)) {
    console.log(
      `  testEditorInterface was found here: ${pathToTestEditorInterface}\n`
    );
    testEditorScriptPath = `${pathToTestEditorInterface}`;
  } else {
    console.log(
      `  testEditorInterface was not found in the expected location: ${pathToTestEditorInterface}\n`
    );
  }
}

// Get Choice Data Processing -------------------------------------------------------------

export function generateDiagnosticForTest(
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

export async function getChoiceDataFromServer(
  kind: choiceKindType,
  enviroPath: string,
  lineSoFar: string,
  unitName?: string
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
    unit: unitName,
  };

  let transmitResponse: transmitResponseType =
    await transmitCommand(requestObject);

  // If the transmit worked ok, and data was returned ...
  if (transmitResponse.success && transmitResponse.returnData) {
    // return data wil be formatted as a choiceDataType
    return transmitResponse.returnData.data;
  } else {
    console.log(transmitResponse.statusText);
    let returnData = emptyChoiceData;
    returnData.messages.push(transmitResponse.statusText);
    returnData.extraText = "server-error";
    return returnData;
  }
}

export enum choiceKindType {
  choiceListTST = "choiceList-tst",
  choiceListCT = "choiceList-ct",
}
export function getChoiceDataFromPython(
  kind: choiceKindType,
  enviroName: string,
  lineSoFar: string,
  unit?: string
): choiceDataType {
  // NOTE: we cannot use executeCommand() here because it is in the client only!
  // commandOutput is a buffer: (Uint8Array)
  const commandToRun = `${vPythonCommandToUse} ${testEditorScriptPath} --mode ${kind} --enviroName ${enviroName} --inputLine "${lineSoFar}" --unit ${unit}`;
  let commandOutputBuffer = execSync(commandToRun).toString();

  // see detailed comment with the function definition
  commandOutputBuffer = cleanVectorcastOutput(commandOutputBuffer);

  // two statements to make debugging easy
  const returnData = JSON.parse(commandOutputBuffer);
  return returnData;
}

// Get Choice Data for Line Being Edited
export async function getChoiceData(
  kind: choiceKindType,
  enviroPath: string,
  lineSoFar: string,
  unit?: string
): Promise<choiceDataType> {
  //

  let jsonData: any;
  if (globalEnviroDataServerActive) {
    jsonData = await getChoiceDataFromServer(kind, enviroPath, lineSoFar, unit);
  } else {
    jsonData = getChoiceDataFromPython(kind, enviroPath, lineSoFar, unit);
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
