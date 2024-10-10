import * as vscode from "vscode";
import {
  DecorationRenderOptions,
  TextEditorDecorationType,
  window,
} from "vscode";
import {
  getCoverageDataForFile,
  getListOfFilesWithCoverage,
} from "./vcastTestInterface";

import { getRangeOption } from "./utilities";

import { fileDecorator } from "./fileDecorator";

// these are defined as globals so that the deactivate function has access
// to dispose of them when the coverage id turned off
let uncoveredDecorationType: TextEditorDecorationType;
let coveredDecorationType: TextEditorDecorationType;

// these are really constants, but I set the values via a function
// so that we could support the user controlling options for the decorations
let uncoveredRenderOptions: DecorationRenderOptions;
let coveredRenderOptions: DecorationRenderOptions;

export function initializeCodeCoverageFeatures(
  context: vscode.ExtensionContext
) {
  // This gets called during activation to construct the decoration types
  // I have commented out some of the other attributes that can be used
  // to decorate the lines

  // Improvement needed: "partial" coverage display not supported
  uncoveredRenderOptions = {
    //backgroundColor: "red",
    //color: 'white',
    //color: "red",
    //fontWeight: "bold",
    gutterIconPath: context.asAbsolutePath("./images/light/no-cover-icon.svg"),
  };
  coveredRenderOptions = {
    //backgroundColor: 'green',
    //color: 'white',
    //color: "green",
    //fontWeight: "bold",
    gutterIconPath: context.asAbsolutePath("./images/light/cover-icon.svg"),
  };
}

// global decoration arrays
let coveredDecorations: vscode.DecorationOptions[] = [];
let uncoveredDecorations: vscode.DecorationOptions[] = [];

function addDecorations(
  activeEditor: vscode.TextEditor,
  covered: number[],
  uncovered: number[]
) {
  const lineCount = activeEditor.document.lineCount;
  let lineIndex;
  // these are lists of line numbers

  for (lineIndex = 0; lineIndex < lineCount; lineIndex++) {
    if (covered.includes(lineIndex + 1)) {
      coveredDecorations.push(getRangeOption(lineIndex));
    } else if (uncovered.includes(lineIndex + 1)) {
      uncoveredDecorations.push(getRangeOption(lineIndex));
    }
  }
}

// Global Data for code coverage ////////////////////////////////////
let coverageOn: boolean = false;
let globalStatusBarObject: vscode.StatusBarItem;
/////////////////////////////////////////////////////////////////////

function resetGlobalDecorations() {
  uncoveredDecorations = [];
  coveredDecorations = [];
  // and throw away the old decorations
  if (uncoveredDecorationType) uncoveredDecorationType.dispose();
  if (coveredDecorationType) coveredDecorationType.dispose();
}

const url = require("url");
export function updateCOVdecorations() {
  // this updates the decorations for the currently active file

  let activeEditor = vscode.window.activeTextEditor;

  if (
    activeEditor &&
    (activeEditor.document.languageId == "c" ||
      activeEditor.document.languageId == "cpp")
  ) {
    const filePath = url.fileURLToPath(activeEditor.document.uri.toString());

    // this returns the cached coverage data for this file
    const coverageData = getCoverageDataForFile(filePath);

    if (coverageData.hasCoverageData) {
      // there is coverage data and it matches the file checksum
      // Reset the global decoration arrays
      resetGlobalDecorations();

      // build the global list of decorations needed
      addDecorations(
        activeEditor,
        coverageData.covered,
        coverageData.uncovered
      );

      // Add the decorations to the editor
      uncoveredDecorationType = window.createTextEditorDecorationType(
        uncoveredRenderOptions
      );
      activeEditor.setDecorations(
        uncoveredDecorationType,
        uncoveredDecorations
      );
      coveredDecorationType =
        window.createTextEditorDecorationType(coveredRenderOptions);
      activeEditor.setDecorations(coveredDecorationType, coveredDecorations);

      const covered = coveredDecorations.length;
      const coverable = covered + uncoveredDecorations.length;
      let percentage: number;
      if (coverable == 0) {
        percentage = 0;
      } else {
        percentage = Math.round((covered / coverable) * 100);
      }
      const statusBarText = `Coverage: ${covered}/${coverable} (${percentage}%)`;
      globalStatusBarObject.text = statusBarText;
      globalStatusBarObject.show();
    } else if (coverageData.statusString.length > 0) {
      // this handles the case where coverage is out of date (for example)
      globalStatusBarObject.text = coverageData.statusString;
      globalStatusBarObject.show();
      resetGlobalDecorations();
    } else {
      // we get here for C/C++ files that are not part of an environment
      globalStatusBarObject.hide();
    }
  } else {
    // we get here for non-C/C++ files
    globalStatusBarObject.hide();
  }
}

function deactivateCoverage() {
  // delete all decorations
  if (uncoveredDecorationType) uncoveredDecorationType.dispose();
  if (coveredDecorationType) coveredDecorationType.dispose();
  globalStatusBarObject.hide();
}

export function hideStatusBarCoverage() {
  globalStatusBarObject.hide();
}

export function createCoverageStatusBar() {
  globalStatusBarObject = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    10
  );
  return globalStatusBarObject;
}

export function toggleCoverageAction() {
  // This function gets called when the user does toggle on/off coverage
  // using either ctrl-shift-c or the vectorcastTestExplorer.coverage command

  if (coverageOn) {
    coverageOn = false;
    deactivateCoverage();
    if (fileDecorator) fileDecorator.removeAllCoverageDecorations();
  } else {
    coverageOn = true;
    if (fileDecorator)
      fileDecorator.updateCoverageDecorations(getListOfFilesWithCoverage());
    updateCOVdecorations();
  }
}

export function updateDisplayedCoverage() {
  if (coverageOn) updateCOVdecorations();
}
