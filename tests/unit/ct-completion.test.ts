import {
  describe,
  expect,
  test,
  vi,
  afterEach,
  SpyInstance,
  beforeEach,
} from "vitest";
import {
  getCompletionPositionForLine,
  generateCompletionData,
  asCompletionParameters,
} from "./utils";
import { TextDocument } from "vscode-languageserver";
import URI from "vscode-uri";
import path from "path";
import { getEnviroNameFromTestScript } from "../../server/serverUtilities";
import { getCodedTestCompletionData } from "../../server/ctCompletions";

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

// Import the vscode-languageserver module and mock createConnection
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
    ProposedFeatures: actual.ProposedFeatures,
  };
});

describe("Testing pythonUtilities (valid)", () => {
  let logSpy: SpyInstance;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
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
      // Create a custom connection object with a console.log function
      const customConnection = {
        console: {
          log: (message: string) => console.log(message),
        },
      };

      const lineToComplete = "// vmock";
      const completionPosition = getCompletionPositionForLine(
        lineToComplete,
        unitTst
      );

      const envName = "vcast";

      const languageId = "cpp";

      const testEnvPath = path.join(
        process.env.PACKAGE_PATH as string,
        "tests",
        "unit",
        envName
      );
      const tstFilepath = path.join(
        testEnvPath,
        process.env.TST_FILENAME as string
      );

      const triggerCharacter = lineToComplete.at(-1);
      const uri = URI.file(tstFilepath).toString();
      const textDocument = TextDocument.create(uri, languageId, 1, unitTst);

      const completion = asCompletionParameters(
        textDocument,
        completionPosition,
        triggerCharacter
      );

      const enviroPath = getEnviroNameFromTestScript(tstFilepath);

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
});

// Generate tests based on input
const validateCodedTestCompletion = async (
  lineToComplete: string,
  expectedReturn: any,
  mockOptions?: { mockReturnValue?: any }
) => {
  // Apply mock if provided
  if (mockOptions) {
    const pythonUtilities = await import("../../server/pythonUtilities");
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
