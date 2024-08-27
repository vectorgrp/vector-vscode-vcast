import process from "node:process";
import { choiceKindType } from "../../server/pythonUtilities";
import {
  describe,
  expect,
  test,
  vi,
  beforeEach,
  afterEach,
  type SpyInstance,
} from "vitest";
import {
  getChoiceData,
  updateVPythonCommand,
  getVPythonCommand,
} from "../../server/pythonUtilities";
import path from "node:path";

const timeout = 30_000; // 30 seconds

let consoleLogSpy: SpyInstance;

// Mocking execSync before importing the module that uses it
vi.mock("child_process", () => ({
  execSync: vi
    .fn()
    .mockImplementation(
      () => 'some stuff to be stripped\n\n  ACTUAL-DATA\n   {"some":"stuff"}'
    ),
}));

describe("Testing pythonUtilities (valid)", () => {
  beforeEach(() => {
    // Spy on console.log
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {
      /* No-op */
    });

    updateVPythonCommand(path.join(`${process.env.VECTORCAST_DIR}`, "vpython"));
  });

  afterEach(() => {
    // Clear all mocks
    vi.clearAllMocks();
  });

  test(
    "validate that testEditorInterface.py was found",

    async () => {
      const validPathToTestEditorInterface = path.join(
        __dirname,
        "..",
        "..",
        "python",
        "testEditorInterface.py"
      );

      // Call the function
      getChoiceData(choiceKindType.choiceListTST, "someAction", "somePayload");

      const expectedMessagePart = `testEditorInterface was found here: ${validPathToTestEditorInterface}`;

      // Check if console.log was called with a message containing the expected part
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(expectedMessagePart)
      );
    },
    timeout
  );

  test(
    "validate updateVPythonCommand",
    async () => {
      const newPath = "some/other/path/to/change";
      updateVPythonCommand(newPath);
      expect(getVPythonCommand()).toBe(newPath);
    },
    timeout
  );
});
