import { describe, expect, test, vi, afterEach } from "vitest";
import { getCompletionPositionForLine, generateCompletionData } from "./utils";

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

describe("Testing pythonUtilities (valid)", () => {
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
          messages: [],
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
    vi.spyOn(pythonUtilities, "getChoiceDataFromPython").mockReturnValue(
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

  const codedTestCompletionData = generateCompletionData(
    tstText,
    completionPosition,
    triggerCharacter,
    cppTestFlag
  );

  expect(codedTestCompletionData).toEqual(expectedReturn);
};
