import { describe, expect, test } from "vitest";
import { getVcastOptionValues } from "../../src-common/commonUtilities";

const path = require("node:path");

const timeout = 30_000; // 30 seconds

describe("Validating commonUtilities", () => {
  test(
    "validate VectorCAST option values",
    async () => {
      const process = require("node:process");
      const testEnvPath = path.join(
        process.env.PACKAGE_PATH,
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
});
