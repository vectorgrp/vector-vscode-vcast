// proof of concept for interacting with a running environment data server

import fetch from "node-fetch";

import { errorLevel, vectorMessage } from "./messagePane";

import { clientRequestType } from "./vcastUtilities";

let HOST = "localhost"; // The server's hostname or IP address
let PORT = 60461; // The port used by the server anything > 1023 is OK

function serverURL() {
  return `http://${HOST}:${PORT}`;
}

export async function transmitCommand(requestObject: clientRequestType) {
  // TBD: is this the right way to do this, or can I send a class directly?

  // request is a class, so we convert it to a dictionary, then a string
  const dataAsString = JSON.stringify(requestObject);
  const urlToUse = `${serverURL()}/vassistant?request=${dataAsString}`;

  let returnData: any = undefined;
  await fetch(urlToUse)
    .then(async (response) => {
      vectorMessage(
        `Enviro server response status: ${response.statusText}`,
        errorLevel.trace
      );
      returnData = await response.json();
    })
    .catch((error) => {
      vectorMessage(`Enviro server error: ${error.message}`);
    });
  return returnData;
}
