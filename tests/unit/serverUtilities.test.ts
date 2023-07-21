/* eslint-disable @typescript-eslint/no-var-requires */
import {
  getPieceAtColumn,
  getEnviroNameFromTestScript,
} from "../../server/serverUtilities";
import { describe, expect, test } from "vitest";
const timeout = 30000; // 30 seconds

const path = require("path");

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
        process.env["PACKAGE_PATH"],
        "tests",
        "unit",
        "invalid_vcast"
      );
      const tstFilepath = path.join(testEnvPath, process.env["TST_FILENAME"]);
      const generatedEnviroName = getEnviroNameFromTestScript(tstFilepath);
      expect(generatedEnviroName).toBe(undefined);
    },
    timeout
  );
});
