import * as vscode from "vscode";

import {
  openMessagePane,
  vectorMessage,
} from "./messagePane";

import {
  getTestNode,
  testNodeType,
} from "./testData";

import {
  updateTestPane,
} from "./testPane";

import {
  commandStatusType,
  executeCommandSync,
  exeFilename,
  processExceptionFromExecuteCommand,
} from "./utilities";

import { 
  getClicastArgsFromTestNode,
  getClicastArgsFromTestNodeAsList,
} from "./vcastTestInterface";


const fs = require("fs");
const os = require("os");
const path = require("path");
const spawn = require("child_process").spawn;


const clicastName = "clicast";
export let clicastCommandToUse: string | undefined = undefined;

const vcastqtName = "vcastqt";
export let vcastCommandtoUse: string | undefined = undefined;

const atgName = "atg";
export let atgCommandToUse: string | undefined = undefined;
export let atgAvailable:boolean = false;



function vcastVersionGreaterThan (
  vcastInstallationPath:string, 
  version:number, 
  servicePack:number):boolean {

  // A general purpose version checker, will be needed for Coded Tests, etc.

  let returnValue = false;
  const toolPath = path.join (vcastInstallationPath, "DATA", "tool_version.txt");
  
  const toolVersion = fs.readFileSync(toolPath).toString().trim();
  // extract version and service pack from toolVersion (23.sp2 date)
  const matched = toolVersion.match (/(\d+)\.sp(\d+).*/);
  if (matched) {
    const tooVersion = parseInt (matched[1]);
    const toolServicePack = parseInt (matched[2]);
    if (tooVersion > version || (tooVersion == version && toolServicePack >= servicePack))
      returnValue = true;
  }
  // this allows us to work with development builds for internal testing
  else if (toolVersion.includes (" revision ")) {
    returnValue = true;
  }
  return returnValue
}


function vectorCASTSupportsATG (vcastInstallationPath:string):boolean {

  // Versions of VectorCAST between 23sp0 and 23sp4 had ATG but since
  // we changed the ATG command line interface with 23sp5, we have decided
  // to only support versions greater than that.

  return vcastVersionGreaterThan (vcastInstallationPath, 23, 5);

}


function checkForATG (vcastInstallationPath: string) {

  // we only set atgCommandToUse if we find atg and it's licensed
  const atgCommand = path.join(vcastInstallationPath, exeFilename(atgName));
  let statusMessageText = "";
  if (fs.existsSync(atgCommand)) {
    statusMessageText = `   found '${atgName}' here: ${vcastInstallationPath}`;
    const candidateCommand = atgCommand;

    // now check if its licensed ... just atg --help and check the exit code
    const commandToRun: string = `${candidateCommand} --help`;

    // cwd=working dir for this process /  printErrorDetails=false
    const commandStatus = executeCommandSync(commandToRun, process.cwd(), false);
    if (commandStatus.errorCode == 0) {
      statusMessageText += ", license is available";
      atgCommandToUse = candidateCommand;
    }
    else {
      statusMessageText += ", license is NOT available";
    }
    vectorMessage(statusMessageText);
    atgAvailable = atgCommandToUse != undefined && vectorCASTSupportsATG(vcastInstallationPath);

    // atgAvailabel is used by package.json to control the existance of the atg command in the context menus
    vscode.commands.executeCommand(
      "setContext",
      "vectorcastTestExplorer.atgAvailable",
      atgAvailable
    );
  }
  else {
    vectorMessage(`   could NOT find '${atgName}' here: ${vcastInstallationPath}`);
  }
}


export function initializeVcastUtilities(vcastInstallationPath: string) {

  let toolsFound = false;
  clicastCommandToUse = (path.join(
    vcastInstallationPath,
    exeFilename(clicastName)));

  if (fs.existsSync(clicastCommandToUse)) {
    vectorMessage(`   found '${clicastName}' here: ${vcastInstallationPath}`);
    vcastCommandtoUse = path.join(
      vcastInstallationPath,
      exeFilename(vcastqtName)
    );
    if (fs.existsSync(vcastCommandtoUse)) {
      vectorMessage(`   found '${vcastqtName}' here: ${vcastInstallationPath}`);

      // we only set toolsFound if we find clicast AND vcastqt 
      toolsFound = true;

      // atg existing or being licensed does NOT affect toolsFound
      checkForATG (vcastInstallationPath);

    }
    else {
      vectorMessage(`   could NOT find '${vcastqtName}' here: ${vcastInstallationPath}`);
    }
  }
  else {
    vectorMessage(`   could NOT find '${clicastName}' here: ${vcastInstallationPath}`);
  }
  return toolsFound;
}


function convertTestScriptContents(scriptPath: string) {
  // Read the file
  let originalLines = fs.readFileSync(scriptPath).toString().split(os.EOL);
  let newLines: string[] = [];

  // Modify the lines
  for (let line of originalLines) {
    if (line == "TEST.NEW") line = "TEST.REPLACE";
    newLines.push(line);
  }

  // Join the modified lines back into a single string
  const modifiedContent = newLines.join("\n");

  // Write the modified content back to the file
  fs.writeFileSync(scriptPath, modifiedContent, "utf8");
}


export async function openTestScript(nodeID: string) {
  // this can get called for a unit, environment, function, or test

  const testNode: testNodeType = getTestNode(nodeID);

  const enclosingDirectory = path.dirname(testNode.enviroPath);
  const scriptPath = testNode.enviroPath + ".tst";

  let commandToRun: string = `${clicastCommandToUse} ${getClicastArgsFromTestNode(
    testNode
  )} test script create ${scriptPath}`;
  const commandStatus = executeCommandSync(commandToRun, enclosingDirectory);
  if (commandStatus.errorCode == 0) {
    // Improvement needed:
    // It would be nice if vcast generated the scripts with TEST.REPLACE, but for now
    // convert TEST.NEW to TEST.REPLACE so doing an "immediate load" works without error
    convertTestScriptContents(scriptPath);

    // open the script file for editing
    vscode.workspace.openTextDocument(scriptPath).then(
      (doc: vscode.TextDocument) => {
        vscode.window.showTextDocument(doc);
      },
      (error: any) => {
        vectorMessage(error);
      }
    );
  }
}


async function adjustScriptContentsBeforeLoad(scriptPath: string) {

  // There are some things that need updating before we can load the 
  // script into VectorCAST:
  //   - The requirement key lines need to be split into two lines
  //     We insert lines like TEST.REQUIREMENT_KEY: key | description,
  //     but VectorCAST only allows the key, so we turn the description
  //     into a comment.
  //
  //   - <might be more things to do later>

  let originalLines = fs.readFileSync(scriptPath).toString().split("\n");
  let newLines: string[] = [];
  for (let line of originalLines) {
    if (line.startsWith("TEST.REQUIREMENT_KEY:")) {
      const keyLineParts = line.split("|");
      if (keyLineParts.length == 2) {
        newLines.push("-- Requirement Title: " + keyLineParts[1]);
        newLines.push(keyLineParts[0].trim());
      }
      else {
        newLines.push(line);
      }
    }
    else {
      newLines.push(line);
    }
  }
  fs.writeFileSync(scriptPath, newLines.join("\n"), "utf8");
}


export async function loadScriptIntoEnvironment(enviroName:string, scriptPath:string, ) {
 
    // this does the clicast call to laod the test script

    adjustScriptContentsBeforeLoad(scriptPath);

    const enviroArg = `-e${enviroName}`;
    let commandToRun: string = `${clicastCommandToUse} ${enviroArg} test script run ${scriptPath}`;
    const commandStatus = executeCommandSync(
      commandToRun,
      path.dirname(scriptPath)
    );
    // if the script load fails, executeCommandSync will open the message pane ...
    // if the load passes, we want to give the user an indication that it worked
    if (commandStatus.errorCode == 0) {
      vectorMessage("Script loaded successfully ...");
      // Maybe this will be annoying to users, but I think
      // it's good to know when the load is complete.
      vscode.window.showInformationMessage(`Test script loaded successfully`);

      // this API allows a timeout for the message, but I think its too subtle
      //vscode.window.setStatusBarMessage  (`Test script loaded successfully`, 5000);
    }
  }

export function generateAndLoadBasisPathTests (testNode:testNodeType) {
  // This can be called for any node, including environment nodes
  // In all caeses, we need to do the following:
  //  - Call clicast <-e -u -s options> tool auto_test temp.tst  [creates tests]
  //  - Call loadScriptIntoEnvironment() to do the actual load
  // 
  // Other Points:
  //   - Use a temporary filename and ensure we delete it
   
  const enclosingDirectory = path.dirname(testNode.enviroPath);
  const timeStamp = Date.now().toString();
  const tempScriptPath = path.join (enclosingDirectory, `vcast-${timeStamp}.tst`);

  vectorMessage ("Generating Basis Path script file ...");
  // ignore the testName (if any)
  testNode.testName = "";

  // executeClicastWithProgress() uses spawn() which needs the args as a list
  let argList: string[] = [];
  argList.push (`${clicastCommandToUse}`);
  argList = argList.concat (getClicastArgsFromTestNodeAsList(testNode));
  argList = argList.concat (["tool", "auto_test", `${tempScriptPath}`]);

  // Since it can be slow to generate basis path tests, we use a progress dialog
  // and since we don't want to show all of the stdout messages, we use a 
  // regex filter for what to show
  const messageFilter = /.*Generating test cases for.*/;

  executeClicastWithProgress(
    "",
    argList, 
    testNode.enviroName, 
    tempScriptPath, 
    messageFilter, 
    loadScriptCallBack);
}


export function generateAndLoadATGTests (testNode:testNodeType) {
  // This can be called for any node, including environment nodes
  // In all caeses, we need to do the following:
  //  - Call atg <-e -u -s options> temp.tst  [creates tests]
  //  - Call loadScriptIntoEnvironment() to do the actual load

  // Other points:
  //   - Use a temporary filename and ensure we delete it.
  //   - ATG can be slowish, so we need a status dialog

  const enclosingDirectory = path.dirname(testNode.enviroPath);
  const timeStamp = Date.now().toString();
  const tempScriptPath = path.join (enclosingDirectory, `vcast-${timeStamp}.tst`);

  vectorMessage ("Generating ATG script file ...");
  // ignore the testName (if any)
  testNode.testName = "";

  // executeClicastWithProgress() uses spawn() which needs the args as a list
  let argList: string[] = [];
  argList.push (`${atgCommandToUse}`);
  argList = argList.concat (getClicastArgsFromTestNodeAsList(testNode));

  // -F tells atg to NOT use regex for the -s (sub-program) option
  // since we always use the "full" sub-program name, we always set -F
  argList.push ("-F");

  // if we are using over-loaded syntax, then we need to add the -P (parameterized) option
  if (testNode.functionName.includes ("(")) {
    argList.push ("-P");
    }
  argList.push (`${tempScriptPath}`);

  // Since it can be slow to generate ATG tests, we use a progress dialog
  // and since we don't want to show all of the stdout messages, we use a 
  // regex filter for what to show
  const messageFilter = /Subprogram:.*/;

  executeClicastWithProgress(
    "Generating ATG Tests: ",
    argList, 
    testNode.enviroName, 
    tempScriptPath, 
    messageFilter, 
    loadScriptCallBack);

  }

export function loadScriptCallBack (commandStatus:commandStatusType, enviroName:string, scriptPath:string) {
  // This is the callback that should be passed to executeClicastWithProgress() when
  // we are computing basis path or ATG tests

  if (commandStatus.errorCode == 0) {
    vectorMessage("Loading tests into VectorCAST environment ...");
    loadScriptIntoEnvironment(enviroName, scriptPath);
    const enviroPath = path.join (path.dirname (scriptPath), enviroName);
    vectorMessage( `Deleteting script file: ${path.basename (scriptPath)}`);
    updateTestPane(enviroPath);
    fs.unlinkSync(scriptPath);  
  }
  else {
    vscode.window.showInformationMessage(`Error generating tests, see log for details`);
    vectorMessage (commandStatus.stdout);
    openMessagePane();
  }
}

export function executeClicastCommand(
  argList: string[],
  CWD: string,
  callback?: any,
  enviroPath?: string
) {
  // this function is used to build and rebuild environments
  // long running commands that where we want to show real-time output

  // it uses spawn to execute a clicast command, log the output to the
  // message pane, and update the test explorer when the command completes

  // To debug what's going on with vcast, you can add -dall to
  // argList, which will dump debug info for the clicast invocation
  let clicast = spawn(clicastCommandToUse, argList, { cwd: CWD });
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
      if (line.length>0) {
        vectorMessage(line.replace (/\n/g, ""));
      }
    }
  });

  clicast.stdout.on("close", function (code: any) {
    vectorMessage("-".repeat(100));
  });

  clicast.on("exit", function (code: any) {
    vectorMessage("-".repeat(100));
    vectorMessage(
      `${clicastName}: '${argList.join(
        " "
      )}' returned exit code: ${code.toString()}`
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
function processCommandOutput (
  remainderTextFromLastCall: string, 
  newTextFromThisCall: string): statusMessageType {

  // The purpose of this function is to process the raw text that comes
  // from the spawned process and to split it into full lines and a "remainder"
  // The caller will keep the remainder around until the next data comes in
  // and then pass that in with the new text.

  let returnObject:statusMessageType = { fullLines: "", remainderText: "" };
  const candidateString = remainderTextFromLastCall + newTextFromThisCall;

  if (candidateString.endsWith ("\n"))
    // if we got all full lines, there is no remainder
    returnObject.fullLines = candidateString.slice (0, candidateString.length-1);
  else if (candidateString.includes ("\n")) {
    // if there is at least one \n then we have full lines and a remainder
    const whereToSplit = candidateString.lastIndexOf("\n");
    returnObject.fullLines = candidateString.substring(0,whereToSplit);
    returnObject.remainderText = candidateString.substring(whereToSplit+1,candidateString.length);
  }
  else {
    // otherwise we have only a remainder
    returnObject.remainderText = candidateString;
  }
  
  return returnObject;
}


export function executeClicastWithProgress (
  title: string,
  commandAndArgs: string[],
  enviroName: string,
  testScriptPath: string,
  filter: RegExp,
  callback: any
  ) {

  // Very similar to the executeClicastCommand(), but adds a progress dialog,
  // and a different callback structure.
  // We use this for generating the basis path and ATG tests (for now)

  vectorMessage (`Executing command: ${commandAndArgs.join (" ")}`);
  let commandStatus:commandStatusType = { errorCode: 0, stdout: "" };

  const cwd =  path.dirname(testScriptPath);
  const command = commandAndArgs[0];
  const args = commandAndArgs.slice(1,commandAndArgs.length);

  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: title,
      cancellable: false,
    },
    async (progress) => {
  
      return new Promise (async (resolve, reject) => {

        // shell is needed so that stdout is NOT buffered
        const commandHandle = spawn(command, args, { cwd: cwd, shell: true });

        // each time we get an entry here, we need to check if we have a 
        // partial message if so we print the part up the the 
        // final \n and buffer the rest, see comment above
        let remainderTextFromLastCall = "";

        commandHandle.stdout.on("data", async (data: any) => {
        
          const message:statusMessageType = 
            processCommandOutput (remainderTextFromLastCall, data.toString());
          remainderTextFromLastCall = message.remainderText;
          
          if (message.fullLines.length > 0) {
            vectorMessage(message.fullLines);

            // for the dialog, we want use the filter to decide what to show
            // and this requires the message data to be split into single lines
            const lineArray = message.fullLines.split ("\n");
            for (const line of lineArray) {
              const matched = line.match (filter);
              if (matched && matched.length > 0) {
                progress.report({ message: matched[0], increment:10 });
                // This is needed to allow the message window to update ...
                await new Promise<void>((r) => setTimeout(r, 0));
              }
            }
          }
        });
      
        commandHandle.stderr.on("data", async (data: any) => {
          const message:statusMessageType = 
            processCommandOutput (remainderTextFromLastCall, data.toString(data));
          remainderTextFromLastCall = message.remainderText;
          
          if (message.fullLines.length > 0) {
            vectorMessage(message.fullLines);
          }
        });
      
        commandHandle.on("error", (error: any) => {
          commandStatus = 
            processExceptionFromExecuteCommand (
              commandAndArgs.join (" "),
              error, 
              true);
        });
        commandHandle.on("close", (code: any) => {
          // display any remaining text ...
          if (remainderTextFromLastCall.length > 0) {
            vectorMessage (remainderTextFromLastCall);
          }
          commandStatus.errorCode = code;
          resolve (code);
          callback (commandStatus, enviroName, testScriptPath);
        });
      
      }
    );
  });
}


export function getEnviroNameFromFile (filePath:string):string|undefined {
  // This funciton will extract the enviro name from 
  // the ENVIRO.NAME: <name> line of the provided file

  let enviroName: string|undefined = undefined;

  // load the contents of filePath, find the ENVIRO.NAME: line
  // and return the value after the colon
  const fileContents = fs.readFileSync(filePath).toString();
  const lines = fileContents.split("\n");
  for (let line of lines) {
    if (line.startsWith("ENVIRO.NAME:")) {
      enviroName = line.split(":")[1].trim();
      break;
    }
  }

  return enviroName;
}
