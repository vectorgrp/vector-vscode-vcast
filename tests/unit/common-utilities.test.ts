import path from "node:path";
import process from "node:process";
import { describe, expect, test } from "vitest";
import {
  atgAndClicastSplitString,
  cleanVectorcastOutput,
  getVcastOptionValues,
  vpythonSplitString,
} from "../../src-common/commonUtilities";

const timeout = 30_000; // 30 seconds
const textOfInterest = "Text of Interest";

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
    "validate cleanVectorcastOutput",
    async () => {
      // This function is called with two flavors of split strings
      // The first is used to split the output of the vpython command
      let testString = `some stuff to be stripped\n\n  ${vpythonSplitString}\n${textOfInterest}`;
      expect(cleanVectorcastOutput(testString)).toBe(textOfInterest);

      // The second is used to split the output of the atg and clicast commands
      // Note that it removes the text before the split string, and 2 lines after ...
      testString = `Some text before ${atgAndClicastSplitString}\nignore\nignore\n${textOfInterest}`;
      const expectedReturn = "Text of Interest";
      expect(cleanVectorcastOutput(testString)).toBe(expectedReturn);

      // This test is for the case where there is no clean needed
      testString = "don't strip me some more stuff";
      expect(cleanVectorcastOutput(testString)).toBe(testString);
    },
    timeout
  );

});
