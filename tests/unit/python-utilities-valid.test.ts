import process from "node:process";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import {
  updateVPythonCommand,
  getVPythonCommand,
  generateTestScriptDiagnostic,
} from "../../server/pythonUtilities";
import path from "node:path";
import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";

const timeout = 30_000; // 30 seconds

// Mock the child_process module
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

  test("should create and send a diagnostic objects for tst", () => {
    const diagnostic: Diagnostic = {
      severity: DiagnosticSeverity.Warning,
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 1000 },
      },
      message: "Test message",
      source: "VectorCAST Test Explorer",
    };

    vi.mock(".../../server/tstValidation", () => ({
      getDiagnosticObject: vi.fn().mockReturnValue(diagnostic),
    }));

    const mockSendDiagnostics = vi.fn();

    // Create a mock connection object
    const connection = {
      sendDiagnostics: mockSendDiagnostics,
    };

    generateTestScriptDiagnostic(
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
