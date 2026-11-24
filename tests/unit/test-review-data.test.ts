import { describe, expect, test } from "vitest";
import {
  countVerdicts,
  groupMarkdown,
  lastToolError,
  lineHoverMarkdown,
  localDay,
  parseReviewFlags,
  parseTests2checkResult,
  ranLinesFromCoverage,
  requirementsText,
  resultIdentity,
  reviewFlagKey,
  reviewLineColors,
  reviewMarkdown,
  staleReviewMarks,
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

  test("tolerates a result with no name, verdict, coverage or requirement fields", () => {
    const data = parseTests2checkResult(
      { requirements: [{}] },
      "TEST_1",
      "manager",
      5
    );
    expect(data.title).toBe("TEST_1");
    expect(data.verdict).toBe("");
    expect(data.expectedLines).toEqual([]);
    expect(data.requirements).toEqual([
      {
        key: "",
        description: "",
        verdict: "",
        checkedBehavior: "",
        explanation: "",
        checkedBy: [],
      },
    ]);
    expect(
      parseTests2checkResult({}, "TEST_1", "manager", 5).requirements
    ).toEqual([]);
  });

  test("takes a location without lines as needing none", () => {
    const data = parseTests2checkResult(
      {
        ...coverageResult,
        expected_coverage: {
          "FR-1": [{ unit: "manager", path: "/src/manager.c" }],
        },
      },
      "TEST_1",
      "manager",
      5
    );
    expect(data.expectedLines).toEqual([]);
    expect(data.ranLines).toEqual([]);
  });

  test("ignores the required lines of another unit", () => {
    const data = parseTests2checkResult(
      {
        ...coverageResult,
        expected_coverage: {
          "FR-1": [
            {
              unit: "database",
              path: "/src/database.c",
              lines: [3],
              ran_lines: [3],
            },
          ],
        },
      },
      "TEST_1",
      "manager",
      5
    );
    expect(data.expectedLines).toEqual([]);
    expect(data.ranLines).toEqual([]);
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

describe("an Ada subunit file", () => {
  const locations = (path: string | undefined) => ({
    "FR-1": [
      { unit: "calculator", path, lines: [3, 4], ran_lines: [3] },
      {
        unit: "calculator",
        path: "/src/calculator-power.adb",
        lines: [7],
        ran_lines: [],
      },
    ],
  });

  test("takes only the required lines in that file", () => {
    const data = parseTests2checkResult(
      {
        ...coverageResult,
        expected_coverage: locations("/src/calculator-safe_divide.adb"),
      },
      "DIVIDE_OK",
      "CALCULATOR",
      2,
      "C:\\src\\Calculator-Safe_Divide.adb"
    );
    expect(data.expectedLines).toEqual([3, 4]);
    expect(data.ranLines).toEqual([3]);
  });

  test("keeps a required line whose file tests2check does not name", () => {
    const data = parseTests2checkResult(
      { ...coverageResult, expected_coverage: locations(undefined) },
      "DIVIDE_OK",
      "CALCULATOR",
      2,
      "/src/calculator-safe_divide.adb"
    );
    expect(data.expectedLines).toEqual([3, 4]);
  });
});

describe("the group comment's overall mark", () => {
  const withVerdict = (name: string, verdict: string) => ({
    data: parseTests2checkResult(
      { ...coverageResult, name, verdict },
      name,
      "manager",
      5
    ),
  });

  test("is a pass when every test passed", () => {
    const markdown = groupMarkdown("manager.Place_Order", [
      withVerdict("A", "PASS"),
      withVerdict("B", "PASS"),
    ]);
    expect(markdown).toContain("#### ✅ manager.Place\\_Order");
    expect(markdown).toContain("2 passed, 0 failed");
  });

  test("is undecided when no test failed but one has no verdict", () => {
    const markdown = groupMarkdown("manager.Place_Order", [
      withVerdict("A", "PASS"),
      withVerdict("B", ""),
    ]);
    expect(markdown).toContain("#### ℹ️ manager.Place\\_Order");
    expect(markdown).toContain("1 passed, 0 failed, 1 undecided");
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

  const steakArgument = encodeURIComponent(JSON.stringify([tests[0].testId]));

  test("has a last column that marks each test of the test tree as reviewed", () => {
    const markdown = groupMarkdown("manager.Place_Order", tests, {
      flagged: new Map(),
      markCommand: "ext.mark",
      unmarkCommand: "ext.unmark",
    });
    expect(markdown).toContain('width="18%"');
    expect(markdown).toContain(">Reviewed</th></tr></thead>");
    expect(markdown).toContain(
      `<td>STEAK</td><td>✅ FR-1</td><td><a href="command:ext.mark?${steakArgument}" ` +
        'title="You reviewed this test">Mark&nbsp;as&nbsp;reviewed</a></td></tr>'
    );
    // A test that is not in the tree cannot be marked.
    expect(markdown).toContain(
      "<td>CHICKEN</td><td>❌ FR-1</td><td></td></tr>"
    );
    expect(markdown).toContain(
      "1 passed, 1 failed &nbsp;&nbsp; 0 of 1 reviewed"
    );
    expect(markdown).not.toContain("ext.unmark");
  });

  test("says of a test marked as reviewed that it is, with a link that takes that back", () => {
    const markdown = groupMarkdown("manager.Place_Order", tests, {
      flagged: new Map(),
      reviewed: new Set([tests[0].testId!]),
      markCommand: "ext.mark",
      unmarkCommand: "ext.unmark",
    });
    expect(markdown).toContain(
      '<td><span style="color:var(--vscode-testing-iconPassed);">✔&nbsp;Reviewed</span>' +
        `&nbsp;&nbsp;<a href="command:ext.unmark?${steakArgument}" title="Take the reviewed mark back">Undo</a></td>`
    );
    expect(markdown).toContain("1 of 1 reviewed");
    expect(markdown).not.toContain("ext.mark?");
  });

  test("says below a flagged test's name that it needs review, and marks it in the last column", () => {
    const markdown = groupMarkdown("manager.Place_Order", tests, {
      flagged: new Map([[tests[0].testId!, ["FR-1", "FR <2>"]]]),
      // A mark from before the requirement changed does not count.
      reviewed: new Set([tests[0].testId!]),
      markCommand: "ext.mark",
      unmarkCommand: "ext.unmark",
    });
    expect(markdown).toContain(
      '<td>STEAK<br><span style="color:var(--vscode-editorWarning-foreground);">' +
        "Needs review:</span> requirements FR-1 and FR &lt;2&gt; changed</td>"
    );
    expect(markdown).toContain(
      `<td><a href="command:ext.mark?${steakArgument}" ` +
        'title="You checked that this test still fits the changed requirement">Mark&nbsp;as&nbsp;reviewed</a></td>'
    );
    expect(markdown).toContain("0 of 1 reviewed");
    expect(markdown).not.toContain("✔&nbsp;Reviewed");
    // The test that is not flagged, and not in the tree, says nothing.
    expect(markdown).toContain("<td>CHICKEN</td>");
    expect(markdown.match(/Needs review/g)).toHaveLength(1);
  });

  test("flags a test without a link when there is no command to mark it", () => {
    const markdown = groupMarkdown("manager.Place_Order", tests, {
      flagged: new Map([[tests[0].testId!, ["FR-1"]]]),
    });
    expect(markdown).toContain(
      "Needs review:</span> requirement FR-1 changed</td>"
    );
    expect(markdown).not.toContain("<a ");
  });

  test("says nothing of the tests' review when it is not told about it", () => {
    const markdown = groupMarkdown("manager.Place_Order", tests);
    expect(markdown).not.toContain("Needs review");
    expect(markdown).not.toContain("eviewed");
    expect(markdown.match(/<th /g)).toHaveLength(3);
  });

  test("names the day of a mark, and none for a time it cannot read", () => {
    expect(localDay("2026-03-07T09:05:00")).toBe("2026-03-07");
    expect(localDay("not a time")).toBe("");
  });
});

describe("the tests VectorCAST flags for review", () => {
  // The gateway's record of an environment's tests, as VectorCAST writes it.
  const record = (
    unit: string,
    subprogram: string,
    name: string,
    links: Record<string, unknown>
  ) => ({
    environment_name: "TUTORIAL_C",
    unit_name: unit,
    subprogram_name: subprogram,
    test_case_name: name,
    linked_requirements: Object.fromEntries(
      Object.entries(links).map(([key, flag]) => [key, { needs_review: flag }])
    ),
    status: "pass",
    needs_export: true,
    external_key: null,
  });
  const key = (unit: string, subprogram: string, name: string) =>
    reviewFlagKey(unit, subprogram, name);

  test("are those linked to a changed requirement, with the keys of those", () => {
    const flags = parseReviewFlags({
      "TUTORIAL_C.manager.Place_Order.STEAK": record(
        "manager",
        "Place_Order",
        "STEAK",
        { "FR-1": "y", "FR-2": "n", "FR-3": "y" }
      ),
      "TUTORIAL_C.manager.Place_Order.CHICKEN": record(
        "manager",
        "Place_Order",
        "CHICKEN",
        { "FR-1": "n" }
      ),
    });
    expect([...flags]).toEqual([
      [key("manager", "Place_Order", "STEAK"), ["FR-1", "FR-3"]],
    ]);
  });

  test("are read from the boolean flag of later VectorCAST versions too", () => {
    const flags = parseReviewFlags({
      a: record("manager", "Place_Order", "STEAK", { "FR-1": true }),
      b: record("manager", "Place_Order", "CHICKEN", { "FR-1": false }),
    });
    expect([...flags.keys()]).toEqual([key("manager", "Place_Order", "STEAK")]);
  });

  test("are found whatever the case of an Ada unit's and subprogram's name", () => {
    const flags = parseReviewFlags({
      a: record("MANAGER", "Place_Order", "STEAK", { "FR-1": "y" }),
    });
    expect(flags.get(key("manager", "PLACE_ORDER", "STEAK"))).toEqual(["FR-1"]);
    // A test's name is as written.
    expect(flags.has(key("manager", "Place_Order", "steak"))).toBe(false);
  });

  test("include a compound test, whichever unit VectorCAST files it under", () => {
    const flags = parseReviewFlags({
      a: record("manager", "<<COMPOUND>>", "ORDER_AND_PAY", { "FR-1": "y" }),
    });
    expect(flags.get(key("not-used", "<<COMPOUND>>", "ORDER_AND_PAY"))).toEqual(
      ["FR-1"]
    );
  });

  test("are none for a record that is missing, empty or not as expected", () => {
    expect(parseReviewFlags(undefined).size).toBe(0);
    expect(parseReviewFlags({}).size).toBe(0);
    expect(parseReviewFlags("[]").size).toBe(0);
    expect(
      parseReviewFlags({
        a: null,
        b: { test_case_name: "STEAK" },
        c: { linked_requirements: { "FR-1": { needs_review: "y" } } },
        d: { ...record("manager", "Place_Order", "STEAK", {}) },
        e: {
          ...record("manager", "Place_Order", "CHICKEN", {}),
          linked_requirements: { "FR-1": null, "FR-2": {} },
        },
      }).size
    ).toBe(0);
  });

  test("are named with their changed requirements", () => {
    expect(requirementsText(["FR-1"])).toBe("requirement FR-1");
    expect(requirementsText(["FR-1", "FR-2"])).toBe(
      "requirements FR-1 and FR-2"
    );
    expect(requirementsText(["FR-1", "FR-2", "FR-3"])).toBe(
      "requirements FR-1, FR-2 and FR-3"
    );
  });
});

describe("a test's reviewed mark", () => {
  const prefix = "vcast:/work/ENV|";
  const steak = `${prefix}manager.Place_Order.STEAK`;
  const chicken = `${prefix}manager.Place_Order.CHICKEN`;
  // An environment whose name starts like this one's is another one.
  const elsewhere = "vcast:/work/ENV_2|manager.Place_Order.STEAK";
  const marked = [steak, chicken, elsewhere];

  test("holds while its test is there and no requirement of it changed", () => {
    expect(
      staleReviewMarks(marked, prefix, new Set(), new Set([steak, chicken]))
    ).toEqual([]);
  });

  test("goes when VectorCAST flags the test for review", () => {
    expect(
      staleReviewMarks(
        marked,
        prefix,
        new Set([chicken, elsewhere]),
        new Set([steak, chicken])
      )
    ).toEqual([chicken]);
    // Also when the environment's tests are not known.
    expect(staleReviewMarks(marked, prefix, new Set([steak]))).toEqual([steak]);
  });

  test("goes with its test", () => {
    expect(
      staleReviewMarks(marked, prefix, new Set(), new Set([chicken]))
    ).toEqual([steak]);
  });

  test("stays while the environment's tests are not known or it shows none", () => {
    expect(staleReviewMarks(marked, prefix, new Set())).toEqual([]);
    // An environment that failed to load has no tests in the tree.
    expect(staleReviewMarks(marked, prefix, new Set(), new Set())).toEqual([]);
  });

  test("of another environment is left alone", () => {
    expect(
      staleReviewMarks(marked, prefix, new Set([elsewhere]), new Set([steak]))
    ).toEqual([chicken]);
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

describe("which test a tests2check result names", () => {
  const identity = { name: "TEST_1", unit: "manager", subprogram: "add" };

  test("reads the name, unit and subprogram from the result's test record", () => {
    expect(resultIdentity({ test: identity })).toEqual(identity);
  });

  test("reads them from the result itself when it has no test record", () => {
    expect(resultIdentity(identity)).toEqual(identity);
  });

  test("takes the test record's name and the result's unit and subprogram first", () => {
    expect(
      resultIdentity({
        name: "outer",
        unit: "manager",
        subprogram: "add",
        test: { name: "TEST_1", unit: "other", subprogram: "remove" },
      })
    ).toEqual(identity);
  });

  test("names nothing for a result without them or without a result", () => {
    const none = { name: undefined, unit: undefined, subprogram: undefined };
    expect(resultIdentity({})).toEqual(none);
    expect(resultIdentity(undefined)).toEqual(none);
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
    expect(html.slice(placeOrder, clearTable)).toContain("TEST_<wbr>2");
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
    // The name can wrap after its underscore.
    expect(html).toContain("TEST_<wbr>2 &lt;b&gt;");
    expect(html).not.toContain("<b>");
  });

  test("offers no review of a unit or function whose tests are not in the tree", () => {
    const page = checkReportHtml({
      scope: "manager",
      groups: [
        {
          unitName: "manager",
          functionName: "Place_Order",
          tests: [{ data: failed }],
        },
      ],
      nonce: "n0nce",
      cspSource: "vscode-resource:",
    });
    expect(page).not.toContain("Review function");
    expect(page).not.toContain("Review unit");
  });

  test("counts and marks a test without a verdict as undecided", () => {
    const undecided = parseTests2checkResult(
      { ...coverageResult, name: "TEST_3", verdict: "" },
      "TEST_3",
      "manager",
      5
    );
    const page = checkReportHtml({
      scope: "manager",
      groups: [
        {
          unitName: "manager",
          functionName: "Place_Order",
          tests: [{ data: passed }, { data: undecided }],
        },
      ],
      nonce: "n0nce",
      cspSource: "vscode-resource:",
    });
    expect(page).toContain("1 undecided");
    expect(page).toContain(
      '<span class="verdict other"><span class="mark">•</span> </span>'
    );
  });

  test("only runs its own script", () => {
    expect(html).toContain("script-src 'nonce-n0nce'");
    expect(html).toContain('<script nonce="n0nce">');
  });

  test("has a mark button and a place for the review flag on each test found in the tree", () => {
    expect(html.match(/<span class="review-flag"><\/span>/g)).toHaveLength(2);
    expect(html).toContain(
      'class="mark-reviewed" data-test-id="vcast:/env|manager.Place_Order.TEST_1" ' +
        'title="You reviewed this test">Mark as reviewed</button>'
    );
    // Two tests in the tree, and the banner's button for all flagged ones.
    expect(html.match(/class="mark-reviewed"/g)).toHaveLength(3);
    expect(html).toContain(
      '<p id="review-banner" class="review-banner" hidden>'
    );
    // A marked test's button takes the mark back.
    expect(html).toContain('? "unmark-reviewed" : "mark-reviewed"');
    // Each unit and function header counts the reviewed and the flagged
    // tests under it.
    expect(html.match(/<span class="reviewed-count"><\/span>/g)).toHaveLength(
      3
    );
    expect(html.match(/<span class="review-count"><\/span>/g)).toHaveLength(3);
  });

  test("starts with no test flagged or marked as reviewed unless told which are", () => {
    expect(html).toContain(
      'showReviewStatus({"needsReview":{},"reviewed":{}});'
    );
  });

  test("starts with the given tests flagged or marked as reviewed", () => {
    const page = checkReportHtml({
      scope: "manager",
      groups: [
        {
          unitName: "manager",
          functionName: "Place_Order",
          tests: [
            { testId: "vcast:/env|manager.Place_Order.T<1", data: passed },
          ],
        },
      ],
      reviewStatus: {
        needsReview: {
          "vcast:/env|manager.Place_Order.T<1": ["FR-1", "</script>"],
        },
        reviewed: { "vcast:/env|manager.Clear_Table.TEST_1": "2026-11-24" },
      },
      nonce: "n0nce",
      cspSource: "vscode-resource:",
    });
    // What it starts with cannot end the script it is written into.
    expect(page).toContain(
      'showReviewStatus({"needsReview":{"vcast:/env|manager.Place_Order.T\\u003c1":["FR-1","\\u003c/script>"]},' +
        '"reviewed":{"vcast:/env|manager.Clear_Table.TEST_1":"2026-11-24"}});'
    );
    expect(page.match(/<\/script>/g)).toHaveLength(1);
  });

  test("says how many tests it left out for lack of a linked requirement, and which on hover", () => {
    const options = {
      scope: "manager",
      groups: [
        {
          unitName: "manager",
          functionName: "Place_Order",
          tests: [{ data: passed }],
        },
      ],
      nonce: "n0nce",
      cspSource: "vscode-resource:",
    };
    const three = checkReportHtml({
      ...options,
      unchecked: ["TEST_A", "TEST_B <b>", "Clear_Table.TEST_C"],
    });
    expect(three).toContain(
      "3 tests without a linked requirement were not checked."
    );
    expect(three).toContain(
      'class="unchecked" title="TEST_A\nTEST_B &lt;b&gt;\nClear_Table.TEST_C"'
    );
    expect(checkReportHtml({ ...options, unchecked: ["TEST_A"] })).toContain(
      "1 test without a linked requirement was not checked."
    );
    expect(checkReportHtml(options)).not.toContain("not checked");
    expect(html).not.toContain("not checked");
  });
});
/* eslint-enable @typescript-eslint/naming-convention */
