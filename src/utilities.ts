import * as vscode from "vscode";

// needed for parsing json files with comments
import * as jsonc from "jsonc-parser";

import { Uri } from "vscode";

import { errorLevel, openMessagePane, vectorMessage } from "./messagePane";

const execSync = require("child_process").execSync;
const fs = require("fs");
const os = require("os");
const path = require("path");
const spawn = require("child_process").spawn;

// options used for reading json-c files
export const jsoncParseOptions: jsonc.ParseOptions = {
  allowTrailingComma: true,
  disallowComments: false,
  allowEmptyContent: false,
};
// note: we don't use this programmatically but it is useful for debugging
export var jsoncParseErrors: jsonc.ParseError[] = []; // not using programatically, for debug only
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
  pathToSupportfiles: string
) {
  // This function adds the VectorCAST Harness Debug configuration to any
  // launch.json file that the user right clicks on

  const jsonPath = fileUri.fsPath;
  const existingLaunchData: jsonDataType | undefined = loadLaunchFile(jsonPath);

  const vectorJSON = JSON.parse(
    fs.readFileSync(path.join(pathToSupportfiles, "vcastLaunchTemplate.json"))
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

export function executeVPythonScript(
  commandToRun: string,
  whereToRun: string
): commandStatusType {
  // we use this common function to run the vpython and process the output because
  // vpython prints this annoying message if VECTORCAST_DIR does not match the executable
  // Since this happens before our script even starts so we cannot suppress it.
  // We could send the json data to a temp file, but the create/open file operations
  // have overhead.

  let returnData: commandStatusType = { errorCode: 0, stdout: "" };
  if (commandToRun) {
    const commandStatus: commandStatusType = executeCommandSync(
      commandToRun,
      whereToRun
    );
    const pieces = commandStatus.stdout.split("ACTUAL-DATA", 2);
    returnData.stdout = pieces[1].trim();
    returnData.errorCode = commandStatus.errorCode;
  }
  return returnData;
}

export function getJsonDataFromTestInterface(
  commandToRun: string,
  enviroPath: string
): any {
  // A wrapper for executeVPythonScript when we know the output is JSON

  let returnData = undefined;

  let jsonText = executeVPythonScript(commandToRun, enviroPath).stdout;
  try {
    returnData = JSON.parse(jsonText);
  } catch {
    // return undefined
  }
  return returnData;
}

export interface commandStatusType {
  errorCode: number;
  stdout: string;
}

export function processExceptionFromExecuteCommand(
  command: string,
  error: any,
  printErrorDetails: boolean
): commandStatusType {
  // created to make the excuteCommand logic easier to understand

  let commandStatus: commandStatusType = { errorCode: 0, stdout: "" };

  // 99 is a warning, like a mismatch opening the environment
  if (error && error.status == 99) {
    commandStatus.stdout = error.stdout.toString();
    commandStatus.errorCode = 0;
    vectorMessage(commandStatus.stdout);
  } else if (error && error.stdout) {
    commandStatus.stdout = error.stdout.toString();
    commandStatus.errorCode = error.status;
    if (printErrorDetails) {
      vectorMessage("Exception while running command:");
      vectorMessage(command);
      vectorMessage(commandStatus.stdout);
      vectorMessage(error.stderr.toString());
      openMessagePane();
    }
  } else {
    ("Unexpected error in utilities/processExceptionFromExecuteCommand()");
  }

  return commandStatus;
}

export function executeCommandSync(
  commandToRun: string,
  cwd: string,
  printErrorDetails: boolean = true
): commandStatusType {
  vectorMessage(`Running: ${commandToRun}`, errorLevel.trace);

  let commandStatus: commandStatusType = { errorCode: 0, stdout: "" };
  try {
    // commandOutput is a buffer: (Uint8Array)
    commandStatus.stdout = execSync(commandToRun, { cwd: cwd })
      .toString()
      .trim();
  } catch (error: any) {
    commandStatus = processExceptionFromExecuteCommand(
      commandToRun,
      error,
      printErrorDetails
    );
  }
  return commandStatus;
}

export function executeWithRealTimeEcho(
  command: string,
  argList: string[],
  CWD: string,
  callback?: any,
  enviroPath?: string
) {
  // this function is used to build and rebuild environments
  // long running commands where we want to show real-time output

  // it uses spawn to execute a clicast command, log the output to the
  // message pane, and update the test explorer when the command completes

  // To debug what's going on with vcast, you can add -dall to
  // argList, which will dump debug info for the clicast invocation
  let clicast = spawn(command, argList, { cwd: CWD });
  vectorMessage("-".repeat(100));

  // maybe this is a hack, but after reading stackoverflow for a while I could
  // not come up with anything better.  The issue is that the on ("exit") gets called
  // before the stdout stream is closed so stdoutBuffer is incomplete at that point
  // so we use on ("exit") to invoke the callback and on ("close") to dump the clicast stdout.

  // I tried to only dump the output when the exit code was non 0 but we get a race
  // condition because the exit might not have saved it when the close is seen.

  vectorMessage("-".repeat(100));
  clicast.stdout.on("data", function (data: any) {
    // split raw message based on \n or \r because messages
    // that come directly from the compiler are LF terminated
    const rawString = data.toString();
    const lineArray = rawString.split(/[\n\r?]/);
    for (const line of lineArray) {
      if (line.length > 0) {
        vectorMessage(line.replace(/\n/g, ""));
      }
    }
  });

  clicast.stdout.on("close", function (code: any) {
    vectorMessage("-".repeat(100));
  });

  clicast.on("exit", function (code: any) {
    vectorMessage("-".repeat(100));
    vectorMessage(
      `clicast: '${argList.join(" ")}' returned exit code: ${code.toString()}`
    );
    vectorMessage("-".repeat(100));
    if (callback) {
      callback(enviroPath, code);
    }
  });
}

interface statusMessageType {
  fullLines: string;
  remainderText: string;
}
function processCommandOutput(
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

export function executeClicastWithProgress(
  title: string,
  commandAndArgs: string[],
  enviroName: string,
  testScriptPath: string,
  filter: RegExp,
  callback: any
) {
  // Very similar to the executeWithRealTimeEcho(), but adds a progress dialog,
  // and a different callback structure.
  // We use this for generating the basis path and ATG tests (for now)

  vectorMessage(`Executing command: ${commandAndArgs.join(" ")}`);
  let commandStatus: commandStatusType = { errorCode: 0, stdout: "" };

  const cwd = path.dirname(testScriptPath);
  const command = commandAndArgs[0];
  const args = commandAndArgs.slice(1, commandAndArgs.length);

  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: title,
      cancellable: false,
    },
    async (progress) => {
      return new Promise(async (resolve, reject) => {
        // shell is needed so that stdout is NOT buffered
        const commandHandle = spawn(command, args, { cwd: cwd, shell: true });

        // each time we get an entry here, we need to check if we have a
        // partial message if so we print the part up the the
        // final \n and buffer the rest, see comment above
        let remainderTextFromLastCall = "";

        commandHandle.stdout.on("data", async (data: any) => {
          const message: statusMessageType = processCommandOutput(
            remainderTextFromLastCall,
            data.toString()
          );
          remainderTextFromLastCall = message.remainderText;

          if (message.fullLines.length > 0) {
            vectorMessage(message.fullLines);

            // for the dialog, we want use the filter to decide what to show
            // and this requires the message data to be split into single lines
            const lineArray = message.fullLines.split("\n");
            for (const line of lineArray) {
              const matched = line.match(filter);
              if (matched && matched.length > 0) {
                progress.report({ message: matched[0], increment: 10 });
                // This is needed to allow the message window to update ...
                await new Promise<void>((r) => setTimeout(r, 0));
              }
            }
          }
        });

        commandHandle.stderr.on("data", async (data: any) => {
          const message: statusMessageType = processCommandOutput(
            remainderTextFromLastCall,
            data.toString(data)
          );
          remainderTextFromLastCall = message.remainderText;

          if (message.fullLines.length > 0) {
            vectorMessage(message.fullLines);
          }
        });

        commandHandle.on("error", (error: any) => {
          commandStatus = processExceptionFromExecuteCommand(
            commandAndArgs.join(" "),
            error,
            true
          );
        });
        commandHandle.on("close", (code: any) => {
          // display any remaining text ...
          if (remainderTextFromLastCall.length > 0) {
            vectorMessage(remainderTextFromLastCall);
          }
          commandStatus.errorCode = code;
          resolve(code);
          callback(commandStatus, enviroName, testScriptPath);
        });
      });
    }
  );
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

  var viewOptions: vscode.TextDocumentShowOptions = {
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
