import { EOL } from "os";
import * as vscode from "vscode";
import { Uri } from "vscode";

import { cleanVectorcastOutput } from "../src-common/commonUtilities";
import { pythonErrorCodes } from "../src-common/vcastServerTypes";
import {
  configFilename,
  getUnitTestLocationForPath,
  initializeConfigurationFile,
} from "./configuration";

import { updateFunctionDataForFile } from "./editorDecorator";

import { fileDecorator } from "./fileDecorator";

import {
  openMessagePane,
  indentString,
  vectorMessage,
  errorLevel,
} from "./messagePane";

import { getEnviroPathFromID, getTestNode, testNodeType } from "./testData";

import {
  enviroListAsMapType,
  globalProjectDataCache,
  refreshAllExtensionData,
  updateTestPane,
} from "./testPane";

import {
  forceLowerCaseDriveLetter,
  normalizePath,
  openFileWithLineSelected,
  showSettings,
} from "./utilities";

import {
  addCodedTestToEnvironment,
  buildEnvironmentFromScript,
  codedTestAction,
  executeTest,
  getMCDCReport,
  getTestExecutionReport,
  setCodedTestOption,
} from "./vcastAdapter";

import {
  importEnvToTestsuite,
  updateProjectData,
  addEnvToTestsuite,
  createNewTestsuiteInProject,
} from "./manage/manageSrc/manageCommands";

import {
  commandStatusType,
  executeCommandSync,
  executeVPythonScript,
} from "./vcastCommandRunner";

import { checksumCommandToUse } from "./vcastInstallation";

import {
  closeAnyOpenErrorFiles,
  openTestFileAndErrors,
  testStatus,
} from "./vcastUtilities";
import {
  closeConnection,
  globalEnviroDataServerActive,
} from "../src-common/vcastServer";

const fs = require("fs");
const path = require("path");

export const vcastEnviroFile = "UNITDATA.VCD";

// Define the interface for project environment parameters.
export interface ProjectEnvParameters {
  path: string;
  sourceFiles: string[];
  testsuiteArgs: string[];
}

// Creating a cache for the checksums so we don't constantly re-run the command
interface ChecksumCacheType {
  checksum: number;
  modificationTime: string;
}
let checksumCache = new Map<string, ChecksumCacheType>();

// Compute the checksum for a source file
function getChecksum(filePath: string) {
  // I am assuming that doing the fstat is faster than
  // running the checksum command, but I did not check

  // Return the cache value if the file has not changed
  let cacheValue = checksumCache.get(filePath);
  if (cacheValue) {
    const currentMtime = fs.statSync(filePath).mtime.toISOString();
    if (currentMtime == cacheValue.modificationTime) {
      return cacheValue.checksum;
    }
  }

  // if we did not return the cached value, compute the cksum
  let returnValue = 0;
  const checksumCommand = checksumCommandToUse;
  if (checksumCommand) {
    let commandOutputString: string;
    if (checksumCommand.endsWith(".py"))
      commandOutputString = executeVPythonScript(
        `${checksumCommand} ${filePath}`,
        path.dirname(filePath)
      ).stdout;
    else
      commandOutputString = executeCommandSync(
        `${checksumCommand} ${filePath}`,
        process.cwd()
      ).stdout;

    // convert the to a number and return
    // this will throw if something is wrong with the result
    try {
      // see detailed comment with the function definition
      commandOutputString = cleanVectorcastOutput(commandOutputString);
      returnValue = Number(commandOutputString);
      // only save into the cache if we get a valid checksum
      const cacheValue: ChecksumCacheType = {
        checksum: returnValue,
        modificationTime: fs.statSync(filePath).mtime.toISOString(),
      };
      checksumCache.set(filePath, cacheValue);
    } catch {
      returnValue = 0;
    }
  }
  return returnValue;
}

// we save the some key data, indexed into by test.id
// at the time that we build the test tree
export interface testDataType {
  status: string;
  passfail: string;
  time: string;
  resultFilePath: string;
  stdout: string;
  notes: string;
  compoundOnly: boolean;
  testFile: string;
  testStartLine: number;
}

// This allows us to get direct access to the test nodes via the ID
export interface testStatusArrayType {
  [id: string]: testDataType;
}

export var globalTestStatusArray = <testStatusArrayType>{};

export function getGlobalCoverageData() {
  return globalCoverageData;
}

export function addTestDataToStatusArray(
  testID: string,
  testData: testDataType
): void {
  globalTestStatusArray[testID] = testData;
}

export function addResultFileToStatusArray(
  testID: string,
  resultFilePath: string
) {
  // the testID should always me in the map but just to make sure ...
  if (testID in globalTestStatusArray) {
    globalTestStatusArray[testID].resultFilePath = resultFilePath;
  }
}

export function clearTestDataFromStatusArray(): void {
  globalTestStatusArray = {};
}

// List of source file from all local environments
interface coverageDataType {
  crc32Checksum: number;
  covered: number[];
  uncovered: number[];
  partiallyCovered: number[];
}

interface fileCoverageType {
  hasCoverage: boolean;
  enviroList: Map<string, coverageDataType>; //key is enviroPath
}

// key is filePath
let globalCoverageData = new Map<string, fileCoverageType>();

/////////////////////////////////////////////////////////////////////
export function resetCoverageData() {
  // this should be called whenever we want to reload all coverage data
  globalCoverageData.clear();
}

interface coverageSummaryType {
  hasCoverageData: boolean;
  statusString: string;
  covered: number[];
  uncovered: number[];
  partiallyCovered: number[];
}

//////////////////////////////////////////////////////////////////////
export function getCoverageDataForFile(filePath: string): coverageSummaryType {
  // this function will combine the coverage for all instances of
  // filePath that match the provided checksum into a single coverageDataType

  // .statusString will be "no-coverage-data" if there are no environments
  // with coverage for this file

  // .statusString will be null if there is at least one environment
  // that that matches the checksum for this file

  // .statusString will be "out-of-date" if NO enviro checksums match this file

  let returnData: coverageSummaryType = {
    hasCoverageData: false,
    statusString: "",
    covered: [],
    uncovered: [],
    partiallyCovered: [],
  };

  const dataForThisFile = globalCoverageData.get(filePath);
  // if we have data for this file it means that it is part of
  // an environment but not necessarily that it has coverage data
  if (dataForThisFile) {
    // if there is coverage data, create the x/y status bar message
    if (dataForThisFile.hasCoverage && dataForThisFile.enviroList.size > 0) {
      const checksum: number = getChecksum(filePath);
      let coveredList: number[] = [];
      let uncoveredList: number[] = [];
      let partiallyCoveredList: number[] = [];
      for (const enviroData of dataForThisFile.enviroList.values()) {
        if (enviroData.crc32Checksum == checksum) {
          coveredList = coveredList.concat(enviroData.covered);
          uncoveredList = uncoveredList.concat(enviroData.uncovered);
          partiallyCoveredList = partiallyCoveredList.concat(
            enviroData.partiallyCovered
          );
        }
      }

      if (coveredList.length == 0 && uncoveredList.length == 0) {
        // This status is for files that have changed since
        // they were last instrumented
        returnData.statusString = "Coverage Out of Date";
      } else {
        returnData.hasCoverageData = true;
        // remove duplicates
        returnData.covered = [...new Set(coveredList)];
        returnData.uncovered = [...new Set(uncoveredList)];
        returnData.partiallyCovered = [...new Set(partiallyCoveredList)];
      }
    } else {
      // This status is for files that are part of
      // and environment but not instrumented
      returnData.statusString = "No Coverage Data";
    }
  }

  return returnData;
}

export function checksumMatchesEnvironment(
  filePath: string,
  enviroPath: string
): boolean {
  // this will check if the current checksum of filePath matches the
  // checksum of that file from the provided environment.

  let returnValue: boolean = false;
  const checksum = getChecksum(filePath);
  const dataForThisFile = globalCoverageData.get(filePath);

  if (dataForThisFile) {
    const enviroData = dataForThisFile.enviroList.get(enviroPath);
    if (enviroData) {
      if (enviroData.crc32Checksum == checksum) {
        returnValue = true;
      }
    }
  }
  return returnValue;
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

export function updateGlobalDataForFile(enviroPath: string, fileList: any[]) {
  let filePathList: string[] = [];

  for (let fileIndex = 0; fileIndex < fileList.length; fileIndex++) {
    let filePath = forceLowerCaseDriveLetter(fileList[fileIndex].path);
    filePathList.push(filePath);

    let coveredList: number[] = [];
    if (fileList[fileIndex].covered.length > 0)
      coveredList = fileList[fileIndex].covered.split(",").map(Number);

    let uncoveredList: number[] = [];
    if (fileList[fileIndex].uncovered.length > 0)
      uncoveredList = fileList[fileIndex].uncovered.split(",").map(Number);

    let partiallyCoveredList: number[] = [];
    if (fileList[fileIndex].partiallyCovered.length > 0)
      partiallyCoveredList = fileList[fileIndex].partiallyCovered
        .split(",")
        .map(Number);

    const checksum = fileList[fileIndex].cmcChecksum;
    let coverageData: coverageDataType = {
      crc32Checksum: checksum,
      covered: coveredList,
      uncovered: uncoveredList,
      partiallyCovered: partiallyCoveredList,
    };

    let fileData: fileCoverageType | undefined =
      globalCoverageData.get(filePath);

    // if there is not existing data for this file
    if (!fileData) {
      fileData = { hasCoverage: false, enviroList: new Map() };
      globalCoverageData.set(filePath, fileData);
    }

    fileData.hasCoverage =
      fileData.hasCoverage ||
      coverageData.covered.length > 0 ||
      coverageData.uncovered.length > 0 ||
      coverageData.partiallyCovered.length > 0;
    fileData.enviroList.set(enviroPath, coverageData);

    // if we are displaying the file decoration in the explorer view
    if (fileDecorator) {
      if (fileData.hasCoverage)
        fileDecorator.addCoverageDecorationToFile(filePath);
      else fileDecorator.removeCoverageDecorationFromFile(filePath);
    }

    // update the testable function icons for this file
    updateFunctionDataForFile(
      enviroPath,
      filePath,
      fileList[fileIndex].functionList
    );
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

export async function getResultFileForTest(testID: string) {
  // This function will return the path to the result file if it is already saved
  // in the globalTestStatus array, otherwise it will ask Python to generate the report
  let resultFile: string = globalTestStatusArray[testID].resultFilePath;

  // Check if the file already exists
  if (!fs.existsSync(resultFile)) {
    // Generate the environment path and request the test report from Python
    const enviroPath = getEnviroPathFromID(testID);
    const commandStatus = await getTestExecutionReport(enviroPath, testID);

    // Check if report generation was successful
    if (commandStatus.errorCode === 0) {
      const firstLineOfOutput: string = commandStatus.stdout
        .split("\n", 1)[0]
        .trim();

      // Handle the case where the output contains "REPORT"
      if (firstLineOfOutput.includes("REPORT:")) {
        // This is the normal case --> delete the REPORT to only have the file name
        resultFile = firstLineOfOutput.replace("REPORT:", "");
        // Check if the file exists
        if (!fs.existsSync(resultFile)) {
          const reportNotExistentErrorMessage = `The Report: ${resultFile} does not exist.`;
          vscode.window.showWarningMessage(`${reportNotExistentErrorMessage}`);
          vectorMessage(`${reportNotExistentErrorMessage}`);
        }
      }

      // If the first line of output contains "Error" --> Test result generation failed
      else if (firstLineOfOutput.includes("Error:")) {
        const errorDetails = firstLineOfOutput.split("Error:")[1].trim();
        const reportGenerationErrorMessage = `Execution report was not successfully generated. Error details: \n${errorDetails}`;
        vscode.window.showWarningMessage(`${reportGenerationErrorMessage}`);
        vectorMessage(`${reportGenerationErrorMessage}`);
      }

      // Handle other unexpected cases (After successfull test generation, but without the "REPORT:" string)
      else {
        const unexpectedErrorMessage = `Unexpected Error: \n${commandStatus.stdout}`;
        vscode.window.showWarningMessage(`${unexpectedErrorMessage}`);
        vectorMessage(`${unexpectedErrorMessage}`);
      }
    }
    // Handle command failure
    else {
      vectorMessage(
        `Retrieving test report was not successful. Command Status: ${commandStatus.errorCode}`
      );
    }

    // Update the global test status with the result file path
    globalTestStatusArray[testID].resultFilePath = resultFile;
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
const nullExecutionStatus: executeOutputType = {
  status: "",
  resultsFilePath: "",
  time: "",
  passfail: "",
  stdOut: "",
};

function processExecutionOutput(commandOutput: string): executeOutputType {
  let returnData: executeOutputType = {
    status: "failed",
    stdOut: "",
    resultsFilePath: "",
    time: "",
    passfail: "",
  };
  const outputLineList: string[] = commandOutput.split("\n");

  for (let line of outputLineList) {
    console.log(`LINE IS: ${line}`);
    if (line.startsWith("STATUS:"))
      returnData.status = line.replace("STATUS:", "").trim();
    else if (line.startsWith("REPORT:"))
      returnData.resultsFilePath = line.replace("REPORT:", "").trim();
    else if (line.startsWith("PASSFAIL:"))
      returnData.passfail = line.replace("PASSFAIL:", "").trim();
    else if (line.startsWith("TIME:"))
      returnData.time = line.replace("TIME:", "").trim();
    else returnData.stdOut += line + EOL;
  }

  return returnData;
}

function testExecutionFailed(commandStatus: commandStatusType): boolean {
  // There are lots of ways that a test run can end badly,
  // this function will check for these cases to simplify
  // the process in runVCTest

  let commandOutputText: string = commandStatus.stdout;
  let returnValue: boolean = false;

  if (commandOutputText.startsWith("FATAL")) {
    // comes from clicast, something bad happened
    returnValue = true;
  } else if (commandOutputText.includes("Resolve Errors")) {
    // handles things like compile errors
    returnValue = true;
  } else if (commandStatus.errorCode == 1) {
    // usage error with interface
    returnValue = true;
  }

  return returnValue;
}

export async function runVCTest(enviroPath: string, nodeID: string) {
  // what gets returned
  let returnStatus: testStatus = testStatus.didNotRun;

  // execute, or execute and generate report
  const commandStatus: commandStatusType = await executeTest(
    enviroPath,
    nodeID
  );

  let commandOutputText: string = commandStatus.stdout;
  let executionDetails: executeOutputType = nullExecutionStatus;

  if (commandStatus.errorCode == pythonErrorCodes.codedTestCompileError) {
    const testNode = getTestNode(nodeID);
    returnStatus = openTestFileAndErrors(testNode);
  } else if (testExecutionFailed(commandStatus)) {
    // lots of different things can go wrong
    vectorMessage("Could not complete test execution ...");
    if (commandOutputText.startsWith("FATAL")) {
      commandOutputText = commandOutputText.replace("FATAL", "");
    }
    vectorMessage(commandOutputText, errorLevel.info, indentString);
    openMessagePane();
    returnStatus = testStatus.didNotRun;
  } else if (commandStatus.errorCode != 0 && commandStatus.errorCode != 28) {
    // 0 means test pass, 28 means test failed, everything else is an error
    // however the printing of the error message is done where the command is run
    // so we don't have to do it here
    returnStatus = testStatus.didNotRun;
  } else {
    // successful execution
    executionDetails = processExecutionOutput(commandOutputText);

    let updatedStatusItem = globalTestStatusArray[nodeID];

    if (updatedStatusItem) {
      updatedStatusItem.status = executionDetails.status;
      updatedStatusItem.resultFilePath = executionDetails.resultsFilePath;
      globalTestStatusArray[nodeID] = updatedStatusItem;

      if (updatedStatusItem.status == "passed") {
        returnStatus = testStatus.passed;
      } else {
        returnStatus = testStatus.failed;
      }
    } else {
      returnStatus = testStatus.didNotRun;
    }
  }
  return { status: returnStatus, details: executionDetails };
}

function addSearchPathsFromConfigurationFile(
  cwd: string,
  searchList: string[]
) {
  const pathToConfigurationFile = path.join(cwd, configFilename);

  // should always exist, but just to make sure
  if (fs.existsSync(pathToConfigurationFile)) {
    // open the file, and loop looking for "TESTABLE_SOURCE_DIR" lines,
    const fileContents = fs.readFileSync(pathToConfigurationFile, "utf8");
    const lineList = fileContents.split(/\r?\n/g);
    for (let lineIndex = 0; lineIndex < lineList.length; lineIndex++) {
      const line = lineList[lineIndex];
      if (line.startsWith("TESTABLE_SOURCE_DIR")) {
        const pieces = line.split("TESTABLE_SOURCE_DIR:", 2);
        if (pieces.length > 1) {
          const searchPath = pieces[1].trim();
          if (!searchList.includes(searchPath)) {
            searchList.push(searchPath);
          }
        }
      }
    }
  }
}

function createVcastEnvironmentScript(
  unitTestLocation: string,
  enviroName: string,
  fileList: string[]
) {
  // This will take a list of files and create the enviroName.env
  // in the location pointed to by unitTestLocation

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

  addSearchPathsFromConfigurationFile(unitTestLocation, searchList);
  const envFilePath = path.join(unitTestLocation, enviroName + ".env");

  // read the settings that affect enviro build
  let settings = vscode.workspace.getConfiguration("vectorcastTestExplorer");

  fs.writeFileSync(envFilePath, `ENVIRO.NEW\n`, { flag: "w" });
  fs.writeFileSync(envFilePath, `ENVIRO.NAME: ${enviroName}\n`, { flag: "a+" });

  const coverageKind = settings.get("build.coverageKind", "None");
  if (coverageKind != "None") {
    fs.writeFileSync(envFilePath, `ENVIRO.COVERAGE_TYPE: ${coverageKind}\n`, {
      flag: "a+",
    });
  }

  fs.writeFileSync(envFilePath, "ENVIRO.WHITE_BOX: YES\n", { flag: "a+" });
  fs.writeFileSync(envFilePath, "ENVIRO.STUB: ALL_BY_PROTOTYPE\n", {
    flag: "a+",
  });

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
}

function buildEnvironmentVCAST(
  fileList: string[],
  unitTestLocation: string,
  enviroName: string,
  shouldBuildEnviro: boolean = true
) {
  // enviroName is the name of the enviro without the .env

  // use the first filename in the list as the environment name

  vectorMessage(new Array(101).join("-"));
  vectorMessage(
    "Creating environment '" +
      enviroName +
      " for " +
      fileList.length +
      " file(s) ..."
  );

  // It is important that this call be done before the creation of the .env
  // Check that we have a valid configuration file, and create one if we don't
  // This function will return True if there is a CFG when it is done.
  if (!shouldBuildEnviro) {
    setCodedTestOption(unitTestLocation);
    createVcastEnvironmentScript(unitTestLocation, enviroName, fileList);
  } else if (initializeConfigurationFile(unitTestLocation)) {
    setCodedTestOption(unitTestLocation);

    createVcastEnvironmentScript(unitTestLocation, enviroName, fileList);

    buildEnvironmentFromScript(unitTestLocation, enviroName);
  }
}

/**
 * Processes the import of an environment to a project and the creation of the first testsuite
 * @param projectPath Path to Project file
 * @param testSuite Testsuite string containing Compiler/TestSuite/Group
 * @param envFilePath Path to env file
 */
async function processFirstTestSuite(
  projectPath: string,
  testSuite: string,
  envFilePath: string
) {
  // Need to extract the group from the testsuite string
  const parts = testSuite.split("/");
  const baseDisplayName = parts.slice(0, 2).join("/");
  await importEnvToTestsuite(projectPath, baseDisplayName, envFilePath);
}

/**
 * Processes the creation of additional testsuites in a project and the addition of the environment to the testsuite
 * @param projectPath Path to Project file
 * @param testSuite Testsuite string containing Compiler/TestSuite/Group
 * @param envName Name of the environment (The Env needs to be already imported to use this function).
 * @param projectEnvData Data of the project environments
 */
async function processAdditionalTestSuite(
  projectPath: string,
  testSuite: string,
  envName: string,
  projectEnvData: enviroListAsMapType
) {
  // Need to extract the group from the testsuite string
  const parts = testSuite.split("/");
  const baseDisplayName = parts.slice(0, 2).join("/");

  // Check if the testsuite already exists in the project data
  let existsInProject = false;
  if (projectEnvData) {
    for (const envData of projectEnvData.values()) {
      const existingBaseName = envData.displayName
        .split("/")
        .slice(0, 2)
        .join("/");
      if (existingBaseName === baseDisplayName) {
        existsInProject = true;
        break;
      }
    }
  }
  if (!existsInProject) {
    await createNewTestsuiteInProject(projectPath, baseDisplayName);
  }
  await addEnvToTestsuite(projectPath, baseDisplayName, envName);
}

async function configureWorkspaceAndBuildEnviro(
  fileList: string[],
  envLocation: string,
  projectEnvParameters?: ProjectEnvParameters
) {
  // This function will check if unit test directory exists
  // and if not ask the user if we should auto-create it or not

  // If we have project params, we want to create an env within a project
  if (projectEnvParameters) {
    // Create the environment using the provided file list
    commonNewEnvironmentStuff(fileList, envLocation, false);

    const envName = createEnvNameFromFiles(fileList);
    const envFilePath = path.join(envLocation, `${envName}.env`);
    const testSuites = projectEnvParameters.testsuiteArgs;
    const projectPath = projectEnvParameters.path;

    // First we need to import the Env and therefore process the first testsuite separately
    await processFirstTestSuite(projectPath, testSuites[0], envFilePath);

    // Process each additional testsuite
    const projectEnvData = globalProjectDataCache.get(projectPath);
    if (projectEnvData) {
      for (let i = 1; i < testSuites.length; i++) {
        await processAdditionalTestSuite(
          projectPath,
          testSuites[i],
          envName,
          projectEnvData
        );
      }
    }

    // Delete the temporary folder and its contents
    try {
      if (fs.existsSync(envLocation)) {
        fs.rmdirSync(envLocation, { recursive: true });
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        `Error deleting temporary folder: ${error}`
      );
    }
  } else if (fs.existsSync(envLocation)) {
    commonNewEnvironmentStuff(fileList, envLocation);
  } else {
    const message =
      "Unit test location: '" +
      envLocation +
      " does not exist.\n" +
      "Do you want to create and initialize this directory?";
    vscode.window
      .showInformationMessage(message, "Yes", "No")
      .then((answer) => {
        if (answer === "Yes") {
          try {
            fs.mkdirSync(envLocation, { recursive: true });
            commonNewEnvironmentStuff(fileList, envLocation);
          } catch (error: any) {
            vscode.window.showErrorMessage(
              `Error creating directory: ${envLocation} [${error.message}].  Update the 'Unit Test Location' option to a valid value`
            );
            vectorMessage("Error creating directory: " + envLocation);
            showSettings();
          }
        } else {
          vscode.window.showWarningMessage(
            `Please create the unit test directory: '${envLocation}', or update the 'Unit Test Location' option`
          );
          showSettings();
        }
      });
  }
}

export function createEnvNameFromFiles(fileList: string[]) {
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

    return enviroName;
  }
}

function commonNewEnvironmentStuff(
  fileList: string[],
  envLocation: string,
  shouldBuildEnviro: boolean = true
) {
  if (fileList.length > 0) {
    let enviroName = createEnvNameFromFiles(fileList);
    let enviroPath = path.join(envLocation, enviroName);

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
            enviroPath = path.join(envLocation, response);
            if (fs.existsSync(enviroPath))
              vscode.window.showErrorMessage(
                `Environment name: ${enviroName}, already in use, aborting`
              );
            else
              buildEnvironmentVCAST(
                fileList,
                envLocation,
                response.toUpperCase(),
                shouldBuildEnviro
              );
          }
        });
    } else {
      buildEnvironmentVCAST(
        fileList,
        envLocation,
        enviroName.toUpperCase(),
        shouldBuildEnviro
      );
    }
  } else vectorMessage("No C/C++ source files found in selection ...");
}

// Improvement needed: get the language extensions automatically, don't hard-code
const extensionsOfInterest = ["c", "cpp", "cc", "cxx"];

export async function newEnvironment(
  URIlist: Uri[],
  projectEnvParameters?: ProjectEnvParameters
) {
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
    if (projectEnvParameters) {
      // Get the workspace root folder.
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage("No workspace folder is open.");
        return;
      }
      const workspaceRoot = workspaceFolders[0].uri.fsPath;

      //Create a new folder "tempEnv" under the workspace root.
      const tempEnvPath = path.join(workspaceRoot, "tempEnv");
      try {
        if (!fs.existsSync(tempEnvPath)) {
          fs.mkdirSync(tempEnvPath);
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to create tempEnv folder: ${error}`
        );
        return;
      }
      configureWorkspaceAndBuildEnviro(
        fileList,
        tempEnvPath,
        projectEnvParameters
      );
    } else {
      let unitTestLocation = getUnitTestLocationForPath(
        path.dirname(fileList[0])
      );
      configureWorkspaceAndBuildEnviro(fileList, unitTestLocation);
    }
  } else {
    vscode.window.showWarningMessage(
      "Create environment may only be run for source files [" +
        extensionsOfInterest.join(", ") +
        "]"
    );
  }
  await refreshAllExtensionData();
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
  // It's important to use TEST.NEW here, see Issue# 20
  scriptTemplateLines.push("TEST.NEW");
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

  const contents = createScriptTemplate(testNode);
  const scriptPath = path.join(
    path.dirname(testNode.enviroPath),
    "vcast-template.tst"
  );

  // create the template file
  fs.writeFileSync(scriptPath, contents);

  let scriptUri: vscode.Uri = vscode.Uri.file(scriptPath);
  vscode.workspace.openTextDocument(scriptUri).then(
    (doc: vscode.TextDocument) => {
      vscode.window.showTextDocument(doc, 1, false);
    },
    (error: any) => {
      vectorMessage(error.message, errorLevel.error);
    }
  );
}

async function commonCodedTestProcessing(
  userFilePath: string,
  testID: string,
  action: codedTestAction
) {
  let testNode: testNodeType = getTestNode(testID);
  const enviroPath = getEnviroPathFromID(testID);
  const enviroName = path.basename(enviroPath);

  await vectorMessage(
    `Adding coded test file: ${userFilePath} for environment: ${enviroPath}`
  );

  // call clicast to create new coded test
  const commandStatus: commandStatusType = await addCodedTestToEnvironment(
    enviroPath,
    testNode,
    action,
    normalizePath(userFilePath)
  );

  await updateTestPane(enviroPath);

  if (commandStatus.errorCode == 0 && enviroName) {
    // update project data after the script is loaded
    await updateProjectData(enviroPath);
    vscode.window.showInformationMessage(`Coded Tests added successfully`);
  } else {
    openTestFileAndErrors(testNode);
  }
  if (globalEnviroDataServerActive) await closeConnection(enviroPath);
}

export async function addExistingCodedTestFile(testID: string) {
  // This can be called for any "main" Coded Test node that
  // does not have children.  When we are loading the test data,
  // we set the testFile field for the "Coded Test" node if
  // there are children, so check that to determine if we can add ...

  // check if there are any vcast error files open, and close them
  await closeAnyOpenErrorFiles();

  let testNode: testNodeType = getTestNode(testID);
  if (testNode.testFile.length == 0) {
    const option: vscode.OpenDialogOptions = {
      title: "Select Coded Test File",
      filters: { "Coded Test Files": ["cpp", "cc", "cxx"] },
    };
    vscode.window.showOpenDialog(option).then((fileUri) => {
      if (fileUri) {
        commonCodedTestProcessing(
          fileUri[0].fsPath,
          testID,
          codedTestAction.add
        );
      }
    });
  }
}

export async function generateNewCodedTestFile(testID: string) {
  // This can be called for any "main" Coded Test node that
  // does not have children.  When we are loading the test data,
  // we set the testFile field for the "Coded Test" node if
  // there are children, so check that to determine if we can add ...

  const testNode: testNodeType = getTestNode(testID);

  if (testNode.testFile.length == 0) {
    const option: vscode.SaveDialogOptions = {
      title: "Save Code Test File",
      filters: { "Coded Test Files": ["cpp", "cc", "cxx"] },
    };
    vscode.window.showSaveDialog(option).then((fileUri) => {
      if (fileUri) {
        commonCodedTestProcessing(fileUri.fsPath, testID, codedTestAction.new);
      }
    });
  }
}

export async function openCodedTest(testNode: testNodeType) {
  // This can be called for any Coded Test or its children
  // but the test file will always be the same

  // just to be sure ...
  if (fs.existsSync(testNode.testFile)) {
    openFileWithLineSelected(testNode.testFile, testNode.testStartLine - 1);
  }
}

/**
 * Generates and retrieves the MCDC html result file.
 *
 * @param {string} enviroPath - The path to the environment or directory.
 * @param {string} unit - The unit which includes the line.
 * @param {number} lineNumber - The line number for which the report is generated.
 * @returns {Promise<string>} A promise that resolves to the path of the result file if successful, or an empty string on failure.
 */
export async function getMCDCResultFile(
  enviroPath: string,
  unit: string,
  lineNumber: number
) {
  // Generate the environment path and request the test report from Python
  const commandStatus = await getMCDCReport(enviroPath, unit, lineNumber);
  let resultFile: string = "";

  // Check if report generation was successful
  if (commandStatus.errorCode === 0) {
    const firstLineOfOutput: string = commandStatus.stdout
      .split("\n", 1)[0]
      .trim();

    resultFile = firstLineOfOutput.split("REPORT:")[1].trim();
    // Handle the case where the output contains "REPORT"
    if (firstLineOfOutput.includes("REPORT:")) {
      // Verify if the generated report file actually exists
      if (!fs.existsSync(resultFile)) {
        const reportNotExistentErrorMessage = `The Report: ${resultFile} does not exist.`;
        vscode.window.showWarningMessage(`${reportNotExistentErrorMessage}`);
        vectorMessage(`${reportNotExistentErrorMessage}`);
      }
    }

    // If the first line of output contains "Error" --> Test result generation failed
    else if (firstLineOfOutput.includes("Error:")) {
      const errorDetails = firstLineOfOutput.split("Error:")[1].trim();
      const reportGenerationErrorMessage = `Execution report was not successfully generated. Error details: \n${errorDetails}`;
      vscode.window.showWarningMessage(`${reportGenerationErrorMessage}`);
      vectorMessage(`${reportGenerationErrorMessage}`);
    }

    // Handle other unexpected cases (After successfull test generation, but without the "REPORT:" string)
    else {
      const unexpectedErrorMessage = `Unexpected Error: \n${commandStatus.stdout}`;
      vscode.window.showWarningMessage(`${unexpectedErrorMessage}`);
      vectorMessage(`${unexpectedErrorMessage}`);
    }
  } else {
    const commandErrorString = `Error generating MCDC report. Error Code: ${commandStatus.errorCode}`;
    vscode.window.showWarningMessage(`${commandErrorString}`);
    vectorMessage(`${commandErrorString}`);
  }

  return resultFile;
}
