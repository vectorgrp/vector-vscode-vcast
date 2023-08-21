

import * as vscode from "vscode";
import {
    DecorationRenderOptions,
    TextEditorDecorationType,
  } from "vscode";

import {
    testNodeType,
} from "./testData";

import {
    getRangeOption,
  } from "./utilities";

const path = require("path");
  

// This is used in the package.json to control the display of context menu items
// Search for 'vectorcastTestExplorer.testableLineList' in package.json to see where we reference it
export var testableLineList: number[] = [];

var testableFunctionDecorationType: TextEditorDecorationType;
var testableFunctionOptions: DecorationRenderOptions;
var testableFunctionsDecorations:vscode.DecorationOptions[] = [];

export function initializeTestDecorator(context:vscode.ExtensionContext) {
    
    testableFunctionOptions = {
        light: {gutterIconPath: context.asAbsolutePath("./images/light/beaker-plus.svg")},
        dark: {gutterIconPath: context.asAbsolutePath("./images/dark/beaker-plus.svg")}
    };
    testableFunctionDecorationType = vscode.window.createTextEditorDecorationType(testableFunctionOptions);
}


interface unitDataType {
    enviroPath:string,
    enviroName:string,
    unitName:string,
    lineMap:Map<number, string>,
}

let unitAndFunctionMap: Map<string, unitDataType> = new Map();

export function updateFunctionDataForFile(
    enviroPath:string,
    fileName: string,
    functionList: string[]) {

    // functionList is a list of json items with fields for "name" and "startLine"
    let lineMap:Map<number, string> = new Map();
    for (let i = 0; i < functionList.length; i++) {
        const functionInfo:any = functionList[i];
        const functionName = functionInfo.name;
        const startLine = functionInfo.startLine;
        lineMap.set (startLine, functionName);
    }

    const enviroName = path.basename(enviroPath);
    const unitName = path.basename(fileName).split(".")[0];

    const unitData:unitDataType = {
        enviroPath: enviroPath,
        enviroName: enviroName,
        unitName: unitName,
        lineMap: lineMap,
    }

    unitAndFunctionMap.set (fileName, unitData);

}

export function buildTestNodeForFunction (args:any):testNodeType|undefined {
    // this functon will take the file path and function index and return a test node
    // with the correct data for the function

    // args comes from the call back and has the file URI and the line number

    const filename = args.uri.fsPath;
    const unitData = unitAndFunctionMap.get (filename);
    let testNode:testNodeType|undefined = undefined;

    if (unitData) {
        const functionName = unitData.lineMap.get (args.lineNumber);
        if (functionName) {
            testNode = {
                enviroPath: unitData.enviroPath,
                enviroName: unitData.enviroName,
                unitName: unitData.unitName,
                functionName: functionName,
                testName: "",
            }
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

        // 2 steps for debugging
        const filename = activeEditor.document.fileName;
        const unitData = unitAndFunctionMap.get (filename);

        if (unitData) {
            unitData.lineMap.forEach((functionName, lineNumber) => {       
                testableLineList.push (lineNumber);
                // the range positions are 0 based
                testableFunctionsDecorations.push (getRangeOption(lineNumber-1));
            });
            activeEditor.setDecorations(
                testableFunctionDecorationType,
                testableFunctionsDecorations
              );
        }
        // push the updated testableLineList to control content (right click) menu choices
        vscode.commands.executeCommand(
            "setContext",
            "vectorcastTestExplorer.testableLineList",
            testableLineList
        );
    }

}
