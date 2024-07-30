import path from "node:path";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import { runPythonScript } from "../../server/pythonUtilities";

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

describe("Testing pythonUtilities (invalid)", () => {
  beforeEach(() => {
    // Spy on console.log
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
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
        "/some/invalid/path",
        "/some/command",
      ];

      // Mock existsSync since path does not exist
      vi.spyOn(fs, "existsSync").mockImplementation(() => {
        return false;
      });

      // Call the function
      runPythonScript("/some/invalid/path", "someAction", "somePayload");

      const invalidPathToTestEditorInterface = path.join(
        "/some/invalid/path",
        "python",
        "testEditorInterface.py"
      );

      const expectedMessagePart = `testEditorInterface was not found in the expected location: ${invalidPathToTestEditorInterface}`;

      // Check if console.log was called with a message containing the expected part
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(expectedMessagePart)
      );
    },
    timeout
  );
});
