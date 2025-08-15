import * as vscode from "vscode";
import * as fs from "fs";

import {
  buildEnvironmentCallback,
  deleteEnvironmentCallback,
} from "../../callbacks";

import {
  addEnvToProjectCallback,
  buildEnvironmentIncrementalCallback,
  cleanEnvironmentCallback,
} from "./manageCallbacks";

import {
  createNewCFGFromCompiler,
  findTestItemInController,
} from "./manageUtils";

import { openMessagePane, vectorMessage } from "../../messagePane";

import { getEnviroNodeData } from "../../testData";

import { executeWithRealTimeEchoWithProgress } from "../../vcastCommandRunner";

import { manageCommandToUse } from "../../vcastInstallation";

import {
  checkIfEnvironmentIsBuildMultipleTimes,
  closeAnyOpenErrorFiles,
  deleteOtherBuildFolders,
  envIsEmbeddedInProject,
} from "../../vcastUtilities";

import {
  closeConnection,
  globalEnviroDataServerActive,
} from "../../../src-common/vcastServer";

import {
  globalProjectDataCache,
  refreshAllExtensionData,
  runTests,
  updateProjectStructure,
} from "../../testPane";
import { normalizePath } from "../../utilities";
import { viewResultsReportVC } from "../../reporting";

const path = require("path");

// ------------------------------------------------------------------------------------
// Direct manage Calls
// ------------------------------------------------------------------------------------

// Build Project Environment - no server logic needed ---------------------------------
export async function buildProjectEnvironment(
  projectFilePath: string,
  levelString: string,
  enviroPath: string
) {
  // Used to build a manage project environment that has is not currently built
  // need to issue a vcast manage command to build the enviro, similar to this
  // manage -p SecondaryProject --level=GNU_Native_Automatic_C++17/Suite3/FOO --build

  const projectName = path.basename(projectFilePath);
  const projectLocation = path.dirname(projectFilePath);
  const manageArgs = [`-p${projectName}`, `--level=${levelString}`, "--build"];

  const progressMessage = `Building environment: ${levelString} ...`;

  // This is long running commands so we open the message pane to give the user a sense of what is going on.
  openMessagePane();
  await executeWithRealTimeEchoWithProgress(
    manageCommandToUse,
    manageArgs,
    projectLocation,
    progressMessage,
    buildEnvironmentCallback,
    enviroPath
  );
}

/**
 * Creates a new compiler in a selected project
 * @param projectPath Path to project
 * @param compiler Selected Compiler
 * @returns
 */
export async function createNewCompilerInProject(
  projectPath: string,
  compiler: string
) {
  const projectName = path.basename(projectPath);
  const projectLocation = projectPath.split(".vcm")[0];
  // We save all new created compilers in a compilers dir
  // Check if it already exists, otherwise create it
  if (!fs.existsSync(projectLocation)) {
    vectorMessage(`${projectLocation} does not exist.`);
    return;
  }
  const projectCompilerPath = path.join(projectLocation, "compilers");
  if (!fs.existsSync(projectCompilerPath)) {
    await vscode.workspace.fs.createDirectory(
      vscode.Uri.file(projectCompilerPath)
    );
  }

  const compilerPath = await createNewCFGFromCompiler(
    compiler,
    projectCompilerPath
  );

  if (compilerPath) {
    const compilerName = path.basename(compilerPath);
    await addCompilerToProject(projectPath, compilerPath);
    vectorMessage(`Added Compiler ${compilerName} to Project ${projectName}`);
  } else {
    vectorMessage(`No Compiler found for Project ${projectName}`);
  }
}

/**
 * Creates a new Project including a new Compiler
 * @param projectPath Path to the new project file
 * @param compiler Compiler Name
 */
export async function createNewProject(projectPath: string, compiler: string) {
  const projectName = path.basename(projectPath);
  const projectLocation = path.dirname(projectPath);
  const progressMessage = `Creating new Project ${projectName}  ...`;
  const manageArgs = [`-p${projectName}`, `--create`, "--force"];

  await executeWithRealTimeEchoWithProgress(
    manageCommandToUse,
    manageArgs,
    projectLocation,
    progressMessage
  );

  await createNewCompilerInProject(projectPath, compiler);
}

export async function cleanProjectEnvironment(
  enviroPath: string,
  enviroNodeID: string,
  projectPath: string,
  level: string
) {
  const projectName = path.basename(projectPath);
  const projectLocation = path.dirname(projectPath);
  const progressMessage = `Cleaning up Environment ${level}  ...`;
  const manageArgs = [
    `-p${projectName}`,
    `--level=${level}`,
    "--clean",
    "--force",
  ];

  // if we are in server mode, close any existing connection to the environment
  if (globalEnviroDataServerActive) await closeConnection(enviroPath);

  await executeWithRealTimeEchoWithProgress(
    manageCommandToUse,
    manageArgs,
    projectLocation,
    progressMessage,
    cleanEnvironmentCallback,
    enviroNodeID
  );
}

export async function buildExecuteIncremental(
  projectPath: string,
  level: string,
  enviroPathList: string[],
  nodeId: string
) {
  const projectName = path.basename(projectPath);
  const projectLocation = path.dirname(projectPath);
  const manageArgs = [`-p${projectName}`, "--build-execute", "--incremental"];

  if (level != "") {
    manageArgs.push(`--level=${level}`);
  }

  const progressMessage = `Building and Executing Level: ${level} ...`;

  openMessagePane();
  await executeWithRealTimeEchoWithProgress(
    manageCommandToUse,
    manageArgs,
    projectLocation,
    progressMessage,
    buildEnvironmentIncrementalCallback,
    enviroPathList
  );

  await closeAnyOpenErrorFiles();

  // The build-execute command only provides an HTML report indicating whether the build was necessary.
  // However, it does not include test results, which we need to refresh on the extension side.
  // To ensure test results are updated, we rerun the tests here.
  // It's crucial to call runTests so that results are logged and test icons in the testing pane are refreshed.
  const testItem = findTestItemInController(nodeId);
  if (testItem) {
    const request = new vscode.TestRunRequest([testItem]);
    await runTests(request, new vscode.CancellationTokenSource().token);
  } else {
    vectorMessage(`TestItem for ${nodeId} not found`);
  }

  // Show the HTML Report
  const htmlFileName =
    projectName.split(".")[0] + "_manage_incremental_rebuild_report.html";
  const htmlFilePath = normalizePath(path.join(projectLocation, htmlFileName));
  viewResultsReportVC(htmlFilePath);
}

export async function removeTestsuiteFromProject(
  enviroPath: string,
  enviroNodeID: string
) {
  let manageArgs: string[] = [];
  let progressMessage: string = "";
  let projectLocation: string = "";

  // if we are in server mode, close any existing connection to the environment
  if (globalEnviroDataServerActive) await closeConnection(enviroPath);

  for (const [projectPath, projectData] of globalProjectDataCache) {
    for (const [cachedEnviroPath, enviroData] of projectData) {
      // We search for the correct environment in the cache in order to get the project
      if (cachedEnviroPath === enviroPath) {
        const projectName = path.basename(projectPath);
        const levelString = enviroData.displayName;
        projectLocation = path.dirname(projectPath);
        const testsuite = path.dirname(levelString);
        const envName = path.basename(enviroPath);

        manageArgs = [
          `-p${projectName}`,
          `--level=${testsuite}`,
          "--remove",
          `${envName}`,
          `--force`,
        ];
        progressMessage = `Removing Testsuite ${levelString} from Project ${projectName}`;
        break;
      }
    }
  }
  await executeWithRealTimeEchoWithProgress(
    manageCommandToUse,
    manageArgs,
    projectLocation,
    progressMessage,
    deleteEnvironmentCallback,
    enviroNodeID
  );
}

/**
 * Deletes the environment from the project
 * @param projectPath Path to the project
 * @param enviroName Name of the environment
 */
export async function deleteEnvironmentFromProject(
  projectPath: string,
  enviroName: string
) {
  const projectName = path.basename(projectPath);
  const projectLocation = path.dirname(projectPath);
  const manageArgs = [
    `-p${projectName}`,
    `-e${enviroName}`,
    `--delete`,
    `--force`,
  ];

  const message = `Deleting ${enviroName} from Project ${projectName} ...`;

  await executeWithRealTimeEchoWithProgress(
    manageCommandToUse,
    manageArgs,
    projectLocation,
    message
  );
  await refreshAllExtensionData();
}

export async function createTestsuiteInCompiler(
  projectPath: string,
  compilerName: string,
  testsuiteName: string
) {
  const projectName = path.basename(projectPath);
  const projectLocation = path.dirname(projectPath);
  const manageArgs = [
    `-p${projectName}`,
    `--compiler=${compilerName}`,
    `--testsuite=${testsuiteName}`,
    `--create`,
    "--force",
  ];

  const message = `Adding Testsuite ${testsuiteName} to Compiler ${compilerName} ...`;

  await executeWithRealTimeEchoWithProgress(
    manageCommandToUse,
    manageArgs,
    projectLocation,
    message
  );

  await updateProjectStructure(projectPath);
}

/**
 * Imports an already existing Environment to the Project if possible
 * @param projectFilePath Path to the Project
 * @param testsuite Testsuite string containing CompilerName/TestsuiteName
 * @param enviroPath Path to Environment
 */
export async function importEnvToTestsuite(
  projectFilePath: string,
  testsuite: string,
  enviroPath: string
) {
  const projectName = path.basename(projectFilePath);
  const projectLocation = path.dirname(projectFilePath);
  const manageArgs = [
    `-p${projectName}`,
    `--level=${testsuite}`,
    `--import`,
    `${enviroPath}`,
    "--force",
    "--migrate",
  ];

  const message = `Importing Environment ${enviroPath} to Testsuite ${testsuite}`;

  await executeWithRealTimeEchoWithProgress(
    manageCommandToUse,
    manageArgs,
    projectLocation,
    message,
    addEnvToProjectCallback,
    enviroPath
  );
}

/**
 * Imports an existing Compiler configuration into the Project.
 * @param projectFilePath Path to the Project file (e.g. from args.id)
 * @param pathToCFG Path to the selected .CFG file
 */
export async function addCompilerToProject(
  projectFilePath: string,
  pathToCFG: string
) {
  const projectName = path.basename(projectFilePath);
  const projectLocation = path.dirname(projectFilePath);
  const manageArgs = [`-p${projectName}`, `--cfg-to-compiler=${pathToCFG}`];
  const message = `Importing Compiler configuration from ${pathToCFG} into project ${projectName}`;

  // Call your function that runs the process with a progress UI.
  await executeWithRealTimeEchoWithProgress(
    manageCommandToUse,
    manageArgs,
    projectLocation,
    message
  );

  await refreshAllExtensionData();
}

/**
 * Imports an already existing Environment to the Project if possible
 * @param projectFilePath Path to the Project
 * @param testsuite Testsuite string containing CompilerName/TestsuiteName
 * @param enviroPath Path to Environment
 */
export async function createNewTestsuiteInProject(
  projectFilePath: string,
  testsuite: string
) {
  const projectName = path.basename(projectFilePath);
  const projectLocation = path.dirname(projectFilePath);
  const manageArgs = [
    `-p${projectName}`,
    `--create`,
    `--level=${testsuite}`,
    "--force",
  ];
  const message = `Creating Testsuite ${testsuite} in Project`;

  await executeWithRealTimeEchoWithProgress(
    manageCommandToUse,
    manageArgs,
    projectLocation,
    message
  );
}

/**
 * Imports an already existing Environment to the Project if possible
 * @param projectFilePath Path to the Project
 * @param testsuite Testsuite string containing CompilerName/TestsuiteName
 * @param enviroPath Path to Environment
 */
export async function addEnvToTestsuite(
  projectFilePath: string,
  testsuite: string,
  enviroName: string
) {
  const projectName = path.basename(projectFilePath);
  const projectLocation = path.dirname(projectFilePath);
  const manageArgs = [
    `-p${projectName}`,
    `--level=${testsuite}`,
    `--add`,
    `${enviroName}`,
    "--force",
  ];

  const message = `Adding Environment ${enviroName} to Testsuite`;

  await executeWithRealTimeEchoWithProgress(
    manageCommandToUse,
    manageArgs,
    projectLocation,
    message,
    addEnvToProjectCallback,
    enviroName
  );
}

/**
 * Updates the project data of all currenrly opened projects in the workspace
 * @param enviroPath Path to the environment
 * @param enviroName Name of the environment
 */
export async function updateAllOpenedProjects() {
  for (const projectPath of globalProjectDataCache.keys()) {
    const projectLocation = path.dirname(projectPath);
    const projectName = path.basename(projectPath);
    const manageArgs: string[] = [
      `-p${projectName}`,
      "--apply-changes",
      "--force",
    ];

    openMessagePane();
    const progressMessage = "Updating project data ...";
    await executeWithRealTimeEchoWithProgress(
      manageCommandToUse,
      manageArgs,
      projectLocation,
      progressMessage
    );
  }
}

/**
 * Updates the project data for the given environment
 * @param enviroPath Path to the environment
 * @param forceUpdate Whether to force update even if auto-update is disabled
 */
export async function updateProjectData(
  enviroPath: string,
  forceUpdate = false
) {
  const normalizedPath = normalizePath(enviroPath);
  const config = vscode.workspace.getConfiguration("vectorcastTestExplorer");
  const autoUpdate = config.get<boolean>(
    "automaticallyUpdateManageProject",
    true
  );

  // Only update if the current env is embedded in a project and the setting is enabled
  // or we force the update by actively clicking on the Update Project Button
  if (
    !envIsEmbeddedInProject(normalizedPath) ||
    (!autoUpdate && !forceUpdate)
  ) {
    return;
  }

  const enviroName = path.basename(normalizedPath);

  // Check if the environment is built in multiple test suites
  const shouldBlock = await checkIfEnvironmentIsBuildMultipleTimes(enviroName);

  if (shouldBlock) {
    // Show an information message with two options.
    const choice = await vscode.window.showInformationMessage(
      `Updating the project data is currently blocked because ${enviroName} is built in multiple testsuites. You can clean the other Environments now and the project will be updated.`,
      "Cancel",
      "Clean other Environments"
    );

    if (choice !== "Clean other Environments") return;

    // Delete the build folders of the other builds.
    await deleteOtherBuildFolders(normalizedPath);
  }

  // Update Project after cleaning the other environments OR if update is not blocked
  const { projectPath, displayName } = getEnviroNodeData(normalizedPath);
  const projectName = path.basename(projectPath);
  const projectLocation = path.dirname(projectPath);
  const manageArgs = [
    `-p${projectName}`,
    `--level=${displayName}`,
    "--apply-changes",
    "--force",
  ];

  openMessagePane();
  const progressMessage = "Updating project data ...";
  await executeWithRealTimeEchoWithProgress(
    manageCommandToUse,
    manageArgs,
    projectLocation,
    progressMessage
  );
}
