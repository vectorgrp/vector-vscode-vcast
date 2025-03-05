// To build this I started with the Test Explorer that
// I created using the Test Explorer UI, and the followed their
// excellent step by step instructions from this repo example
// https://github.com/connor4312/test-controller-migration-example

import * as vscode from "vscode";

import { Position, Range, Uri, TestMessage } from "vscode";

import { sendTestFileDataToLanguageServer } from "./client";

import { updateDisplayedCoverage, updateCOVdecorations } from "./coverage";

import { updateTestDecorator } from "./editorDecorator";

import { updateExploreDecorations } from "./fileDecorator";

import {
  errorLevel,
  indentString,
  openMessagePane,
  vectorMessage,
} from "./messagePane";

import { viewResultsReport } from "./reporting";

import {
  addTestNodeToCache,
  clearEnviroDataCache,
  clearTestNodeCache,
  compoundOnlyString,
  createTestNodeInCache,
  duplicateTestNode,
  environmentNodeDataType,
  getEnviroNodeData,
  getEnviroPathFromID,
  getEnviroNodeIDFromID,
  getFunctionNameFromID,
  getTestNameFromID,
  getUnitNameFromID,
  saveEnviroNodeData,
  testNodeType,
} from "./testData";

import {
  addLaunchConfiguration,
  forceLowerCaseDriveLetter,
  loadLaunchFile,
  normalizePath,
  openFileWithLineSelected,
} from "./utilities";

import {
  deleteSingleTest,
  getCBTNamesFromFile,
  getDataForEnvironment,
  getDataForProject,
  loadTestScriptIntoEnvironment,
  refreshCodedTests,
  updateProjectData,
} from "./vcastAdapter";

import { globalPathToSupportFiles, launchFile } from "./vcastInstallation";

import {
  addResultFileToStatusArray,
  globalTestStatusArray,
  resetCoverageData,
  runVCTest,
  testDataType,
  updateGlobalDataForFile,
  vcastEnviroFile,
} from "./vcastTestInterface";

import {
  adjustScriptContentsBeforeLoad,
  checkIfAnyProjectsAreOpened,
  closeAnyOpenErrorFiles,
  ensureCompilerNodes,
  ensureTestsuiteNodes,
  generateAndLoadATGTests,
  generateAndLoadBasisPathTests,
  getWebveiwComboboxItems,
  testStatus,
} from "./vcastUtilities";

import {
  cfgOptionType,
  getEnviroNameFromScript,
  getVcastOptionValues,
} from "../src-common/commonUtilities";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// This function does the work of adding the actual tests
// to whatever parent is passed in generally a function node
//
// Note that if you pass in a fileURI, then the test tree node will have
// a "go to test" icon, and clicking on it will open the file at the test location
// and double click on the test will open the test file.
//
function addTestNodes(
  testList: any[],
  parentNode: vcastTestItem,
  parentNodeID: string,
  parentNodeForCache: testNodeType
) {
  for (let testIndex = 0; testIndex < testList.length; testIndex++) {
    // we save the current test status to be used by updateStatusForNode
    let testData: testDataType = {
      status: testList[testIndex].status,
      passfail: testList[testIndex].passfail,
      time: testList[testIndex].time,
      notes: testList[testIndex].notes,
      resultFilePath: "",
      stdout: "",
      compoundOnly: testList[testIndex].compoundOnly,
      testFile: testList[testIndex].codedTestFile || "",
      testStartLine: testList[testIndex].codedTestLine || 1,
    };

    testData.testFile = forceLowerCaseDriveLetter(
      path.normalize(testData.testFile)
    );
    parentNodeForCache.testFile = testData.testFile;

    let testName = testList[testIndex].testName;
    if (testData.compoundOnly) testName += compoundOnlyString;
    const testNodeID = parentNodeID + "." + testName;

    // add a cache node for the test
    let testNodeForCache: testNodeType = duplicateTestNode(parentNodeID);
    testNodeForCache.testName = testName;
    testNodeForCache.testFile = testData.testFile;
    testNodeForCache.testStartLine = testData.testStartLine;
    addTestNodeToCache(testNodeID, testNodeForCache);

    globalTestStatusArray[testNodeID] = testData;

    // currently we only use the Uri and Range for Coded Tests
    let testURI: vscode.Uri | undefined = undefined;
    let testRange: vscode.Range | undefined = undefined;
    if (testData.testFile.length > 0) {
      testURI = vscode.Uri.file(testData.testFile);
      const startLine = testData.testStartLine;
      testRange = new Range(
        new Position(startLine - 1, 0),
        new Position(startLine - 1, 0)
      );
    } else {
      testURI = undefined;
    }

    let testNode: vcastTestItem = globalController.createTestItem(
      testNodeID,
      testName,
      testURI
    );
    testNode.nodeKind = nodeKind.test;
    testNode.isCompoundOnly = testData.compoundOnly;
    testNode.range = testRange;

    parentNode.children.add(testNode);
  }

  // Note: vcast currently only supports a single coded test file per uut,
  // so when there are coded test children, we set the coded testFile
  // for the function node to match the first child

  // vcastHasCodedTestsList is used by the package.json to control context menu choices
  if (testList.length > 0 && testList[0].codedTestFile) {
    vcastHasCodedTestsList.push(parentNodeID);
  } else {
    vcastHasCodedTestsList = vcastHasCodedTestsList.filter(
      (item) => item !== parentNodeID
    );
  }
  vscode.commands.executeCommand(
    "setContext",
    "vectorcastTestExplorer.vcastHasCodedTestsList",
    vcastHasCodedTestsList
  );

  addTestNodeToCache(parentNodeID, parentNodeForCache);
}

const codedTestFunctionName = "coded_tests_driver";
// leading space is intentional to force it to the top of the list
const codedTestDisplayName = " Coded Tests";
function processVCtestData(
  enviroPath: string,
  enviroNodeID: string,
  enviroNode: vcastTestItem,
  jsonData: any
) {
  // enviroNodeID, is the parent of the nodes to be added here

  // The top level of the JSON is an array ...
  const unitList = jsonData.testData;
  for (const unitData of unitList) {
    const unitNodeID = `${enviroNodeID}|${unitData.name}`;

    // add a cache node for the unit
    let unitNodeForCache: testNodeType = duplicateTestNode(enviroNodeID);
    unitNodeForCache.unitName = unitData.name;
    addTestNodeToCache(unitNodeID, unitNodeForCache);

    let unitNode: vcastTestItem = globalController.createTestItem(
      unitNodeID,
      unitData.name
    );
    unitNode.nodeKind = nodeKind.unit;
    if (unitData.path) unitNode.sourcePath = unitData.path;

    if (unitData.functions) {
      const functionList = unitData.functions;
      for (const functionData of functionList) {
        let functionName: string = functionData.name;

        const testList = functionData.tests;
        const functionNodeID = `${unitNodeID}.${functionName}`;

        // add a cache node for the function
        let functionNodeForCache: testNodeType = duplicateTestNode(unitNodeID);
        functionNodeForCache.functionName = functionName;
        addTestNodeToCache(functionNodeID, functionNodeForCache);

        let displayName = functionName;
        if (functionName == codedTestFunctionName) {
          displayName = codedTestDisplayName;
        }
        const functionNode: vcastTestItem = globalController.createTestItem(
          functionNodeID,
          displayName
        );
        functionNode.nodeKind = nodeKind.function;

        addTestNodes(
          testList,
          functionNode,
          functionNodeID,
          functionNodeForCache
        );

        // if the function we are processing is the coded test driver
        // and if there is a test file associated with it ...
        if (
          functionName == codedTestFunctionName &&
          functionNodeForCache.testFile.length > 0
        ) {
          addCodedTestfileToCache(enviroNodeID, functionNodeForCache);

          // we need to tell the language server about the test file to
          // environment mapping, including whether or not the environment
          // has coded mock support

          const enviroHasMockSupport = jsonData.enviro.mockingSupport;
          const testFilePath = functionNodeForCache.testFile;

          sendTestFileDataToLanguageServer(
            testFilePath,
            functionNodeForCache.enviroPath,
            enviroHasMockSupport
          );
        }

        unitNode.children.add(functionNode);
      }
    }
    // no functions, check if there are tests anyway as there are for INIT and COMPOUND
    else if (unitData.tests) {
      // compound or init
      let nodeName: string = "";
      let nodeIdName: string = "";
      let sortText: string = "";
      if (unitData.name == "Compound Tests") {
        nodeName = "Compound Tests";
        nodeIdName = "<<COMPOUND>>";
        sortText = "AAAA";
      } else if (unitData.name == "Initialization Tests") {
        nodeName = "Initialization Tests";
        nodeIdName = "<<INIT>>";
        sortText = "BBBB";
      }

      const testList = unitData.tests;
      // we insert not-used to make the format of the IDs consistent
      // this gets stripped off/processed in the functions
      //   -- getClicastArgsFromTestNode()     -- ts
      //   -- getStandardArgsFromTestObject()  -- python
      const specialNodeID = enviroNodeID + "|not-used." + nodeIdName;

      let specialNodeForCache: testNodeType = duplicateTestNode(enviroNodeID);
      specialNodeForCache.unitName = "not-used";
      specialNodeForCache.functionName = nodeIdName;
      addTestNodeToCache(specialNodeID, specialNodeForCache);

      const specialNode: vcastTestItem = globalController.createTestItem(
        specialNodeID,
        nodeName
      );
      specialNode.nodeKind = nodeKind.special;
      // we use sortText to force the compound and init nodes to the top of the tree
      specialNode.sortText = sortText;

      addTestNodes(testList, specialNode, specialNodeID, specialNodeForCache);

      enviroNode.children.add(specialNode);
    }
    if (unitNode.children.size > 0) enviroNode.children.add(unitNode);
  }
}

function getWorkspaceFolderList(): string[] {
  // This function will covert the workspace folders into a
  // string list of folders to be used in getEnvironmentList

  let returnList: string[] = [];
  for (const workspace of vscode.workspace.workspaceFolders || []) {
    const workspaceRoot = workspace.uri.fsPath;
    // doing the path separate replacement here to avoid complexity below
    returnList.push(workspaceRoot.replaceAll("\\", "/"));
  }
  return returnList;
}

const glob = require("glob");

// Data for one environment in a manage project
interface projectEnvironmentType {
  displayName: string;
  isBuilt: boolean;
  rebuildNeeded: boolean;
  compiler: { name: string; testsuites: string[] };
}

export type enviroListAsMapType = Map<string, projectEnvironmentType>;

// This is built once each time we load a workspace.
// The outer map key is the project filename,
// the inner map key is the build directory
export let globalProjectDataCache = new Map<string, enviroListAsMapType>();

export let globalProjectIsOpenedChecker: boolean = false;
export let globalProjectWebviewComboboxItems = new Map<
  string,
  { compilers: string[]; testsuites: string[] }
>();
// Global variable to store compilers and testsuites.
export let globalCompilersAndTestsuites: {
  compiler: string[];
  testsuites: string[];
} = {
  compiler: [],
  testsuites: [],
};

export let globalUnusedTestsuiteList: { displayName: string }[] = [];
export let globalUnusedCompilerList: {
  projectFile: string;
  displayName: string;
}[] = [];

export function updateGlobalCompilersAndTestsuites() {
  const compilers = new Set<string>();
  const testsuites = new Set<string>();

  // Recursive helper that traverses the test tree.
  function traverse(node: vcastTestItem) {
    if (node.nodeKind === nodeKind.compiler) {
      // Add the full node ID (or full path) for the compiler.
      compilers.add(node.id);
    } else if (node.nodeKind === nodeKind.testsuite) {
      testsuites.add(node.id);
    }
    // Recurse over children.
    node.children.forEach((child) => traverse(child as vcastTestItem));
  }

  // Start traversal from all top-level items.
  globalController.items.forEach((item) => {
    traverse(item as vcastTestItem);
  });

  // Update the global variable.
  globalCompilersAndTestsuites = {
    compiler: Array.from(compilers),
    testsuites: Array.from(testsuites),
  };
}

export function clearGlobalCompilersAndTestsuites() {
  globalCompilersAndTestsuites = {
    compiler: [],
    testsuites: [],
  };
  globalUnusedCompilerList = [];
  globalUnusedTestsuiteList = [];
}

export function setGlobalCompilerAndTestsuites() {
  updateGlobalCompilersAndTestsuites();
  vscode.commands.executeCommand(
    "setContext",
    "vectorcastTestExplorer.globalProjectCompilers",
    globalCompilersAndTestsuites.compiler
  );
  vscode.commands.executeCommand(
    "setContext",
    "vectorcastTestExplorer.globalProjectTestsuites",
    globalCompilersAndTestsuites.testsuites
  );
}

export function setGlobalProjectIsOpenedChecker() {
  globalProjectIsOpenedChecker = checkIfAnyProjectsAreOpened();
  vscode.commands.executeCommand(
    "setContext",
    "vectorcastTestExplorer.globalProjectIsOpenedChecker",
    globalProjectIsOpenedChecker
  );
}

export async function convertProjectDataToMap(
  enviroList: any[]
): Promise<enviroListAsMapType> {
  let returnData: enviroListAsMapType = new Map<
    string,
    projectEnvironmentType
  >();

  for (const rawData of enviroList) {
    const enviroData: projectEnvironmentType = {
      displayName: rawData.displayName,
      isBuilt: rawData.isBuilt,
      rebuildNeeded: rawData.rebuildNeeded,
      compiler: rawData.compiler,
    };

    const mapKey = forceLowerCaseDriveLetter(rawData.buildDirectory);
    returnData.set(mapKey, enviroData);
  }

  return returnData;
}

export async function buildProjectDataCache(baseDirectory: string) {
  const options = { cwd: baseDirectory, absolute: true, strict: false };
  const projectFileList = glob.sync("**/*.vcm", options);

  for (const projectFile of projectFileList) {
    // enviroList is a list of json objects with fields:
    // "displayName", "buildDirectory", "isBuilt", "rebuildNeeded"
    // See python function vTestInterface.py:getProjectData()
    const projectData = await getDataForProject(projectFile);
    const enviroList = projectData.projectEnvData;

    // This includes all unused and empty testsuites and compilers because
    // they are not in the enviroList as they do not include any envs
    globalUnusedTestsuiteList = projectData.projectTestsuiteData;
    globalUnusedCompilerList = projectData.projectCompilerData;

    // convert the raw json data into a map for the cache
    const enviroListAsMap = await convertProjectDataToMap(enviroList);

    // we turn this into a typescript object and then store in a map
    globalProjectDataCache.set(projectFile, enviroListAsMap);

    const comboBoxList = getWebveiwComboboxItems(projectFile);
    globalProjectWebviewComboboxItems.set(projectFile, comboBoxList);
  }
}

function isEnvironmentOfInterest(candidatePath: string): boolean {
  let returnValue: boolean = true;

  // vcast creates .BAK version of a directory on rebuild
  if (candidatePath.includes(".BAK")) {
    returnValue = false;
  } else {
    // also ignore environments that are part of a project
    // these get added in a separate project processing step
    for (const projectData of globalProjectDataCache.values()) {
      if (projectData.has(candidatePath)) {
        returnValue = false;
        break;
      }
    }
  }

  return returnValue;
}

function getEnvironmentList(baseDirectory: string): string[] {
  // This function will find all of the VectorCAST and vTest
  // environments downstream of the current workspace

  const options = { cwd: baseDirectory, absolute: true, strict: false };
  let fileList = glob.sync("**/" + vcastEnviroFile, options);

  // now we have a list of the UNITDATA.VCD files downstream of us
  // so turn this into a list of the enclosing directories only
  let returnList: string[] = [];
  const workspaceFolderList = getWorkspaceFolderList();
  for (const filePath of fileList) {
    // note that glob always uses / as path separator ...
    const candidatePath = path.dirname(filePath);
    if (isEnvironmentOfInterest(candidatePath)) {
      // we don't want to support users who add an enviro
      // directory to the workspace - someone did this :()
      if (!workspaceFolderList?.includes(candidatePath)) {
        returnList.push(forceLowerCaseDriveLetter(candidatePath));
      } else {
        vectorMessage(`Ignoring environment: ${candidatePath} ...`);
        vectorMessage(
          `environments should not be at the workspace root, open the enclosing directory\n`,
          errorLevel.info,
          indentString
        );
      }
    }
  }

  return returnList;
}

// These variables are used in the package.json to control the display of context menu items
// Search for 'vectorcastTestExplorer.vcastEnviroList | vcastHasCodedTestsList' in package.json
// to see where we reference them
// this list in a "when" clause
let vcastEnviroList: string[] = [];
export let vcastUnbuiltEnviroList: string[] = [];
let vcastHasCodedTestsList: string[] = [];

/**
 * Given a parent node and environment data, this function creates the environment node.
 * It uses only the last part of the displayName as the label.
 */
export async function updateTestsForEnvironment(
  parentNode: vcastTestItem | null,
  enviroData: environmentNodeDataType
) {
  const jsonData = await getDataForEnvironment(enviroData.buildDirectory);

  if (jsonData) {
    saveEnviroNodeData(enviroData.buildDirectory, enviroData);
    updateGlobalDataForFile(enviroData.buildDirectory, jsonData.unitData);

    const enviroNodeID: string = "vcast:" + enviroData.buildDirectory;
    createTestNodeInCache(
      enviroNodeID,
      enviroData.buildDirectory,
      path.basename(enviroData.buildDirectory)
    );

    // Use only the last part of the displayName as the environment name.
    const envName = path.basename(enviroData.displayName);
    const enviroNode = globalController.createTestItem(
      enviroNodeID,
      envName
    ) as vcastTestItem;
    enviroNode.nodeKind = nodeKind.environment;

    // Process functions and tests to add child nodes.
    processVCtestData(
      enviroData.buildDirectory,
      enviroNodeID,
      enviroNode,
      jsonData
    );

    if (!vcastEnviroList.includes(enviroNodeID)) {
      vcastEnviroList.push(enviroNodeID);
      vscode.commands.executeCommand(
        "setContext",
        "vectorcastTestExplorer.vcastEnviroList",
        vcastEnviroList
      );
    }

    // Instead of grouping, add the environment directly.
    if (parentNode) {
      globalController.items.delete(enviroNode.id);
      parentNode.children.add(enviroNode);
    } else {
      globalController.items.add(enviroNode);
    }
  } else {
    vectorMessage(`Ignoring environment: ${enviroData.displayName}\n`);
  }
}

function pushUnbuiltEnviroListToContextMenu() {
  vscode.commands.executeCommand(
    "setContext",
    "vectorcastTestExplorer.vcastUnbuiltEnviroList",
    vcastUnbuiltEnviroList
  );
}
function addUnbuiltEnviroToTestPane(
  parentNode: vcastTestItem | null,
  enviroData: environmentNodeDataType
) {
  const enviroNodeID: string = "vcast:" + enviroData.buildDirectory;
  // Extract only the last segment for the environment label.
  const envName = path.basename(enviroData.displayName);
  const enviroNode: vcastTestItem = globalController.createTestItem(
    enviroNodeID,
    envName
  );
  enviroNode.nodeKind = nodeKind.environment;

  if (parentNode) {
    parentNode.children.add(enviroNode);
  } else {
    globalController.items.add(enviroNode);
  }

  saveEnviroNodeData(enviroData.buildDirectory, enviroData);

  if (!vcastUnbuiltEnviroList.includes(enviroNodeID)) {
    vcastUnbuiltEnviroList.push(enviroNodeID);
    pushUnbuiltEnviroListToContextMenu();
  }
}

export function removeEnvironmentFromTestPane(enviroID: string) {
  // Start searching from top-level items
  globalController.items.forEach((item) => {
    deleteItemByID(item, enviroID);
  });
}

// Deletes the item with the matching enviroID
function deleteItemByID(item: vscode.TestItem, enviroID: string) {
  item.children.forEach((child) => {
    if (child.id === enviroID) {
      item.children.delete(child.id);
    } else {
      // Continue searching recursively
      deleteItemByID(child, enviroID);
    }
  });
}

export let vcastEnvironmentsFound: boolean = false;
async function loadAllVCTests(
  progress: vscode.Progress<{ message?: string; increment?: number }>,
  token: vscode.CancellationToken
) {
  // Reset caches and environment lists.
  vcastEnviroList = [];
  vcastUnbuiltEnviroList = [];
  clearEnviroDataCache();
  clearTestNodeCache();

  // Resets the "used" and empty/unused compilers / testsuites
  clearGlobalCompilersAndTestsuites();

  let cancelled: boolean = false;
  let environmentList: environmentNodeDataType[] = [];

  if (vscode.workspace.workspaceFolders) {
    for (const workspace of vscode.workspace.workspaceFolders) {
      const workspaceRoot = workspace.uri.fsPath;
      // Build the project cache for this workspace.
      await buildProjectDataCache(workspaceRoot);

      // Add environments that are part of a managed project.
      for (const [projectPath, projectData] of globalProjectDataCache) {
        vectorMessage(`Processing project: ${projectPath} ...`);
        for (const [buildDirectory, enviroData] of projectData) {
          environmentList.push({
            projectPath: projectPath,
            buildDirectory: normalizePath(buildDirectory),
            isBuilt: enviroData.isBuilt,
            displayName: enviroData.displayName, // e.g. "GNU/BlackBox/ENV"
            workspaceRoot: workspaceRoot,
          });
        }
      }

      // Add free (non-managed) environments.
      for (const environment of getEnvironmentList(workspaceRoot)) {
        const normalizedPath = normalizePath(environment);
        const displayName = path.relative(workspaceRoot, normalizedPath);
        environmentList.push({
          projectPath: "",
          buildDirectory: normalizedPath,
          isBuilt: true,
          displayName: displayName,
          workspaceRoot: workspaceRoot,
          // Note: free environments don't have a group.
        });
      }
    } // end for workspace folders

    if (environmentList.length > 0) vcastEnvironmentsFound = true;
    const increment = (1 / environmentList.length) * 100;

    for (const environmentData of environmentList) {
      if (environmentData.isBuilt) {
        progress.report({
          increment: increment,
          message:
            "Loading data for environment: " + environmentData.displayName,
        });
        // Let the progress window update.
        await new Promise<void>((r) => setTimeout(r, 0));
        if (token) {
          token.onCancellationRequested(() => {
            cancelled = true;
          });
        }
        if (cancelled) break;

        // Get the parent node by building the hierarchy (project -> compiler -> testsuite)
        const parentNode = getParentNodeForEnvironment(environmentData);
        await updateTestsForEnvironment(parentNode, environmentData);
      } else {
        const parentNode = getParentNodeForEnvironment(environmentData);
        addUnbuiltEnviroToTestPane(parentNode, environmentData);
      }
    }
  } // end if workspace folders

  // In case we have empty testsuites or compilers in the project,
  // we won't find them in the Env data so we have to add them manually here
  ensureCompilerNodes();
  ensureTestsuiteNodes();
  // Update coverage and decorators.
  setGlobalProjectIsOpenedChecker();
  setGlobalCompilerAndTestsuites();
  updateDisplayedCoverage();
  updateTestDecorator();
}

export let pathToEnviroBeingDebugged: string =
  "No Environment is Being Debugged";
export let pathToProgramBeingDebugged: string = "No Program is Being Debugged";

function okToDebug(
  node: vcastTestItem,
  uutFilePath: string,
  enviroOptions: cfgOptionType
): boolean {
  // this function will pick off all the error cases, to make the debugNode() function flow nicely

  let returnValue: boolean = true;
  const stockSuffix = "performing normal test execution.";

  if (node.nodeKind != nodeKind.test) {
    vscode.window.showInformationMessage(
      `Debug is only available for test nodes, ${stockSuffix}`
    );
    returnValue = false;
  } else if (enviroOptions.C_DEBUG_CMD.length == 0) {
    vscode.window.showInformationMessage(
      `Debug command could not be found in the VectorCAST configuration file for this environment. ${stockSuffix}`
    );
    returnValue = false;
  } else if (!enviroOptions.C_DEBUG_CMD.startsWith("gdb")) {
    vscode.window.showInformationMessage(
      `Debugger '${enviroOptions.C_DEBUG_CMD}' is not supported, ${stockSuffix}`
    );
    returnValue = false;
  } else if (!fs.existsSync(uutFilePath)) {
    vscode.window.showInformationMessage(
      `Could not find UUT source file: '${uutFilePath}', ${stockSuffix}`
    );
    returnValue = false;
  }

  return returnValue;
}

let sourceCache: Map<string, string[]> = new Map();

function findStringInFile(filePath: string, stringToFind: string): number {
  // We know filePath exists when we get here

  let returnLineNumber = 0;
  let fileContents: string[] = [];
  if (sourceCache.has(filePath)) {
    let cacheContents = sourceCache.get(filePath);
    if (cacheContents) {
      fileContents = cacheContents;
    }
  } else {
    fileContents = fs.readFileSync(filePath).toString().split("\n");
    sourceCache.set(filePath, fileContents);
  }

  for (const [index, line] of fileContents.entries()) {
    if (line.includes(stringToFind)) {
      returnLineNumber = index + 1;
      break;
    }
  }
  return returnLineNumber;
}

const vectorcastLaunchConfigName = "VectorCAST Harness Debug";

// this map will store away the list of launch.json files that
// have a "VectorCAST Harness Debug" config, so we don't have
// do this work multiple times
let launchFilesWithVectorCASTConfig: Map<string, boolean> = new Map();

// this map will store away the path to the launch.json for an enviroPath
// so we don't have to do this work multiple times
let workspaceForEnviro: Map<string, string> = new Map();

function getWorkspacePath(enviroPath: string): string | undefined {
  // check if we've seen this enviroPath before ...
  let ourWorkspace: string | undefined = workspaceForEnviro.get(enviroPath);

  // if we have not, compute it ...
  if (!ourWorkspace) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      for (const workspaceFolder of workspaceFolders) {
        const relative = path.relative(workspaceFolder.uri.fsPath, enviroPath);
        if (
          relative &&
          !relative.startsWith("..") &&
          !path.isAbsolute(relative)
        ) {
          // we found our parent, save it for next time
          ourWorkspace = workspaceFolder.uri.fsPath;
          workspaceForEnviro.set(enviroPath, ourWorkspace);
        }
      }
    }
  }

  return ourWorkspace;
}

function getLaunchJsonPath(workspacePath: string): string {
  const jsonPath = path.join(workspacePath, ".vscode", launchFile);
  return jsonPath;
}

function launchFileExists(launchJsonPath: string): boolean {
  // this will check if launch.json exists

  if (launchFilesWithVectorCASTConfig.has(launchJsonPath)) {
    return true;
  } else return fs.existsSync(launchJsonPath);
}

function createEmptyLaunchConfigFile(
  ourWorkspace: string,
  launchJsonPath: string
) {
  const configFolderPath = path.join(ourWorkspace, ".vscode");
  if (!fs.existsSync(configFolderPath)) {
    fs.mkdirSync(configFolderPath);
  }

  fs.closeSync(fs.openSync(launchJsonPath, "w"));
}

function launchConfigExists(launchJsonPath: string): boolean {
  // this will check if launch.json has
  // the "VectorCAST Harness Debug" configuration defined
  let returnValue = false;
  const existingJSONdata: any = loadLaunchFile(launchJsonPath);
  if (existingJSONdata && existingJSONdata.jsonData.configurations) {
    for (const existingConfig of existingJSONdata.jsonData.configurations) {
      if (existingConfig.name === vectorcastLaunchConfigName) {
        returnValue = true;
        launchFilesWithVectorCASTConfig.set(launchJsonPath, true);
        break;
      }
    }
  }

  return returnValue;
}

const coverageExeFilename = "UUT_INST";
const normalExeFilename = "UUT_INTE";

function getNameOfHarnessExecutable(enviroPath: string): string {
  // the executable being debugged will either be UUT_INTE or UUT_INST
  // depending on whether coverage is on.
  // Could not find a dataAPI call to determine coverage on/off so
  // I'm using this brute force approach

  // if windows the executable will have an .exe extension
  let extension = "";
  if (process.platform === "win32") {
    extension = ".EXE";
  }

  let harnessName = normalExeFilename + extension;
  if (isCoverageTurnedOn(enviroPath)) {
    harnessName = coverageExeFilename + extension;
  }

  return harnessName;
}

function isCoverageTurnedOn(enviroPath: string): boolean {
  const commonDBpath = path.join(enviroPath, "COMMONDB.VCD");
  const lines = fs.readFileSync(commonDBpath, "utf-8").split(/\r?\n/);
  let coverageON = false;
  let currentLine = "";
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    currentLine = lines[lineIdx];
    if (currentLine.trim() === "COVERAGE_ON_OFF_HDR") {
      coverageON = lines[lineIdx + 1].trim() === "TRUE";
      break;
    }
  }

  return coverageON;
}
function getFileToDebug(
  enviroPath: string,
  uutName: string,
  functionName: string,
  executableFilename: string
): string {
  // note: glob pattern is a regex
  let globPattern: string;

  // coded test
  if (functionName == codedTestFunctionName) {
    if (executableFilename.startsWith(coverageExeFilename)) {
      globPattern = uutName + "_exp_inst_driver.c*";
    } else {
      globPattern = uutName + "_expanded_driver.c*";
    }
  }
  // compound or init
  else if (uutName == "not-used") {
    // Improvement needed: would be nice to figure out the uut for the first slot ...
    globPattern = "S3_switch.*";
  }
  // regular test
  else {
    if (executableFilename.startsWith(coverageExeFilename)) {
      globPattern = uutName + "_inst.c*";
    } else {
      globPattern = uutName + "_vcast.c*";
    }
  }

  const globOptions = { cwd: enviroPath, absolute: true, strict: false };
  // two steps for debugging ...
  const globResult = glob.sync(globPattern, globOptions);

  return globResult[0];
}

async function debugNode(request: vscode.TestRunRequest, node: vcastTestItem) {
  // Note: we always debug the non-coverage harness, because the
  // SBF + Cover instrumentation is really messy.

  // Note: this only works for GCC/GDB

  // Here are the steps needed to debug.
  //   - Check if we have a single test selected, if not do normal run
  //   - Check if we are gcc/gdb, if now issue a warning and do normal run
  //	 - Disable coverage so that the UUT source code is more readable
  //   - Run the test without debug to setup all the test input files
  //   - Open the file: <uut>_vcast.cpp -> this is the source that will run
  //   - Start debugger using the VectorCAST launch configuration

  pathToEnviroBeingDebugged = "No Environment is Being Debugged";
  const enviroPath = getEnviroPathFromID(node.id);
  const enviroOptions = getVcastOptionValues(enviroPath);
  const uutName = getUnitNameFromID(node.id);
  const functionUnderTest = getFunctionNameFromID(node.id);

  const executableFilename = getNameOfHarnessExecutable(enviroPath);

  const fileToDebug: string = getFileToDebug(
    enviroPath,
    uutName,
    functionUnderTest,
    executableFilename
  );

  if (okToDebug(node, fileToDebug, enviroOptions)) {
    let ourWorkspace = getWorkspacePath(enviroPath);

    if (ourWorkspace) {
      let debugConfigurationFound = false;
      const launchJsonPath = getLaunchJsonPath(ourWorkspace);
      const launchJsonUri = Uri.file(launchJsonPath);

      if (!launchFileExists(launchJsonPath)) {
        vectorMessage(
          `${launchFile}| not found in ${launchJsonPath}.` +
            ` Generating "VectorCAST Harness Debug" configuration from template`
        );

        vscode.window.showWarningMessage(
          `${launchFile} not found.\n` +
            'Generating "VectorCAST Harness Debug" configuration from template'
        );

        createEmptyLaunchConfigFile(ourWorkspace, launchJsonPath);
        addLaunchConfiguration(launchJsonUri, globalPathToSupportFiles);
      } else {
        debugConfigurationFound = launchConfigExists(launchJsonPath);
        if (!debugConfigurationFound) {
          addLaunchConfiguration(launchJsonUri, globalPathToSupportFiles);
        }
      }

      // this flag means that the launch file already had a vectorcast debug configuration
      // if we just added it we want to give the user a chance to review before we debug
      if (debugConfigurationFound) {
        vectorMessage(
          `Preparing to debug test ${getTestNameFromID(node.id)} ... `
        );
        vscode.window.showInformationMessage(
          `Preparing to debug test ${getTestNameFromID(node.id)} ... `
        );

        // ok to debug, let's go!

        // these are the globals that the launch.json links to ...
        pathToEnviroBeingDebugged = enviroPath;
        pathToProgramBeingDebugged = path.join(enviroPath, executableFilename);

        // run the test first without debug to setup the inputs
        // it's important that we wait for this to finish
        vectorMessage(`   - initializing test case inputs ... `);
        const run = globalController.createTestRun(request);
        runNode(node, run, false).then(async (status) => {
          run.end();

          if (
            status == testStatus.didNotRun ||
            status == testStatus.compileError ||
            status == testStatus.linkError
          ) {
            return;
          } else {
            vectorMessage(
              `   - opening VectorCAST version of file: ${uutName} ... `
            );

            // Improvement needed:
            // It would be nice if vcast saved away the function start location when building the _vcast file
            // open the sbf uut at the correct line for the function being tested

            let searchString: string = "";
            if (functionUnderTest == codedTestFunctionName) {
              // for coded tests, the test logic will be in something that
              // looks like: "class Test_managerTests_realTest"  class Test_<suite-name>_<test-name>
              const testName = getTestNameFromID(node.id).replace(".", "_");
              searchString = `class Test_${testName}`;
            } else {
              searchString = functionUnderTest.split("(")[0];
            }

            const debugStartLine = findStringInFile(fileToDebug, searchString);
            openFileWithLineSelected(fileToDebug, debugStartLine);

            // Prompt the user for what to do next!
            vscode.window.showInformationMessage(
              `Ready for debugging, choose launch configuration: "${vectorcastLaunchConfigName}" ... `
            );
          }
        });
      } else {
        const debugFileAsTextDoc =
          await vscode.workspace.openTextDocument(launchJsonUri);
        vscode.window.showTextDocument(debugFileAsTextDoc, { preview: false });
        // Prompt the user for what to do next!
        vscode.window.showWarningMessage(
          "Please review the generated debug configuration.\n" +
            'Execute "Debug Test" again to start the debugger'
        );
      }
    } else {
      vectorMessage(
        `Error: Workspace path not found at ${ourWorkspace}`,
        errorLevel.error
      );
      vscode.window.showErrorMessage(
        `Error: Workspace path not found at ${ourWorkspace}`
      );
    }
  } else {
    // cannot debug so just do a normal test execute
    const run = globalController.createTestRun(request);
    await runNode(node, run, false);
    run.end();
  }
}

export async function runNode(
  node: vcastTestItem,
  run: vscode.TestRun,
  generateReport: boolean
): Promise<testStatus> {
  vectorMessage("Starting execution of test: " + node.label + " ...");
  run.started(node);

  // this does the actual work of running the test
  const enviroPath = getEnviroPathFromID(node.id);
  return await runVCTest(enviroPath, node.id).then(async (executionResult) => {
    const status = executionResult.status;

    // We show stdout from execution in the "Test Results" pane
    run.appendOutput(executionResult.details.stdOut);

    if (status == testStatus.didNotRun) {
      run.skipped(node);
    } else if (status == testStatus.compileError) {
      const failMessage: TestMessage = new TestMessage(
        "Coded Test compile error - see details in file: ACOMPILE.LIS"
      );
      run.errored(node, failMessage);
    } else if (status == testStatus.linkError) {
      const failMessage: TestMessage = new TestMessage(
        "Coded Test link error - see details in file: AALINKER.LIS"
      );
      run.errored(node, failMessage);
    } else {
      if (status == testStatus.passed) {
        run.passed(node);
      } else if (status == testStatus.failed) {
        const currentTestData = executionResult.details;

        // convert the pass fail string from the current test data into a message
        // the pass fail string will look like: "0/1 (0.00)" or "1/1 (100.00)"
        // transform to: "Expected Results matched 0% ( 0 / 1 ) Fail"

        // We have seen the passfail string be empty so guard i
        // against that and any malformed strings
        let failMessageText = "";
        try {
          const xofy = currentTestData.passfail.split("(")[0].trim();
          const percentage = currentTestData.passfail
            .split("(")[1]
            .split(")")[0]
            .trim();
          failMessageText = `Expected results matched ${xofy} (${percentage}%) Fail`;
        } catch (err: any) {
          failMessageText = "Unexpected error processing expected results";
        }
        const failMessage = new TestMessage(failMessageText);
        run.failed(node, failMessage);
      }

      if (generateReport) {
        // if the showReportOnExecute option is active, then the
        // execution report path was returned in the executionResult
        // object, so we add this to the global status array,
        // which saves a call to vpython or data server.
        addResultFileToStatusArray(
          node.id,
          executionResult.details.resultsFilePath
        );
        viewResultsReport(node.id);
      }
    }
    return status;
  });
}

function getTestNodes(
  request: vscode.TestRunRequest,
  queue: vcastTestItem[]
): vcastTestItem[] {
  let returnQueue: vcastTestItem[] = [];

  // now use this initial list to recurse on any container nodes
  for (const node of queue) {
    if (node.nodeKind == nodeKind.test) {
      // Users can hide or filter out tests from their run. If the request says
      // they've done that for this node, then don't run it.
      if (!request.exclude?.includes(node)) {
        returnQueue.push(node);
      }
    } else {
      const children: vcastTestItem[] = [];
      node.children.forEach((test) => children.push(test));
      returnQueue = returnQueue.concat(getTestNodes(request, children));
    }
  }
  return returnQueue;
}

export async function updateDataForEnvironment(enviroPath: string) {
  // this function does all of the "common" work when an environment is updated
  // sources of environment update are things like:
  //   - opening the environment in the vcast gui
  //   - building a new environment
  //   - ...

  // we need await on this call because ther other update function
  // require the data that is loaded downstream of this call
  await updateTestPane(enviroPath);
  updateDisplayedCoverage();
  updateExploreDecorations();
  updateTestDecorator();

  // remove environment from the unbuilt list if it's there
  vcastUnbuiltEnviroList = vcastUnbuiltEnviroList.filter(
    (item) => item !== `vcast:${enviroPath}`
  );
  pushUnbuiltEnviroListToContextMenu();
}

function shouldGenerateExecutionReport(testList: vcastTestItem[]): boolean {
  // a helper function for determining if we should show the report

  let settings = vscode.workspace.getConfiguration("vectorcastTestExplorer");
  const showReport: boolean = settings.get("showReportOnExecute", false);
  return testList.length == 1 && showReport;
}

// this does the actual work of running the tests
const { performance } = require("perf_hooks");

async function runTests(
  request: vscode.TestRunRequest,
  cancellation: vscode.CancellationToken
) {
  let nodeList: vcastTestItem[] = [];

  // Build the initial node list with the the included tests,
  // or all known tests if the include list is null
  if (request.include) {
    // all included tests
    request.include.forEach((test) => nodeList.push(test));
  } else {
    // all known tests
    globalController.items.forEach((test) => nodeList.push(test));
  }

  const testList: vcastTestItem[] = getTestNodes(request, nodeList);

  // this does the actual execution of the full test list
  const run = globalController.createTestRun(request);
  // added this for performance tuning - but interesting to leave in
  const startTime: number = performance.now();
  const generateReport: boolean = shouldGenerateExecutionReport(testList);
  let enviroPathList: Set<string> = new Set();
  for (const test of testList) {
    if (cancellation.isCancellationRequested) {
      run.skipped(test);
    } else if (test.isCompoundOnly) {
      run.skipped(test);
    } else {
      const enviroPath = getEnviroPathFromID(test.id);
      enviroPathList.add(enviroPath);
      await runNode(test, run, generateReport);
    }
    // used to allow the message window to display properly
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  const endTime: number = performance.now();
  const deltaString: string = ((endTime - startTime) / 1000).toFixed(2);
  vectorMessage(`Execution event took: ${deltaString} seconds`);

  for (let enviroPath of enviroPathList) {
    await updateDataForEnvironment(enviroPath);
  }
  updateDisplayedCoverage();
  run.end();
}

function isSingleTestNode(request: vscode.TestRunRequest): boolean {
  // for debug - ensure that a single node is selected, and that that
  // node is a "test" before allowing debug
  if (request.include) {
    if (request.include.length == 1) {
      const node: vcastTestItem = request.include[0];
      return node.nodeKind == nodeKind.test;
    }
  }
  return false;
}

async function processRunRequest(
  request: vscode.TestRunRequest,
  cancellation: vscode.CancellationToken,
  isDebug: boolean = false
) {
  // check if there are any vcast error files open, and close them
  await closeAnyOpenErrorFiles();

  // Debug is only valid for a single test node
  // requests.include will be null if the request is for all tests
  // or it will have a list if the request is for one or more tests
  // isSingleTestNode checks if it is exactly one and it is a test
  // not a unit, function, ...
  if (isDebug && request.include && isSingleTestNode(request)) {
    const node = request.include[0];
    debugNode(request, node);
  } else {
    // tell user that we are doing a normal run ...
    if (isDebug) {
      vscode.window.showInformationMessage(
        `Debug is only available for single test selections nodes, performing normal test execution.`
      );
    }
    runTests(request, cancellation);
  }
}

export async function deleteTests(nodeList: any[]) {
  // nodeList might contain environment, unit, function or test nodes
  // or a combination of all kinds.  The nice thing  is that clicast
  // handles this all for us.  If we provide only a unit, it deletes
  // all tests for that unit, only a unit and subprogram, it deletes
  // all for that subprogram.
  //
  // The only special case is for environment-wide delete, see note below

  let changedEnvironmentIDList: Set<string> = new Set();

  for (let node of nodeList) {
    await vectorMessage(`Deleting tests for node: ${node.id} ...`);

    // call clicast to delete the test case
    const commandStatus = await deleteSingleTest(node.id);

    if (commandStatus.errorCode == 0) {
      changedEnvironmentIDList.add(getEnviroNodeIDFromID(node.id));
    } else {
      vectorMessage("Error deleting test\n");
      openMessagePane();
    }
  }

  // now update all of the environments that changed
  for (let enviroNodeID of changedEnvironmentIDList) {
    // remove any coded test files from the cache since
    // they will be re-added by the update
    const enviroPath = getEnviroPathFromID(enviroNodeID);
    removeCBTfilesCacheForEnviro(enviroNodeID);
    await updateDataForEnvironment(enviroPath);
    await updateProjectData(enviroPath);
  }
}

export async function insertBasisPathTests(testNode: testNodeType) {
  // this will insert basis path tests for the given test node

  generateAndLoadBasisPathTests(testNode);
}

export async function insertATGTests(testNode: testNodeType) {
  // this will insert basis path tests for the given test node

  generateAndLoadATGTests(testNode);
}

const url = require("url");
export async function loadTestScript() {
  // This gets called from the right-click editor context menu
  // The convention is that the .tst file must be in the same directory
  // as the environment, so we get the enviroName from parsing the
  // .tst and get the working directory from its location

  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    if (activeEditor.document.isDirty) {
      // need to wait, otherwise we have a race condition with clicast
      await activeEditor.document.save();
    }

    let scriptPath = url.fileURLToPath(activeEditor.document.uri.toString());

    // we use the test script contents to determine the environment name
    const enviroName = getEnviroNameFromScript(scriptPath);

    if (enviroName) {
      adjustScriptContentsBeforeLoad(scriptPath);
      const enviroPath = path.join(path.dirname(scriptPath), enviroName);

      // call clicast to load the test script
      await loadTestScriptIntoEnvironment(enviroName, scriptPath);

      // update the test pane for this environment after the script is loaded
      // we are reading the data back from the environment with this call
      updateTestPane(enviroPath);
    } else {
      vscode.window.showErrorMessage(
        `Could not determine environment name, required "-- Environment: <enviro-name> comment line is missing.`
      );
    }
  }
}

export async function refreshAllExtensionData() {
  // This function will do a full reset of the data for all environments
  // This is needed used when the following happens
  //      - the workspace is changed
  //      - the common refresh icon is pressed
  //      - the vectorcast installation is changed
  //      - we fall back from server mode
  //
  resetCoverageData();
  await buildTestPaneContents();
  updateCOVdecorations();
  // Global varibale to see if we have a manage Project opened or just an Environment
  setGlobalProjectIsOpenedChecker();
  setGlobalCompilerAndTestsuites();
}

// create the controller
export let globalController: vscode.TestController;

// We nest each project under the globalProjectsNode, so
// this is needed to allow us to save and later lookup
// the parent node for any environment that is part of a project
export let globalProjectMap: Map<string, vcastTestItem> = new Map();
/**
 * Given an environment’s data, this function builds (if needed) and returns
 * the parent node for the environment. It uses the environment’s displayName,
 * assumed to be in the format "Compiler/Testsuite/Environment", to create the hierarchy.
 * The project file node (e.g. "TestExplorer.vcm") is created based on enviroData.projectPath.
 * The last segment (environment name) is omitted because it will be created later.
 */
function getParentNodeForEnvironment(
  enviroData: environmentNodeDataType
): vcastTestItem | null {
  const pathParts = enviroData.displayName.split("/");

  if (enviroData.projectPath && enviroData.projectPath.length > 0) {
    // Managed project branch.
    let projectNode = globalProjectMap.get(enviroData.projectPath);
    if (!projectNode) {
      const projectDisplayName = path.basename(enviroData.projectPath);
      projectNode = globalController.createTestItem(
        enviroData.projectPath,
        projectDisplayName
      ) as vcastTestItem;
      projectNode.nodeKind = nodeKind.project;
      globalController.items.add(projectNode);
      globalProjectMap.set(enviroData.projectPath, projectNode);
    }
    let currentParent = projectNode;
    // Create the hierarchy: compiler -> testsuite (all segments except last).
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      const childId = `${currentParent.id}/${part}`;
      let childNode = currentParent.children.get(childId) as vcastTestItem;
      if (!childNode) {
        childNode = globalController.createTestItem(
          childId,
          part
        ) as vcastTestItem;
        if (i === 0) {
          childNode.nodeKind = nodeKind.compiler;
        } else if (i === 1) {
          childNode.nodeKind = nodeKind.testsuite;
        } else {
          childNode.nodeKind = nodeKind.testsuite;
        }
        currentParent.children.add(childNode);
      }
      currentParent = childNode;
    }
    return currentParent;
  } else {
    // Free environment: do not create a wrapping node.
    return null;
  }
}

export async function activateTestPane(context: vscode.ExtensionContext) {
  globalController = vscode.tests.createTestController(
    "vector-test-controller",
    "VectorCAST Tests"
  );
  context.subscriptions.push(globalController);

  // Removed the creation of globalProjectsNode and globalEnvironmentsNode.
  // Project nodes will be created dynamically when discovered.

  // Setup the refresh handler.
  globalController.refreshHandler = async () => {
    await refreshAllExtensionData();
  };

  // Custom handler for loading tests.
  await buildTestPaneContents();

  // Create the "Run" and "Debug" profiles.
  globalController.createRunProfile(
    "Run",
    vscode.TestRunProfileKind.Run,
    (request, cancellation) => processRunRequest(request, cancellation),
    true
  );
  globalController.createRunProfile(
    "Debug",
    vscode.TestRunProfileKind.Debug,
    (request, cancellation) => processRunRequest(request, cancellation, true),
    true
  );
}

export async function buildTestPaneContents() {
  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "VectorCAST Test Pane Initialization",
      cancellable: true,
    },
    async (progress, token) => {
      // This call will scan all workspace folders.
      await loadAllVCTests(progress, token);
    }
  );
}

export async function updateTestPane(enviroPath: string) {
  // This function updates what is displayed in the test tree.
  // It is called when we need to update a single environment node
  // after its children have changed, for example loading a
  // test script, or editing a coded test file

  const enviroData: environmentNodeDataType = getEnviroNodeData(enviroPath);
  const parentTreeNode = getParentNodeForEnvironment(enviroData);
  await updateTestsForEnvironment(parentTreeNode, enviroData);
}

interface codedTestFileDataType {
  checksum: number;
  enviroNodeIDSet: Set<string>;
  testNames: any;
}
// This map is used to cache the list of tests within a single coded test file
// we use this when we edit a file to know if the tests have changed
// the key is the coded test file path, the value is a codedTestFileDataType
let codedTestFileCache: Map<string, codedTestFileDataType> = new Map();

// This map is used to cache the list of coded test files in an environment.
// we use this when we change an environment to know what cbt files are affected
// the key is the enviroNodeID, the value is the list of cbt files
let enviroToCBTfilesCache: Map<string, Set<string>> = new Map();

export function removeCBTfilesCacheForEnviro(enviroNodeID: string) {
  // this function will remove the coded test file list from the cache
  // when we delete or are about to reload an environment
  const existingList: Set<string> | undefined =
    enviroToCBTfilesCache.get(enviroNodeID);

  for (let cbtFile of existingList || []) {
    let cacheData = codedTestFileCache.get(cbtFile);
    // remove this enviro from the list
    cacheData?.enviroNodeIDSet.delete(enviroNodeID);
    // if the list is empty remove the whole node
    if (cacheData?.enviroNodeIDSet.size == 0) {
      codedTestFileCache.delete(cbtFile);
    }
  }
  enviroToCBTfilesCache.delete(enviroNodeID);
}

function computeChecksum(filePath: string): number {
  // used to compute a checksum for a coded test file so that
  // we know if it has "really changed" when we get a write event

  // read contents of testFile into a string
  const content = fs.readFileSync(filePath);
  // compute the checksum
  return crypto.createHash("md5").update(content, "utf8").digest("hex");
}

async function addCodedTestfileToCache(
  enviroNodeID: string,
  functionNodeForCache: testNodeType
) {
  // this function will add a coded test file to the cache as we process the enviro data
  let fileCacheData: codedTestFileDataType | undefined = codedTestFileCache.get(
    functionNodeForCache.testFile
  );

  if (!fileCacheData) {
    const enviroPath: string = getEnviroPathFromID(enviroNodeID);
    fileCacheData = {
      checksum: computeChecksum(functionNodeForCache.testFile),
      enviroNodeIDSet: new Set(),
      testNames: await getCBTNamesFromFile(
        functionNodeForCache.testFile,
        enviroPath
      ),
    };
  }

  // add this enviroID to the list for this test file ...
  fileCacheData.enviroNodeIDSet.add(enviroNodeID);
  codedTestFileCache.set(functionNodeForCache.testFile, fileCacheData);

  // we also need to add this Coded Test file to the enviro cache
  let enviroCacheData: Set<string> | undefined =
    enviroToCBTfilesCache.get(enviroNodeID);
  if (enviroCacheData == undefined) {
    enviroCacheData = new Set();
  }
  enviroCacheData.add(functionNodeForCache.testFile);
  enviroToCBTfilesCache.set(enviroNodeID, enviroCacheData);
}

export async function updateCodedTestCases(editor: any) {
  // This function will compare the editor that was just saved against
  // the known coded test files in the workspace.  If there is a match,
  // and if the test cases in the file changed we will use clicast to
  // update the environment and then update the tree.  If the file changed
  // but the tests did not change we will only ask clicast to re-load the file

  // if this file is a coded test file for any environment in the workspace
  const filePath = editor.fileName;
  const codedTestFileData: codedTestFileDataType | undefined =
    codedTestFileCache.get(filePath);
  if (codedTestFileData) {
    // then check if the file has changed (checksum is different)
    // if it hasn't then we're done
    const currentChecksum = computeChecksum(filePath);
    if (currentChecksum != codedTestFileData.checksum) {
      // we need to do a refresh for every enviro node that uses this file
      // and then if the test names changed, also update the test pane
      let newTestNames: string[] | undefined = undefined;
      for (let enviroNodeID of codedTestFileData.enviroNodeIDSet.values()) {
        const enviroPath: string = getEnviroPathFromID(enviroNodeID);

        // update newTestNames if we have not yet computed them ...
        if (!newTestNames) {
          newTestNames = await getCBTNamesFromFile(filePath, enviroPath);
        }

        vectorMessage(
          `Refreshing coded test file: ${filePath} for environment: ${enviroPath} ...`
        );

        // call clicast to update the coded tests
        const refreshCommandStatus = await refreshCodedTests(
          enviroPath,
          enviroNodeID
        );

        // if the refresh worked, and the test names changed, then update test pane
        if (refreshCommandStatus.errorCode == 0) {
          updateTestPane(enviroPath);
        } else {
          vectorMessage("Error refreshing coded tests\n");
        }
      }
      // update the test names and checksum in all cases, rather than checking for diffs again
      codedTestFileData.testNames = newTestNames;
      codedTestFileData.checksum = currentChecksum;
    }
  }
}

// special is for compound and init
export enum nodeKind {
  projectGroup,
  project,
  environmentGroup,
  environment,
  unit,
  function,
  special,
  test,
  compiler,
  testsuite,
}
export interface vcastTestItem extends vscode.TestItem {
  // this is a simple wrapper that allows us to add additional
  // data that we might want to tag along with the test tree nodes

  // Thought I could use this in a package.json when clause
  // but have not figured this out yet.
  nodeKind?: nodeKind;

  // used to inhibit run for compound only tests
  isCompoundOnly?: boolean;

  // this is used for unit nodes to keep track of the
  // full path to the source file
  sourcePath?: string;
}
