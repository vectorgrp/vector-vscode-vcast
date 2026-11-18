// The report of a requirements check of several tests, grouped by function,
// as a webview page. Kept free of the vscode module so it can be unit tested.

import { AI_DISCLAIMER, markHtml, reportPageHtml } from "./reportPage";
import {
  escapeHtml,
  RequirementData,
  ReviewedTest,
  verdictCounts,
} from "./testReviewData";

// The checked tests of one function. A test's node ID, when known, lets the
// report open the single-test review.
export interface ReportGroup {
  unitName: string;
  functionName: string;
  tests: ReviewedTest[];
}

// "1 passed, 1 failed", passed and failed in the test explorer's colors.
function countsHtml(verdicts: string[]): string {
  const { passed, failed, undecided } = verdictCounts(verdicts);
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

function verdictHtml(verdict: string): string {
  const kind =
    verdict === "PASS" ? "pass" : verdict === "FAIL" ? "fail" : "other";
  return `${markHtml(kind)} ${escapeHtml(verdict)}`;
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

function testHtml(check: ReviewedTest): string {
  const { data } = check;
  const open = check.testId
    ? `<button type="button" class="open" data-test-id="${escapeHtml(check.testId)}">Open review</button>`
    : "";
  return `<details class="test"${check.testId ? ` data-test-id="${escapeHtml(check.testId)}"` : ""}>
  <summary><span class="heading">${verdictHtml(data.verdict)} <span class="name">${escapeHtml(data.title)}</span></span> ${open}</summary>
  ${data.requirements.map(requirementHtml).join("\n")}
</details>`;
}

// A collapsible header for a unit (no function name) or a function, with the
// counts of the tests under it and a button that reviews them together, when
// any of them can be reviewed.
function headerHtml(
  kind: "unit" | "function",
  unitName: string,
  functionName: string | undefined,
  tests: ReviewedTest[],
  body: string
): string {
  const name = functionName ?? unitName;
  const verdicts = tests.map((test) => test.data.verdict);
  const review = tests.some((test) => test.testId)
    ? `<button type="button" class="open group secondary" data-unit="${escapeHtml(unitName)}"${
        functionName ? ` data-function="${escapeHtml(functionName)}"` : ""
      }>Review ${kind}</button>`
    : "";
  return `<details class="${kind}">
  <summary><span class="heading">${escapeHtml(name)} <span class="counts">${countsHtml(verdicts)}</span></span> ${review}</summary>
  ${body}
</details>`;
}

function functionHtml(group: ReportGroup): string {
  return headerHtml(
    "function",
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

  return reportPageHtml({
    title: "Requirements check",
    nonce,
    cspSource,
    styles: `
    .unchecked { cursor: help; text-decoration: underline dotted; }
    details.test { border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin: 8px 0 8px 32px; padding: 4px 10px; }
    .name { font-weight: 600; }
    dt { font-weight: 600; margin-top: 6px; }
    dd { margin: 0 0 0 12px; white-space: pre-wrap; }
    dd ul { margin: 0; padding-left: 18px; }
    details.stale > summary > .heading::after { content: " \u26A0 out of date"; font-weight: normal; color: var(--vscode-editorWarning-foreground); }
`,
    body: `<h1>Requirements check: ${escapeHtml(scope)}</h1>
  <p class="summary-line">${countsHtml(verdicts)}.${uncheckedHtml(unchecked)} <span class="disclaimer">${AI_DISCLAIMER}</span></p>
  ${[...units].map(([unitName, unitGroups]) => unitHtml(unitName, unitGroups)).join("\n")}`,
    script: `    document.addEventListener("click", (event) => {
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
    });`,
  });
}
