import * as vscode from "vscode";

// some functions that are used across functional areas of the extensions

import { updateDisplayedCoverage } from "./coverage";
import { updateTestDecorator } from "./editorDecorator";
import { removeCoverageDataForEnviro } from "./vcastTestInterface";
import {
  removeCBTfilesCacheForEnviro,
  removeEnvironmentFromTestPane,
  updateTestPane,
} from "./testPane";
import { getEnviroPathFromID, removeNodeFromCache } from "./testData";
import { updateExploreDecorations } from "./fileDecorator";
import { vectorMessage } from "./messagePane";

export function showSettings() {
  console.log("VectorCAST Test Explorer show settings called ...");
  // previously, I was using: "VectorCAST Test Explorer" as the "filter" in this call, but
  // that resulted in a coupld of extra settings, and the wrong order being displayed
  // through trial and error, I found that this gives what we want
  vscode.commands.executeCommand(
    "workbench.action.openWorkspaceSettings",
    "@ext:vectorgroup.vectorcasttestexplorer"
  );
}

function removeFilePattern(enviroPath: string, pattern: string) {
  const options = {
    cwd: path.dirname(enviroPath),
    absolute: true,
    strict: false,
  };
  let fileList = glob.sync(`${path.basename(enviroPath)}${pattern}`, options);
  for (let filePath of fileList) {
    fs.unlinkSync(filePath);
  }
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

const fs = require("fs");
const glob = require("glob");
const path = require("path");

export function buildEnvironmentCallback(enviroPath: string, code: number) {
  // This function gets called after the newEnviroVCAST command
  // We check the return code and cleanup on failure

  if (code == 0) {
    updateDataForEnvironment(enviroPath);
  } else {
    try {
      // remove the envionment directory, as well as the .vce file
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

export function rebuildEnvironmentCallback(enviroPath: string, code: number) {
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
    updateDataForEnvironment(enviroPath);
  }
}

export function deleteEnvironmentCallback(enviroNodeID: string, code: number) {
  // this function gets called after the clicast env delete completes

  // if the delete succeeded then we need to remove the environment from the test pane
  if (code == 0) {
    removeEnvironmentFromTestPane(enviroNodeID);
    removeCBTfilesCacheForEnviro(enviroNodeID);

    const enviroPath = getEnviroPathFromID(enviroNodeID);
    removeCoverageDataForEnviro(enviroPath);
    updateDisplayedCoverage();
    updateExploreDecorations();
    updateTestDecorator();

    removeNodeFromCache(enviroNodeID);

    // vcast does not delete the ENVIRO-NAME.* files so we clean those up here
    removeFilePattern(enviroPath, ".*");
  }
}
