import {
  vcastCommandType,
  clientRequestType,
  transmitCommand,
  transmitResponseType,
} from "../src-common/vcastServer";

import fs = require("fs");
import path = require("path");

import { execSync } from "child_process";
import { cleanVcastOutput } from "../src-common/commonUtilities";

// This is the language server version of the flag, set when
// the server is started.  If the user changes the value
// of use server in the settings, if will not affect the
// language server until the extension is re-started
let globalEnviroDataServerActive: boolean = false;

let testEditorScriptPath: string | undefined = undefined;
let vPythonCommandToUse: string;

export function initializePaths(
  extensionRoot: string,
  vpythonPath: string,
  useServer: boolean
) {
  // The client passes the extensionRoot and vpython command in the args to the server
  // see: client.ts:activateLanguageServerClient()

  vPythonCommandToUse = vpythonPath;
  globalEnviroDataServerActive = useServer;

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

// This mirrors the data object returned from the python call to get completion text
interface choiceDataType {
  choiceKind: string;
  choiceList: string[];
  messages: string[];
}
const emptyChoiceData: choiceDataType = {
  choiceKind: "",
  choiceList: [],
  messages: [],
};

async function getChoiceDataFromServer(
  enviroPath: string,
  lineSoFar: string
): Promise<choiceDataType> {
  // We are re-using options for the line fragment in the request
  const requestObject: clientRequestType = {
    command: vcastCommandType.choiceList,
    path: enviroPath,
    options: lineSoFar,
  };

  let transmitResponse: transmitResponseType = await transmitCommand(
    requestObject
  );

  // tansmitResponse.returnData is an object with exitCode and data properties
  if (transmitResponse.success) {
    // return data wil be formatted as a choiceDataType
    return transmitResponse.returnData.data;
  } else {
    console.log(transmitResponse.statusText);
    return emptyChoiceData;
  }
}

function getChoiceDataFromPython(
  enviroPath: string,
  lineSoFar: string
): choiceDataType {
  // NOTE: we cannot use executeCommand() here because it is in the client only!
  // commandOutput is a buffer: (Uint8Array)
  const commandToRun = `${vPythonCommandToUse} ${testEditorScriptPath} choiceList ${enviroPath} "${lineSoFar}"`;
  let commandOutputBuffer = execSync(commandToRun).toString();

  // see comment about ACTUAL-DATA in cleanVcastOutput
  commandOutputBuffer = cleanVcastOutput(commandOutputBuffer);

  // two statement to make debugging easy
  const returnData = JSON.parse(commandOutputBuffer);
  return returnData;
}

// Get Choice Data for Line Being Edited
export async function getChoiceData(
  enviroPath: string,
  lineSoFar: string
): Promise<choiceDataType> {
  //

  let jsonData: any;
  if (globalEnviroDataServerActive) {
    jsonData = await getChoiceDataFromServer(enviroPath, lineSoFar);
  } else {
    jsonData = getChoiceDataFromPython(enviroPath, lineSoFar);
  }

  for (const msg of jsonData.messages) {
    console.log(msg);
  }
  return jsonData;
}

// Get Hover String for Requirement
export function getHoverStringForRequirement(
  enviroPath: string,
  requirementKey: string
): any {
  let returnValue: string = "";
  const jsonData = getChoiceDataFromPython(enviroPath, "TEST.REQUIREMENT_KEY:");
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
    await getChoiceDataFromServer(enviroPath, lineSoFar);
  }
  let endTime: number = performance.now();
  let deltaString: string = ((endTime - startTime) / 1000).toFixed(2);
  console.log(`choiceList via the server 10x took: ${deltaString} seconds`);

  startTime = performance.now();
  for (let index = 0; index < 10; index++) {
    getChoiceDataFromPython(enviroPath, lineSoFar);
  }
  endTime = performance.now();
  deltaString = ((endTime - startTime) / 1000).toFixed(2);
  console.log(`choiceList via vpython 10x took: ${deltaString} seconds`);
}
