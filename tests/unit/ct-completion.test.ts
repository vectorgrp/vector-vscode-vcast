import { describe, expect, test, vi, afterEach, beforeEach } from "vitest";
import {
  getCompletionPositionForLine,
  generateCompletionData,
} from "./utils.js";

const unitTst = `
// ---------------------------------------------------------------------------------------
// Simple Example - new
// vmock vmock_examples simpleFunction 
int vmock_vmock_examples_simpleFunction(::vunit::CallCtx<> vunit_ctx, char param1, float param2) {
  // Enable Stub: vmock_vmock_examples_simpleFunction_enable_disable(vmock_session);
  // Disable Stub: vmock_vmock_examples_simpleFunction_enable_disable(vmock_session, false);

  return 100;
}
void vmock_vmock_examples_simpleFunction_enable_disable(vunit::MockSession &vmock_session, bool enable = true) {
    using vcast_mock_rtype = int ;
    vcast_mock_rtype (*vcast_fn_ptr)(char param1, float param2)  = &simpleFunction;
    vmock_session.mock <vcast_mock_rtype (*)(char param1, float param2)> ((vcast_mock_rtype (*)(char param1, float param2))vcast_fn_ptr).assign (enable ? &vmock_vmock_examples_simpleFunction : nullptr);
}

VTEST(vmockExamples, simpleTest2) {

  auto vmock_session = ::vunit::MockSession();
  vmock_vmock_examples_simpleFunction_enable_disable(vmock_session);
  VASSERT_EQ (100, simpleFunction ('a', 1.0));

  // disable the stub, which means the real code will return param1 'a' or 97
  vmock_vmock_examples_simpleFunction_enable_disable(vmock_session, false);
  VASSERT_EQ (97, simpleFunction ('a', 1.0));

}
`;

const timeout = 30_000; // 30 seconds

describe("Testing pythonUtilities (valid)", () => {
  beforeEach(() => {
    // To achieve 100% coverage
    // --> Need to mock getChoiceDataFromPython, since "extraText" is not implemented yet
    vi.mock("../../server/pythonUtilities", async () => {
      const actual = await vi.importActual<
        typeof import("../../server/pythonUtilities")
      >("../../server/pythonUtilities");
      return {
        ...actual,
        getChoiceDataFromPython: vi.fn(
          (kind: string, enviroName: string, lineSoFar: string) => {
            return {
              choiceKind: "File",
              choiceList: ["unit", "Prototype-Stubs"],
              extraText: "some extra data",
              messages: [],
            };
          }
        ),
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test(
    "validate coded test completion for lines of interest (// vmock) and extra text. ",
    async () => {
      const tstText = unitTst;
      const lineToComplete = "// vmock";

      const completionPosition = getCompletionPositionForLine(
        lineToComplete,
        tstText
      );

      // Flag that we are dealing with coded tests
      const cppTestFlag = { cppNode: true, lineSoFar: lineToComplete };
      const triggerCharacter = lineToComplete.at(-1);

      const codedTestCompletionData = generateCompletionData(
        tstText,
        completionPosition,
        triggerCharacter,
        cppTestFlag
      );

      expect(codedTestCompletionData).toEqual([
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
      ]);
    },
    timeout
  );
});
