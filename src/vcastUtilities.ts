import * as vscode from "vscode";

// needed for parsing json files with comments
import * as jsonc from "jsonc-parser";

import { loadScriptCallBack } from "./callbacks";

import { vectorMessage } from "./messagePane";

import {
  environmentDataCache,
  environmentNodeDataType,
  getEnviroNodeData,
  getTestNode,
  testNodeType,
} from "./testData";

import {
  jsoncModificationOptions,
  jsoncParseErrors,
  jsoncParseOptions,
  openFileWithLineSelected,
} from "./utilities";

import {
  dumpTestScriptFile,
  getDataForEnvironmentFromAPI,
  openProjectInVcast,
  runATGCommands,
  runBasisPathCommands,
} from "./vcastAdapter";

import { cleanProjectEnvironment } from "./manage/manageSrc/manageCommands";

import {
  atgCommandToUse,
  clicastCommandToUse,
  configFileContainsCorrectInclude,
  globalIncludePath,
  globalMCDCReportPath,
  globalTestInterfacePath,
  vPythonCommandToUse,
  vUnitIncludeSuffix,
} from "./vcastInstallation";

import { clientRequestType, vcastCommandType } from "../src-common/vcastServer";
import {
  cachedWorkspaceEnvData,
  globalController,
  globalProjectDataCache,
  globalProjectMap,
  globalUnusedCompilerList,
  globalUnusedTestsuiteList,
  nodeKind,
  vcastTestItem,
} from "./testPane";
import { tempScriptCache } from "./vcastTestInterface";

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

export async function generateAndLoadBasisPathTests(testNode: testNodeType) {
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

  // cache this path so we know it’s temporary
  tempScriptCache.add(tempScriptPath);

  vectorMessage("Generating Basis Path script file ...");
  // ignore the testName (if any)
  testNode.testName = "";

  runBasisPathCommands(testNode, tempScriptPath, loadScriptCallBack);
}

export async function generateAndLoadATGTests(testNode: testNodeType) {
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

  // cache this path so we know it’s temporary
  tempScriptCache.add(tempScriptPath);

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
    const enviroPath = testID.split("|")[0].split("vcast:")[1];

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

/**
 * Function to retrieve the Combobox items for the webview when creating an env in a project
 * @param projectFile Path to Project File
 * @returns 2 Lists containing the project compilers and testsuites
 */
export function getWebviewComboboxItems(projectFile: string) {
  let comboBoxList: { compilers: string[]; testsuites: string[] } = {
    compilers: [],
    testsuites: [],
  };
  let compilerList: string[] = [];
  let testsuiteList: string[] = [];

  const enviroData = globalProjectDataCache.get(projectFile);

  if (enviroData) {
    for (let [, envData] of enviroData) {
      if (!compilerList.includes(envData.compiler.name)) {
        compilerList.push(envData.compiler.name);
      }

      for (let testsuiteName of envData.compiler.testsuites) {
        if (!testsuiteList.includes(testsuiteName)) {
          testsuiteList.push(testsuiteName);
        }
      }
    }
  }

  // Include empty / unused compilers
  for (let compiler of globalUnusedCompilerList) {
    if (!compilerList.includes(compiler.displayName)) {
      compilerList.push(compiler.displayName);
    }
  }

  // Include empty / unused testSuites
  for (let testsuite of globalUnusedTestsuiteList) {
    const testsuiteName = path.basename(testsuite.displayName);
    if (!testsuiteList.includes(testsuiteName)) {
      testsuiteList.push(testsuiteName);
    }
  }

  comboBoxList.compilers = compilerList;
  comboBoxList.testsuites = testsuiteList;

  return comboBoxList;
}

/**
 * Checks if the current Environment is part of a Project or not
 * @param enviroPath Path to Environment
 * @returns True if the Environment is part of a Project, False otherwise
 */
export function envIsEmbeddedInProject(enviroPath: string) {
  for (let envData of environmentDataCache.values()) {
    if (envData.buildDirectory === enviroPath && envData.projectPath !== "") {
      return true;
    }
  }
  return false;
}

/**
 * Checks if the current Environment is part of a Project or not
 * @param enviroPath Path to Environment
 * @returns True if the Environment is part of a Project, False otherwise
 */
export function checkIfAnyProjectsAreOpened() {
  for (let envData of environmentDataCache.values()) {
    if (envData.projectPath !== "") {
      return true;
    }
  }

  // In case we have empty projects without envs in it
  if (
    typeof globalProjectDataCache !== "undefined" &&
    globalProjectDataCache.size > 0
  ) {
    return true;
  }

  return false;
}

/**
 * Returns the Project file name and the Root path of the Project based
 * on the full path of the Project File
 * @param fullPath Full Path to the Project File
 */
export function getVcmRoot(fullPath: string) {
  // pre-compile the regex once
  const vcmRe = /(.*\/)([^/]+\.vcm)(?:\/.*)?$/;

  // use exec() instead of match() (sonarcloud)
  const match = vcmRe.exec(fullPath);

  if (match) {
    // match[1] is the directory (with trailing slash), match[2] is the .vcm name
    const rootPath = match[1].replace(/\/$/, "");
    const vcmName = match[2];
    return { rootPath, vcmName };
  }

  return null;
}
/**
 * Opens the Project based on the Environment path if the Environment is part of a Project
 * @param enviroPath Path to the Environment
 */
export async function openProjectFromEnviroPath(enviroPath: string) {
  for (let envData of environmentDataCache.values()) {
    if (envData.buildDirectory === enviroPath) {
      const result = getVcmRoot(envData.projectPath);
      if (result) {
        const { rootPath, vcmName } = result;
        await openProjectInVcast(rootPath, vcmName);
      }
    }
  }
}

/**
 * Checks if a Environment is build in mutle Testsuites
 * @param enviroName Name of the Environment
 * @returns True, if the Environment is build in multiple Testsuites, False otherwise
 */
export async function checkIfEnvironmentIsBuildMultipleTimes(
  enviroName: string
) {
  let count = 0;
  for (let envData of environmentDataCache.values()) {
    const currentEnviroName = path.basename(envData.buildDirectory);
    if (enviroName === currentEnviroName && envData.isBuilt === true) {
      count++;
    }
  }
  return count > 1;
}

/**
 * Deletes all build folders for an environment within a project except for the one
 * corresponding to the current Testsuite. When an environment is built in multiple
 * Testsuites, synchronization issues can occur during project updates. This function
 * removes the other build folders so that the project update can proceed with
 * only the current environment build.
 *
 * @param enviroPath - The file system path of the environment that is being updated.
 */
export async function deleteOtherBuildFolders(
  enviroPath: string
): Promise<void> {
  const givenEnviroName = path.basename(enviroPath);
  for (let envData of environmentDataCache.values()) {
    const currentEnviroPath = envData.buildDirectory;
    const currentEnviroName = path.basename(currentEnviroPath);
    if (
      givenEnviroName === currentEnviroName &&
      currentEnviroPath !== enviroPath &&
      envData.isBuilt === true
    ) {
      // Normalize path to use forward slashes for a consistent enviroNodeID
      const normalizedCurrentEnviroPath = currentEnviroPath.replace(/\\/g, "/");
      const enviroNodeID = "vcast:" + normalizedCurrentEnviroPath;

      const enviroData: environmentNodeDataType = getEnviroNodeData(
        normalizedCurrentEnviroPath
      );

      await cleanProjectEnvironment(
        enviroPath,
        enviroNodeID,
        enviroData.projectPath,
        enviroData.displayName
      );
    }
  }
}

/**
 * Checks if all Testsuites from the project are also present in the test pane
 * If Testsuites are empty, they will be created here
 */
export function ensureTestsuiteNodes() {
  globalUnusedTestsuiteList.forEach((item) => {
    const parts = item.displayName.split("/");
    if (parts.length !== 2) {
      vectorMessage(`Invalid testsuite format: ${item.displayName}`);
      return;
    }

    const compilerName = parts[0];
    const testsuiteName = parts[1];
    const projectFile = item.projectFile;

    if (!projectFile) {
      vectorMessage(
        `Testsuite "${testsuiteName}" could not be connected with a Project`
      );
      return;
    }

    // Find the project node from the projectFile
    let projectNode: vcastTestItem | undefined =
      globalProjectMap.get(projectFile);

    if (!projectNode) {
      vectorMessage(`No project node found for "${projectFile}"`);
      return;
    }

    // Search for the compiler node only inside this project node
    let compilerNode: vcastTestItem | undefined;
    projectNode.children.forEach((child) => {
      const testItem = child as vcastTestItem;
      if (
        testItem.nodeKind === nodeKind.compiler &&
        typeof testItem.label === "string" &&
        testItem.label === compilerName
      ) {
        compilerNode = testItem;
      }
    });

    if (!compilerNode) {
      vectorMessage(
        `No compiler node found for "${compilerName}" in project "${projectNode.label}"`
      );
      return;
    }

    // Create the testsuite node if it doesn’t exist
    const testsuiteNodeId = `${compilerNode.id}/${testsuiteName}`;
    let testsuiteNode = compilerNode.children.get(
      testsuiteNodeId
    ) as vcastTestItem;

    if (!testsuiteNode) {
      testsuiteNode = globalController.createTestItem(
        testsuiteNodeId,
        testsuiteName
      ) as vcastTestItem;
      testsuiteNode.nodeKind = nodeKind.testsuite;
      compilerNode.children.add(testsuiteNode);
    }
  });
}

/**
 * Ensures that all compiler nodes from the globalUnusedCompilerList are present
 * in the test pane. Each item in globalUnusedCompilerList is expected to have a
 * displayName property (e.g. "GNU") and the name of the projectFile.
 * If a compiler node is not found, it is created.
 */
export function ensureCompilerNodes() {
  globalUnusedCompilerList.forEach((item) => {
    const compilerName = item.displayName; // e.g. "GNU"
    const projectFile = item.projectFile; // e.g. "/path/to/project.vcm"

    // Attempt to find the project node.
    // If you have a globalProjectMap keyed by project file, use it:
    let projectNode: vcastTestItem | undefined =
      globalProjectMap.get(projectFile);
    if (!projectNode) {
      // If project node doesn't exist, create a new one.
      // This gets triggered when we have a project without envs but with a compiler
      const projectDisplayName = path.basename(projectFile);
      projectNode = globalController.createTestItem(
        projectFile,
        projectDisplayName
      ) as vcastTestItem;
      projectNode.nodeKind = nodeKind.project;
      globalController.items.add(projectNode);
      globalProjectMap.set(projectFile, projectNode);
    }

    // If no project node exists, do nothing.
    if (!projectNode) {
      vectorMessage(
        `Project node for "${projectFile}" not found. Skipping compiler "${compilerName}".`
      );
      return;
    }

    // Check if a compiler node with the given displayName already exists under the project node.
    let compilerNode: vcastTestItem | undefined;
    projectNode.children.forEach((child) => {
      const testItem = child as vcastTestItem;
      if (
        testItem.nodeKind === nodeKind.compiler &&
        typeof testItem.label === "string" &&
        testItem.label === compilerName
      ) {
        compilerNode = testItem;
      }
    });

    // If the compiler node doesn't exist, create and add it.
    if (!compilerNode) {
      // Construct an ID for the compiler node. For example, use the projectFile and compilerName.
      const compilerNodeId = `${projectFile}/${compilerName}`;
      compilerNode = globalController.createTestItem(
        compilerNodeId,
        compilerName
      ) as vcastTestItem;
      compilerNode.nodeKind = nodeKind.compiler;
      projectNode.children.add(compilerNode);
    }
  });
}

export function getLevelFromNodeId(path: string) {
  const marker = ".vcm";
  const markerIndex = path.lastIndexOf(marker);

  if (markerIndex === -1) {
    // Marker not found; handle as needed.
    return { projectName: "", level: "" };
  }

  // Determine the project name by finding the preceding slash (if any)
  const slashBefore = path.lastIndexOf("/", markerIndex);
  let projectName;
  if (slashBefore === -1) {
    projectName = path.substring(0, markerIndex + marker.length);
  } else {
    projectName = path.substring(slashBefore + 1, markerIndex + marker.length);
  }

  // Start right after the marker; skip a slash if present
  let remainderStart = markerIndex + marker.length;
  if (path[remainderStart] === "/" || path[remainderStart] === "\\") {
    remainderStart++;
  }
  const level = path.substring(remainderStart);

  return { projectName, level };
}

/**
 * Retrieves Environment Data from the Cache or by asking the API if the cache
 * is empty
 * @param enviroPath Path of Environment
 */
export async function getEnvironmentData(enviroPath: string) {
  // Add .vce extension to enviroPath for cache key
  const cacheKey = enviroPath.endsWith(".vce")
    ? enviroPath
    : `${enviroPath}.vce`;

  // Try to get data from cache first
  let envData = null;
  if (cachedWorkspaceEnvData) {
    envData =
      cachedWorkspaceEnvData[cacheKey as keyof typeof cachedWorkspaceEnvData];
  }

  // If not in cache, fetch it
  if (!envData) {
    envData = await getDataForEnvironmentFromAPI(enviroPath);
  }

  return envData;
}

// ─── Boundary processor (pyatg #3285) ────────────────────────────────

export interface BoundaryCommand {
  command: string;
  envVars: Record<string, string>;
}

// Column order matches atg/solvers/boundary/support.py:OutputRow.MAPPING_FIELDS.
// nodeStr is the user-facing expression (e.g. "x", "arr[*]"); nodeType is
// its C type (e.g. "int", "samDeviceType*[4]"). inputSortStr is a coarser
// classification (often duplicates scope, but not always — keep both).
//
// The trailing structured fields (kind, signedness, bits, ...) are
// derived from `annotation` by deriveNodeShape() below. They give the
// webview an EDG-shaped view of the row without it having to regex
// the annotation string. When pyatg starts emitting a structured
// mapping.json (Phase 3), these will come straight from the EDG node
// and `annotation` becomes a diagnostic-only field.
export type NodeKind =
  | "scalar"
  | "array"
  | "pointer"
  | "functionPointer"
  | "complex";

export interface BoundaryMappingRow {
  origFile: string;
  unit: string;
  routine: string;
  scope: string;
  inputSortStr: string;
  disabledType: string;
  nodeStr: string;
  nodeType: string;
  testValueLine: string;
  annotation: string;

  // Structured shape (derived from annotation; pyatg-direct later).
  kind: NodeKind;
  signedness?: "S" | "U";
  bits?: number;
  arraySize?: number;
  elementOfNodeStr?: string;    // for arr[*] rows, parent array root nodeStr
  fieldOfNodeStr?: string;      // for pt.x rows, parent struct nodeStr "pt"
}

function buildBoundaryEnvVars(): Record<string, string> {
  const atgPathSetting = vscode.workspace
    .getConfiguration("vectorcastTestExplorer")
    .get<string>("atgPath", "");
  const envVars: Record<string, string> = {};
  if (atgPathSetting) {
    envVars["VCAST_ATG_PATH"] = atgPathSetting;
  }
  return envVars;
}

export function getBoundaryStageOneCommand(
  enviroPath: string,
  sheetFile: string
): BoundaryCommand {
  // sheetFile is just the seed path passed to --generate-ranges-sheet;
  // the actual outputs (inputs.xlsx, mapping.csv) land in its dirname.
  const envVars = buildBoundaryEnvVars();
  const command = `${atgCommandToUse} --generate-ranges-sheet ${sheetFile}`;
  return { command, envVars };
}

export function getBoundaryStageTwoCommand(
  enviroPath: string,
  sheetDir: string,
  scriptPath: string
): BoundaryCommand {
  // --from-ranges-sheet <dir> reads inputs.xlsx + mapping.csv (+ optional
  // Boundaries.csv) from <dir>; -v writes the .tst to scriptPath.
  const envVars = buildBoundaryEnvVars();
  const command = `${atgCommandToUse} --from-ranges-sheet ${sheetDir} -v ${scriptPath}`;
  return { command, envVars };
}

// Populate a row's structured-shape fields from its annotation string.
// pyatg's NodeAnnotation produces a `key:value;key:value` form (see
// atg/solvers/boundary/support.py:NodeAnnotation); we parse it back
// into typed fields the webview can consume directly. Once pyatg
// emits a structured mapping.json (Phase 3) this function gets
// replaced by a JSON deserialiser; the consumers stay the same.
function deriveNodeShape(row: BoundaryMappingRow): void {
  const annot = row.annotation || "";
  let sawScalar = false;
  let sawArray = false;
  let sawFnPtr = false;
  let sawPtr = false;
  for (const part of annot.split(";")) {
    if (!part) continue;
    const colon = part.indexOf(":");
    const key = colon >= 0 ? part.substring(0, colon) : part;
    const value = colon >= 0 ? part.substring(colon + 1) : "";
    if (key === "enum") {
      // Format: "S:32" or "U:8" possibly followed by ":{...}" literals.
      const tail = value.split(":");
      if (tail.length >= 2) {
        const sign = tail[0];
        const bits = parseInt(tail[1], 10);
        if (sign === "S" || sign === "U") row.signedness = sign;
        if (!Number.isNaN(bits)) row.bits = bits;
      }
      sawScalar = true;
    } else if (key === "arr") {
      const n = parseInt(value, 10);
      if (!Number.isNaN(n)) row.arraySize = n;
      sawArray = true;
    } else if (key === "ptr") {
      sawPtr = true;
    } else if (key === "fptr" || key === "func") {
      sawFnPtr = true;
    }
  }

  // Priority: array wins over scalar for the root row (nodeType has a
  // pointer/array shape too); functionPointer beats plain pointer.
  if (sawFnPtr) row.kind = "functionPointer";
  else if (sawArray) row.kind = "array";
  else if (sawScalar) row.kind = "scalar";
  else if (sawPtr) row.kind = "pointer";
  else row.kind = "complex";

  // Structural relationships derived from nodeStr.
  const ns = row.nodeStr || "";
  const arrEltMatch = ns.match(/^(.+)\[\*\]$/);
  if (arrEltMatch) row.elementOfNodeStr = arrEltMatch[1];
  const lastDot = ns.lastIndexOf(".");
  if (lastDot > 0) row.fieldOfNodeStr = ns.substring(0, lastDot);
}

// Phase-3 reader: prefer the structured JSON pyatg emits alongside
// mapping.csv. Schema is documented in
// atg/solvers/boundary/collector.py:dump_mapping_json — each entry
// carries the same legacy fields as a mapping.csv row plus EDG-shaped
// fields (kind / signedness / bits / arraySize / elementOfNodeStr /
// fieldOfNodeStr). Returns null if the file is absent or unparseable;
// callers fall back to parseBoundaryMappingCsv + deriveNodeShape().
export function parseBoundaryMappingJson(
  jsonPath: string
): BoundaryMappingRow[] | null {
  if (!fs.existsSync(jsonPath)) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  } catch {
    return null;
  }
  if (!parsed || !Array.isArray(parsed.nodes)) return null;

  const rows: BoundaryMappingRow[] = [];
  for (const n of parsed.nodes) {
    if (!n || typeof n.nodeStr !== "string") continue;
    const kind: NodeKind =
      n.kind === "scalar" ||
      n.kind === "array" ||
      n.kind === "pointer" ||
      n.kind === "functionPointer"
        ? n.kind
        : "complex";
    const row: BoundaryMappingRow = {
      origFile: String(n.origFile || ""),
      unit: String(n.unit || ""),
      routine: String(n.routine || ""),
      scope: String(n.scope || ""),
      inputSortStr: String(n.inputSortStr || ""),
      disabledType: String(n.disabledType || ""),
      nodeStr: String(n.nodeStr || ""),
      nodeType: String(n.nodeType || ""),
      testValueLine: String(n.testValueLine || ""),
      annotation: String(n.annotation || ""),
      kind,
    };
    if (n.signedness === "S" || n.signedness === "U") {
      row.signedness = n.signedness;
    }
    if (typeof n.bits === "number") row.bits = n.bits;
    if (typeof n.arraySize === "number") row.arraySize = n.arraySize;
    if (typeof n.elementOfNodeStr === "string" && n.elementOfNodeStr) {
      row.elementOfNodeStr = n.elementOfNodeStr;
    }
    if (typeof n.fieldOfNodeStr === "string" && n.fieldOfNodeStr) {
      row.fieldOfNodeStr = n.fieldOfNodeStr;
    }
    rows.push(row);
  }
  return rows;
}

export function parseBoundaryMappingCsv(
  mappingCsvPath: string
): BoundaryMappingRow[] {
  // mapping.csv is 10 columns, no header, comma-separated, no embedded commas
  // in production data — quote handling is intentionally simple.
  const text = fs.readFileSync(mappingCsvPath, "utf8");
  const rows: BoundaryMappingRow[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.length === 0) continue;
    const cols = rawLine.split(",");
    if (cols.length < 10) continue;
    const row: BoundaryMappingRow = {
      origFile: cols[0],
      unit: cols[1],
      routine: cols[2],
      scope: cols[3],
      inputSortStr: cols[4],
      disabledType: cols[5],
      nodeStr: cols[6],
      nodeType: cols[7],
      testValueLine: cols[8],
      annotation: cols.slice(9).join(","),
      kind: "complex",
    };
    deriveNodeShape(row);
    rows.push(row);
  }
  return rows;
}

// Iteration 1 ran in autogen mode (no Boundaries.csv).
// Iteration 2's manual flow uses these helpers to write the
// 8-column inputs.xlsx + a (deliberately empty) Boundaries.csv:
// pyatg keys on Boundaries.csv presence to flip into manual mode,
// then reads inputs.xlsx as 8-column CSV (it tries xlsx parsing first
// and silently falls back to CSV — see boundary/gentst.py::process_xls).

export interface BoundaryOverride {
  rowIndex: number;
  mode: "Auto" | "Fixed" | "Range" | "Named";
  skipAdj: boolean;
  value: string;
  lo: string;
  hi: string;
  // When mode === "Named", the name of a defined NamedRange. Empty
  // string for the other modes.
  namedRef?: string;
}

// Quote a CSV field per RFC 4180 if it contains comma, newline or quote.
function csvField(value: string): string {
  if (/[,\n\r"]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// Serialise one structured named range back to the text definition
// pyatg's Boundaries.csv expects:
//   - 0 valid sub-ranges  -> ""  (caller skips emitting the row)
//   - 1 sub-range, no sub-name -> bare "[lo, hi]" or "42"
//   - everything else      -> bundle "subname=val\nsubname=val"
//     (any missing sub-name auto-filled "<rangeName>_<index>"; pyatg
//     refuses anonymous entries inside a bundle)
function subRangeBare(s: SubRange): string {
  if (s.mode === "Range") {
    if (s.lo.trim() === "" || s.hi.trim() === "") return "";
    return `[${s.lo.trim()}, ${s.hi.trim()}]`;
  }
  return s.value.trim();
}

function namedRangeToDefinition(nr: NamedRange): string {
  const subs = (nr.subRanges || []).filter((s) => subRangeBare(s) !== "");
  if (subs.length === 0) return "";
  if (subs.length === 1 && subs[0].subName.trim() === "") {
    return subRangeBare(subs[0]);
  }
  return subs
    .map((s, i) => {
      const subName = s.subName.trim() || `${nr.name.trim()}_${i}`;
      return `${subName}=${subRangeBare(s)}`;
    })
    .join("\n");
}

// Translate a webview override into the boundary_type cell pyatg reads.
// Named-mode rows reference a class defined in Boundaries.csv by bare
// name; the other modes use inline values.
function boundaryTypeForOverride(o: BoundaryOverride): string {
  if (o.mode === "Fixed") return o.value;
  if (o.mode === "Range") return `[${o.lo}, ${o.hi}]`;
  if (o.mode === "Named") return o.namedRef || "<AUTO_GENERATE>";
  return "<AUTO_GENERATE>";
}

// ─── Persistence ──────────────────────────────────────────────────────
//
// We snapshot the user's editor state into .bp-sheets/overrides.json so
// a re-run of "Generate Boundary Tests for Unit" pre-populates the
// editor with last time's choices. Two pieces are persisted:
//
//   - per-row overrides, keyed by (origFile, scope, nodeStr) so they
//     survive row reordering when the source is edited;
//   - named ranges, a flat array of { name, definition } that map onto
//     pyatg's Boundaries.csv on stage 2.
//
// The file historically contained just the override array; the new
// shape is { namedRanges, overrides }. The loader accepts both so old
// .bp-sheets dirs continue to work.

const OVERRIDES_FILENAME = "overrides.json";

interface PersistedOverride {
  origFile: string;
  scope: string;
  nodeStr: string;
  mode: "Auto" | "Fixed" | "Range" | "Named";
  skipAdj: boolean;
  value: string;
  lo: string;
  hi: string;
  namedRef?: string;
}

// A named range is a top-level name and a list of structured sub-ranges.
// Each sub-range is either a single value or a [lo, hi] range, with an
// optional sub-name. Multi-sub bundles are pyatg's "name=value" form;
// single-sub anonymous bundles render as the bare value/range.
export interface SubRange {
  subName: string;
  mode: "Value" | "Range";
  value: string;
  lo: string;
  hi: string;
}

export interface NamedRange {
  name: string;
  subRanges: SubRange[];
}

export interface PersistedState {
  overrides: BoundaryOverride[];
  namedRanges: NamedRange[];
}

export function loadPersistedState(
  sheetDir: string,
  rows: BoundaryMappingRow[]
): PersistedState {
  const filePath = path.join(sheetDir, OVERRIDES_FILENAME);
  const empty: PersistedState = { overrides: [], namedRanges: [] };
  if (!fs.existsSync(filePath)) return empty;

  let parsed: any;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return empty;
  }

  // Forward-compat: accept both the old plain-array form and the new
  // object form.
  const rawOverrides: PersistedOverride[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.overrides)
      ? parsed.overrides
      : [];
  const rawNamed: NamedRange[] =
    parsed && Array.isArray(parsed.namedRanges) ? parsed.namedRanges : [];

  const indexByKey = new Map<string, number>();
  rows.forEach((r, idx) => {
    indexByKey.set(`${r.origFile}\x00${r.scope}\x00${r.nodeStr}`, idx);
  });

  const overrides: BoundaryOverride[] = [];
  for (const entry of rawOverrides) {
    const idx = indexByKey.get(
      `${entry.origFile}\x00${entry.scope}\x00${entry.nodeStr}`
    );
    if (idx === undefined) continue;
    overrides.push({
      rowIndex: idx,
      mode: entry.mode,
      skipAdj: !!entry.skipAdj,
      value: entry.value || "",
      lo: entry.lo || "",
      hi: entry.hi || "",
      namedRef: entry.namedRef || "",
    });
  }

  const namedRanges: NamedRange[] = rawNamed
    .filter((nr: any) => nr && typeof nr.name === "string")
    .map((nr: any) => {
      // New structured form.
      if (Array.isArray(nr.subRanges)) {
        return {
          name: String(nr.name),
          subRanges: nr.subRanges.map((s: any) => normalizeSubRange(s)),
        };
      }
      // Legacy form: { name, definition: "name=val\nname=val" or "[lo,hi]" }.
      const subs = bundleStringToSubRanges(String(nr.definition || ""));
      return { name: String(nr.name), subRanges: subs };
    });

  return { overrides, namedRanges };
}

function normalizeSubRange(s: any): SubRange {
  return {
    subName: String((s && s.subName) || ""),
    mode: s && s.mode === "Range" ? "Range" : "Value",
    value: String((s && s.value) || ""),
    lo: String((s && s.lo) || ""),
    hi: String((s && s.hi) || ""),
  };
}

// Convert a legacy text definition (`"name=value\nname=value"` or
// `"[lo, hi]"` or `"42"`) into structured sub-range entries. Best-
// effort: unparseable lines are kept as a Value entry holding the raw
// text so the user can still see what was there and fix it up.
function bundleStringToSubRanges(def: string): SubRange[] {
  const lines = def.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const out: SubRange[] = [];
  for (const line of lines) {
    let subName = "";
    let rest = line;
    const eq = line.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
    if (eq) {
      subName = eq[1];
      rest = eq[2].trim();
    }
    const range = rest.match(
      /^\[\s*(-?\d+|0x[0-9a-fA-F]+)\s*,\s*(-?\d+|0x[0-9a-fA-F]+)\s*\]$/
    );
    if (range) {
      out.push({ subName, mode: "Range", value: "", lo: range[1], hi: range[2] });
      continue;
    }
    // Single value fallback (keeps even malformed text so user can fix).
    out.push({ subName, mode: "Value", value: rest, lo: "", hi: "" });
  }
  return out;
}

export function savePersistedState(
  sheetDir: string,
  rows: BoundaryMappingRow[],
  overrides: BoundaryOverride[],
  namedRanges: NamedRange[]
): void {
  const persistedOverrides: PersistedOverride[] = [];
  for (const o of overrides) {
    const r = rows[o.rowIndex];
    if (!r) continue;
    persistedOverrides.push({
      origFile: r.origFile,
      scope: r.scope,
      nodeStr: r.nodeStr,
      mode: o.mode,
      skipAdj: o.skipAdj,
      value: o.value,
      lo: o.lo,
      hi: o.hi,
      namedRef: o.namedRef || "",
    });
  }
  const payload = {
    namedRanges,
    overrides: persistedOverrides,
  };
  const filePath = path.join(sheetDir, OVERRIDES_FILENAME);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

// Back-compat shim for callers that still import the old names.
export const loadPersistedOverrides = (
  sheetDir: string,
  rows: BoundaryMappingRow[]
) => loadPersistedState(sheetDir, rows).overrides;
export const savePersistedOverrides = (
  sheetDir: string,
  rows: BoundaryMappingRow[],
  overrides: BoundaryOverride[]
) => savePersistedState(sheetDir, rows, overrides, []);

export function writeManualInputsXlsx(
  sheetDir: string,
  rows: BoundaryMappingRow[],
  overrides: BoundaryOverride[],
  namedRanges: NamedRange[] = []
): { inputsPath: string; boundariesPath: string } {
  // IMPORTANT: emit ONLY the overridden rows. If we also include
  // <AUTO_GENERATE> rows for the non-overridden ones, pyatg's
  // validate_all_classes() trips for the still-autogen entries and the
  // whole run produces no tests. Non-overridden inputs are picked up
  // from the existing mapping.csv and treated as autogen even in
  // manual mode (Boundaries.csv-present mode).
  const lines: string[] = [];
  for (const o of overrides) {
    const r = rows[o.rowIndex];
    if (!r) continue;
    const boundaryType = boundaryTypeForOverride(o);
    // Convention from the manual-mode gold fixtures (e.g.
    // minus_one.c.gold.inputs.xlsx): "x" in the skip column means
    // "force ±1 adjustment off"; empty means "let pyatg decide".
    const skipAdj = o.skipAdj ? "x" : "";
    // 8-column manual schema: var_declared_in, scope, _, expression_name,
    // _, boundary_type, skip_adjustments, bsc_remarks. We use the
    // mapping row's scope verbatim because pyatg's proc_mapping_row
    // registers entities under the same key.
    lines.push(
      [
        csvField(r.origFile),
        csvField(r.scope),
        "",
        csvField(r.nodeStr),
        "",
        csvField(boundaryType),
        csvField(skipAdj),
        "",
      ].join(",")
    );
  }

  const inputsPath = path.join(sheetDir, "inputs.xlsx");
  // Overwrite the autogen 5-col xlsx with our 8-col CSV. pyatg opens it
  // first as xlsx, fails, falls back to CSV.
  fs.writeFileSync(inputsPath, lines.join("\n") + (lines.length ? "\n" : ""), "utf8");

  // Boundaries.csv: 3-column file (name, definition, remarks). pyatg
  // looks it up to resolve a name in the inputs row's boundary_type
  // column. Each named range's structured sub-ranges are flattened
  // back to pyatg's text form: bare value/range for a single anonymous
  // sub-range, or "name=value\nname=value" for multi-sub bundles.
  // An empty file still flips pyatg into manual mode, which is what
  // we want when the user only uses inline overrides.
  const boundariesPath = path.join(sheetDir, "Boundaries.csv");
  const boundaryLines: string[] = [];
  for (const nr of namedRanges) {
    const def = namedRangeToDefinition(nr);
    if (nr.name.trim() === "" || def === "") continue;
    boundaryLines.push(
      [csvField(nr.name.trim()), csvField(def), ""].join(",")
    );
  }
  fs.writeFileSync(
    boundariesPath,
    boundaryLines.join("\n") + (boundaryLines.length ? "\n" : ""),
    "utf8"
  );

  return { inputsPath, boundariesPath };
}

export function findEnviroForSourceFile(sourceFile: string): string[] {
  // Returns enviroPaths whose coverage data references this source file.
  // Empty list if no env is known yet (workspace not scanned, or no
  // coverage executed).
  //
  // Lazy import to avoid a circular dep at module load.
  const { getGlobalCoverageData } = require("./vcastTestInterface");
  const map = getGlobalCoverageData() as Map<string, any> | undefined;
  if (!map) return [];
  const fileEntry = map.get(sourceFile);
  if (!fileEntry || !fileEntry.enviroList) return [];
  return Array.from(fileEntry.enviroList.keys() as Iterable<string>);
}
