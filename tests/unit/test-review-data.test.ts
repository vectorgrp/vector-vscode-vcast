import { describe, expect, test } from "vitest";
import {
  findTestLine,
  lastToolError,
  parseTests2checkResult,
  requirementFailures,
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
  actual_coverage: [{ path: "/src/manager.c", lines: [10] }],
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
        "#### ✅ Verdict: PASS",
        "##### ✅ PASS: FR\\-1",
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
    expect(markdown).toContain("#### ❌ Verdict: FAIL");
    expect(markdown).toContain("##### ✅ PASS: FR\\-1");
    expect(markdown).toContain("##### ❌ FAIL: FR\\-2");
    expect(markdown.split("Checked by").length).toBe(2); // Only FR-1's
    expect(markdown.indexOf("FR\\-1")).toBeLessThan(markdown.indexOf("FR\\-2"));
  });

  test("tolerates fields tests2check leaves out", () => {
    // An older tests2check without ran_lines, and a requirement with
    // only a verdict: the review still shows what there is.
    const data = parseTests2checkResult(
      {
        name: "TEST_1",
        verdict: "FAIL",
        requirements: [{ key: "FR-1", verdict: "FAIL" }],
        expected_coverage: {
          "FR-1": [
            { unit: "manager", path: "/src/manager.c", lines: [10, 11] },
          ],
        },
      },
      "TEST_1",
      "manager",
      5
    );
    expect(data.expectedLines).toEqual([10, 11]);
    expect(data.ranLines).toEqual([]);
    const markdown = reviewMarkdown(data);
    expect(markdown).toContain("##### ❌ FAIL: FR\\-1");
    expect(markdown).not.toContain("Checked by");
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
describe("findTestLine", () => {
  const script = [
    "-- Test Case Script",
    "TEST.UNIT:manager",
    "TEST.SUBPROGRAM:Place_Order",
    "TEST.NEW",
    "TEST.NAME:SAME",
    "TEST.END",
    "TEST.SUBPROGRAM:Clear_Table",
    "TEST.NEW",
    "TEST.NAME:SAME",
    "TEST.END",
    "TEST.NEW",
    "TEST.NAME:SAME_LONGER",
    "TEST.END",
  ].join("\n");

  test("finds the test under its own subprogram", () => {
    expect(findTestLine(script, "manager", "Clear_Table", "SAME")).toBe(8);
  });

  test("takes only the whole name", () => {
    expect(findTestLine(script, "manager", "Clear_Table", "SAME_LONGER")).toBe(
      11
    );
  });

  test("falls back to the first test with the name, then the top", () => {
    expect(findTestLine(script, "manager", "Other", "SAME")).toBe(4);
    expect(findTestLine(script, "manager", "Clear_Table", "NONE")).toBe(0);
  });
});

describe("requirementFailures", () => {
  test("lists each failing requirement of each test", () => {
    const results = [
      {
        name: "T1",
        unit: "manager",
        subprogram: "Place_Order",
        requirements: [
          check("FR-1"),
          check("FR-2", { verdict: "FAIL", explanation: "Not run." }),
        ],
      },
      { name: "T2", unit: "manager", subprogram: "f", requirements: [] },
    ];
    expect(requirementFailures(results)).toEqual([
      {
        unit: "manager",
        subprogram: "Place_Order",
        name: "T1",
        key: "FR-2",
        explanation: "Not run.",
      },
    ]);
  });
});
describe("lastToolError", () => {
  const message =
    "None of the selected tests is linked to a requirement. Tests are linked with TEST.REQUIREMENT_KEY.";

  test("joins the error's wrapped lines", () => {
    expect(
      lastToolError(
        "ERROR: None of the selected tests is linked to a requirement. Tests are linked  \nwith TEST.REQUIREMENT_KEY.\n"
      )
    ).toBe(message);
  });

  test("takes only the last error of a debug log", () => {
    expect(
      lastToolError(
        [
          "2026-10-20T17:48:53.16 [DEBUG]: Using VectorCAST vpython",
          "        taskName: Task-1",
          "2026-10-20T17:48:53.38 [ERROR]: None of the selected tests is linked to a",
          "requirement. Tests are linked with TEST.REQUIREMENT_KEY.",
          "        taskName: None",
          "",
        ].join("\n")
      )
    ).toBe(message);
  });

  test("is the whole output when nothing was logged as an error", () => {
    expect(lastToolError("Traceback ...\n")).toBe("Traceback ...");
  });
});
/* eslint-enable @typescript-eslint/naming-convention */
