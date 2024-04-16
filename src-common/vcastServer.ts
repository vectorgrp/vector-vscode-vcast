// proof of concept for interacting with a running environment data server

import fetch from "node-fetch";


let HOST = "localhost"; // The server's hostname or IP address
let PORT = 60461; // The port used by the server anything > 1023 is OK

// Types used for interaction with the python interface and the enviro server
//
// Note: some of these match the --mode argument for the vTestInterface.py but
// some of these (like ping) are for the enviro server only
//
// Note: this enum must stay in sync with the server file: dataTypes.py: commandType.

export enum vcastCommandType {
  ping = "ping",
  shutdown = "shutdown",
  closeConnection = "closeConnection",
  runClicastCommand = "runClicastCommand",
  getEnviroData = "getEnviroData",
  rebuild = "rebuild",
  executeTest = "executeTest",
  executeTestReport = "executeTestReport",
  report = "report",
  parseCBT = "parseCBT",
  choiceList = "choiceList",
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

export interface transmitResponseType {
  success: boolean;
  returnData: any;
  statusText: string;
}

// This does the actual fetch from the server
export async function transmitCommand(requestObject: clientRequestType) {
  // TBD: is this the right way to do this, or can I send a class directly?

  // request is a class, so we convert it to a dictionary, then a string
  const dataAsString = JSON.stringify(requestObject);
  const urlToUse = `${serverURL()}/vassistant?request=${dataAsString}`;
  let transmitResponse: transmitResponseType = {
    success: false,
    returnData: undefined,
    statusText: "",
  };

  await fetch(urlToUse)
    .then(async (response) => {
      transmitResponse.success = true;
      transmitResponse.statusText = `Enviro server response status: ${response.statusText}`;
      transmitResponse.returnData = await response.json();
    })
    .catch((error) => {
      transmitResponse.statusText = `Enviro server error: ${
        error.message.split("reason:")[1]
      }`;
    });
  return transmitResponse;
}

