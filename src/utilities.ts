import * as vscode from "vscode";

// needed for parsing json files with comments
import * as jsonc from "jsonc-parser";

import { Uri } from "vscode";

import { errorLevel, vectorMessage } from "./messagePane";

const fs = require("fs");
const glob = require("glob");
const os = require("os");
const path = require("path");

// options used for reading json-c files
export const jsoncParseOptions: jsonc.ParseOptions = {
  allowTrailingComma: true,
  disallowComments: false,
  allowEmptyContent: false,
};
// note: we don't use this programmatically but it is useful for debugging
export var jsoncParseErrors: jsonc.ParseError[] = []; // not using programmatically, for debug only
export const jsoncModificationOptions: jsonc.ModificationOptions = {
  formattingOptions: { tabSize: 4, insertSpaces: true },
};

// The testInterface is delivered in the .vsix
// in the sub-directory "python"

// The VectorCAST extensions for settings and launch are delivered in the .vsix
// in the sub-directory "support"

export interface jsonDataType {
  jsonData: any;
  jsonDataAsString: string;
}

export function loadLaunchFile(jsonPath: string): jsonDataType | undefined {
  // this function takes the path to a launch.json
  // and returns the contents, or an empty list of configurations
  // if we cannot read the file
  let returnValue: jsonDataType | undefined = undefined;

  // Requires json-c parsing to handle comments etc.
  const existingContents = fs.readFileSync(jsonPath).toString();
  // note that jsonc.parse returns "real json" without the comments
  const existingJSONdata = jsonc.parse(
    existingContents,
    jsoncParseErrors,
    jsoncParseOptions
  );

  if (existingJSONdata) {
    returnValue = {
      jsonData: existingJSONdata,
      jsonDataAsString: existingContents,
    };
  }
  return returnValue;
}

export function addLaunchConfiguration(
  fileUri: Uri,
  pathToSupportFiles: string
) {
  // This function adds the VectorCAST Harness Debug configuration to any
  // launch.json file that the user right clicks on

  const jsonPath = fileUri.fsPath;
  const existingLaunchData: jsonDataType | undefined = loadLaunchFile(jsonPath);

  const vectorJSON = JSON.parse(
    fs.readFileSync(path.join(pathToSupportFiles, "vcastLaunchTemplate.json"))
  );

  // if we have a well formatted launch file with an array of configurations ...
  if (
    existingLaunchData &&
    existingLaunchData.jsonData.configurations &&
    existingLaunchData.jsonData.configurations.length > 0
  ) {
    // Remember that the vectorJSON data has the "configurations" level which is an array
    const vectorConfiguration = vectorJSON.configurations[0];

    // now loop through launch.json to make sure it does not already have the vector config
    let needToAddVectorLaunchConfig = true;

    for (const existingConfig of existingLaunchData.jsonData.configurations) {
      if (existingConfig.name == vectorConfiguration.name) {
        vscode.window.showInformationMessage(
          `File: ${jsonPath}, already contains a ${vectorConfiguration.name} configuration`
        );
        needToAddVectorLaunchConfig = false;
        break;
      }
    }
    if (needToAddVectorLaunchConfig) {
      const whereToInsert = existingLaunchData.jsonData.configurations.length;
      let jsonDataAsString = existingLaunchData.jsonDataAsString;
      const jsoncEdits = jsonc.modify(
        jsonDataAsString,
        ["configurations", whereToInsert],
        vectorConfiguration,
        jsoncModificationOptions
      );
      jsonDataAsString = jsonc.applyEdits(jsonDataAsString, jsoncEdits);
      fs.writeFileSync(jsonPath, jsonDataAsString);
    }
  } else {
    // if the existing file is empty or does not contain a "configurations" section,
    // simply insert the vector config.  This allows the user to start with an empty file
    fs.writeFileSync(jsonPath, JSON.stringify(vectorJSON, null, 4));
  }
}

const filesExcludeString = "files.exclude";
export function addSettingsFileFilter(
  fileUri: Uri,
  pathToSupportFiles: string
) {
  const filePath = fileUri.fsPath;
  let existingJSON;
  let existingJSONasString: string;

  try {
    // Requires json-c parsing to handle comments etc.
    existingJSONasString = fs.readFileSync(filePath).toString();
    // note that jsonc.parse returns "real json" without the comments
    existingJSON = jsonc.parse(
      existingJSONasString,
      jsoncParseErrors,
      jsoncParseOptions
    );
  } catch {
    vscode.window.showErrorMessage(
      `Could not load the existing ${path.basename(
        filePath
      )}, check for syntax errors`
    );
    return;
  }

  // if the file does not have a "files.exclude" section, add one
  if (!existingJSON.hasOwnProperty(filesExcludeString)) {
    // we don't need to modify the existing jsonAsString
    // because it will do the insert of a new section for us
    existingJSON[filesExcludeString] = {};
  }

  // Remember that the vectorJSON data has the "configurations" level which is an array
  const vectorJSON = JSON.parse(
    fs.readFileSync(path.join(pathToSupportFiles, "vcastSettings.json"))
  );

  // now check if the vector filters are already in the files.exclude object
  if (
    existingJSON[filesExcludeString].hasOwnProperty("vectorcast-filter-start")
  ) {
    vscode.window.showInformationMessage(
      `File: ${filePath}, already contains the VectorCAST exclude patterns`
    );
  } else {
    const mergedExcludeList = Object.assign(
      existingJSON["files.exclude"],
      vectorJSON["files.exclude"]
    );
    const jsoncEdits = jsonc.modify(
      existingJSONasString,
      [filesExcludeString],
      mergedExcludeList,
      jsoncModificationOptions
    );
    existingJSONasString = jsonc.applyEdits(existingJSONasString, jsoncEdits);

    fs.writeFileSync(filePath, existingJSONasString);
  }
}

export interface statusMessageType {
  fullLines: string;
  remainderText: string;
}
export function processCommandOutput(
  remainderTextFromLastCall: string,
  newTextFromThisCall: string
): statusMessageType {
  // The purpose of this function is to process the raw text that comes
  // from the spawned process and to split it into full lines and a "remainder"
  // The caller will keep the remainder around until the next data comes in
  // and then pass that in with the new text.

  let returnObject: statusMessageType = { fullLines: "", remainderText: "" };
  const candidateString = remainderTextFromLastCall + newTextFromThisCall;

  if (candidateString.endsWith("\n"))
    // if we got all full lines, there is no remainder
    returnObject.fullLines = candidateString.slice(
      0,
      candidateString.length - 1
    );
  else if (candidateString.includes("\n")) {
    // if there is at least one \n then we have full lines and a remainder
    const whereToSplit = candidateString.lastIndexOf("\n");
    returnObject.fullLines = candidateString.substring(0, whereToSplit);
    returnObject.remainderText = candidateString.substring(
      whereToSplit + 1,
      candidateString.length
    );
  } else {
    // otherwise we have only a remainder
    returnObject.remainderText = candidateString;
  }

  return returnObject;
}

export function exeFilename(basename: string): string {
  if (os.platform() == "win32") return basename + ".exe";
  else return basename;
}

export function forceLowerCaseDriveLetter(path?: string): string {
  // There is an issue with drive letter case between TS and Python
  // On windows, the drive letter is always lower case here in TS
  // but in python, the calls to abspath, and realpath force the
  // drive letter to be upper case.

  if (path) {
    const platform = os.platform();
    if (platform == "win32") {
      if (path.charAt(1) == ":") {
        const driveLetter = path.charAt(0).toLowerCase();
        return driveLetter + path.slice(1, path.length);
      }
    }
    return path;
  } else return "";
}

export function forceUpperCaseDriveLetter(path?: string): string {
  if (path) {
    const platform = os.platform();
    if (platform === "win32") {
      if (path.charAt(1) === ":") {
        const driveLetter = path.charAt(0).toUpperCase();
        return driveLetter + path.slice(1);
      }
    }
    return path;
  } else return "";
}

export function normalizePath(path: string): string {
  // This function is used to fix the drive letter AS WELL AS
  // replace any backslashes with forward slashes

  let returnPath = path;
  if (os.platform() == "win32") {
    returnPath = forceLowerCaseDriveLetter(path).replace(/\\/g, "/");
  }
  return returnPath;
}

export function getRangeOption(lineIndex: number): vscode.DecorationOptions {
  // this function returns a single line range DecorationOption
  const startPos = new vscode.Position(lineIndex, 0);
  const endPos = new vscode.Position(lineIndex, 0);
  return { range: new vscode.Range(startPos, endPos) };
}

export function openFileWithLineSelected(
  filePath: string,
  lineNumber: number,
  viewColumn: vscode.ViewColumn = vscode.ViewColumn.One
) {
  const locationToHighlight: vscode.Range = new vscode.Range(
    new vscode.Position(lineNumber, 0),
    new vscode.Position(lineNumber, 200)
  );

  let viewOptions: vscode.TextDocumentShowOptions = {
    viewColumn: viewColumn,
    preserveFocus: false,
    selection: locationToHighlight,
  };
  vscode.workspace.openTextDocument(filePath).then(
    (doc: vscode.TextDocument) => {
      vscode.window.showTextDocument(doc, viewOptions);
    },
    (error: any) => {
      vectorMessage(error.message, errorLevel.error);
    }
  );
}

export function quote(name: string) {
  // if name contains <<COMPOUND>>, <<INIT>> or parenthesis
  // we need to quote the name so that the shell does not interpret it.

  if (
    name.includes("<") ||
    name.includes(">") ||
    name.includes("(") ||
    name.includes(")")
  ) {
    return '"' + name + '"';
  } else return name;
}

export function showSettings() {
  console.log("VectorCAST Test Explorer show settings called ...");
  // previously, I was using: "VectorCAST Test Explorer" as the "filter" in this call, but
  // that resulted in a couple of extra settings, and the wrong order being displayed
  // through trial and error, I found that this gives what we want
  vscode.commands.executeCommand(
    "workbench.action.openWorkspaceSettings",
    "@ext:vectorgroup.vectorcasttestexplorer"
  );
}

export function removeFilePattern(enviroPath: string, pattern: string) {
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
