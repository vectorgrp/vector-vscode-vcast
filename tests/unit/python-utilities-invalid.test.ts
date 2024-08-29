import { initializePaths } from "../../server/pythonUtilities";
import {
  describe,
  expect,
  test,
  vi,
  beforeEach,
  afterEach,
  type SpyInstance,
} from "vitest";

const timeout = 30_000; // 30 seconds

let consoleLogSpy: SpyInstance;

vi.mock("child_process", () => ({
  execSync: vi
    .fn()
    .mockImplementation(
      () => 'some stuff to be stripped\n\n  ACTUAL-DATA\n   {"some":"stuff"}'
    ),
}));

describe("Testing pythonUtilities (invalid)", () => {
  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {
      /* No-op */
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test(
    "validate that initializePaths if the path was not found",
    async () => {
      initializePaths("some/invalid/path", "someAction", true);

      const invalidPathToTestEditorInterface =
        "some/invalid/path/python/testEditorInterface.py";
      const expectedMessagePart = `testEditorInterface was not found in the expected location: ${invalidPathToTestEditorInterface}`;

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(expectedMessagePart)
      );
    },
    timeout
  );
});
