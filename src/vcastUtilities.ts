import * as vscode from "vscode";

// needed for parsing json files with comments
import * as jsonc from "jsonc-parser";

import { loadScriptCallBack } from "./callbacks";

import { vectorMessage } from "./messagePane";

import { getTestNode, testNodeType } from "./testData";

import {
  jsoncModificationOptions,
  jsoncParseErrors,
  jsoncParseOptions,
  openFileWithLineSelected,
} from "./utilities";

import {
  dumpTestScriptFile,
  runATGCommands,
  runBasisPathCommands,
} from "./vcastAdapter";

import {
  clicastCommandToUse,
  configFileContainsCorrectInclude,
  globalIncludePath,
  globalMCDCReportPath,
  globalTestInterfacePath,
  vPythonCommandToUse,
  vUnitIncludeSuffix,
} from "./vcastInstallation";

import { clientRequestType, vcastCommandType } from "../src-common/vcastServer";

const fs = require("fs");
const os = require("os");
const path = require("path");

export function addIncludePath(fileUri: vscode.Uri) {
  // This small wrapper just checks if we really need to add the include path
  // and if so calls insertIncludePath.  We intentionally don't turn off
  // the right click menu if we find the include path during initialization
  // because that would lock the user out if there is an error in the init stuff

  const filePath = fileUri.fsPath;
  if (!configFileContainsCorrectInclude(filePath)) {
    insertIncludePath(filePath);
  } else {
    vscode.window.showInformationMessage(
      `${filePath} already contains the correct include path.  `
    );
  }
}

function insertIncludePath(filePath: string) {
  //
  // this function will add globalIncludePath to the includePath list in the
  // c_cpp_properties.json passed in, it will be added to the end of
  // the includePath list.
  //
  // globalIncludePath is initialized in vcastInstallation.ts
  //
  // I'm handling a few error cases here without going crazy
  //
  let statusMessages: string[] = [];

  let existingJSON: any;
  let existingJSONasString: string;

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
    const numberOfConfigurations = existingJSON.configurations.length;
    statusMessages.push(
      `{configurationFile} file has ${numberOfConfigurations} configurations ... `
    );
  } else {
    statusMessages.push(
      `{configurationFile} file has no existing configurations, please add a configuration.   `
    );
    vscode.window.showErrorMessage(statusMessages.join("\n"));
    return;
  }

  // when we get here we should always have a configurations array,
  // to make things easier we will add the new include to the first config in the array
  let configName = existingJSON.configurations[0].name;
  // This configuration might now have includePath, so add it if its missing
  if (existingJSON.configurations[0].includePath == undefined) {
    statusMessages.push(
      `Configuration: "${configName}" is missing an includePath list, adding.  `
    );
    // we keep the existing JSON up to date to make the logic below simpler
    existingJSON.configurations[0].includePath = [];
  }

  let includePathList = existingJSON.configurations[0].includePath;
  let whereToInsert = existingJSON.configurations[0].includePath.length;

  // if the user updated versions of VectorCAST, we might have an "old" include path that needs to be removed
  const indexToRemove = includePathList.findIndex((element: string) =>
    element.includes(vUnitIncludeSuffix)
  );
  if (indexToRemove >= 0) {
    const oldPath = includePathList[indexToRemove];
    const jsoncEdits = jsonc.modify(
      existingJSONasString,
      ["configurations", 0, "includePath", indexToRemove],
      undefined,
      jsoncModificationOptions
    );
    existingJSONasString = jsonc.applyEdits(existingJSONasString, jsoncEdits);
    statusMessages.push(
      `Removed: ${oldPath} from configuration: "${configName}".  `
    );
  }

  const jsoncEdits = jsonc.modify(
    existingJSONasString,
    ["configurations", 0, "includePath", whereToInsert],
    globalIncludePath,
    jsoncModificationOptions
  );
  existingJSONasString = jsonc.applyEdits(existingJSONasString, jsoncEdits);
  statusMessages.push(
    `Added: ${globalIncludePath} to configuration: "${configName}".  `
  );

  vscode.window.showInformationMessage(statusMessages.join("\n"));

  // we unconditionally write rather than tracking if we changed anything
  fs.writeFileSync(filePath, existingJSONasString);
}

function convertTestScriptContents(scriptPath: string) {
  // Read the file
  let originalLines = fs.readFileSync(scriptPath).toString().split(os.EOL);
  let newLines: string[] = [];

  // Modify the lines
  for (let line of originalLines) {
    if (line == "TEST.NEW") {
      line = "TEST.REPLACE";
    }
    newLines.push(line);
  }

  // Join the modified lines back into a single string
  const modifiedContent = newLines.join("\n");

  // Write the modified content back to the file
  fs.writeFileSync(scriptPath, modifiedContent, "utf8");
}

export async function openTestScript(nodeID: string) {
  // this can get called for a unit, environment, function, or test

  const testNode: testNodeType = getTestNode(nodeID);
  const scriptPath = testNode.enviroPath + ".tst";

  const commandStatus = await dumpTestScriptFile(testNode, scriptPath);

  if (commandStatus.errorCode == 0) {
    // Improvement needed:
    // It would be nice if vcast generated the scripts with TEST.REPLACE, but for now
    // convert TEST.NEW to TEST.REPLACE so doing an "immediate load" works without error
    convertTestScriptContents(scriptPath);

    // open the script file for editing
    vscode.workspace.openTextDocument(scriptPath).then(
      (doc: vscode.TextDocument) => {
        vscode.window.showTextDocument(doc);
      },
      (error: any) => {
        vectorMessage(error);
      }
    );
  }
}

export async function adjustScriptContentsBeforeLoad(scriptPath: string) {
  // There are some things that need updating before we can load the
  // script into VectorCAST:
  //   - The requirement key lines need to be split into two lines
  //     We insert lines like TEST.REQUIREMENT_KEY: key | description,
  //     but VectorCAST only allows the key, so we turn the description
  //     into a comment.
  //
  //   - <might be more things to do later>

  let originalLines = fs.readFileSync(scriptPath).toString().split("\n");
  let newLines: string[] = [];
  for (let line of originalLines) {
    if (line.startsWith("TEST.REQUIREMENT_KEY:")) {
      const keyLineParts = line.split("|");
      if (keyLineParts.length == 2) {
        newLines.push("-- Requirement Title: " + keyLineParts[1]);
        newLines.push(keyLineParts[0].trim());
      } else {
        newLines.push(line);
      }
    } else {
      newLines.push(line);
    }
  }
  fs.writeFileSync(scriptPath, newLines.join("\n"), "utf8");
}

export function generateAndLoadBasisPathTests(testNode: testNodeType) {
  // This can be called for any node, including environment nodes
  // In all cases, we need to do the following:
  //  - Call clicast <-e -u -s options> tool auto_test temp.tst  [creates tests]
  //  - Call loadTestScriptIntoEnvironment() to do the actual load
  //
  // Other Points:
  //   - Use a temporary filename and ensure we delete it

  const enclosingDirectory = path.dirname(testNode.enviroPath);
  const timeStamp = Date.now().toString();
  const tempScriptPath = path.join(
    enclosingDirectory,
    `vcast-${timeStamp}.tst`
  );

  vectorMessage("Generating Basis Path script file ...");
  // ignore the testName (if any)
  testNode.testName = "";

  runBasisPathCommands(testNode, tempScriptPath, loadScriptCallBack);
}

export function generateAndLoadATGTests(testNode: testNodeType) {
  // This can be called for any node, including environment nodes
  // In all cases, we need to do the following:
  //  - Call atg <-e -u -s options> temp.tst  [creates tests]
  //  - Call loadTestScriptIntoEnvironment() to do the actual load

  // Other points:
  //   - Use a temporary filename and ensure we delete it.
  //   - ATG can be slowish, so we need a status dialog

  const enclosingDirectory = path.dirname(testNode.enviroPath);
  const timeStamp = Date.now().toString();
  const tempScriptPath = path.join(
    enclosingDirectory,
    `vcast-${timeStamp}.tst`
  );

  vectorMessage("Generating ATG script file ...");
  // ignore the testName (if any)
  testNode.testName = "";

  runATGCommands(testNode, tempScriptPath, loadScriptCallBack);
}

export enum testStatus {
  didNotRun,
  compileError,
  linkError,
  passed,
  failed,
}

export function openTestFileAndErrors(testNode: testNodeType): testStatus {
  // used to show the coded test source file and associated
  // compile or link errors when a coded test "add" or execution fails.

  // because vcast does not give us a unique error code for coded test
  // compile or link errors, we need to check the timestamps of the
  // the ACOMPILE.LIS and AALINKER.LIS to figure out which one is newer

  let returnStatus: testStatus = testStatus.compileError;

  const compileErrorFile = path.join(testNode.enviroPath, "ACOMPILE.LIS");
  const linkErrorFile = path.join(testNode.enviroPath, "AALINKER.LIS");

  let compileModTime = 0;
  if (fs.existsSync(compileErrorFile)) {
    compileModTime = fs.statSync(compileErrorFile).mtime.getTime();
  }
  let linkModTime = 0;
  if (fs.existsSync(linkErrorFile)) {
    linkModTime = fs.statSync(linkErrorFile).mtime.getTime();
  }

  let fileToDisplay = compileErrorFile;
  if (compileModTime < linkModTime) {
    fileToDisplay = linkErrorFile;
    returnStatus = testStatus.linkError;
  }

  openFileWithLineSelected(testNode.testFile, testNode.testStartLine - 1);
  openFileWithLineSelected(fileToDisplay, 0, vscode.ViewColumn.Beside);

  return returnStatus;
}

export async function closeAnyOpenErrorFiles() {
  // this function will close any left over ACOMPILE.LIS or AALINKER.LIS files
  // from the last test execution.
  for (let editor of vscode.window.visibleTextEditors) {
    if (
      editor.document.fileName.endsWith("ACOMPILE.LIS") ||
      editor.document.fileName.endsWith("AALINKER.LIS")
    ) {
      await vscode.window.showTextDocument(editor.document.uri, {
        preview: false,
        viewColumn: editor.viewColumn,
      });
      await vscode.commands.executeCommand(
        "workbench.action.closeActiveEditor"
      );
    }
  }
}

export function getEnviroNameFromFile(filePath: string): string | undefined {
  // This function will extract the enviro name from
  // the ENVIRO.NAME: <name> line of the provided file

  let enviroName: string | undefined = undefined;

  // load the contents of filePath, find the ENVIRO.NAME: line
  // and return the value after the colon
  const fileContents = fs.readFileSync(filePath).toString();
  const lines = fileContents.split("\n");
  for (let line of lines) {
    if (line.startsWith("ENVIRO.NAME:")) {
      enviroName = line.split(":")[1].trim();
      break;
    }
  }

  return enviroName;
}

function getTestArgument(testID: string, withFlag: boolean): string {
  // This function will generate the --test argument for the vpython command
  // with or without the --test flag based on the withFlag parameter

  let testArgument = undefined;
  if (testID.length > 0) {
    // we need to strip the "path part" of the environment directory from the test ID
    // which is the part before the '|' and after the ':'
    const enviroPath = testID.split("|")[0].split(":")[1];

    // now the path to the environment might have a slash if the environment is nested or not
    // so we need to handle that case, since we only want the environment name
    let enviroName = enviroPath;
    if (enviroName.includes("/")) {
      enviroName = enviroPath.substring(
        enviroPath.lastIndexOf("/") + 1,
        enviroPath.length
      );
    }
    // The -test arguments should be the enviro name along with everything after the |
    testArgument = withFlag ? "--test=" : "";
    testArgument += `"${enviroName}|${testID.split("|")[1]}"`;
  }

  return testArgument || "";
}

function getCommonCommandString(
  command: vcastCommandType,
  enviroPath: string
): string {
  return `${vPythonCommandToUse} ${globalTestInterfacePath} --mode=${command.toString()} --clicast=${clicastCommandToUse} --path=${enviroPath}`;
}

export function getVcastInterfaceCommand(
  command: vcastCommandType,
  enviroPath: string,
  testID: string = ""
): string {
  //
  // This function generates the vpython command to execute
  //
  // enviroPath is the absolute path to the environnement directory
  // testID is contains the string that uniquely identifies the node, something like:
  //    vcast:TEST|manager.Manager::PlaceOrder.test-Manager::PlaceOrder
  //    vcast:unitTests/MANAGER|manager.Manager::PlaceOrder.test-Manager::PlaceOrder

  // we always include --clicast rather than checking if it is needed or not
  const commandToRun = getCommonCommandString(command, enviroPath);
  const testArgument = getTestArgument(testID, true);
  return `${commandToRun} ${testArgument}`;
}

/**
 * Generates the command to interface with MCDC coverage tools.
 *
 * @param {vcastCommandType} command - The type of command to execute.
 * @param {string} enviroPath - The path to the environment.
 * @param {string} unitName - The unit name.
 * @param {number} lineNumber - The specific line number for the MCDC report.
 * @returns {string} The fully constructed command string to execute the MCDC interface.
 */
export function getVcastInterfaceCommandForMCDC(
  command: vcastCommandType,
  enviroPath: string,
  unitName: string,
  lineNumber: number
) {
  const commandToRun = `${vPythonCommandToUse} ${globalTestInterfacePath}  --mode=${command.toString()} --clicast=${clicastCommandToUse} --path=${enviroPath}`;
  let optionsDict: { [command: string]: string | number } = {};
  optionsDict["unitName"] = unitName;
  optionsDict["lineNumber"] = lineNumber;
  const jsonOptions: string = JSON.stringify(optionsDict).replaceAll(
    '"',
    '\\"'
  );
  const testArgument = `--options="${jsonOptions}"`;
  return `${commandToRun} ${testArgument}`;
}

/**
 * Generates the command to get all mcdc coverage lines in an env.
 * @param enviroName Name of env.
 * @returns Command to get all mcdc coverage lines in an env.
 */
export function getMCDCLineCoverageCommand(enviroPath: string) {
  const commandToRun = `${vPythonCommandToUse} ${globalMCDCReportPath}  --env=${enviroPath}`;
  return commandToRun;
}

export function getClientRequestObject(
  command: vcastCommandType,
  path: string,
  testID: string = ""
): clientRequestType {
  //
  // Rather than adding another "dontUseQuotes" param I just strip them here
  const testArgWithQuotes = getTestArgument(testID, false);
  const testArgWithoutQuotes = testArgWithQuotes.substring(
    1,
    testArgWithQuotes.length - 1
  );
  const requestObject: clientRequestType = {
    command: command,
    path: path,
    test: testArgWithoutQuotes,
  };

  return requestObject;
}

export function getRebuildOptionsString(): string {
  // this returns the --options=jsonString that is used to rebuild the environment

  // read the settings that affect enviro build
  const settings = vscode.workspace.getConfiguration("vectorcastTestExplorer");
  let optionsDict: { [command: string]: string | boolean } = {};
  optionsDict["ENVIRO.COVERAGE_TYPE"] = settings.get(
    "build.coverageKind",
    "None"
  );
  const jsonOptions: string = JSON.stringify(optionsDict);

  return jsonOptions;
}
