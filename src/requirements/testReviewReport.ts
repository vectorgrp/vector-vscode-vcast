// The report of a requirements check of several tests, grouped by function,
// as a webview page. Kept free of the vscode module so it can be unit tested.

import { RequirementData } from "./testReviewData";

export interface CheckedTest {
  // The test's node in the test tree, when it could be found; it lets the
  // report open the single-test review.
  testId?: string;
  data: RequirementData;
}

// The checked tests of one function.
export interface ReportGroup {
  unitName: string;
  functionName: string;
  tests: CheckedTest[];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// "1 passed, 1 failed", passed and failed in the test explorer's colors.
function countsHtml(verdicts: string[]): string {
  const passed = verdicts.filter((v) => v === "PASS").length;
  const failed = verdicts.filter((v) => v === "FAIL").length;
  const undecided = verdicts.length - passed - failed;
  return [
    `<span class="passed">${passed} passed</span>`,
    `<span class="failed">${failed} failed</span>`,
    ...(undecided ? [`${undecided} undecided`] : []),
  ].join(", ");
}

// "3 tests without a linked requirement were not checked.", when any were,
// naming them on hover.
function uncheckedHtml(unchecked: string[]): string {
  const count = unchecked.length;
  if (count === 0) return "";
  const tests = count === 1 ? "1 test" : `${count} tests`;
  const were = count === 1 ? "was" : "were";
  return ` <span class="unchecked" title="${escapeHtml(unchecked.join("\n"))}">${tests} without a linked requirement ${were} not checked.</span>`;
}

// The verdict with a mark colored like the test explorer's icons.
function verdictHtml(verdict: string): string {
  const kind =
    verdict === "PASS" ? "pass" : verdict === "FAIL" ? "fail" : "other";
  const mark = kind === "pass" ? "✔" : kind === "fail" ? "✘" : "•";
  return `<span class="verdict ${kind}"><span class="mark">${mark}</span> ${escapeHtml(verdict)}</span>`;
}

function requirementHtml(req: RequirementData["requirements"][number]): string {
  const checkedBy = req.checkedBy.length
    ? `<dt>Checked by</dt><dd><ul>${req.checkedBy
        .map((assertion) => `<li><code>${escapeHtml(assertion)}</code></li>`)
        .join("")}</ul></dd>`
    : "";
  return `<section class="requirement">
  <h4>${verdictHtml(req.verdict)}: ${escapeHtml(req.key)}</h4>
  <p>${escapeHtml(req.description)}</p>
  <dl>
    <dt>Checked behavior</dt><dd>${escapeHtml(req.checkedBehavior)}</dd>
    <dt>Explanation</dt><dd>${escapeHtml(req.explanation)}</dd>
    ${checkedBy}
  </dl>
</section>`;
}

function testHtml(check: CheckedTest): string {
  const { data } = check;
  const open = check.testId
    ? `<button type="button" class="open" data-test-id="${escapeHtml(check.testId)}">Open review</button>`
    : "";
  return `<details class="test"${check.testId ? ` data-test-id="${escapeHtml(check.testId)}"` : ""}>
  <summary>${verdictHtml(data.verdict)} <span class="name">${escapeHtml(data.title)}</span> ${open}</summary>
  ${data.requirements.map(requirementHtml).join("\n")}
</details>`;
}

// A collapsible header with the counts of the tests under it and a button
// that reviews them together, when any of them can be reviewed.
function headerHtml(
  kind: "unit" | "function",
  name: string,
  unitName: string,
  functionName: string | undefined,
  tests: CheckedTest[],
  body: string
): string {
  const verdicts = tests.map((test) => test.data.verdict);
  const review = tests.some((test) => test.testId)
    ? `<button type="button" class="open group" data-unit="${escapeHtml(unitName)}"${
        functionName ? ` data-function="${escapeHtml(functionName)}"` : ""
      }>Review ${kind}</button>`
    : "";
  return `<details class="${kind}">
  <summary>${escapeHtml(name)} <span class="counts">${countsHtml(verdicts)}</span> ${review}</summary>
  ${body}
</details>`;
}

function functionHtml(group: ReportGroup): string {
  return headerHtml(
    "function",
    group.functionName,
    group.unitName,
    group.functionName,
    group.tests,
    group.tests.map(testHtml).join("\n")
  );
}

// The functions of one unit, in the order they were reported.
function unitHtml(unitName: string, groups: ReportGroup[]): string {
  return headerHtml(
    "unit",
    unitName,
    unitName,
    undefined,
    groups.flatMap((group) => group.tests),
    groups.map(functionHtml).join("\n")
  );
}

/**
 * The page: the counts and how many tests of the scope were left out, then
 * each unit and, under it, each function, both collapsible, with the checked
 * tests, each with its verdict and, per linked requirement, what the
 * single-test review shows. Everything starts collapsed. "Open review" posts
 * `{ type: "open-review", testId }`; a header's "Review" posts
 * `{ type: "open-group-review", unitName, functionName? }`.
 */
export function checkReportHtml(options: {
  scope: string;
  groups: ReportGroup[];
  // Tests of the scope that tests2check left out: those not linked to a
  // requirement.
  unchecked?: string[];
  nonce: string;
  cspSource: string;
}): string {
  const { scope, groups, unchecked = [], nonce, cspSource } = options;
  const verdicts = groups.flatMap((group) =>
    group.tests.map((test) => test.data.verdict)
  );
  const units = new Map<string, ReportGroup[]>();
  for (const group of groups) {
    units.set(group.unitName, [...(units.get(group.unitName) ?? []), group]);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}' ${cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Requirements check</title>
  <style nonce="${nonce}">
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 16px 16px; }
    h1 { font-size: 1.3em; margin-bottom: 0; }
    .summary-line { color: var(--vscode-descriptionForeground); margin: 4px 0 12px; }
    .disclaimer { color: var(--vscode-descriptionForeground); font-style: italic; }
    .unchecked { cursor: help; text-decoration: underline dotted; }
    details.unit { margin: 18px 0 0; }
    details.unit > summary { font-size: 1.15em; font-weight: 600; padding: 6px 8px; background: var(--vscode-sideBarSectionHeader-background); border: 1px solid var(--vscode-panel-border); border-radius: 4px; cursor: pointer; }
    details.function { margin: 10px 0 0 16px; }
    details.function > summary { font-size: 1.05em; font-weight: 600; padding: 4px 8px; background: var(--vscode-sideBarSectionHeader-background); border-left: 3px solid var(--vscode-panel-border); cursor: pointer; }
    .counts { font-weight: normal; color: var(--vscode-descriptionForeground); margin-left: 8px; }
    details.test { border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin: 8px 0 8px 32px; padding: 4px 10px; }
    details.test > summary { cursor: pointer; }
    .name { font-weight: 600; }
    .verdict.pass .mark { color: var(--vscode-testing-iconPassed); }
    .verdict.fail .mark { color: var(--vscode-testing-iconFailed); }
    .verdict.other .mark { color: var(--vscode-testing-iconQueued); }
    section.requirement { margin: 8px 0 8px 24px; }
    section.requirement h4 { font-size: 1em; margin: 8px 0 2px; }
    dt { font-weight: 600; margin-top: 6px; }
    dd { margin: 0 0 0 12px; white-space: pre-wrap; }
    dd ul { margin: 0; padding-left: 18px; }
    button.open { float: right; margin-left: 8px; border: none; border-radius: 2px; padding: 2px 10px; cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    button.open:hover { background: var(--vscode-button-hoverBackground); }
    button.open.group { font-weight: normal; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    .stale-banner { margin: 8px 0 12px; padding: 6px 10px; border: 1px solid var(--vscode-editorWarning-foreground); border-radius: 4px; }
    .stale-banner .mark, details.stale > summary::after { color: var(--vscode-editorWarning-foreground); }
    details.stale > summary::after { content: " \u26A0 out of date"; font-weight: normal; }
    button.rerun { margin-left: 12px; border: none; border-radius: 2px; padding: 2px 10px; cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background); font: inherit; }
    button.open { font: inherit; font-size: var(--vscode-font-size); }
    .passed { color: var(--vscode-testing-iconPassed); }
    .failed { color: var(--vscode-testing-iconFailed); }
    button.open.group:hover { background: var(--vscode-button-secondaryHoverBackground); }
  </style>
</head>
<body>
  <h1>Requirements check: ${escapeHtml(scope)}</h1>
  <p class="summary-line">${countsHtml(verdicts)}.${uncheckedHtml(unchecked)} <span class="disclaimer">AI-generated requirements check. Review before relying on it.</span></p>
  ${[...units].map(([unitName, unitGroups]) => unitHtml(unitName, unitGroups)).join("\n")}
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.addEventListener("click", (event) => {
      if (event.target.closest("button.rerun")) {
        vscode.postMessage({ type: "rerun" });
        return;
      }
      const button = event.target.closest("button.open");
      if (!button) return;
      event.preventDefault();
      if (button.classList.contains("group")) {
        vscode.postMessage({
          type: "open-group-review",
          unitName: button.dataset.unit,
          functionName: button.dataset.function,
        });
      } else {
        vscode.postMessage({ type: "open-review", testId: button.dataset.testId });
      }
    });
    // The extension says which checked tests changed since the check: a
    // banner with a re-run button, and a mark on those tests and their headers.
    window.addEventListener("message", (event) => {
      const message = event.data;
      if (!message || message.type !== "stale") return;
      let count = 0;
      for (const testId of message.testIds) {
        const row = document.querySelector('details.test[data-test-id="' + CSS.escape(testId) + '"]');
        if (!row) continue;
        count += 1;
        row.classList.add("stale");
        row.closest("details.function")?.classList.add("stale");
        row.closest("details.unit")?.classList.add("stale");
      }
      if (count === 0) return;
      let banner = document.getElementById("stale-banner");
      if (!banner) {
        banner = document.createElement("p");
        banner.id = "stale-banner";
        banner.className = "stale-banner";
        document.querySelector("h1").insertAdjacentElement("afterend", banner);
      }
      banner.textContent = "";
      const mark = document.createElement("span");
      mark.className = "mark";
      mark.textContent = "\u26A0 ";
      const text = document.createTextNode("Out of date: " + count + (count === 1 ? " test" : " tests") + " changed since this check.");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "rerun";
      button.textContent = "Re-run check";
      banner.append(mark, text, button);
    });
  </script>
</body>
</html>`;
}
