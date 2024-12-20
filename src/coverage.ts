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
import {
  currentActiveUnitMCDCLines,
  updateCurrentActiveUnitMCDCLines,
} from "./editorDecorator";

// these are defined as globals so that the deactivate function has access
// to dispose of them when the coverage id turned off
let uncoveredDecorationType: TextEditorDecorationType;
let coveredDecorationType: TextEditorDecorationType;
let partiallyCoveredDecorationType: TextEditorDecorationType;
let coveredDecorationTypeWithMCDC: TextEditorDecorationType;
let uncoveredDecorationTypeWithMCDC: TextEditorDecorationType;
let partiallyCoveredDecorationTypeWithMCDC: TextEditorDecorationType;

// these are really constants, but I set the values via a function
// so that we could support the user controlling options for the decorations
let uncoveredRenderOptions: DecorationRenderOptions;
let coveredRenderOptions: DecorationRenderOptions;
let partiallyCoveredRenderOptions: DecorationRenderOptions;
let uncoveredRenderOptionsWithMCDC: DecorationRenderOptions;
let coveredRenderOptionsWithMCDC: DecorationRenderOptions;
let partiallyCoveredRenderOptionsWithMCDC: DecorationRenderOptions;

export function initializeCodeCoverageFeatures(
  context: vscode.ExtensionContext
) {
  // This gets called during activation to construct the decoration types
  // I have commented out some of the other attributes that can be used
  // to decorate the lines

  // We have a different style for covered lines that also have MCDC coverage to
  // indicate that the user can interact with these lines in the decoration gutter.

  // Improvement needed: "partial" coverage display not supported
  uncoveredRenderOptions = {
    //backgroundColor: "red",
    //color: 'white',
    //color: "red",
    //fontWeight: "bold",
    gutterIconPath: context.asAbsolutePath("./images/light/no-cover-icon.svg"),
  };
  uncoveredRenderOptionsWithMCDC = {
    gutterIconPath: context.asAbsolutePath(
      "./images/light/no-cover-icon-with-mcdc.svg"
    ),
  };
  coveredRenderOptionsWithMCDC = {
    gutterIconPath: context.asAbsolutePath(
      "./images/light/cover-icon-with-mcdc.svg"
    ),
  };

  partiallyCoveredRenderOptionsWithMCDC = {
    gutterIconPath: context.asAbsolutePath(
      "./images/light/partially-cover-icon-with-mcdc.svg"
    ),
  };

  partiallyCoveredRenderOptions = {
    gutterIconPath: context.asAbsolutePath(
      "./images/light/partially-cover-icon.svg"
    ),
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
let partiallyCoveredDecorations: vscode.DecorationOptions[] = [];
let coveredDecorationsWithMCDC: vscode.DecorationOptions[] = [];
let uncoveredDecorationsWithMCDC: vscode.DecorationOptions[] = [];
let partiallyCoveredDecorationsWithMCDC: vscode.DecorationOptions[] = [];

function addDecorations(
  activeEditor: vscode.TextEditor,
  covered: number[],
  uncovered: number[],
  partiallyCovered: number[]
) {
  const lineCount = activeEditor.document.lineCount;
  let lineIndex;

  for (lineIndex = 0; lineIndex < lineCount; lineIndex++) {
    const lineNumber = lineIndex + 1;
    const isMCDCLine = currentActiveUnitMCDCLines.includes(lineNumber);

    if (partiallyCovered.includes(lineNumber)) {
      (isMCDCLine
        ? partiallyCoveredDecorationsWithMCDC
        : partiallyCoveredDecorations
      ).push(getRangeOption(lineIndex));
      continue;
    }

    if (covered.includes(lineNumber)) {
      (isMCDCLine ? coveredDecorationsWithMCDC : coveredDecorations).push(
        getRangeOption(lineIndex)
      );
      continue;
    }

    if (uncovered.includes(lineNumber)) {
      (isMCDCLine ? uncoveredDecorationsWithMCDC : uncoveredDecorations).push(
        getRangeOption(lineIndex)
      );
      continue;
    }
  }
}

// Global Data for code coverage ////////////////////////////////////
let coverageOn: boolean = false;
let coverageStatusBarObject: vscode.StatusBarItem;
/////////////////////////////////////////////////////////////////////

function resetGlobalDecorations() {
  // Group decorations into a list
  const decorations = [
    uncoveredDecorations,
    coveredDecorations,
    partiallyCoveredDecorations,
    coveredDecorationsWithMCDC,
    uncoveredDecorationsWithMCDC,
    partiallyCoveredDecorationsWithMCDC,
  ];

  // Group decoration types into a list
  const decorationTypes = [
    uncoveredDecorationType,
    coveredDecorationType,
    partiallyCoveredDecorationType,
    coveredDecorationTypeWithMCDC,
    uncoveredDecorationTypeWithMCDC,
    partiallyCoveredDecorationTypeWithMCDC,
  ];

  // Reset all decorations
  for (let i = 0; i < decorations.length; i++) {
    decorations[i] = [];
  }

  // Dispose of all decoration types
  for (const decorationType of decorationTypes) {
    if (decorationType) decorationType.dispose();
  }
}

const url = require("url");
export async function updateCOVdecorations() {
  // this updates the decorations for the currently active fill

  // Everytime we update the coverage decoration, we also need to update the mcdc lines
  await updateCurrentActiveUnitMCDCLines();

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
        coverageData.uncovered,
        coverageData.partiallyCovered
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

      partiallyCoveredDecorationType = window.createTextEditorDecorationType(
        partiallyCoveredRenderOptions
      );
      activeEditor.setDecorations(
        partiallyCoveredDecorationType,
        partiallyCoveredDecorations
      );

      // Coverage lines with MCDC

      partiallyCoveredDecorationTypeWithMCDC =
        window.createTextEditorDecorationType(
          partiallyCoveredRenderOptionsWithMCDC
        );
      activeEditor.setDecorations(
        partiallyCoveredDecorationTypeWithMCDC,
        partiallyCoveredDecorationsWithMCDC
      );

      coveredDecorationTypeWithMCDC = window.createTextEditorDecorationType(
        coveredRenderOptionsWithMCDC
      );
      activeEditor.setDecorations(
        coveredDecorationTypeWithMCDC,
        coveredDecorationsWithMCDC
      );
      uncoveredDecorationTypeWithMCDC = window.createTextEditorDecorationType(
        uncoveredRenderOptionsWithMCDC
      );
      activeEditor.setDecorations(
        uncoveredDecorationTypeWithMCDC,
        uncoveredDecorationsWithMCDC
      );

      const covered =
        coveredDecorations.length + coveredDecorationsWithMCDC.length;
      const coverable =
        covered +
        uncoveredDecorations.length +
        uncoveredDecorationsWithMCDC.length +
        partiallyCoveredDecorationsWithMCDC.length;
      let percentage: number;
      if (coverable == 0) {
        percentage = 0;
      } else {
        percentage = Math.round((covered / coverable) * 100);
      }
      const statusBarText = `Coverage: ${covered}/${coverable} (${percentage}%)`;
      coverageStatusBarObject.text = statusBarText;
      coverageStatusBarObject.show();
    } else if (coverageData.statusString.length > 0) {
      // this handles the case where coverage is out of date (for example)
      coverageStatusBarObject.text = coverageData.statusString;
      coverageStatusBarObject.show();
      resetGlobalDecorations();
    } else {
      // we get here for C/C++ files that are not part of an environment
      coverageStatusBarObject.hide();
    }
  } else {
    // we get here for non-C/C++ files
    coverageStatusBarObject.hide();
  }
}

function deactivateCoverage() {
  const decorationTypes = [
    uncoveredDecorationType,
    coveredDecorationType,
    partiallyCoveredDecorationType,
    coveredDecorationTypeWithMCDC,
    uncoveredDecorationTypeWithMCDC,
    partiallyCoveredDecorationTypeWithMCDC,
  ];

  // Iterate over the list and dispose each decoration type if existent
  for (const decorationType of decorationTypes) {
    if (decorationType) decorationType.dispose();
  }
  coverageStatusBarObject.hide();
}

export function hideStatusBarCoverage() {
  coverageStatusBarObject.hide();
}

export function createCoverageStatusBar() {
  coverageStatusBarObject = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    10
  );
  return coverageStatusBarObject;
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
