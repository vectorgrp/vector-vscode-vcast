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

/**
 * Turns one test's entry from `tests2check --json` into what the review shows.
 * Lines from tests2check are 0-based.
 */
export function parseTests2checkResult(
  testResult: any,
  testName: string,
  unitName: string,
  functionStartLine: number
): RequirementData {
  // A tests2check that leaves a field out or null must not break the review.
  const expectedCoverage = testResult.expected_coverage ?? {};

  // A test can be linked to several requirements: expect the lines of all of them.
  const expectedLines: number[] = [];
  const ranLines: number[] = [];
  for (const locations of Object.values(expectedCoverage)) {
    for (const location of locations as any[]) {
      if (location.unit === unitName) {
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

/**
 * The 1-based lines a requirements check colors: only the code the requirement
 * needs, green where the test ran it and red where it did not. Every other line
 * the test ran shows in the coverage gutter only.
 */
export function reviewLineColors(reqData: RequirementData): {
  covered: number[];
  uncovered: number[];
} {
  const ran = new Set(reqData.ranLines);
  const covered: number[] = [];
  const uncovered: number[] = [];
  for (const line of [...new Set(reqData.expectedLines)].sort(
    (a, b) => a - b
  )) {
    (ran.has(line) ? covered : uncovered).push(line + 1);
  }
  return { covered, uncovered };
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
