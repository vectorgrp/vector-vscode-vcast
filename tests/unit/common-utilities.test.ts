import path from "node:path";
import process from "node:process";
import { describe, expect, test } from "vitest";
import {
  cleanVcastOutput,
  getVcastOptionValues,
} from "../../src-common/commonUtilities";

const timeout = 30_000; // 30 seconds

describe("Validating commonUtilities", () => {
  test(
    "validate VectorCAST option values",
    async () => {
      const testEnvPath = path.join(
        process.env.PACKAGE_PATH as string,
        "tests",
        "unit",
        "vcast",
        "TEST"
      );
      const cfgOptions = getVcastOptionValues(testEnvPath);
      console.log(`Debug command is ${cfgOptions.C_DEBUG_CMD}`);
      console.log(`Source extension is ${cfgOptions.SOURCE_EXTENSION}`);
      expect(cfgOptions.C_DEBUG_CMD).toBe("gdb");
      expect(cfgOptions.SOURCE_EXTENSION).toBe(".cpp");

      // Calling again to get the cached value
      const cachedCfgOptions = getVcastOptionValues(testEnvPath);
      expect(cachedCfgOptions.C_DEBUG_CMD).toBe("gdb");
      expect(cachedCfgOptions.SOURCE_EXTENSION).toBe(".cpp");
    },
    timeout
  );
  test(
    "validate cleanVcastOutput",
    async () => {
      let testString =
        "some stuff to be stripped\n\n  ACTUAL-DATA\n   some more stuff ";
      expect(cleanVcastOutput(testString)).toBe("some more stuff");

      testString = "don't strip me some more stuff";
      expect(cleanVcastOutput(testString)).toBe(testString);
    },
    timeout
  );
});
