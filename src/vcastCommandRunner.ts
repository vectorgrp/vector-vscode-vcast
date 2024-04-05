import * as vscode from "vscode";

import { execSync, spawn } from "child_process";

import { errorLevel, openMessagePane, vectorMessage } from "./messagePane";
import { processCommandOutput, statusMessageType } from "./utilities";

const path = require("path");

export interface commandStatusType {
  errorCode: number;
  stdout: string;
}

// Call vpython vTestInterface.py to run a command
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

// A wrapper for executeVPythonScript when we know the output is JSON
export function getJsonDataFromTestInterface(
  commandToRun: string,
  enviroPath: string
): any {
  let returnData = undefined;

  let jsonText = executeVPythonScript(commandToRun, enviroPath).stdout;
  try {
    returnData = JSON.parse(jsonText);
  } catch {
    // return undefined
  }
  return returnData;
}

// Makes the excuteCommand logic easier to understand
function processExceptionFromExecuteCommand(
  command: string,
  error: any,
  printErrorDetails: boolean
): commandStatusType {
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
    vectorMessage("Unexpected error in utilities/processExceptionFromExecuteCommand()");
  }

  return commandStatus;
}

// A wrapper for the NodeJS execSync function
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

// A command runner for long running commands like build and rebukld environment
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

// A command runner for commands where we want to show progress like ATG and Basis Path Test Generation
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
