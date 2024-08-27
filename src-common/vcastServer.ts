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
  clicast?: string;
  test?: string;
  options?: string;
}

function serverURL() {
  return `http://${HOST}:${PORT}`;
}

// IMPORTANT: This global data object is used in two different
// places in the extension. It is used by:
//    The Language Server via pythonUtilities.ts
//    The Core Extension via vcastAdapter.ts, client.ts etc.
//
// Since therse are two different executables, they are
// not sharing the same instance of this object.  But since
// they both use transmitCommand() defined below, the
// auto-off processing works for both.
//
export let globalEnviroDataServerActive: boolean = false;

export function setServerState(newState: boolean) {
  globalEnviroDataServerActive = newState;
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
  route = "vassistant"
) {
  // TBD: is this the right way to do this, or can I send a class directly?

  // request is a class, so we convert it to a dictionary, then a string
  const dataAsString = JSON.stringify(requestObject);
  const urlToUse = `${serverURL()}/${route}?request=${dataAsString}`;
  // TBD TODAY - is there a way to send this to our message pane?
  console.log (`transmitCommand: ${serverURL()}, ${requestObject.command}`);
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
        transmitResponse.statusText = `\nCould not start clicast instance, disabling server mode for this session\n`;
        // fall back to non server mode
        setServerState(false);
        //
      } else {
        transmitResponse.success = true;
        transmitResponse.statusText = `Enviro server response status: ${response.statusText}`;
        // the format of the data property is different baesd on the command
        // so it is up to the caller to interpret it properly
        transmitResponse.returnData = rawReturnData;
        // there is alays an exit code field but it is only used when
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
    });
  return transmitResponse;
}