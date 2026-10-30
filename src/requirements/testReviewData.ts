// Kept free of the vscode module so the parsing and rendering can be unit tested.

// One linked requirement as tests2check judged it.
export interface RequirementCheck {
  key: string;
  description: string;
  verdict: string;
  checkedBehavior: string;
  explanation: string;
  checkedBy: string[];
}

export interface RequirementData {
  title: string;
  lineNumber: number;
  expectedLines: number[];
  // The expected lines whose VectorCAST statement the test ran.
  ranLines: number[];
  verdict: string;
  requirements: RequirementCheck[];
}

const baseName = (file: string) =>
  file.replace(/\\/g, "/").split("/").pop()!.toLowerCase();

/**
 * Turns one test's entry from `tests2check --json` into what the review shows.
 * Lines from tests2check are 0-based.
 */
export function parseTests2checkResult(
  testResult: any,
  testName: string,
  unitName: string,
  functionStartLine: number,
  // An Ada subunit file the review shows: only the lines in that file count,
  // as the unit's other lines are in its parent body.
  subunitFile?: string
): RequirementData {
  // A tests2check that leaves a field out or null must not break the review.
  const expectedCoverage = testResult.expected_coverage ?? {};

  // A test can be linked to several requirements: expect the lines of all of them.
  const expectedLines: number[] = [];
  const ranLines: number[] = [];
  for (const locations of Object.values(expectedCoverage)) {
    for (const location of locations as any[]) {
      // Ada unit names are case-insensitive (MANAGER, manager.adb)
      const inFile =
        !subunitFile ||
        !location.path ||
        baseName(location.path) === baseName(subunitFile);
      if (
        String(location.unit).toLowerCase() === unitName.toLowerCase() &&
        inFile
      ) {
        expectedLines.push(...(location.lines ?? []));
        ranLines.push(...(location.ran_lines ?? []));
      }
    }
  }

  return {
    title: testResult.name || testName,
    lineNumber: functionStartLine,
    expectedLines,
    ranLines,
    verdict: testResult.verdict ?? "",
    requirements: (testResult.requirements ?? []).map((req: any) => ({
      key: req.key ?? "",
      description: req.description ?? "",
      verdict: req.verdict ?? "",
      checkedBehavior: req.checked_behavior ?? "",
      explanation: req.explanation ?? "",
      checkedBy: req.checked_by ?? [],
    })),
  };
}

// A checked test as a review shows it; the node ID is known when the test
// was found in the test tree.
export interface ReviewedTest {
  testId?: string;
  data: RequirementData;
}

/**
 * The 1-based lines a requirements check colors: only the code the
 * requirements need, green where the test ran it and red where it did not.
 * For several tests (a function's or a unit's), the lines all their
 * requirements need, green where any of the tests ran it. Every other line
 * the tests ran shows in the coverage gutter only.
 */
export function reviewLineColors(input: RequirementData | RequirementData[]): {
  covered: number[];
  uncovered: number[];
} {
  const tests = Array.isArray(input) ? input : [input];
  const ran = new Set(tests.flatMap((test) => test.ranLines));
  const expected = new Set(tests.flatMap((test) => test.expectedLines));
  const covered: number[] = [];
  const uncovered: number[] = [];
  for (const line of [...expected].sort((a, b) => a - b)) {
    (ran.has(line) ? covered : uncovered).push(line + 1);
  }
  return { covered, uncovered };
}

// Which test a tests2check result is about, as the tool names it.
export function resultIdentity(result: any): {
  name?: string;
  unit?: string;
  subprogram?: string;
} {
  return {
    name: result?.test?.name ?? result?.name,
    unit: result?.unit ?? result?.test?.unit,
    subprogram: result?.subprogram ?? result?.test?.subprogram,
  };
}

// How many tests passed, failed or got no verdict.
export function verdictCounts(verdicts: string[]): {
  passed: number;
  failed: number;
  undecided: number;
} {
  const passed = verdicts.filter((v) => v === "PASS").length;
  const failed = verdicts.filter((v) => v === "FAIL").length;
  return { passed, failed, undecided: verdicts.length - passed - failed };
}

// "1 passed, 1 failed"
export function countVerdicts(verdicts: string[]): string {
  const { passed, failed, undecided } = verdictCounts(verdicts);
  return [
    `${passed} passed`,
    `${failed} failed`,
    ...(undecided ? [`${undecided} undecided`] : []),
  ].join(", ");
}

// Emoji keep their colour in a comment, where theme icons take the text's.
const VERDICT_MARKS: Record<string, string> = {
  PASS: "✅",
  FAIL: "❌",
};

// Text from the test or tests2check must not be read as Markdown or icons.
function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-!~|<>$]/g, "\\$&");
}

const mark = (verdict: string) => VERDICT_MARKS[verdict] ?? "ℹ️";

/**
 * The requirements check comment: the verdict, then each linked requirement with
 * its own verdict and the labelled blocks tests2check prints (the checked
 * behavior, the explanation and the checking assertions), then what the
 * highlighted lines mean.
 */
export function reviewMarkdown(reqData: RequirementData): string {
  const parts = [
    `#### ${mark(reqData.verdict)} Verdict: ${escapeMarkdown(reqData.verdict)}`,
  ];
  for (const req of reqData.requirements) {
    parts.push(
      `##### ${mark(req.verdict)} ${escapeMarkdown(req.verdict)}: ` +
        escapeMarkdown(req.key),
      escapeMarkdown(req.description),
      `**Checked behavior**\n\n${escapeMarkdown(req.checkedBehavior)}`,
      `**Explanation**\n\n${escapeMarkdown(req.explanation)}`
    );
    if (req.checkedBy.length) {
      const names = req.checkedBy.map((n) => `- \`${n}\``);
      parts.push(`**Checked by**\n\n${names.join("\n")}`);
    }
  }
  parts.push(
    "**Highlighted lines**\n\nThe code the requirements need: green where this " +
      "test ran it, red where it did not. The gutter shows, for this test only, " +
      "which lines in the file ran (green) and which did not (red)."
  );
  return parts.join("\n\n");
}

// Text from the test or tests2check put into HTML (the comment's table, the
// report) must not be read as HTML.
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// The only styling VS Code keeps in a comment's HTML: colors from the theme.
const VERDICT_STYLES: Record<string, string> = {
  PASS: ' style="color:var(--vscode-testing-iconPassed);"',
  FAIL: ' style="color:var(--vscode-testing-iconFailed);"',
};
const HEADER_STYLE =
  ' style="background-color:var(--vscode-sideBarSectionHeader-background);"';

/**
 * The comment of a function's or unit's review: the counts, then a table
 * with one row per test (its verdict, its name, its requirements' verdicts;
 * fixed column widths, so a long name wraps inside its cell), then what the
 * highlighted lines and the gutter mean for several tests. The table is
 * HTML: a Markdown table gets no column widths in a comment.
 */
export function groupMarkdown(title: string, tests: ReviewedTest[]): string {
  const verdicts = tests.map((test) => test.data.verdict);
  const overall = verdicts.includes("FAIL")
    ? "FAIL"
    : verdicts.every((verdict) => verdict === "PASS")
      ? "PASS"
      : "";
  const th = (width: string, text: string) =>
    `<th align="left" width="${width}"${HEADER_STYLE}>${text}</th>`;
  const rows = tests.map(({ data }) => {
    const requirements = data.requirements
      .map((req) => `${mark(req.verdict)} ${escapeHtml(req.key)}`)
      .join("<br>");
    return (
      `<tr><td${VERDICT_STYLES[data.verdict] ?? ""}><b>${mark(data.verdict)} ${escapeHtml(data.verdict)}</b></td>` +
      `<td>${escapeHtml(data.title)}</td><td>${requirements}</td></tr>`
    );
  });
  return [
    `#### ${mark(overall)} ${escapeMarkdown(title)} &nbsp;&nbsp; ${countVerdicts(verdicts)}`,
    [
      '<table width="100%">',
      `<thead><tr>${th("14%", "Verdict")}${th("56%", "Test")}${th("30%", "Requirements")}</tr></thead>`,
      "<tbody>",
      ...rows,
      "</tbody>",
      "</table>",
    ].join("\n"),
    "**Lines**: green = needed by a requirement and run by one of these " +
      "tests, red = needed but run by none. **Gutter**: the coverage of these " +
      "tests together. **Hover** a line for the tests that ran it.",
  ].join("\n\n");
}

/**
 * Which of a requirement's lines (0-based) a test ran, read from the gutter's
 * data: the lines it marks as run by the test and the lines it can mark at all
 * (both 1-based). Like tests2check, a line the gutter never marks, such as a
 * case label or a continuation line, counts as run when the next markable
 * line ran.
 */
export function ranLinesFromCoverage(
  expectedLines: number[],
  ranLines: Set<number>,
  coverableLines: Set<number>
): number[] {
  const coverable = [...coverableLines].sort((a, b) => a - b);
  return expectedLines.filter((expected) => {
    const line = expected + 1;
    if (coverableLines.has(line)) return ranLines.has(line);
    const next = coverable.find((candidate) => candidate > line);
    return next !== undefined && ranLines.has(next);
  });
}

// A test that ran a line, as the environment's per-test coverage says.
export interface LineRunner {
  title: string;
  status: string;
  testId?: string;
}

/**
 * What a hover on a line of a reviewed file says: which of the reviewed
 * tests ran it, each a link (`focusCommand` with the test's node ID) to that
 * test's own review. Undefined when none did.
 */
export function lineHoverMarkdown(
  ran: LineRunner[],
  focusCommand: string
): string | undefined {
  if (ran.length === 0) return undefined;
  const link = (runner: LineRunner) =>
    runner.testId
      ? `[${escapeMarkdown(runner.title)}](command:${focusCommand}?${encodeURIComponent(JSON.stringify([runner.testId]))} "Review this test alone")`
      : escapeMarkdown(runner.title);
  return (
    "**Ran by** " +
    ran
      .map(
        (runner) =>
          link(runner) +
          (runner.status === "partiallyCovered" ? " (partially)" : "")
      )
      .join(", ")
  );
}

// Where a Reqs2X tool's log starts a record, as at info ("ERROR: ...") and at
// debug level ("<time> [ERROR]: ...").
const LOG_RECORD = /^(?:\S+ )?\[?(?:DEBUG|INFO|WARNING|ERROR|CRITICAL)\]?:\s*/;

/**
 * The last error a Reqs2X tool logged, as one line: without its level and the
 * line breaks the console wraps it at, or all of ``stderr`` if it logged none.
 */
export function lastToolError(stderr: string): string {
  const lines = stderr.split("\n");
  const start = lines
    .map((line) => /^(?:\S+ )?\[?ERROR\]?:/.test(line))
    .lastIndexOf(true);
  if (start < 0) return stderr.trim();

  const message = [lines[start].replace(LOG_RECORD, "")];
  for (const line of lines.slice(start + 1)) {
    // A blank line, an indented detail or the next record ends the message.
    if (!line.trim() || /^\s/.test(line) || LOG_RECORD.test(line)) break;
    message.push(line);
  }
  return message.join(" ").replace(/\s+/g, " ").trim();
}
