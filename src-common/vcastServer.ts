import fetch from "node-fetch";
import { pythonErrorCodes } from "./vcastServerTypes";

// Types used for interaction with the python interface and the enviro server
//
// Note: some of these match the --mode argument for the vTestInterface.py but
// some of these (like ping) are for the enviro server only
//
// Note: this enum must stay in sync with the server file: vcastDataServerTypes.py: commandType.
// If we find that we are changing this type frequently we might want to auto-generate
// this type from a common configuration file.

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

// This is set when the VectorCAST Data Server process is started
let SERVER_PORT: number = 0;

export function setServerPort(port: number) {
  SERVER_PORT = port;
}

/**
 * @testing This function is exported for testing purposes only.
 * Returns the server URL used in API calls.
 */
export function serverURL() {
  let SERVER_HOST = "localhost";

  return `http://${SERVER_HOST}:${SERVER_PORT}`;
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

export function setGLobalServerState(newState: boolean) {
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

/**
 * @testing This function is exported for testing purposes only.
 * It indirectly calls terminateServerProcessing() in the core extension case.
 */
export async function terminateServerProcessing(errorText: string) {
  // this function indirectly calls terminateServerProcessing()
  // in the core extension case.
  if (terminateServerCallback) {
    await terminateServerCallback(errorText);
  }
}

// Similar to the above, we set this callback during extension initialization
// to allow transmitCommand to log to the output pane.
let logServerCommandsCallback: any = undefined;
export function setLogServerCommandsCallback(callback: any) {
  logServerCommandsCallback = callback;
}

/**
 * @testing This function is exported for testing purposes only.
 * Logs the server command by calling the logServerCommandsCallback.
 */
export function logServerCommand(message: string) {
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
  // This is used to determine if the server is running after startup.
  // Because the server emits the "starting message" before starting
  // flask, there will be a slight delay between us getting the
  // port via stdout and the server being ready to accept requests
  // so we loop here until the ping works, or 3 seconds have elapsed.
  const pingObject: clientRequestType = {
    command: vcastCommandType.ping,
    path: "",
  };

  const startTime = Date.now();
  let transmitResponse: transmitResponseType;
  while (true) {
    transmitResponse = await transmitCommand(pingObject, "ping");
    if (transmitResponse.success) {
      break;
    } else if (Date.now() > startTime + 3000) {
      logServerCommand("Server timed out on startup, did not answer ping");
      break;
    } else {
      // wait for 200ms before trying again
      logServerCommand("Server not ready, waiting 200ms ...");
      await new Promise<void>((r) => setTimeout(r, 200));
    }
  }

  return transmitResponse.success;
}

export async function sendShutdownToServer() {
  //
  const shutdownObject: clientRequestType = {
    command: vcastCommandType.shutdown,
    path: "",
  };

  await transmitCommand(shutdownObject, "shutdown");
}

// This does the actual fetch from the server
export async function transmitCommand(
  requestObject: clientRequestType,
  route: string = "runcommand"
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
        // if we get a test interface error, we report the error but do not
        // terminate the server, since it might be a one off error.
        // Maybe we will change this in the future.
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
        // If we cannot start clicast, we shutdown the server because this error
        // is unlikely to be cleared by trying again
      } else if (
        rawReturnData.exitCode == pythonErrorCodes.couldNotStartClicastInstance
      ) {
        transmitResponse.success = false;
        transmitResponse.statusText = `Server could not start clicast instance`;
        // fall back to non-server mode
        setGLobalServerState(false);
        // this callback will display an error message and update the test pane
        await terminateServerProcessing(transmitResponse.statusText);
        //
        // else the command was successful so we return the data
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
    //
    // if there is a communication error with the server it gets caught here
    .catch(async (error) => {
      // In the shutdown and ping cases we simply return a false success status,
      // because in the shutdown case, the socket may be closed before  we
      // read the response, and in the ping case, the server may not be
      // ready yet and the caller will retry the ping.
      if (
        requestObject.command == vcastCommandType.shutdown ||
        requestObject.command == vcastCommandType.ping
      ) {
        transmitResponse.success = false;
      } else {
        // For all other communication errors, we terminate server mode
        let errorText = error.message.split("reason:")[1].trim();
        // for some reason, when the server is down, the reason is blank
        // so we insert a generic message in this case.
        if (errorText.length === 0) {
          errorText = `cannot communicate with server on port: ${SERVER_PORT}`;
        }
        let errorDetails = `command: ${requestObject.command}, error: ${errorText}`;
        transmitResponse.success = false;
        transmitResponse.statusText = `Enviro server error: ${errorDetails}`;

        // this callback will shutdown the server, display an error message
        // and update the test pane, etc.
        await terminateServerProcessing(errorDetails);
      }
    });
  return transmitResponse;
}
