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
import path = require("path");

// these are defined as globals so that the deactivate function has access
// to dispose of them when the coverage id turned off
let uncoveredDecorationType: TextEditorDecorationType;
let coveredDecorationType: TextEditorDecorationType;
let coveredDecorationTypeWithMCDC: TextEditorDecorationType;
let uncoveredDecorationTypeWithMCDC: TextEditorDecorationType;

// these are really constants, but I set the values via a function
// so that we could support the user controlling options for the decorations
let uncoveredRenderOptions: DecorationRenderOptions;
let coveredRenderOptions: DecorationRenderOptions;
let uncoveredRenderOptionsWithMCDC: DecorationRenderOptions;
let coveredRenderOptionsWithMCDC: DecorationRenderOptions;

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

  coveredRenderOptions = {
    //backgroundColor: 'green',
    //color: 'white',
    //color: "green",
    //fontWeight: "bold",
    gutterIconPath: context.asAbsolutePath("./images/light/cover-icon.svg"),
  };

  updateMCDCRenderOptions();
}

/**
 * Applies the correct icon for MCDC coverage lines based on the vscode settings.
 */
function updateMCDCRenderOptions() {
  const coverageFilePath = __filename;

  // Get the directory of the current file for the images because we can't use context here since
  // this function is also called on updateCOVdecorations() and context is not available there.
  const coverageDir = path.dirname(coverageFilePath);

  // Retrieve the current value of the setting for MC/DC coverage gutter icons
  let settings = vscode.workspace.getConfiguration("vectorcastTestExplorer");
  let mcdcSetting = settings.get("mcdcCoverageGutterIcons");

  // Use a switch to adjust the MC/DC specific render options based on the setting
  switch (mcdcSetting) {
    case "➡": // For the right arrow
      uncoveredRenderOptionsWithMCDC = {
        gutterIconPath: path.resolve(
          coverageDir,
          "../images/light/no-cover-icon-with-mcdc.svg"
        ),
      };
      coveredRenderOptionsWithMCDC = {
        gutterIconPath: path.resolve(
          coverageDir,
          "../images/light/cover-icon-with-mcdc.svg"
        ),
      };
      break;

    case "M": // For the "M" symbol
      uncoveredRenderOptionsWithMCDC = {
        gutterIconPath: path.resolve(
          coverageDir,
          "../images/light/no-cover-icon-with-mcdc-M.svg"
        ),
      };
      coveredRenderOptionsWithMCDC = {
        gutterIconPath: path.resolve(
          coverageDir,
          "../images/light/cover-icon-with-mcdc-M.svg"
        ),
      };
      break;

    default:
      // Default to no MC/DC rendering if the setting is not recognized. Should not happen since the arrow is the default value and you can not pick an empty item, but just in case.
      uncoveredRenderOptionsWithMCDC = uncoveredRenderOptions;
      coveredRenderOptionsWithMCDC = coveredRenderOptions;
      break;
  }
}

// global decoration arrays
let coveredDecorations: vscode.DecorationOptions[] = [];
let uncoveredDecorations: vscode.DecorationOptions[] = [];
let coveredDecorationsWithMCDC: vscode.DecorationOptions[] = [];
let uncoveredDecorationsWithMCDC: vscode.DecorationOptions[] = [];

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
      // Check if the line is also a MCDC line
      if (currentActiveUnitMCDCLines.includes(lineIndex + 1)) {
        coveredDecorationsWithMCDC.push(getRangeOption(lineIndex));
      } else {
        // If its only a covered line without MCDC coverage --> Add to normal covered array
        coveredDecorations.push(getRangeOption(lineIndex));
      }
    } else if (uncovered.includes(lineIndex + 1)) {
      if (currentActiveUnitMCDCLines.includes(lineIndex + 1)) {
        uncoveredDecorationsWithMCDC.push(getRangeOption(lineIndex));
      } else {
        uncoveredDecorations.push(getRangeOption(lineIndex));
      }
    }
  }
}

// Global Data for code coverage ////////////////////////////////////
let coverageOn: boolean = false;
let coverageStatusBarObject: vscode.StatusBarItem;
/////////////////////////////////////////////////////////////////////

function resetGlobalDecorations() {
  uncoveredDecorations = [];
  coveredDecorations = [];
  coveredDecorationsWithMCDC = [];
  uncoveredDecorationsWithMCDC = [];
  // and throw away the old decorations
  if (uncoveredDecorationType) uncoveredDecorationType.dispose();
  if (coveredDecorationType) coveredDecorationType.dispose();
  if (coveredDecorationTypeWithMCDC) coveredDecorationTypeWithMCDC.dispose();
  if (uncoveredDecorationTypeWithMCDC)
    uncoveredDecorationTypeWithMCDC.dispose();
}

const url = require("url");
export function updateCOVdecorations() {
  // this updates the decorations for the currently active fill

  // Everytime we update the coverage decoration, we also need to update the mcdc lines
  updateCurrentActiveUnitMCDCLines();

  // Update the correct MCDC gutter icons based on the settings
  updateMCDCRenderOptions();

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

      // Coverage lines with MCDC
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
        uncoveredDecorationsWithMCDC.length;
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
  // delete all decorations
  if (uncoveredDecorationType) uncoveredDecorationType.dispose();
  if (coveredDecorationType) coveredDecorationType.dispose();
  if (coveredDecorationTypeWithMCDC) coveredDecorationTypeWithMCDC.dispose();
  if (uncoveredDecorationTypeWithMCDC)
    uncoveredDecorationTypeWithMCDC.dispose();
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
