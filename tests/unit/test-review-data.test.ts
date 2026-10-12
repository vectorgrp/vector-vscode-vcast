import { describe, expect, test } from "vitest";
import {
  parseTests2checkResult,
  reviewLineColors,
  reviewMarkdown,
} from "../../src/requirements/testReviewData";

// The snake_case keys mirror the JSON printed by tests2check,
// so we'll disable the strictCamelCase check here.
/* eslint-disable @typescript-eslint/naming-convention */

// One requirement's judgment as tests2check reports it.
function check(key: string, fields: Record<string, unknown> = {}) {
  return {
    key,
    title: "t",
    description: `The system shall do ${key}.`,
    verdict: "PASS",
    checked_behavior: '"This test validates that the total increases."',
    explanation: "The test runs line 11 and checks the total.",
    checked_by: ["manager.total"],
    ...fields,
  };
}

const coverageResult = {
  name: "TEST_1",
  verdict: "PASS",
  requirements: [check("FR-1")],
  expected_coverage: {
    "FR-1": [
      {
        unit: "manager",
        path: "/src/manager.c",
        lines: [10, 11],
        ran_lines: [10],
      },
    ],
  },
  actual_coverage: [{ unit: "manager", path: "/src/manager.c", lines: [10] }],
};

const LEGEND =
  "**Highlighted lines**\n\nThe code the requirements need: green where " +
  "this test ran it, red where it did not. The gutter shows, for this " +
  "test only, which lines in the file ran (green) and which did not (red).";

describe("tests2check result parsing", () => {
  test("shows the verdict and each requirement's blocks as tests2check does", () => {
    const data = parseTests2checkResult(coverageResult, "TEST_1", "manager", 5);

    expect(data.expectedLines).toEqual([10, 11]);
    expect(data.verdict).toBe("PASS");
    expect(data.requirements).toEqual([
      {
        key: "FR-1",
        description: "The system shall do FR-1.",
        verdict: "PASS",
        checkedBehavior: '"This test validates that the total increases."',
        explanation: "The test runs line 11 and checks the total.",
        checkedBy: ["manager.total"],
      },
    ]);

    expect(reviewMarkdown(data)).toBe(
      [
        "#### $(pass) Verdict: PASS",
        "##### $(pass) PASS: FR\\-1",
        "The system shall do FR\\-1.",
        '**Checked behavior**\n\n"This test validates that the total increases."',
        "**Explanation**\n\nThe test runs line 11 and checks the total.",
        "**Checked by**\n\n- `manager.total`",
        LEGEND,
      ].join("\n\n")
    );
  });

  test("shows each requirement with its own verdict", () => {
    const data = parseTests2checkResult(
      {
        ...coverageResult,
        verdict: "FAIL",
        requirements: [
          check("FR-1"),
          check("FR-2", {
            verdict: "FAIL",
            explanation:
              "The test does not run the code that implements the requirement.",
            checked_by: [],
          }),
        ],
      },
      "TEST_1",
      "manager",
      5
    );
    const markdown = reviewMarkdown(data);
    expect(markdown).toContain("#### $(error) Verdict: FAIL");
    expect(markdown).toContain("##### $(pass) PASS: FR\\-1");
    expect(markdown).toContain("##### $(error) FAIL: FR\\-2");
    expect(markdown.split("Checked by").length).toBe(2); // only FR-1's
    expect(markdown.indexOf("FR\\-1")).toBeLessThan(markdown.indexOf("FR\\-2"));
  });

  test("shows text from the test as written, not as Markdown or icons", () => {
    const data = parseTests2checkResult(
      {
        ...coverageResult,
        requirements: [
          check("FR-1", {
            checked_behavior: '"Checks *both* totals $(alert)"',
          }),
        ],
      },
      "TEST_1",
      "manager",
      5
    );
    expect(reviewMarkdown(data)).toContain(
      "Checks \\*both\\* totals \\$\\(alert\\)"
    );
  });
});

describe("review line colors", () => {
  test("marks expected lines the test ran green and the rest red", () => {
    const data = parseTests2checkResult(coverageResult, "TEST_1", "manager", 5);
    expect(reviewLineColors(data)).toEqual({ covered: [11], uncovered: [12] });
  });

  test("marks an expected line green when tests2check says it ran", () => {
    // A case label VectorCAST never marks: tests2check counts it as run when
    // the statement after it ran.
    const data = parseTests2checkResult(
      {
        ...coverageResult,
        expected_coverage: {
          "FR-1": [
            {
              unit: "manager",
              path: "/src/manager.c",
              lines: [10, 11],
              ran_lines: [10, 11],
            },
          ],
        },
      },
      "TEST_1",
      "manager",
      5
    );
    expect(reviewLineColors(data)).toEqual({
      covered: [11, 12],
      uncovered: [],
    });
  });

  test("leaves a line the test ran but the requirement does not need uncolored", () => {
    const data = parseTests2checkResult(
      {
        ...coverageResult,
        expected_coverage: {
          "FR-1": [
            {
              unit: "manager",
              path: "/src/manager.c",
              lines: [10, 12],
              ran_lines: [10],
            },
          ],
        },
        actual_coverage: [
          { unit: "manager", path: "/src/manager.c", lines: [10, 11] },
        ],
      },
      "TEST_1",
      "manager",
      5
    );
    expect(reviewLineColors(data)).toEqual({ covered: [11], uncovered: [13] });
  });

  test("marks every expected line red when the test ran none of them", () => {
    const data = parseTests2checkResult(
      {
        ...coverageResult,
        expected_coverage: {
          "FR-1": [
            {
              unit: "manager",
              path: "/src/manager.c",
              lines: [10, 11],
              ran_lines: [],
            },
          ],
        },
        actual_coverage: [],
      },
      "TEST_1",
      "manager",
      5
    );
    expect(reviewLineColors(data)).toEqual({
      covered: [],
      uncovered: [11, 12],
    });
  });
});
/* eslint-enable @typescript-eslint/naming-convention */
