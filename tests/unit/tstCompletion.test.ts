/* eslint-disable @typescript-eslint/no-var-requires */
import { describe, expect, test } from "vitest";
import { TextDocument, TextDocuments } from "vscode-languageserver";
import { getCompletionPositionForLine, generateCompletionData } from "./utils";
import URI from "vscode-uri";

const timeout = 30000; // 30 seconds
const path = require("path");

const initialTst = `
-- Environment: TEST
TEST.UNIT:unit
TEST.SUBPROGRAM:
`;

const scriptFeatureTst = `
-- Environment: TEST
TEST.SCRIPT_FEATURE:
`;
const unitTst = `
-- Environment: TEST
TEST.UNIT:
TEST.SUBPROGRAM:
`;
const compoundTst = `
-- Environment: TEST
TEST.SUBPROGRAM:<<COMPOUND>>
TEST.REPLACE
TEST.NAME:compoundTest
TEST.NOTES:
TEST.END_NOTES:

TEST.END
`;

const slotTst = `
-- Environment: TEST
TEST.SUBPROGRAM:<<COMPOUND>>
TEST.REPLACE
TEST.NAME:compoundTest
TEST.NOTES:
TEST.END_NOTES:
TEST.SLOT:
TEST.END
`;

const normalCRTst = `
-- Environment: TEST
TEST.UNIT:unit
TEST.SUBPROGRAM:bar
TEST.NEW
TEST.NAME:normal

TEST.NOTES: 
TEST.END_NOTES:
TEST.END`;

const invalidEnviroTst = `-- Environment: !42
TEST.UNIT:unit
TEST.SUBPROGRAM:
TEST.NEW
TEST.NAME:valueHover
TEST.VALUE:unit.bar.return:1
TEST.NOTES: 
TEST.END_NOTES:
TEST.END`;

const testDotTst = `
TEST.NEW
TEST.NAME:valueHover
TEST.
TEST.NOTES: 
TEST.END_NOTES:
TEST.END`;

const valTst = `
TEST.NEW
TEST.NAME:valueHover
TEST.VALUE:unit.
TEST.NOTES: 
TEST.END_NOTES:
TEST.END`;

const fieldTst = `
TEST.NEW
TEST.NAME:fieldTest
TEST.VALUE:unit.<<GLOBAL>>.loc.
TEST.NOTES: 
TEST.END_NOTES:
TEST.END`;

const propertyTst = `
TEST.NEW
TEST.NAME:propertyTest
TEST.SLOT:1,unit,bar,1,
TEST.NOTES: 
TEST.END_NOTES:
TEST.END`;

const keywordTst = `
TEST.NEW
TEST.NAME:keywordTest

TEST.NOTES: 
TEST.END_NOTES:
TEST.END`;

const fieldValTst = `
TEST.NEW
TEST.NAME:fieldValTest
TEST.VALUE:unit.<<GLOBAL>>.r:
TEST.NOTES: 
TEST.END_NOTES:
TEST.END`;

const globalValTst = `
TEST.NEW
TEST.NAME:fieldValTest
TEST.VALUE:unit.<<GLOBAL>>.
TEST.NOTES: 
TEST.END_NOTES:
TEST.END`;

const scalarDetailsTst = `
TEST.NEW
TEST.NAME:scalarDetails
TEST.VALUE:unit.bar.return:
TEST.NOTES: 
TEST.END_NOTES:
TEST.END`;

const nameTst = `
TEST.NEW
TEST.NAME:
TEST.VALUE:unit.
TEST.NOTES: 
TEST.END_NOTES:
TEST.END`;

describe("Text Completion", () => {
  test(
    "validate tst completion for TEST.SUBPROGRAM:",
    async () => {
      const tstText = initialTst;
      const lineToComplete = "TEST.SUBPROGRAM:";
      const completionPosition = getCompletionPositionForLine(
        lineToComplete,
        tstText
      );
      const triggerCharacter = lineToComplete.charAt(lineToComplete.length - 1);

      const generatedCompletionData = generateCompletionData(
        tstText,
        completionPosition,
        triggerCharacter
      );

      expect(generatedCompletionData).toEqual([
        {
          label: "<<INIT>>",
          kind: 3,
          detail: "",
          data: 0,
        },
        {
          label: "<<COMPOUND>>",
          kind: 3,
          detail: "",
          data: 1,
        },
        {
          label: "bar",
          kind: 3,
          detail: "",
          data: 2,
        },
      ]);
    },
    timeout
  );

  test(
    "validate tst completion for TEST.UNIT:",
    async () => {
      const tstText = unitTst;
      const lineToComplete = "TEST.UNIT:";
      const completionPosition = getCompletionPositionForLine(
        lineToComplete,
        tstText
      );
      const triggerCharacter = lineToComplete.charAt(lineToComplete.length - 1);

      const generatedCompletionData = generateCompletionData(
        tstText,
        completionPosition,
        triggerCharacter
      );

      expect(generatedCompletionData).toEqual([
        {
          label: "USER_GLOBALS_VCAST",
          kind: 17,
          detail: "",
          data: 0,
        },
        {
          label: "unit",
          kind: 17,
          detail: "",
          data: 1,
        },
        {
          label: "uut_prototype_stubs",
          kind: 17,
          detail: "",
          data: 2,
        },
      ]);
    },
    timeout
  );

  test(
    "validate tst completion for TEST.SCRIPT_FEATURE:",
    async () => {
      // this test would fail if the vector cast release used has a different set of features
      const tstText = scriptFeatureTst;
      const lineToComplete = "TEST.SCRIPT_FEATURE:";
      const completionPosition = getCompletionPositionForLine(
        lineToComplete,
        tstText
      );
      const triggerCharacter = lineToComplete.charAt(lineToComplete.length - 1);

      const generatedCompletionData = generateCompletionData(
        tstText,
        completionPosition,
        triggerCharacter
      );

      expect(generatedCompletionData).toEqual([
        {
          label: "ACCEPTING_MISSING_CONST",
          kind: 14,
          detail: "",
          data: 0,
        },
        {
          label: "ADA_DIRECT_ARRAY_INDEXING",
          kind: 14,
          detail: "",
          data: 1,
        },
        {
          label: "C_DIRECT_ARRAY_INDEXING",
          kind: 14,
          detail: "",
          data: 2,
        },
        {
          label: "REMOVED_CL_PREFIX",
          kind: 14,
          detail: "",
          data: 3,
        },
        {
          label: "CPP_CLASS_OBJECT_REVISION",
          kind: 14,
          detail: "",
          data: 4,
        },
        {
          label: "DATA_SPACING_FORMAT",
          kind: 14,
          detail: "",
          data: 5,
        },
        {
          label: "FULL_PARAMETER_TYPES",
          kind: 14,
          detail: "",
          data: 6,
        },
        {
          label: "MIXED_CASE_NAMES",
          kind: 14,
          detail: "",
          data: 7,
        },
        {
          label: "MULTIPLE_UUT_SUPPORT",
          kind: 14,
          detail: "",
          data: 8,
        },
        {
          label: "OVERLOADED_CONST_SUPPORT",
          kind: 14,
          detail: "",
          data: 9,
        },
        {
          label: "STANDARD_SPACING_R2",
          kind: 14,
          detail: "",
          data: 10,
        },
        {
          label: "STRUCT_BASE_CTOR_ADDS_POINTER",
          kind: 14,
          detail: "",
          data: 11,
        },
        {
          label: "STRUCT_DTOR_ADDS_POINTER",
          kind: 14,
          detail: "",
          data: 12,
        },
        {
          label: "STRUCT_FIELD_CTOR_ADDS_POINTER",
          kind: 14,
          detail: "",
          data: 13,
        },
        {
          label: "STATIC_HEADER_FUNCS_IN_UUTS",
          kind: 14,
          detail: "",
          data: 14,
        },
        {
          label: "UNDERSCORE_NULLPTR",
          kind: 14,
          detail: "",
          data: 15,
        },
        {
          label: "VCAST_MAIN_NOT_RENAMED",
          kind: 14,
          detail: "",
          data: 16,
        },
      ]);
    },
    timeout
  );

  test(
    "validate tst completion for TEST.SLOT:",
    async () => {
      const tstText = slotTst;
      const lineToComplete = "TEST.SLOT:";
      const completionPosition = getCompletionPositionForLine(
        lineToComplete,
        tstText
      );
      const triggerCharacter = lineToComplete.charAt(lineToComplete.length - 1);

      const generatedCompletionData = generateCompletionData(
        tstText,
        completionPosition,
        triggerCharacter
      );

      expect(generatedCompletionData).toEqual([
        {
          label: "<slot-number>",
          kind: 21,
          detail: "",
          data: 0,
        },
      ]);
    },
    timeout
  );

  test(
    "validate tst completion for TEST.",
    async () => {
      const tstText = [initialTst, testDotTst].join("\n");

      const lineToComplete = "TEST.";
      const completionPosition = getCompletionPositionForLine(
        lineToComplete,
        tstText
      );
      const triggerCharacter = lineToComplete.charAt(lineToComplete.length - 1);

      const generatedCompletionData = generateCompletionData(
        tstText,
        completionPosition,
        triggerCharacter
      );
      expect(generatedCompletionData).toEqual([
        {
          label: "SCRIPT_FEATURE",
          kind: 14,
          detail: "",
          data: 0,
        },
        {
          label: "UNIT",
          kind: 14,
          detail: "",
          data: 1,
        },
        {
          label: "SUBPROGRAM",
          kind: 14,
          detail: "",
          data: 2,
        },
        {
          label: "NEW",
          kind: 14,
          detail: "",
          data: 3,
        },
        {
          label: "REPLACE",
          kind: 14,
          detail: "",
          data: 4,
        },
        {
          label: "ADD",
          kind: 14,
          detail: "",
          data: 5,
        },
        {
          label: "END",
          kind: 14,
          detail: "",
          data: 6,
        },
        {
          label: "NAME",
          kind: 14,
          detail: "",
          data: 7,
        },
        {
          label: "NOTES",
          kind: 14,
          detail: "",
          data: 8,
        },
        {
          label: "END_NOTES",
          kind: 14,
          detail: "",
          data: 9,
        },
        {
          label: "FLOW",
          kind: 14,
          detail: "",
          data: 10,
        },
        {
          label: "END_FLOW",
          kind: 14,
          detail: "",
          data: 11,
        },
        {
          label: "VALUE",
          kind: 14,
          detail: "",
          data: 12,
        },
        {
          label: "SLOT",
          kind: 14,
          detail: "",
          data: 13,
        },
        {
          label: "EXPECTED",
          kind: 14,
          detail: "",
          data: 14,
        },
        {
          label: "STUB",
          kind: 14,
          detail: "",
          data: 15,
        },
        {
          label: "VALUE_USER_CODE",
          kind: 14,
          detail: "",
          data: 16,
        },
        {
          label: "END_VALUE_USER_CODE",
          kind: 14,
          detail: "",
          data: 17,
        },
        {
          label: "EXPECTED_USER_CODE",
          kind: 14,
          detail: "",
          data: 18,
        },
        {
          label: "END_EXPECTED_USER_CODE",
          kind: 14,
          detail: "",
          data: 19,
        },
        {
          label: "IMPORT_FAILURES",
          kind: 14,
          detail: "",
          data: 20,
        },
        {
          label: "END_IMPORT_FAILURES",
          kind: 14,
          detail: "",
          data: 21,
        },
        {
          label: "COMPOUND_ONLY",
          kind: 14,
          detail: "",
          data: 22,
        }
      ]);
    },
    timeout
  );

  test(
    "validate tst completion for TEST.VALUE:unit.",
    async () => {
      const tstText = [initialTst, valTst].join("\n");
      const lineToComplete = "TEST.VALUE:unit.";
      const completionPosition = getCompletionPositionForLine(
        lineToComplete,
        tstText
      );
      const triggerCharacter = lineToComplete.charAt(lineToComplete.length - 1);

      const generatedCompletionData = generateCompletionData(
        tstText,
        completionPosition,
        triggerCharacter
      );
      expect(generatedCompletionData).toEqual([
        {
          label: "bar",
          kind: 3,
          detail: "",
          data: 0,
        },
        {
          label: "<<GLOBAL>>",
          kind: 3,
          detail: "",
          data: 1,
        },
      ]);
    },
    timeout
  );

  test(
    "validate tst completion for TEST.VALUE:unit.<<GLOBAL>>.loc. field",
    async () => {
      const tstText = [initialTst, fieldTst].join("\n");
      const lineToComplete = "TEST.VALUE:unit.<<GLOBAL>>.loc.";
      const completionPosition = getCompletionPositionForLine(
        lineToComplete,
        tstText
      );
      const triggerCharacter = lineToComplete.charAt(lineToComplete.length - 1);

      const generatedCompletionData = generateCompletionData(
        tstText,
        completionPosition,
        triggerCharacter
      );
      expect(generatedCompletionData).toEqual([
        {
          label: "x",
          kind: 5,
          detail: "int",
          data: 0,
        },
        {
          label: "y",
          kind: 5,
          detail: "int",
          data: 1,
        },
      ]);
    },
    timeout
  );

  test(
    "validate tst completion for TEST.VALUE:unit.<<GLOBAL>>.r: field value",
    async () => {
      const tstText = [initialTst, fieldValTst].join("\n");
      const lineToComplete = "TEST.VALUE:unit.<<GLOBAL>>.r:";
      const completionPosition = getCompletionPositionForLine(
        lineToComplete,
        tstText
      );
      const triggerCharacter = lineToComplete.charAt(lineToComplete.length - 1);

      const generatedCompletionData = generateCompletionData(
        tstText,
        completionPosition,
        triggerCharacter
      );
      expect(generatedCompletionData).toEqual([
        {
          data: 0,
          label: "red",
          kind: 13,
          detail: "",
        },
        {
          data: 1,
          label: "green",
          kind: 13,
          detail: "",
        },
        {
          data: 2,
          label: "blue",
          kind: 13,
          detail: "",
        },
      ]);
    },
    timeout
  );

  test(
    "validate tst completion for TEST.VALUE:unit.<<GLOBAL>>. field value",
    async () => {
      const tstText = [initialTst, globalValTst].join("\n");
      const lineToComplete = "TEST.VALUE:unit.<<GLOBAL>>.";
      const completionPosition = getCompletionPositionForLine(
        lineToComplete,
        tstText
      );
      const triggerCharacter = lineToComplete.charAt(lineToComplete.length - 1);

      const generatedCompletionData = generateCompletionData(
        tstText,
        completionPosition,
        triggerCharacter
      );
      expect(generatedCompletionData).toEqual([
        {
          data: 0,
          label: "loc",
          kind: 6,
          detail: "location(struct)",
        },
        {
          data: 1,
          label: "r",
          kind: 6,
          detail: "enum",
        },
        {
          data: 2,
          label: "global",
          kind: 6,
          detail: "int",
        },
      ]);
    },
    timeout
  );

  test(
    "validate tst completion for TEST.SLOT:1,unit,bar,1,",
    async () => {
      const tstText = [initialTst, propertyTst].join("\n");
      const lineToComplete = "TEST.SLOT:1,unit,bar,1,";
      const completionPosition = getCompletionPositionForLine(
        lineToComplete,
        tstText
      );
      const triggerCharacter = lineToComplete.charAt(lineToComplete.length - 1);

      const generatedCompletionData = generateCompletionData(
        tstText,
        completionPosition,
        triggerCharacter
      );
      expect(generatedCompletionData).toEqual([
        {
          data: 0,
          label: "no test cases exist",
          kind: 10,
          detail: "",
        },
      ]);
    },
    timeout
  );

  test(
    "validate tst completion for empty line",
    async () => {
      const tstText = [initialTst, keywordTst].join("\n");
      const lineToComplete = "TEST.NAME:keywordTest";
      const completionPosition = getCompletionPositionForLine(
        lineToComplete,
        tstText
      );
      // edge case
      completionPosition.line += 1;
      completionPosition.character = 1;
      const triggerCharacter = "\n";

      const generatedCompletionData = generateCompletionData(
        tstText,
        completionPosition,
        triggerCharacter
      );

      expect(generatedCompletionData).toEqual([
        {
          data: 0,
          label: "TEST",
          kind: 14,
          detail: "",
        },
        {
          data: 1,
          label: "TEST.VALUE",
          kind: 14,
          detail: "",
        },
        {
          data: 2,
          label: "TEST.EXPECTED",
          kind: 14,
          detail: "",
        },
        {
          data: 3,
          label: "\n",
          kind: 14,
          detail: "",
        },
      ]);
    },
    timeout
  );

  test(
    "validate scalar value completion for TEST.VALUE:unit.bar.return:",
    async () => {
      const tstText = [initialTst, scalarDetailsTst].join("\n");
      const lineToComplete = "TEST.VALUE:unit.bar.return:";
      const completionPosition = getCompletionPositionForLine(
        lineToComplete,
        tstText
      );
      const triggerCharacter = lineToComplete.charAt(lineToComplete.length - 1);

      const generatedCompletionData = generateCompletionData(
        tstText,
        completionPosition,
        triggerCharacter
      );
      expect(generatedCompletionData).toEqual([
        {
          label: "number",
          kind: 21,
          detail: "",
        },
        {
          label: "vary",
          kind: 15,
          insertText: "VARY FROM:$1 TO:$2 BY:$3",
          insertTextFormat: 2,
        },
        {
          label: "<<MIN>>",
          kind: 21,
          detail: "",
        },
        {
          label: "<<MID>>",
          kind: 21,
          detail: "",
        },
        {
          label: "<<MAX>>",
          kind: 21,
          detail: "",
        },
      ]);
    },
    timeout
  );

  test(
    "validate tst completion for TEST.NAME:",
    async () => {
      const tstText = [initialTst, nameTst].join("\n");
      const lineToComplete = "TEST.NAME:";
      const completionPosition = getCompletionPositionForLine(
        lineToComplete,
        tstText
      );
      const triggerCharacter = lineToComplete.charAt(lineToComplete.length - 1);

      const generatedCompletionData = generateCompletionData(
        tstText,
        completionPosition,
        triggerCharacter
      );
      expect(generatedCompletionData).toEqual([
        {
          label: "<test-name>",
          kind: 1,
          detail: "",
          data: 0,
        },
      ]);
    },
    timeout
  );

  test(
    'validate "no document" case',
    async () => {
      const tstText = initialTst;
      const lineToComplete = "TEST.SUBPROGRAM:";
      const completionPosition = getCompletionPositionForLine(
        lineToComplete,
        tstText
      );
      const triggerCharacter = lineToComplete.charAt(lineToComplete.length - 1);

      const generatedCompletionData = generateCompletionData(
        tstText,
        completionPosition,
        triggerCharacter,
        "vcast",
        true
      );
      expect(generatedCompletionData).toEqual([]);
    },
    timeout
  );

  test(
    'validate "invalid environment name" case',
    async () => {
      const tstText = invalidEnviroTst;
      const languageId = "VectorCAST Test Script";
      const testEnvPath = path.join(
        process.env["PACKAGE_PATH"],
        "tests",
        "unit",
        "fake_vcast"
      );
      const tst_filepath = path.join(testEnvPath, process.env["TST_FILENAME"]);
      const uri = URI.file(tst_filepath).toString();

      const textDoc = TextDocument.create(uri, languageId, 1, tstText);
      const documents = new TextDocuments();
      documents["_documents"][uri] = textDoc;

      const lineToComplete = "TEST.SUBPROGRAM:";
      const completionPosition = getCompletionPositionForLine(
        lineToComplete,
        tstText
      );
      const triggerCharacter = lineToComplete.charAt(lineToComplete.length - 1);

      const generatedCompletionData = generateCompletionData(
        tstText,
        completionPosition,
        triggerCharacter,
        "fake_vcast"
      );
      expect(generatedCompletionData).toEqual([]);
    },
    timeout
  );

  test(
    "validate handling of undefined triggerCharacter case",
    async () => {
      const tstText = invalidEnviroTst;
      const lineToComplete = "TEST.SUBPROGRAM:";
      const completionPosition = getCompletionPositionForLine(
        lineToComplete,
        tstText
      );
      const triggerCharacter = undefined;
      const generatedCompletionData = generateCompletionData(
        tstText,
        completionPosition,
        triggerCharacter
      );
      expect(generatedCompletionData).toEqual([]);
    },
    timeout
  );

  test(
    "validate tst completion for COMPOUND test on CR (new line)",
    async () => {
      const tstText = compoundTst;
      const lineToComplete = "TEST.END_NOTES:";
      const completionPosition = getCompletionPositionForLine(
        lineToComplete,
        tstText
      );
      completionPosition.line += 1;
      completionPosition.character = 1;
      const triggerCharacter = "CR";

      const generatedCompletionData = generateCompletionData(
        tstText,
        completionPosition,
        triggerCharacter
      );
      expect(generatedCompletionData).toEqual([
        {
          label: "TEST",
          kind: 14,
          detail: "",
          data: 0,
        },
        {
          label: "TEST.SLOT",
          kind: 14,
          detail: "",
          data: 1,
        },
        {
          label: "\n",
          kind: 14,
          detail: "",
          data: 2,
        },
      ]);
    },
    timeout
  );

  test(
    'validate tst completion for COMPOUND test on "\n" as new line)',
    async () => {
      const tstText = compoundTst;
      const lineToComplete = "TEST.END_NOTES:";
      const completionPosition = getCompletionPositionForLine(
        lineToComplete,
        tstText
      );
      completionPosition.line += 1;
      completionPosition.character = 1;
      const triggerCharacter = "\n";

      const generatedCompletionData = generateCompletionData(
        tstText,
        completionPosition,
        triggerCharacter
      );
      expect(generatedCompletionData).toEqual([
        {
          label: "TEST",
          kind: 14,
          detail: "",
          data: 0,
        },
        {
          label: "TEST.SLOT",
          kind: 14,
          detail: "",
          data: 1,
        },
        {
          label: "\n",
          kind: 14,
          detail: "",
          data: 2,
        },
      ]);
    },
    timeout
  );

  test(
    "validate tst completion for standard test on CR (new line)",
    async () => {
      const tstText = normalCRTst;
      const languageId = "VectorCAST Test Script";
      const testEnvPath = path.join(
        process.env["PACKAGE_PATH"],
        "tests",
        "unit",
        "vcast"
      );
      const tst_filepath = path.join(testEnvPath, process.env["TST_FILENAME"]);
      const uri = URI.file(tst_filepath).toString();

      const textDoc = TextDocument.create(uri, languageId, 1, tstText);
      const documents = new TextDocuments();
      documents["_documents"][uri] = textDoc;

      const lineToComplete = "TEST.NAME:normal";
      const completionPosition = getCompletionPositionForLine(
        lineToComplete,
        tstText
      );
      completionPosition.line += 1;
      completionPosition.character = 1;
      const triggerCharacter = "CR";

      const generatedCompletionData = generateCompletionData(
        tstText,
        completionPosition,
        triggerCharacter
      );

      expect(generatedCompletionData).toEqual([
        {
          label: "TEST",
          kind: 14,
          detail: "",
          data: 0,
        },
        {
          label: "TEST.VALUE",
          kind: 14,
          detail: "",
          data: 1,
        },
        {
          label: "TEST.EXPECTED",
          kind: 14,
          detail: "",
          data: 2,
        },
        {
          label: "\n",
          kind: 14,
          detail: "",
          data: 3,
        },
      ]);
    },
    timeout
  );
});
