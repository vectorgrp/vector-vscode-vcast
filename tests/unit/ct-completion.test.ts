import path from "node:path";
import process from "node:process";
import { type Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import {
  describe,
  expect,
  test,
  vi,
  afterEach,
  type SpyInstance,
  beforeEach,
} from "vitest";
import { getEnviroNameFromTestScript } from "../../langServer/serverUtilities";
import { getCodedTestCompletionData } from "../../langServer/ctCompletions";
import {
  choiceKindType,
  generateDiagnosticForTest,
  getChoiceData,
} from "../../langServer/pythonUtilities";
import { setGLobalServerState } from "../../src-common/vcastServer";
import {
  getCompletionPositionForLine,
  generateCompletionData,
  prepareCodedTestCompletion,
  setupDiagnosticTest,
} from "./utils";
import axios from "axios";

const expectedReceivedData = [
  {
    additionalTextEdits: [
      {
        newText: "// some extra data",
        range: {
          end: {
            character: 0,
            line: 0,
          },
          start: {
            character: 0,
            line: 0,
          },
        },
      },
    ],
    data: 0,
    detail: "",
    kind: 1,
    label: "unit",
  },
  {
    data: 1,
    detail: "",
    kind: 1,
    label: "Prototype-Stubs",
  },
];

// Need dummy coded test file for function (can be empty)
const unitTst = ``;

// Expected results for tests suites
const extraTextMockExpected = [
  {
    additionalTextEdits: [
      {
        newText: "// some extra data",
        range: {
          end: {
            character: 0,
            line: 0,
          },
          start: {
            character: 0,
            line: 0,
          },
        },
      },
    ],
    data: 0,
    detail: "",
    kind: 1,
    label: "unit",
  },
  {
    data: 1,
    detail: "",
    kind: 1,
    label: "Prototype-Stubs",
  },
];

const vmockExpected = [
  {
    data: 0,
    detail: "",
    kind: 1,
    label: "unit",
  },
  {
    data: 1,
    detail: "",
    kind: 1,
    label: "Prototype-Stubs",
  },
];

const vmockUnitBarExpected = `
int vmock_unit_bar(::vunit::CallCtx<> vunit_ctx, int z) {
  // Enable Stub: vmock_unit_bar_enable_disable(vmock_session);
  // Disable Stub: vmock_unit_bar_enable_disable(vmock_session, false);

  // Insert mock logic here!
}
void vmock_unit_bar_enable_disable(vunit::MockSession &vmock_session, bool enable = true) {
    using vcast_mock_rtype = int ;
    vcast_mock_rtype (*vcast_fn_ptr)(int)  = &bar;
    vmock_session.mock <vcast_mock_rtype (*)(int)> ((vcast_mock_rtype (*)(int))vcast_fn_ptr).assign (enable ? &vmock_unit_bar : nullptr);
}
// end of mock for: vmock_unit_bar -------------------------------------------------------------------------------------

`;

const vmockUnitBarExpectedComplete = [
  {
    data: 0,
    detail: "",
    kind: 1,
    label: vmockUnitBarExpected,
  },
];

const vmockUnitExpected = [
  {
    data: 0,
    detail: "",
    kind: 1,
    label: "bar",
  },
];

const timeout = 30_000; // 30 seconds

// Import the vscode-languageserver module and mock createConnection.
// We import it this way to mock only the types and functions we NEED to mock,
// while everything else is imported normally.
/* eslint-disable @typescript-eslint/consistent-type-imports */
vi.mock("vscode-languageserver", async () => {
  const actual = await vi.importActual<typeof import("vscode-languageserver")>(
    "vscode-languageserver"
  );

  return {
    ...actual,
    createConnection: vi.fn().mockReturnValue({
      console: {
        log: vi.fn(),
      },
    }),
    // XO complains about strictCamelCase for imports, so we'll disable the check here.
    /* eslint-disable @typescript-eslint/naming-convention */
    ProposedFeatures: actual.ProposedFeatures,
  };
});
/* eslint-enable @typescript-eslint/naming-convention */
/* eslint-enable @typescript-eslint/consistent-type-imports */

describe("Testing pythonUtilities (valid)", () => {
  let logSpy: SpyInstance;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {
      // No-op (This comment prevents XO from complaining)
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test(
    "validate coded test completion for lines of interest (// vmock) and extra text.",
    async () => {
      // Mocks `pythonUtilities` to simulate retrieving "extraText", which is not yet implemented.
      await validateCodedTestCompletion("// vmock", extraTextMockExpected, {
        mockReturnValue: {
          choiceKind: "File",
          choiceList: ["unit", "Prototype-Stubs"],
          extraText: "some extra data",
          messages: ["some", "messages"],
        },
      });
    },
    timeout
  );

  test(
    "validate coded test completion for lines of interest (// vmock) and without extra text.",
    async () => {
      await validateCodedTestCompletion("// vmock", vmockExpected);
    },
    timeout
  );

  test(
    "validate coded test completion for lines of interest (// vmock unit) and without extra text.",
    async () => {
      await validateCodedTestCompletion("// vmock unit", vmockUnitExpected);
    },
    timeout
  );

  test(
    "validate coded test completion for lines of interest (// vmock unit bar) and without extra text.",
    async () => {
      await validateCodedTestCompletion(
        "// vmock unit bar",
        vmockUnitBarExpectedComplete
      );
    },
    timeout
  );

  test(
    "validate console log if connection is defined",
    async () => {
      const customConnection = {
        console: {
          log(message: string) {
            console.log(message);
          },
        },
      };

      const unitTst = ``;
      const lineToComplete = "// vmock";
      const envName = "vcast";
      const languageId = "cpp";

      const { completion, enviroPath } = await prepareCodedTestCompletion(
        lineToComplete,
        unitTst,
        envName,
        languageId
      );

      expect(enviroPath).not.toBe(undefined);

      if (enviroPath) {
        await getCodedTestCompletionData(
          customConnection,
          lineToComplete,
          completion,
          enviroPath
        );
      }

      expect(logSpy).toHaveBeenCalledWith(`Processing: ${lineToComplete}`);
    },
    timeout
  );

  test(
    "validate getChoiceDataFromServer",
    async () => {
      const pythonUtilities = await import("../../src-common/vcastServer");

      // Spy on `transmitCommand` and mock its implementation
      vi.spyOn(pythonUtilities, "transmitCommand").mockResolvedValue({
        success: true,
        returnData: {
          data: {
            choiceKind: "File",
            choiceList: ["unit", "Prototype-Stubs"],
            extraText: "some extra data",
            messages: ["some", "messages"],
          },
        },
        statusText: "success",
      });

      setGLobalServerState(true);

      const unitTst = ``;
      const lineToComplete = "// vmock";
      const envName = "vcast";
      const languageId = "cpp";

      const { completion, enviroPath } = await prepareCodedTestCompletion(
        lineToComplete,
        unitTst,
        envName,
        languageId
      );

      if (enviroPath) {
        const result = await getCodedTestCompletionData(
          undefined,
          lineToComplete,
          completion,
          enviroPath
        );
        expect(result).toEqual(expectedReceivedData);
      }
    },
    timeout
  );

  // Mock axios
  vi.mock("axios");
  const mockAxiosPost = vi.mocked(axios.post);

  // Generalized function to mock axios post for successful or error responses
  const mockAxios = (
    responseBody:
      | {
          exitCode: number;
          data:
            | Record<string, unknown>
            | { error: string[] }
            | { text: string[] };
        }
      | Error, // Allow either a valid response or an Error
    status = 200,
    statusText = "OK",
    // Optional parameter to simulate error
    shouldThrowError = false
  ) => {
    if (shouldThrowError) {
      // Simulate an error scenario
      mockAxiosPost.mockRejectedValueOnce(responseBody);
    } else {
      // Simulate a successful response
      mockAxiosPost.mockImplementation(async () =>
        Promise.resolve({
          data: responseBody,
          status,
          statusText,
        })
      );
    }
  };

  test(
    "validate getChoiceDataFromServer if it fails",
    async () => {
      // Mock axios to simulate a failure and throw an error
      mockAxios(
        new Error("Failed to fetch: reason: Server down"),
        500,
        "Internal Server Error",
        true
      );
      setGLobalServerState(true);

      const lineToComplete = "// vmock";
      const envName = "vcast";
      let tstFilePath = " ";

      if (process.env.PACKAGE_PATH && process.env.TST_FILENAME) {
        const testEnvPath = path.join(
          process.env.PACKAGE_PATH,
          "tests",
          "unit",
          envName
        );
        tstFilePath = path.join(testEnvPath, process.env.TST_FILENAME);
      }

      const enviroPath = getEnviroNameFromTestScript(tstFilePath);
      let result: any;
      if (enviroPath) {
        result = await getChoiceData(
          choiceKindType.choiceListCT,
          enviroPath,
          lineToComplete
        );
      }

      expect(result).toStrictEqual({
        choiceKind: "",
        choiceList: [],
        extraText: "",
        messages: [],
      });
    },
    timeout
  );

  test("should create and send a diagnostic objects for tst and ct", () => {
    const diagnostic: Diagnostic = {
      severity: DiagnosticSeverity.Warning,
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 1000 },
      },
      message: "Test message",
      source: "VectorCAST Test Explorer",
    };

    // Use the utility function to mock and set up the test
    const { connection, mockSendDiagnostics } = setupDiagnosticTest(diagnostic);

    // Function under test
    generateDiagnosticForTest(
      connection,
      "Test message",
      "file:///path/to/document",
      1
    );

    // Verify sendDiagnostics was called with correct arguments
    expect(mockSendDiagnostics).toHaveBeenCalledWith({
      uri: "file:///path/to/document",
      diagnostics: [diagnostic],
    });
  });
});

// Generate tests based on input
const validateCodedTestCompletion = async (
  lineToComplete: string,
  expectedReturn: any,
  mockOptions?: { mockReturnValue?: any }
) => {
  // Apply mock if provided
  if (mockOptions) {
    const pythonUtilities = await import("../../langServer/pythonUtilities");
    vi.spyOn(pythonUtilities, "getChoiceData").mockReturnValue(
      mockOptions.mockReturnValue
    );
  }

  const tstText = unitTst;
  const completionPosition = getCompletionPositionForLine(
    lineToComplete,
    tstText
  );
  const triggerCharacter = lineToComplete.at(-1);
  const cppTestFlag = { cppTest: true, lineSoFar: lineToComplete };

  const codedTestCompletionData = await generateCompletionData(
    tstText,
    completionPosition,
    triggerCharacter,
    cppTestFlag
  );

  expect(codedTestCompletionData).toEqual(expectedReturn);
};
