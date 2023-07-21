/* eslint-disable @typescript-eslint/no-var-requires */
import { getVcastOptionValues } from "../../src-common/commonUtilities";
import { describe, expect, test } from "vitest";
const path = require("path");
const timeout = 30000; // 30 seconds

describe("Validating commonUtilities", () => {
  test(
    "validate VectorCAST option values",
    async () => {
      const testEnvPath = path.join(
        process.env["PACKAGE_PATH"],
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

      // calling again to get the cached value
      const cachedCfgOptions = getVcastOptionValues(testEnvPath);
      expect(cachedCfgOptions.C_DEBUG_CMD).toBe("gdb");
      expect(cachedCfgOptions.SOURCE_EXTENSION).toBe(".cpp");
    },
    timeout
  );
});
