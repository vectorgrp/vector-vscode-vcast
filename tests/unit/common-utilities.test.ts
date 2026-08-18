import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { describe, expect, test } from "vitest";
import {
  atgAndClicastSplitString,
  cleanVectorcastOutput,
  extractJson,
  getEnviroNameFromScript,
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
  test(
    "validate extractJson",
    async () => {
      // Clean run: stdout is exactly the JSON verdict (fast path)
      expect(extractJson('  {"usable": true, "problem": null}\n')).toEqual({
        usable: true,
        problem: null,
      });

      // Verdict surrounded by progress/log lines on stdout
      expect(
        extractJson(
          "llm2check: checking provider azure_openai...\n" +
            '{"usable": true, "problem": null}\n' +
            "llm2check: done\n"
        )
      ).toEqual({ usable: true, problem: null });

      // A model asked for a list returns a JSON array wrapped in chatter
      expect(
        extractJson(
          'Here are the requirements:\n[{"id": "REQ-1"}, {"id": "REQ-2"}]\nLet me know!'
        )
      ).toEqual([{ id: "REQ-1" }, { id: "REQ-2" }]);

      // Both '[' and '{' present: the earliest start wins
      expect(
        extractJson('[{"id": "REQ-1"}] and also {"usable": true}')
      ).toEqual([{ id: "REQ-1" }]);
      expect(extractJson('{"ids": ["REQ-1"]} and also ["REQ-2"]')).toEqual({
        ids: ["REQ-1"],
      });

      // Failure verdict where "problem" embeds the provider's own JSON error
      // (braces inside the string must not confuse the depth tracking, and the
      // escaped quotes must not toggle the in-string state)
      expect(
        extractJson(
          "llm2check: contacting https://api.openai.com/v1 ...\n" +
            '{"usable": false, "problem": "API error 401: ' +
            '{\\"error\\": {\\"message\\": \\"Incorrect API key provided\\", \\"code\\": \\"invalid_api_key\\"}}"}\n'
        )
      ).toEqual({
        usable: false,
        problem:
          'API error 401: {"error": {"message": "Incorrect API key provided", "code": "invalid_api_key"}}',
      });

      // Tool crashed before printing any JSON -> undefined
      expect(
        extractJson("llm2check: failed to spawn process: ENOENT")
      ).toBeUndefined();

      // Output truncated mid-JSON (process killed) -> never closes -> undefined
      expect(
        extractJson('{"usable": false, "problem": "the model timed ')
      ).toBeUndefined();

      // Balanced braces but not valid JSON (e.g. a usage string) -> undefined
      expect(
        extractJson("usage: llm2check {--json | --text} [options]")
      ).toBeUndefined();
    },
    timeout
  );
  test(
    "validate getEnviroNameFromScript",
    async () => {
      // A test script whose Environment comment line names the environment
      const scriptPath = path.join(
        process.env.PACKAGE_PATH as string,
        "tests",
        "unit",
        "vcast",
        "firstTest.tst"
      );
      expect(getEnviroNameFromScript(scriptPath)).toBe("TEST");

      // A missing file returns undefined
      expect(getEnviroNameFromScript("/nonexistent/path.tst")).toBeUndefined();

      // A file WITHOUT an Environment comment line returns undefined
      const noEnviroLinePath = path.join(os.tmpdir(), "no-enviro-line.tst");
      fs.writeFileSync(noEnviroLinePath, "TEST.UNIT: manager\nTEST.END\n");
      expect(getEnviroNameFromScript(noEnviroLinePath)).toBeUndefined();
      fs.unlinkSync(noEnviroLinePath);
    },
    timeout
  );
});
