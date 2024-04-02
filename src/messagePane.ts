// Copied from TypeCheck, should be merged

import * as vscode from "vscode";
import { getMessagePane } from "./extension";
// This file contains functions that allow the extension to log
// status to a dedicated output pane in VSCode

// I created this simple wrapper in case we add other features

// This object creates a new output pane in the running extension
// To access: View -> Output, then choose "Output" tab, and pull
// down on the list to the right until you see vTestAdvisor

// duplicated from VTC ////////////////////////
export enum errorLevel {
  error = "[error]",
  warn = "[warn] ",
  info = "[info] ",
  trace = "[trace]",
}

function formattedLine(
  prefix: string,
  line: string,
  level: errorLevel
): string {
  let returnString: string = "";
  returnString = prefix.padEnd(15) + level.padEnd(8) + line;
  return returnString;
}

async function displayMessage(prefix: string, msg: string, level: errorLevel) {
  const messagePane = getMessagePane();
  let stringList = msg.split("\n");
  // for errorLevel.error, we show the first line of the msg in a popup
  if (level == errorLevel.error) {
    vscode.window.showErrorMessage(stringList[0]);
  }
  for (let line of stringList) {
    messagePane.appendLine(formattedLine(prefix, line, level));
  }
}

// duplicated from VTC ////////////////////////

// Note that this is an aysnc function so to if you are using to display
// a message before a long-running process, use await in the caller.
export async function vectorMessage(
  msg: string,
  level: errorLevel = errorLevel.info
) {
  if (
    level != errorLevel.trace ||
    (level == errorLevel.trace && globalVerboseOn)
  ) {
    displayMessage("test explorer", msg, level);
  }
}

export function vcastMessage(msg: string, level: errorLevel = errorLevel.info) {
  if (globalVerboseOn) displayMessage("vectorcast", msg, level);
}

let globalVerboseOn: boolean = false;
export function adjustVerboseSetting() {
  const settings = vscode.workspace.getConfiguration("vectorcastTestExplorer");
  globalVerboseOn = settings.get("verboseLogging", false);
}

var globalLogIsOpen: boolean = false;
export function openMessagePane() {
  const messagePane = getMessagePane();
  messagePane.show();
  globalLogIsOpen = true;
}

export function closeMessagePane() {
  const messagePane = getMessagePane();
  messagePane.hide();
  globalLogIsOpen = false;
}

export function toggleMessageLog() {
  const messagePane = getMessagePane();
  if (globalLogIsOpen) {
    messagePane.hide();
    globalLogIsOpen = false;
  } else {
    messagePane.show();
    globalLogIsOpen = true;
  }
}
