// proof of concept for interacting with a running environment data server

import fetch from "node-fetch";


let HOST = "localhost"; // The server's hostname or IP address
let PORT = 60461; // The port used by the server anything > 1023 is OK

    
// types used for interaction with the python interfaces and the enviro server  
export enum vcastCommandType {
  ping = "ping",
  shutdown = "shutdown",
  closeConnection = "closeConnection",
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
  clicast: string;
  path: string;
  test: string;
  options: string;
}


function serverURL() {
  return `http://${HOST}:${PORT}`;
}

export interface transmitResponseType {
  success:boolean,
  returnData:any,
  statusText:string,
}
export async function transmitCommand(requestObject: clientRequestType) {
  // TBD: is this the right way to do this, or can I send a class directly?

  // request is a class, so we convert it to a dictionary, then a string
  const dataAsString = JSON.stringify(requestObject);
  const urlToUse = `${serverURL()}/vassistant?request=${dataAsString}`;
  let transmitResponse:transmitResponseType = {success: false, returnData:undefined, statusText:""};

  await fetch(urlToUse)
    .then(async (response) => {
      transmitResponse.success = true;
      transmitResponse.statusText = (`Enviro server response status: ${response.statusText}`);
      transmitResponse.returnData = await response.json();
    })
    .catch((error) => {
      transmitResponse.statusText =  `Enviro server error: ${error.message.split ("reason:")[1]}`;
    });
  return transmitResponse;
}
