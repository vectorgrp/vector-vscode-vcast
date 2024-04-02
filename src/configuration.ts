import * as vscode from "vscode";
import { vectorMessage } from "./messagePane";
import { vcastCommandtoUse } from "./vcastUtilities";

const fs = require("fs");
const path = require("path");
const execSync = require("child_process").execSync;

export const configFilename = "CCAST_.CFG";

export function initializeConfigurationFile(CWD: string): boolean {
  // If CWD does not contains a CCAST_.CFG, this function will either
  //  -- copy the default configuration file to the CWD from the extension options, or
  //  -- open the VectorCAST GUI in "option mode" to allow the user to create one

  let returnValue = true;
  let localConfigurationFilePath = path.join(CWD, configFilename);

  const settings = vscode.workspace.getConfiguration("vectorcastTestExplorer");
  const defaultConfigurationPath = settings.get("configurationLocation", "");

  if (fs.existsSync(localConfigurationFilePath)) {
    vectorMessage("Using the existing configuration file ...");
    vectorMessage(`   ${localConfigurationFilePath}`);
  } else if (defaultConfigurationPath.length > 0) {
    // The option value gets validated in onDidChangeConfiguration()
    // Improvement Needed: do we need to worry about the user editing settings.json manually?
    // copy the file to the current directory
    vectorMessage(
      `Using the default configuration file from the extension options ...`
    );
    vectorMessage(`   ${defaultConfigurationPath}`);
    fs.copyFileSync(defaultConfigurationPath, localConfigurationFilePath);
  } else {
    // open the VectorCAST GUI in "option mode"
    vscode.window.showInformationMessage(
      "Opening the VectorCAST options editor.  Use the editor to create a VectorCAST configuration file that has the correct settings for your compiler."
    );

    vectorMessage(`Opening the VectorCAST options editor ...`);
    execSync(`${vcastCommandtoUse} -lc -o`, { cwd: CWD });

    // if the user simply closes the options dialog, no CFG file will get created so we will abort ...
    if (!fs.existsSync(localConfigurationFilePath)) {
      vscode.window.showErrorMessage(
        "The VectorCAST options editor was closed without creating a configuration file, environment creation will be aborted."
      );
      returnValue = false;
    }
  }

  return returnValue;
}

// There are some nuances to handling the options.
// In general, there are user settings, and workspace settings
// If user=abc, and workspace=xyz, then the value from get() is xyz
// and we do not get an indication of which one the user is actively changing,
// however the inspect() method lets us see the values from all levels

// This makes it tricky to handle validity checking for values, since
// an illegal user value will be "hidden" by a legal workspace value,
// or cause us to insert a valid value at the workspace level leaving the
// user level with an illegal value.

export function updateConfigurationOption() {
  // get the current option value
  const settings = vscode.workspace.getConfiguration("vectorcastTestExplorer");
  const currentValue = settings.get("configurationLocation", "");

  // empty is valid, and no processing is needed
  if (currentValue.length > 0) {
    if (!fs.existsSync(currentValue)) {
      vscode.window.showErrorMessage(
        `Provided file path: ${currentValue} does not exist`
      );
      // clear illegal value at the workspace level for now
      // Improvement Needed: use inspect() to determine where the illegal value comes from
      settings.update(
        "configurationLocation",
        "",
        vscode.ConfigurationTarget.Workspace
      );
    } else if (!currentValue.endsWith(configFilename)) {
      vscode.window.showErrorMessage(
        `Provided file path: ${currentValue} is invalid (path must end with ${configFilename})`
      );
      // clear illegal value at the workspace level for now
      // Improvement Needed: use inspect() to determine where the illegal value comes from
      settings.update(
        "configurationLocation",
        "",
        vscode.ConfigurationTarget.Workspace
      );
    } else {
      vscode.window.showInformationMessage(
        `Default configuration file now set to: ${currentValue})`
      );
    }
  }
}

const defaultUTlocation = "./unitTests";
export function updateUnitTestLocationOption() {
  // get the current option value
  const settings = vscode.workspace.getConfiguration("vectorcastTestExplorer");
  const currentValue = settings.get("unitTestLocation", "");

  if (currentValue.length == 0) {
    vscode.window.showErrorMessage(
      `The unit test location may not be empty, resetting to default`
    );
    settings.update(
      "unitTestLocation",
      defaultUTlocation,
      vscode.ConfigurationTarget.Workspace
    );
  } else if (currentValue.length > 0) {
    // if the value starts with "./" then it is a relative path
    // and is valid in all cases
    if (!currentValue.startsWith("./")) {
      // otherwise we need to check if the path exists
      if (!fs.existsSync(currentValue)) {
        vscode.window.showErrorMessage(
          `Provided directory path: ${currentValue} does not exist, resetting to default`
        );
        // clear illegal value at the workspace level for now
        // Improvement Needed: use inspect() to determine where the illegal value comes from
        settings.update(
          "unitTestLocation",
          defaultUTlocation,
          vscode.ConfigurationTarget.Workspace
        );
      }
    }
  }
}

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
