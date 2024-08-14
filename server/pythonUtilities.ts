import fs = require("fs");
import path = require("path");
import { execSync } from "child_process";
import { cleanVcastOutput } from "../src-common/commonUtilities";

let testEditorScriptPath: string | undefined = undefined;
let vPythonCommandToUse: string | undefined = undefined;

export function setPaths(
  _testEditorScriptPath: string,
  _vPythonCommandToUse: string
) {
  testEditorScriptPath = _testEditorScriptPath;
  vPythonCommandToUse = _vPythonCommandToUse;
}

export function updateVPythonCommand(newPath: string) {
  vPythonCommandToUse = newPath;
}

function initializeScriptPath() {
  // The client passes the extensionRoot and vpython command in the args to the server
  // see: client.ts:activateLanguageServerClient()

  const extensionRoot = process.argv[2];
  // if we have not been sent the explicit path to use
  // fetch it from the command line arguments
  if (vPythonCommandToUse == undefined) {
    vPythonCommandToUse = process.argv[3];
  }
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

export function runPythonScript(
  action: string,
  enviroName: string,
  payload: string
): any {
  // this is currently not used as the actual server mode is unused
  if (testEditorScriptPath == undefined) {
    initializeScriptPath();
  }

  // As an alternative to using a server, we call vpython each time we need some data

  // NOTE: we cannot use executeCommand() here because it is in the client only!
  // commandOutput is a buffer: (Uint8Array)
  // RUN mode is a single shot mode where we run the python script and communicate with stdin/stdout and
  const commandToRun = `${vPythonCommandToUse} ${testEditorScriptPath} ${action} ${enviroName} "${payload}"`;
  const commandOutputBuffer = execSync(commandToRun).toString();

  // two steps to make debugging easier
  const outputString = cleanVcastOutput(commandOutputBuffer);
  return JSON.parse(outputString);
}

export enum choiceKindType {
  choiceListTST = "choiceList-tst",
  choiceListCT = "choiceList-ct",
}
export function getChoiceDataFromPython(
  kind: choiceKindType,
  enviroName: string,
  lineSoFar: string
): any {
  const jsonData = runPythonScript(kind, enviroName, lineSoFar);
  for (const msg of jsonData.messages) {
    console.log(msg);
  }
  return jsonData;
}

export function getHoverStringForRequirement(
  enviroName: string,
  requirementKey: string
): any {
  let returnValue: string = "";
  const jsonData = runPythonScript(
    "choiceList-tst",
    enviroName,
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
