import * as vscode from "vscode";
import { Uri } from "vscode";

import { openMessagePane, vectorMessage } from "./messagePane";
import { showSettings } from "./helper";

const execSync = require("child_process").execSync;
const spawn = require("child_process").spawn;
const fs = require("fs");
const path = require("path");
const which = require ("which")

const vPythonName = "vpython";
const vpythonFromPath = which.sync(vPythonName, { nothrow: true })
export let vPythonCommandToUse: string | undefined = undefined;

const clicastName = "clicast";
export let clicastCommandToUse: string | undefined = undefined;

const vcastqtName = "vcastqt";
export let vcastCommandtoUse: string | undefined = undefined;

// The testInterface is delivered int the .vsix
// in the sub-directory "python"

// The VectorCAST extensions for settings and launch are delivered in the .vsix
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
    vectorMessage("Found the crc32 python wrapper here: " + crc32Path);
    globalCrc32Path = `${crc32Path}`;
  }

  const pathToSupportFiles = context.asAbsolutePath("./supportFiles");
  if (fs.existsSync(pathToSupportFiles)) {
    vectorMessage("Found extension support files here: " + pathToSupportFiles);
    globalPathToSupportFiles = `${pathToSupportFiles}`;
  }
}

export function testInterfaceCommand(
  mode: string,
  enviroPath: string,
  testID: string = ""
): any | undefined {
  // enviroPath is the absolute path to the environnement directory
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
let crc32Name="crc32-win32.exe";
if (process.platform == "linux") {
  crc32Name = "crc32-linux";
}


function pyCrc32IsAvailable(): boolean {
  // Although crc32.py simply puts out AVAILABLE or NOT-AVAILABLE,
  // vpython prints this annoying message if VECTORCAST_DIR does not match the executable
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


function getCRCutilityPath(vcastInstallationPath:string) {

  // check if the crc32 utility has been added to the the VectorCAST installation

  let returnValue: string | undefined = undefined;
  if (vcastInstallationPath) {
      let candidatePath = path.join(vcastInstallationPath, crc32Name);
      if (fs.existsSync(candidatePath)) {
        vectorMessage(`   found '${crc32Name}' here: ${vcastInstallationPath}`);
        returnValue = candidatePath;
      }
      else {
        vectorMessage(`   could NOT find '${crc32Name}' here: ${vcastInstallationPath}, coverage annotations will not be available`);
      }
    }
  return returnValue;
}

export function initializeChecksumCommand(vcastInstallationPath:string): string | undefined {
  // checks if this vcast distro has python checksum support built-in
  if (globalCrc32Path && pyCrc32IsAvailable()) {
    globalCheckSumCommand = `${vPythonCommandToUse} ${globalCrc32Path}`;
  } else {
    // check if the user has patched the distro with the crc32 utility
    globalCheckSumCommand = getCRCutilityPath(vcastInstallationPath);
  }

  return globalCheckSumCommand;
}

export function getChecksumCommand() {
  return globalCheckSumCommand;
}

export function loadLaunchFile(jsonPath: string): any {
  // this function takes the path to a launch.json
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
  // we use this common function to run the vpython and process the output because
  // vpython prints this annoying message if VECTORCAST_DIR does not match the executable
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

function findVcastTools():boolean {

  // This function will set global paths to vpython, clicast and vcastqt
  // by sequentially looking for vpython in the directory set via the 
  // 1. extension option: "vectorcastInstallationLocation"
  // 2. VECTORCAST_DIR
  // 3. system PATH variable


  // return value
  let foundAllvcastTools = false;

  // value of the extension option
  const settings = vscode.workspace.getConfiguration("vectorcastTestExplorer");
  const installationOptionString = settings.get("vectorcastInstallationLocation", "");

  // value of VECTORCAST_DIR
  const  VECTORCAST_DIR = process.env ["VECTORCAST_DIR"];

  // VectorCAST installation location
  let vcastInstallationPath:string|undefined = undefined;

  // priority 1 is the option value, since this lets the user over-ride PATH or VECTORCAST_DIR
  if (installationOptionString.length > 0) {
    const candidatePath = path.join(
      installationOptionString,
      exeFilename(vPythonName)
    );
    if (fs.existsSync(candidatePath)) {
      vcastInstallationPath = installationOptionString;
      vPythonCommandToUse = candidatePath;
      vectorMessage(`   found '${vPythonName}' using the 'Vectorcast Installation Location' option [${installationOptionString}].`);
    } else {
      vectorMessage(
        `   the installation path provided: '${installationOptionString}' does not contain ${vPythonName}, ` +
        "use the extension options to provide a valid VectorCAST installation directory."
      );
      showSettings();
    }
  } 

  // priority 2 is VECTORCAST_DIR, while this is no longer required, it is still widely used
  else if (VECTORCAST_DIR) {
    const candidatePath = path.join(
      VECTORCAST_DIR,
      exeFilename(vPythonName)
    );
    if (fs.existsSync(candidatePath)) {
      vcastInstallationPath = VECTORCAST_DIR;
      vPythonCommandToUse = candidatePath;
      vectorMessage(`   found '${vPythonName}' using VECTORCAST_DIR [${VECTORCAST_DIR}]`);
    } else {
      vectorMessage(
        `   the installation path provided via VECTORCAST_DIR does not contain ${vPythonName}, ` +
          "use the extension options to provide a valid VectorCAST installation directory."
      );
      showSettings();
    }
  } 

  // priority 3 is the system path
  else if (vpythonFromPath) {
    vcastInstallationPath = path.dirname (vpythonFromPath)
    vPythonCommandToUse = vpythonFromPath;
    vectorMessage(`   found '${vPythonName}' on the system path [${vcastInstallationPath}]`);
  } 
  
  else {
    vectorMessage(
      `   command: '${vPythonName}' is not on the system PATH, and VECTORCAST_DIR is not set, ` +
      "use the extension options to provide a valid VectorCAST installation directory."
    );
    showSettings();
  }

  // if we found a vpython somewhere ...  
  // we assume the other executables are there too,  but we check anyway :)
  if (vcastInstallationPath) {

      clicastCommandToUse = path.join(
        vcastInstallationPath,
        exeFilename(clicastName)
      );

      if (fs.existsSync (clicastCommandToUse)) {
        vectorMessage(`   found '${clicastName}' here: ${vcastInstallationPath}`);
        vcastCommandtoUse =  path.join(
            vcastInstallationPath,
            exeFilename(vcastqtName)
          );
        if (fs.existsSync (vcastCommandtoUse)) {
            vectorMessage(`   found '${vcastqtName}' here: ${vcastInstallationPath}`);
            foundAllvcastTools = true;
          }
        else {
          vectorMessage(`   could NOT find '${vcastqtName}' here: ${vcastInstallationPath}`);
          }
        }
      else {
        vectorMessage(`   could NOT find '${clicastName}' here: ${vcastInstallationPath}`);
      }

    // check if we have access to a valid crc32 command - this is not fatal
    // must be called after initializeInstallerFiles()

    if (!initializeChecksumCommand(vcastInstallationPath)) {
      vscode.window.showWarningMessage(
        "The VectorCAST Test Explorer could not find the required VectorCAST CRC-32 module, " +
          "so the code coverage feature will not be available.  For details on how to resolve " +
          "this issue, please refer to the 'Prerequisites' section of the README.md file."
      );
    }
  }


  return foundAllvcastTools;
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

  vectorMessage("-".repeat(100) + "\n");

  if (!returnValue) {
    vectorMessage(
      "Please refer to the installation and configuration instructions for details on resolving these issues"
    );
    openMessagePane();
  }
  return returnValue;
}
