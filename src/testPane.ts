// To build this I started with the Test Explorer that
// I created using the Test Explorer UI, and the followed their
// excellent step by step instructions from this repo example
// https://github.com/connor4312/test-controller-migration-example

import * as vscode from "vscode";

import {
  Position,
  Range,
  Uri,
  TestController,
  TestItemCollection,
  TestMessage,
} from "vscode";


import { clicastCommandToUse } from "./vcastUtilities";
import { updateDisplayedCoverage, updateCOVdecorations } from "./coverage";

import {
  updateTestDecorator,
} from "./editorDecorator";

import { errorLevel, vectorMessage } from "./messagePane";
import { viewResultsReport } from "./reporting";
import {
  addTestNodeToCache,
  clearTestNodeCache,
  compoundOnlyString,
  createTestNodeinCache,
  duplicateTestNode,
  getEnviroPathFromID,
  getFunctionNameFromID,
  getEnviroNameFromID,
  getTestNameFromID,
  getUnitNameFromID,
  testNodeType,
} from "./testData";

import {
  executeCommand,
  loadLaunchFile,
  addLaunchConfiguration,
} from "./utilities";
import {
  cfgOptionType,
  getVcastOptionValues,
} from "../src-common/commonUtilities";

import {
  getEnviroDataFromPython,
  getResultFileForTest,
  globalTestStatusArray,
  resetCoverageData,
  runVCTest,
  testDataType,
  testStatus,
  vcastEnviroFile,
} from "./vcastTestInterface";

const fs = require("fs");
const path = require("path");

// find test location in file
function getTestLocation(testFile: Uri, testName: string): vscode.Range {
  // This function will find the location of the VTEST in the
  // testfile and return a position that starts at this line.

  const filePath: string = testFile.fsPath;
  let startLine: number = 1;

  if (fs.existsSync(filePath)) {
    // I tried doing split on os.EOL, but this did not handle LF terminated lines on windows.
    const lines = fs
      .readFileSync(filePath, "utf-8")
      .replace("\r", "")
      .split("\n");
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const lineText = lines[lineIndex];
      if (lineText.startsWith("VTEST") && lineText.includes(testName)) {
        startLine = lineIndex + 1;
        break;
      }
    }
  }
  return new Range(new Position(startLine - 1, 0), new Position(startLine, 0));
}

// This function does the work of adding the actual tests
// to whatever parent is passed in generally a function node
function addTestNodes(
  controller: TestController,
  testList: any[],
  parentNode: TestItemCollection,
  parentNodeID: string,
  fileURI?: vscode.Uri
) {
  for (let testIndex = 0; testIndex < testList.length; testIndex++) {
    // we save the current test status to be used by updateStatusForNode
    let testData: testDataType = {
      status: testList[testIndex].status,
      passfail: testList[testIndex].passfail,
      time: testList[testIndex].time,
      notes: testList[testIndex].notes,
      resultFilePath: "",
      URI: fileURI,
      compoundOnly: testList[testIndex].compoundOnly,
    };

    let testName = testList[testIndex].testName;
    if (testData.compoundOnly)
      testName += compoundOnlyString;
    const testNodeID = parentNodeID + "." + testName;

    // add a cache node for the test
    let testNodeForCache: testNodeType = duplicateTestNode(parentNodeID);
    testNodeForCache.testName = testName;
    addTestNodeToCache(testNodeID, testNodeForCache);

    globalTestStatusArray[testNodeID] = testData;
    let testNode: vcastTestItem = controller.createTestItem(
      testNodeID,
      testName,
      fileURI
    );
    testNode.nodeKind = nodeKind.test;
    testNode.isCompoundOnly = testData.compoundOnly;
    if (fileURI) testNode.range = getTestLocation(fileURI, testName);
    parentNode.add(testNode);
  }
}


function processVCtestData(
  controller: TestController,
  enviroNodeID: string,
  enviroNode: vcastTestItem,
  enviroData: any
) {
  // enviroNodeID, is the parent of the nodes to be added here

  // The top level of the JSON is an array ...
  const unitList = enviroData.testData;
  for (let unitIndex = 0; unitIndex < unitList.length; unitIndex++) {
    const unitData = unitList[unitIndex];

    if (unitData.name == "uut_prototype_stubs") continue;

    const unitNodeID = `${enviroNodeID}|${unitData.name}`;

    // add a cache node for the unit
    let unitNodeForCache: testNodeType = duplicateTestNode(enviroNodeID);
    unitNodeForCache.unitName = unitData.name;
    addTestNodeToCache(unitNodeID, unitNodeForCache);

    let unitNode: vcastTestItem = controller.createTestItem(
      unitNodeID,
      unitData.name
    );
    unitNode.nodeKind = nodeKind.unit;
    if (unitData.path) unitNode.sourcePath = unitData.path;

    if (unitData.functions) {
      const functionList = unitData.functions;
      for (let fIndex = 0; fIndex < functionList.length; fIndex++) {
        let functionName: string = functionList[fIndex].name;
        functionName.replace("::", "-");
        functionName.replace("~", "-");

        const testList = functionList[fIndex].tests;
        const functionNodeID = `${unitNodeID}.${functionName}`;

        // add a cache node for the function
        let functionNodeForCache: testNodeType = duplicateTestNode(unitNodeID);
        functionNodeForCache.functionName = functionName;
        addTestNodeToCache(functionNodeID, functionNodeForCache);

        const functionNode: vcastTestItem = controller.createTestItem(
          functionNodeID,
          functionName
        );
        functionNode.nodeKind = nodeKind.function;

        addTestNodes(
          controller,
          testList,
          functionNode.children,
          functionNodeID
        );

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

      const specialNode: vcastTestItem = controller.createTestItem(
        specialNodeID,
        nodeName
      );
      specialNode.nodeKind = nodeKind.special;
      // we use sortText to force the compound and init nodes to the top of the tree
      specialNode.sortText = sortText;

      addTestNodes(controller, testList, specialNode.children, specialNodeID);

      enviroNode.children.add(specialNode);
    }
    if (unitNode.children.size > 0) enviroNode.children.add(unitNode);
  }
}

const glob = require("glob");
function getEnvironmentList(baseDirectory: string): string[] {
  // This function will find all of the VectorCAST and vTest
  // environments downstream of the current workspace

  const options = { cwd: baseDirectory, absolute: true };
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

// This is used in the package.json to control the display of context menu items
// Search for 'vectorcastTestExplorer.vcastEnviroList' in package.json to see where we reference it
// this list in a "when" clause
export var vcastEnviroList: string[] = [];

export function updateTestsForEnvironment(
  controller: TestController,
  enviroPath: string,
  workspaceRoot: string
) {
  // this will add one environment node to the test pane
  // this includes all units, functions, and tests for that environment

  // This is all of the data for a single environment
  let jsonData = getEnviroDataFromPython(enviroPath);

  if (jsonData) {
    let enviroDisplayName:string = "";
    if (workspaceRoot.length > 0) {
      enviroDisplayName = path.relative(workspaceRoot, enviroPath).replaceAll("\\", "/");
    }
    else {
      enviroDisplayName = enviroPath.replaceAll ("\\", "/");
    }

    // the vcast: prefix to allow package.json nodes to control
    // when the VectorCAST context menu should be shown
    const enviroNodeID: string = "vcast:" + enviroDisplayName;

    createTestNodeinCache(enviroNodeID, enviroPath, path.basename(enviroPath));

    // crateTestItem, takes ID,Label, the ID must be unique, so
    // we add a _index-value to it ...
    const enviroNode: vcastTestItem = controller.createTestItem(enviroNodeID, enviroDisplayName);
    enviroNode.nodeKind = nodeKind.enviro;

    // if we have data
    processVCtestData(controller, enviroNodeID, enviroNode, jsonData);

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
    controller.items.delete(enviroNode.id);
    controller.items.add(enviroNode);
  } else {
    vectorMessage(`Ignoring environment: ${enviroPath}\n`);
  }
}

export function removeEnvironmentFromTestPane(enviroID: string) {
  // called from the deleteEnviro command
  globalController.items.delete(enviroID);
}

async function loadAllVCTests(
  controller: TestController,
  progress: vscode.Progress<{ message?: string; increment?: number }>,
  token: vscode.CancellationToken
) {
  // loads all vcast test environemnts found in the workspace

  // throw away the existing items
  controller.items.replace([]);
  vcastEnviroList = [];
  clearTestNodeCache();

  let cancelled: boolean = false;

  if (vscode.workspace.workspaceFolders) {
    // for all folders that are open in the workspace
    for (const workspace of vscode.workspace.workspaceFolders) {
      const workspaceRoot = workspace.uri.fsPath;
      let environmentList = getEnvironmentList(workspaceRoot);

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
        updateTestsForEnvironment(controller, enviroPath, workspaceRoot);
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

function findLineForFunction(filePath: string, functionName: string): number {
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

  const functionNameWithoutParams = functionName.split("(")[0];
  for (const [index, line] of fileContents.entries()) {
    if (line.includes(functionNameWithoutParams)) {
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
  const jsonPath = path.join(workspacePath, ".vscode", "launch.json");
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
  const existingJSON: any = loadLaunchFile(launchJsonPath);
  if (existingJSON.configurations) {
    for (const existingConfig of existingJSON.configurations) {
      if (existingConfig.name === vectorcastLaunchConfigName) {
        returnValue = true;
        launchFilesWithVectorCASTConfig.set(launchJsonPath, true);
        break;
      }
    }
  }

  return returnValue;
}

async function debugNode(
  controller: vscode.TestController,
  request: vscode.TestRunRequest,
  node: vcastTestItem
) {
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

  // for compound and init
  let globPattern: string;
  const uutName = getUnitNameFromID(node.id);
  if (uutName == "not-used")
    // Improvement needed: would be nice to figure out the uut for the first slot ...
    globPattern = "S3_switch.*";
  else globPattern = uutName + "_vcast.*";

  const globOptions = { cwd: enviroPath, absolute: true };
  const sbfFilePath = glob.sync(globPattern, globOptions)[0];

  if (okToDebug(node, sbfFilePath, enviroOptions)) {
    let ourWorkspace = getWorkspacePath(enviroPath);

    if (ourWorkspace) {
      let debugConfigurationFound = false;
      const launchJsonPath = getLaunchJsonPath(ourWorkspace);
      const launchJsonUri = Uri.file(launchJsonPath);

      if (!launchFileExists(launchJsonPath)) {
        vectorMessage(
          `launch.json not found in ${launchJsonPath}.` +
            ` Generating \"VectorCAST Harness Debug\" configuration from template`
        );

        vscode.window.showWarningMessage(
          "launch.json not found.\n" +
            'Generating "VectorCAST Harness Debug" configuration from template'
        );

        createEmptyLaunchConfigFile(ourWorkspace, launchJsonPath);
        addLaunchConfiguration(launchJsonUri);
      } else {
        debugConfigurationFound = launchConfigExists(launchJsonPath);
        if (!debugConfigurationFound) addLaunchConfiguration(launchJsonUri);
      }

      if (debugConfigurationFound) {
        vectorMessage(
          `Preparing to debug test ${getTestNameFromID(node.id)} ... `
        );
        vscode.window.showInformationMessage(
          `Preparing to debug test ${getTestNameFromID(node.id)} ... `
        );

        // ok to debug, let's go!

        // this is the global that the launch.json links to ...
        pathToEnviroBeingDebugged = enviroPath;

        // disable coverage
        // we need to wait for this to complete, so we use executeCommand
        vectorMessage(`   - disabling coverage for environment ... `);
        const enviroArg = "-e " + getEnviroNameFromID(node.id);
        executeCommand(
          `${clicastCommandToUse} ${enviroArg} tools coverage disable `,
          path.dirname(enviroPath)
        );

        // run the test first without debug to setup the inputs
        // it's important that we wait for this to finish
        vectorMessage(`   - initializing test case inputs ... `);
        const run = controller.createTestRun(request);
        await runNode(node, run, true);
        run.end();

        // Improvement needed:
        // It would be nice if vcast saved away the function start location when building the _vcast file
        // open the sbf uut at the correct line for the function being tested
        const functionUnderTest = getFunctionNameFromID(node.id);
        const functionStartLine = findLineForFunction(
          sbfFilePath,
          functionUnderTest
        );
        const functionLocation: vscode.Range = new Range(
          new Position(functionStartLine, 0),
          new Position(functionStartLine, 100)
        );

        vectorMessage(
          `   - opening VectorCAST version of file: ${getUnitNameFromID(
            node.id
          )} ... `
        );
        var viewOptions: vscode.TextDocumentShowOptions = {
          viewColumn: 1,
          preserveFocus: false,
          selection: functionLocation,
        };
        vscode.workspace
          .openTextDocument(sbfFilePath)
          .then((doc: vscode.TextDocument) => {
            vscode.window.showTextDocument(doc, viewOptions);
          });

        // Prompt the user for what to do next!
        vscode.window.showInformationMessage(
          `Ready for debugging, choose launch configuration: "${vectorcastLaunchConfigName}" ... `
        );

        // we need this because we don't want to leave cover disabled
        executeCommand(
          `${clicastCommandToUse} ${enviroArg} tools coverage enable`,
          path.dirname(enviroPath)
        );
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
    // just do a normal test execute
    const run = controller.createTestRun(request);
    await runNode(node, run);
    run.end();
  }
}

let doingAMultiTestExecution = false;
export async function runNode(
  node: vcastTestItem,
  run: vscode.TestRun,
  preDebugMode: boolean = false
): Promise<void> {
  vectorMessage("Starting execution of test: " + node.label + " ...");
  run.started(node);

  // this does the actual work of running the test
  const enviroPath = getEnviroPathFromID(node.id);
  runVCTest(enviroPath, node.id).then((status) => {
    if (status == testStatus.didNotRun) {
      run.skipped(node);
    } else {
      if (status == testStatus.passed) run.passed(node);
      else if (status == testStatus.failed) {
        const textFilePath = getResultFileForTest(node.id);
        let failures = "";
        if (fs.existsSync(textFilePath)) {
          const contentsList = fs
            .readFileSync(textFilePath)
            .toString()
            .split("\n");
          for (var i = 0; i < contentsList.length; i++) {
            if (contentsList[i].includes("FAIL:"))
              failures += contentsList[i] + "\n";
          }
        }
        run.failed(node, new TestMessage(failures));
      }

      if (!preDebugMode) {
        let settings = vscode.workspace.getConfiguration(
          "vectorcastTestExplorer"
        );
        const showReport: boolean = settings.get("showReportOnExecute", false);
        if (!doingAMultiTestExecution && showReport) {
          viewResultsReport(node.id);
        }
        updateDisplayedCoverage();
      }
    }
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

// this does the actual work of running the tests
async function runTests(
  controller: vscode.TestController,
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
    controller.items.forEach((test) => nodeList.push(test));
  }

  const testList: vcastTestItem[] = getTestNodes(request, nodeList);
  doingAMultiTestExecution = testList.length > 1;

  // this does the actual execution of the full test list
  const run = controller.createTestRun(request);
  for (const test of testList) {
    if (cancellation.isCancellationRequested) run.skipped(test);
    else if (test.isCompoundOnly) run.skipped(test);
    else await runNode(test, run);
    // used to allow the message window to display properly
    await new Promise<void>((r) => setTimeout(r, 0));
  }
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
  controller: vscode.TestController,
  request: vscode.TestRunRequest,
  cancellation: vscode.CancellationToken,
  isDebug: boolean = false
) {

  // Debug is only valid for a single test node
  // requests.include will be null if the request is for all tests
  // or it will have a list if the request is for one or more tests
  // isSingleTestNode checks if it is exactly one and it is a test 
  // not a unit, function, ...
  if (isDebug && request.include && isSingleTestNode(request)) {
    const node = request.include[0];
    debugNode(controller, request, node);
  }
  else {
    // tell user that we are doing a normal run ...
    if (isDebug) {
      vscode.window.showInformationMessage(
        `Debug is only available for single test selections nodes, performing normal test execution.`
      );
    }
    runTests(controller, request, cancellation);
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
    (request, cancellation) =>
      processRunRequest(globalController, request, cancellation),
    true
  );
  globalController.createRunProfile(
    "Debug",
    vscode.TestRunProfileKind.Debug,
    (request, cancellation) =>
      processRunRequest(globalController, request, cancellation, true),
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
      await loadAllVCTests(globalController, progress, token);
    }
  );
}

export function updateTestPane(enviroPath: string) {
  // this function updates what is displayed in the test tree

  // Need to find the workspace root for this environment
  let workspaceRoot : string = "";
  if (vscode.workspace) {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(
      vscode.Uri.file(enviroPath)
    );
    if (workspaceFolder) workspaceRoot = workspaceFolder.uri.fsPath;
  }
  updateTestsForEnvironment(globalController, enviroPath, workspaceRoot);
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
  isCompoundOnly?:boolean;

  // this is used for unit nodes to keep track of the
  // full path to the source file
  sourcePath?: string;
}
