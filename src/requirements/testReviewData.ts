// Kept free of the vscode module so the parsing and rendering can be unit tested.

export interface Justification {
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
  justification: Justification;
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
  const expectedCoverage = testResult.expected_coverage || {};

  // A test can be linked to several requirements: expect the lines of all of them.
  const expectedLines: number[] = [];
  const ranLines: number[] = [];
  for (const locations of Object.values(expectedCoverage)) {
    for (const location of locations as any[]) {
      if (location.unit === unitName) {
        expectedLines.push(...location.lines);
        ranLines.push(...location.ran_lines);
      }
    }
  }

  return {
    title: testResult.name || testName,
    lineNumber: functionStartLine,
    expectedLines,
    ranLines,
    justification: {
      verdict: testResult.verdict,
      checkedBehavior: testResult.checked_behavior,
      explanation: testResult.explanation,
      checkedBy: testResult.checked_by,
    },
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

const VERDICT_ICONS: Record<string, string> = {
  PASS: "pass",
  FAIL: "error",
};

// Text from the test or tests2check must not be read as Markdown or icons.
function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-!~|<>$]/g, "\\$&");
}

/**
 * The requirements check comment: the verdict, then the same labelled blocks
 * tests2check prints (the checked behavior, the explanation and the checking
 * assertions), then what the highlighted lines mean.
 */
export function reviewMarkdown(reqData: RequirementData): string {
  const justification = reqData.justification;
  const icon = VERDICT_ICONS[justification.verdict] ?? "info";
  const parts = [
    `#### $(${icon}) Verdict: ${escapeMarkdown(justification.verdict)}`,
    `**Checked behavior**\n\n${escapeMarkdown(justification.checkedBehavior)}`,
    `**Explanation**\n\n${escapeMarkdown(justification.explanation)}`,
  ];
  if (justification.checkedBy.length) {
    const names = justification.checkedBy.map((n) => `- \`${n}\``);
    parts.push(`**Checked by**\n\n${names.join("\n")}`);
  }
  parts.push(
    "**Highlighted lines**\n\nThe code the requirement needs: green where this " +
      "test ran it, red where it did not. The gutter shows this test's coverage " +
      "of the whole file."
  );
  return parts.join("\n\n");
}
