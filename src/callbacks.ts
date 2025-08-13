import * as vscode from "vscode";

// some functions that are used across functional areas of the extensions
import {
  errorLevel,
  indentString,
  openMessagePane,
  vectorMessage,
} from "./messagePane";
import { getEnviroPathFromID, removeNodeFromCache } from "./testData";

import {
  removeCBTfilesCacheForEnviro,
  removeNodeFromTestPane,
  updateDataForEnvironment,
  updateTestPane,
  vcastUnbuiltEnviroList,
} from "./testPane";

import { removeFilePattern } from "./utilities";
import { loadTestScriptIntoEnvironment } from "./vcastAdapter";
import { commandStatusType } from "./vcastCommandRunner";
import { removeCoverageDataForEnviro } from "./vcastTestInterface";
import {
  closeConnection,
  globalEnviroDataServerActive,
} from "../src-common/vcastServer";
import { updateDisplayedCoverage } from "./coverage";
import { updateExploreDecorations } from "./fileDecorator";
import { updateTestDecorator } from "./editorDecorator";

const fs = require("fs");
const path = require("path");

/**
 * Callback function when we build a single (Project-) Environment
 * @param enviroPath Path to env
 * @param code Exit code of the process
 */
export async function buildEnvironmentCallback(
  enviroPath: string,
  code: number
) {
  // This function gets called after we build an environment
  // We check the return code, update the test pane, and cleanup on failure

  if (code == 0) {
    await updateDataForEnvironment(enviroPath);
  } else {
    try {
      // remove the environment directory, as well as the .vce file
      vectorMessage("Environment build failed, removing artifacts ...");
      fs.rmSync(enviroPath, { recursive: true, force: true });
      fs.unlinkSync(enviroPath + ".vce");
      // Don't want to remove the .env, because leaving it allows the
      // user to edit and then right click to try a re-build
    } catch {
      // ignore errors
    }
  }
}

/**
 * Callback function when we re-build a single (Project-) Environment
 * @param enviroPath Path to env
 * @param code Exit code of the process
 */
export async function rebuildEnvironmentCallback(
  enviroPath: string,
  code: number
) {
  // This function gets called after the rebuildEnviro command
  // When the rebuild succeeds, we delete the BAK stuff

  if (code == 0) {
    try {
      // remove the BAK directory and .vce file
      vectorMessage("Environment re-build complete, removing artifacts ...");
      fs.rmSync(enviroPath + ".BAK", { recursive: true, force: true });
      fs.unlinkSync(enviroPath + ".BAK.vce");

      // vcast leaves the ENVIRO-NAME.time-tag.tst file so we clean that up
      removeFilePattern(enviroPath, ".*.tst");
    } catch {
      // ignore errors
    }
    await updateDataForEnvironment(enviroPath);
  }
}

/**
 * Callback function when we delete a single Environment
 * @param enviroPath Path to env
 * @param code Exit code of the process
 */
export async function deleteEnvironmentCallback(
  enviroNodeID: string,
  code: number
) {
  // this function gets called after the clicast env delete completes

  // if the delete succeeded then we need to remove the environment from the test pane
  if (code == 0) {
    removeNodeFromTestPane(enviroNodeID);
    removeCBTfilesCacheForEnviro(enviroNodeID);

    let enviroPath = getEnviroPathFromID(enviroNodeID);
    if (!enviroPath) {
      // We check if it is present in the unbuilt list
      // If so, we take the id and split it after "vcast:" to get the path
      // In case that is not possible, we throw an error message
      if (vcastUnbuiltEnviroList.includes(enviroNodeID)) {
        const parts = enviroNodeID.split(":");
        enviroPath = parts.slice(1).join(":");
      } else {
        vscode.window.showErrorMessage(
          `Unable to determine environment path from node: ${enviroNodeID}`
        );
        return;
      }
    }

    removeCoverageDataForEnviro(enviroPath);
    updateDisplayedCoverage();
    updateExploreDecorations();
    updateTestDecorator();
    removeNodeFromCache(enviroNodeID);

    // vcast does not delete the ENVIRO-NAME.* files so we clean those up here
    removeFilePattern(enviroPath, ".*");
  }
}

export async function loadScriptCallBack(
  commandStatus: commandStatusType,
  enviroName: string,
  scriptPath: string
) {
  // This is the callback that should be passed to executeCommandWithProgress() when
  // we are computing basis path or ATG tests, this gets called when the command completes

  if (commandStatus.errorCode == 0) {
    vectorMessage("Loading tests into VectorCAST environment ...");

    // call clicast to load the test script
    await loadTestScriptIntoEnvironment(enviroName, scriptPath);

    const enviroPath = path.join(path.dirname(scriptPath), enviroName);

    vectorMessage(`Deleting script file: ${path.basename(scriptPath)}`);
    await updateTestPane(enviroPath);
    if (globalEnviroDataServerActive) await closeConnection(enviroPath);
    fs.unlinkSync(scriptPath);
  } else {
    vscode.window.showInformationMessage(
      `Error generating tests, see log for details`
    );
    vectorMessage("Error generating tests");
    vectorMessage(commandStatus.stdout, errorLevel.info, indentString);
    openMessagePane();
  }
}
