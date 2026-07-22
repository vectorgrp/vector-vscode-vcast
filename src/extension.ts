import * as vscode from "vscode";
import { Uri, workspace } from "vscode";

import { rebuildEnvironmentCallback } from "./callbacks";

import {
  activateLanguageServerClient,
  deactivateLanguageServerClient,
} from "./client";

import {
  updateConfigurationOption,
  updateUnitTestLocationOption,
} from "./configuration";

import {
  createCoverageStatusBar,
  hideStatusBarCoverage,
  initializeCodeCoverageFeatures,
  toggleCoverageAction,
  updateDisplayedCoverage,
  updateCOVdecorations,
} from "./coverage";

import {
  buildTestNodeForFunction,
  initializeTestDecorator,
  updateTestDecorator,
} from "./editorDecorator";

import { updateExploreDecorations } from "./fileDecorator";

import {
  openMessagePane,
  toggleMessageLog,
  adjustVerboseSetting,
  vectorMessage,
} from "./messagePane";

import {
  viewMCDCReport,
  viewResultsReport,
  viewResultsReportVC,
} from "./reporting";

import {
  environmentDataCache,
  environmentNodeDataType,
  getEnviroNodeData,
  getEnviroPathFromID,
  getTestNode,
  testNodeType,
} from "./testData";

import {
  activateTestPane,
  deleteTests,
  insertBasisPathTests,
  insertATGTests,
  loadTestScript,
  pathToEnviroBeingDebugged,
  pathToProgramBeingDebugged,
  refreshAllExtensionData,
  updateCodedTestCases,
  updateDataForEnvironment,
  vcastUnbuiltEnviroList,
  globalProjectWebviewComboboxItems,
  setGlobalProjectIsOpenedChecker,
  setGlobalCompilerAndTestsuites,
  loadTestScriptButton,
} from "./testPane";

import {
  addLaunchConfiguration,
  addSettingsFileFilter,
  enviroFileIsAda,
  getEnvPathForFilePath,
  isAdaSourceFile,
  notifyAdaFeatureDisabled,
  showSettings,
  updateCoverageAndRebuildEnv,
  forceLowerCaseDriveLetter,
  decodeVar,
  getFullEnvReport,
  normalizePath,
} from "./utilities";

import {
  buildEnvironmentFromScript,
  deleteEnvironment,
  openVcastFromEnviroNode,
  openVcastFromVCEfile,
  rebuildEnvironment,
  openProjectInVcast,
  deleteLevel,
} from "./vcastAdapter";

import {
  buildProjectEnvironment,
  removeTestsuiteFromProject,
  importEnvToTestsuite,
  createTestsuiteInCompiler,
  addCompilerToProject,
  updateProjectData,
  buildExecuteIncremental,
  cleanProjectEnvironment,
  addEnvToTestsuite,
  deleteEnvironmentFromProject,
  createNewProject,
} from "./manage/manageSrc/manageCommands";

import {
  deleteServerLog,
  displayServerLog,
  initializeVcastDataServer,
  initializeServerState,
  serverProcessController,
  serverStateType,
  toggleDataServerState,
} from "./vcastDataServer";

import {
  checkIfInstallationIsOK,
  configurationFile,
  launchFile,
  globalPathToSupportFiles,
  initializeInstallerFiles,
} from "./vcastInstallation";

import {
  clearVcastRepositoryInConfig,
  resolveRequirementsGatewayInnerDir,
} from "./requirements/rgwPath";
import {
  setupRequirementsFileWatchers,
  updateRequirementsAvailability,
} from "./requirements/availability";
import { performLLMProviderUsableCheck } from "./requirements/llmProvider";
import {
  applyEditPolicy,
  inferTraceability,
  readRGWBundle,
  RGWBundle,
  RGWStaleWriteError,
  writeRGWBundle,
} from "./requirements/rgwIo";
import { generateRequirementsHtml } from "./requirements/webviews/template";
import type { FromWebview, ToWebview } from "./requirements/webviews/messages";
import { panreqSupportsOnlyUntraced } from "./requirements/requirementsExecutables";

import {
  exportRequirements,
  generateRequirements,
  generateTestsFromRequirements,
  importRequirements,
  initializeReqs2X,
} from "./requirements/requirementsOperations";
import {
  maybeOfferLegacyMigration,
  runLegacyMigrationCommand,
  migrateLegacyRequirementsForEnv,
  setupLegacyMigrationWatchers,
} from "./requirements/legacyMigration";

import {
  generateNewCodedTestFile,
  addExistingCodedTestFile,
  newEnvironment,
  newTestScript,
  openCodedTest,
  ProjectEnvParameters,
  createNewCFGFile,
  ConfigurationOptions,
  updateVCShellDatabase,
  updateCFGWithVCShellDatabase,
} from "./vcastTestInterface";

import {
  addIncludePath,
  envIsEmbeddedInProject,
  getEnviroNameFromFile,
  getEnvironmentData,
  getLevelFromNodeId,
  getVcmRoot,
  openProjectFromEnviroPath,
  openTestScript,
} from "./vcastUtilities";

import fs = require("fs");
import {
  compilerTagList,
  setCompilerList,
} from "./manage/manageSrc/manageUtils";
import { getNonce, resolveWebviewBase } from "./webviewUtils";

const path = require("path");

/**
 * Decodes a Base64-encoded variable name.
 */
function decodeAndRemoveDeveloperEnvs() {
  // Base64-encoded variable names
  const encodedVars: string[] = [
    "VkNBU1RfVVNJTkdfSEVBRExFU1NfTU9ERQ",
    "VkNBU1RfVVNFX0NJX0xJQ0VOU0VT",
  ];

  for (const encoded of encodedVars) {
    const varName = decodeVar(encoded);
    delete process.env[varName];
  }
}

let messagePane: vscode.OutputChannel = vscode.window.createOutputChannel(
  "VectorCAST Test Explorer"
);

export function getMessagePane(): vscode.OutputChannel {
  return messagePane;
}

export async function activate(context: vscode.ExtensionContext) {
  // activation gets called when:
  //  -- VectorCAST environment exists in the workspace
  //  -- "Create VectorCAST Environment" is selected from the Explorer context menu
  //  -- "VectorCAST Test Explorer: Configure" is selected from the command palette (ctrl-shift-p)

  // Handler for "VectorCAST Test Explorer: Configure"
  // The first use of configure will trigger this activate function
  // subsequent uses will trigger configureCommandCalled()
  vscode.commands.registerCommand("vectorcastTestExplorer.configure", () => {
    configureCommandCalled(context);
  });
  vscode.commands.registerCommand("vectorcastTestExplorer.toggleLog", () =>
    toggleMessageLog()
  );

  // we need to install some event handlers so that the user can "fix"
  // a "bad" vcast installation by providing a valid path see logic
  // and comments in this function
  await installPreActivationEventHandlers(context);

  // this checks the vcast installation,
  // and if its ok will proceed with full activation
  await checkPrerequisites(context);
}

export function configureCommandCalled(context: vscode.ExtensionContext) {
  // open the extension settings if the user has explicitly called configure
  showSettings();
}

let alreadyConfigured: boolean = false;
let installationFilesInitialized: boolean = false;
async function checkPrerequisites(context: vscode.ExtensionContext) {
  // this function is called from the activate function, and also from the
  // event handler for changes to the vcast installation location.  So in the
  // case that the VectorCAST installation is not found initially, we will get
  // here multiple times

  if (!alreadyConfigured) {
    // setup the location of vTestInterface.py and other utilities
    if (!installationFilesInitialized) {
      initializeInstallerFiles(context);
      installationFilesInitialized = true;
    }

    if (await checkIfInstallationIsOK()) {
      activationLogic(context);
      alreadyConfigured = true;
      vscode.commands.executeCommand(
        "setContext",
        "vectorcastTestExplorer.configured",
        true
      );
      // default to coverage ON
      await toggleCoverageAction();
      // initialize the verbose setting
      adjustVerboseSetting();

      // Sets the list for all available compilers
      await setCompilerList();
    } else {
      openMessagePane();
    }
  }
}

async function getEnvironmentListIncludingUnbuilt(
  workspacePath: string
): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    // Use glob to find all .env files in the workspace
    const glob = require("glob");
    glob(
      "**/*.env",
      { cwd: workspacePath, nodir: true },
      (err: Error, envFiles: string[]) => {
        if (err) {
          reject(err);
          return;
        }

        // Convert each .env file to its corresponding environment path
        const envPaths = envFiles.map((envFile) => {
          const fullPath = path.join(workspacePath, envFile);
          const dirPath = path.dirname(fullPath);
          const baseName = path.basename(envFile, ".env");
          return path.join(dirPath, baseName);
        });

        resolve(envPaths);
      }
    );
  });
}

/**
 * Pick the environment path to act on for a command. Right-click invocations
 * pass `{ id }` from a tree node; command-palette invocations pass nothing,
 * so we show a quick-pick of envs in the workspace. Returns null if the user
 * dismisses the picker or the workspace has no env files.
 */
/**
 * Open the source file backing a trace mapping. If `functionName` is given
 * and the unit has a matching entry with a startLine, jump to that line;
 * otherwise just open the file. Used by the requirements editor's "Open
 * source" button.
 */
/**
 * Resolve a source-file location from VectorCAST envData.  Returns the URI
 * for the unit's source file and the line of the named function (or 0 if
 * `functionName` is null or its `startLine` isn't known). Returns null if
 * envData lacks unit info or the unit isn't present in the env.
 *
 * Shared by the test-pane "Open Source File" command and the requirements
 * editor's per-card "Open source" button — same matching rule (unit name
 * == source-file basename, sans extension).
 */
function resolveSourceLocation(
  envData: any,
  unitName: string,
  functionName: string | null
): { uri: vscode.Uri; lineNumber: number } | null {
  const units = envData?.unitData;
  if (!Array.isArray(units)) return null;
  // Ada unit names are upper-case and child units are dot-named (e.g.
  // WAREHOUSE.ORDERS), while the source files on disk are lower-case and
  // dash-named (warehouse-orders.adb). Compare case- and dot/dash-insensitively
  // so the match works for Ada as well as C/C++ (whose names already match).
  const normalizeUnit = (name: string) =>
    name.toLowerCase().replace(/\./g, "-");
  const target = normalizeUnit(unitName);
  const unitInfo = units.find((u: any) => {
    if (!u?.path) return false;
    return (
      normalizeUnit(path.basename(u.path, path.extname(u.path))) === target
    );
  });
  if (!unitInfo) return null;
  let lineNumber = 0;
  if (functionName && Array.isArray(unitInfo.functionList)) {
    const fn = unitInfo.functionList.find(
      (f: any) => f?.name === functionName && f?.startLine !== undefined
    );
    if (fn) lineNumber = fn.startLine;
  }
  return { uri: vscode.Uri.file(unitInfo.path), lineNumber };
}

async function openSourceForTrace(
  enviroPath: string,
  unitName: string,
  functionName: string | null,
  referenceColumn: vscode.ViewColumn | undefined
): Promise<void> {
  if (!unitName) return;
  let envData: any;
  try {
    envData = await getEnvironmentData(enviroPath);
  } catch {
    vscode.window.showErrorMessage(
      "Could not query the environment to resolve the source file."
    );
    return;
  }
  if (!envData?.unitData) {
    vscode.window.showErrorMessage("Environment data has no unit information.");
    return;
  }

  const located = resolveSourceLocation(envData, unitName, functionName);
  if (!located) {
    vscode.window.showErrorMessage(
      `Unit "${unitName}" not found in this environment.`
    );
    return;
  }
  const { uri, lineNumber } = located;
  const position = new vscode.Position(Math.max(0, lineNumber - 1), 0);
  const selection = new vscode.Range(position, position);

  // If the file is already open in a tab in some *other* column, reveal
  // that tab. Tabs in the webview's own column are ignored — switching to
  // them would hide the requirements view. If no other-column tab exists,
  // fall back to Beside so a new editor opens next to the webview.
  let targetColumn: vscode.ViewColumn | undefined;
  for (const group of vscode.window.tabGroups.all) {
    if (group.viewColumn === referenceColumn) continue;
    const hit = group.tabs.find(
      (tab) =>
        tab.input instanceof vscode.TabInputText &&
        tab.input.uri.fsPath === uri.fsPath
    );
    if (hit) {
      targetColumn = group.viewColumn;
      break;
    }
  }
  targetColumn ??= vscode.ViewColumn.Beside;

  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, {
    preview: false,
    preserveFocus: false,
    selection,
    viewColumn: targetColumn,
  });
}

async function resolveEnviroPathForCommand(args: any): Promise<string | null> {
  if (args?.id) {
    const testNode: testNodeType = getTestNode(args.id);
    return testNode?.enviroPath ?? null;
  }

  const folders = workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showErrorMessage("No workspace open.");
    return null;
  }

  const envPaths = await getEnvironmentListIncludingUnbuilt(
    folders[0].uri.fsPath
  );
  if (envPaths.length === 0) {
    vscode.window.showErrorMessage(
      "No VectorCAST environments found in the workspace."
    );
    return null;
  }

  if (envPaths.length === 1) return envPaths[0];

  const picked = await vscode.window.showQuickPick(
    envPaths.map((p) => ({
      label: path.basename(p),
      description: path.relative(folders[0].uri.fsPath, p),
      envPath: p,
    })),
    { placeHolder: "Select environment" }
  );
  return picked ? picked.envPath : null;
}

async function activationLogic(context: vscode.ExtensionContext) {
  // remove developer env variables
  decodeAndRemoveDeveloperEnvs();

  // adds all of the command handlers
  configureExtension(context);

  // setup the decorations for coverage
  initializeCodeCoverageFeatures(context);

  // initialize the gutter decorator for testable functions
  initializeTestDecorator(context);

  await initializeVcastDataServer();

  // initialize the test pane
  activateTestPane(context);

  // start the language server
  activateLanguageServerClient(context);

  // Initialize requirements availability for all environments, then keep it
  // in sync with out-of-band changes (RGW deleted in a terminal, CCAST_.CFG
  // edited by hand, etc.).
  if (workspace.workspaceFolders && workspace.workspaceFolders.length > 0) {
    const envPaths = await getEnvironmentListIncludingUnbuilt(
      workspace.workspaceFolders[0].uri.fsPath
    );
    for (const envPath of envPaths) {
      updateRequirementsAvailability(envPath);
    }
  }
  setupRequirementsFileWatchers(context);
  setupLegacyMigrationWatchers(context);

  initializeReqs2X(context);

  // One-shot prompt: legacy reqs.xlsx / reqs.csv → RGW. Runs after
  // initializeReqs2X so the panreq executable path is resolved (no-op
  // otherwise). Fire and forget — we don't want migration to block the
  // rest of activation.
  void maybeOfferLegacyMigration(context);
}

function configureExtension(context: vscode.ExtensionContext) {
  // this sets up the file explorer decorations for code coverage
  updateExploreDecorations();

  // Command: vectorcastTestExplorer.coverage /////////////////////////////////////////////////////////
  // We create the status bar here, but the showing and updating is done in updateCOVdecorations
  const coverStatusBar: vscode.StatusBarItem = createCoverageStatusBar();
  context.subscriptions.push(coverStatusBar);
  let toggleCoverageCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.coverage",
    async () => {
      await toggleCoverageAction();
    }
  );
  context.subscriptions.push(toggleCoverageCommand);

  // Command: vectorcastTestExplorer.toggleVcastServerState ////////////////////////////////////////////////
  let toggleDataServerCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.toggleVcastServerState",
    async () => {
      await toggleDataServerState();
    }
  );
  context.subscriptions.push(toggleDataServerCommand);

  // Command: vectorcastTestExplorer.displayServerLog ////////////////////////////////////////////////
  let displayServerLogCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.displayServerLog",
    () => {
      displayServerLog();
    }
  );
  context.subscriptions.push(displayServerLogCommand);

  // Command: vectorcastTestExplorer.viewResults////////////////////////////////////////////////////////
  let viewResultsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.viewResults",
    (args: any) => {
      if (args) {
        viewResultsReport(args.id);
      }
    }
  );
  context.subscriptions.push(viewResultsCommand);

  // Command: vectorcastTestExplorer.createTestScript////////////////////////////////////////////////////////
  // This is the callback for the right clicks in the test explorer tree
  let createTestScriptCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.createTestScript",
    (args: any) => {
      if (args) {
        const testNode: testNodeType = getTestNode(args.id);
        newTestScript(testNode);
      }
    }
  );
  context.subscriptions.push(createTestScriptCommand);

  // Command: vectorcastTestExplorer.addCodedTests////////////////////////////////////////////////////////
  // This is the callback for the right clicks in the test explorer tree
  let addCodedTestsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.addCodedTests",
    (args: any) => {
      if (args) {
        addExistingCodedTestFile(args.id);
      }
    }
  );
  context.subscriptions.push(addCodedTestsCommand);

  // Command: vectorcastTestExplorer.generateCodedTests////////////////////////////////////////////////////////
  // This is the callback for the right clicks in the test explorer tree
  let generateCodedTestsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.generateCodedTests",
    (args: any) => {
      if (args) {
        generateNewCodedTestFile(args.id);
      }
    }
  );
  context.subscriptions.push(generateCodedTestsCommand);

  // Command: vectorcastTestExplorer.removeCodedTests////////////////////////////////////////////////////////
  // This is the callback for the right clicks in the test explorer tree

  // adding the ... to nodeList, results in us getting a list of selected tests!
  let removeCodedTestsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.removeCodedTests",
    (...nodeList: any) => {
      if (nodeList) {
        deleteTests(nodeList);
      }
    }
  );
  context.subscriptions.push(removeCodedTestsCommand);

  // Command: vectorcastTestExplorer.insertBasisPathTests////////////////////////////////////////////////////////
  let insertBasisPathTestsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.insertBasisPathTests",
    (args: any) => {
      if (args) {
        const testNode: testNodeType = getTestNode(args.id);
        insertBasisPathTests(testNode);
      }
    }
  );
  context.subscriptions.push(insertBasisPathTestsCommand);

  // Command: vectorcastTestExplorer.insertBasisPathTestsFromEditor////////////////////////////////////////////////////////
  let insertBasisPathTestsFromEditorCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.insertBasisPathTestsFromEditor",
    (args: any) => {
      if (args) {
        const testNode = buildTestNodeForFunction(args);
        if (testNode) insertBasisPathTests(testNode);
        else
          vscode.window.showErrorMessage(
            `Unable to create Basis Path Tests for function at line ${args.lineNumber}`
          );
      }
    }
  );
  context.subscriptions.push(insertBasisPathTestsFromEditorCommand);

  // Command: vectorcastTestExplorer.insertATGTests////////////////////////////////////////////////////////
  let insertATGTestsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.insertATGTests",
    (args: any) => {
      if (args) {
        const testNode: testNodeType = getTestNode(args.id);
        insertATGTests(testNode);
      }
    }
  );
  context.subscriptions.push(insertATGTestsCommand);

  // Command: vectorcastTestExplorer.insertATGTestsFromEditor////////////////////////////////////////////////////////
  let insertATGTestsFromEditorCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.insertATGTestsFromEditor",
    (args: any) => {
      if (args) {
        const testNode = buildTestNodeForFunction(args);
        if (testNode) insertATGTests(testNode);
        else
          vscode.window.showErrorMessage(
            `Unable to create ATG Tests for function at line ${args.lineNumber}`
          );
      }
    }
  );
  context.subscriptions.push(insertATGTestsFromEditorCommand);

  let generateRequirementsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.generateRequirements",
    (args: any) => {
      if (args) {
        const testNode: testNodeType = getTestNode(args.id);
        const enviroPath = testNode.enviroPath;
        generateRequirements(enviroPath);
      }
    }
  );
  context.subscriptions.push(generateRequirementsCommand);

  let generateRequirementsTestsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.generateTestsFromRequirements",
    async (args: any) => {
      if (args) {
        const testNode: testNodeType = getTestNode(args.id);
        const enviroPath = testNode.enviroPath;
        await generateTestsFromRequirements(
          enviroPath,
          testNode.functionName || testNode.unitName || null
        );
      }
    }
  );
  context.subscriptions.push(generateRequirementsTestsCommand);

  let importRequirementsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.importRequirements",
    async (args: any) => {
      const enviroPath = await resolveEnviroPathForCommand(args);
      if (enviroPath) await importRequirements(enviroPath);
    }
  );
  context.subscriptions.push(importRequirementsCommand);

  let exportRequirementsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.exportRequirements",
    async (args: any) => {
      const enviroPath = await resolveEnviroPathForCommand(args);
      if (enviroPath) await exportRequirements(enviroPath);
    }
  );
  context.subscriptions.push(exportRequirementsCommand);

  let testLLMConfigurationCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.testLLMConfiguration",
    async (args: any) => {
      const checkSuccessful = await performLLMProviderUsableCheck();

      if (checkSuccessful) {
        vscode.window.showInformationMessage(
          "LLM configuration test was successful."
        );
      } else {
        vscode.window.showErrorMessage("LLM configuration test failed.");
      }
    }
  );
  context.subscriptions.push(testLLMConfigurationCommand);

  // Command: vectorcastTestExplorer.createTestScriptFromEditor////////////////////////////////////////////////////////
  // This is the callback for right clicks of the source editor flask+ icon
  let createTestScriptFromEditorCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.createTestScriptFromEditor",
    (args: any) => {
      if (args) {
        const testNode = buildTestNodeForFunction(args);
        if (testNode) newTestScript(testNode);
        else
          vscode.window.showErrorMessage(
            `Unable to create test script for function at line ${args.lineNumber}`
          );
      }
    }
  );
  context.subscriptions.push(createTestScriptFromEditorCommand);

  // Command: vectorcastTestExplorer.deleteTest ////////////////////////////////////////////////////////
  let deleteTestCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.deleteTest",
    async (...nodeList: any) => {
      if (nodeList) {
        if (nodeList.length > 1 || nodeList[0].children.size > 0) {
          const message =
            "The selected tests will be deleted, and this action cannot be undone.";
          const answer = await vscode.window.showWarningMessage(
            message,
            "Delete",
            "Cancel"
          );

          if (answer === "Delete") {
            await deleteTests(nodeList);
          }
        } else {
          await deleteTests(nodeList);
        }
      }
    }
  );
  context.subscriptions.push(deleteTestCommand);

  // Command: vectorcastTestExplorer.editTestScript////////////////////////////////////////////////////////
  let editTestScriptCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.editTestScript",
    (args: any) => {
      if (args) {
        openTestScript(args.id);
      }
    }
  );
  context.subscriptions.push(editTestScriptCommand);

  // Command: vectorcastTestExplorer.editCodedTest////////////////////////////////////////////////////////
  let editCodedTestCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.editCodedTest",
    (args: any) => {
      if (args) {
        const testNode: testNodeType = getTestNode(args.id);
        openCodedTest(testNode);
      }
    }
  );
  context.subscriptions.push(editCodedTestCommand);

  // Command: vectorcastTestExplorer.loadTestScript////////////////////////////////////////////////////////
  let loadTestScriptCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.loadTestScript",
    async () => {
      await loadTestScriptButton();
    }
  );
  context.subscriptions.push(loadTestScriptCommand);

  // Command: vectorcastTestExplorer.debugEnviroPath ////////////////////////////////////////////////////////
  // this command is used to return the path to the environment being debugged via
  // the variable: vectorcastTestExplorer.debugEnviroPath that is used in launch.json
  let debugEnviroPathCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.debugEnviroPath",
    () => {
      return pathToEnviroBeingDebugged;
    }
  );
  context.subscriptions.push(debugEnviroPathCommand);

  // Command: vectorcastTestExplorer.debugProgramPath ////////////////////////////////////////////////////////
  // this command is used to return the path to the environment being debugged via
  // the variable: vectorcastTestExplorer.debugProgramPath that is used in launch.json
  let debugProgramPathCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.debugProgramPath",
    () => {
      return pathToProgramBeingDebugged;
    }
  );
  context.subscriptions.push(debugProgramPathCommand);

  // Command: vectorcastTestExplorer.showSettings
  vscode.commands.registerCommand("vectorcastTestExplorer.showSettings", () =>
    showSettings()
  );

  // Command: vectorcastTestExplorer.addLaunchConfiguration ////////////////////////////////////////////////////////
  let addLaunchConfigurationCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.addLaunchConfiguration",
    (args: Uri, argList: Uri[]) => {
      // arg is the actual item that the right click happened on, argList is the list
      // of all items if this is a multi-select.  Since argList is always valid, even for a single
      // selection, we just use this here.
      if (argList) {
        // find the list item that contains launch.json
        for (let i = 0; i < argList.length; i++) {
          if (argList[i].fsPath.includes(launchFile)) {
            addLaunchConfiguration(argList[i], globalPathToSupportFiles);
          }
        }
      } else {
        // if the arglist is undefined, this might be a right click action in the editor
        let activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
          const filePath = activeEditor.document.uri.toString();
          if (filePath.endsWith(launchFile)) {
            addLaunchConfiguration(
              activeEditor.document.uri,
              globalPathToSupportFiles
            );
          }
        }
      }
    }
  );
  context.subscriptions.push(addLaunchConfigurationCommand);

  // Command: vectorcastTestExplorer.addIncludePath ////////////////////////////////////////////////////////
  let addIncludePathCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.addIncludePath",
    (args: Uri, argList: Uri[]) => {
      // arg is the actual item that the right click happened on, argList is the list
      // of all items if this is a multi-select.  Since argList is always valid, even for a single
      // selection, we just use this here.
      if (argList) {
        // find the list item that contains c_cpp_properties.json
        for (let i = 0; i < argList.length; i++) {
          if (argList[i].fsPath.includes(configurationFile)) {
            addIncludePath(argList[i]);
          }
        }
      } else {
        // if the arglist is undefined, this might be a right click action in the editor
        let activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
          const filePath = activeEditor.document.uri.toString();
          if (filePath.endsWith(configurationFile)) {
            addIncludePath(activeEditor.document.uri);
          }
        }
      }
    }
  );
  context.subscriptions.push(addIncludePathCommand);

  // Command: vectorcastTestExplorer.addSettingsFileFilter ////////////////////////////////////////////////////////
  let addSettingsTFileFilterCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.addSettingsFileFilter",
    (args: Uri, argList: Uri[]) => {
      // arg is the actual item that the right click happened on, argList is the list
      // of all items if this is a multi-select.  Since argList is always valid, even for a single
      // selection, we just use this here.
      if (argList) {
        addSettingsFileFilter(argList[0], globalPathToSupportFiles);
      }
    }
  );
  context.subscriptions.push(addSettingsTFileFilterCommand);

  // Command: vectorcastTestExplorer.openVCAST  ////////////////////////////////////////////////////////
  let openVCAST = vscode.commands.registerCommand(
    "vectorcastTestExplorer.openVCAST",
    async (enviroNode: any) => {
      vectorMessage("Starting VectorCAST ...");
      // If the Env is embedded in a project, we want to open the whole project
      const enviroPath = enviroNode.id.split("vcast:")[1];
      if (envIsEmbeddedInProject(enviroPath)) {
        await openProjectFromEnviroPath(enviroPath);
      } else {
        openVcastFromEnviroNode(enviroNode.id, updateDataForEnvironment);
      }
    }
  );
  context.subscriptions.push(openVCAST);

  // Command: vectorcastTestExplorer.openVCASTFromVce  ////////////////////////////////////////////////////////
  let openVCASTFromVce = vscode.commands.registerCommand(
    "vectorcastTestExplorer.openVCASTFromVce",
    async (arg: any) => {
      vectorMessage("Starting VectorCAST ...");
      const dotIndex = arg.fsPath.lastIndexOf(".");
      const enviroPath = arg.fsPath.slice(0, dotIndex);
      if (envIsEmbeddedInProject(enviroPath)) {
        await openProjectFromEnviroPath(enviroPath);
      } else {
        openVcastFromVCEfile(arg.fsPath, updateDataForEnvironment);
      }
    }
  );
  context.subscriptions.push(openVCASTFromVce);

  // Command: vectorcastTestExplorer.buildEnviroFromEnv ////////////////////////////////////////////////////////
  let buildEnviroVCASTCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.buildEnviroFromEnv",
    (arg: Uri) => {
      // arg is the URI of the .env file that was clicked
      if (arg) {
        const envFilepath = arg.fsPath;
        // Building new Ada environments is disabled for now.
        if (enviroFileIsAda(envFilepath)) {
          notifyAdaFeatureDisabled("Building an Ada environment");
          return;
        }
        const buildDirectory = path.dirname(envFilepath);
        const enviroFilename = path.basename(envFilepath);
        const enviroName = getEnviroNameFromFile(envFilepath);
        if (enviroName) {
          if (!fs.existsSync(path.join(buildDirectory, enviroName))) {
            buildEnvironmentFromScript(
              buildDirectory,
              enviroFilename.split(".")[0]
            );
          } else {
            vscode.window.showErrorMessage(
              `Environment: ${enviroName} already exists`
            );
          }
        } else {
          vscode.window.showErrorMessage(
            `Unable to determine environment name from file: ${envFilepath}`
          );
        }
      }
    }
  );
  context.subscriptions.push(buildEnviroVCASTCommand);

  // Command: vectorcastTestExplorer.rebuildEnviro  ////////////////////////////////////////////////////////
  let rebuildEnviro = vscode.commands.registerCommand(
    "vectorcastTestExplorer.rebuildEnviro",
    (enviroNode: any) => {
      // this returns the full path to the environment directory
      const enviroPath = getEnviroPathFromID(enviroNode.id);
      rebuildEnvironment(enviroPath, rebuildEnvironmentCallback);
    }
  );
  context.subscriptions.push(rebuildEnviro);

  let updateProjectLevelCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.updateProjectEnvironment",
    async (enviroNode: any) => {
      const enviroPath = getEnviroPathFromID(enviroNode.id);
      // Check if the result is valid
      if (enviroPath) {
        await updateProjectData(enviroPath, true);
      } else {
        vectorMessage(`Unable to find Environment ${enviroNode.id}`);
      }
    }
  );
  context.subscriptions.push(updateProjectLevelCommand);

  // Command: vectorcastTestExplorer.buildExecuteIncremental  ////////////////////////////////////////////////////////
  let buildExecuteIncrementalCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.buildExecuteIncremental",
    async (enviroNode: any) => {
      const enviroPathList: string[] = [];
      let projectPath = "";
      let displayName = "";

      // In case the Node id starts with vcast:, it is an environment node and the id is the build path
      if (enviroNode.id.includes("vcast:")) {
        const enviroPath = enviroNode.id.split("vcast:")[1];
        enviroPathList.push(enviroPath);
        const enviroData = getEnviroNodeData(enviroPath);
        ({ displayName, projectPath } = enviroData);
      } else {
        // Otherwise it's either a project, compiler or testsuite node
        projectPath = enviroNode.id.split(".vcm")[0] + ".vcm";
        const projectData = getLevelFromNodeId(enviroNode.id);
        displayName = projectData.level;

        // Collect all relevant environment paths
        for (const [envPath, envValue] of environmentDataCache) {
          // If projectPath == enviroNode.id -> Project Node, otherwise we have to check
          // if the current displayName is part of the envValue.displayName (compiler, testsuite)
          if (
            envValue.projectPath === projectPath &&
            (projectPath === enviroNode.id ||
              envValue.displayName.includes(displayName))
          ) {
            enviroPathList.push(envPath);
          }
        }
      }

      await buildExecuteIncremental(
        projectPath,
        displayName,
        enviroPathList,
        enviroNode.id
      );
      await refreshAllExtensionData();
    }
  );

  context.subscriptions.push(buildExecuteIncrementalCommand);

  let openProjectInVectorCAST = vscode.commands.registerCommand(
    "vectorcastTestExplorer.openProjectInVectorCAST",
    async (node: any) => {
      // this returns the full path to the environment directory
      const result = getVcmRoot(node.id);

      // Check if the result is valid
      if (result) {
        const { rootPath, vcmName } = result;
        vectorMessage(`Opening ${vcmName} in VectorCAST...`);
        await openProjectInVcast(rootPath, vcmName);
      } else {
        vectorMessage(`Unable to open project ${node.id}`);
      }
    }
  );
  context.subscriptions.push(openProjectInVectorCAST);

  let addCompilerToProjectCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.addCompilerToProject",
    async (args: any) => {
      // Verify that the command was invoked from a node with an 'id' property.
      if (!args?.id) {
        vscode.window.showErrorMessage("No project node provided.");
        return;
      }
      //project file path
      const projectFilePath = args.id;

      // Open a file dialog so the user can select a .CFG file.
      const cfgFiles = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: "Select VectorCAST Configuration (.CFG) file",
        filters: {
          "CFG Files": ["cfg"],
          "All Files": ["*"],
        },
      });

      if (!cfgFiles || cfgFiles.length === 0) {
        vscode.window.showInformationMessage("No CFG file selected.");
        return;
      }

      // Get the first selected file's path.
      const pathToCFG = cfgFiles[0].fsPath;

      await addCompilerToProject(projectFilePath, pathToCFG);
    }
  );
  context.subscriptions.push(addCompilerToProjectCommand);

  const addTestsuiteToCompiler = vscode.commands.registerCommand(
    "vectorcastTestExplorer.addTestsuiteToCompiler",
    async (node: any) => {
      const manageWebviewSrcDir = resolveWebviewBase(
        context,
        "manage",
        "webviews"
      );
      const panel = vscode.window.createWebviewPanel(
        "addTestsuiteToCompiler",
        "Add Testsuite to Compiler",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.file(manageWebviewSrcDir)],
        }
      );

      panel.webview.html = await getTestsuiteWebviewContent(context, panel);

      // --- Dispatch Table ---
      const dispatch: Record<string, (msg?: any) => Promise<void> | void> = {
        submit: handleSubmit,
        cancel: () => panel.dispose(),
      };

      panel.webview.onDidReceiveMessage(
        (message) => dispatch[message.command]?.(message),
        undefined,
        context.subscriptions
      );

      // --- Handlers ---
      function handleSubmit(message: { testsuiteName?: string }): void {
        const { testsuiteName } = message;

        if (!testsuiteName) {
          vscode.window.showErrorMessage("Testsuite name is required.");
          return;
        }

        const projectPath = path.dirname(node.id);
        const compilerName = path.basename(node.id);

        createTestsuiteInCompiler(projectPath, compilerName, testsuiteName);
        panel.dispose();
      }
    }
  );

  context.subscriptions.push(addTestsuiteToCompiler);

  // Webview HTML content.
  async function getTestsuiteWebviewContent(
    context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel
  ): Promise<string> {
    const base = resolveWebviewBase(context, "manage", "webviews");

    // on-disk locations
    const cssOnDisk = vscode.Uri.file(
      path.join(base, "css", "addTestsuite.css")
    );
    const scriptOnDisk = vscode.Uri.file(
      path.join(base, "webviewScripts", "addTestsuite.js")
    );
    const htmlPath = path.join(base, "html", "addTestsuite.html");

    // webview URIs
    const cssUri = panel.webview.asWebviewUri(cssOnDisk);
    const scriptUri = panel.webview.asWebviewUri(scriptOnDisk);

    // read template
    let html = fs.readFileSync(htmlPath, "utf8");

    // build CSP + nonce
    const nonce = getNonce();
    const cspMeta = `
      <meta http-equiv="Content-Security-Policy"
            content="default-src 'none';
                     style-src ${panel.webview.cspSource};
                     script-src 'nonce-${nonce}' ${panel.webview.cspSource};">
    `;

    // inject CSP
    html = html.replace(/<head>/, `<head>${cspMeta}`);

    // replace placeholders and add nonce to script tag
    html = html
      .replace(/{{\s*cssUri\s*}}/g, cssUri.toString())
      .replace(
        /<script src="{{\s*scriptUri\s*}}"><\/script>/,
        `<script nonce="${nonce}" src="${scriptUri}"></script>`
      );

    return html;
  }

  // Command: vectorcastTestExplorer.getEnvFullReport  ////////////////////////////////////////////////////////
  let getEnvFullReportCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.getEnvFullReport",
    async (enviroNode: any) => {
      const enviroPath = enviroNode.id.split("vcast:")[1];
      const enviroData: environmentNodeDataType = getEnviroNodeData(enviroPath);

      // Execute process
      const reportPathHTML = await getFullEnvReport(
        enviroData.buildDirectory,
        enviroPath
      );

      // View report
      viewResultsReportVC(reportPathHTML);
    }
  );
  context.subscriptions.push(getEnvFullReportCommand);

  // Command: vectorcastTestExplorer.buildProjectEnviro  ////////////////////////////////////////////////////////
  let buildProjectEnviro = vscode.commands.registerCommand(
    "vectorcastTestExplorer.buildProjectEnviro",
    async (enviroNode: any) => {
      // displayName is the what will be passed as the --level arg value
      const enviroPath = enviroNode.id.split("vcast:")[1];
      const enviroData: environmentNodeDataType = getEnviroNodeData(enviroPath);
      const displayName = enviroData.displayName;
      console.log("Building project environment: " + displayName);

      await buildProjectEnvironment(
        enviroData.projectPath,
        displayName,
        enviroPath
      );
    }
  );
  context.subscriptions.push(buildProjectEnviro);

  let deleteTestsuiteCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.deleteTestsuite",
    async (node: any) => {
      const nodeParts = node.id.split("/");
      // compiler/testsuite
      // Can't do path.join because on windows the level would be with the wrong "\"
      const testsuiteLevel =
        nodeParts[nodeParts.length - 2] + "/" + nodeParts[nodeParts.length - 1];
      // Join the path without the testsuite level
      const joinedPath = path.join(...nodeParts.slice(0, nodeParts.length - 2));
      // Add a leading slash for non-Windows platforms
      const projectPath =
        process.platform === "win32" ? joinedPath : "/" + joinedPath;
      await deleteLevel(projectPath, testsuiteLevel);
    }
  );
  context.subscriptions.push(deleteTestsuiteCommand);

  // Command: vectorcastTestExplorer.deleteCompiler ////////////////////////////////////////////////////////
  let deleteCompilerCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.deleteCompiler",
    async (node: any) => {
      const compiler = node.id;
      const projectPath = path.dirname(compiler);
      const compilerLevel = path.basename(compiler);
      await deleteLevel(projectPath, compilerLevel);
    }
  );
  context.subscriptions.push(deleteCompilerCommand);

  // Command: vectorcastTestExplorer.deleteEnviroFromProject  ////////////////////////////////////////////////////////
  let deleteEnviroFromProject = vscode.commands.registerCommand(
    "vectorcastTestExplorer.deleteEnviroFromProject",
    async (enviroNode: any) => {
      const enviroPath = enviroNode.id.split("vcast:")[1];
      const enviroName = path.basename(enviroPath);
      const enviroData: environmentNodeDataType = getEnviroNodeData(enviroPath);
      // always ask for confirmation before deleting an environment
      const message =
        "Environment: " +
        enviroName +
        " will be deleted from the project, and this action cannot be undone.";
      vscode.window
        .showInformationMessage(message, "Delete", "Cancel")
        .then(async (answer) => {
          if (answer === "Delete") {
            // Delete the env completely from the project
            await deleteEnvironmentFromProject(
              enviroData.projectPath,
              enviroName
            );
          }
        });
    }
  );
  context.subscriptions.push(deleteEnviroFromProject);

  // Command: vectorcastTestExplorer.removeTestsuite  ////////////////////////////////////////////////////////
  let removeTestsuite = vscode.commands.registerCommand(
    "vectorcastTestExplorer.removeTestsuite",
    async (enviroNode: any) => {
      // this returns the full path to the environment directory
      let enviroPath = getEnviroPathFromID(enviroNode.id);
      // In case the env is not built, it will be not present in the cache
      if (!enviroPath) {
        // So we check if it is present in the unbuilt list
        // If so, we take the id and split it after "vcast:" to get the path
        // In case that is not possible, we throw an error message
        if (vcastUnbuiltEnviroList.includes(enviroNode.id)) {
          const parts = enviroNode.id.split(":");
          enviroPath = parts.slice(1).join(":");
        } else {
          vscode.window.showErrorMessage(
            `Unable to determine environment path from node: ${enviroNode.id}`
          );
          return;
        }
      }
      await removeTestsuiteFromProject(enviroPath, enviroNode.id);
    }
  );
  context.subscriptions.push(removeTestsuite);

  // Command: vectorcastTestExplorer.deleteEnviro  ////////////////////////////////////////////////////////
  let deleteEnviro = vscode.commands.registerCommand(
    "vectorcastTestExplorer.deleteEnviro",
    (enviroNode: any) => {
      // this returns the full path to the environment directory
      const enviroPath = getEnviroPathFromID(enviroNode.id);

      // always ask for confirmation before deleting an environment
      const message =
        "Environment: " +
        enviroPath +
        " will be deleted, and this action cannot be undone.";
      vscode.window
        .showInformationMessage(message, "Delete", "Cancel")
        .then((answer) => {
          if (answer === "Delete") {
            // execute a clicast call to delete the test
            deleteEnvironment(enviroPath, enviroNode.id);
          }
        });
    }
  );
  context.subscriptions.push(deleteEnviro);

  // Command: vectorcastTestExplorer.cleanEnviro  ////////////////////////////////////////////////////////
  let cleanEnviro = vscode.commands.registerCommand(
    "vectorcastTestExplorer.cleanEnviro",
    (enviroNode: any) => {
      // this returns the full path to the environment directory
      const enviroPath = getEnviroPathFromID(enviroNode.id);
      const enviroData: environmentNodeDataType = getEnviroNodeData(enviroPath);
      const displayName = enviroData.displayName;
      const projectPath = enviroData.projectPath;

      // always ask for confirmation before deleting an environment
      const message =
        "Environment: " +
        enviroPath +
        " will be cleaned, and this action cannot be undone.";
      vscode.window
        .showInformationMessage(message, "Clean Environment", "Cancel")
        .then(async (answer) => {
          if (answer === "Clean Environment") {
            // execute a manage call to clean the env
            await cleanProjectEnvironment(
              enviroPath,
              enviroNode.id,
              projectPath,
              displayName
            );
          }
        });
    }
  );
  context.subscriptions.push(cleanEnviro);

  // Command: vectorcastTestExplorer.setDefaultConfigFile////////////////////////////////////////////////////////
  let selectDefaultConfigFile = vscode.commands.registerCommand(
    "vectorcastTestExplorer.setDefaultConfigFile",
    (fileURI: any) => {
      // we will only get here if the user has selected a CCAST_.CFG file
      // all we do is replace the current value of the configurationLocation option
      // no validity checking is needed.
      if (fileURI) {
        const settings = vscode.workspace.getConfiguration(
          "vectorcastTestExplorer"
        );
        settings.update(
          "configurationLocation",
          fileURI.fsPath,
          vscode.ConfigurationTarget.Workspace
        );
      }
    }
  );
  context.subscriptions.push(selectDefaultConfigFile);

  // This command appears in the context menu of the vscode gutter (same as Add Breakpoint) and
  // generates the MCDC report.
  let getMCDCReportCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.viewMCDCReport",
    async (args) => {
      const activeEditor = vscode.window.activeTextEditor;
      let fileFromUri = forceLowerCaseDriveLetter(args.uri.fsPath);

      if (activeEditor || fileFromUri) {
        // Get the file name and remove the extension --> For the UNIT parameter.
        // Prioritize activeEditor for user convenience—it reflects the file in focus.
        // Fallback to fileFromUri ensures the command works
        // (if the focus is on no file --> activeEditor undefined --> command wont work)
        // But we still can get the file üath from where it s called via the uri
        const filePath = activeEditor
          ? activeEditor.document.uri.fsPath
          : fileFromUri;
        const enviroPath = getEnvPathForFilePath(filePath);
        const fileName = path.parse(filePath).name;
        if (enviroPath) {
          viewMCDCReport(enviroPath, fileName, args.lineNumber);
        } else {
          vscode.window.showErrorMessage(
            `Did not find environment name ${enviroPath} or path for file: ${filePath}`
          );
        }
      }
    }
  );
  context.subscriptions.push(getMCDCReportCommand);

  // Command: vectorcastTestExplorer.openSourceFileFromTestpaneCommand
  let openSourceFileFromTestpaneCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.openSourceFileFromTestpaneCommand",
    async (args: any) => {
      if (!args) return;
      const testNode: testNodeType = getTestNode(args.id);
      if (!testNode) {
        vscode.window.showErrorMessage(
          `Unable to open Source File for Node: ${args.id}`
        );
        return;
      }

      const envData = await getEnvironmentData(testNode.enviroPath);
      if (!envData?.unitData) {
        vscode.window.showErrorMessage(
          `Could not find environment data for: ${testNode.enviroPath}`
        );
        return;
      }

      const located = resolveSourceLocation(
        envData,
        testNode.unitName,
        testNode.functionName ?? null
      );
      if (!located) return;

      const document = await vscode.workspace.openTextDocument(located.uri);
      const position = new vscode.Position(
        Math.max(0, located.lineNumber - 1),
        0
      );
      const selection = new vscode.Range(position, position);
      await vscode.window.showTextDocument(document, {
        preview: false,
        preserveFocus: false,
        selection,
      });
    }
  );
  context.subscriptions.push(openSourceFileFromTestpaneCommand);

  let showRequirementsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.showRequirements",
    async (args: any) => {
      if (!args) return;
      const testNode: testNodeType = getTestNode(args.id);
      const enviroPath = testNode?.enviroPath;
      if (!enviroPath) return;

      let bundle: RGWBundle | null;
      try {
        bundle = readRGWBundle(enviroPath);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to load requirements: ${err}`);
        return;
      }

      if (!bundle) {
        vscode.window.showErrorMessage(
          "No requirements gateway found. Generate requirements first."
        );
        return;
      }

      const loaded: RGWBundle = bundle;

      // Best-effort: pull units + their functions from the env so the
      // traceability fields render as dropdowns. If the env can't be queried
      // (unbuilt / data server down), fall back to free-text inputs.
      let unitsToFunctions: Record<string, string[]> | null = null;
      try {
        const envData = await getEnvironmentData(enviroPath);
        const testData = envData?.testData;
        if (Array.isArray(testData)) {
          unitsToFunctions = {};
          for (const unit of testData) {
            // Skip synthetic test-pane nodes ("Compound Tests",
            // "Initialization Tests", etc.) — they have no source path.
            if (!unit?.name || !unit.path) continue;
            const fns: string[] = [];
            if (Array.isArray(unit.functions)) {
              for (const f of unit.functions) {
                if (f?.name) fns.push(f.name);
              }
            }
            unitsToFunctions[unit.name] = fns;
          }
        }
      } catch {
        // ignore; webview will fall back to free-text inputs
      }

      const webviewBaseDir = resolveWebviewBase(
        context,
        "requirements",
        "webviews"
      );
      const panel = vscode.window.createWebviewPanel(
        "requirementsReport",
        "Requirements Report",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          enableFindWidget: true, // Ctrl+F text-find inside the webview
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.file(webviewBaseDir)],
        }
      );
      // Drives the split-button UI and gates the flag in the handler below.
      const onlyUntracedSupported = await panreqSupportsOnlyUntraced();

      const nonce = getNonce();
      panel.webview.html = generateRequirementsHtml(
        panel.webview,
        webviewBaseDir,
        nonce,
        loaded,
        unitsToFunctions,
        onlyUntracedSupported
      );

      let currentBundle: RGWBundle = loaded;

      // Save / infer can complete after the user closes the panel — let the
      // underlying operation finish but skip the postMessage so we don't trip
      // "Webview is disposed".
      let disposed = false;
      panel.onDidDispose(
        () => {
          disposed = true;
        },
        null,
        context.subscriptions
      );
      const post = (msg: ToWebview) => {
        if (disposed) return;
        panel.webview.postMessage(msg);
      };

      panel.webview.onDidReceiveMessage(
        async (msg: FromWebview) => {
          if (msg?.type === "save") {
            try {
              // Single source of truth for the edit policy lives in
              // applyEditPolicy: it redacts any field the loaded bundle
              // reports as locked, so a tampered webview can't sneak edits
              // through.
              const safeUpdates = applyEditPolicy(currentBundle, msg.updates);
              const newMtimes = await writeRGWBundle(
                enviroPath,
                currentBundle.gatewayPath,
                safeUpdates,
                msg.expectedMtimes
              );
              currentBundle = {
                ...currentBundle,
                requirements: safeUpdates.requirements,
                traceability: safeUpdates.traceability,
                mtimes: newMtimes,
              };
              post({
                type: "saved",
                mtimes: newMtimes,
                requirements: safeUpdates.requirements,
                traceability: safeUpdates.traceability,
              });
            } catch (err) {
              const message =
                err instanceof RGWStaleWriteError
                  ? `${err.message} Reopen the requirements view to reload and re-apply your edits.`
                  : `Failed to save requirements: ${err}`;
              vscode.window.showErrorMessage(message);
              post({ type: "save-failed", message });
            }
          } else if (msg?.type === "infer-traceability") {
            try {
              const refreshed = await inferTraceability(
                enviroPath,
                currentBundle.gatewayPath,
                { onlyUntraced: msg.onlyUntraced && onlyUntracedSupported }
              );
              if (!refreshed) {
                // Cancelled by user — re-enable the webview buttons silently.
                post({ type: "infer-cancelled" });
                return;
              }
              currentBundle = refreshed;
              post({
                type: "inferred",
                mtimes: refreshed.mtimes,
                requirements: refreshed.requirements,
                traceability: refreshed.traceability,
              });
            } catch (err) {
              const message = `Failed to infer traceability: ${err}`;
              vscode.window.showErrorMessage(message);
              post({ type: "infer-failed", message });
            }
          } else if (msg?.type === "open-source") {
            await openSourceForTrace(
              enviroPath,
              msg.unit,
              msg.function,
              panel.viewColumn
            );
          }
        },
        undefined,
        context.subscriptions
      );
    }
  );
  context.subscriptions.push(showRequirementsCommand);

  let removeRequirementsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.removeRequirements",
    async (args: any) => {
      if (args) {
        const testNode: testNodeType = getTestNode(args.id);
        const enviroPath = testNode?.enviroPath;
        if (!enviroPath) return;

        const message =
          "This will delete the requirements gateway and clear VCAST_REPOSITORY from CCAST_.CFG. This action cannot be undone.";
        const choice = await vscode.window.showWarningMessage(
          message,
          "Remove",
          "Cancel"
        );

        if (choice === "Remove") {
          const parentDir = path.dirname(enviroPath);
          const enviroNameWithoutExt = path
            .basename(enviroPath)
            .replace(/\.env$/, "");
          const envReqsFolderPath = path.join(
            parentDir,
            `reqs-${enviroNameWithoutExt}`
          );

          // Delete only the requirements_gateway data dir, not the gateway
          // root, which VCAST_REPOSITORY may point anywhere.
          const gatewayInnerDir =
            resolveRequirementsGatewayInnerDir(enviroPath);
          if (gatewayInnerDir) {
            try {
              fs.rmSync(gatewayInnerDir, { recursive: true, force: true });
            } catch (err) {
              vscode.window.showErrorMessage(
                `Failed to remove requirements gateway: ${err}`
              );
            }
          }

          clearVcastRepositoryInConfig(enviroPath);

          const tstPath = path.join(parentDir, "reqs2tests.tst");
          if (fs.existsSync(tstPath)) {
            try {
              fs.unlinkSync(tstPath);
            } catch (err) {
              vscode.window.showErrorMessage(
                `Failed to remove ${tstPath}: ${err}`
              );
            }
          }

          if (
            fs.existsSync(envReqsFolderPath) &&
            fs.readdirSync(envReqsFolderPath).length === 0
          ) {
            try {
              fs.rmdirSync(envReqsFolderPath);
            } catch {
              // best-effort
            }
          }

          await refreshAllExtensionData();
          updateRequirementsAvailability(enviroPath);
          vscode.window.showInformationMessage(
            "Requirements removed successfully"
          );
        }
      }
    }
  );
  context.subscriptions.push(removeRequirementsCommand);

  let migrateLegacyRequirementsCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.migrateLegacyRequirements",
    async (args: any) => {
      // From the env right-click menu we migrate just that env; from the
      // command palette (no args) we run the workspace-wide flow.
      if (args?.id) {
        const testNode: testNodeType = getTestNode(args.id);
        const enviroPath = testNode?.enviroPath;
        if (!enviroPath) return;
        await migrateLegacyRequirementsForEnv(enviroPath);
      } else {
        await runLegacyMigrationCommand(context);
      }
    }
  );
  context.subscriptions.push(migrateLegacyRequirementsCommand);

  vscode.workspace.onDidChangeWorkspaceFolders(
    async (e) => {
      await refreshAllExtensionData();
      setGlobalProjectIsOpenedChecker();
      setGlobalCompilerAndTestsuites();
      // Refresh requirements availability for all environments
      if (workspace.workspaceFolders && workspace.workspaceFolders.length > 0) {
        const envPaths = await getEnvironmentListIncludingUnbuilt(
          workspace.workspaceFolders[0].uri.fsPath
        );
        for (const envPath of envPaths) {
          updateRequirementsAvailability(envPath);
        }
      }
    },
    null,
    context.subscriptions
  );

  vscode.window.onDidChangeActiveTextEditor(
    // this function gets called when the user changes the
    // active editor, including when closing an editor
    // in which case the "editor" parameter will be undefined
    async (editor) => {
      if (editor) {
        await updateDisplayedCoverage();
        updateTestDecorator();
      } else {
        hideStatusBarCoverage();
      }
    },
    null,
    context.subscriptions
  );

  // This works nicely to remove the decorations when
  // the user has auto-save ON, but not if they don't.
  // There is another event called onDidChangeTextDocument
  // that gets invoked when the user edits, but to determine
  // if the file has changed we compute the checksum of the file
  // and since the file on disk has not changed, we would keep the
  // decorations anyway.
  vscode.workspace.onDidSaveTextDocument(
    async (editor) => {
      // changing the file will invalidate the
      // coverage and editor annotations
      if (editor) {
        // Check if file ends with .tst and has "build" in its path
        // We want to load the test script automatically when the user saves
        const filePath = editor.uri.fsPath;
        if (filePath.endsWith(".tst") && alreadyConfigured) {
          await loadTestScript();
        }
        await updateCodedTestCases(editor);
        await updateCOVdecorations();
        updateTestDecorator();
      }
    },
    null,
    context.subscriptions
  );
}

async function installPreActivationEventHandlers(
  context: vscode.ExtensionContext
) {
  // this is separate from configureExtension() because we want to
  // handle some actions before the configuration of the extension is complete
  // Specifically for the case where the user does a create environment action
  // and vcast installation is invalid.

  // Note: there is no existing API to do variable substitution for configuration
  // values that could contain things like ${workspaceFolder} so we don't provide support.
  // Here is a starting point for research: https://github.com/microsoft/vscode/issues/46471

  vscode.workspace.onDidChangeConfiguration(async (event) => {
    // post configuration, we handle changes to all options ...
    if (alreadyConfigured) {
      // This function gets triggered when any option at any level (user, workspace, etc.)
      // gets changed.  The event parameter does not indicate what level has been
      // edited but you can use the

      if (
        event.affectsConfiguration("vectorcastTestExplorer.decorateExplorer")
      ) {
        updateExploreDecorations();
      } else if (
        event.affectsConfiguration("vectorcastTestExplorer.verboseLogging")
      ) {
        adjustVerboseSetting();
      } else if (
        event.affectsConfiguration(
          "vectorcastTestExplorer.configurationLocation"
        )
      ) {
        updateConfigurationOption();
      } else if (
        event.affectsConfiguration("vectorcastTestExplorer.unitTestLocation")
      ) {
        updateUnitTestLocationOption();
      } else if (
        event.affectsConfiguration("vectorcastTestExplorer.useDataServer")
      ) {
        initializeServerState();
      } else if (
        event.affectsConfiguration("vectorcastTestExplorer.build.coverageKind")
      ) {
        await updateCoverageAndRebuildEnv();
      } else if (
        event.affectsConfiguration(
          "vectorcastTestExplorer.vectorcastInstallationLocation"
        )
      ) {
        // if the user changes the path to vcast, we need to reset the values
        // for clicast and vpython path etc.
        if (await checkIfInstallationIsOK()) {
          await initializeServerState();
          await refreshAllExtensionData();
        } else {
          // this will remove the status bar icon and shutdown the server
          // it needs to be in both sides of the if because we want it to run
          // before the "refreshAllExtensionData" call in the TRUE case.
          await initializeServerState();
        }
      } else if (
        event.affectsConfiguration(
          "vectorcastTestExplorer.reqs2x.installationLocation"
        ) ||
        event.affectsConfiguration(
          "vectorcastTestExplorer.reqs2x.enableReqs2xFeature"
        )
      ) {
        // If the user changes the path to reqs2x or tries to enable or disable the feature, we re-initialize
        initializeReqs2X(context);
      }
    }
    // pre-configuration, we only handle changes to the vcast installation location
    else if (
      event.affectsConfiguration(
        "vectorcastTestExplorer.vectorcastInstallationLocation"
      )
    ) {
      // this call will check if the new value is valid,
      // and if so, perform extension activation
      await checkPrerequisites(context);
      await initializeServerState();
    }
  });

  // Command: vectorcastTestExplorer.newEnviroVCAST ////////////////////////////////////////////////////////
  let newEnviroVCASTCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.newEnviroVCAST",
    async (args: Uri, argList: Uri[]) => {
      // contains a check for already configured, so no work will be done in that case
      await checkPrerequisites(context);
      if (alreadyConfigured) {
        // arg is the actual item that the right click happened on, argList is the list
        // of all items if this is a multi-select.  Since argList is always valid, even for a single
        // selection, we just use this here.
        if (argList) {
          await newEnvironment(argList);
        }
      }
    }
  );
  context.subscriptions.push(newEnviroVCASTCommand);

  let defaultVCShellCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.defaultVCShell",
    async (fileURI: Uri) => {
      await checkPrerequisites(context);

      if (!alreadyConfigured) {
        return;
      }

      if (fileURI) {
        const filePath = fileURI.fsPath;
        const settings = vscode.workspace.getConfiguration(
          "vectorcastTestExplorer"
        );

        const defaultConfigurationPath = settings.get(
          "configurationLocation",
          undefined
        );

        // First update vcshell db setting
        await updateVCShellDatabase(filePath);

        // In case we have a default cfg, ask the user if he wants to update the cfg with the current default vcshell db
        if (defaultConfigurationPath) {
          const choice = await vscode.window.showWarningMessage(
            `You have set a default CFG at ${defaultConfigurationPath}. Do you want to include your database in that configuration?`,
            { modal: false },
            "Yes",
            "No"
          );

          if (choice === "Yes") {
            const normalizedCFGPath = normalizePath(
              path.dirname(defaultConfigurationPath)
            );
            await updateCFGWithVCShellDatabase(filePath, normalizedCFGPath);
          }
        }
      }
    }
  );

  context.subscriptions.push(defaultVCShellCommand);

  const importEnviroToProject = vscode.commands.registerCommand(
    "vectorcastTestExplorer.importEnviroToProject",
    async (_args: vscode.Uri, argList: vscode.Uri[]) => {
      const manageWebviewSrcDir = resolveWebviewBase(
        context,
        "manage",
        "webviews"
      );
      const panel = vscode.window.createWebviewPanel(
        "importEnviroToProject",
        "Import Environment to Project",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.file(manageWebviewSrcDir)],
        }
      );

      panel.webview.html = await getImportEnvWebviewContent(
        context,
        panel,
        argList
      );

      // --- Dispatch Table ---
      const dispatch: Record<string, (msg?: any) => Promise<void> | void> = {
        importEnvFile: handleImportEnvFile,
        submit: handleSubmit,
        cancel: () => panel.dispose(),
      };

      panel.webview.onDidReceiveMessage(
        (message) => dispatch[message.command]?.(message),
        undefined,
        context.subscriptions
      );

      // --- Handlers ---
      async function handleImportEnvFile(): Promise<void> {
        const files = await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { "Env Files": ["env"] },
          openLabel: "Select Env File",
        });

        if (files?.length) {
          panel.webview.postMessage({
            command: "envFileSelected",
            envFile: files[0].fsPath,
          });
        }
      }

      async function handleSubmit(message: {
        projectPath?: string;
        envFiles?: string[];
        testsuiteArgs?: string[];
      }): Promise<void> {
        const { projectPath, envFiles = [], testsuiteArgs = [] } = message;

        if (!projectPath || !envFiles.length || !testsuiteArgs.length) {
          vscode.window.showErrorMessage(
            "Project Path, Env Files, and Testsuite are required."
          );
          return;
        }

        for (const file of envFiles) {
          if (!fs.existsSync(file)) {
            vscode.window.showInformationMessage(
              `Environment file ${file} does not exist.`
            );
            return;
          }

          for (const level of testsuiteArgs) {
            vectorMessage(`Env File: ${file}`);
            await importEnvToTestsuite(projectPath, level, file);
          }
        }

        panel.dispose();
      }
    }
  );

  context.subscriptions.push(importEnviroToProject);

  // Command: vectorcastTestExplorer.addEnviroToProject
  const addEnviroToProject = vscode.commands.registerCommand(
    "vectorcastTestExplorer.addEnviroToProject",
    async (_projectNode: any) => {
      const manageWebviewSrcDir = resolveWebviewBase(
        context,
        "manage",
        "webviews"
      );
      const panel = vscode.window.createWebviewPanel(
        "addEnviroToProject",
        "Add Environment To Project",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.file(manageWebviewSrcDir)],
        }
      );

      panel.webview.html = await getImportEnvWebviewContent(context, panel, []);

      // --- Command dispatch table ---
      const dispatch: Record<string, (msg?: any) => Promise<void> | void> = {
        importEnvFile: handleImportEnvFile,
        submit: handleSubmit,
        cancel: () => panel.dispose(),
      };

      // --- Message handler ---
      panel.webview.onDidReceiveMessage(
        (message) => dispatch[message.command]?.(message),
        undefined,
        context.subscriptions
      );

      // --- Handlers ---
      async function handleImportEnvFile() {
        const [uri] =
          (await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { "Environment Files": ["env"] },
            openLabel: "Select Environment File",
          })) ?? [];

        if (uri) {
          panel.webview.postMessage({
            command: "envFileSelected",
            envFile: uri.fsPath,
          });
        }
      }

      async function handleSubmit(message: {
        projectPath?: string;
        envFiles?: string[];
        testsuiteArgs?: string[];
      }): Promise<void> {
        const { projectPath, envFiles = [], testsuiteArgs = [] } = message;

        if (!projectPath || !envFiles.length || !testsuiteArgs.length) {
          vscode.window.showErrorMessage(
            "Project Path, Env Files, and Testsuite are required."
          );
          return;
        }

        if (envFiles.length > 1) {
          vscode.window.showInformationMessage(
            "Multiple Env Files selected. Only the first one will be used."
          );
        }

        const envFile = envFiles[0];

        // this should not happen as we click on the envs, but in case the user manually changes something
        if (!fs.existsSync(envFile)) {
          vscode.window.showInformationMessage(
            `Environment file ${envFile} does not exist.`
          );
          return;
        }

        for (const [index, level] of testsuiteArgs.entries()) {
          vectorMessage(`Env File: ${envFile}`);

          if (index === 0) {
            await importEnvToTestsuite(projectPath, level, envFile);
          } else {
            const envName = path.basename(envFile, ".env");
            await addEnvToTestsuite(projectPath, level, envName);
          }
        }

        panel.dispose();
      }
    }
  );

  context.subscriptions.push(addEnviroToProject);

  /**
   * Returns the HTML content for the webview.
   * It builds a form that allows the user to select:
   *   - a Project Path (populated from a global combobox map),
   *   - Env Files (with pre-filled values from the argList), and
   *   - a set of Compiler/Testsuite rows.
   *
   * The label "Source Files" is replaced with "Env Files" in this version.
   */
  async function getImportEnvWebviewContent(
    context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
    argList: vscode.Uri[]
  ): Promise<string> {
    const base = resolveWebviewBase(context, "manage", "webviews");

    // on-disk resource locations
    const cssOnDisk = vscode.Uri.file(path.join(base, "css", "importEnv.css"));
    const scriptOnDisk = vscode.Uri.file(
      path.join(base, "webviewScripts", "importEnv.js")
    );
    const htmlPath = path.join(base, "html", "importEnv.html");

    // convert to webview URIs
    const cssUri = panel.webview.asWebviewUri(cssOnDisk);
    const scriptUri = panel.webview.asWebviewUri(scriptOnDisk);

    // prepare dynamic data
    const projectData = JSON.stringify(
      Array.from(globalProjectWebviewComboboxItems.entries())
    );
    const initialEnvFile = JSON.stringify(argList[0]?.fsPath ?? "");

    // load the template
    let html = fs.readFileSync(htmlPath, "utf8");

    // inject CSP + nonce
    const nonce = getNonce();
    const cspMeta = `
      <meta http-equiv="Content-Security-Policy"
            content="default-src 'none';
                     style-src ${panel.webview.cspSource};
                     script-src 'nonce-${nonce}' ${panel.webview.cspSource};">
    `;
    html = html.replace(/<head>/, `<head>${cspMeta}`);

    // inject URIs + data
    html = html
      .replace(/{{\s*cssUri\s*}}/g, cssUri.toString())
      .replace(
        /<script src="{{\s*scriptUri\s*}}"><\/script>/,
        `<script nonce="${nonce}" src="${scriptUri}"></script>`
      )
      .replace(
        /<\/head>/,
        `  <script nonce="${nonce}">
         window.projectData = ${projectData};
         window.initialEnvFile = ${initialEnvFile};
        </script>\n</head>`
      );

    return html;
  }

  const newEnviroInProjectVCASTCommand = vscode.commands.registerCommand(
    "vectorcastTestExplorer.newEnviroInProjectVCAST",
    async (_args: vscode.Uri, argList: vscode.Uri[]) => {
      // Creating new Ada environments in a project is disabled for now. Block
      // before opening the webview so the user is not asked to fill it out.
      if (argList?.some((uri) => isAdaSourceFile(uri.fsPath))) {
        notifyAdaFeatureDisabled("Adding an Ada environment to a project");
        return;
      }
      const manageWebviewSrcDir = resolveWebviewBase(
        context,
        "manage",
        "webviews"
      );
      const panel = vscode.window.createWebviewPanel(
        "newEnvProject",
        "Create Environment in Project",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.file(manageWebviewSrcDir)],
        }
      );

      panel.webview.html = await getNewEnvWebviewContent(
        context,
        panel,
        argList
      );

      // --- Dispatch Table ---
      const dispatch: Record<string, (msg?: any) => Promise<void> | void> = {
        submit: handleSubmit,
        cancel: () => panel.dispose(),
      };

      panel.webview.onDidReceiveMessage(
        (message) => dispatch[message.command]?.(message),
        undefined,
        context.subscriptions
      );

      // --- Handlers ---
      async function handleSubmit(message: {
        projectPath?: string;
        sourceFiles?: string[];
        testsuiteArgs?: string[];
      }): Promise<void> {
        const { projectPath, sourceFiles = [], testsuiteArgs = [] } = message;

        if (!projectPath || !testsuiteArgs.length) {
          vscode.window.showErrorMessage(
            "Compiler Name and Testsuite Name are required."
          );
          return;
        }

        // Validate file existence
        for (const file of sourceFiles) {
          if (!fs.existsSync(file)) {
            vscode.window.showInformationMessage(
              `Source file ${file} does not exist.`
            );
            return;
          }
        }

        const params: ProjectEnvParameters = {
          path: projectPath,
          sourceFiles,
          testsuiteArgs,
        };

        vscode.window.showInformationMessage(
          `Creating environment in ${projectPath} with ${testsuiteArgs.join(
            ", "
          )} and sources ${sourceFiles.join(", ")}`
        );

        await newEnvironment(argList, params);
        panel.dispose();
      }
    }
  );

  context.subscriptions.push(newEnviroInProjectVCASTCommand);

  async function getNewEnvWebviewContent(
    context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
    argList: vscode.Uri[]
  ): Promise<string> {
    const base = resolveWebviewBase(context, "manage", "webviews");
    const cssOnDisk = vscode.Uri.file(
      path.join(base, "css", "newEnvProject.css")
    );
    const scriptOnDisk = vscode.Uri.file(
      path.join(base, "webviewScripts", "newEnvProject.js")
    );
    const htmlPath = path.join(base, "html", "newEnvProject.html");

    const cssUri = panel.webview.asWebviewUri(cssOnDisk);
    const scriptUri = panel.webview.asWebviewUri(scriptOnDisk);

    const projectData = JSON.stringify(
      Array.from(globalProjectWebviewComboboxItems.entries())
    );
    const initialSourceFiles = JSON.stringify(argList.map((u) => u.fsPath));

    let html = fs.readFileSync(htmlPath, "utf8");

    const nonce = getNonce();
    const csp = `
      <meta http-equiv="Content-Security-Policy"
            content="default-src 'none';
                     style-src ${panel.webview.cspSource};
                     script-src 'nonce-${nonce}' ${panel.webview.cspSource};">
    `;
    html = html.replace(/<head>/, `<head>${csp}`);

    html = html
      .replace(/{{\s*cssUri\s*}}/g, cssUri.toString())
      .replace(
        /<script src="{{\s*scriptUri\s*}}"><\/script>/,
        `<script nonce="${nonce}" src="${scriptUri}"></script>`
      )
      .replace(
        /<\/head>/,
        `<script nonce="${nonce}">
           window.projectData = ${projectData};
           window.initialSourceFiles = ${initialSourceFiles};
         </script>\n</head>`
      );

    return html;
  }

  const createNewProjectCmd = vscode.commands.registerCommand(
    "vectorcastTestExplorer.createNewProject",
    async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders?.length) {
        vscode.window.showErrorMessage("Open a folder first.");
        return;
      }
      const workspaceRoot = workspaceFolders[0].uri.fsPath;

      const baseDir = resolveWebviewBase(context, "manage", "webviews");
      const panel = vscode.window.createWebviewPanel(
        "newProject",
        "Create New Project",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.file(baseDir)],
        }
      );

      panel.webview.html = await getNewProjectWebviewContent(
        context,
        panel,
        workspaceRoot
      );

      panel.webview.onDidReceiveMessage(
        async (msg) => {
          switch (msg.command) {
            case "browseForDir": {
              const folderUris = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: "Select Target Folder",
              });
              if (folderUris?.length) {
                panel.webview.postMessage({
                  command: "setTargetDir",
                  targetDir: folderUris[0].fsPath,
                });
              }
              break;
            }
            case "submit":
              await handleSubmit(msg);
              break;
            case "cancel":
              panel.dispose();
              break;
          }
        },
        undefined,
        context.subscriptions
      );

      async function handleSubmit(message: {
        projectName?: string;
        compilerName?: string;
        targetDir?: string;
        useDefaultCFG?: boolean;
        enableCodedTests?: boolean;
        defaultCFG?: boolean;
        useDefaultDB?: boolean;
      }) {
        const {
          projectName,
          compilerName,
          targetDir,
          useDefaultCFG,
          enableCodedTests,
          defaultCFG,
          useDefaultDB,
        } = message;

        if (!projectName) {
          vscode.window.showErrorMessage("Project Name is required.");
          return;
        }

        let compiler: string | undefined;

        if (useDefaultCFG) {
          const settings = vscode.workspace.getConfiguration(
            "vectorcastTestExplorer"
          );
          const defaultCFGPath = settings.get<string>("configurationLocation");

          if (!defaultCFGPath) {
            vscode.window.showErrorMessage("No default CFG is defined.");
            return;
          }
          compiler = defaultCFGPath;
        } else {
          if (!compilerName) {
            vscode.window.showErrorMessage("Compiler selection is required.");
            return;
          }
          compiler = compilerTagList[compilerName];
          if (!compiler) {
            vscode.window.showErrorMessage(
              `No compiler tag found for "${compilerName}".`
            );
            return;
          }
        }

        const configurationOptions: ConfigurationOptions = {
          enableCodedTests: !!enableCodedTests,
          defaultCFG: !!defaultCFG,
          useDefaultDB: !!useDefaultDB,
        };

        const base = targetDir ?? workspaceRoot;
        const projectPath = path.join(base, projectName);

        await createNewProject(
          projectPath,
          compiler,
          !!useDefaultCFG,
          configurationOptions
        );

        panel.dispose();
      }
    }
  );

  context.subscriptions.push(createNewProjectCmd);

  // Helper function for Webview Content
  async function getNewProjectWebviewContent(
    context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
    workspaceRoot: string
  ): Promise<string> {
    const base = resolveWebviewBase(context, "manage", "webviews");
    const cssOnDisk = vscode.Uri.file(path.join(base, "css", "newProject.css"));
    const scriptOnDisk = vscode.Uri.file(
      path.join(base, "webviewScripts", "newProject.js")
    );
    const htmlPath = path.join(base, "html", "newProject.html");

    const cssUri = panel.webview.asWebviewUri(cssOnDisk);
    const scriptUri = panel.webview.asWebviewUri(scriptOnDisk);

    const compilersJson = JSON.stringify(Object.keys(compilerTagList));
    const workspaceJson = JSON.stringify(workspaceRoot);

    const settings = vscode.workspace.getConfiguration(
      "vectorcastTestExplorer"
    );
    const defaultCFG = settings.get<string>("configurationLocation") ?? "";

    // Check default DB setting and if file exists
    const dbSettingPath = settings.get<string>("databaseLocation");
    let validDBPath = "";
    if (dbSettingPath && fs.existsSync(dbSettingPath)) {
      validDBPath = dbSettingPath;
    }

    let html = fs.readFileSync(htmlPath, "utf8");
    const nonce = getNonce();

    html = html.replace(
      /<head>/,
      `<head>
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${
        panel.webview.cspSource
      }; script-src 'nonce-${nonce}' ${panel.webview.cspSource};">
      <script nonce="${nonce}">
        window.compilerData = ${compilersJson};
        window.defaultDir   = ${workspaceJson};
        window.defaultCFG   = ${JSON.stringify(defaultCFG)};
        window.defaultDB    = ${JSON.stringify(validDBPath)};
      </script>`
    );
    html = html.replace("{{ cssUri }}", cssUri.toString());
    html = html.replace(
      "{{ scriptUri }}",
      `<script nonce="${nonce}" src="${scriptUri}"></script>`
    );

    return html;
  }

  const createNewCFGCmd = vscode.commands.registerCommand(
    "vectorcastTestExplorer.createNewCFG",
    async (args?: any) => {
      // Project context: command was triggered from a project node
      const projectPath: string | undefined = args?.id;

      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders?.length) {
        vscode.window.showErrorMessage("Open a folder first.");
        return;
      }
      const workspaceRoot = workspaceFolders[0].uri.fsPath;

      // Create webview panel
      const baseDir = resolveWebviewBase(context, "manage", "webviews");
      const panel = vscode.window.createWebviewPanel(
        "newCFG",
        projectPath ? "Create Compiler in Project" : "Create New CFG File",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.file(baseDir)],
        }
      );

      panel.webview.html = await getNewCFGWebviewContent(
        context,
        panel,
        compilerTagList,
        workspaceRoot
      );

      panel.webview.onDidReceiveMessage(
        async (msg) => {
          switch (msg.command) {
            case "browseForDir": {
              const selected = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: "Select Output Folder",
                defaultUri: vscode.Uri.file(workspaceRoot),
              });
              if (selected?.length) {
                panel.webview.postMessage({
                  command: "setTargetDir",
                  targetDir: selected[0].fsPath,
                });
              }
              break;
            }
            case "submit": {
              const compilerName: string | undefined = msg.compilerName?.trim();
              const targetDir: string = msg.targetDir || workspaceRoot;
              const enableCodedTests: boolean = !!msg.enableCodedTests;
              const defaultCFG: boolean = !!msg.defaultCFG;
              const useDefaultDB: boolean = !!msg.useDefaultDB;

              if (!compilerName) {
                vscode.window.showErrorMessage(
                  "Compiler selection is required."
                );
                return;
              }

              const compilerTag = compilerTagList[compilerName];
              if (!compilerTag) {
                vscode.window.showErrorMessage(
                  `No compiler tag found for "${compilerName}".`
                );
                return;
              }

              const configurationOptions: ConfigurationOptions = {
                enableCodedTests,
                defaultCFG,
                useDefaultDB,
              };

              // Always create the CFG file in the user-chosen folder
              const createdCFGPath = await createNewCFGFile(
                targetDir,
                compilerTag,
                configurationOptions
              );

              // If triggered from a project node, also add the compiler to the project
              if (projectPath) {
                if (createdCFGPath) {
                  await addCompilerToProject(projectPath, createdCFGPath);
                } else {
                  vscode.window.showErrorMessage(
                    "CFG creation failed — compiler was not added to the project."
                  );
                }
              }

              panel.dispose();
              break;
            }
            case "cancel": {
              panel.dispose();
              break;
            }
          }
        },
        undefined,
        context.subscriptions
      );
    }
  );

  context.subscriptions.push(createNewCFGCmd);

  async function getNewCFGWebviewContent(
    context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
    compilerTagList: Record<string, string>,
    workspaceRoot: string
  ): Promise<string> {
    const base = resolveWebviewBase(context, "manage", "webviews");
    const cssOnDisk = vscode.Uri.file(path.join(base, "css", "newCFG.css"));
    const scriptOnDisk = vscode.Uri.file(
      path.join(base, "webviewScripts", "newCFG.js")
    );
    const htmlPath = path.join(base, "html", "newCFG.html");

    // Convert to URIs
    const cssUri = panel.webview.asWebviewUri(cssOnDisk);
    const scriptUri = panel.webview.asWebviewUri(scriptOnDisk);

    // JSON list of compilers for autocomplete
    const compilerList = JSON.stringify(Object.keys(compilerTagList ?? {}));

    // Check DB setting
    const settings = vscode.workspace.getConfiguration(
      "vectorcastTestExplorer"
    );
    const dbSettingPath = settings.get<string>("databaseLocation");
    let validDBPath = "";
    if (dbSettingPath && fs.existsSync(dbSettingPath)) {
      validDBPath = dbSettingPath;
    }

    let html = fs.readFileSync(htmlPath, "utf8");
    const nonce = getNonce();

    // Build CSP meta
    const csp = `
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none';
                   style-src ${panel.webview.cspSource};
                   script-src 'nonce-${nonce}' ${panel.webview.cspSource};">
  `;

    // Insert CSP immediately after the opening <head>
    html = html.replace(/<head>/i, `<head>${csp}`);
    html = html.replace(/{{\s*cssUri\s*}}/g, cssUri.toString());
    html = html.replace(
      /<script\s+src="{{\s*scriptUri\s*}}"><\/script>/i,
      `<script nonce="${nonce}" src="${scriptUri}"></script>`
    );

    // Inline script to expose data to the webview client
    const injectedScript = `<script nonce="${nonce}">
    window.compilerData = ${compilerList};
    window.enableCodedTests = ${false};
    window.defaultCFG = ${false};
    window.defaultDB = ${JSON.stringify(validDBPath)};
    window.defaultDir = ${JSON.stringify(workspaceRoot)};
  </script>`;
    html = html.replace(/\{\{\s*compilerDataScript\s*\}\}/g, injectedScript);

    return html;
  }
}

// this method is called when your extension is deactivated
export async function deactivate() {
  await serverProcessController(serverStateType.stopped);
  // delete the server log if it exists
  await deleteServerLog();
  console.log("The VectorCAST Test Explorer has been de-activated");
  return deactivateLanguageServerClient();
}
