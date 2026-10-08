import { describe, expect, test } from "vitest";
import {
  createRequirementInfoBox,
  parseTests2checkResult,
  reviewLineColors,
} from "../../src/requirements/testReviewData";

// The snake_case keys mirror the JSON printed by tests2check,
// so we'll disable the strictCamelCase check here.
/* eslint-disable @typescript-eslint/naming-convention */

const coverageResult = {
  name: "TEST_1",
  expected_coverage: {
    "FR-1": [{ unit: "manager", path: "/src/manager.c", lines: [10, 11] }],
  },
  actual_coverage: [{ unit: "manager", path: "/src/manager.c", lines: [10] }],
};

const argument = {
  verdict: "Exercises",
  basis: "test-description",
  argument: "The test runs line 11 and checks the total.",
  checking_assertions: ["manager.total"],
  caveats: ["Judged against the full linked requirement"],
};

describe("tests2check result parsing", () => {
  test("shows the justification when tests2check produced one", () => {
    const data = parseTests2checkResult(
      { ...coverageResult, argument },
      "TEST_1",
      "manager",
      "This test validates that ...",
      5
    );

    expect(data.expectedLines).toEqual([10, 11]);
    expect(data.actualLines).toEqual([10]);
    expect(data.justification).toEqual({
      verdict: "Exercises",
      argument: "The test runs line 11 and checks the total.",
      checkingAssertions: ["manager.total"],
      caveats: ["Judged against the full linked requirement"],
    });

    const box = createRequirementInfoBox(data);
    expect(box).toContain("AI JUSTIFICATION: Exercises");
    expect(box).toContain("The test runs line 11 and checks the total.");
    expect(box).toContain("- checked by: manager.total");
    expect(box).toContain("- caveat: Judged against the full linked");
  });

  test("shows only the description without a justification", () => {
    const data = parseTests2checkResult(
      coverageResult,
      "TEST_1",
      "manager",
      "This test validates that ...",
      5
    );

    expect(data.justification).toBeUndefined();
    expect(createRequirementInfoBox(data)).not.toContain("AI JUSTIFICATION");
  });
});

describe("review line colors", () => {
  test("marks expected lines the test ran green and the rest red", () => {
    const data = parseTests2checkResult(
      coverageResult,
      "TEST_1",
      "manager",
      "",
      5
    );
    expect(reviewLineColors(data)).toEqual({ covered: [11], uncovered: [12] });
  });

  test("marks every expected line red when the test ran none of them", () => {
    const data = parseTests2checkResult(
      { ...coverageResult, actual_coverage: [] },
      "TEST_1",
      "manager",
      "",
      5
    );
    expect(reviewLineColors(data)).toEqual({
      covered: [],
      uncovered: [11, 12],
    });
  });
});
/* eslint-enable @typescript-eslint/naming-convention */
