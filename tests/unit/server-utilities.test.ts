import path from "node:path";
import process from "node:process";
import { describe, expect, test } from "vitest";
import { CompletionItemKind } from "vscode-languageserver";
import {
  convertKind,
  getPieceAtColumn,
  getEnviroNameFromTestScript,
} from "../../server/serverUtilities";

const timeout = 30_000; // 30 seconds

describe("Validating serverUtilities on edgecases not validated by tstCompletion, tstHover and tstValidation tests", () => {
  test(
    "validate response for invalid column input",
    async () => {
      const piece = getPieceAtColumn(["unit", "global"], 666);
      expect(piece).toStrictEqual({ text: "", index: 0 });
    },
    timeout
  );

  test(
    "validate response for invalid environment name",
    async () => {
      const testEnvPath = path.join(
        process.env.PACKAGE_PATH as string,
        "tests",
        "unit",
        "invalid_vcast"
      );
      const tstFilepath = path.join(
        testEnvPath,
        process.env.TST_FILENAME as string
      );
      const generatedEnviroName = getEnviroNameFromTestScript(tstFilepath);
      expect(generatedEnviroName).toBe(undefined);
    },
    timeout
  );

  test(
    "validate response converting a 'Value' kind",
    async () => {
      const kindFromPython = "Value";
      const completionItemKind: CompletionItemKind =
        convertKind(kindFromPython);
      expect(completionItemKind).toBe(CompletionItemKind.Value);
    },
    timeout
  );
});
