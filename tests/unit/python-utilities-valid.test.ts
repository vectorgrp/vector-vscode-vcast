import process from "node:process";
import path from "node:path";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { type Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import {
  updateVPythonCommand,
  getVPythonCommand,
  generateDiagnositicForTest,
} from "../../server/pythonUtilities";
import { setupDiagnosticTest } from "./utils";

const timeout = 30_000; // 30 seconds

// Need to import it that wait because we only want to mock the types and
// functions in the return --> everything else should be imported normally
/* eslint-disable @typescript-eslint/consistent-type-imports */
vi.mock("child_process", async () => {
  // Import the actual module so that other funcitons are not mocked
  const actual =
    await vi.importActual<typeof import("child_process")>("child_process");

  return {
    ...actual,
    execSync: vi
      .fn()
      .mockImplementation(
        () => 'some stuff to be stripped\n\n  ACTUAL-DATA\n   {"some":"stuff"}'
      ),
  };
});
/* eslint-enable @typescript-eslint/consistent-type-imports */

describe("Testing pythonUtilities (valid)", () => {
  beforeEach(() => {
    updateVPythonCommand(path.join(`${process.env.VECTORCAST_DIR}`, "vpython"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test(
    "validate updateVPythonCommand",
    async () => {
      const newPath = "some/other/path/to/change";
      updateVPythonCommand(newPath);
      expect(getVPythonCommand()).toBe(newPath);
    },
    timeout
  );

  test("should create and send a diagnostic object for tst", () => {
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
    generateDiagnositicForTest(
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
