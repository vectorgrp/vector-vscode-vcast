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
import { vectorMessage } from "./messagePane";

export function showSettings() {
  console.log("VectorCAST Test Explorer show settings called ...");
  vscode.commands.executeCommand("workbench.action.openWorkspaceSettings", "VectorCAST Test Explorer");
}


function removeFilePattern (enviroPath: string, pattern: string) {

  const options = { cwd: path.dirname(enviroPath), absolute: true };
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
  updateCoverageData(enviroPath);
  updateDisplayedCoverage();
  updateExploreDecorations();
  updateTestDecorator ();

}

const fs = require("fs");
const glob = require("glob");
const path = require("path");

export function buildEnvironmentCallback (enviroPath: string, code:number) {
  // This function gets called after the newEnviroVCAST command
  // We check the return code and cleanup on failure

  if (code==0) {
    updateDataForEnvironment(enviroPath);
  }
  else {
    try {
      // remove the envionment directory, as well as the .vce|.env files
      vectorMessage ("Environment build failed, removing artifacts ...");
      fs.rmSync (enviroPath, {recursive: true, force: true});
      fs.unlinkSync(enviroPath+".vce");
      fs.unlinkSync(enviroPath+".env");
    }
    catch {
      ; // ignore errors
    }
  }
}

export function rebuildEnvironmentCallback (enviroPath: string, code:number) {
  // This function gets called after the rebuildEnviro command
  // When the rebuild succeeds, we delete the BAK stuff

  if (code==0) {
    try {
      // remove the BAK directory and .vce file
      vectorMessage ("Environment re-build complete, removing artifacts ...");
      fs.rmSync (enviroPath+".BAK", {recursive: true, force: true});
      fs.unlinkSync(enviroPath+".BAK.vce");
     
      // vcast leaves the ENVIRO-NAME.time-tag.tst file so we clean that up
      removeFilePattern (enviroPath, ".*.tst")
    }
    catch {
      ; // ignore errors
    }
    updateDataForEnvironment(enviroPath);
  }
}


export function deleteEnvironmentCallback(enviroNodeID: string, code:number) {
  // this function gets called after the clicast env delete completes

  // if the delete succeeded then we need to remove the environment from the test pane
  if (code==0) {
    removeEnvironmentFromTestPane(enviroNodeID);

    const enviroPath = getEnviroPathFromID(enviroNodeID);
    removeCoverageDataForEnviro(enviroPath);
    updateDisplayedCoverage();
    updateExploreDecorations();
    updateTestDecorator ();

    // vcast does not delete the ENVIRO-NAME.* files so we clean those up here
    removeFilePattern (enviroPath, ".*")

  }
}
