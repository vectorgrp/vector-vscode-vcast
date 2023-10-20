import * as vscode from "vscode";

import {
  vectorMessage,
} from "./messagePane";

import {
  getTestNode,
  testNodeType,
} from "./testData";

import {
  executeCommand,
  exeFilename,
} from "./utilities";

import { getClicastArgsFromTestNode } from "./vcastTestInterface";


const fs = require("fs");
const os = require("os");
const path = require("path");
const spawn = require("child_process").spawn;


const clicastName = "clicast";
export let clicastCommandToUse: string | undefined = undefined;

const vcastqtName = "vcastqt";
export let vcastCommandtoUse: string | undefined = undefined;


export function initializeClicastUtilities(vcastInstallationPath: string) {

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
      toolsFound = true;
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
  const commandStatus = executeCommand(commandToRun, enclosingDirectory);
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
    const commandStatus = executeCommand(
      commandToRun,
      path.dirname(scriptPath)
    );
    // if the script load fails, executeCommand will open the message pane ...
    // if the load passes, we want to give the user an indication that it worked
    if (commandStatus.errorCode == 0) {
      vectorMessage("Script loaded successfully ...");
      // Maybe this will be annoying to users, but I think
      // it's good to know when the load is complete.
      vscode.window.showInformationMessage(`Test script loaded successfully`);
    }
  }


export async function insertBasisPathTests(testNode: testNodeType) {
  // This can be called for any node, including environment nodes
  // In all caeses, we need to do the following:
  //  - Call clicast <-e -s -t options> tool auto_test temp.tst  [creates tests]
  //  - Call clicast <-e option> test script run temp.tst        [loads tests]
  // Must use a temporary filename and ensure we deleted it.
    
  vectorMessage ("hello");
  
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
    vectorMessage(data.toString().replace(/[\n]/g, ""));
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
    if (callback) callback(enviroPath, code);
  });
}