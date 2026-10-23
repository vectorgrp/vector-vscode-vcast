import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

// The per-test coverage the requirements review reads: which tests ran a
// line, how far each covers it, and ("*") how far the reviewed tests cover
// it together. Runs in its own copy of the unit environment (Statement+Branch),
// since vitest runs files in parallel and the shared TEST environment must
// stay as the other tests expect it, with two tests of unit.cpp's bar() that
// take the two directions of its second branch.

const packagePath = process.env.PACKAGE_PATH ?? process.cwd();
const sharedEnvDir = path.join(packagePath, "tests", "unit", "vcast");
const envDir = path.join(sharedEnvDir, "per_test_coverage");
const enviroPath = path.join(envDir, "PERTEST");
const clicast = execSync(
  process.platform === "win32" ? "where clicast" : "which clicast"
)
  .toString()
  .trim();
const vectorcastDir = path.dirname(clicast);
const vpython = path.join(vectorcastDir, "vpython");
const interfaceScript = path.join(packagePath, "python", "vTestInterface.py");

const TRUE_BRANCH = "unit.bar.BAR_TRUE";
const FALSE_BRANCH = "unit.bar.BAR_FALSE";

// {"<unit.cpp path>": {"<line>": {"<unit.function.test>": status, "*"?: status}}}
function perTestCoverage(
  combinedTests?: string[]
): Record<string, Record<string, Record<string, string>>> {
  const args = [
    interfaceScript,
    "--mode=perTestCoverage",
    `--clicast=${clicast}`,
    `--path=${enviroPath}`,
  ];
  if (combinedTests) {
    args.push(`--options=${JSON.stringify({ tests: combinedTests })}`);
  }
  const output = execFileSync(vpython, args, {
    env: { ...process.env, VECTORCAST_DIR: vectorcastDir },
  }).toString();
  // vpython prefixes the JSON with "ACTUAL-DATA" and banner lines.
  return JSON.parse(output.slice(output.indexOf("{")));
}

function linesOfUnit(
  coverage: Record<string, Record<string, Record<string, string>>>
) {
  const file = Object.keys(coverage).find((p) => p.endsWith("unit.cpp"));
  expect(file).toBeDefined();
  return coverage[file!];
}

beforeAll(() => {
  rmSync(envDir, { recursive: true, force: true });
  mkdirSync(envDir);
  cpSync(path.join(sharedEnvDir, "unit.cpp"), path.join(envDir, "unit.cpp"));
  writeFileSync(
    path.join(envDir, "PERTEST.env"),
    readFileSync(path.join(sharedEnvDir, "TEST.env"), "utf8").replace(
      "ENVIRO.NAME: TEST",
      "ENVIRO.NAME: PERTEST"
    )
  );
  // z=1 makes x+y > z true, z=10 makes it false: one direction each.
  writeFileSync(
    path.join(envDir, "tests.tst"),
    [
      "TEST.UNIT:unit",
      "TEST.SUBPROGRAM:bar",
      "TEST.NEW",
      "TEST.NAME:BAR_TRUE",
      "TEST.VALUE:unit.bar.z:1",
      "TEST.END",
      "TEST.NEW",
      "TEST.NAME:BAR_FALSE",
      "TEST.VALUE:unit.bar.z:10",
      "TEST.END",
      "",
    ].join("\n")
  );
  const run = (command: string) =>
    execSync(`${clicast} -lc ${command}`, { cwd: envDir, stdio: "pipe" });
  run("template GNU_CPP11_X");
  run("environment script run PERTEST.env");
  run("-e PERTEST test script run tests.tst");
  run("-e PERTEST execute batch");
}, 180_000);

afterAll(() => {
  rmSync(envDir, { recursive: true, force: true });
});

describe("per-test coverage for the requirements review", () => {
  test("names, per line, the tests that ran it and how far each covers it", () => {
    const lines = linesOfUnit(perTestCoverage());
    // if (x + y > z): each test takes one direction only.
    expect(lines["22"][TRUE_BRANCH]).toBe("partiallyCovered");
    expect(lines["22"][FALSE_BRANCH]).toBe("partiallyCovered");
    // return external_add(x, y): only the true-direction test ran it.
    expect(lines["23"][TRUE_BRANCH]).toBe("covered");
    expect(lines["23"]).not.toHaveProperty(FALSE_BRANCH);
    // log_result(z): only the false-direction test ran it.
    expect(lines["25"][FALSE_BRANCH]).toBe("covered");
    expect(lines["25"]).not.toHaveProperty(TRUE_BRANCH);
    // Without reviewed tests there is no combined status.
    for (const statuses of Object.values(lines)) {
      expect(statuses).not.toHaveProperty("*");
    }
  }, 60_000);

  test("classifies the reviewed tests together, not as a merge of their own statuses", () => {
    const lines = linesOfUnit(perTestCoverage([TRUE_BRANCH, FALSE_BRANCH]));
    // Both directions between them: the branch is covered by the two.
    expect(lines["22"]["*"]).toBe("covered");
    // if (x > loc.x) is false for both: still only one direction.
    expect(lines["19"]["*"]).toBe("partiallyCovered");
    // A line only one of them ran is covered by the two as well.
    expect(lines["23"]["*"]).toBe("covered");
    expect(lines["25"]["*"]).toBe("covered");
  }, 60_000);

  test("gives one reviewed test only its own coverage", () => {
    const lines = linesOfUnit(perTestCoverage([TRUE_BRANCH]));
    expect(lines["22"]["*"]).toBe("partiallyCovered");
    expect(lines["23"]["*"]).toBe("covered");
    // The other test's line has no combined status.
    expect(lines["25"]).not.toHaveProperty("*");
  }, 60_000);
});
