import {
  vcastCommandType,
  clientRequestType,
  transmitCommand,
  transmitResponseType,
} from "../src-common/vcastServer";

import fs = require("fs");
import path = require("path");

const execSync = require("child_process").execSync;

let testEditorScriptPath: string | undefined = undefined;
let vPythonCommandToUse: string;
export function setPaths(
  _testEditorScriptPath: string,
  _vPythonCommandToUse: string
) {
  testEditorScriptPath = _testEditorScriptPath;
  vPythonCommandToUse = _vPythonCommandToUse;
}

function initializeScriptPath() {
  // The client passes the extensionRoot and vpython command in the args to the server
  // see: client.ts:activateLanguageServerClient()

  const extensionRoot = process.argv[2];
  vPythonCommandToUse = process.argv[3];
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

function getChoiceDataFromPython(enviroPath: string, lineSoFar: string): any {
  if (testEditorScriptPath == undefined) {
    initializeScriptPath();
  }

  // As an alternative to using a server, we call vpython each time we need some data

  // NOTE: we cannot use executeCommand() here because it is in the client only!
  // commandOutput is a buffer: (Uint8Array)
  // RUN mode is a single shot mode where we run the python script and communicate with stdin/stdout and
  const commandToRun = `${vPythonCommandToUse} ${testEditorScriptPath} choiceList ${enviroPath} "${lineSoFar}"`;
  const commandOutputBuffer = execSync(commandToRun).toString();

  // vpython prints this annoying message if VECTORCAST_DIR does not match the executable
  // message to stdout when VC_DIR does not match the vcast distro being run.
  // Since this happens before our script even starts so we cannot suppress it.
  // We could send the json data to a temp file, but the create/open file operations
  // have overhead.

  // to make debugging easier
  const pieces = commandOutputBuffer.split("ACTUAL-DATA", 2);
  return JSON.parse(pieces[1].trim());
}

async function getChoiceDataFromServer(enviroPath: string, lineSoFar: string) {
  const requestObject: clientRequestType = {
    command: vcastCommandType.choiceList,
    clicast: "",
    path: "",
    test: "",
    options: lineSoFar,
  };
  let transmitResponse:transmitResponseType = await transmitCommand(requestObject);
  if (transmitResponse.success) {
    return transmitResponse.returnData;
  } else {
    console.log (transmitResponse.statusText);
    return {};
  }
}

// Get Choice Data for Line Being Edited
export function getChoiceData(enviroPath: string, lineSoFar: string): any {

  const jsonData = getChoiceDataFromPython(enviroPath, lineSoFar);
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
