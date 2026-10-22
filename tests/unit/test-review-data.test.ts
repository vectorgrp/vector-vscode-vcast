import { describe, expect, test } from "vitest";
import {
  countVerdicts,
  groupMarkdown,
  lastToolError,
  lineHoverMarkdown,
  parseTests2checkResult,
  ranLinesFromCoverage,
  reviewLineColors,
  reviewMarkdown,
} from "../../src/requirements/testReviewData";
import { checkReportHtml } from "../../src/requirements/testReviewReport";

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

describe("an Ada unit", () => {
  test("takes the required lines whatever the case of the unit's name", () => {
    const data = parseTests2checkResult(
      {
        ...coverageResult,
        expected_coverage: {
          "FR-1": [{ unit: "manager", path: "/src/manager.adb", lines: [10] }],
        },
      },
      "PLACE_ORDER.001",
      "MANAGER",
      18
    );
    expect(data.expectedLines).toEqual([10]);
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
describe("a review of several tests", () => {
  const steak = parseTests2checkResult(
    { ...coverageResult, name: "STEAK" },
    "STEAK",
    "manager",
    5
  );
  const chicken = parseTests2checkResult(
    {
      ...coverageResult,
      name: "CHICKEN",
      verdict: "FAIL",
      requirements: [check("FR-1", { verdict: "FAIL", checked_by: [] })],
      expected_coverage: {
        "FR-1": [
          {
            unit: "manager",
            path: "/src/manager.c",
            lines: [10, 11, 12],
            ran_lines: [11],
          },
        ],
      },
    },
    "CHICKEN",
    "manager",
    5
  );
  const tests = [
    { testId: "vcast:/env|manager.Place_Order.STEAK", data: steak },
    { data: chicken },
  ];

  test("colors a line green when any of the tests ran it", () => {
    expect(reviewLineColors([steak, chicken])).toEqual({
      covered: [11, 12],
      uncovered: [13],
    });
  });

  test("tabulates the tests and their requirements in the comment", () => {
    const markdown = groupMarkdown("manager.Place_Order", tests);
    expect(markdown).toContain("#### ❌ manager.Place\\_Order");
    expect(markdown).toContain("1 passed, 1 failed");
    expect(markdown).toContain('<table width="100%">');
    expect(markdown).toContain('width="56%"');
    expect(markdown).toContain(
      '<td style="color:var(--vscode-testing-iconPassed);"><b>✅ PASS</b></td><td>STEAK</td><td>✅ FR-1</td>'
    );
    expect(markdown).toContain(
      '<td style="color:var(--vscode-testing-iconFailed);"><b>❌ FAIL</b></td><td>CHICKEN</td><td>❌ FR-1</td>'
    );
    expect(markdown).toContain("**Hover** a line");
  });

  test("says on hover which tests ran a line, linking the known ones", () => {
    const hover = lineHoverMarkdown(
      [
        { title: "STEAK", status: "covered", testId: tests[0].testId },
        { title: "CHICKEN", status: "partiallyCovered" },
      ],
      "ext.focus"
    );
    expect(hover).toContain("**Ran by** [STEAK](command:ext.focus?");
    expect(hover).toContain(
      encodeURIComponent(JSON.stringify([tests[0].testId]))
    );
    expect(hover).toContain(", CHICKEN (partially)");
    expect(hover).not.toContain("Needed");
  });

  test("has no hover for a line no reviewed test ran", () => {
    expect(lineHoverMarkdown([], "ext.focus")).toBeUndefined();
  });
});

describe("recoloring the requirements' lines from a new run", () => {
  // 1-based gutter data: lines 11 and 13 can be marked, the test ran 11.
  const coverable = new Set([11, 13, 15]);
  const ran = new Set([11]);

  test("reads whether the test ran each required line", () => {
    expect(ranLinesFromCoverage([10, 12], ran, coverable)).toEqual([10]);
  });

  test("counts an unmarkable line as run when the next markable line ran", () => {
    // Line 12 (a case label) is never marked; its statement is on line 13.
    expect(ranLinesFromCoverage([11], new Set([13]), coverable)).toEqual([11]);
    expect(ranLinesFromCoverage([11], new Set([11]), coverable)).toEqual([]);
  });

  test("never counts a line after the last markable one", () => {
    expect(ranLinesFromCoverage([20], ran, coverable)).toEqual([]);
  });
});

describe("the batch check report", () => {
  const passed = parseTests2checkResult(coverageResult, "TEST_1", "manager", 5);
  const failed = parseTests2checkResult(
    {
      ...coverageResult,
      name: "TEST_2 <b>",
      verdict: "FAIL",
      requirements: [
        check("FR-2", {
          verdict: "FAIL",
          explanation: "No assertion checks the outcome & the total.",
          checked_by: [],
        }),
      ],
    },
    "TEST_2",
    "manager",
    5
  );
  const html = checkReportHtml({
    scope: "manager",
    groups: [
      {
        unitName: "manager",
        functionName: "Place_Order",
        tests: [
          { testId: "vcast:/env|manager.Place_Order.TEST_1", data: passed },
          { data: failed },
        ],
      },
      {
        unitName: "manager",
        functionName: "Clear_Table",
        tests: [
          { testId: "vcast:/env|manager.Clear_Table.TEST_1", data: passed },
        ],
      },
    ],
    nonce: "n0nce",
    cspSource: "vscode-resource:",
  });

  test("counts the verdicts", () => {
    expect(countVerdicts(["PASS", "FAIL", "PASS"])).toBe("2 passed, 1 failed");
    expect(countVerdicts(["PASS", ""])).toBe("1 passed, 0 failed, 1 undecided");
  });

  const counts = (passed: number, failed: number) =>
    `<span class="passed">${passed} passed</span>, <span class="failed">${failed} failed</span>`;

  test("nests collapsed functions under collapsed units, each with colored counts", () => {
    expect(html).toContain("Requirements check: manager");
    expect(html).toContain(counts(2, 1));
    const unit = html.indexOf('<details class="unit">');
    const placeOrder = html.indexOf("Place_Order");
    const clearTable = html.indexOf("Clear_Table");
    expect(unit).toBeGreaterThan(-1);
    expect(placeOrder).toBeGreaterThan(unit);
    expect(clearTable).toBeGreaterThan(placeOrder);
    expect(html.slice(unit, placeOrder)).toContain("manager");
    expect(html.slice(unit, placeOrder)).toContain(counts(2, 1));
    expect(html.slice(placeOrder, clearTable)).toContain(counts(1, 1));
    expect(html.slice(placeOrder, clearTable)).toContain("TEST_2");
    expect(html.slice(clearTable)).toContain(counts(1, 0));
    expect(html.match(/<details class="function">/g)).toHaveLength(2);
    expect(html).not.toContain(" open>");
  });

  test("shows each requirement's blocks", () => {
    expect(html).toContain("FR-2");
    expect(html).toContain("No assertion checks the outcome &amp; the total.");
  });

  test("opens the review only for tests found in the test tree", () => {
    expect(html).toContain(
      'data-test-id="vcast:/env|manager.Place_Order.TEST_1"'
    );
    expect(html.match(/class="open"/g)).toHaveLength(2);
  });

  test("reviews a unit or a function as a whole", () => {
    expect(html).toContain(
      'class="open group" data-unit="manager">Review unit'
    );
    expect(html).toContain(
      'class="open group" data-unit="manager" data-function="Place_Order">Review function'
    );
    expect(html).toContain("open-group-review");
  });

  test("escapes text from the test", () => {
    expect(html).toContain("TEST_2 &lt;b&gt;");
    expect(html).not.toContain("<b>");
  });

  test("only runs its own script", () => {
    expect(html).toContain("script-src 'nonce-n0nce'");
    expect(html).toContain('<script nonce="n0nce">');
  });
});
/* eslint-enable @typescript-eslint/naming-convention */
