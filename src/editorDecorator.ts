import * as vscode from "vscode";
import { DecorationRenderOptions, TextEditorDecorationType } from "vscode";

import { testNodeType } from "./testData";

import { getEnvPathForFilePath, getRangeOption } from "./utilities";

import { checksumMatchesEnvironment } from "./vcastTestInterface";
import { getMCDCCoverageLines } from "./vcastAdapter";
import { vectorMessage } from "./messagePane";

const path = require("path");

// This is used in the package.json to control the display of context menu items
// Search for 'vectorcastTestExplorer.testableLineList' in package.json to see where we reference it
let testableLineList: number[] = [];

// Determines the lines in package.json where the "Get MCDC Report" command is available.
// Also used in coverage.ts to highlight MCDC lines, visually indicating their interactivity for the user.
let mcdcUnitCoverageLines: { [unit: string]: number[] } = {};
export let currentActiveUnitMCDCLines: number[] = [];

let testableFunctionDecorationType: TextEditorDecorationType;
let testableFunctionOptions: DecorationRenderOptions;
let testableFunctionsDecorations: vscode.DecorationOptions[] = [];

/**
 * Updates the global variable `currentActiveUnitMCDCLines`, which is exported and used in coverage.ts.
 * Fetches all lines with MCDC coverage for the current active editor's unit from the Data API.
 */
export async function updateCurrentActiveUnitMCDCLines() {
  let activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    // First we need to get the env name from the active file
    const filePath = activeEditor.document.uri.fsPath;
    const enviroPath = getEnvPathForFilePath(filePath);

    // Get the unit name based on the file name without extension
    const fullPath = activeEditor.document.fileName;
    const unitName = path.basename(fullPath, path.extname(fullPath));

    // Get all mcdc lines for every unit and parse it into JSON
    if (enviroPath) {
      // Replace single quotes with double quotes to make it a valid JSON string
      try {
        let mcdcCoverageLinesString = (
          await getMCDCCoverageLines(enviroPath)
        ).replace(/'/g, '"');
        mcdcUnitCoverageLines = JSON.parse(mcdcCoverageLinesString);
      } catch (error) {
        vectorMessage(`Error trying to parse MCDC coverage lines: ${error}`);
      }
      // Update the current active unit MCDC lines
      const mcdcLinesForUnit = mcdcUnitCoverageLines[unitName];
      // Check if there are no MCDC lines for the unit --> for example when the env is build with only Statement coverage
      // and the user changes it to Statement+MCDC in the settings
      if (mcdcLinesForUnit) {
        currentActiveUnitMCDCLines = mcdcUnitCoverageLines[unitName];
      } else {
        currentActiveUnitMCDCLines = [];
      }
    } else {
      currentActiveUnitMCDCLines = [];
    }

    // Push the updated currentActiveUnitMCDCLines to control the possible "Get MCDC Report" command
    vscode.commands.executeCommand(
      "setContext",
      "vectorcastTestExplorer.currentMCDCLines",
      currentActiveUnitMCDCLines
    );
  }
}

export function initializeTestDecorator(context: vscode.ExtensionContext) {
  testableFunctionOptions = {
    light: {
      gutterIconPath: context.asAbsolutePath("./images/light/beaker-plus.svg"),
    },
    dark: {
      gutterIconPath: context.asAbsolutePath("./images/dark/beaker-plus.svg"),
    },
  };
  testableFunctionDecorationType = vscode.window.createTextEditorDecorationType(
    testableFunctionOptions
  );
}

interface unitDataType {
  enviroPath: string;
  enviroName: string;
  unitName: string;
  lineMap: Map<number, string>;
}

let unitAndFunctionMap: Map<string, unitDataType> = new Map();

export function updateFunctionDataForFile(
  enviroPath: string,
  fileName: string,
  functionList: string[]
) {
  // functionList is a list of json items with fields for "name" and "startLine"
  let lineMap: Map<number, string> = new Map();
  for (let i = 0; i < functionList.length; i++) {
    const functionInfo: any = functionList[i];
    // for now we only use the line to functionName map to insert
    // the flask icon in the editor, so we simply drop functions
    // with isTestable set to false
    if (functionInfo.isTestable) {
      const functionName = functionInfo.name;
      const startLine = functionInfo.startLine;
      lineMap.set(startLine, functionName);
    }
  }

  const enviroName = path.basename(enviroPath);
  const unitName = path.basename(fileName).split(".")[0];

  const unitData: unitDataType = {
    enviroPath: enviroPath,
    enviroName: enviroName,
    unitName: unitName,
    lineMap: lineMap,
  };

  unitAndFunctionMap.set(fileName, unitData);
}

export function buildTestNodeForFunction(args: any): testNodeType | undefined {
  // this function will take the file path and function index and return a test node
  // with the correct data for the function

  // args comes from the call back and has the file URI and the line number

  const filename = args.uri.fsPath;
  const unitData = unitAndFunctionMap.get(filename);
  let testNode: testNodeType | undefined = undefined;

  if (unitData) {
    const functionName = unitData.lineMap.get(args.lineNumber);
    if (functionName) {
      testNode = {
        enviroNodeID: "",
        enviroPath: unitData.enviroPath,
        enviroName: unitData.enviroName,
        unitName: unitData.unitName,
        functionName: functionName,
        testName: "",
        testFile: "",
        testStartLine: 0,
      };
    }
  }
  return testNode;
}

export function updateTestDecorator() {
  // activeEditor will always exist when this is called
  // this will use the previously initialized file|function map to create
  // the decorations for the currently active file

  // Note: VectorCAST only has the location of the opening curly brace for the
  // function, so that's where the icon and right click menu will be

  let activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    // toss the old data
    testableLineList = [];
    testableFunctionsDecorations = [];

    const filePath = activeEditor.document.fileName;
    const unitData = unitAndFunctionMap.get(filePath);

    // check if there are testable functions in this file
    if (unitData && unitData.lineMap.size > 0) {
      // We don't want to display the icon and context menu if the
      // file has been edited.  This is the easiest way to check that
      if (checksumMatchesEnvironment(filePath, unitData.enviroPath)) {
        unitData.lineMap.forEach((functionName, lineNumber) => {
          testableLineList.push(lineNumber);
          // the range positions are 0 based
          testableFunctionsDecorations.push(getRangeOption(lineNumber - 1));
        });
      }
    }

    // update the flask icon decorations
    // if we this is not a unit of interest, th lists will be empty
    // and this will remove the decorations
    activeEditor.setDecorations(
      testableFunctionDecorationType,
      testableFunctionsDecorations
    );
    // push the updated testableLineList to control content (right click) menu choices
    vscode.commands.executeCommand(
      "setContext",
      "vectorcastTestExplorer.testableLineList",
      testableLineList
    );
  }
}
