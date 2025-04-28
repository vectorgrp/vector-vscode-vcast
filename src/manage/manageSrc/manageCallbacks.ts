import * as vscode from "vscode";

// some functions that are used across functional areas of the extensions
import { vectorMessage } from "../../messagePane";
import { getEnviroPathFromID } from "../../testData";

import {
  refreshAllExtensionData,
  removeCBTfilesCacheForEnviro,
  updateDataForEnvironment,
  vcastUnbuiltEnviroList,
} from "../../testPane";

import { removeFilePattern } from "../../utilities";
import { removeCoverageDataForEnviro } from "../../vcastTestInterface";

const fs = require("fs");

/**
 * Callback function when we clean a Project-Environment
 * @param enviroPath Path to env
 * @param code Exit code of the process
 */
export async function cleanEnvironmentCallback(
  enviroNodeID: string,
  code: number
) {
  // if the delete succeeded then we need to remove the environment from the test pane
  if (code == 0) {
    removeCBTfilesCacheForEnviro(enviroNodeID);
    let enviroPath = getEnviroPathFromID(enviroNodeID);
    if (!enviroPath) {
      // We check if it is present in the unbuilt list
      // If so, we take the id and split it after "vcast:" to get the path
      // In case that is not possible, we throw an error message
      if (vcastUnbuiltEnviroList.has(enviroNodeID)) {
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
    await refreshAllExtensionData();

    // vcast does not delete the ENVIRO-NAME.* files so we clean those up here
    removeFilePattern(enviroPath, ".*");
  }
}

export async function addEnvToProjectCallback(
  enviroPath: string,
  code: number
) {
  // This function gets called after we add an environment to a project.
  // We check the return code, update Project Tree, and cleanup on failure

  if (code == 0) {
    await refreshAllExtensionData();
  } else {
    try {
      // remove the environment directory, as well as the .vce file
      vectorMessage("Environment adding failed, removing artifacts ...");
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
 * Callback function for executing buildEnvironmentIncremental command
 * @param enviroPathList List of env path
 * @param code Exit code
 */
export async function buildEnvironmentIncrementalCallback(
  enviroPathList: string[],
  code: number
) {
  // This function gets called after we Build/Execute a Node
  // Basically the same like buildEnvironmentCallback, but we can have multiple environments
  // We check the return code, update the test pane, and cleanup on failure

  for (let enviroPath of enviroPathList) {
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
}
