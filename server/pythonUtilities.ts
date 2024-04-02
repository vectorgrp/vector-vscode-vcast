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

export function runPythonScript(enviroName: string, action: string, payload: string): any {
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

  // vpython prints this annoying message if VECTORCAST_DIR does not match the executable
  // message to stdout when VC_DIR does not match the vcast distro being run.
  // Since this happens before our script even starts so we cannot suppress it.
  // We could send the json data to a temp file, but the create/open file operations
  // have overhead.

  // to make debugging easier
  const pieces = commandOutputBuffer.split("ACTUAL-DATA", 2);
  return JSON.parse(pieces[1].trim());
}

export function getChoiceDataFromPython(
  enviroName: string,
  lineSoFar: string): any {
  const jsonData = runPythonScript(enviroName, "choiceList", lineSoFar);
  for (const msg of jsonData.messages) {
    console.log(msg);
  }
  return jsonData;
}


export function getHoverStringForRequirement(
  enviroName: string,
  requirementKey: string): any {


  let returnValue: string = "";
  const jsonData = runPythonScript(enviroName, "choiceList", "TEST.REQUIREMENT_KEY:");
  for (const msg of jsonData.messages) {
    console.log(msg);
  }
  for (const line of jsonData.choiceList) {
    if (line.startsWith(requirementKey)) {
      // raw data looks like:  <key> ||| <title> ||| <description>
      const pieces = line.split("|||");
      // title often has double quotes in our examples so strip those too
      const title = pieces[1].trim().replace(/['"]+/g, '');
      const description = pieces[2].trim();
      returnValue = `${title} \n\n ${description}`;
      break;
    }
  }
  return returnValue;

}