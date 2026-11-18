import { describe, expect, test } from "vitest";
import {
  type CheckedFunction,
  checkedFunctionFrom,
  findingMarkdown,
  findingsSummary,
  isInFile,
  lineAfterEdits,
  mergeCheckedFunctions,
  openFindings,
  parseReqs2checkOutput,
  requirementChecks,
  requirementsChanged,
  tracedRequirements,
} from "../../src/requirements/codeCheckData";
import { codeCheckReportHtml } from "../../src/requirements/codeCheckReport";

// The snake_case keys mirror the JSON printed by reqs2check,
// so we'll disable the strictCamelCase check here.
/* eslint-disable @typescript-eslint/naming-convention */

const requirement = (key: string) => ({
  key,
  title: `Title of ${key}`,
  description: `The system shall do ${key}.`,
});

// A function as reqs2check reports it: one that passed, by default.
function entry(name: string, fields: Record<string, unknown> = {}) {
  return {
    function: name,
    unit: "manager",
    verdict: "PASS",
    requirements: [requirement(`${name}.1`), requirement(`${name}.2`)],
    findings: [],
    ...fields,
  };
}

const placeOrderFindings = [
  {
    kind: "violation",
    requirement_key: "PlaceOrder.1",
    behavior_label: null,
    description: "The total is not updated for <b>lobster</b>.",
  },
  {
    kind: "missing",
    requirement_key: "PlaceOrder.2",
    behavior_label: null,
    description: "Nothing seats the party.",
  },
  {
    kind: "undocumented",
    requirement_key: null,
    behavior_label: "adds_free_dessert",
    description: "A free dessert is added.",
  },
];

const placeOrder = entry("PlaceOrder", {
  verdict: "FAIL",
  findings: placeOrderFindings,
  finding_lines: [
    { file: "/src/manager.c", line: 42 },
    { file: "/src/manager.c", line: 57 },
  ],
});

const checked = (reported: unknown, checkedAt = 1000): CheckedFunction =>
  checkedFunctionFrom(reported, checkedAt);

describe("reqs2check's output", () => {
  test("is the result after the progress events", () => {
    const stdout = [
      '{"event": "progress", "value": {"progress": 0.0, "step": "Indexing codebase"}}',
      '{"event": "progress", "value": {"progress": 1.0, "step": "Checking functions"}}',
      JSON.stringify([placeOrder, entry("ClearTable")], null, 4),
    ].join("\n");

    const functions = parseReqs2checkOutput(stdout);

    expect(functions).toMatchObject([
      { function: "PlaceOrder" },
      { function: "ClearTable" },
    ]);
  });

  test("is refused when it is not a list of functions", () => {
    expect(() => parseReqs2checkOutput('{"error": "no"}')).toThrow(TypeError);
    expect(() => parseReqs2checkOutput("Traceback")).toThrow(SyntaxError);
  });

  test("gives each function its requirements, findings and lines", () => {
    const result = checked(placeOrder);

    expect(result).toMatchObject({
      unit: "manager",
      name: "PlaceOrder",
      checkedAt: 1000,
      stale: false,
      findingLines: [
        { file: "/src/manager.c", line: 42 },
        { file: "/src/manager.c", line: 57 },
      ],
    });
    expect(result.requirements.map(({ key }) => key)).toEqual([
      "PlaceOrder.1",
      "PlaceOrder.2",
    ]);
    expect(result.findings.map(({ kind }) => kind)).toEqual([
      "violation",
      "missing",
      "undocumented",
    ]);
  });

  test("identifies a finding by what it is about, not by its wording", () => {
    const reworded = {
      ...placeOrder,
      findings: placeOrderFindings.map((finding) => ({
        ...finding,
        description: "Said differently.",
      })),
    };

    expect(checked(reworded).findings.map(({ id }) => id)).toEqual(
      checked(placeOrder).findings.map(({ id }) => id)
    );
    expect(checked(placeOrder).findings[2].id).toBe(
      "manager|PlaceOrder|undocumented|adds_free_dessert"
    );
  });

  test("tolerates a function without lines or findings", () => {
    const result = checked({ function: "Idle", unit: "manager" });

    expect(result.findings).toEqual([]);
    expect(result.findingLines).toEqual([]);
    expect(result.requirements).toEqual([]);
  });
});

describe("a new check", () => {
  const known = [
    checked(entry("PlaceOrder")),
    checked(entry("ClearTable")),
    checked(entry("GetRecord", { unit: "database" })),
  ];
  const names = (functions: CheckedFunction[]) =>
    functions.map(({ name }) => name);

  test("of a function replaces that function in place", () => {
    const merged = mergeCheckedFunctions(known, [checked(placeOrder, 2000)], {
      unit: "manager",
      function: "PlaceOrder",
    });

    expect(names(merged)).toEqual(["PlaceOrder", "ClearTable", "GetRecord"]);
    expect(merged[0].checkedAt).toBe(2000);
    expect(merged[1]).toBe(known[1]);
  });

  test("of a unit drops its functions that are no longer reported", () => {
    const merged = mergeCheckedFunctions(
      known,
      [checked(entry("ClearTable")), checked(entry("AddParty"))],
      { unit: "manager" }
    );

    expect(names(merged)).toEqual(["ClearTable", "GetRecord", "AddParty"]);
  });

  test("of the environment replaces everything", () => {
    const merged = mergeCheckedFunctions(
      known,
      [checked(entry("AddParty"))],
      {}
    );

    expect(names(merged)).toEqual(["AddParty"]);
  });

  test("matches Ada names in any case", () => {
    const merged = mergeCheckedFunctions(
      known,
      [checked(entry("PLACEORDER", { unit: "MANAGER" }))],
      { unit: "Manager", function: "placeorder" }
    );

    expect(names(merged)).toEqual(["PLACEORDER", "ClearTable", "GetRecord"]);
  });
});

describe("findings", () => {
  const result = checked(placeOrder);
  const [violation, missing, undocumented] = result.findings;

  test("are counted by kind", () => {
    expect(findingsSummary(result.findings)).toBe(
      "1 violation, 1 undocumented behavior, 1 missing implementation"
    );
    expect(findingsSummary([violation, { ...violation, id: "other" }])).toBe(
      "2 violations"
    );
    expect(findingsSummary([{ ...violation, kind: "error" }])).toBe(
      "1 other finding"
    );
    expect(findingsSummary([])).toBe("no findings");
  });

  test("no longer count once dismissed", () => {
    expect(openFindings(result, [violation.id, undocumented.id])).toEqual([
      missing,
    ]);
  });

  test("quote the requirement they are about", () => {
    expect(findingMarkdown(violation, result)).toBe(
      "> The system shall do PlaceOrder.1.\n\n" +
        "The total is not updated for \\<b\\>lobster\\</b\\>."
    );
    expect(findingMarkdown(undocumented, result)).toBe(
      "A free dessert is added."
    );
  });

  test("belong to the files of their function and their lines", () => {
    const located = {
      ...result,
      start: { file: "C:\\src\\Manager.c", line: 30 },
    };

    expect(isInFile(located, "c:\\src\\manager.c")).toBe(true);
    expect(isInFile(located, "/src/manager.c")).toBe(true);
    expect(isInFile(located, "/src/database.c")).toBe(false);
  });
});

describe("a line of an edited file", () => {
  const edit = (
    startLine: number,
    endLine: number,
    text: string,
    endCharacter = 4
  ) => ({ startLine, endLine, endCharacter, text });

  test("moves down with lines added above it", () => {
    expect(lineAfterEdits(10, [edit(2, 2, "// one\n// two\n")])).toBe(12);
  });

  test("moves up with lines removed above it", () => {
    expect(lineAfterEdits(10, [edit(2, 5, "")])).toBe(7);
  });

  test("moves down with a line put in at its start", () => {
    expect(lineAfterEdits(10, [edit(10, 10, "// pasted\n", 0)])).toBe(11);
  });

  test("stays for edits on it or below it", () => {
    expect(
      lineAfterEdits(10, [
        edit(10, 10, "x\n"),
        edit(11, 14, ""),
        edit(3, 3, "y"),
      ])
    ).toBe(10);
  });
});

describe("the requirements of a checked environment", () => {
  const functions = [checked(placeOrder), checked(entry("ClearTable"))];

  test("are violated, missing or implemented", () => {
    const checks = requirementChecks({ functions, dismissed: [] });

    expect(checks["PlaceOrder.1"]).toEqual({
      status: "violated",
      stale: false,
      unit: "manager",
      function: "PlaceOrder",
      details: ["The total is not updated for <b>lobster</b>."],
    });
    expect(checks["PlaceOrder.2"].status).toBe("missing");
    expect(checks["ClearTable.1"]).toMatchObject({
      status: "implemented",
      details: [],
    });
  });

  test("are implemented once their findings are dismissed", () => {
    const [violation] = functions[0].findings;
    const checks = requirementChecks({ functions, dismissed: [violation.id] });

    expect(checks["PlaceOrder.1"].status).toBe("implemented");
    expect(checks["PlaceOrder.2"].status).toBe("missing");
  });

  test("are none before a check", () => {
    expect(requirementChecks(undefined)).toEqual({});
  });

  const gateway = (description: string, tracedTo = "ClearTable") =>
    tracedRequirements({
      requirements: {
        source: {
          "ClearTable.1": { description: "The system shall do ClearTable.1." },
          "ClearTable.2": { description },
        },
      },
      traceability: {
        "ClearTable.1": { unit: "manager", function: "ClearTable" },
        "ClearTable.2": { unit: "manager", function: tracedTo },
      },
    });

  test("leave a function up to date while they stay the same", () => {
    const current = gateway("The system shall do ClearTable.2.");

    expect(requirementsChanged(functions[1], current)).toBe(false);
    // Nothing of PlaceOrder is in this gateway any more.
    expect(requirementsChanged(functions[0], current)).toBe(true);
  });

  test("make a function out of date when one reads differently", () => {
    expect(requirementsChanged(functions[1], gateway("Reworded."))).toBe(true);
  });

  test("make a function out of date when one is traced elsewhere", () => {
    const current = gateway("The system shall do ClearTable.2.", "PlaceOrder");

    expect(requirementsChanged(functions[1], current)).toBe(true);
  });
});

describe("the report", () => {
  const options = {
    enviroName: "DEMO",
    check: {
      functions: [
        { ...checked(placeOrder), start: { file: "/src/manager.c", line: 30 } },
        checked(entry("ClearTable")),
        checked(entry("GetRecord", { unit: "database" })),
      ],
      dismissed: [] as string[],
    },
    nonce: "n0nce",
    cspSource: "vscode-resource:",
  };
  const page = codeCheckReportHtml(options);

  test("sums up what was checked and found", () => {
    expect(page).toContain("<h1>Code against requirements: DEMO</h1>");
    expect(page).toContain(
      "3 functions checked: 1 violation, 1 undocumented behavior, 1 missing implementation."
    );
    expect(page).toContain("AI-generated requirements check.");
  });

  test("groups the functions by unit", () => {
    expect(page.match(/<details class="unit"/g)).toHaveLength(2);
    expect(page).toContain(
      "2 functions, 1 violation, 1 undocumented behavior, 1 missing implementation"
    );
    expect(page).toContain("1 function, no findings");
  });

  test("unfolds only the functions with findings", () => {
    expect(page).toContain(
      '<details class="function" data-id="manager|PlaceOrder" open>'
    );
    expect(page).toContain(
      '<details class="function" data-id="manager|ClearTable">'
    );
  });

  test("shows each finding under its requirement, escaped", () => {
    expect(page).toContain(
      '<span class="description">The total is not updated for &lt;b&gt;lobster&lt;/b&gt;.</span>'
    );
    expect(page).toContain(
      '<span class="kind violation">Violates requirement</span>'
    );
    expect(page).toContain('<span class="mark fail">✘</span> PlaceOrder.1');
    expect(page).toContain('<span class="mark pass">✔</span> ClearTable.1');
    expect(page).toContain(
      '<span class="kind undocumented">Undocumented behavior</span>'
    );
  });

  test("offers the code only of a function whose source is known", () => {
    expect(page).toContain(
      'data-action="show" data-unit="manager" data-function="PlaceOrder"'
    );
    expect(page).not.toContain(
      'data-action="show" data-unit="database" data-function="GetRecord"'
    );
  });

  test("strikes a dismissed finding out and offers it back", () => {
    const [violation] = options.check.functions[0].findings;
    const dismissed = codeCheckReportHtml({
      ...options,
      check: { ...options.check, dismissed: [violation.id] },
    });

    expect(dismissed).toContain(
      "3 functions checked: 1 undocumented behavior, 1 missing implementation, 1 dismissed."
    );
    expect(dismissed).toContain('<p class="finding dismissed">');
    expect(dismissed).toContain(
      `data-action="restore" data-id="${violation.id}"`
    );
    expect(dismissed).toContain(
      '<span class="mark pass">✔</span> PlaceOrder.1'
    );
  });

  test("says when functions are out of date", () => {
    expect(page).not.toContain('stale-banner">');
    const [first, ...others] = options.check.functions;
    const stale = codeCheckReportHtml({
      ...options,
      check: {
        ...options.check,
        functions: [{ ...first, stale: true }, ...others],
      },
    });

    expect(stale).toContain(
      "Out of date: the code or the requirements of 1 function changed since the check."
    );
    expect(stale).toContain('<span class="stale-tag">⚠ out of date</span>');
  });

  test("runs its styles and script under the nonce only", () => {
    expect(page).toContain("script-src 'nonce-n0nce'");
    expect(page).toContain('<script nonce="n0nce">');
    expect(page).toContain('<style nonce="n0nce">');
  });
});

/* eslint-enable @typescript-eslint/naming-convention */
