import * as vscode from "vscode";
import * as fs from "fs";
import path = require("node:path");
import {
  DecorationRenderOptions,
  TextEditorDecorationType,
  window,
} from "vscode";
import {
  getCoverageDataForFile,
  getListOfFilesWithCoverage,
} from "./vcastTestInterface";

import { fileIsVCPAndInPlace, getRangeOption, normalizePath } from "./utilities";

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

  initializeReviewModeDecorations(context);

  initCoverageFilterStatusBarItem(context);
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
  // Use references to global variables
  const decorationRefs = [
    () => (uncoveredDecorations = []),
    () => (coveredDecorations = []),
    () => (partiallyCoveredDecorations = []),
    () => (coveredDecorationsWithMCDC = []),
    () => (uncoveredDecorationsWithMCDC = []),
    () => (partiallyCoveredDecorationsWithMCDC = []),
  ];

  // Reset all decorations
  for (const resetDecoration of decorationRefs) {
    resetDecoration();
  }

  // Group decoration types into a list
  const decorationTypes = [
    uncoveredDecorationType,
    coveredDecorationType,
    partiallyCoveredDecorationType,
    coveredDecorationTypeWithMCDC,
    uncoveredDecorationTypeWithMCDC,
    partiallyCoveredDecorationTypeWithMCDC,
  ];

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

    // Check if we're in review mode for this file
    if (isReviewModeActive() && filePath === getReviewModeFilePath()) {
      // In review mode, use review mode decorations instead
      updateReviewModeDecorations();
      return;
    }

    // We have to check if the source file is part of a Cover project AND
    // whether it is instrumented in_place. If so, we do not want to show coverage.
    const fileIsPartOfVCPAndInPlace = fileIsVCPAndInPlace(filePath);

    // this returns the cached coverage data for this file
    const coverageData = getCoverageDataForFile(filePath);

    if (coverageData.hasCoverageData && !fileIsPartOfVCPAndInPlace) {
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
    hideCoverageFilterStatusBar();
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

  // Debug log to verify contents of decorationTypes
  console.log("Decoration Types Before Disposal:", decorationTypes);

  // Iterate over the list and dispose of each decoration type if it exists
  for (const decorationType of decorationTypes) {
    if (decorationType) {
      console.log("Disposing decoration type:", decorationType);
      decorationType.dispose();
    }
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

export async function toggleCoverageAction() {
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
    await updateCOVdecorations();
  }
}

export async function updateDisplayedCoverage() {
  if (coverageOn) await updateCOVdecorations();
}

// Review mode state
let reviewModeActive: boolean = false;
let reviewModeExpectedLines: number[] = [];
let reviewModeActualLines: number[] = [];
let reviewModeFilePath: string | null = null;

// Review mode decoration types
let reviewCoveredDecorationType: TextEditorDecorationType;
let reviewUncoveredDecorationType: TextEditorDecorationType;

let reviewCoveredRenderOptions: DecorationRenderOptions;
let reviewUncoveredRenderOptions: DecorationRenderOptions;

export function initializeReviewModeDecorations(
  context: vscode.ExtensionContext
) {
  reviewUncoveredRenderOptions = {
    gutterIconPath: context.asAbsolutePath("./images/light/no-cover-icon.svg"),
  };

  reviewCoveredRenderOptions = {
    gutterIconPath: context.asAbsolutePath("./images/light/cover-icon.svg"),
  };
}

export function isReviewModeActive(): boolean {
  return reviewModeActive;
}

export function getReviewModeFilePath(): string | null {
  return reviewModeFilePath;
}

export function enterReviewMode(
  testName: string,
  expectedLines: number[],
  actualLines: number[],
  filePath: string
): void {
  reviewModeActive = true;
  reviewModeExpectedLines = expectedLines;
  reviewModeActualLines = actualLines;
  reviewModeFilePath = filePath;

  resetGlobalDecorations();

  // Immediately update decorations for the active editor
  updateReviewModeDecorations();
}

export async function exitReviewMode(): Promise<void> {
  reviewModeActive = false;
  reviewModeExpectedLines = [];
  reviewModeActualLines = [];
  reviewModeFilePath = null;

  // Clear review mode decorations
  clearReviewModeDecorations();

  // restore normal coverage
  if (coverageOn) {
    await updateCOVdecorations();
  }
}

function clearReviewModeDecorations(): void {
  if (reviewCoveredDecorationType) {
    reviewCoveredDecorationType.dispose();
  }
  if (reviewUncoveredDecorationType) {
    reviewUncoveredDecorationType.dispose();
  }
}

export function updateReviewModeDecorations(): void {
  if (!reviewModeActive) {
    return;
  }

  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) {
    return;
  }

  // Only apply review decorations to the specific file
  if (
    !reviewModeFilePath ||
    normalizePath(activeEditor.document.uri.fsPath) !==
      normalizePath(reviewModeFilePath)
  ) {
    return;
  }

  // Clear previous decorations
  clearReviewModeDecorations();

  const filePath = activeEditor.document.uri.fsPath;
  const coverageData = getCoverageDataForFile(filePath);

  if (!coverageData.hasCoverageData) {
    return;
  }

  const covered = new Set<number>(coverageData.covered);
  const uncovered = new Set<number>(coverageData.uncovered);
  const partiallyCovered = new Set<number>(coverageData.partiallyCovered);

  // Lines that should count as "covered" in review mode
  const expectedOrActual = new Set<number>([
    ...reviewModeExpectedLines,
    ...reviewModeActualLines,
  ]);

  // Any covered line NOT in expected/actual becomes uncovered
  for (const line of covered) {
    if (!expectedOrActual.has(line - 1)) {
      covered.delete(line);
      uncovered.add(line);
    }
  }

  const coveredDecorations: vscode.DecorationOptions[] = [];
  const uncoveredDecorations: vscode.DecorationOptions[] = [];

  // Only iterate over lines that actually have coverage data
  const allCoverableLines = new Set<number>([
    ...covered,
    ...uncovered,
    ...partiallyCovered,
  ]);

  for (const lineNumber of allCoverableLines) {
    const lineIndex = lineNumber - 1;
    if (covered.has(lineNumber)) {
      coveredDecorations.push(getRangeOption(lineIndex));
    } else {
      // uncovered + partial both render as uncovered in review mode
      uncoveredDecorations.push(getRangeOption(lineIndex));
    }
  }

  // Apply decorations
  reviewCoveredDecorationType = vscode.window.createTextEditorDecorationType(
    reviewCoveredRenderOptions
  );
  reviewUncoveredDecorationType = vscode.window.createTextEditorDecorationType(
    reviewUncoveredRenderOptions
  );

  activeEditor.setDecorations(reviewCoveredDecorationType, coveredDecorations);
  activeEditor.setDecorations(
    reviewUncoveredDecorationType,
    uncoveredDecorations
  );
}

// ── Types ────────────────────────────────────────────────────

/**
 * Shape of coverageFilter.json on disk:
 *   { "<absSourceFilePath>": ["<enviroPath>", ...], ... }
 *
 * A source file that is present in the JSON has an explicit list of
 * enabled enviros.  A source file that is absent is treated as
 * "all enviros enabled" (the default).
 */
type CoverageFilterJson = Record<string, string[]>;

// ── File-path helper ─────────────────────────────────────────

/**
 * Returns the path to the coverageFilter.json file for a given workspace root.
 */
export function getCoverageFilterJsonPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".vscode", "coverageFilter.json");
}

// ── Read / Write helpers ─────────────────────────────────────

/**
 * Reads and parses coverageFilter.json for the given workspace root.
 * Returns an empty object if the file does not exist or is corrupt.
 */
export function readCoverageFilterFile(
  workspaceRoot: string
): CoverageFilterJson {
  const filePath = getCoverageFilterJsonPath(workspaceRoot);
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as CoverageFilterJson;
  } catch {
    // Corrupt JSON – start fresh
    return {};
  }
}

/**
 * Writes data back to coverageFilter.json for the given workspace root.
 * Creates .vscode/ if it does not exist yet.
 */
export function writeCoverageFilterFile(
  workspaceRoot: string,
  data: CoverageFilterJson
): void {
  const vscodeDir = path.join(workspaceRoot, ".vscode");
  if (!fs.existsSync(vscodeDir)) {
    fs.mkdirSync(vscodeDir, { recursive: true });
  }
  fs.writeFileSync(
    getCoverageFilterJsonPath(workspaceRoot),
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

// ── Public state accessor used by getCoverageDataForFile ─────

/**
 * Returns the set of enabled enviro paths for a given source file by reading
 * the coverageFilter.json that belongs to that file's workspace folder.
 *
 * Returns undefined when no filter entry exists for this file, which means
 * all enviros are enabled (the default behaviour).
 */
export function getEnabledEnvirosForFile(
  filePath: string
): Set<string> | undefined {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(
    vscode.Uri.file(filePath)
  );
  if (!workspaceFolder) return undefined;

  const data = readCoverageFilterFile(workspaceFolder.uri.fsPath);
  if (!(filePath in data)) {
    // No entry yet – all enviros are enabled
    return undefined;
  }
  return new Set(data[filePath]);
}

let coverageFilterStatusBarItem: vscode.StatusBarItem;

export function initCoverageFilterStatusBarItem(
  context: vscode.ExtensionContext
): void {
  coverageFilterStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    // Adjust the priority number so the item sits where you want it relative
    // to other status bar entries (higher = further right).
    99
  );
  coverageFilterStatusBarItem.color = new vscode.ThemeColor("charts.yellow");
  coverageFilterStatusBarItem.tooltip =
    "Not all environments are included in the displayed coverage.\n" +
    "Click to configure the coverage filter.";
  coverageFilterStatusBarItem.command =
    "vectorcastTestExplorer.configureCoverageFilter";
  context.subscriptions.push(coverageFilterStatusBarItem);
}

export function updateCoverageFilterStatusBar(
  totalEnviros: number,
  enabledEnviros: Set<string> | undefined
): void {
  if (enabledEnviros === undefined) {
    // No filter set for this file – all enviros are shown, nothing to warn about
    coverageFilterStatusBarItem.hide();
    return;
  }

  // Count only enabled enviros that still exist (guards against stale JSON entries
  // left over after an enviro has been deleted from the project)
  const enabledCount = enabledEnviros.size;

  if (enabledCount >= totalEnviros) {
    // Every enviro is enabled – hide the warning
    hideCoverageFilterStatusBar();
    return;
  }

  // At least one enviro is filtered out – show the yellow warning
  coverageFilterStatusBarItem.text = `$(warning) File Coverage: (${enabledCount}/${totalEnviros}) Environments / Projects`;
  coverageFilterStatusBarItem.show();
}

export function hideCoverageFilterStatusBar() {
  if (coverageFilterStatusBarItem) {
    coverageFilterStatusBarItem.hide();
  }
}
