

import * as vscode from "vscode";
import {
    DecorationRenderOptions,
    TextEditorDecorationType,
  } from "vscode";

import {
    getRangeOption,
  } from "./utilities";
  

// This is used in the package.json to control the display of context menu items
// Search for 'vectorcastTestExplorer.testableLineList' in package.json to see where we reference it
export var testableLineList: number[] = [];

var testableFunctionDecorationType: TextEditorDecorationType;
var testableFunctioOptions: DecorationRenderOptions;
var testableFunctionsDecorations:vscode.DecorationOptions[] = [];

export function initializeTestDecorator(context:vscode.ExtensionContext) {
    
    testableFunctioOptions = {
        gutterIconPath: context.asAbsolutePath("./images/light/beaker-plus.svg")
    };
    testableFunctionDecorationType = vscode.window.createTextEditorDecorationType(testableFunctioOptions);
}

let unitAndFunctionMap: Map<string, any[]> = new Map();

export function updateFunctionDataForFile(
    fileName: string,
    functionList: string[]) {

    // functionList is a list of json items with fields for "name" and "startLine"

    // TBD - TODAY - do we need to do some work to ensure we only have testable function?

    unitAndFunctionMap.set (fileName, functionList);

}


function convertLineIndexToFunctionStart (lineIndex:number):number {
    // Since VectorCAST only has the location of the opening curly brace for the 
    // function, and since we want to put the icon on the line with the function name
    // we will need to do a little massaging of the data when we create the decorations

    // TBD - TODAY - Convert to start of function name
    return lineIndex-1;

}

export function updateTestDecorator() {

    // activeEditor will always exist when this is called
    // this will use the previously initialized file|function map to create 
    // the decorations for the currently active file
    let activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        // 2 steps for debugging
        const filename = activeEditor.document.fileName;
        const functionsForFile = unitAndFunctionMap.get (filename);

        // toss the old data
        testableLineList = [];
        testableFunctionsDecorations = [];

        if (functionsForFile) {
            for (let i = 0; i < functionsForFile.length; i++) {
                const functionInfo = functionsForFile[i];
                let lineIndex = functionInfo["startLine"];
                lineIndex = convertLineIndexToFunctionStart (lineIndex);
                testableLineList.push (lineIndex);
                testableFunctionsDecorations.push (getRangeOption(lineIndex));
            }
            // this is used by the package.json to control content (right click) menu choices
            vscode.commands.executeCommand(
                "setContext",
                "vectorcastTestExplorer.testableLineList",
                testableLineList
            );
            activeEditor.setDecorations(
                testableFunctionDecorationType,
                testableFunctionsDecorations
              );
        }
    }

}
