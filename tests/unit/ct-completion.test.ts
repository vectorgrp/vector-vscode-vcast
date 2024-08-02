import { describe, expect, test } from "vitest";
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
          label: "unit",
          kind: 1,
          detail: "",
          data: 0,
        },
        {
          label: "Prototype-Stubs",
          kind: 1,
          detail: "",
          data: 1,
        },
      ]);
    },
    timeout
  );

  test(
    "validate coded test completion for lines of interest (auto vmock_session =) and extra text. ",
    async () => {},
    timeout
  );

  test(
    "validate coded test completion for lines of interest and without extra text.",
    async () => {},
    timeout
  );
});
