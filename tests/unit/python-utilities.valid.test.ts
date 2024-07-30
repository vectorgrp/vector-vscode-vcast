import path from "node:path";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import { runPythonScript } from "../../server/pythonUtilities";
import os from "os";

const timeout = 30_000; // 30 seconds

let consoleLogSpy: any;

// Mocking execSync before importing the module that uses it
vi.mock("child_process", () => {
  return {
    execSync: vi
      .fn()
      .mockImplementation(
        () => 'some stuff to be stripped\n\n  ACTUAL-DATA\n   {"some":"stuff"}'
      ),
  };
});

describe("Testing pythonUtilities (valid)", () => {
  const originalArgv = process.argv;
  beforeEach(() => {
    // Spy on console.log
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv = originalArgv;
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

      // Mock existsSync since path does not exist
      vi.spyOn(fs, "existsSync").mockImplementation(() => {
        return true;
      });

      // Call the function
      runPythonScript(os.homedir(), "someAction", "somePayload");

      const validPathToTestEditorInterface = path.join(
        "some/valid/path",
        "python",
        "testEditorInterface.py"
      );

      const expectedMessagePart = `testEditorInterface was found here: ${validPathToTestEditorInterface}`;

      // Check if console.log was called with a message containing the expected part
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(expectedMessagePart)
      );
    },
    timeout
  );
});
