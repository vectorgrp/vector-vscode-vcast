// Kept free of the vscode module so the parsing and rendering can be unit tested.

const path = require("path");

export interface Justification {
  verdict: string;
  argument: string;
  checkingAssertions: string[];
  caveats: string[];
}

export interface RequirementData {
  title: string;
  description: string;
  lineNumber: number;
  importantLineStart: number;
  importantLineEnd: number;
  expectedLines: number[];
  actualLines: number[];
  justification?: Justification;
}

/**
 * Turns one test's entry from `tests2check --json` into what the review shows.
 * Lines from tests2check are 0-based.
 */
export function parseTests2checkResult(
  testResult: any,
  testName: string,
  unitName: string,
  notes: string,
  functionStartLine: number
): RequirementData {
  const expectedCoverage = testResult.expected_coverage || {};
  const actualCoverage = testResult.actual_coverage || [];

  const unitCoverage = actualCoverage.find((cov: any) => {
    const covUnitBase = path.basename(cov.unit, path.extname(cov.unit));
    return covUnitBase === unitName || cov.unit === unitName;
  });

  // A test can be linked to several requirements: expect the lines of all of them.
  const expectedLines: number[] = [];
  for (const locations of Object.values(expectedCoverage)) {
    for (const location of locations as any[]) {
      if (location.unit === unitName) expectedLines.push(...location.lines);
    }
  }

  const minLine = expectedLines.length ? Math.min(...expectedLines) : 0;
  const maxLine = expectedLines.length ? Math.max(...expectedLines) : 0;

  const argument = testResult.argument;
  return {
    title: testResult.name || testName,
    description: notes,
    lineNumber: functionStartLine,
    importantLineStart: minLine + 1,
    importantLineEnd: maxLine + 1,
    expectedLines,
    actualLines: unitCoverage?.lines || [],
    // Only present when tests2check ran with --justification.
    justification: argument
      ? {
          verdict: argument.verdict,
          argument: argument.argument || "",
          checkingAssertions: argument.checking_assertions || [],
          caveats: argument.caveats || [],
        }
      : undefined,
  };
}

/**
 * The 1-based lines a review colors within the requirement's span: green where
 * the test ran the line, red where the line is expected but the test missed it.
 */
export function reviewLineColors(reqData: RequirementData): {
  covered: number[];
  uncovered: number[];
} {
  const actual = new Set(reqData.actualLines.map((line) => line + 1));
  const expected = new Set(reqData.expectedLines.map((line) => line + 1));
  const covered: number[] = [];
  const uncovered: number[] = [];
  for (
    let line = reqData.importantLineStart;
    line <= reqData.importantLineEnd;
    line++
  ) {
    if (actual.has(line)) covered.push(line);
    else if (expected.has(line)) uncovered.push(line);
  }
  return { covered, uncovered };
}

const VERDICT_ICONS: Record<string, string> = {
  Exercises: "pass",
  Partially: "warning",
  "Does not": "error",
  Inconclusive: "question",
};

// Text from the test or tests2check must not be read as Markdown or icons.
function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-!~|<>$]/g, "\\$&");
}

/**
 * The review comment: the verdict, its argument, the assertions that check the
 * outcome and the caveats when tests2check judged the test, then the test's
 * description.
 */
export function reviewMarkdown(reqData: RequirementData): string {
  const parts: string[] = [];
  const justification = reqData.justification;
  if (justification) {
    const icon = VERDICT_ICONS[justification.verdict] ?? "info";
    parts.push(
      `#### $(${icon}) Verdict: ${escapeMarkdown(justification.verdict)}`,
      escapeMarkdown(justification.argument)
    );
    if (justification.checkingAssertions.length) {
      const names = justification.checkingAssertions.map((n) => `- \`${n}\``);
      parts.push(`**Checked by**\n\n${names.join("\n")}`);
    }
    if (justification.caveats.length) {
      const caveats = justification.caveats.map(
        (c) => `- ${escapeMarkdown(c)}`
      );
      parts.push(`**Caveats**\n\n${caveats.join("\n")}`);
    }
  }
  parts.push(
    "**Test description**",
    escapeMarkdown(reqData.description) || "_None_"
  );
  return parts.join("\n\n");
}
