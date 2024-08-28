import process from "node:process";
import * as nodeFetch from "node-fetch";
import URI from "vscode-uri";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import {
  getChoiceData,
  updateVPythonCommand,
  getVPythonCommand,
  choiceKindType,
} from "../../server/pythonUtilities";
import path from "node:path";
import { setServerState } from "../../src-common/vcastServer";
import { asCompletionParameters, getCompletionPositionForLine } from "./utils";
import { TextDocument } from "vscode-languageserver";
import { getEnviroNameFromTestScript } from "../../server/serverUtilities";
import { getCodedTestCompletionData } from "../../server/ctCompletions";

const timeout = 30_000; // 30 seconds

vi.mock("node-fetch", async () => {
  const actual = await vi.importActual<typeof nodeFetch>("node-fetch");

  return {
    ...actual,
    default: vi.fn(),
  };
});

const fetch = vi.mocked(nodeFetch.default);

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

const expectedReceivedData = [
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
];

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

  test(
    "validate getChoiceDataFromServer",
    async () => {
      const pythonUtilities = await import("../../src-common/vcastServer");

      // Spy on `transmitCommand` and mock its implementation
      vi.spyOn(pythonUtilities, "transmitCommand").mockResolvedValue({
        success: true,
        returnData: {
          data: {
            choiceKind: "File",
            choiceList: ["unit", "Prototype-Stubs"],
            extraText: "some extra data",
            messages: ["some", "messages"],
          },
        },
        statusText: "success",
      });

      setServerState(true);

      // Need dummy coded test file for function (can be empty)
      const unitTst = ``;

      const lineToComplete = "// vmock";
      const completionPosition = getCompletionPositionForLine(
        lineToComplete,
        unitTst
      );

      const envName = "vcast";

      const languageId = "cpp";

      const testEnvPath = path.join(
        process.env.PACKAGE_PATH as string,
        "tests",
        "unit",
        envName
      );
      const tstFilepath = path.join(
        testEnvPath,
        process.env.TST_FILENAME as string
      );

      const triggerCharacter = lineToComplete.at(-1);
      const uri = URI.file(tstFilepath).toString();
      const textDocument = TextDocument.create(uri, languageId, 1, unitTst);

      const completion = asCompletionParameters(
        textDocument,
        completionPosition,
        triggerCharacter
      );

      const enviroPath = getEnviroNameFromTestScript(tstFilepath);

      if (enviroPath) {
        const result = await getCodedTestCompletionData(
          undefined,
          lineToComplete,
          completion,
          enviroPath
        );
        expect(result).toEqual(expectedReceivedData);
      }
    },
    timeout
  );

  test(
    "validate getChoiceDataFromServer if it fails",
    async () => {
      // Mock fetch to simulate a failure and throw an error
      fetch.mockImplementationOnce(() =>
        Promise.reject(new Error("Failed to fetch: reason: Server down"))
      );

      // Set server state to true
      setServerState(true);

      const lineToComplete = "// vmock";
      const envName = "vcast";

      const testEnvPath = path.join(
        process.env.PACKAGE_PATH as string,
        "tests",
        "unit",
        envName
      );
      const tstFilepath = path.join(
        testEnvPath,
        process.env.TST_FILENAME as string
      );

      const enviroPath = getEnviroNameFromTestScript(tstFilepath);
      let result: any;
      if (enviroPath) {
        result = await getChoiceData(
          choiceKindType.choiceListCT,
          enviroPath,
          lineToComplete
        );
      }

      expect(result).toStrictEqual({
        choiceKind: "",
        choiceList: [],
        extraText: "",
        messages: [],
      });
    },
    timeout
  );
});
