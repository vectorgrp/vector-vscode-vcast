import fs = require("fs");
import path = require("path");
import { execSync } from "node:child_process";
import { cleanVcastOutput } from "../src-common/commonUtilities.js";

let testEditorScriptPath: string | undefined;
let vPythonCommandToUse: string | undefined;

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

export function getVPythonCommand() {
  return vPythonCommandToUse;
}

function initializeScriptPath() {
  // The client passes the extensionRoot and vpython command in the args to the server
  // see: client.ts:activateLanguageServerClient()

  const extensionRoot = process.argv[2];
  // If we have not been sent the explicit path to use
  // fetch it from the command line arguments
  vPythonCommandToUse ??= process.argv[3];

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
  // This is currently not used as the actual server mode is unused
  if (testEditorScriptPath == undefined) {
    initializeScriptPath();
  }
  // As an alternative to using a server, we call vpython each time we need some data

  // NOTE: we cannot use executeCommand() here because it is in the client only!
  // commandOutput is a buffer: (Uint8Array)
  // RUN mode is a single shot mode where we run the python script and communicate with stdin/stdout and
  const commandToRun = `${vPythonCommandToUse} ${testEditorScriptPath} ${action} ${enviroName} "${payload}"`;
  const commandOutputBuffer = execSync(commandToRun).toString();

  // Two steps to make debugging easier
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
  for (const message of jsonData.messages) {
    console.log(message);
  }

  return jsonData;
}

export function getHoverStringForRequirement(
  enviroName: string,
  requirementKey: string
): any {
  let returnValue = "";
  const jsonData = runPythonScript(
    "choiceList-tst",
    enviroName,
    "TEST.REQUIREMENT_KEY:"
  );
  for (const message of jsonData.messages) {
    console.log(message);
  }

  for (const line of jsonData.choiceList) {
    if (line.startsWith(requirementKey)) {
      // Raw data looks like:  <key> ||| <title> ||| <description>
      const pieces = line.split("|||");
      // Title often has double quotes in our examples so strip those too
      const title = pieces[1].trim().replaceAll(/['"]+/g, "");
      const description = pieces[2].trim();
      returnValue = `${title} \n\n ${description}`;
      break;
    }
  }

  return returnValue;
}
