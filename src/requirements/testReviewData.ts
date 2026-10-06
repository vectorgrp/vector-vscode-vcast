// Kept free of the vscode module so the parsing and rendering can be unit tested.

const path = require("path");

export interface Justification {
  verdict: string;
  confidence: string;
  argument: string;
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
          confidence: argument.confidence,
          argument: argument.argument || "",
          caveats: argument.caveats || [],
        }
      : undefined,
  };
}

/**
 * Wraps a single line of text into an array of lines, each <= maxWidth chars
 */
function wrapText(text: string, maxWidth: number): string[] {
  if (text.length <= maxWidth) {
    return [text];
  }

  const lines: string[] = [];
  const words = text.split(" ");
  let current = "";

  for (const word of words) {
    // Word itself is longer than maxWidth — hard break it
    if (word.length > maxWidth) {
      if (current) {
        lines.push(current);
        current = "";
      }
      let remaining = word;
      while (remaining.length > maxWidth) {
        lines.push(remaining.slice(0, maxWidth));
        remaining = remaining.slice(maxWidth);
      }
      current = remaining;
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

/**
 * Creates a formatted text box containing requirement information.
 * Guarantees nothing escapes the box — title and description are both wrapped.
 */
export function createRequirementInfoBox(reqData: RequirementData): string {
  const BOX_WIDTH = 66; // total inner width (between the ║ borders)
  const PADDING = 2; // spaces on each side inside the border
  const TEXT_WIDTH = BOX_WIDTH - PADDING * 2; // usable text width = 62

  const topBorder = "╔" + "═".repeat(BOX_WIDTH) + "╗";
  const midBorder = "╠" + "═".repeat(BOX_WIDTH) + "╣";
  const bottomBorder = "╚" + "═".repeat(BOX_WIDTH) + "╝";
  const divider = "║  " + "─".repeat(TEXT_WIDTH) + "  ║";

  const formatLine = (text = ""): string => {
    // Should never exceed TEXT_WIDTH after wrapping
    const safe = text.length > TEXT_WIDTH ? text.slice(0, TEXT_WIDTH) : text;
    return "║  " + safe.padEnd(TEXT_WIDTH) + "  ║";
  };

  // Wraps a block of text (may contain \n) and returns boxed lines
  const formatBlock = (text: string): string[] => {
    const lines: string[] = [];

    for (const paragraph of text.split(/\r?\n/)) {
      if (!paragraph.trim()) {
        lines.push(formatLine());
        continue;
      }
      for (const wrapped of wrapText(paragraph, TEXT_WIDTH)) {
        lines.push(formatLine(wrapped));
      }
    }

    return lines;
  };

  const justification = reqData.justification;
  const justificationLines = justification
    ? [
        midBorder,
        ...formatBlock(
          `AI JUSTIFICATION: ${justification.verdict} (confidence: ${justification.confidence})`
        ),
        divider,
        ...formatBlock(justification.argument),
        ...justification.caveats.flatMap((caveat) =>
          formatBlock(`- caveat: ${caveat}`)
        ),
      ]
    : [];

  return [
    "",
    topBorder,
    ...formatBlock(reqData.title),
    midBorder,
    formatLine("DESCRIPTION"),
    divider,
    ...formatBlock(reqData.description),
    ...justificationLines,
    bottomBorder,
    "",
  ].join("\n");
}
