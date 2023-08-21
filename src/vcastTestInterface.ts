import { EOL } from "os";
import * as vscode from "vscode";
import { Uri } from "vscode";


import {
  updateFunctionDataForFile,
} from "./editorDecorator";

import { showSettings, updateDataForEnvironment } from "./helper";
import {
  openMessagePane,
  vectorMessage,
  vcastMessage,
  errorLevel,
} from "./messagePane";
import { 
  compoundOnlyString, 
  getEnviroPathFromID, 
  getTestNode, 
  testNodeType } from "./testData";
import {
  clicastCommandToUse,
  commandStatusType,
  executeClicastCommand,
  executeCommand,
  executeVPythonScript,
  fixDriveLetterForPython,
  getChecksumCommand,
  getJsonDataFromTestInterface,
  testInterfaceCommand,
} from "./utilities";
import { fileDecorator } from "./fileDecorator";

const fs = require("fs");
const path = require("path");


export const vcastEnviroFile = "UNITDATA.VCD";

const defaultUTlocation = "./unitTests";
export function getUnitTestLocationForPath(dirpath: string): string {
  // path points to the place where we want to create a UT folder

  // By default the unit tests get created in the "unitTests" directory
  // but this can be controlled with an option

  let settings = vscode.workspace.getConfiguration("vectorcastTestExplorer");
  let unitTestLocation: string = settings.get(
    "unitTestLocation",
    defaultUTlocation
  );

  if (unitTestLocation.startsWith(".")) {
    unitTestLocation = path.join(dirpath, unitTestLocation);
  }

  return unitTestLocation;
}

export function getChecksum(filePath: string) {
  let returnValue = 0;
  const checksumCommand = getChecksumCommand();
  if (checksumCommand) {
    let commandOutputString: string;
    if (checksumCommand.endsWith(".py"))
      commandOutputString = executeVPythonScript(
        `${checksumCommand} ${filePath}`,
        path.dirname(filePath)
      );
    else
      commandOutputString = executeCommand(
        `${checksumCommand} ${filePath}`
      ).stdout;

    // convert the to a number and return
    // this will crash if something is wrong with the result
    try {
      if (commandOutputString.includes("ACTUAL-DATA")) {
        const pieces = commandOutputString.split("ACTUAL-DATA", 2);
        returnValue = Number(pieces[1].trim());
      } else {
        returnValue = Number(commandOutputString);
      }
    } catch {
      returnValue = 0;
    }
  }
  return returnValue;
}

export function getEnviroDataFromPython(enviroPath: string): any {
  // This function will return the environment data for a single directory

  let jsonData = undefined;

  // what we get back is a JSON formatted string (if the command works)
  // that has two sub-fields: testData, and unitData
  vectorMessage("Processing environment data for: " + enviroPath);

  const commandToRun = testInterfaceCommand("getEnviroData", enviroPath);
  jsonData = getJsonDataFromTestInterface(commandToRun, enviroPath);

  if (jsonData) {
    updateGlobalDataForFile(enviroPath, jsonData.unitData);
  }

  return jsonData;
}

function getCoverageDataFromPython(enviroPath: string): any {
  // This function calls the python interface to get the coverage data for one environment
  // what we get back is a JSON formatted string (if the command works)

  let jsonData: any;

  const commandToRun = testInterfaceCommand("getCoverageData", enviroPath);
  jsonData = getJsonDataFromTestInterface(commandToRun, enviroPath);
  return jsonData;
}

// we save the some key data, indexed into by test.id
// at the time that we build the test tree
export interface testDataType {
  status: string;
  passfail: string;
  time: string;
  resultFilePath: string;
  notes: string;
  URI: vscode.Uri | undefined;
  compoundOnly: boolean;
}

// This allows us to get diret access to the test nodes via the ID
export interface testStatusArrayType {
  [id: string]: testDataType;
}
export var globalTestStatusArray = <testStatusArrayType>{};

export function addTestDataToStatusArray(
  testID: string,
  testData: testDataType
): void {
  globalTestStatusArray[testID] = testData;
}

export function clearTestDataFromStatusArray(): void {
  globalTestStatusArray = {};
}

// List of source file from all local environments
interface coverageDataType {
  crc32Checksum: number;
  covered: number[];
  uncovered: number[];
}

interface fileCoverageType {
  hasCoverage: boolean;
  enviroList: Map<string, coverageDataType>; //key is enviroPath
}

// key is filePath
var globalCoverageData = new Map<string, fileCoverageType>();

/////////////////////////////////////////////////////////////////////
export function resetCoverageData() {
  // this should be called whenever we want to reload all coverage data
  globalCoverageData.clear();
}

interface coverageSummaryType {
  statusString: string;
  covered: number[];
  uncovered: number[];
}

//////////////////////////////////////////////////////////////////////
export function getCoverageDataForFile(filePath: string): coverageSummaryType {
  // this function will combine the coverage for all instances of
  // filePath that match the provided checksum into a single coverageDataType

  // .statusString will be "no-coverage-data" if there are no environments
  // with coverage for this file

  // .statusString will be null if there is at least one environment
  // that that matches the checksum for this file

  // .statusString will be "out-of-date" if ALL no enviro checksums match this file

  const checksum: number = getChecksum(filePath);
  let returnData: coverageSummaryType = {
    statusString: "No Coverage Data",
    covered: [],
    uncovered: [],
  };

  const dataForThisFile = globalCoverageData.get(filePath);
  if (dataForThisFile && dataForThisFile.enviroList.size > 0) {
    let coveredList: number[] = [];
    let uncoveredList: number[] = [];
    for (var enviroData of dataForThisFile.enviroList.values()) {
      if (enviroData.crc32Checksum == checksum) {
        coveredList = coveredList.concat(enviroData.covered);
        uncoveredList = uncoveredList.concat(enviroData.uncovered);
      }
    }

    if (coveredList.length == 0 && uncoveredList.length == 0) {
      returnData.statusString = "Coverage Out of Date";
    } else {
      returnData.statusString = "";
      // remove duplicates
      returnData.covered = [...new Set(coveredList)];
      returnData.uncovered = [...new Set(uncoveredList)];
    }
  }

  return returnData;
}

export function getListOfFilesWithCoverage(): string[] {
  let returnList: string[] = [];

  for (let [filePath, enviroData] of globalCoverageData.entries()) {
    if (enviroData.hasCoverage && !returnList.includes(filePath))
      returnList.push(filePath);
  }
  return returnList;
}

// we keep track of the files for each enviro, so that its faster
// to remove coverage when an enviro is deleted.

// key is enviroPath, value is a list of filePaths
let enviroFileList: Map<string, string[]> = new Map();

function updateGlobalDataForFile(
  enviroPath: string,
  fileList: any[]
) {
  let filePathList: string[] = [];

  for (let fileIndex = 0; fileIndex < fileList.length; fileIndex++) {
    
    let filePath = fixDriveLetterForPython (fileList[fileIndex].path);
    filePathList.push(filePath);

    const checksum = fileList[fileIndex].cmcChecksum;
    if (checksum > 0) {
      let coveredList: number[] = [];
      if (fileList[fileIndex].covered.length > 0)
        coveredList = fileList[fileIndex].covered.split(",").map(Number);

      let uncoveredList: number[] = [];
      if (fileList[fileIndex].uncovered.length > 0)
        uncoveredList = fileList[fileIndex].uncovered.split(",").map(Number);

      let coverageData: coverageDataType = {
        crc32Checksum: checksum,
        covered: coveredList,
        uncovered: uncoveredList,
      };

      let fileData: fileCoverageType | undefined =
        globalCoverageData.get(filePath);

      // if there is not existing data for this file
      if (!fileData) {
        fileData = { hasCoverage: false, enviroList: new Map() };
        globalCoverageData.set(filePath, fileData);
      }

      fileData.hasCoverage =
        fileData.hasCoverage || coverageData.covered.length > 0;
      fileData.enviroList.set(enviroPath, coverageData);

      // if file decoration is active, update the decorations ...
      if (fileDecorator) {
        if (fileData.hasCoverage)
          fileDecorator.addCoverageDecorationToFile(filePath);
        else fileDecorator.removeCoverageDecorationFromFile(filePath);
      }

      // update the testable function icons for this file
      updateFunctionDataForFile (
        enviroPath,
        filePath,
        fileList[fileIndex].functionList);

    }
  }
  enviroFileList.set(enviroPath, filePathList);
}

export function removeCoverageDataForEnviro(enviroPath: string) {
  let filePathList: string[] | undefined = enviroFileList.get(enviroPath);
  if (filePathList) {
    for (let filePath of filePathList) {
      let coverageForFile: fileCoverageType | undefined =
        globalCoverageData.get(filePath);
      // if there is coverage data for this file
      if (coverageForFile) {
        coverageForFile.enviroList.delete(enviroPath);
        if (coverageForFile.enviroList.size == 0) {
          coverageForFile.hasCoverage = false;
        }
      }
    }
  }
}

export function updateCoverageData(enviroPath: string) {
  // This function loads the coverage data for one environment
  // from the vcast python interface, and then updates globalCoverageData
  // This global data is then used by updateCOVdecorations

  let jsonData = getCoverageDataFromPython(enviroPath);
  if (jsonData) updateGlobalDataForFile(enviroPath, jsonData);
}

export function getResultFileForTest(testID: string) {
  // This function will return the path to the result file if it is already saved
  // in the globalTestStatus array, otherwise it will ask Python to generate the report
  let resultFile: string = globalTestStatusArray[testID].resultFilePath;
  if (!fs.existsSync(resultFile)) {
    let cwd = getEnviroPathFromID(testID);

    const commandToRun = testInterfaceCommand("results", cwd, testID);
    const commandOutputText = executeVPythonScript(commandToRun, cwd);

    if (commandOutputText) {
      const firstLineOfOutput: string = commandOutputText.split(EOL, 1)[0];
      resultFile = firstLineOfOutput.replace("REPORT:", "");

      if (!fs.existsSync(resultFile)) {
        vscode.window.showWarningMessage(
          `Results report: '${resultFile}' does not exist`
        );
        vectorMessage(`Results report: '${resultFile}' does not exist`);
        vectorMessage(commandToRun);
        vectorMessage(commandOutputText);
      }

      globalTestStatusArray[testID].resultFilePath = resultFile;
    }
  }

  return resultFile;
}

interface executeOutputType {
  status: string;
  resultsFilePath: string;
  time: string;
  passfail: string;
  stdOut: string;
}

function processExecutionOutput(commandOutput: string): executeOutputType {
  let returnData: executeOutputType = {
    status: "failed",
    stdOut: "",
    resultsFilePath: "",
    time: "",
    passfail: "",
  };
  const outputLineList: string[] = commandOutput.split(EOL);

  for (let lineIndex = 0; lineIndex < outputLineList.length; lineIndex++) {
    const line: string = outputLineList[lineIndex];
    console.log(`LINE IS: ${line}`);
    if (line.startsWith("STATUS:"))
      returnData.status = line.replace("STATUS:", "");
    else if (line.startsWith("REPORT:"))
      returnData.resultsFilePath = line.replace("REPORT:", "");
    else if (line.startsWith("PASSFAIL:"))
      returnData.passfail = line.replace("PASSFAIL:", "");
    else if (line.startsWith("TIME:"))
      returnData.time = line.replace("TIME:", "");
    else returnData.stdOut += line + EOL;
  }
  return returnData;
}

// with the old test case interface we could have a hover-over
// for each test, and we inserted this info there.
// I could not figure out how to do this with the native API
// so for now, I am logging this to the message pane.
function logTestResults(
  testID: string,
  rawOutput: string,
  testData: executeOutputType
) {
  vcastMessage("-".repeat(100));
  vcastMessage("stdout for: " + testID);
  vcastMessage(rawOutput);

  vectorMessage("-".repeat(100));
  vectorMessage("Test summary for: " + testID);
  vectorMessage(
    testData.status.length > 0 ? "Status: " + testData.status : "Status:"
  );
  vectorMessage(
    testData.passfail.length > 0 ? "Values: " + testData.passfail : "Values:"
  );
  vectorMessage(
    testData.time.length
      ? "Execution Time: " + testData.time
      : "Execution Time:"
  );
  vectorMessage("-".repeat(100));
}

export enum testStatus {
  didNotRun,
  passed,
  failed,
}
export async function runVCTest(enviroPath: string, nodeID: string) {
  // Initially, I called clicast directly here, but I switched to the python binding to give
  // more flexibility for things like: running, and generating the execution report in one action

  // commandOutput is a buffer: (Uint8Array)
  // RUN mode is a single shot mode where we run the python
  // script and communicate with stdin/stdout

  const commandToRun = testInterfaceCommand("executeTest", enviroPath, nodeID);
  const commandOutputText = executeVPythonScript(commandToRun, enviroPath);

  if (commandOutputText) {
    if (commandOutputText.startsWith("FATAL")) {
      vectorMessage(commandOutputText.replace("FATAL", ""));
      openMessagePane();
      return testStatus.didNotRun;
    } else if (commandOutputText.includes("Resolve Errors")) {
      vectorMessage(commandOutputText);
      openMessagePane();
      return testStatus.didNotRun;
    } else {
      const decodedOutput = processExecutionOutput(commandOutputText);
      logTestResults(nodeID, commandOutputText, decodedOutput);

      let updatedStatusItem = globalTestStatusArray[nodeID];

      if (updatedStatusItem) {
        updatedStatusItem.status = decodedOutput.status;
        updatedStatusItem.resultFilePath = decodedOutput.resultsFilePath;
        globalTestStatusArray[nodeID] = updatedStatusItem;

        updateDataForEnvironment(enviroPath);

        if (updatedStatusItem.status == "passed") return testStatus.passed;
        else return testStatus.failed;
      } else {
        return testStatus.didNotRun;
      }
    }
  }
  return testStatus.didNotRun;
}

function createVcastEnvironmentScript(
  cwd: string,
  enviroName: string,
  fileList: string[]
) {
  // compute the UUT and SEARCH_LIST lists
  // Improvement needed: Add source locations for include paths from cpp_properties
  let uutList: string[] = [];
  let searchList: string[] = [];
  for (let index = 0; index < fileList.length; index++) {
    const filePath = fileList[index];
    // must strip the extension ...
    const uutName = path.basename(filePath).split(".")[0];
    uutList.push(uutName);
    const candidatePath = path.dirname(filePath);
    if (!searchList.includes(candidatePath)) {
      searchList.push(candidatePath);
    }
  }

  const envFilePath = path.join(cwd, enviroName + ".env");

  fs.writeFileSync(envFilePath, `ENVIRO.NEW\n`, { flag: "w" });
  fs.writeFileSync(envFilePath, `ENVIRO.NAME: ${enviroName}\n`, { flag: "a+" });
  fs.writeFileSync(envFilePath, "ENVIRO.COVERAGE_TYPE: Statement\n", {
    flag: "a+",
  });
  fs.writeFileSync(envFilePath, "ENVIRO.WHITE_BOX: YES\n", { flag: "a+" });
  fs.writeFileSync(envFilePath, "ENVIRO.COMPILER: CC\n", { flag: "a+" });

  searchList.forEach((item) =>
    fs.writeFileSync(envFilePath, `ENVIRO.SEARCH_LIST: ${item}\n`, {
      flag: "a+",
    })
  );
  uutList.forEach((item) =>
    fs.writeFileSync(envFilePath, `ENVIRO.STUB_BY_FUNCTION: ${item}\n`, {
      flag: "a+",
    })
  );
  fs.writeFileSync(envFilePath, "ENVIRO.END", { flag: "a+" });
  return envFilePath;
}

function buildEnvironmentVCAST(
  fileList: string[],
  unitTestLocation: string,
  enviroName: string
) {
  // use the first filename in the list as the environment name

  vectorMessage(new Array(101).join("-"));
  vectorMessage(
    "Creating environment '" +
      enviroName +
      " for " +
      fileList.length +
      " file(s) ..."
  );

  const enviroPath = path.join(unitTestLocation, enviroName);
  const envFilePath = createVcastEnvironmentScript(
    unitTestLocation,
    enviroName,
    fileList
  );

  // we need to wait for this to complete, so we use executeCommand
  executeCommand(
    `${clicastCommandToUse} -lc template GNU_CPP_X`,
    unitTestLocation
  );

  // this call will run clicast in the background
  const clicastArgs = ["-lc", "env", "build", envFilePath];
  // This is long running commands so we open the message pane to give the user a sense of what is going on.
  openMessagePane();
  executeClicastCommand(
    clicastArgs,
    unitTestLocation,
    updateDataForEnvironment,
    enviroPath
  );
}

function configureWorkspaceAndBuildEnviro(
  fileList: string[],
  unitTestLocation: string
) {
  // This function will check if unit test directory exists
  // and if not ask the user if we should auto-create it or not

  if (fs.existsSync(unitTestLocation)) {
    commonNewEnvironmentStuff(fileList, unitTestLocation);
  } else {
    const message =
      "Unit test location: '" +
      unitTestLocation +
      " does not exist.\n" +
      "Do you want to create and initialize this directory?";
    vscode.window
      .showInformationMessage(message, "Yes", "No")
      .then((answer) => {
        if (answer === "Yes") {
          fs.mkdirSync(unitTestLocation);
          commonNewEnvironmentStuff(fileList, unitTestLocation);
        } else {
          vscode.window.showWarningMessage(
            `Please create the unit test directory: '${unitTestLocation}', or update the 'Unit Test Location' option`
          );
          showSettings();
        }
      });
  }
}

function commonNewEnvironmentStuff(
  fileList: string[],
  unitTestLocation: string
) {
  if (fileList.length > 0) {
    const firstFile = fileList[0];
    const filename = path.basename(firstFile);
    let enviroName = filename.split(".")[0].toUpperCase();

    // if multiple files are in the list make the enviroName the hyphenated name of the first 2
    if (fileList.length > 1) {
      enviroName += `-${path
        .basename(fileList[1])
        .split(".")[0]
        .toUpperCase()}`;
    }

    let enviroPath = path.join(unitTestLocation, enviroName);

    if (fs.existsSync(enviroPath)) {
      vscode.window
        .showInputBox({
          prompt: `Directory: "${enviroName}" already exists, please choose an alternate name ...`,
          title: "Choose VectorCAST Environment Name",
          value: enviroName,
          ignoreFocusOut: true,
        })
        .then((response) => {
          if (response) {
            enviroName = response.toUpperCase();
            enviroPath = path.join(unitTestLocation, response);
            if (fs.existsSync(enviroPath))
              vscode.window.showErrorMessage(
                `Environment name: ${enviroName}, already in use, aborting`
              );
            else
              buildEnvironmentVCAST(
                fileList,
                unitTestLocation,
                response.toUpperCase()
              );
          }
        });
    } else {
      buildEnvironmentVCAST(
        fileList,
        unitTestLocation,
        enviroName.toUpperCase()
      );
    }
  } else vectorMessage("No C/C++ source files found in selection ...");
}

// Improvement needed: get the language extensions automatically, don't hard-code
const extensionsOfInterest = ["c", "cpp", "cc", "cxx"];

export function newEnvironment(URIlist: Uri[]) {
  // This is called from the right click in the file explorer tree
  // Based on the package.json, we know tha that at least one
  // file in the list will be a C/C++ file but we need to filter
  // for the multi-select case.
  //

  let fileList: string[] = [];
  for (let index = 0; index < URIlist.length; index++) {
    const filePath = URIlist[index].fsPath;
    const fileExtension = filePath.split(".").pop();
    if (fileExtension && extensionsOfInterest.includes(fileExtension)) {
      fileList.push(filePath);
    }
  }
  if (fileList.length > 0) {
    let unitTestLocation = getUnitTestLocationForPath(
      path.dirname(fileList[0])
    );
    configureWorkspaceAndBuildEnviro(fileList, unitTestLocation);
  } else {
    vscode.window.showWarningMessage(
      "Create environment may only be run for source files [" +
        extensionsOfInterest.join(", ") +
        "]"
    );
  }
}

function valueOrDefault(name: string): string {
  return name.length > 0 ? ":" + name : "";
}

function defaultTestName(name: string): string {
  return name.length > 0 ? ":test-" + name : "";
}

function createScriptTemplate(testNode: testNodeType): string {
  // this will create a test script template and return the path to the file

  let scriptTemplateLines: string[] = [];

  scriptTemplateLines.push("-- Test Case Script");
  scriptTemplateLines.push("--");
  scriptTemplateLines.push("-- Environment: " + testNode.enviroName);
  if (testNode.unitName != "not-used")
    scriptTemplateLines.push("-- Unit:        " + testNode.unitName);
  scriptTemplateLines.push("-- Function:    " + testNode.functionName);
  scriptTemplateLines.push("--");
  scriptTemplateLines.push("--");
  scriptTemplateLines.push(
    "-- Type 'vcast-test to get the framework of a new test inserted"
  );
  scriptTemplateLines.push(
    "-- Then use the LSE features of the extension to fill-in values"
  );
  scriptTemplateLines.push("--");
  scriptTemplateLines.push(
    "-- Right click anywhere in the editor pane and choose"
  );
  scriptTemplateLines.push(
    "-- 'Load Test Script into Environment' when done editing"
  );
  scriptTemplateLines.push("--");
  scriptTemplateLines.push("--");
  scriptTemplateLines.push("");
  scriptTemplateLines.push("");
  scriptTemplateLines.push("TEST.SCRIPT_FEATURE:MIXED_CASE_NAMES");
  scriptTemplateLines.push("TEST.SCRIPT_FEATURE:MULTIPLE_UUT_SUPPORT");
  scriptTemplateLines.push("");
  scriptTemplateLines.push("");

  if (testNode.unitName != "not-used")
    scriptTemplateLines.push("TEST.UNIT" + valueOrDefault(testNode.unitName));

  scriptTemplateLines.push(
    "TEST.SUBPROGRAM" + valueOrDefault(testNode.functionName)
  );
  scriptTemplateLines.push("TEST.REPLACE");
  scriptTemplateLines.push(
    "TEST.NAME" + defaultTestName(testNode.functionName)
  );
  scriptTemplateLines.push("TEST.NOTES:");
  scriptTemplateLines.push("");
  scriptTemplateLines.push("TEST.END_NOTES:");
  if (testNode.functionName == "<<COMPOUND>>") {
    scriptTemplateLines.push("TEST.SLOT");
  } else {
    scriptTemplateLines.push("TEST.VALUE");
  }
  scriptTemplateLines.push("TEST.END");

  return scriptTemplateLines.join("\n");
}



export async function newTestScript(testNode: testNodeType) {
  // This can be called for any subprogram node other than an environment node
  //    'Environments-GCC/TUTORIAL-C++-4|manager.Manager::PlaceOrder'
  //    'Environments-GCC/TUTORIAL-C++-4|manager.Manager::PlaceOrder.Manager::PlaceOrder.001'

  const contents = createScriptTemplate(testNode);
  const scriptPath = path.join(
    path.dirname(testNode.enviroPath),
    "vcast-template.tst"
  );

  // create the template file
  fs.writeFileSync(scriptPath, contents);

  var scriptUri: vscode.Uri = vscode.Uri.file(scriptPath);
  vscode.workspace.openTextDocument(scriptUri).then(
    (doc: vscode.TextDocument) => {
      vscode.window.showTextDocument(doc, 1, false);
    },
    (error: any) => {
      vectorMessage(error.message, errorLevel.error);
    }
  );
}

export function getClicastArgsFromTestNode(testNode: testNodeType) {
  // this function will create the enviro, unit, subprogram,
  // and test arg string for clicast

  let returnString = "";
  returnString = `-e${testNode.enviroName}`;
  if (testNode.unitName.length > 0 && testNode.unitName != "not-used")
    returnString += ` -u${testNode.unitName}`;

  // we need the quotes on the names to handle <<COMPOUND>> and <<INIT>>
  if (testNode.functionName.length > 0)
    returnString += ` -s"${testNode.functionName}"`;
  if (testNode.testName.length > 0) returnString += ` -t"${testNode.testName.replace (compoundOnlyString,"")}"`;

  return returnString;
}

export async function deleteTests(nodeList: any[]) {
  for (let node of nodeList) {
    const nodeID = node.id;
    const testNode: testNodeType = getTestNode(nodeID);

    if (testNode.testName.length > 0) {
      const commandToRun = `${clicastCommandToUse} ${getClicastArgsFromTestNode(
        testNode
      )} test delete`;
      let commandStatus: commandStatusType = executeCommand(
        commandToRun,
        path.dirname(testNode.enviroPath)
      );
      if (commandStatus.errorCode == 0) {
        updateDataForEnvironment(getEnviroPathFromID(nodeID));
      } else {
        vectorMessage("Test delete failed ...");
        vcastMessage(commandStatus.stdout);
        openMessagePane();
      }
    }
  }
}
