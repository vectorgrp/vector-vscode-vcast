import * as vscode from "vscode";

// Needed for parsing json files with comments
import * as jsonc from "jsonc-parser";
import { loadScriptCallBack } from "./callbacks";
import { vectorMessage } from "./messagePane";
import { getTestNode, type testNodeType } from "./testData";
import {
  jsoncModificationOptions,
  jsoncParseErrors,
  jsoncParseOptions,
  openFileWithLineSelected,
} from "./utilities";
import {
  dumptestScriptFile,
  runATGCommands,
  runBasisPathCommands,
} from "./vcastAdapter";
import {
  clicastCommandToUse,
  configFileContainsCorrectInclude,
  globalIncludePath,
  globalTestInterfacePath,
  vPythonCommandToUse,
  vUnitIncludeSuffix,
} from "./vcastInstallation";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

export function addIncludePath(fileUri: vscode.Uri) {
  // This small wrapper just checks if we really need to add the include path
  // and if so calls insertIncludePath.  We intentionally don't turn off
  // the right click menu if we find the include path during initialization
  // because that would lock the user out if there is an error in the init stuff

  const filePath = fileUri.fsPath;
  if (configFileContainsCorrectInclude(filePath)) {
    vscode.window.showInformationMessage(
      `${filePath} already contains the correct include path.  `
    );
  } else {
    insertIncludePath(filePath);
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
  const statusMessages: string[] = [];

  let existingJSON: any;
  let existingJSONasString: string;

  // Requires json-c parsing to handle comments etc.
  existingJSONasString = fs.readFileSync(filePath).toString();
  // Note that jsonc.parse returns "real json" without the comments
  existingJSON = jsonc.parse(
    existingJSONasString,
    jsoncParseErrors,
    jsoncParseOptions
  );

  if (existingJSON?.configurations && existingJSON.configurations.length > 0) {
    const numberOfCofigurations = existingJSON.configurations.length;
    statusMessages.push(
      `{configurationFile} file has ${numberOfCofigurations} configurations ... `
    );
  } else {
    statusMessages.push(
      `{configurationFile} file has no existing configurations, please add a configuration.   `
    );
    vscode.window.showErrorMessage(statusMessages.join("\n"));
    return;
  }

  // When we get here we should always have a configurations array,
  // to make things easier we will add the new include to the first config in the array
  const configName = existingJSON.configurations[0].name;
  // This configuration might now have includePath, so add it if its missing
  if (existingJSON.configurations[0].includePath == undefined) {
    statusMessages.push(
      `Configuration: "${configName}" is missing an includePath list, adding.  `
    );
    // We keep the existing JSON up to date to make the logic below simpler
    existingJSON.configurations[0].includePath = [];
  }

  const includePathList = existingJSON.configurations[0].includePath;
  const whereToInsert = existingJSON.configurations[0].includePath.length;

  // If the user updated versions of VectorCAST, we might have an "old" include path that needs to be removed
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

  // We unconditionally write rather than tracking if we changed anything
  fs.writeFileSync(filePath, existingJSONasString);
}

function convertTestScriptContents(scriptPath: string) {
  // Read the file
  const originalLines = fs.readFileSync(scriptPath).toString().split(os.EOL);
  const newLines: string[] = [];

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
  // This can get called for a unit, environment, function, or test

  const testNode: testNodeType = getTestNode(nodeID);
  const scriptPath = testNode.enviroPath + ".tst";

  const commandStatus = dumptestScriptFile(testNode, scriptPath);

  if (commandStatus.errorCode == 0) {
    // Improvement needed:
    // It would be nice if vcast generated the scripts with TEST.REPLACE, but for now
    // convert TEST.NEW to TEST.REPLACE so doing an "immediate load" works without error
    convertTestScriptContents(scriptPath);

    // Open the script file for editing
    vscode.workspace.openTextDocument(scriptPath).then(
      (document: vscode.TextDocument) => {
        vscode.window.showTextDocument(document);
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

  const originalLines = fs.readFileSync(scriptPath).toString().split("\n");
  const newLines: string[] = [];
  for (const line of originalLines) {
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
  // In all caeses, we need to do the following:
  //  - Call clicast <-e -u -s options> tool auto_test temp.tst  [creates tests]
  //  - Call loadScriptIntoEnvironment() to do the actual load
  //
  // Other Points:
  //   - Use a temporary filename and ensure we delete it

  const enclosingDirectory = path.dirname(testNode.enviroPath);
  const timeStamp = Date.now().toString();
  const temporaryScriptPath = path.join(
    enclosingDirectory,
    `vcast-${timeStamp}.tst`
  );

  vectorMessage("Generating Basis Path script file ...");
  // ignore the testName (if any)
  testNode.testName = "";

  runBasisPathCommands(testNode, temporaryScriptPath, loadScriptCallBack);
}

export function generateAndLoadATGTests(testNode: testNodeType) {
  // This can be called for any node, including environment nodes
  // In all caeses, we need to do the following:
  //  - Call atg <-e -u -s options> temp.tst  [creates tests]
  //  - Call loadScriptIntoEnvironment() to do the actual load

  // Other points:
  //   - Use a temporary filename and ensure we delete it.
  //   - ATG can be slowish, so we need a status dialog

  const enclosingDirectory = path.dirname(testNode.enviroPath);
  const timeStamp = Date.now().toString();
  const temporaryScriptPath = path.join(
    enclosingDirectory,
    `vcast-${timeStamp}.tst`
  );

  vectorMessage("Generating ATG script file ...");
  // ignore the testName (if any)
  testNode.testName = "";

  runATGCommands(testNode, temporaryScriptPath, loadScriptCallBack);
}

export enum testStatus {
  didNotRun,
  compileError,
  linkError,
  passed,
  failed,
}

export function openTestFileAndErrors(testNode: testNodeType): testStatus {
  // Used to show the coded test source file and associated
  // compile or link errors when a coded test "add" or execution fails.

  // because vcast does not give us a unique error code for coded test
  // compile or link errors, we need to check the timestamps of the
  // the ACOMPILE.LIS and AALINKER.LIS to figure out which one is newer

  let returnStatus: testStatus = testStatus.compileError;

  const compileErrorFile = path.join(testNode.enviroPath, "ACOMPILE.LIS");
  const linkErrorFile = path.join(testNode.enviroPath, "AALINKER.LIS");

  let compileModuleTime = 0;
  if (fs.existsSync(compileErrorFile)) {
    compileModuleTime = fs.statSync(compileErrorFile).mtime.getTime();
  }

  let linkModuleTime = 0;
  if (fs.existsSync(linkErrorFile)) {
    linkModuleTime = fs.statSync(linkErrorFile).mtime.getTime();
  }

  let fileToDisplay = compileErrorFile;
  if (compileModuleTime < linkModuleTime) {
    fileToDisplay = linkErrorFile;
    returnStatus = testStatus.linkError;
  }

  openFileWithLineSelected(testNode.testFile, testNode.testStartLine - 1);
  openFileWithLineSelected(fileToDisplay, 0, vscode.ViewColumn.Beside);

  return returnStatus;
}

export async function closeAnyOpenErrorFiles() {
  // This function will close any left over ACOMPILE.LIS or AALINKER.LIS files
  // from the last test execution.
  for (const editor of vscode.window.visibleTextEditors) {
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
  // This funciton will extract the enviro name from
  // the ENVIRO.NAME: <name> line of the provided file

  let enviroName: string | undefined;

  // Load the contents of filePath, find the ENVIRO.NAME: line
  // and return the value after the colon
  const fileContents = fs.readFileSync(filePath).toString();
  const lines = fileContents.split("\n");
  for (const line of lines) {
    if (line.startsWith("ENVIRO.NAME:")) {
      enviroName = line.split(":")[1].trim();
      break;
    }
  }

  return enviroName;
}

export function testInterfaceCommand(
  mode: string,
  enviroPath: string,
  testID = ""
): any | undefined {
  // EnviroPath is the absolute path to the environnement directory
  // testID is contains the string that uniquely identifies the node, something like:
  //    vcast:TEST|manager.Manager::PlaceOrder.test-Manager::PlaceOrder
  //    vcast:unitTests/MANAGER|manager.Manager::PlaceOrder.test-Manager::PlaceOrder
  //

  if (globalTestInterfacePath && vPythonCommandToUse) {
    const command = `${vPythonCommandToUse} ${globalTestInterfacePath} --mode=${mode} --clicast=${clicastCommandToUse} --path=${enviroPath}`;
    let testArgument = "";
    if (testID.length > 0) {
      // We need to strip the "path part" of the environment directory from the test ID
      // which is the part before the '|' and after the ':'
      const enviroPath = testID.split("|")[0].split(":")[1];

      // Now the path to the environment might have a slash if the environment is nested or not
      // so we need to handle that case, since we only want the environment name
      let enviroName = enviroPath;
      if (enviroName.includes("/")) {
        enviroName = enviroPath.substring(
          enviroPath.lastIndexOf("/") + 1,
          enviroPath.length
        );
      }

      // The -test arguments should be the enviro name along with everything after the |
      testArgument = ` --test="${enviroName}|${testID.split("|")[1]}"`;
    }

    return command + testArgument;
  }

  vscode.window.showWarningMessage(
    "The VectorCAST Test Explorer could not find the vpython utility."
  );
  return undefined;
}

export function parseCBTCommand(filePath: string): string {
  // This command returns the list of tests that exist in a coded test source file
  return `${vPythonCommandToUse} ${globalTestInterfacePath} --mode=parseCBT --path=${filePath}`;
}

export function rebuildEnvironmentCommand(filePath: string): string {
  // This command performs the environment rebuild, including the update of the .env file

  // read the settings that affect enviro build
  const settings = vscode.workspace.getConfiguration("vectorcastTestExplorer");
  const optionsDictionary: Record<string, string | boolean> = {};
  optionsDictionary["ENVIRO.COVERAGE_TYPE"] = settings.get(
    "build.coverageKind",
    "None"
  );

  const jsonOptions: string = JSON.stringify(optionsDictionary);
  return `${vPythonCommandToUse} ${globalTestInterfacePath} --clicast=${clicastCommandToUse} --mode=rebuild --path=${filePath} --options=${jsonOptions}`;
}
