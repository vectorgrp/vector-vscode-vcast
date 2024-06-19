// To build this I started with the Test Explorer that
// I created using the Test Explorer UI, and the followed their
// excellent step by step instructions from this repo example
// https://github.com/connor4312/test-controller-migration-example

import * as vscode from "vscode";

import { Position, Range, Uri, TestMessage } from "vscode";

import { updateDisplayedCoverage, updateCOVdecorations } from "./coverage";

import { updateTestDecorator } from "./editorDecorator";

import { updateExploreDecorations } from "./fileDecorator";

import {
  errorLevel,
  openMessagePane,
  vcastMessage,
  vectorMessage,
} from "./messagePane";

import { viewResultsReport } from "./reporting";

import {
  addTestNodeToCache,
  clearTestNodeCache,
  compoundOnlyString,
  createTestNodeinCache,
  duplicateTestNode,
  getEnviroPathFromID,
  getEnviroNodeIDFromID,
  getFunctionNameFromID,
  getTestNameFromID,
  getUnitNameFromID,
  testNodeType,
} from "./testData";

import {
  addLaunchConfiguration,
  forceLowerCaseDriveLetter,
  loadLaunchFile,
  openFileWithLineSelected,
} from "./utilities";

import {
  deleteSingleTest,
  loadScriptIntoEnvironment,
  refreshCodedTests,
} from "./vcastAdapter";


import {  getJsonDataFromTestInterface } from "./vcastCommandRunner"
import { globalPathToSupportFiles, launchFile } from "./vcastInstallation";

import {
  getEnviroDataFromPython,
  getResultFileForTest,
  globalTestStatusArray,
  resetCoverageData,
  runVCTest,
  testDataType,
  vcastEnviroFile,
} from "./vcastTestInterface";


import {
  adjustScriptContentsBeforeLoad,
  closeAnyOpenErrorFiles,
  generateAndLoadATGTests,
  generateAndLoadBasisPathTests,
  parseCBTCommand,
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
const codedTestDisplayName = " Coded Tests";
function processVCtestData(
  enviroNodeID: string,
  enviroNode: vcastTestItem,
  enviroData: any
) {
  // enviroNodeID, is the parent of the nodes to be added here

  // The top level of the JSON is an array ...
  const unitList = enviroData.testData;
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

        if (
          functionName == codedTestFunctionName &&
          functionNodeForCache.testFile.length > 0
        ) {
          addCodedTestfileToCache(enviroNodeID, functionNodeForCache);
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

const glob = require("glob");
function getEnvironmentList(baseDirectory: string): string[] {
  // This function will find all of the VectorCAST and vTest
  // environments downstream of the current workspace

  const options = { cwd: baseDirectory, absolute: true, strict: false };
  let fileList = glob.sync("**/" + vcastEnviroFile, options);

  // now we have a list of the UNITDATA.VCD files downstream of us
  // so turn this into a list of the enclosing directories only
  let returnList: string[] = [];
  for (const file of fileList) {
    // note that glob always uses / as path separator ...
    if (!file.includes(".BAK")) {
      returnList.push(path.dirname(file));
    }
  }

  return returnList;
}

// These variables are used in the package.json to control the display of context menu items
// Search for 'vectorcastTestExplorer.vcastEnviroList | vcastHasCodedTestsList' in package.json
// to see where we reference them
// this list in a "when" clause
let vcastEnviroList: string[] = [];
let vcastHasCodedTestsList: string[] = [];

export function updateTestsForEnvironment(
  enviroPath: string,
  workspaceRoot: string
) {
  // this will add one environment node to the test pane
  // this includes all units, functions, and tests for that environment

  // This is all of the data for a single environment
  let jsonData = getEnviroDataFromPython(enviroPath);

  if (jsonData) {
    let enviroDisplayName: string = "";
    if (workspaceRoot.length > 0) {
      enviroDisplayName = path
        .relative(workspaceRoot, enviroPath)
        .replaceAll("\\", "/");
    } else {
      enviroDisplayName = enviroPath.replaceAll("\\", "/");
    }

    // the vcast: prefix to allow package.json nodes to control
    // when the VectorCAST context menu should be shown
    const enviroNodeID: string = "vcast:" + enviroDisplayName;

    createTestNodeinCache(enviroNodeID, enviroPath, path.basename(enviroPath));

    // crateTestItem, takes ID,Label, the ID must be unique, so
    // we add a _index-value to it ...
    const enviroNode: vcastTestItem = globalController.createTestItem(
      enviroNodeID,
      enviroDisplayName
    );
    enviroNode.nodeKind = nodeKind.enviro;

    // if we have data
    processVCtestData(enviroNodeID, enviroNode, jsonData);

    // this is used by the package.json to control content (right click) menu choices
    if (!vcastEnviroList.includes(enviroNodeID)) {
      vcastEnviroList.push(enviroNodeID);
      vscode.commands.executeCommand(
        "setContext",
        "vectorcastTestExplorer.vcastEnviroList",
        vcastEnviroList
      );
    }
    // starting with VS Code 1.81 the tree was not updating unless I added the delete
    globalController.items.delete(enviroNode.id);
    globalController.items.add(enviroNode);
  } else {
    vectorMessage(`Ignoring environment: ${enviroPath}\n`);
  }
}

export function removeEnvironmentFromTestPane(enviroID: string) {
  // called from the deleteEnviro command
  globalController.items.delete(enviroID);
}

export let vcastEnvironmentsFound: boolean = false;
async function loadAllVCTests(
  progress: vscode.Progress<{ message?: string; increment?: number }>,
  token: vscode.CancellationToken
) {
  // loads all vcast test environemnts found in the workspace

  // throw away the existing items
  globalController.items.replace([]);
  vcastEnviroList = [];
  clearTestNodeCache();

  let cancelled: boolean = false;

  if (vscode.workspace.workspaceFolders) {
    // for all folders that are open in the workspace
    for (const workspace of vscode.workspace.workspaceFolders) {
      const workspaceRoot = workspace.uri.fsPath;
      let environmentList = getEnvironmentList(workspaceRoot);

      // used in the activation processing
      if (environmentList.length > 0) vcastEnvironmentsFound = true;

      // increment is added to the progress bar by each call to progress.report
      // this is not perfect because we don't know how many environments will exist in each workspace
      const increment =
        (1 /
          (vscode.workspace.workspaceFolders.length * environmentList.length)) *
        100;

      for (const enviroPath of environmentList) {
        progress.report({
          increment: increment,
          message: "Loading data for environment: " + enviroPath,
        });
        // This is needed to allow the message window to update ...
        await new Promise<void>((r) => setTimeout(r, 0));
        if (token) {
          token.onCancellationRequested(() => {
            cancelled = true;
          });
        }
        if (cancelled) {
          break;
        }
        updateTestsForEnvironment(enviroPath, workspaceRoot);
      } // for each enviropath
      if (cancelled) {
        break;
      }
    } // for workspace folders
  } // if workspace folders

  // once the data is loaded update the coverage and test icons for the active editor
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
      returnLineNumber = index;
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
        const debugFileAsTextDoc = await vscode.workspace.openTextDocument(
          launchJsonUri
        );
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
  return runVCTest(enviroPath, node.id, generateReport).then((status) => {
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
        const textFilePath = getResultFileForTest(node.id);

        // find the summary line that starts with "Expected Results", and add to testMessage
        const lines = fs.readFileSync(textFilePath, "utf-8").split("\n");
        let failMessage: TestMessage = new TestMessage("");
        for (let line of lines) {
          // start of line, any number of spaces, search text ...
          if (/^\s*Expected Results matched.*/.test(line)) {
            // remove the EOL and squash multiple spaces into 1
            failMessage = new TestMessage(line.trimEnd().replace(/\s+/g, " "));
            break;
          }
        }
        run.failed(node, failMessage);
      }

      if (generateReport) {
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

export function updateDataForEnvironment(enviroPath: string) {
  // this function does all of the "common" work when an environment is updated
  // sources of environment update are things like:
  //   - opening the environment in the vcast gui
  //   - building a new environment
  //   - ...

  updateTestPane(enviroPath);
  updateDisplayedCoverage();
  updateExploreDecorations();
  updateTestDecorator();
}

function shouldGenerateExecutionReport(testList: vcastTestItem[]): boolean {
  // a helper function for determining if we should show the report

  let settings = vscode.workspace.getConfiguration("vectorcastTestExplorer");
  const showReport: boolean = settings.get("showReportOnExecute", false);
  return testList.length == 1 && showReport;
}

// this does the actual work of running the tests
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
    updateDataForEnvironment(enviroPath);
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
    const commandStatus = deleteSingleTest(node.id);

    if (commandStatus.errorCode == 0) {
      changedEnvironmentIDList.add(getEnviroNodeIDFromID(node.id));
    } else {
      vectorMessage("Test delete failed ...");
      vcastMessage(commandStatus.stdout);
      openMessagePane();
    }
  }

  // now update all of the environments that changed
  for (let enviroNodeID of changedEnvironmentIDList) {
    // remove any coded test files from the cache since
    // they will be re-added by the update
    removeCBTfilesCacheForEnviro(enviroNodeID);
    updateDataForEnvironment(getEnviroPathFromID(enviroNodeID));
  }
}

export async function insertBasisPathTests(testNode: testNodeType) {
  // this will insert basis path tests for the given test node

  generateAndLoadBasisPathTests(testNode);
}

export async function insertATGTests(testNode: testNodeType) {
  // this will insert basis path tests for the given test node

  generateAndLoadATGTests(testNode);
  updateTestPane(testNode.enviroPath);
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
      loadScriptIntoEnvironment(enviroName, scriptPath);

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

// create the controller
let globalController: vscode.TestController;

export function activateTestPane(context: vscode.ExtensionContext) {
  globalController = vscode.tests.createTestController(
    "vector-test-controller",
    "VectorCAST Tests"
  );
  context.subscriptions.push(globalController);

  // processing for the common refresh icon in the test explorer
  globalController.refreshHandler = async () => {
    resetCoverageData();
    buildTestPaneContents();
    updateCOVdecorations();
  };

  // Custom handler for loading tests. The "test" argument here is undefined,
  // but if we supported lazy-loading child test then this could be called with
  // the test whose children VS Code wanted to load.
  buildTestPaneContents();

  // We'll create the "run" type profile here, and give it the function to call.
  // The last `true` argument indicates that this should be the default
  // "run" profile, in case there are multiple run profiles.
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

export function buildTestPaneContents() {
  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "VectorCAST Test Pane Initialization",
      cancellable: true,
    },
    async (progress, token) => {
      // this call will spin thorough all of the workspace folders
      // to find VectorCAST environments
      //
      // key is to wait for this to finish
      await loadAllVCTests(progress, token);
    }
  );
}

export function updateTestPane(enviroPath: string) {
  // this function updates what is displayed in the test tree

  // Need to find the workspace root for this environment
  let workspaceRoot: string = "";
  if (vscode.workspace) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(
      vscode.Uri.file(enviroPath)
    );
    if (workspaceFolder) workspaceRoot = workspaceFolder.uri.fsPath;
  }
  updateTestsForEnvironment(enviroPath, workspaceRoot);
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

// This map is used to cache the list of coded test file in an environment.
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

function getListOfTestsFromFile(filePath: string, enviroNodeID: string): any {
  // this function calls the vTestInterface.py to get the list of tests from a cbt file

  const commandToRun = parseCBTCommand(filePath);
  const enviroPath = getEnviroPathFromID(enviroNodeID);
  return getJsonDataFromTestInterface(commandToRun, enviroPath);
}

function addCodedTestfileToCache(
  enviroNodeID: string,
  functionNodeForCache: testNodeType
) {
  // this function will add a coded test file to the cache as we process the enviro data
  let fileCacheData: codedTestFileDataType | undefined = codedTestFileCache.get(
    functionNodeForCache.testFile
  );

  if (!fileCacheData) {
    fileCacheData = {
      checksum: computeChecksum(functionNodeForCache.testFile),
      enviroNodeIDSet: new Set(),
      testNames: getListOfTestsFromFile(
        functionNodeForCache.testFile,
        enviroNodeID
      ),
    };
  }

  // add this enviroID to the list for this test file ...
  fileCacheData.enviroNodeIDSet.add(enviroNodeID);
  codedTestFileCache.set(functionNodeForCache.testFile, fileCacheData);

  // we also need to add this cbt file to the enviro cache
  let enviroCacheData: Set<string> | undefined =
    enviroToCBTfilesCache.get(enviroNodeID);
  if (enviroCacheData == undefined) {
    enviroCacheData = new Set();
  }
  enviroCacheData.add(functionNodeForCache.testFile);
  enviroToCBTfilesCache.set(enviroNodeID, enviroCacheData);
}

export function updateCodedTestCases(editor: any) {
  // This function will compare the editor that was just saved against
  // the known coded test files in the workspace.  If there is a match,
  // and if the test cases in the file changed we will use clicast to
  // update the environment and then update the tree.  If the file changed
  // but the tests did not change we will only ask clicast to re-load the file

  // if this file is a coded test file for any enviornment in the workspace
  const filePath = editor.fileName;
  const codedTestFileData: codedTestFileDataType | undefined =
    codedTestFileCache.get(filePath);
  if (codedTestFileData) {
    // then check if the file has changed (checksum is differnt)
    // if it hasn't then we're done
    const currentChecksum = computeChecksum(filePath);
    if (currentChecksum != codedTestFileData.checksum) {
      // we need to do a refresh for every enviro node that uses this file
      // and then if the test names changed, also update the test pane
      let newTestNames: string[] | undefined;
      for (let enviroNodeID of codedTestFileData.enviroNodeIDSet.values()) {
        const enviroPath: string = getEnviroPathFromID(enviroNodeID);

        // update newTestNames if we have not yet computed them ...
        if (!newTestNames) {
          newTestNames = getListOfTestsFromFile(filePath, enviroNodeID);
        }

        vectorMessage(
          `Refreshing coded test file: ${filePath} for environment: ${enviroPath}`
        );

        // call clicast to update the coded tests
        const refreshCommandStatus = refreshCodedTests(
          enviroPath,
          enviroNodeID
        );

        // if the refresh worked, and the test names changed, then update test pane
        if (refreshCommandStatus.errorCode == 0) {
          updateTestPane(enviroPath);
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
  enviro,
  unit,
  function,
  special,
  test,
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
