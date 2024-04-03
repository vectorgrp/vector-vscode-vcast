
import * as vscode from "vscode";
import { vectorMessage } from "./messagePane";
import {
    vcastCommandtoUse,
} from "./vcastUtilities";

const fs = require("fs");
const path = require("path");
const execSync = require("child_process").execSync;


export const configFilename = "CCAST_.CFG";

export function initializeConfigurationFile (CWD:string):boolean {

  // If CWD does not contains a CCAST_.CFG, this function will either  
  //  -- copy the default configuration file to the CWD from the extension options, or
  //  -- open the VectorCAST GUI in "option mode" to allow the user to create one

  let returnValue = true;
  let localConfigurationFilePath = path.join(CWD, configFilename);

  const settings = vscode.workspace.getConfiguration("vectorcastTestExplorer");
  const defaultConfigurationPath = settings.get("configurationLocation", "");

  if (fs.existsSync(localConfigurationFilePath)) {
    vectorMessage ("Using the existing configuration file ...")
    vectorMessage (`   ${localConfigurationFilePath}`)

  }
  else if (defaultConfigurationPath.length > 0) {
    // The option value gets validated in onDidChangeConfiguration()
    // Improvement Needed: do we need to worry about the user editing settings.json manually?
    // copy the file to the current directory
    vectorMessage (`Using the default configuration file from the extension options ...`)
    vectorMessage (`   ${defaultConfigurationPath}`)
    fs.copyFileSync(defaultConfigurationPath, localConfigurationFilePath);
  }
  else {
    // open the VectorCAST GUI in "option mode"
    vscode.window.showInformationMessage ("Opening the VectorCAST options editor.  Use the editor to create a VectorCAST configuration file that has the correct settings for your compiler.");

    vectorMessage (`Opening the VectorCAST options editor ...`)
    execSync(`${vcastCommandtoUse} -lc -o`, { cwd: CWD });

    // if the user simply closes the options dialog, no CFG file will get created so we will abort ...
    if (!fs.existsSync(localConfigurationFilePath)) {
      vscode.window.showErrorMessage ("The VectorCAST options editor was closed without creating a configuration file, environment creation will be aborted.")
      returnValue = false;      
    }
  }

  return returnValue;

}

export function updateConfigurationOption (event:any) {
    // There are some nuances to handling the configuration documented here
    // In general, there are user settings, and workspace settings
    // If user=abc, and workspace=xyz, then the value from get() is xyz
    // and we do not get an indication of which one the user is actively changing,
    // however the inspect() method lets us see the values from all levels

    // This makes it tricky to handle validity checking for values, since 
    // an illegal user value will be "hidden" by a legal workspace value.
    // or cause us to insert "" as the workspace value leaving the user value


    // get the current option value 
    const settings = vscode.workspace.getConfiguration("vectorcastTestExplorer");
    const currentConfiguration = settings.get("configurationLocation", "");

    // empty is valid, and no processing is needed
    if (currentConfiguration.length>0) {
    if (!fs.existsSync (currentConfiguration)) {
        vscode.window.showErrorMessage(`Provided file path: ${currentConfiguration} does not exist`);
        // clear illegal value at the workspace level for now
        // Improvement Needed: use inspect() to determine where the illegal value comes from
        settings.update ("configurationLocation", "", vscode.ConfigurationTarget.Workspace);
    } 
    else if (!currentConfiguration.endsWith (configFilename)) {
        vscode.window.showErrorMessage(`Provided file path: ${currentConfiguration} is invalid (path must end with ${configFilename})`);
        // clear illegal value at the workspace level for now
        // Improvement Needed: use inspect() to determine where the illegal value comes from
        settings.update ("configurationLocation", "", vscode.ConfigurationTarget.Workspace);
    }
    else {
        vscode.window.showInformationMessage (`Default configuration file now set to: ${currentConfiguration})`);
    }
    }


}