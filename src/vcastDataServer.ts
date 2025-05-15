import * as vscode from "vscode";
import { spawn } from "child_process";

import {
  sendPortNumberToLanguageServer,
  sendServerStateToLanguageServer,
} from "./client";

import { useServerOption } from "./configuration";

import { errorLevel, vectorMessage } from "./messagePane";
import { refreshAllExtensionData } from "./testPane";

import {
  getGlobalEnviroDataServerPath,
  isEnviroDataServerAvailable,
  toolVersionType,
  vcastInstallationVersion,
  vPythonCommandToUse,
} from "./vcastInstallation";

import {
  serverIsAlive,
  setGLobalServerState,
  setLogServerCommandsCallback,
  setServerPort,
  setTerminateServerCallback,
  sendShutdownToServer,
} from "../src-common/vcastServer";

const os = require("os");
const fs = require("fs");

let serverStatusBarObject: vscode.StatusBarItem;

async function terminateServerProcessing(errorText: string) {
  // This functions gets called by server transmitCommand()
  // when there is a fatal server error.  In this case, we
  // stop the server, refresh the test pane, and display
  // a pop up error message to tell the user we have fallen
  // back to non server mode.

  const errorMessage = `Fatal VectorCAST Data Server error, disabling server mode for this session.\n   [${errorText}]`;
  vectorMessage(errorMessage);

  await stopServer();

  await refreshAllExtensionData();

  vscode.window.showErrorMessage(
    errorMessage +
      "Disabling Server Mode for this Session.  " +
      "The previous command was discarded, and the " +
      "Testing Pane has been reloaded"
  );
}

function logServerCommands(text: string) {
  // This function gets called by server - transmitCommand ()
  // It is implemented as a callback because the server is
  // used by both the core extension and the language server
  vectorMessage(text, errorLevel.trace);
}

export enum serverStateType {
  stopped = "stopped",
  running = "running",
}

let enviroDataServerProcessState: serverStateType = serverStateType.stopped;

// when we start a new server instance we save away the vcast version
// so that we don't stop and restart if the tool version
// has not changed when we see a "start" command
let serverVersion: toolVersionType = { version: 0, servicePack: 0 };

let serverProcessObject: any = undefined;
// used to control the availability of the openLogFile command
let serverLogFilePath: string = "";

export function displayServerLog() {
  // When the server is running the command:
  // "VectorCAST: Open the VectorCAST Data Server log" will call this function
  if (serverLogFilePath.length > 0) {
    vscode.workspace.openTextDocument(serverLogFilePath).then((doc) => {
      vscode.window.showTextDocument(doc);
    });
  }
}

export async function deleteServerLog() {
  if (fs.existsSync(serverLogFilePath)) {
    fs.unlinkSync(serverLogFilePath);
  }
}

async function completeServerStartup(serverCWD: string, portNumber: number) {
  // This function is called when the server has started and we have the port number
  // Note that the "started" message is sent to the

  setServerPort(portNumber);

  if (await serverIsAlive()) {
    vectorMessage(
      `Started VectorCAST Data Server. Directory: ${serverCWD} | Port: ${portNumber} | PID: ${serverProcessObject.pid}`
    );
    enviroDataServerProcessState = serverStateType.running;
    setGLobalServerState(true);
    sendPortNumberToLanguageServer(portNumber);
    sendServerStateToLanguageServer(true);
    serverStatusBarObject.text = "vDataServer On";
    serverVersion = vcastInstallationVersion;
  } else {
    vectorMessage(
      `Error starting VectorCAST Data Server on port: ${portNumber}`
    );
    setGLobalServerState(false);
    sendServerStateToLanguageServer(false);
    serverStatusBarObject.text = "vDataServer Off";
  }
}

function whereToStartServer(): string {
  // if a workspace is open then we start the server in the root
  // otherwise we start in the temp directory
  let whatToReturn: string = "";
  if (vscode.workspace.workspaceFolders) {
    whatToReturn = vscode.workspace.workspaceFolders[0].uri.fsPath;
  } else {
    whatToReturn = os.tmpdir();
  }
  return whatToReturn;
}

async function startServer(): Promise<void> {
  // This does the actual work of server startup
  // We wrap the whole spawn + stdout‐watch in a Promise so that
  // our callers can truly await “server is listening on its port.”

  return new Promise((resolve, reject) => {
    // we use spawn directly to control the detached and shell args
    const vpythonArgs: string[] = [getGlobalEnviroDataServerPath()];
    const serverCWD = whereToStartServer();

    serverProcessObject = spawn(vPythonCommandToUse, vpythonArgs, {
      shell: true,
      cwd: serverCWD,
    });

    // If the spawn itself fails (e.g. binary not found, permissions),
    // reject immediately so callers see the failure.
    serverProcessObject.on("error", (err: any) => {
      //propagate spawn errors through the Promise
      reject(err);
    });

    serverProcessObject.stdout.on("data", async (data: Buffer) => {
      const rawString = data.toString();
      const lineArray = rawString.split(/[\n\r?]+/);

      for (const line of lineArray) {
        // listen to the stdout to retrieve the port number
        // Note: this must match what is in vcastDataServer.py -> main()

        if (line.startsWith(" * vcastDataServer is starting on")) {
          const portString = line.split(":")[1];
          const portNumber = parseInt(portString, 10);
          await completeServerStartup(serverCWD, portNumber);
        } else if (line.startsWith(" * Server log file path:")) {
          serverLogFilePath = line.split("path:")[1].trim();
          // this call controls the availability of the "openLogFile" command
          vscode.commands.executeCommand(
            "setContext",
            "vectorcastTestExplorer.serverLogAvailable",
            fs.existsSync(serverLogFilePath)
          );
        }
      }

      // New: now that we’ve seen the “server is starting on” line,
      // we know the server is up—resolve the Promise so all awaits unblock.
      resolve();
      return;
    });

    // New: if the process exits before we ever saw the “starting” line,
    // reject so initializeVcastDataServer doesn’t hang forever.
    serverProcessObject.on("exit", (code: any, signal: any) => {
      reject(
        new Error(
          `Data server exited prematurely (code=${code}, signal=${signal})`
        )
      );
    });
  });
}

async function stopServer() {
  vectorMessage("Shutting down VectorCAST Data Server ...");
  // we send shutdown to the server, but it cannot respond because it "ends" itself
  // which closes the socket ... which means we cannot read a response, so we just
  // use the processID to check if it is "gone" ... which maybe is overkill

  // failsafe check so that we don't get into an infinite loop
  if (enviroDataServerProcessState == serverStateType.running) {
    await sendShutdownToServer();
    enviroDataServerProcessState = serverStateType.stopped;
    serverStatusBarObject.text = "vDataServer Off";
    setServerPort(0);
    setGLobalServerState(false);
    sendServerStateToLanguageServer(false);
    // this call controls the availability of the "openLogFile" command
    vscode.commands.executeCommand(
      "setContext",
      "vectorcastTestExplorer.serverLogAvailable",
      false
    );
  }
}

export async function serverProcessController(newState: serverStateType) {
  //
  // This function will be called to start and stop the vcast data server
  // it should be called with the newState that the caller wants, and all
  // of the edge cases will be handled here ... see inline comments
  //
  // Example call contexts
  //     - initialization - to start the server
  //     - user action to start or stop server
  //     - useServer option change on or off
  //

  // if a server ia already running, check if is is the same version
  // as the vcast installation, if so nothing needs to be done.
  // There can be a miss-match if the server was started on initialization
  // and then the user changes the vcast installation version
  if (
    enviroDataServerProcessState == serverStateType.running &&
    newState == serverStateType.running
  ) {
    if (
      vcastInstallationVersion.version == serverVersion.version &&
      vcastInstallationVersion.servicePack == serverVersion.servicePack
    ) {
      vectorMessage("Using already running VectorCAST Data Server");
    } else {
      await stopServer();
    }
  }

  if (
    enviroDataServerProcessState == serverStateType.running &&
    newState == serverStateType.stopped
  ) {
    await stopServer();
  }

  if (
    enviroDataServerProcessState == serverStateType.stopped &&
    newState == serverStateType.running
  ) {
    await startServer();
  }
}

export async function toggleDataServerState() {
  if (enviroDataServerProcessState == serverStateType.running) {
    await serverProcessController(serverStateType.stopped);
  } else {
    await serverProcessController(serverStateType.running);
  }
}

export async function initializeServerState() {
  // This function should be called:
  //     - on startup
  //     - when the vcast installation directory is changed
  //     - when the useServer option is changed

  if (useServerOption()) {
    if (isEnviroDataServerAvailable()) {
      serverStatusBarObject.show();
      await serverProcessController(serverStateType.running);
    } else {
      serverStatusBarObject.hide();
      await serverProcessController(serverStateType.stopped);
    }
  } else {
    serverStatusBarObject.hide();
    await serverProcessController(serverStateType.stopped);
  }
}

export async function initializeVcastDataServer() {
  // This function is called once on extension startup to do
  // all of the one-off server initialization tasks
  setTerminateServerCallback(terminateServerProcessing);
  setLogServerCommandsCallback(logServerCommands);

  // we unconditionally create the status bar item and
  // setup the callbacks but we only start the server
  // and show the status bar if the vcast installation
  // supports server mode
  serverStatusBarObject = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    10
  );
  serverStatusBarObject.command =
    "vectorcastTestExplorer.toggleVcastServerState";

  // This takes care of starting the server and displaying
  // the status bar item (if appropriate)
  await initializeServerState();
}
