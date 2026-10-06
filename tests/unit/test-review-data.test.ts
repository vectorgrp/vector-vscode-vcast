import { describe, expect, test } from "vitest";
import {
  createRequirementInfoBox,
  parseTests2checkResult,
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
  verdict: "Partially",
  confidence: "medium",
  basis: "test-description",
  argument: "Line 11 is expected but never reached.",
  caveats: ["Over-coverage"],
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
      verdict: "Partially",
      confidence: "medium",
      argument: "Line 11 is expected but never reached.",
      caveats: ["Over-coverage"],
    });

    const box = createRequirementInfoBox(data);
    expect(box).toContain("AI JUSTIFICATION: Partially (confidence: medium)");
    expect(box).toContain("Line 11 is expected but never reached.");
    expect(box).toContain("- caveat: Over-coverage");
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
/* eslint-enable @typescript-eslint/naming-convention */
