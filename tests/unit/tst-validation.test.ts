import { describe, expect, test } from "vitest";
import { generateDiagnosticMessages } from "./utils";

const timeout = 30_000; // 30 seconds

const initialTst = `
-- Environment: TEST
TEST.UNIT:unit
TEST.SUBPROGRAM:vcast
`;

const illegalLineTst = `
Some invalid comment
-- Environment: TEST
TEST.UNIT:unit
TEST.SUBPROGRAM:vcast
`;

const testNotesTst = `
TEST.NEW
TEST.NAME:wrongBlock
TEST.NOTES:
TEST.
TEST.END_NOTES:
TEST.END
`;

const testFlowTst = `
TEST.NEW
TEST.NAME:wrongBlock
TEST.FLOW:
TEST.
TEST.END_FLOW:
TEST.END
`;

const testValueUserCodeTst = `
TEST.NEW
TEST.NAME:wrongBlock
TEST.VALUE_USER_CODE:
TEST.
TEST.END_VALUE_USER_CODE:
TEST.END
`;

const testExpectedUserCodeTst = `
TEST.NEW
TEST.NAME:wrongBlock
TEST.EXPECTED_USER_CODE:
TEST.
TEST.END_EXPECTED_USER_CODE:
TEST.END
`;

const testImportFailuresTst = `
TEST.NEW
TEST.NAME:wrongBlock
TEST.IMPORT_FAILURES:
TEST.
TEST.END_IMPORT_FAILURES:
TEST.END
`;

const invalidCommandTst = `
TEST.INVALID
TEST.NEW
TEST.NAME:invalidCommand
TEST.END
`;

const missingUnitTst = `
-- Environment: TEST
TEST.SUBPROGRAM:vcast
`;

const missingSubprogramTst = `
-- Environment: TEST
TEST.UNIT:unit
TEST.NEW
TEST.NAME:missingSubprogram
TEST.END
`;

const missingSubprogramReplaceTst = `
-- Environment: TEST
TEST.UNIT:unit
TEST.REPLACE
TEST.NAME:missingSubprogram
TEST.END
`;

const missingSubprogramAddTst = `
-- Environment: TEST
TEST.UNIT:unit
TEST.ADD
TEST.NAME:missingSubprogram
TEST.END
`;

const testMissingNewOrReplaceTst = `
TEST.NAME:missingNew
TEST.END
`;

const invalidScriptFeatureTst = `
TEST.SCRIPT_FEATURE:INVALID_BLA_FEATURE
`;

const testAllowedTestCommandTst = `
TEST.SLOT:
TEST.NEW
TEST.NAME:wrongBlock
TEST.VALUE:
TEST.EXPECTED:
TEST.STUB:
TEST.END
`;

describe("Text Document Validator", () => {
  test(
    "validate error detection when typing commands in TEST.NOTES block",
    async () => {
      const tstText = [initialTst, testNotesTst].join("\n");
      const diagnosticMessages = generateDiagnosticMessages(tstText);
      expect(diagnosticMessages).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            'Commands cannot be nested in a "NOTES" block'
          ),
        ])
      );
    },
    timeout
  );

  test(
    "validate error detection when typing commands in TEST.FLOW block",
    async () => {
      const tstText = [initialTst, testFlowTst].join("\n");
      const diagnosticMessages = generateDiagnosticMessages(tstText);
      expect(diagnosticMessages).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            'Commands cannot be nested in a "FLOW" block'
          ),
        ])
      );
    },
    timeout
  );

  test(
    "validate error detection when typing commands in TEST.VALUE_USER_CODE block",
    async () => {
      const tstText = [initialTst, testValueUserCodeTst].join("\n");
      const diagnosticMessages = generateDiagnosticMessages(tstText);
      expect(diagnosticMessages).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            'Commands cannot be nested in a "VALUE_USER_CODE" block'
          ),
        ])
      );
    },
    timeout
  );

  test(
    "validate error detection when typing commands in TEST.EXPECTED_USER_CODE block",
    async () => {
      const tstText = [initialTst, testExpectedUserCodeTst].join("\n");
      const diagnosticMessages = generateDiagnosticMessages(tstText);
      expect(diagnosticMessages).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            'Commands cannot be nested in a "EXPECTED_USER_CODE" block'
          ),
        ])
      );
    },
    timeout
  );

  test(
    "validate error detection when typing commands in TEST.IMPORT_FAILURES block",
    async () => {
      const tstText = [initialTst, testImportFailuresTst].join("\n");
      const diagnosticMessages = generateDiagnosticMessages(tstText);
      expect(diagnosticMessages).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            'Commands cannot be nested in a "IMPORT_FAILURES" block'
          ),
        ])
      );
    },
    timeout
  );

  test(
    "validate error detection when typing an invalid command after TEST.",
    async () => {
      const tstText = [initialTst, invalidCommandTst].join("\n");
      const diagnosticMessages = generateDiagnosticMessages(tstText);
      expect(diagnosticMessages).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            "Invalid command, type TEST. to see all command values"
          ),
        ])
      );
    },
    timeout
  );

  test(
    "validate error detection when TEST.UNIT is needed but missing",
    async () => {
      const tstText = missingUnitTst;
      const diagnosticMessages = generateDiagnosticMessages(tstText);
      expect(diagnosticMessages).toEqual(
        expect.arrayContaining([
          expect.stringContaining("TEST.UNIT is required but missing"),
        ])
      );
    },
    timeout
  );

  test(
    "validate error detection when TEST.SUBPROGRAM is needed but missing",
    async () => {
      const tstText = missingSubprogramTst;
      const diagnosticMessages = generateDiagnosticMessages(tstText);
      expect(diagnosticMessages).toEqual(
        expect.arrayContaining([
          expect.stringContaining("TEST.SUBPRORGRAM is required but missing"),
        ])
      );
    },
    timeout
  );

  test(
    "validate error detection when in TEST.REPLACE TEST.SUBPROGRAM is needed but missing",
    async () => {
      const tstText = missingSubprogramReplaceTst;
      const diagnosticMessages = generateDiagnosticMessages(tstText);
      expect(diagnosticMessages).toEqual(
        expect.arrayContaining([
          expect.stringContaining("TEST.SUBPRORGRAM is required but missing"),
        ])
      );
    },
    timeout
  );

  test(
    "validate error detection when in TEST.ADD TEST.SUBPROGRAM is needed but missing",
    async () => {
      const tstText = missingSubprogramAddTst;
      const diagnosticMessages = generateDiagnosticMessages(tstText);
      expect(diagnosticMessages).toEqual(
        expect.arrayContaining([
          expect.stringContaining("TEST.SUBPRORGRAM is required but missing"),
        ])
      );
    },
    timeout
  );

  test(
    "validate error detection when TEST.NEW or TEST.REPLACE are missing but we have TEST.END",
    async () => {
      const tstText = [initialTst, testMissingNewOrReplaceTst].join("\n");
      const diagnosticMessages = generateDiagnosticMessages(tstText);
      expect(diagnosticMessages).toEqual(
        expect.arrayContaining([
          expect.stringContaining("TEST.NEW | REPLACE is required but missing"),
        ])
      );
    },
    timeout
  );

  test(
    "validate error detection when an invalid script feature is used",
    async () => {
      const tstText = invalidScriptFeatureTst;
      const diagnosticMessages = generateDiagnosticMessages(tstText);
      expect(diagnosticMessages).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            "Invalid feature flag, type TEST.SCRIPT_FEATURE: to see a all flags"
          ),
        ])
      );
    },
    timeout
  );

  test(
    "validate error detection when an invalid script feature is used",
    async () => {
      const tstText = illegalLineTst;
      const diagnosticMessages = generateDiagnosticMessages(tstText);
      expect(diagnosticMessages).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            "Illegal line, comments must start with -- or //"
          ),
        ])
      );
    },
    timeout
  );

  test(
    "cover the case of using TEST.VALUE, TEST.EXPECTED or TEST.STUB",
    async () => {
      const tstText = [initialTst, testAllowedTestCommandTst].join("\n");
      const diagnosticMessages = generateDiagnosticMessages(tstText);
      expect(diagnosticMessages).toEqual(expect.arrayContaining([]));
    },
    timeout
  );
});
