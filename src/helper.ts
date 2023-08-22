import * as vscode from "vscode";

// some functions that are used across functional areas of the extensions

import { updateDisplayedCoverage } from "./coverage";
import {
  updateTestDecorator,
} from "./editorDecorator";
import {
  removeCoverageDataForEnviro,
  updateCoverageData,
} from "./vcastTestInterface";
import { removeEnvironmentFromTestPane, updateTestPane } from "./testPane";
import { getEnviroPathFromID } from "./testData";
import { updateExploreDecorations } from "./fileDecorator";

export function showSettings() {
  console.log("VectorCAST Test Explorer show settings called ...");
  vscode.commands.executeCommand(
    "workbench.action.openSettings",
    "VectorCAST Test Explorer"
  );
}

export function updateDataForEnvironment(enviroPath: string) {
  // this function does all of the "common" work when an environment is updated
  // sources of environment update are things like:
  //   - opening the environment in the vcast gui
  //   - building a new environment
  //   - ...

  updateTestPane(enviroPath);
  updateCoverageData(enviroPath);
  updateDisplayedCoverage();
  updateExploreDecorations();
  updateTestDecorator ();

}

const fs = require("fs");
const glob = require("glob");
const path = require("path");

export function deleteEnvironmentCallback(enviroNodeID: string) {
  // this function gets called after the clicast env delete completes

  removeEnvironmentFromTestPane(enviroNodeID);

  const enviroPath = getEnviroPathFromID(enviroNodeID);
  removeCoverageDataForEnviro(enviroPath);
  updateDisplayedCoverage();
  updateExploreDecorations();
  updateTestDecorator ();

  // vcast does not delete the ENVIRO-NAME.* files so we clean those up here
  const options = { cwd: path.dirname(enviroPath), absolute: true };
  let fileList = glob.sync(`${path.basename(enviroPath)}.*`, options);
  for (let filePath of fileList) {
    fs.unlinkSync(filePath);
  }
}
