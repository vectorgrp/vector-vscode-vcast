import * as vscode from "vscode";
import * as jsonc from "jsonc-parser";

import {
  sendVPythonCommandToServer,
  updateVMockStatus,
  sendClicastCommandToServer,
} from "./client";

import { openMessagePane, vectorMessage } from "./messagePane";

import { updateClicastCommandForLanguageServer } from "../langServer/pythonUtilities";

import {
  exeFilename,
  jsoncParseErrors,
  jsoncParseOptions,
  showSettings,
} from "./utilities";

import { vcastLicenseOK } from "./vcastAdapter";

import { executeCommandSync, executeVPythonScript } from "./vcastCommandRunner";

const fs = require("fs");
const path = require("path");
const which = require("which");

export let vcastInstallationDirectory: string = "";
export let vcastInstallationVersion: toolVersionType = {
  version: 0,
  servicePack: 0,
};

export const clicastName = "clicast";
export let clicastCommandToUse: string;
export const manageName = "manage";
export let manageCommandToUse: string;

const vPythonName = "vpython";
const vpythonFromPath = which.sync(vPythonName, { nothrow: true });
export let vPythonCommandToUse: string;

const vcastqtName = "vcastqt";
export let vcastCommandToUse: string;

export let checksumCommandToUse: string | undefined = undefined;
let crc32Name = "crc32-win32.exe";
if (process.platform == "linux") {
  crc32Name = "crc32-linux";
}

export let globalTestInterfacePath: string | undefined = undefined;
export let globalMCDCReportPath: string | undefined = undefined;
let globalEnviroDataServerPath: string;

export function getGlobalEnviroDataServerPath() {
  return globalEnviroDataServerPath;
}

let globalCrc32Path: string | undefined = undefined;

export let globalPathToSupportFiles: string;

export let globalIncludePath: string | undefined = undefined;

const atgName = "atg";
export let atgCommandToUse: string | undefined = undefined;
export let atgAvailable: boolean = false;

// this is set to true if the clicast version supports server mode
let enviroDataServerAvailable: boolean = false;

export function isEnviroDataServerAvailable() {
  return enviroDataServerAvailable;
}

export const configurationFile = "c_cpp_properties.json";
export const launchFile = "launch.json";

// ---------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------
export function initializeInstallerFiles(context: vscode.ExtensionContext) {
  const pathToTestInterface = context.asAbsolutePath(
    "./python/vTestInterface.py"
  );
  const pathToMCDCReport = context.asAbsolutePath("./python/mcdcReport.py");
  if (fs.existsSync(pathToTestInterface)) {
    vectorMessage("Found vTestInterface here: " + pathToTestInterface);
    globalTestInterfacePath = `${pathToTestInterface}`;
  }

  if (fs.existsSync(pathToMCDCReport)) {
    vectorMessage("Found mcdcReport here: " + pathToMCDCReport);
    globalMCDCReportPath = `${pathToMCDCReport}`;
  }

  const pathToEnviroDataServer = context.asAbsolutePath(
    "./python/vcastDataServer.py"
  );
  if (fs.existsSync(pathToEnviroDataServer)) {
    vectorMessage("Found vcastDataServer here: " + pathToEnviroDataServer);
    globalEnviroDataServerPath = `${pathToEnviroDataServer}`;
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

export interface toolVersionType {
  version: number;
  servicePack: number;
}

export function getToolVersionFromPath(
  installationPath: string
): toolVersionType {
  // This function takes a path to a VectorCAST installation
  // and returns the version string from the tool version file
  //
  // Example version strings
  //    Normal releases:    23.sp2 (07/19/23)
  //    Development builds: 24 revision 37f59ce (08/20/24)
  //
  // To make is possible to work with development builds
  // we set the service pack to 99.

  const toolVersionPath = path.join(
    installationPath,
    "DATA",
    "tool_version.txt"
  );

  const toolVersionString = fs.readFileSync(toolVersionPath).toString().trim();

  let whatToReturn: toolVersionType = { version: 0, servicePack: 0 };
  // if this is a development build
  if (toolVersionString.includes(" revision ")) {
    const version = parseInt(toolVersionString.split(" ")[0]);
    whatToReturn = { version: version, servicePack: 99 };
  } else {
    // extract version and service pack from toolVersion
    // The string can be in two foramts: "21 date" or "23.sp2 date"
    // first theck for "24.sp2 date" format ...
    const matched = toolVersionString.match(/(\d+)\.sp(\d+).*/);
    if (matched) {
      // if the format matches, return the values as numbers
      whatToReturn = {
        version: parseInt(matched[1]),
        servicePack: parseInt(matched[2]),
      };
    } else {
      // if the format does not match, split on the first space
      // and return that (if it's an int) and sp 0
      const version = toolVersionString.split(" ")[0];
      if (version.match(/\d+/g) != null) {
        whatToReturn.version = parseInt(version);
      }
    }
  }
  return whatToReturn;
}

function vcastVersionGreaterThan(versionToCheck: toolVersionType): boolean {
  // A general purpose version checker ...

  // check if the version the user has asked us to check is
  // "smaller" than the version we found on the installationPath
  let returnValue: boolean =
    vcastInstallationVersion.version > versionToCheck.version ||
    (vcastInstallationVersion.version == versionToCheck.version &&
      vcastInstallationVersion.servicePack >= versionToCheck.servicePack);

  return returnValue;
}

function initializeServerMode(vcastInstallationPath: string) {
  // The clicast server mode is only available in vc24sp2 and later
  enviroDataServerAvailable = vcastVersionGreaterThan({
    version: 24,
    servicePack: 5,
  });
  if (enviroDataServerAvailable) {
    vectorMessage(`   clicast server is available in this release`);
  }
}

function vectorCASTSupportsVMock(vcastInstallationPath: string): boolean {
  // The vmock features is only available in vc24sp2 and later
  return vcastVersionGreaterThan({ version: 24, servicePack: 4 });
}

function vectorCASTSupportsATG(vcastInstallationPath: string): boolean {
  // Versions of VectorCAST between 23sp0 and 23sp4 had ATG but since
  // we changed the ATG command line interface with 23sp5, we have decided
  // to only support versions greater than that.
  return vcastVersionGreaterThan({ version: 23, servicePack: 5 });
}

function checkForATG(vcastInstallationPath: string) {
  // we only set atgCommandToUse if we find atg and it's licensed
  const atgCommand = path.join(vcastInstallationPath, exeFilename(atgName));
  let statusMessageText = "";
  if (fs.existsSync(atgCommand)) {
    statusMessageText = `   found '${atgName}' here: ${vcastInstallationPath}`;
    const candidateCommand = atgCommand;

    // now check if its licensed ... just atg --help and check the exit code
    const commandToRun: string = `${candidateCommand} --help`;

    // cwd=working dir for this process /  printErrorDetails=false
    const commandStatus = executeCommandSync(
      commandToRun,
      process.cwd(),
      false
    );
    if (commandStatus.errorCode == 0) {
      statusMessageText += ", license is available";
      atgCommandToUse = candidateCommand;
    } else {
      statusMessageText += ", license is NOT available";
    }
    vectorMessage(statusMessageText);
    atgAvailable =
      atgCommandToUse != undefined &&
      vectorCASTSupportsATG(vcastInstallationPath);

    // atgAvailable is used by package.json to control the existence of the atg command in the context menus
    vscode.commands.executeCommand(
      "setContext",
      "vectorcastTestExplorer.atgAvailable",
      atgAvailable
    );
  } else {
    vectorMessage(
      `   could NOT find '${atgName}' here: ${vcastInstallationPath}`
    );
  }
}

function findVcastTools(): boolean {
  // This function will set global paths to vpython, clicast and vcastqt
  // by sequentially looking for vpython in the directory set via the
  // 1. extension option: "vectorcastInstallationLocation"
  // 2. VECTORCAST_DIR
  // 3. system PATH variable

  // return value
  let foundAllvcastTools = false;

  // value of the extension option
  const settings = vscode.workspace.getConfiguration("vectorcastTestExplorer");
  const installationOptionString = settings.get(
    "vectorcastInstallationLocation",
    ""
  );

  // value of VECTORCAST_DIR
  const VECTORCAST_DIR = process.env["VECTORCAST_DIR"];

  // VectorCAST installation location
  let vcastInstallationPath: string | undefined = undefined;

  // priority 1 is the option value, since this lets the user over-ride PATH or VECTORCAST_DIR
  if (installationOptionString.length > 0) {
    const candidatePath = path.join(
      installationOptionString,
      exeFilename(vPythonName)
    );
    if (fs.existsSync(candidatePath)) {
      vcastInstallationPath = installationOptionString;
      vPythonCommandToUse = candidatePath;
      sendVPythonCommandToServer(candidatePath);
      vectorMessage(
        `   found '${vPythonName}' using the 'Vectorcast Installation Location' option [${installationOptionString}].`
      );
    } else {
      vectorMessage(
        `   the installation path provided: '${installationOptionString}' does not contain ${vPythonName}`
      );
      vectorMessage(
        "   use the extension options to provide a valid VectorCAST installation directory."
      );
      showSettings();
    }
  }

  // priority 2 is VECTORCAST_DIR, while this is no longer required, it is still widely used
  else if (VECTORCAST_DIR) {
    const candidatePath = path.join(VECTORCAST_DIR, exeFilename(vPythonName));
    if (fs.existsSync(candidatePath)) {
      vcastInstallationPath = VECTORCAST_DIR;
      vPythonCommandToUse = candidatePath;
      vectorMessage(
        `   found '${vPythonName}' using VECTORCAST_DIR [${VECTORCAST_DIR}]`
      );
    } else {
      vectorMessage(
        `   the installation path provided via VECTORCAST_DIR does not contain ${vPythonName}`
      );
      vectorMessage(
        "   use the extension options to provide a valid VectorCAST installation directory."
      );
      showSettings();
    }
  }

  // priority 3 is the system path
  else if (vpythonFromPath) {
    vcastInstallationPath = path.dirname(vpythonFromPath);
    vPythonCommandToUse = vpythonFromPath;
    vectorMessage(
      `   found '${vPythonName}' on the system path [${vcastInstallationPath}]`
    );
  } else {
    vectorMessage(
      `   '${vPythonName}' is not on the system PATH, and VECTORCAST_DIR is not set`
    );
    vectorMessage(
      "   use the extension options to provide a valid VectorCAST Installation Location."
    );
    showSettings();
  }

  // if we found a vpython somewhere ...
  // we assume the other executables are there too,  but we check anyway :)
  if (vcastInstallationPath) {
    // first check if vcast is newer than 21 - minium version for this extension
    const toolVersion: toolVersionType = getToolVersionFromPath(
      vcastInstallationPath
    );
    if (toolVersion.version >= 21) {
      // do all of the setup required to use clicast
      foundAllvcastTools = initializeVcastUtilities(vcastInstallationPath);

      // check if we have access to a valid crc32 command - this is not fatal
      // must be called after initializeInstallerFiles()

      if (!initializeChecksumCommand(vcastInstallationPath)) {
        vscode.window.showWarningMessage(
          "The VectorCAST Test Explorer could not find the required VectorCAST CRC-32 module, " +
            "so the code coverage feature will not be available.  For details on how to resolve " +
            "this issue, please refer to the 'Prerequisites' section of the README.md file."
        );
      }
    } else {
      // we show also show this in the message pane for completeness
      vectorMessage(
        "   VectorCAST version is too old, minimum supported version is: 21"
      );
      const messageText =
        "The VectorCAST Test Explorer requires a VectorCAST version >= 21, " +
        "use the extension options to provide a valid VectorCAST Installation Location.";
      vscode.window.showWarningMessage(messageText);
      showSettings();
    }
  }

  return foundAllvcastTools;
}

export async function checkIfInstallationIsOK() {
  // Check if the installation is ok by verifying that:
  //   - we can find vpython and clicast
  //   - we have a valid license

  // default this to false, it only gets to true if we find
  // vpython and clicast and we have a license
  let installationIsOK = false;

  vectorMessage("-".repeat(100));
  vectorMessage("Checking that a VectorCAST installation is available ... ");

  if (findVcastTools()) {
    // check if we have a valid license
    if (vcastLicenseOK()) {
      vectorMessage("   VectorCAST license is available ...");
      installationIsOK = true;
    } else {
      vectorMessage("   no VectorCAST license is available");
      installationIsOK = false;
    }
  }

  vectorMessage("-".repeat(100) + "\n");

  if (!installationIsOK) {
    vectorMessage(
      "Please refer to the installation and configuration instructions for details on resolving these issues"
    );
    enviroDataServerAvailable = false;
    openMessagePane();
  }
  return installationIsOK;
}

function initializeVcastUtilities(vcastInstallationPath: string) {
  let toolsFound = false;
  clicastCommandToUse = path.join(
    vcastInstallationPath,
    exeFilename(clicastName)
  );

  if (fs.existsSync(clicastCommandToUse)) {
    vectorMessage(`   found '${clicastName}' here: ${vcastInstallationPath}`);
    sendClicastCommandToServer(clicastCommandToUse);
    updateClicastCommandForLanguageServer(clicastCommandToUse);
    vcastCommandToUse = path.join(
      vcastInstallationPath,
      exeFilename(vcastqtName)
    );

    manageCommandToUse = path.join(
      vcastInstallationPath,
      exeFilename(manageName)
    );

    // compute the installation version once ...
    vcastInstallationDirectory = vcastInstallationPath;
    vcastInstallationVersion = getToolVersionFromPath(vcastInstallationPath);

    if (fs.existsSync(vcastCommandToUse)) {
      vectorMessage(`   found '${vcastqtName}' here: ${vcastInstallationPath}`);

      // we only set toolsFound if we find clicast AND vcastqt
      toolsFound = true;

      // check if atg is available and licensed
      checkForATG(vcastInstallationPath);

      // check if coded tests are available ...
      initializeCodedTestSupport(vcastInstallationPath);

      // check if the server mode is available ...
      initializeServerMode(vcastInstallationPath);

      // check if coded mocks are available ...
      // vMock available affects how we do completions in the language server
      // and allows us to issue nice error messages when the user tries to use vMock
      const vMockAvailable = vectorCASTSupportsVMock(vcastInstallationPath);
      if (vMockAvailable) {
        vectorMessage(`   vMock is available in this release`);
      }
      updateVMockStatus(vMockAvailable);
      //
    } else {
      vectorMessage(
        `   could NOT find '${vcastqtName}' here: ${vcastInstallationPath}`
      );
    }
  } else {
    vectorMessage(
      `   could NOT find '${clicastName}' here: ${vcastInstallationPath}`
    );
  }
  return toolsFound;
}

function pyCrc32IsAvailable(): boolean {
  // Although crc32.py simply puts out AVAILABLE or NOT-AVAILABLE,
  // vpython prints this annoying message if VECTORCAST_DIR does not match the executable
  // so we need this logic to handle that case.

  // I'm doing this in multiple steps for clarity
  const commandOutputText = executeVPythonScript(
    `${vPythonCommandToUse} ${globalCrc32Path}`,
    process.cwd()
  ).stdout;
  const outputLinesAsArray = commandOutputText.split("\n");
  const lastOutputLine = outputLinesAsArray[outputLinesAsArray.length - 1];
  return lastOutputLine == "AVAILABLE";
}

function getCRCutilityPath(vcastInstallationPath: string) {
  // check if the crc32 utility has been added to the the VectorCAST installation

  let returnValue: string | undefined = undefined;
  if (vcastInstallationPath) {
    let candidatePath = path.join(vcastInstallationPath, crc32Name);
    if (fs.existsSync(candidatePath)) {
      vectorMessage(`   found '${crc32Name}' here: ${vcastInstallationPath}`);
      returnValue = candidatePath;
    } else {
      vectorMessage(
        `   could NOT find '${crc32Name}' here: ${vcastInstallationPath}, coverage annotations will not be available`
      );
    }
  }
  return returnValue;
}

function initializeChecksumCommand(
  vcastInstallationPath: string
): string | undefined {
  // checks if this vcast distro has python checksum support built-in
  if (globalCrc32Path && pyCrc32IsAvailable()) {
    checksumCommandToUse = `${vPythonCommandToUse} ${globalCrc32Path}`;
  } else {
    // check if the user has patched the distro with the crc32 utility
    checksumCommandToUse = getCRCutilityPath(vcastInstallationPath);
  }

  return checksumCommandToUse;
}

export const vUnitIncludeSuffix = "/vunit/include";

export function configFileContainsCorrectInclude(filePath: string): boolean {
  // This function will check if the include path for coded testing is in the
  // c_cpp_properties.json file passed in.  There are two cases to check for:
  //   1. The path to the current VectorCAST /vUnit/include directory exists
  //   2. A path with an environment variable, ending in /vunit/include exists

  let returnValue: boolean = false;
  let existingJSONasString: string;
  let existingJSON: any;

  // Requires json-c parsing to handle comments etc.
  existingJSONasString = fs.readFileSync(filePath).toString();
  // note that jsonc.parse returns "real json" without the comments
  existingJSON = jsonc.parse(
    existingJSONasString,
    jsoncParseErrors,
    jsoncParseOptions
  );

  if (
    existingJSON &&
    existingJSON.configurations &&
    existingJSON.configurations.length > 0
  ) {
    for (const configuration of existingJSON.configurations) {
      if (configuration.includePath) {
        for (const includePath of configuration.includePath) {
          if (includePath == globalIncludePath) {
            returnValue = true;
            break;
          }
          // allow the use of _any_ environment variable, not just VECTORCAST_DIR
          // could have used a regex but this is more clear
          if (
            includePath.startsWith("${env:") &&
            includePath.endsWith(vUnitIncludeSuffix)
          ) {
            returnValue = true;
            break;
          }
        }
      }
    }
  }
  return returnValue;
}

function includePathExistsInWorkspace(): boolean {
  // We'd like to make it easy for the user to add the include path
  // for the coded test files.  We check if the /vunit/include path
  // exists in any of the c_cpp_properties.json files and prompt the
  // user to add the path it doesn't
  //
  let returnValue: boolean = false;

  for (const workspace of vscode.workspace.workspaceFolders || []) {
    const workspaceRoot = workspace.uri.fsPath;
    const c_cpp_properties = path.join(
      workspaceRoot,
      ".vscode",
      configurationFile
    );
    if (fs.existsSync(c_cpp_properties)) {
      if (configFileContainsCorrectInclude(c_cpp_properties)) {
        returnValue = true;
        break;
      }
    }
  }
  return returnValue;
}

function initializeCodedTestSupport(vcastInstallationPath: string) {
  // When we get here vcastInstallationPath will point to a
  // valid VectorCAST installation but we don't know if
  // this version has coded test support, so check for that
  // and initialize global variables to support coded testing

  let candidatePath = path.join(vcastInstallationPath, "vunit", "include");
  // swap backslashes to make paths consistent for windows users and
  globalIncludePath = candidatePath.replace(/\\/g, "/");

  let codedTestingAvailable: boolean = false;
  if (fs.existsSync(candidatePath)) {
    vectorMessage(`   found coded-test support, initializing ...`);
    codedTestingAvailable = true;
    if (!includePathExistsInWorkspace()) {
      vscode.window.showInformationMessage(
        "The include path for VectorCAST Coded Testing was not found in your workspace, you should add the " +
          `include path by right clicking on the appropriate ${configurationFile} file, ` +
          "and choosing 'VectorCAST: Add Coded Test Include Path`  "
      );
    }
  }

  vscode.commands.executeCommand(
    "setContext",
    "vectorcastTestExplorer.codedTestingAvailable",
    codedTestingAvailable
  );
}
