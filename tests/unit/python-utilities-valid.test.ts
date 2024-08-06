import fs from "node:fs";
import process from "node:process";
import {
  describe,
  expect,
  test,
  vi,
  beforeEach,
  afterEach,
  type SpyInstance,
} from "vitest";
import { runPythonScript } from "../../server/pythonUtilities";

const timeout = 30_000; // 30 seconds

let consoleLogSpy: SpyInstance;
let existsSyncSpy: SpyInstance;

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

    // Mock existsSync since path does not exist
    existsSyncSpy = vi.spyOn(fs, "existsSync").mockImplementation(() => true);
  });

  afterEach(() => {
    // Clear all mocks
    vi.clearAllMocks();
  });

  test(
    "validate that testEditorInterface.py was found",
    async () => {
      // Mock process.argv (important for path.join)
      process.argv = [
        "node",
        "someScript.js",
        "some/valid/path",
        "/some/command",
      ];

      // Call the function
      runPythonScript("some/valid/path", "someAction", "somePayload");

      const validPathToTestEditorInterface =
        "some/valid/path/python/testEditorInterface.py";
      const expectedMessagePart = `testEditorInterface was found here: ${validPathToTestEditorInterface}`;

      expect(existsSyncSpy).toHaveBeenCalled();

      // Check if console.log was called with a message containing the expected part
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(expectedMessagePart)
      );
    },
    timeout
  );
});
