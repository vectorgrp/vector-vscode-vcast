import path = require("path");
import {
  TextDocument,
  CompletionItem,
  CompletionItemKind,
} from "vscode-languageserver";

import { Position, Range, InsertTextFormat } from "vscode-languageserver-types";

import { getEnviroNameFromScript } from "../src-common/commonUtilities";

export function getTriggerFromContext(context: any) {
  let returnValue: string;

  if (!context || !context.triggerCharacter) returnValue = "NULL";
  else if (context.triggerCharacter == "\n") returnValue = "CR";
  else if (context.triggerCharacter == ".") returnValue = "DOT";
  else if (context.triggerCharacter == ":") returnValue = "COLON";
  else returnValue = context.triggerCharacter;

  return returnValue;
}

export function getPieceAtColumn(pieces: string[], columnIndex: number) {
  // This function will return the piece that sits under the current cursor

  let index: number;
  let endOfPieceIndex: number = 0;
  for (index = 0; index < pieces.length; index++) {
    // +1 for the delimiter
    endOfPieceIndex += pieces[index].length + 1;
    if (endOfPieceIndex > columnIndex) {
      return {
        text: pieces[index],
        index: index,
      };
    }
  }
  return { text: "", index: 0 };
}

// this function will take a js array and create a completion array
export function completionList(
  inputList: string[],
  choiceKind: CompletionItemKind
): CompletionItem[] {
  // the format of what comes in here looks like a list of strings
  // formatted as textValue or textValue@extraInfo

  let i;
  let returnList: CompletionItem[] = [];
  for (i = 0; i < inputList.length; i++) {
    const rawData = inputList[i];
    const pieces = rawData.split("@");
    let details = pieces.length > 1 ? pieces[1] : "";
    const labelValue = pieces[0];

    if (labelValue == "scalar") {
      // now details will have the type of scalar
      // so let's add that, as well as a snippet for vary
      returnList.push({
        label: details,
        kind: choiceKind,
        detail: "",
      });
      returnList.push({
        label: "vary",
        kind: CompletionItemKind.Snippet,
        insertText: "VARY FROM:$1 TO:$2 BY:$3",
        insertTextFormat: InsertTextFormat.Snippet,
      });
      returnList.push({
        label: "<<MIN>>",
        kind: CompletionItemKind.Constant,
        detail: "",
      });
      returnList.push({
        label: "<<MID>>",
        kind: CompletionItemKind.Constant,
        detail: "",
      });
      returnList.push({
        label: "<<MAX>>",
        kind: CompletionItemKind.Constant,
        detail: "",
      });
    } else
      returnList.push({
        label: labelValue,
        kind: choiceKind,
        detail: details,
        data: i,
      });
  }
  return returnList;
}

export function convertKind(kindFromPython: string): CompletionItemKind {
  // This needs to stay in sync with the python type: choiceKindType

  let returnValue: CompletionItemKind = CompletionItemKind.Keyword;

  if (kindFromPython == "Constant") returnValue = CompletionItemKind.Constant;
  else if (kindFromPython == "Enum") returnValue = CompletionItemKind.Enum;
  else if (kindFromPython == "Field") returnValue = CompletionItemKind.Field;
  else if (kindFromPython == "File") returnValue = CompletionItemKind.File;
  else if (kindFromPython == "Function")
    returnValue = CompletionItemKind.Function;
  else if (kindFromPython == "Keyword")
    returnValue = CompletionItemKind.Keyword;
  else if (kindFromPython == "Property")
    returnValue = CompletionItemKind.Property;
  else if (kindFromPython == "Value") returnValue = CompletionItemKind.Value;
  else if (kindFromPython == "Variable")
    returnValue = CompletionItemKind.Variable;

  return returnValue;
}

export function getLineFragment(document: TextDocument, position: Position) {
  const startOfLinePosition: Position = Position.create(position.line, 0);
  const rangeOfInterest: Range = Range.create(startOfLinePosition, position);
  return document.getText(rangeOfInterest);
}

export function getLineText(document: TextDocument, line: number) {
  const startOfLinePosition: Position = Position.create(line, 0);
  const endOfLinePosition: Position = Position.create(line, 200);
  const rangeOfInterest: Range = Range.create(
    startOfLinePosition,
    endOfLinePosition
  );
  return document.getText(rangeOfInterest).trim();
}


export function getEnviroNameFromTestScript(testScriptPath: string) {
  let whatToReturn: string | undefined = undefined;

  // extract the enviroName from the script
  let enviroName: string | undefined =
    getEnviroNameFromScript(testScriptPath);

  // if we found a valid environment name, create a full path for it
  if (enviroName) {
    const enviroPath = path.join(path.dirname(testScriptPath), enviroName);
    console.log(
      "Environment path for script: " + testScriptPath + " is: " + enviroPath
    );
    whatToReturn = enviroPath;
  } else {
    console.log(
      "Error: could not find environment name in script: " + testScriptPath
    );
  }

  return whatToReturn;
}

export function getNearest(
  document: TextDocument,
  command: string,
  currentLine: number
) {
  let lineIndex: number;
  let unitName: string = "";
  for (lineIndex = 0; lineIndex < currentLine; lineIndex++) {
    const fullLine = getLineText(document, lineIndex);
    if (fullLine.toUpperCase().startsWith(`TEST.${command}:`)) {
      var pieces = fullLine.split(":");
      unitName = pieces[1];
    }
  }
  return unitName;
}


// Improvement needed: Issue #52, support LSE for enviro scripts
// This list has commands that are dumped by the script generator for a simple environment
// * indicates that we use these commands in the auto-generated script
export const commonEnviroCommandList = [
  "NEW",                       // *
  "NAME",                      // * All caps enviro directory name
  "BASE_DIRECTORY",            //   Variable:Path
  "COVERAGE_TYPE",             // * Statement, Branch, MCDC, Funciton, Function+Function_call, Statement+Branch, Statement+MCDC
  "INDUSTRY_MODE",             //   DO-178 B/C, ISO-26262, IEC-61508, EN-50128, IEC-62304
  "STUB_BY_FUNCTION",          // * Name of UUT
  "WHITEBOX",                  // * YES | NO
  "MAX_VARY_RANGE",            //   Integer
  "STUB",                      // * ALL_BY_PROTOTYPE, ALL, NONE
  "SEARCH_LIST",               // * Absolute path | $(BASE_DIRECTORY)/relative-path
  "TYPE_HANDLED_DIRS_ALLOWED", //  
  "LIBRARY_STUBS",             // a common separated list of names like fopen, malloc, etc.
  "END",
];

// Less commonly used commands, maybe handle these with ENVIRO.* to start?
export const extendedEnviroCommandList = [
  "UUT",
  "DONT_STUB",
  "COMPILER",                  // * Always CC for C/C++
  "LIBRARY_INCLUDE_DIR",
  "TEST_VALUES_DICTIONARY",
  "TYPE_HANDLED_SOURCE_DIR",
  "CLASS_OF_INTEREST",
  "SUPPRESS_STUB",
  "UNIT_COMPILATION_ARGUMENTS",
  "UNIT_PREFIX_USER_CODE",
  "UNIT_PREFIX_USER_CODE_FILE",
  "END_UNIT_PREFIX_USER_CODE_FILE",
  "END_UNIT_PREFIX_USER_CODE",
  "UNIT_APPENDIX_USER_CODE",
  "UNIT_APPENDIX_USER_CODE_FILE",
  "END_UNIT_APPENDIX_USER_CODE_FILE",
  "END_UNIT_APPENDIX_USER_CODE",
  "DRIVER_PREFIX_USER_CODE",
  "DRIVER_PREFIX_USER_CODE_FILE",
  "END_DRIVER_PREFIX_USER_CODE_FILE",
  "END_DRIVER_PREFIX_USER_CODE_FILE",
  "USER_GLOBALS",
  "END_USER_GLOBALS",
  "USER_PARAMETERS",
  "END_USER_PARAMETERS",
  "USER_CODE_DEPENDENCIES",
  "END_USER_CODE_DEPENDENCIES",
  "USER_CODE_OBJECTS",
  "END_USER_CODE_OBJECTS",
  "USER_CODE_ONE_SHOT_INIT",
  "END_USER_CODE_INITIALIZE",
  "USER_CODE_CAPTURE",
  "END_USER_CODE_CAPTURE",
  "USER_CODE_ONE_SHOT_TERM",
  "END_USER_CODE_ONE_SHOT_TERM",
  "USER_CODE_STUB_PROCESSING",
  "END_USER_CODE_STUB_PROCESSING",
  "STUB_ENTRY_USER_CODE",
  "END_STUB_ENTRY_USER_CODE",
  "STUB_EXIT_USER_CODE",
  "END_STUB_EXIT_USER_CODE",
  "STUB_USER_CODE_FILE",
  "END_STUB_USER_CODE_FILE",
  "STUB_DEPEND_USER_CODE_FILE",
  "END_STUB_DEPEND_USER_CODE_FILE",
  "ADDITIONAL_UNIT_BODIES",
  "END_ADDITIONAL_UNIT_BODIES",
  "USER_CODE_TIMER_START",
  "END_USER_CODE_TIMER_START",
  "USER_CODE_TIMER_STOP",
  "END_USER_CODE_TIMER_STOP",
]


export const testCommandList = [
  // global scope
  "SCRIPT_FEATURE",
  "UNIT",
  "SUBPROGRAM",
  "NEW",
  "REPLACE",
  "ADD",
  "END",
  // test scope
  "NAME",
  "NOTES",
  "END_NOTES",
  "FLOW",
  "END_FLOW",
  "VALUE",
  "SLOT",
  "EXPECTED",
  "STUB",
  "REQUIREMENT_KEY",
  "VALUE_USER_CODE",
  "END_VALUE_USER_CODE",
  "EXPECTED_USER_CODE",
  "END_EXPECTED_USER_CODE",
  "IMPORT_FAILURES",
  "END_IMPORT_FAILURES",
  "COMPOUND_ONLY",
];

export const scriptFeatureList = [
  "ACCEPTING_MISSING_CONST",
  "ADA_DIRECT_ARRAY_INDEXING",
  "C_DIRECT_ARRAY_INDEXING",
  "REMOVED_CL_PREFIX",
  "CPP_CLASS_OBJECT_REVISION",
  "DATA_SPACING_FORMAT",
  "FULL_PARAMETER_TYPES",
  "IGNORE_NAME_VALUE_ERRORS",
  "MIXED_CASE_NAMES",
  "MULTIPLE_UUT_SUPPORT",
  "OVERLOADED_CONST_SUPPORT",
  "STANDARD_SPACING_R2",
  "STRUCT_BASE_CTOR_ADDS_POINTER",
  "STRUCT_DTOR_ADDS_POINTER",
  "STRUCT_FIELD_CTOR_ADDS_POINTER",
  "STATIC_HEADER_FUNCS_IN_UUTS",
  "UNDERSCORE_NULLPTR",
  "VCAST_MAIN_NOT_RENAMED",
];
