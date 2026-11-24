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

// ---- Tests flagged for review -------------------------------------------

// The functions holding the tests of no unit. VectorCAST records them under
// a unit all the same (the one its script named last), so the unit is not
// part of what identifies them.
const NO_UNIT_FUNCTION = /^<<(COMPOUND|INIT)>>$/;

/**
 * What a test is looked up by among the flagged ones. Unit and function
 * names compare case-insensitively, as an Ada name may come back in another
 * case.
 */
export function reviewFlagKey(
  unitName: string,
  functionName: string,
  testName: string
): string {
  const unit = NO_UNIT_FUNCTION.test(functionName) ? "" : unitName;
  return [unit.toLowerCase(), functionName.toLowerCase(), testName].join("\n");
}

/**
 * The tests VectorCAST flags as needing review, from the requirements
 * gateway's record of an environment's tests (its
 * `export_data/<environment>.json`): those linked to a requirement that
 * changed since the test was linked or last marked as reviewed. Maps each
 * (by its `reviewFlagKey`) to the keys of those requirements. The flag is
 * "y" or "n" up to VectorCAST 2026 SP1 and a boolean after.
 */
export function parseReviewFlags(exportData: unknown): Map<string, string[]> {
  const flagged = new Map<string, string[]>();
  if (!exportData || typeof exportData !== "object") return flagged;
  for (const test of Object.values(exportData as Record<string, any>)) {
    if (typeof test?.test_case_name !== "string") continue;
    const changed = Object.entries(test.linked_requirements ?? {})
      .filter(([, link]) => {
        const flag = (link as any)?.needs_review;
        return flag === true || /^(y|yes|true)$/i.test(String(flag));
      })
      .map(([key]) => key);
    if (changed.length === 0) continue;
    flagged.set(
      reviewFlagKey(
        String(test.unit_name ?? ""),
        String(test.subprogram_name ?? ""),
        test.test_case_name
      ),
      changed
    );
  }
  return flagged;
}

/**
 * The tests of an environment whose reviewed mark no longer holds: those
 * VectorCAST flags for review, as a requirement they are linked to changed
 * after they were marked, and those that are gone. `tests` are the
 * environment's tests when its test tree was just built; without it, or
 * while it has none (an environment that failed to load), no test counts as
 * gone. Node IDs throughout; `prefix` starts those of the environment.
 */
export function staleReviewMarks(
  marked: Iterable<string>,
  prefix: string,
  flagged: { has(testId: string): boolean },
  tests?: { has(testId: string): boolean; size: number }
): string[] {
  const known = tests && tests.size > 0 ? tests : undefined;
  return [...marked].filter(
    (testId) =>
      testId.startsWith(prefix) &&
      (flagged.has(testId) || (known !== undefined && !known.has(testId)))
  );
}

// "requirement FR-1", "requirements FR-1 and FR-2", "requirements FR-1, FR-2
// and FR-3"
export function requirementsText(keys: string[]): string {
  const names =
    keys.length < 2
      ? keys.join("")
      : `${keys.slice(0, -1).join(", ")} and ${keys[keys.length - 1]}`;
  return `${keys.length === 1 ? "requirement" : "requirements"} ${names}`;
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
export function escapeMarkdown(text: string): string {
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
const NEEDS_REVIEW_STYLE =
  ' style="color:var(--vscode-editorWarning-foreground);"';

// What the tooltip of "Mark as reviewed" says the mark means: on a test
// VectorCAST flags for review, and on any other.
export const MARK_FLAGGED_TOOLTIP =
  "You checked that this test still fits the changed requirement";
export const MARK_TOOLTIP = "You reviewed this test";
export const UNMARK_TOOLTIP = "Take the reviewed mark back";

// What a review knows of the human review of its tests: those VectorCAST
// flags for review (by node ID, the keys of their changed requirements),
// those marked as reviewed, and the commands (a test's node ID the argument)
// that mark a test as reviewed and take the mark back, for the links on each.
export interface ReviewFlags {
  flagged: Map<string, string[]>;
  reviewed?: Set<string>;
  markCommand?: string;
  unmarkCommand?: string;
}

// A command link's target, with the command's arguments.
export function commandUri(command: string, args: unknown[]): string {
  return `command:${command}?${encodeURIComponent(JSON.stringify(args))}`;
}

// "2026-11-24" for the day, here, of an ISO date and time; empty when it is
// not one.
export function localDay(isoTime: string): string {
  const time = new Date(isoTime);
  if (Number.isNaN(time.getTime())) return "";
  const two = (value: number) => String(value).padStart(2, "0");
  return `${time.getFullYear()}-${two(time.getMonth() + 1)}-${two(time.getDate())}`;
}

// Below a flagged test's name in the group comment's table: that it needs
// review, and for which requirements.
function needsReviewHtml(testId: string | undefined, review: ReviewFlags) {
  const changed = (testId && review.flagged.get(testId)) || [];
  if (!testId || changed.length === 0) return "";
  // Only the first words are colored: a comment never wraps a span.
  return (
    `<br><span${NEEDS_REVIEW_STYLE}>Needs review:</span> ` +
    `${escapeHtml(requirementsText(changed))} changed`
  );
}

// The last cell of a test's row in the group comment's table: that the test
// was reviewed, with the link that takes that back, or the link that marks
// it as reviewed. Empty for a test that is not in the test tree. Its words
// do not break apart, so a narrow editor wraps the test's name instead and
// the row stays one line high.
function reviewedCellHtml(testId: string | undefined, review: ReviewFlags) {
  if (!testId) return "";
  if (review.reviewed?.has(testId) && !review.flagged.has(testId)) {
    const undo = review.unmarkCommand
      ? `&nbsp;&nbsp;<a href="${commandUri(review.unmarkCommand, [testId])}" title="${UNMARK_TOOLTIP}">Undo</a>`
      : "";
    return `<span${VERDICT_STYLES.PASS}>✔&nbsp;Reviewed</span>${undo}`;
  }
  if (!review.markCommand) return "";
  const tooltip = review.flagged.has(testId)
    ? MARK_FLAGGED_TOOLTIP
    : MARK_TOOLTIP;
  return `<a href="${commandUri(review.markCommand, [testId])}" title="${tooltip}">Mark&nbsp;as&nbsp;reviewed</a>`;
}

/**
 * The comment of a function's or unit's review: the counts, then a table
 * with one row per test (its verdict, its name, its requirements' verdicts;
 * fixed column widths, so a long name wraps inside its cell), then what the
 * highlighted lines and the gutter mean for several tests. The table is
 * HTML: a Markdown table gets no column widths in a comment.
 *
 * With `review`, the human review of the tests shows too: how many were
 * reviewed, a last column that says of each test that it was or marks it as
 * reviewed, and below a flagged test's name that it needs review.
 */
export function groupMarkdown(
  title: string,
  tests: ReviewedTest[],
  review?: ReviewFlags
): string {
  const verdicts = tests.map((test) => test.data.verdict);
  const overall = verdicts.includes("FAIL")
    ? "FAIL"
    : verdicts.every((verdict) => verdict === "PASS")
      ? "PASS"
      : "";
  const th = (width: string, text: string) =>
    `<th align="left" width="${width}"${HEADER_STYLE}>${text}</th>`;
  const rows = tests.map(({ testId, data }) => {
    const requirements = data.requirements
      .map((req) => `${mark(req.verdict)} ${escapeHtml(req.key)}`)
      .join("<br>");
    return (
      `<tr><td${VERDICT_STYLES[data.verdict] ?? ""}><b>${mark(data.verdict)} ${escapeHtml(data.verdict)}</b></td>` +
      `<td>${escapeHtml(data.title)}${review ? needsReviewHtml(testId, review) : ""}</td><td>${requirements}</td>` +
      `${review ? `<td>${reviewedCellHtml(testId, review)}</td>` : ""}</tr>`
    );
  });
  // Only a test of the test tree can be marked as reviewed.
  const markable = tests.flatMap((test) => (test.testId ? [test.testId] : []));
  const reviewedCount = markable.filter(
    (testId) => review?.reviewed?.has(testId) && !review.flagged.has(testId)
  ).length;
  const reviewedText =
    review && markable.length
      ? ` &nbsp;&nbsp; ${reviewedCount} of ${markable.length} reviewed`
      : "";
  const header = review
    ? `${th("12%", "Verdict")}${th("44%", "Test")}${th("26%", "Requirements")}${th("18%", "Reviewed")}`
    : `${th("14%", "Verdict")}${th("56%", "Test")}${th("30%", "Requirements")}`;
  return [
    `#### ${mark(overall)} ${escapeMarkdown(title)} &nbsp;&nbsp; ${countVerdicts(verdicts)}${reviewedText}`,
    [
      '<table width="100%">',
      `<thead><tr>${header}</tr></thead>`,
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
      ? `[${escapeMarkdown(runner.title)}](${commandUri(focusCommand, [runner.testId])} "Review this test alone")`
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
