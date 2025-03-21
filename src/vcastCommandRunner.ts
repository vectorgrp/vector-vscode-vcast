import * as vscode from "vscode";

import { execSync, spawn } from "child_process";

import {
  errorLevel,
  indentString,
  openMessagePane,
  vectorMessage,
} from "./messagePane";
import { processCommandOutput, statusMessageType } from "./utilities";
import { cleanVectorcastOutput } from "../src-common/commonUtilities";

import {
  clientRequestType,
  transmitCommand,
  transmitResponseType,
  vcastCommandType,
} from "../src-common/vcastServer";
import { pythonErrorCodes } from "../src-common/vcastServerTypes";

const path = require("path");

export interface commandStatusType {
  errorCode: number;
  stdout: string;
}

export function convertServerResponseToCommandStatus(
  serverResponse: transmitResponseType
): commandStatusType {
  //
  // tansmitResponse.returnData is an object with exitCode and data properties
  let commandStatus: commandStatusType = { errorCode: 0, stdout: "" };
  if (serverResponse.success) {
    commandStatus.errorCode = serverResponse.returnData.exitCode;
    // the data.text field is returned as a list to join with \n
    commandStatus.stdout = serverResponse.returnData.data.text.join("\n");
  } else {
    commandStatus.errorCode = 1;
    commandStatus.stdout = serverResponse.statusText;
  }
  vectorMessage(commandStatus.stdout, errorLevel.info, indentString);
  return commandStatus;
}

// Call vpython vTestInterface.py to run a command
export function executeVPythonScript(
  commandToRun: string,
  whereToRun: string,
  printErrorDetails: boolean = true
): commandStatusType {
  let returnData: commandStatusType = { errorCode: 0, stdout: "" };
  if (commandToRun) {
    const commandStatus: commandStatusType = executeCommandSync(
      commandToRun,
      whereToRun,
      printErrorDetails
    );
    // see detailed comment with the function definition
    returnData.stdout = cleanVectorcastOutput(commandStatus.stdout);
    returnData.errorCode = commandStatus.errorCode;
    // error code 28 means a test fail, not a command failure
    // all other non 0 error codes are command failures
    if (returnData.errorCode != 0 && returnData.errorCode != 28) {
      vectorMessage("Error running VectorCAST command");
      vectorMessage("command: " + commandToRun, errorLevel.trace, indentString);
      vectorMessage(returnData.stdout, errorLevel.info, indentString);
    }
  }
  return returnData;
}

// A wrapper for executeVPythonScript when we know the output is JSON
export function getJsonDataFromTestInterface(
  commandToRun: string,
  enviroPath: string
): any {
  let returnData = undefined;

  let jsonText = executeVPythonScript(commandToRun, enviroPath, false).stdout;
  try {
    returnData = JSON.parse(jsonText);
  } catch {
    // return undefined
  }
  return returnData;
}

// Makes the executeCommand logic easier to understand
function processExceptionFromExecuteCommand(
  command: string,
  error: any,
  printErrorDetails: boolean
): commandStatusType {
  // see detailed comment with the function definition
  let stdoutString: string = cleanVectorcastOutput(error.stdout.toString());
  let commandStatus = { errorCode: error.status, stdout: stdoutString };

  if (error.status == pythonErrorCodes.testInterfaceError) {
    // Improvement needed: we should document this
    commandStatus.errorCode = 0;
    vectorMessage("Exception while executing python interface");
    vectorMessage(stdoutString, errorLevel.info, indentString);
  } else {
    commandStatus.errorCode = error.status;
    if (printErrorDetails) {
      vectorMessage("Exception while executing VectorCAST command");
      vectorMessage(command, errorLevel.trace, indentString);
      vectorMessage(stdoutString, errorLevel.info, indentString);
      openMessagePane();
    }
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

// A command runner for long running commands like build and rebuild environment
export function executeWithRealTimeEcho(
  command: string,
  argList: string[],
  CWD: string,
  callback?: any,
  enviroPath?: string
) {
  // this function is used to build and rebuild environments
  // long running commands where we want to show real-time output

  // it uses spawn to execute a clicast | manage command, log the output to the
  // message pane, and update the test explorer when the command completes

  // To debug what's going on with vcast, you can add -dall to
  // argList, which will dump debug info for the clicast | manage invocation
  let processHandle = spawn(command, argList, { cwd: CWD });
  vectorMessage("-".repeat(100));

  // maybe this is a hack, but after reading stackoverflow for a while I could
  // not come up with anything better.  The issue is that the on ("exit") gets called
  // before the stdout stream is closed so stdoutBuffer is incomplete at that point
  // so we use on ("exit") to invoke the callback and on ("close") to dump the clicast stdout.

  // I tried to only dump the output when the exit code was non 0 but we get a race
  // condition because the exit might not have saved it when the close is seen.

  vectorMessage("-".repeat(100));
  let messageFragment: string = "";
  processHandle.stdout.on("data", function (data: any) {
    // split raw message based on \n or \r because messages
    // that come directly from the compiler are LF terminated
    const rawString = data.toString();
    const lineArray = rawString.split(/[\n\r?]/);

    // add any left over fragment to the end of the first line
    if (messageFragment.length > 0) {
      lineArray[0] = messageFragment + lineArray[0];
      messageFragment = "";
    }

    // handle the case where the last line is not complete
    if (!rawString.endsWith("\n") && !rawString.endsWith("\r")) {
      messageFragment = lineArray.pop();
    }

    for (const line of lineArray) {
      if (line.length > 0) {
        vectorMessage(line.replace(/\n/g, ""));
      }
    }
  });

  processHandle.stdout.on("close", function (code: any) {
    vectorMessage("-".repeat(100));
  });

  processHandle.on("exit", function (code: any) {
    // clearTimeout(timeout); // Clear the timeout if the process exits naturally
    vectorMessage("-".repeat(100));
    vectorMessage(
      `${path.basename(command)}: '${argList.join(" ")}' returned exit code: ${code.toString()}`
    );
    vectorMessage("-".repeat(100));
    if (callback) {
      callback(enviroPath, code);
    }
  });

  processHandle.on("error", (error) => {
    // clearTimeout(timeout); // Clear the timeout on error
    vectorMessage(`Error occurred: ${error.message}`);
  });
}

// A command runner simmilar to executeWithRealTimeEcho for long running commands
// like build and rebuild environment but having a progress bar.
export function executeWithRealTimeEchoWithProgress(
  command: string,
  argList: string[],
  CWD: string,
  vscodeMessage: string,
  callback?: any,
  enviroPath?: string | string[]
) {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `${vscodeMessage}...`,
      cancellable: false,
    },
    // We add a progress dialog that the user is informed about the ongoing process
    async (progress) => {
      progress.report({ increment: 10 });

      let processHandle = spawn(command, argList, { cwd: CWD });
      vectorMessage("-".repeat(100));
      vectorMessage("-".repeat(100));
      let messageFragment: string = "";

      // Just increment the progress bar every 3 seconds. Gives the user a better feeling of progress.
      let progressValue = 10;
      const progressInterval = setInterval(() => {
        if (progressValue < 90) {
          progressValue += 15;
          progress.report({ increment: 10 });
        }
      }, 3000);

      await new Promise<void>((resolve) => {
        processHandle.stdout.on("data", function (data: any) {
          const rawString = data.toString();
          const lineArray = rawString.split(/[\n\r?]/);

          if (messageFragment.length > 0) {
            lineArray[0] = messageFragment + lineArray[0];
            messageFragment = "";
          }

          if (!rawString.endsWith("\n") && !rawString.endsWith("\r")) {
            messageFragment = lineArray.pop();
          }

          for (let i = 0; i < lineArray.length; i++) {
            const line = lineArray[i];
            if (line.length > 0) {
              vectorMessage(line.replace(/\n/g, ""));
            }
          }
        });

        processHandle.on("exit", async function (code: any) {
          clearInterval(progressInterval);
          // Progress bar should be at 100% when the process is done
          progress.report({ increment: 100 });
          vectorMessage("-".repeat(100));
          vectorMessage(
            `${path.basename(command)}: '${argList.join(" ")}' returned exit code: ${code.toString()}`
          );
          vectorMessage("-".repeat(100));
          if (callback) {
            await callback(enviroPath, code);
          }
          resolve();
        });

        processHandle.on("error", (error) => {
          clearInterval(progressInterval);
          vectorMessage(`Error occurred: ${error.message}`);
          resolve();
        });
      });
    }
  );
}

// A command runner simmilar to executeWithRealTimeEcho for long running commands
// With the difference that it runs multiple commands sequentially and waits for each to finish
export function executeWithRealTimeEchoWithProgressSequential(
  command: string,
  argLists: string[][],
  progressMessages: string[],
  CWD: string,
  callback?: (enviroPath: string, exitCode: number) => void,
  enviroPath?: string[]
) {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      cancellable: true,
      title: "Executing command(s)...",
    },
    async (progress, token) => {
      let enviroPathIndex = 0;
      // Track total progress used
      let totalProgress = 0;

      // Loop over each argument list
      for (const [index, argList] of argLists.entries()) {
        // If cancellation has been requested, break out of the loop.
        if (token.isCancellationRequested) {
          vectorMessage(
            "Operation cancelled by user. Exiting remaining tasks."
          );
          break;
        }

        // Reset per iteration progress
        let progressValue = 0;
        enviroPathIndex = index;
        const message = `${progressMessages[index]} [ ${index + 1} / ${argLists.length} ] ...`;

        // Reset progress if needed.
        if (totalProgress > 0) {
          progress.report({ increment: -totalProgress, message });
          totalProgress = 0;
        }

        await new Promise<void>((resolve) => {
          // Spawn the process for the current argument list.
          const processHandle = spawn(command, argList, { cwd: CWD });
          vectorMessage("-".repeat(100));
          vectorMessage(`Executing: ${command} ${argList.join(" ")}`);
          let messageFragment: string = "";

          // Increment the progress bar every 3 seconds.
          const progressInterval = setInterval(() => {
            if (progressValue < 80) {
              progressValue += 5;
              totalProgress += 5;
              progress.report({ increment: 5, message });
            }
          }, 3000);

          // Listen for cancellation and kill the process if requested.
          const cancellationSubscription = token.onCancellationRequested(() => {
            vectorMessage(
              "Cancellation requested. Killing the current process..."
            );
            processHandle.kill();
          });

          processHandle.stdout.on("data", (data: any) => {
            const rawString = data.toString();
            const lineArray = rawString.split(/[\n\r]+/);

            if (messageFragment.length > 0) {
              lineArray[0] = messageFragment + lineArray[0];
              messageFragment = "";
            }

            if (!rawString.endsWith("\n") && !rawString.endsWith("\r")) {
              messageFragment = lineArray.pop() || "";
            }

            for (const line of lineArray) {
              if (line.length > 0) {
                vectorMessage(line.replace(/\n/g, ""));
              }
            }
          });

          processHandle.on("exit", (code: any) => {
            clearInterval(progressInterval);
            cancellationSubscription.dispose();

            if (callback && enviroPath) {
              let currentEnviroPath = enviroPath[enviroPathIndex];
              callback(currentEnviroPath, code);
            }

            // Ensure progress reaches 100% for this iteration.
            const finalIncrement = 100 - progressValue;
            progress.report({
              increment: finalIncrement,
              message: `Finished: ${message}`,
            });
            totalProgress += finalIncrement;

            vectorMessage(`Process finished with exit code: ${code}`);
            resolve();
          });

          processHandle.on("error", (error) => {
            clearInterval(progressInterval);
            cancellationSubscription.dispose();
            vectorMessage(`Error occurred: ${error.message}`);
            resolve();
          });
        });
      }
    }
  );
}

export function executeCommandWithProgress(
  title: string,
  commandAndArgs: string[],
  enviroName: string,
  testScriptPath: string,
  startOfRealMessages: string,
  filter: RegExp,
  callback: any
) {
  // Very similar to the executeWithRealTimeEcho(), but adds a progress dialog,
  // and a different callback structure.
  // We use this for generating the basis path and ATG tests (for now)

  vectorMessage(
    `Executing command: ${commandAndArgs.join(" ")}`,
    errorLevel.trace
  );
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

        // To strip the annoying version miss-match string, we look
        // for the first line that contains the startOFRealMessages
        // string, and log once we see this.
        let shouldLogMessage = false;

        // each time we get an entry here, we need to check if we have a
        // partial message if so we print the part up the the
        // final \n and buffer the rest, see comment above
        let remainderTextFromLastCall = "";

        let stderrChunks: string = "";

        commandHandle.stdout.on("data", async (data: any) => {
          const message: statusMessageType = processCommandOutput(
            remainderTextFromLastCall,
            data.toString()
          );
          remainderTextFromLastCall = message.remainderText;

          // for the dialog, we want use the filter to decide what to show
          // and this requires the message data to be split into single lines
          const lineArray = message.fullLines.split("\n");
          for (const line of lineArray) {
            if (line.startsWith(startOfRealMessages)) {
              shouldLogMessage = true;
            }

            if (shouldLogMessage && line.length > 0) {
              vectorMessage(line, errorLevel.info, indentString);
            }

            const matched = line.match(filter);
            if (matched && matched.length > 0) {
              // Improvement needed: figure out how many total subprograms
              // we are processing and set the increment properly
              progress.report({ message: matched[0], increment: 10 });
              // This is needed to allow the message window to update ...
              await new Promise<void>((r) => setTimeout(r, 0));
            }
          }
        });

        commandHandle.stderr.on("data", (data: any) => {
          stderrChunks += data.toString();
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
            vectorMessage(
              remainderTextFromLastCall,
              errorLevel.info,
              indentString
            );
          }
          vectorMessage(stderrChunks, errorLevel.info, indentString);

          commandStatus.errorCode = code;
          resolve(code);
          callback(commandStatus, enviroName, testScriptPath);
        });
      });
    }
  );
}

// This will run any clicast command on the server
export async function executeClicastCommandUsingServer(
  enviroPath: string,
  commandArgs: string
): Promise<commandStatusType> {
  let commandStatus = { errorCode: 0, stdout: "" };

  const requestObject: clientRequestType = {
    command: vcastCommandType.runClicastCommand,
    path: enviroPath,
    options: commandArgs,
  };

  let transmitResponse: transmitResponseType =
    await transmitCommand(requestObject);

  // transmitResponse.returnData is an object with exitCode and data properties
  if (transmitResponse.success) {
    commandStatus.errorCode = transmitResponse.returnData.exitCode;
    commandStatus.stdout = transmitResponse.returnData.data.trim();
  } else {
    commandStatus.errorCode = 1;
    commandStatus.stdout = transmitResponse.statusText.trim();
  }

  if (commandStatus.errorCode != 0) {
    openMessagePane();
    vectorMessage(commandStatus.stdout);
  }
  return commandStatus;
}
