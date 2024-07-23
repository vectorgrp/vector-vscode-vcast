import * as vscode from "vscode";

// some functions that are used across functional areas of the extensions

import { updateDisplayedCoverage } from "./coverage";
import { updateTestDecorator } from "./editorDecorator";

import { updateExploreDecorations } from "./fileDecorator";
import { openMessagePane, vectorMessage } from "./messagePane";
import { getEnviroPathFromID, removeNodeFromCache } from "./testData";

import {
  removeCBTfilesCacheForEnviro,
  removeEnvironmentFromTestPane,
  updateDataForEnvironment,
  updateTestPane,
} from "./testPane";

import { removeFilePattern } from "./utilities";
import { commandStatusType } from "./vcastCommandRunner";
import { loadScriptIntoEnvironment } from "./vcastAdapter";
import { removeCoverageDataForEnviro } from "./vcastTestInterface";

const fs = require("fs");
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

export function loadScriptCallBack(
  commandStatus: commandStatusType,
  enviroName: string,
  scriptPath: string
) {
  // This is the callback that should be passed to executeClicastWithProgress() when
  // we are computing basis path or ATG tests, this gets called when the command completes

  if (commandStatus.errorCode == 0) {
    vectorMessage("Loading tests into VectorCAST environment ...");

    // call clicast to load the test script
    loadScriptIntoEnvironment(enviroName, scriptPath);

    const enviroPath = path.join(path.dirname(scriptPath), enviroName);
    vectorMessage(`Deleteting script file: ${path.basename(scriptPath)}`);
    updateTestPane(enviroPath);
    fs.unlinkSync(scriptPath);
  } else {
    vscode.window.showInformationMessage(
      `Error generating tests, see log for details`
    );
    vectorMessage(commandStatus.stdout);
    openMessagePane();
  }
}
