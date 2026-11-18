// What reqs2check says about the code of an environment, and how it is
// worded. Kept free of the vscode module so it can be unit tested.

import { escapeMarkdown } from "./testReviewData";

// 1-based, as an editor counts lines.
export interface SourceLine {
  file: string;
  line: number;
}

export interface Finding {
  // The same from one check to the next, so a dismissed finding stays so.
  id: string;
  // "violation", "undocumented" or "missing"
  kind: string;
  // The requirement a violation or a missing implementation is about
  requirementKey?: string;
  description: string;
}

export interface CheckedFunction {
  unit: string;
  name: string;
  requirements: { key: string; description: string }[];
  findings: Finding[];
  // The code the findings are about; reqs2check may point at none.
  findingLines: SourceLine[];
  // Where the function starts, when its unit's source file was found
  start?: SourceLine;
  checkedAt: number;
  // The code or the requirements changed since the check.
  stale: boolean;
}

// What is known about one environment: each function as it was last checked.
export interface EnvironmentCheck {
  functions: CheckedFunction[];
  // IDs of the findings the user dismissed
  dismissed: string[];
}

// The part of an environment a check covers: all of it, a unit or a function.
export interface CheckScope {
  unit?: string;
  function?: string;
}

const KIND_LABELS: Record<string, string> = {
  violation: "Violates requirement",
  undocumented: "Undocumented behavior",
  missing: "Not implemented",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? "Finding";
}

/**
 * The functions `reqs2check --json --json-events` reported: its output is the
 * progress events, one per line, followed by the result. Throws when the
 * result is not a list.
 */
export function parseReqs2checkOutput(stdout: string): unknown[] {
  const result = stdout
    .split("\n")
    .filter((line) => !line.startsWith('{"event"'))
    .join("\n");
  const functions = JSON.parse(result);
  if (!Array.isArray(functions)) {
    throw new TypeError("reqs2check did not return a list of functions");
  }
  return functions;
}

/** One function of reqs2check's result, as the extension keeps it. */
export function checkedFunctionFrom(
  entry: any,
  checkedAt: number
): CheckedFunction {
  const unit: string = entry.unit ?? "";
  const name: string = entry.function ?? "";
  return {
    unit,
    name,
    requirements: (entry.requirements ?? []).map((requirement: any) => ({
      key: requirement.key ?? "",
      description: requirement.description ?? "",
    })),
    findings: (entry.findings ?? []).map((finding: any) => {
      const kind: string = finding.kind ?? "";
      // What reqs2check itself tells two findings apart by.
      const subject = finding.requirement_key ?? finding.behavior_label ?? "";
      return {
        id: [unit, name, kind, subject].join("|"),
        kind,
        requirementKey: finding.requirement_key ?? undefined,
        description: finding.description ?? "",
      };
    }),
    findingLines: (entry.finding_lines ?? []).filter(
      (location: any) => location?.file && location.line > 0
    ),
    checkedAt,
    stale: false,
  };
}

// Names and paths are compared without case: Ada names may come back in
// another case than the test tree shows them, and a Windows path may differ
// in its drive letter's case.
export const sameIgnoringCase = (a: string, b: string) =>
  a.toLowerCase() === b.toLowerCase();

export function inScope(checked: CheckedFunction, scope: CheckScope): boolean {
  return (
    (!scope.unit || sameIgnoringCase(checked.unit, scope.unit)) &&
    (!scope.function || sameIgnoringCase(checked.name, scope.function))
  );
}

/** Where a function's findings show: the first line they are about. */
export function commentLineOf(
  checked: CheckedFunction
): SourceLine | undefined {
  return checked.findingLines[0] ?? checked.start;
}

// An edit, in 0-based lines: the text it replaced, from the start of
// `startLine` or later up to `endCharacter` of `endLine`, and the text put
// there.
export interface LineEdit {
  startLine: number;
  endLine: number;
  endCharacter: number;
  text: string;
}

/**
 * Where a 0-based line is after edits to its file: an edit that ends before
 * the line starts moves it by the lines the edit added or removed.
 */
export function lineAfterEdits(line: number, edits: LineEdit[]): number {
  return edits
    .filter(
      (edit) =>
        edit.endLine < line ||
        (edit.endLine === line && edit.endCharacter === 0)
    )
    .reduce(
      (moved, edit) =>
        moved +
        (edit.text.split("\n").length - 1) -
        (edit.endLine - edit.startLine),
      line
    );
}

/** Whether the function, or code its findings are about, is in the file. */
export function isInFile(checked: CheckedFunction, file: string): boolean {
  return [checked.start, ...checked.findingLines].some(
    (location) => location && sameIgnoringCase(location.file, file)
  );
}

export function sameFunction(a: CheckedFunction, b: CheckedFunction): boolean {
  return sameIgnoringCase(a.unit, b.unit) && sameIgnoringCase(a.name, b.name);
}

/**
 * The functions known after a check of `scope`: those outside it as they
 * were, those inside it as the check reported them. A function the check no
 * longer reports is gone; one it reports again keeps its place.
 */
export function mergeCheckedFunctions(
  known: CheckedFunction[],
  checked: CheckedFunction[],
  scope: CheckScope
): CheckedFunction[] {
  const recheckedOf = (before: CheckedFunction) =>
    checked.find((candidate) => sameFunction(candidate, before));
  const kept = known.flatMap((before) => {
    if (!inScope(before, scope)) return [before];
    const rechecked = recheckedOf(before);
    return rechecked ? [rechecked] : [];
  });
  const added = checked.filter(
    (candidate) => !known.some((before) => sameFunction(candidate, before))
  );
  return [...kept, ...added];
}

// A requirement as the gateway has it, with the function it is traced to.
export interface TracedRequirement {
  key: string;
  description: string;
  unit: string | null;
  function: string | null;
}

// What a requirements gateway holds, as far as the check is concerned: the
// requirements by source, then key, and where each key is traced to.
export interface GatewayContent {
  requirements: Record<string, Record<string, { description?: string }>>;
  traceability: Record<
    string,
    { unit: string | null; function: string | null }
  >;
}

/** The requirements of a gateway, each with where it is traced to. */
export function tracedRequirements({
  requirements,
  traceability,
}: GatewayContent): TracedRequirement[] {
  return Object.values(requirements).flatMap((source) =>
    Object.entries(source).map(([key, requirement]) => ({
      key,
      description: requirement.description ?? "",
      unit: traceability[key]?.unit ?? null,
      function: traceability[key]?.function ?? null,
    }))
  );
}

/**
 * Whether a function's requirements are no longer what it was checked
 * against: other requirements are traced to it now, or one reads differently.
 */
export function requirementsChanged(
  checked: CheckedFunction,
  current: TracedRequirement[]
): boolean {
  const traced = current.filter(
    (requirement) =>
      sameIgnoringCase(requirement.unit ?? "", checked.unit) &&
      sameIgnoringCase(requirement.function ?? "", checked.name)
  );
  return (
    traced.length !== checked.requirements.length ||
    checked.requirements.some(
      ({ key, description }) =>
        traced.find((requirement) => requirement.key === key)?.description !==
        description
    )
  );
}

/** The findings of a function the user did not dismiss. */
export function openFindings(
  checked: CheckedFunction,
  dismissed: string[]
): Finding[] {
  return checked.findings.filter((finding) => !dismissed.includes(finding.id));
}

// "1 finding", "3 findings"
export function countText(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** "2 violations, 1 undocumented behavior", or "no findings". */
export function findingsSummary(findings: Finding[]): string {
  const count = (kind: string) =>
    findings.filter((finding) => finding.kind === kind).length;
  const known = [
    [count("violation"), "violation"],
    [count("undocumented"), "undocumented behavior"],
    [count("missing"), "missing implementation"],
  ] as const;
  const other = findings.length - known.reduce((sum, [n]) => sum + n, 0);
  const parts = [...known, [other, "other finding"] as const]
    .filter(([n]) => n > 0)
    .map(([n, noun]) => countText(n, noun));
  return parts.length ? parts.join(", ") : "no findings";
}

// How a requirement fared in the check of the function it is traced to.
export interface RequirementCheck {
  status: "implemented" | "violated" | "missing";
  stale: boolean;
  unit: string;
  function: string;
  // What the findings about it say
  details: string[];
}

/**
 * The checked requirements of an environment by key, for the requirements
 * editor. A dismissed finding does not count against its requirement.
 */
export function requirementChecks(
  check: EnvironmentCheck | undefined
): Record<string, RequirementCheck> {
  const checks: Record<string, RequirementCheck> = {};
  for (const checked of check?.functions ?? []) {
    const findings = openFindings(checked, check!.dismissed);
    for (const { key } of checked.requirements) {
      const about = findings.filter(
        (finding) => finding.requirementKey === key
      );
      const kinds = about.map((finding) => finding.kind);
      checks[key] = {
        status: kinds.includes("violation")
          ? "violated"
          : kinds.includes("missing")
            ? "missing"
            : "implemented",
        stale: checked.stale,
        unit: checked.unit,
        function: checked.name,
        details: about.map((finding) => finding.description),
      };
    }
  }
  return checks;
}

/**
 * A finding as a comment in the code: the requirement it is about, quoted,
 * then what reqs2check says.
 */
export function findingMarkdown(
  finding: Finding,
  checked: CheckedFunction
): string {
  const requirement = checked.requirements.find(
    (candidate) => candidate.key === finding.requirementKey
  );
  const quote = requirement
    ? `> ${escapeMarkdown(requirement.description)}\n\n`
    : "";
  return quote + escapeMarkdown(finding.description);
}
