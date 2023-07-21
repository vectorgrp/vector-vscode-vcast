import * as vscode from "vscode";
import { Uri } from "vscode";

import { openMessagePane, vectorMessage } from "./messagePane";
import { showSettings } from "./helper";

const execSync = require("child_process").execSync;
const spawn = require("child_process").spawn;
const hasbin = require("hasbin");
const fs = require("fs");
const path = require("path");

const vPythonName = "vpython";
const vpythonOnPath = hasbin.sync(vPythonName);
export let vPythonCommandToUse: string | undefined = undefined;

const clicastName = "clicast";
const clicastOnPath = hasbin.sync(clicastName);
export let clicastCommandToUse: string | undefined = undefined;

const vcastName = "vcastqt";
export let vcastCommandtoUse: string | undefined = undefined;

// The testInterface is delivered int the .vsix
// in the sub-directory "python"

// The VectorCAST extensioons for settings and launch are delivered in the .vsix
// in the sub-directory "support"

export let globalTestInterfacePath: string | undefined = undefined;
let globalCrc32Path: string | undefined = undefined;
let globalPathToSupportFiles: string | undefined = undefined;

export function setPaths(
  _globalTestInterfacePath: string,
  _vPythonCommandToUse: string,
  _clicastCommandtoUse: string
) {
  globalTestInterfacePath = _globalTestInterfacePath;
  vPythonCommandToUse = _vPythonCommandToUse;
  clicastCommandToUse = _clicastCommandtoUse;
}

export function initializeInstallerFiles(context: vscode.ExtensionContext) {
  const pathToTestInterface = context.asAbsolutePath(
    "./python/vTestInterface.py"
  );
  if (fs.existsSync(pathToTestInterface)) {
    vectorMessage("Found vTestInterface here: " + pathToTestInterface);
    globalTestInterfacePath = `${pathToTestInterface}`;
  }

  const crc32Path = context.asAbsolutePath("./python/crc32.py");
  if (fs.existsSync(crc32Path)) {
    vectorMessage("Found crc32 here: " + crc32Path);
    globalCrc32Path = `${crc32Path}`;
  }

  const pathToSupportFiles = context.asAbsolutePath("./supportFiles");
  if (fs.existsSync(pathToSupportFiles)) {
    vectorMessage("Found extension suppoort files here: " + pathToSupportFiles);
    vectorMessage("-".repeat(100) + "\n");
    globalPathToSupportFiles = `${pathToSupportFiles}`;
  }
}

export function testInterfaceCommand(
  mode: string,
  enviroPath: string,
  testID: string = ""
): any | undefined {
  // enviroPath is the absolute path to the environnment directory
  // testID is contains the string that uniquely identifies the node, something like:
  //    'Environments-GCC/TUTORIAL-C++-4|manager.Manager::PlaceOrder.Manager::PlaceOrder.001'

  if (globalTestInterfacePath && vPythonCommandToUse) {
    const command = `${vPythonCommandToUse} ${globalTestInterfacePath} --mode=${mode} --kind=vcast --clicast=${clicastCommandToUse} --path=${enviroPath}`;
    let suffix = "";
    if (testID.length > 0) {
      // we need to strip the "path part" of the environment directory from the test ID
      const lastSlash = testID.lastIndexOf("/");
      suffix =
        " --test=" + '"' + testID.substring(lastSlash + 1, testID.length) + '"';
    }

    return command + suffix;
  } else
    vscode.window.showWarningMessage(
      "The VectorCAST Test Explorer could not find the vpython utility."
    );
  return undefined;
}

let globalCheckSumCommand: string | undefined = undefined;
const linuxCRC32 = "crc32-linux";
const win32CRC32 = "crc32-win32";

function pyCrc32IsAvailable(): boolean {
  // Although crc32.py simply puts out AVAILABLE or NOT-AVAILABLE,
  // vpython prints a long message of VECTORCAST_DIR is not set properly
  // so we need this logic to handle that case.

  // I'm doing this in multiple steps for clarity
  const commandOutputText = executeVPythonScript(
    `${vPythonCommandToUse} ${globalCrc32Path}`,
    process.cwd()
  );
  const outputLinesAsArray = commandOutputText.split("\n");
  const lastOutputLine = outputLinesAsArray[outputLinesAsArray.length - 1];
  return lastOutputLine == "AVAILABLE";
}

function CRCutilityIsAvailable() {
  // check if the crc32 utility has been added to the the VectorCAST installation

  // check the value of the option, I know this is extra work if
  // the vcast installation is on the path but this is done once and it make the code cleaner
  let settings = vscode.workspace.getConfiguration("vectorcastTestExplorer");
  const installationLocation = settings.get("vcastInstallationLocation", "");

  let returnValue: string | undefined = undefined;
  if (process.platform == "linux") {
    if (hasbin.sync(linuxCRC32)) {
      returnValue = linuxCRC32;
    } else if (installationLocation.length > 0) {
      let candidatePath = path.join(installationLocation, linuxCRC32);
      if (fs.existsSync(candidatePath)) {
        returnValue = candidatePath;
      }
    }
  } else if (process.platform == "win32") {
    if (hasbin.sync(win32CRC32)) {
      returnValue = win32CRC32;
    } else if (installationLocation.length > 0) {
      let candidatePath = path.join(
        installationLocation,
        exeFilename(win32CRC32)
      );
      if (fs.existsSync(candidatePath)) {
        returnValue = candidatePath;
      }
    }
  }
  return returnValue;
}

export function initializeChecksumCommand(): string | undefined {
  // checks if this vcast distro has python checksum support built-in
  if (globalCrc32Path && pyCrc32IsAvailable()) {
    globalCheckSumCommand = `${vPythonCommandToUse} ${globalCrc32Path}`;
  } else {
    // check if the user has patched the distro with the crc32 utility
    globalCheckSumCommand = CRCutilityIsAvailable();
  }

  return globalCheckSumCommand;
}

export function getChecksumCommand() {
  return globalCheckSumCommand;
}

export function loadLaunchFile(jsonPath: string): any {
  // this funciton takes the path to a launch.json
  // and returns the contents, or an empty list of configurations
  // if we cannot read the file
  let existingJSON: any;
  try {
    existingJSON = JSON.parse(fs.readFileSync(jsonPath));
  } catch {
    // if file is empty ...
    existingJSON = { configurations: [] };
  }
  return existingJSON;
}

export function addLaunchConfiguration(fileUri: Uri) {
  // This function adds the VectorCAST Harness Debug configuration to any
  // launch.json file that the user right clicks on

  const jsonPath = fileUri.fsPath;
  const existingJSON: any = loadLaunchFile(jsonPath);

  // Remember that the vectorJSON data has the "configurations" level which is an array
  const vectorJSON = JSON.parse(
    fs.readFileSync(
      path.join(globalPathToSupportFiles, "vcastLaunchTemplate.json")
    )
  );

  const vectorConfiguration = vectorJSON.configurations[0];

  // now loop through launch.json to make sure it does not already have the vector config
  let existingConfigFound = false;

  if (existingJSON.configurations)
    for (const existingConfig of existingJSON.configurations) {
      if (existingConfig.name == vectorConfiguration.name) {
        existingConfigFound = true;
        break;
      }
    }
  else {
    // if file does not have "configuration" section ...
    existingJSON.configurations = [];
  }

  if (existingConfigFound) {
    vscode.window.showInformationMessage(
      `File: ${jsonPath}, already contains a ${vectorConfiguration.name} configuration`
    );
  } else {
    existingJSON.configurations.push(vectorConfiguration);
    fs.writeFileSync(jsonPath, JSON.stringify(existingJSON, null, "\t"));
  }
}

export function addSettingsFileFilter(fileUri: Uri) {
  const filePath = fileUri.fsPath;
  let existingJSON;
  try {
    existingJSON = JSON.parse(fs.readFileSync(filePath));
  } catch {
    // if the file is empty ...
    existingJSON = {};
  }

  // if the file is missing the files.exclude section
  if (!existingJSON.hasOwnProperty("files.exclude")) {
    existingJSON["files.exclude"] = {};
  }

  // REmember that the vectorJSON data has the "configurations" level which is an array
  const vectorJSON = JSON.parse(
    fs.readFileSync(path.join(globalPathToSupportFiles, "vcastSettings.json"))
  );

  // now check if the vector filters are already in the files.exclude object
  if (existingJSON["files.exclude"].hasOwnProperty("vectorcast-filter-start")) {
    vscode.window.showInformationMessage(
      `File: ${filePath}, already contains the VectorCAST exclude patterns`
    );
  } else {
    existingJSON["files.exclude"] = Object.assign(
      existingJSON["files.exclude"],
      vectorJSON["files.exclude"]
    );
    fs.writeFileSync(filePath, JSON.stringify(existingJSON, null, "\t"));
  }
}

export function executeVPythonScript(
  commandToRun: string,
  whereToRun: string
): any {
  // we use this common functon to run the vpython and process the output
  // primarily because vpython puts out this annoying VECTORCAST_DIR does not match
  // message to stdout when VC_DIR does not match the vcast distro being run.
  // Since this happens before our script even starts so we cannot suppress it.
  // We could send the json data to a temp file, but the create/open file operations
  // have overhead.

  let returnData = undefined;

  if (commandToRun) {
    const commandStatus: commandStatusType = executeCommand(
      commandToRun,
      whereToRun
    );
    if (commandStatus.errorCode == 0) {
      if (
        commandStatus.stdout[0] == "{" ||
        commandStatus.stdout.includes("FATAL")
      ) {
        returnData = commandStatus.stdout;
      } else {
        // to make debugging easier
        if (commandStatus.stdout) {
          const pieces = commandStatus.stdout.split("ACTUAL-DATA", 2);
          returnData = pieces[1].trim();
        }
      }
    }
  }
  return returnData;
}

export function getJsonDataFromTestInterface(
  commandToRun: string,
  enviroPath: string
): any {
  // A wrapper for executeVPythonScript when we know the output is JSON

  let returnData = undefined;

  let jsonText = executeVPythonScript(commandToRun, enviroPath);
  try {
    returnData = JSON.parse(jsonText);
  } catch {
    // return undefined
  }
  return returnData;
}

export function executeClicastCommand(
  argList: string[],
  CWD: string,
  callback?: any,
  enviroPath?: string
) {
  // this function is used to build and rebuild environments
  // long running commands that where we want to show real-time output

  // it uses spawn to execute a clicast command, log the output to the
  // message pane, and update the test explorer when the command completes

  // if the current directory does not have a CFG file, create one
  if (!fs.existsSync(path.join(CWD, "CCAST_.CFG"))) {
    executeCommand(`${clicastCommandToUse} -lc template GNU_CPP_X`, CWD);
  }

  // To debug what's going on with vcast, you can add -dall to
  // argList, which will dump debug info for the clicast invocation
  let clicast = spawn(clicastCommandToUse, argList, { cwd: CWD });
  vectorMessage("-".repeat(100));

  // maybe this is a hack, but after reading stackoverflow for a while I could
  // not come up with anything better.  The issue is that the on ("exit") gets called
  // before the stdout stream is closed so stdoutBuffer is incomplete at that point
  // so we use on ("exit") to invoke the callback and on ("close") to dump the clicast stdout.

  // I tried to only dump the output when the exit code was non 0 but we get a race
  // condition because the exit might not have saved it when the close is seen.

  vectorMessage("-".repeat(100));
  clicast.stdout.on("data", function (data: any) {
    vectorMessage(data.toString().replace(/[\n]/g, ""));
  });

  clicast.stdout.on("close", function (code: any) {
    vectorMessage("-".repeat(100));
  });

  clicast.on("exit", function (code: any) {
    vectorMessage("-".repeat(100));
    vectorMessage(
      `${clicastName}: '${argList.join(
        " "
      )}' returned exit code: ${code.toString()}`
    );
    vectorMessage("-".repeat(100));
    if (callback && code == 0) callback(enviroPath);
  });
}

export interface commandStatusType {
  errorCode: number;
  stdout: string;
}
export function executeCommand(
  commandToRun: string,
  cwd: string = "",
  printErrorDetails: boolean = true
): commandStatusType {
  let commandStatus: commandStatusType = { errorCode: 0, stdout: "" };
  try {
    // commandOutput is a buffer: (Uint8Array)
    if (cwd.length > 0)
      commandStatus.stdout = execSync(commandToRun, { cwd: cwd })
        .toString()
        .trim();
    else commandStatus.stdout = execSync(commandToRun).toString().trim();
  } catch (error: any) {
    if (error && error.stdout) {
      commandStatus.stdout = error.stdout.toString();
      commandStatus.errorCode = error.status;
      if (printErrorDetails) {
        vectorMessage("Exception while running command:");
        vectorMessage(commandToRun);
        vectorMessage(commandStatus.stdout);
        vectorMessage(error.stderr.toString());
        openMessagePane();
      }
    } else {
      ("Undefined error in utilities/executeCommand");
    }
  }
  return commandStatus;
}

const os = require("os");
function exeFilename(basename: string): string {
  if (os.platform() == "win32") return basename + ".exe";
  else return basename;
}

function findVcastTools() {
  // This function will check if vPython is on the path or if the
  // VectorCAST Installation directory option is set
  // In either of these "positive" cases it will setup the
  // vPythonCommandToUse and clicastCommandtoUse global variables
  // otherwise it will display and error.

  // check the value of the option, I know this is extra work if
  // vcast is on the path but this is done once and it make the code cleaner
  let settings = vscode.workspace.getConfiguration("vectorcastTestExplorer");
  const installationLocation = settings.get("vcastInstallationLocation", "");

  let vcastToolsOK: boolean = true;

  if (vpythonOnPath) {
    vPythonCommandToUse = vPythonName;
    vectorMessage(`   found '${vPythonName}' on the system PATH ...`);
  } else if (installationLocation.length > 0) {
    const candidatePath = path.join(
      installationLocation,
      exeFilename(vPythonName)
    );
    if (fs.existsSync(candidatePath)) {
      vPythonCommandToUse = candidatePath;
      vectorMessage(`   found '${vPythonName}' here: ${vPythonCommandToUse}`);
    } else {
      vcastToolsOK = false;
      vectorMessage(
        `   the instllation path provided: '${installationLocation}' does not contain ${vPythonName} ` +
          "please correct the path to the VectorCAST installation directory"
      );
      showSettings();
    }
  } else {
    vcastToolsOK = false;
    vectorMessage(
      `   command: '${vPythonName}' is not on the system PATH ` +
        "please set the Installation Location in the settings dialog"
    );
    showSettings();
  }

  // we could actually just combine this with the above, because the chances of us finding
  // vpython and not clicast are virtually 0 but for simplicity, just duplicating the code here

  if (clicastOnPath) {
    clicastCommandToUse = clicastName;
    vcastCommandtoUse = vcastName;
    vectorMessage(`   found '${clicastName}' on the system PATH ...`);
  } else if (installationLocation.length > 0) {
    const candidatePath = path.join(
      installationLocation,
      exeFilename(clicastName)
    );
    if (fs.existsSync(candidatePath)) {
      clicastCommandToUse = candidatePath;
      vcastCommandtoUse = path.join(
        installationLocation,
        exeFilename(vcastName)
      );
      vectorMessage(`   found '${clicastName}' here: ${clicastCommandToUse}`);
    } else {
      vcastToolsOK = false;
      vectorMessage(
        `   the instllation path provided: '${installationLocation}' does not contain ${clicastName} ` +
          "please correct the path to the VectorCAST installation directory"
      );
      showSettings();
    }
  } else {
    vcastToolsOK = false;
    vectorMessage(
      `   command: '${clicastName}' is not on the system PATH ` +
        "please set the Installation Location in the settings dialog"
    );
    showSettings();
  }

  return vcastToolsOK;
}

export function checkIfInstallationIsOK() {
  // Check if the installation is ok by verifying that:
  //   - we can find vpython and clicast
  //   - we have a valid license

  // default this to false, it only gets to true if we find
  // vpython and clicast and we have a license
  let returnValue = false;

  vectorMessage("Checking that a VectorCAST installation is available ... ");

  if (findVcastTools()) {
    // check if we have a valid license
    const commandToRun = `${clicastCommandToUse} tools has_license`;
    let commandStatus: commandStatusType = executeCommand(
      commandToRun,
      "",
      false
    );
    if (commandStatus.errorCode == 0) {
      vectorMessage("   VectorCAST license is available ...");
      returnValue = true;
    } else {
      vectorMessage("   no VectorCAST license is available");
      returnValue = false;
    }
  }

  if (!returnValue) {
    vectorMessage(
      "Please refer to the installation and configuration instructions for details on resolving these issues"
    );
    openMessagePane();
  }
  return returnValue;
}
