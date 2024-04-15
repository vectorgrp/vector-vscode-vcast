import {
  vcastCommandType,
  clientRequestType,
  transmitCommand,
  transmitResponseType,
} from "../src-common/vcastServer";

import fs = require("fs");
import path = require("path");

const execSync = require("child_process").execSync;

// This is the language server version of the flag, set when
// the server is started.  If the user changes the value
// of use server in the settings, if will not affect the
// language server until the extension is re-started
let globalEnviroServerActive: boolean = false;

let testEditorScriptPath: string | undefined = undefined;
let vPythonCommandToUse: string;


export function initializePaths() {
  // The client passes the extensionRoot and vpython command in the args to the server
  // see: client.ts:activateLanguageServerClient()

  const extensionRoot = process.argv[2];
  vPythonCommandToUse = process.argv[3];
  globalEnviroServerActive = process.argv[4].toLowerCase() === "true";

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
    clicast: "",
    path: enviroPath,
    test: "",
    options: lineSoFar,
  };

  let transmitResponse: transmitResponseType = await transmitCommand(
    requestObject
  );

  if (transmitResponse.success) {
    // return data wil be formatted as a choiceDataType
    return transmitResponse.returnData;
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
  const commandOutputBuffer = execSync(commandToRun).toString();

  // vpython prints this annoying message if VECTORCAST_DIR does not match the executable
  // message to stdout when VC_DIR does not match the vcast distro being run.
  // Since this happens before our script even starts so we cannot suppress it.
  // We could send the json data to a temp file, but the create/open file operations
  // have overhead.

  // to make debugging easier
  const pieces = commandOutputBuffer.split("ACTUAL-DATA", 2);
  // two statement to make debugging easy
  const returnData = JSON.parse(pieces[1].trim());
  return returnData;
}

// Get Choice Data for Line Being Edited
export async function getChoiceData(
  enviroPath: string,
  lineSoFar: string
): Promise<choiceDataType> {
  //

  let jsonData: any;
  if (globalEnviroServerActive) {
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
