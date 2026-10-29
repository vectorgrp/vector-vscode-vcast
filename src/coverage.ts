import * as vscode from "vscode";
import {
  DecorationRenderOptions,
  TextEditorDecorationType,
  window,
} from "vscode";
import {
  getCoverageDataForFile,
  getCoverageDataForFileAndTests,
  getListOfFilesToDecorate,
} from "./vcastTestInterface";

import { getPerTestCoverageFromAPI } from "./vcastAdapter";
import { makeTestNodeID } from "./testData";
import {
  forceLowerCaseDriveLetter,
  getRangeOption,
  isSupportedSourceFile,
} from "./utilities";

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

  // During a requirements check, focus is often in the review's comment or
  // the test run's output rather than in a source editor; the reviewed file's
  // editor is then the one to keep up to date.
  if (
    review &&
    !(activeEditor && isSupportedSourceFile(activeEditor.document.uri.fsPath))
  ) {
    activeEditor = vscode.window.visibleTextEditors.find(
      (editor) =>
        forceLowerCaseDriveLetter(editor.document.uri.fsPath) ===
        review!.filePath
    );
  }

  // Ada is not A VSCode supproted language. So we need to gate on file extension because
  // otherwise activeEditor.document.languageId would return "Plaintext".
  if (activeEditor && isSupportedSourceFile(activeEditor.document.uri.fsPath)) {
    const filePath = url.fileURLToPath(activeEditor.document.uri.toString());

    // In review mode, show only the reviewed tests' coverage for the target file
    const coverageData =
      review?.filePath === forceLowerCaseDriveLetter(filePath)
        ? getCoverageDataForFileAndTests(
            filePath,
            review.testIds,
            review.enviroPath,
            review.perTestCoverage
          )
        : getCoverageDataForFile(filePath);

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
      fileDecorator.updateCoverageDecorations(getListOfFilesToDecorate());
    await updateCOVdecorations();
  }
}

export async function updateDisplayedCoverage() {
  if (coverageOn) await updateCOVdecorations();
}

// The requirements check in progress, whose tests alone show their coverage
// in the checked source file.
let review:
  | {
      testIds: Set<string>;
      filePath: string;
      enviroPath: string;
      perTestCoverage: Record<string, Record<string, string>>;
    }
  | undefined;

/**
 * Shows only the given tests' coverage in the given file. Returns false, with
 * the gutter left on the coverage of all tests, when the per-test coverage
 * could not be read (the reason is in the message pane): an empty result must
 * not pass for "these tests ran nothing".
 */
export async function enterReviewMode(
  testIds: string[],
  filePath: string,
  enviroPath: string
): Promise<boolean> {
  // Fetched per review rather than with the environment data, which would
  // compute it for every test on every environment load, and for this file
  // only. The reviewed tests are named so that each line also gets their
  // status as one ("*").
  const prefix = makeTestNodeID(enviroPath, "");
  const perTestCoverage = await getPerTestCoverageFromAPI(
    enviroPath,
    testIds.map((id) => (id.startsWith(prefix) ? id.slice(prefix.length) : id)),
    filePath
  );
  if (perTestCoverage == null) {
    review = undefined;
    return false;
  }
  const forThisFile = Object.entries(perTestCoverage).find(
    ([path]) =>
      forceLowerCaseDriveLetter(path) === forceLowerCaseDriveLetter(filePath)
  );
  review = {
    testIds: new Set(testIds),
    filePath: forceLowerCaseDriveLetter(filePath),
    enviroPath,
    perTestCoverage: (forThisFile?.[1] ?? {}) as Record<
      string,
      Record<string, string>
    >,
  };
  return true;
}

// A reviewed test that ran a line: as the Python interface names it, by its
// node ID, and with "covered" or "partiallyCovered".
export interface ReviewedTestRun {
  name: string;
  testId: string;
  status: string;
}

// The reviewed tests in one line's entry of the per-test coverage. Its "*"
// entry is the tests' status as one, not a test.
function reviewedTestsIn(tests: Record<string, string>): ReviewedTestRun[] {
  if (!review) return [];
  const { enviroPath, testIds } = review;
  return Object.entries(tests).flatMap(([name, status]) => {
    const testId = makeTestNodeID(enviroPath, name);
    return name !== "*" && testIds.has(testId)
      ? [{ name, testId, status }]
      : [];
  });
}

/**
 * The reviewed tests that ran the given 1-based line of the reviewed file.
 */
export function reviewedTestsOnLine(line: number): ReviewedTestRun[] {
  return reviewedTestsIn(review?.perTestCoverage[String(line)] ?? {});
}

/**
 * For each reviewed test (by node ID), the 1-based lines of the reviewed file
 * it ran, as the environment's per-test coverage says.
 */
export function linesRanByReviewedTests(): Map<string, Set<number>> {
  const ran = new Map<string, Set<number>>();
  for (const [line, tests] of Object.entries(review?.perTestCoverage ?? {})) {
    for (const { testId } of reviewedTestsIn(tests)) {
      if (!ran.has(testId)) ran.set(testId, new Set());
      ran.get(testId)!.add(Number(line));
    }
  }
  return ran;
}

export async function exitReviewMode(): Promise<void> {
  review = undefined;

  // Refresh normal coverage display
  if (coverageOn) {
    await updateCOVdecorations();
  }
}
