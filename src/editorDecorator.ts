import * as vscode from "vscode";
import {
  type DecorationRenderOptions,
  type TextEditorDecorationType,
} from "vscode";
import { type testNodeType } from "./testData";
import { getRangeOption } from "./utilities";
import { checksumMatchesEnvironment } from "./vcastTestInterface";

const path = require("node:path");

// This is used in the package.json to control the display of context menu items
// Search for 'vectorcastTestExplorer.testableLineList' in package.json to see where we reference it
let testableLineList: number[] = [];

let testableFunctionDecorationType: TextEditorDecorationType;
let testableFunctionOptions: DecorationRenderOptions;
let testableFunctionsDecorations: vscode.DecorationOptions[] = [];

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

type unitDataType = {
  enviroPath: string;
  enviroName: string;
  unitName: string;
  lineMap: Map<number, string>;
};

const unitAndFunctionMap = new Map<string, unitDataType>();

export function updateFunctionDataForFile(
  enviroPath: string,
  fileName: string,
  functionList: string[]
) {
  // FunctionList is a list of json items with fields for "name" and "startLine"
  const lineMap = new Map<number, string>();
  for (const functionInfo: any of functionList) {
    // For now we only use the line to functionName map to insert
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
    enviroPath,
    enviroName,
    unitName,
    lineMap,
  };

  unitAndFunctionMap.set(fileName, unitData);
}

export function buildTestNodeForFunction(
  arguments_: any
): testNodeType | undefined {
  // This functon will take the file path and function index and return a test node
  // with the correct data for the function

  // args comes from the call back and has the file URI and the line number

  const filename = arguments_.uri.fsPath;
  const unitData = unitAndFunctionMap.get(filename);
  let testNode: testNodeType | undefined;

  if (unitData) {
    const functionName = unitData.lineMap.get(arguments_.lineNumber);
    if (functionName) {
      testNode = {
        enviroPath: unitData.enviroPath,
        enviroName: unitData.enviroName,
        unitName: unitData.unitName,
        functionName,
        testName: "",
      };
    }
  }

  return testNode;
}

export function updateTestDecorator() {
  // ActiveEditor will always exist when this is called
  // this will use the previously initialized file|function map to create
  // the decorations for the currently active file

  // Note: VectorCAST only has the location of the opening curly brace for the
  // function, so that's where the icon and right click menu will be

  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    // Toss the old data
    testableLineList = [];
    testableFunctionsDecorations = [];

    const filePath = activeEditor.document.fileName;
    const unitData = unitAndFunctionMap.get(filePath);

    if (
      unitData && // We don't want to display the icon and context menu if the
      // file has been edited.  This is the easiest way to check that
      checksumMatchesEnvironment(filePath, unitData.enviroPath)
    ) {
      for (const [lineNumber, functionName] of unitData.lineMap.entries()) {
        testableLineList.push(lineNumber);
        // The range positions are 0 based
        testableFunctionsDecorations.push(getRangeOption(lineNumber - 1));
      }
    }

    // Update the flask icon decorations
    activeEditor.setDecorations(
      testableFunctionDecorationType,
      testableFunctionsDecorations
    );
    // Push the updated testableLineList to control content (right click) menu choices
    vscode.commands.executeCommand(
      "setContext",
      "vectorcastTestExplorer.testableLineList",
      testableLineList
    );
  }
}
