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

describe("Testing pythonUtilities (invalid)", () => {
  beforeEach(() => {
    // Spy on console.log
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {
      /* no-op */
    });
  });

  afterEach(() => {
    // Clear all mocks
    vi.clearAllMocks();
  });

  test(
    "validate that testEditorInterface.py was not found",
    async () => {
      // Mock process.argv (important for path.join)
      process.argv = [
        "node",
        "someScript.js",
        "some/invalid/path",
        "/some/command",
      ];

      // Mock existsSync since path does not exist
      existsSyncSpy = vi
        .spyOn(fs, "existsSync")
        .mockImplementation(() => false);

      // Call the function
      runPythonScript("some/invalid/path", "someAction", "somePayload");

      const invalidPathToTestEditorInterface =
        "some/invalid/path/python/testEditorInterface.py";
      const expectedMessagePart = `testEditorInterface was not found in the expected location: ${invalidPathToTestEditorInterface}`;

      expect(existsSyncSpy).toHaveBeenCalled();

      // Check if console.log was called with a message containing the expected part
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(expectedMessagePart)
      );
    },
    timeout
  );
});
