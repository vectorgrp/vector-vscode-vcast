// proof of concept for interacting with a running environment data server

import fetch from "node-fetch";
import { pythonErrorCodes } from "./vcastServerTypes";

let HOST = "localhost"; // The server's hostname or IP address
let PORT = 60461; // The port used by the server anything > 1023 is OK

// Types used for interaction with the python interface and the enviro server
//
// Note: some of these match the --mode argument for the vTestInterface.py but
// some of these (like ping) are for the enviro server only
//
// Note: this enum must stay in sync with the server file: vcastDataServerTypes.py: commandType.

export enum vcastCommandType {
  ping = "ping",
  shutdown = "shutdown",
  closeConnection = "closeConnection",
  runClicastCommand = "runClicastCommand",
  getEnviroData = "getEnviroData",
  rebuild = "rebuild",
  executeTest = "executeTest",
  report = "report",
  parseCBT = "parseCBT",
  choiceListTst = "choiceList-tst",
  choiceListCT = "choiceList-ct",
}

export interface clientRequestType {
  command: vcastCommandType;
  path: string;
  test?: string;
  options?: string;
}

function serverURL() {
  return `http://${HOST}:${PORT}`;
}

// IMPORTANT: This file is used by two different executables
// and called from two different places:
//    The Language Server calls via pythonUtilities.ts
//    The Core Extension calls via vcastAdapter.ts, client.ts etc.
//
// Since these are two different executables, they are
// not sharing the same instance of these objects.  But since
// they both use transmitCommand() defined below, the
// auto-off processing works for both.
//
export let globalEnviroDataServerActive: boolean = false;

export function setServerState(newState: boolean) {
  globalEnviroDataServerActive = newState;
}

// To allow us to update the test pane when we have a server
// fall back error we set this callback during extension initialization,
// and  use it in the transmitCommand error handling below.
//
// Note that the callback is only populated for the core extension
// this means that there will be no message displayed when the
// language server is running in server mode and the server goes down.
// This is ok because after fall back things should work if the
// user just types the "." ":" or whatever to trigger the completion.
//
let terminateServerCallback: any = undefined;
export function setTerminateServerCallback(callback: any) {
  terminateServerCallback = callback;
}
function terminateServerProcessing() {
  // this function indirectly calls terminateServerProcessing()
  // in the core extension case.
  if (terminateServerCallback) {
    terminateServerCallback();
  }
}

// Similar to the above, we set this callback during extension initialization
// to allow transmitCommand to log to the output pane.
let logServerCommandsCallback: any = undefined;
export function setLogServerCommandsCallback(callback: any) {
  logServerCommandsCallback = callback;
}
function logServerCommand(message: string) {
  if (logServerCommandsCallback) {
    // for the core extension we send this to the message pane
    logServerCommandsCallback(message);
  }
}

export interface transmitResponseType {
  success: boolean;
  returnData: any;
  statusText: string;
}

// This closes the connection to a clicast instance so that other commands
// like rebuild or delete environment can be run
export async function closeConnection(enviroPath: string): Promise<boolean> {
  let requestObject: clientRequestType = {
    command: vcastCommandType.closeConnection,
    path: enviroPath,
  };

  const transmitResponse: transmitResponseType =
    await transmitCommand(requestObject);
  return transmitResponse.success;
}

export async function serverIsAlive() {
  //
  const pingObject: clientRequestType = {
    command: vcastCommandType.ping,
    path: "",
  };

  const transmitResponse: transmitResponseType = await transmitCommand(
    pingObject,
    "ping"
  );
  return transmitResponse.success;
}

// This does the actual fetch from the server
export async function transmitCommand(
  requestObject: clientRequestType,
  route = "vcastserver"
) {
  // request is a class, so we convert it to a dictionary, then a string
  const dataAsString = JSON.stringify(requestObject);
  const urlToUse = `${serverURL()}/${route}?request=${dataAsString}`;
  logServerCommand(
    `Sending command: "${requestObject.command}" to server: ${serverURL()},`
  );
  let transmitResponse: transmitResponseType = {
    success: false,
    returnData: undefined,
    statusText: "",
  };

  await fetch(urlToUse)
    .then(async (response) => {
      // the server always returns an object with exitCode and data properties
      const rawReturnData: any = await response.json();

      if (rawReturnData.exitCode == pythonErrorCodes.internalServerError) {
        // the error message is a list of strings, so join with \n
        transmitResponse.success = false;
        transmitResponse.statusText = `Enviro server error: ${rawReturnData.data.error.join(
          "\n"
        )}`;
        //
      } else if (
        rawReturnData.exitCode == pythonErrorCodes.testInterfaceError
      ) {
        // the error message is a list of strings, so join with \n
        transmitResponse.success = false;
        // format the error message for readability, with new lines and indentation
        transmitResponse.statusText = `Python interface error: \n   ${rawReturnData.data.text.join(
          "\n   "
        )}`;
        //
      } else if (
        rawReturnData.exitCode == pythonErrorCodes.couldNotStartClicastInstance
      ) {
        transmitResponse.success = false;
        transmitResponse.statusText = `Server could not start clicast instance`;
        // fall back to non-server mode
        setServerState(false);
        // this callback will display an error message and update the test pane
        terminateServerProcessing();
      } else {
        transmitResponse.success = true;
        transmitResponse.statusText = `Enviro server response status: ${response.statusText}`;
        // the format of the data property is different based on the command
        // so it is up to the caller to interpret it properly
        transmitResponse.returnData = rawReturnData;
        // there is always an exit code field but it is only used when
        // executing tests or running clicast commands
      }
    })
    .catch((error) => {
      let errorDetails = error.message.split("reason:")[1].trim();
      // for some reason, when the server is down, the reason is blank
      // so we insert a generic message in this case.
      if (errorDetails.length === 0) {
        errorDetails = "Server is not running";
      }
      transmitResponse.success = false;
      transmitResponse.statusText = `Enviro server error: ${errorDetails}, disabling server mode for this session`;
      // fall back to non server mode
      setServerState(false);
      // this callback will display an error message and update the test pane
      terminateServerProcessing();
    });
  return transmitResponse;
}
