import { describe, expect, test } from "vitest";
import {
  parseTests2checkResult,
  reviewLineColors,
  reviewMarkdown,
} from "../../src/requirements/testReviewData";

// The snake_case keys mirror the JSON printed by tests2check,
// so we'll disable the strictCamelCase check here.
/* eslint-disable @typescript-eslint/naming-convention */

const argument = {
  verdict: "PASS",
  reason: null,
  basis: "test-description",
  argument: "The test runs line 11 and checks the total.",
  checking_assertions: ["manager.total"],
  caveats: ["Judged against the full linked requirement"],
};

const coverageResult = {
  name: "TEST_1",
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
  ...argument,
};

describe("tests2check result parsing", () => {
  test("shows the verdict, argument, checking assertions and caveats", () => {
    const data = parseTests2checkResult(
      coverageResult,
      "TEST_1",
      "manager",
      "This test validates that ...",
      5
    );

    expect(data.expectedLines).toEqual([10, 11]);
    expect(data.actualLines).toEqual([10]);
    expect(data.justification).toEqual({
      verdict: "PASS",
      reason: null,
      argument: "The test runs line 11 and checks the total.",
      checkingAssertions: ["manager.total"],
      caveats: ["Judged against the full linked requirement"],
    });

    const markdown = reviewMarkdown(data);
    expect(markdown).toContain("$(pass) Verdict: PASS");
    expect(markdown).toContain("The test runs line 11 and checks the total.");
    expect(markdown).toContain("- `manager.total`");
    expect(markdown).toContain("- Judged against the full linked requirement");
  });

  test("shows a FAIL with its reason", () => {
    const reason =
      "The test does not run the code that implements the requirement.";
    const data = parseTests2checkResult(
      {
        ...coverageResult,
        verdict: "FAIL",
        reason,
        argument: "",
        checking_assertions: [],
      },
      "TEST_1",
      "manager",
      "This test validates that ...",
      5
    );
    const markdown = reviewMarkdown(data);
    expect(markdown).toContain("$(error) Verdict: FAIL");
    expect(markdown).toContain(`**${reason}**`);
    expect(markdown).not.toContain("Checked by");
  });

  test("shows text from the test as written, not as Markdown or icons", () => {
    const data = parseTests2checkResult(
      coverageResult,
      "TEST_1",
      "manager",
      "Checks *both* totals $(alert)",
      5
    );
    expect(reviewMarkdown(data)).toContain(
      "Checks \\*both\\* totals \\$\\(alert\\)"
    );
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
      "",
      5
    );
    expect(reviewLineColors(data)).toEqual({
      covered: [11, 12],
      uncovered: [],
    });
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
