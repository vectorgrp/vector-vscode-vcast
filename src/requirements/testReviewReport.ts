// The report of a requirements check of several tests, grouped by function,
// as a webview page. Kept free of the vscode module so it can be unit tested.

import {
  escapeHtml,
  MARK_FLAGGED_TOOLTIP,
  MARK_TOOLTIP,
  RequirementData,
  ReviewedTest,
  UNMARK_TOOLTIP,
  verdictCounts,
} from "./testReviewData";

// The checked tests of one function. A test's node ID, when known, lets the
// report open the single-test review.
export interface ReportGroup {
  unitName: string;
  functionName: string;
  tests: ReviewedTest[];
}

// Which of the report's tests VectorCAST flags for review (by node ID, the
// keys of their changed requirements), and which are marked as reviewed (by
// node ID, the day they were). The page shows it when it loads and again on
// each `{ type: "review-status", ...status }` message.
export interface ReportReviewStatus {
  needsReview: Record<string, string[]>;
  reviewed: Record<string, string>;
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

// A verdict's CSS class and mark, colored like the test explorer's icons.
const VERDICT_MARKS: Record<string, [kind: string, mark: string]> = {
  PASS: ["pass", "✔"],
  FAIL: ["fail", "✘"],
};

function verdictHtml(verdict: string): string {
  const [kind, mark] = VERDICT_MARKS[verdict] ?? ["other", "•"];
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

// A row's or header's line: what it is about (`title`), which wraps in a
// narrow page, and its buttons (`actions`), which stay together at the right
// and move below the title as one when there is no room beside it.
function summaryHtml(title: string, actions: string): string {
  return `<summary><span class="title">${title}</span>${
    actions ? `<span class="actions">${actions}</span>` : ""
  }</summary>`;
}

// A test found in the test tree can be marked as reviewed: its row has the
// button that does, which says so once it is and then takes the mark back,
// and the place for VectorCAST's flag that the test needs review.
function testHtml(check: ReviewedTest): string {
  const { data } = check;
  const testId = check.testId ? escapeHtml(check.testId) : undefined;
  // A long name wraps after an underscore rather than inside a word.
  const name = escapeHtml(data.title).replace(/_/g, "_<wbr>");
  const title = `${verdictHtml(data.verdict)} <span class="name">${name}</span>`;
  const summary = testId
    ? summaryHtml(
        `${title} <span class="review-flag"></span>`,
        `<button type="button" class="mark-reviewed" data-test-id="${testId}" title="${MARK_TOOLTIP}">Mark as reviewed</button><button type="button" class="open" data-test-id="${testId}">Open review</button>`
      )
    : summaryHtml(title, "");
  return `<details class="test"${testId ? ` data-test-id="${testId}"` : ""}>
  ${summary}
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
    ? `<button type="button" class="open group" data-unit="${escapeHtml(unitName)}"${
        functionName ? ` data-function="${escapeHtml(functionName)}"` : ""
      }>Review ${kind}</button>`
    : "";
  return `<details class="${kind}">
  ${summaryHtml(
    `<span class="label">${escapeHtml(name)}</span> <span class="counts">${countsHtml(verdicts)}</span> <span class="reviewed-count"></span> <span class="review-count"></span>`,
    review
  )}
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
 *
 * Each test of the test tree has a "Mark as reviewed" button, which posts
 * `{ type: "mark-reviewed", testIds }`; on a marked test it reads "Reviewed"
 * and posts `{ type: "unmark-reviewed", testIds }`. The headers count the
 * reviewed tests under them. A test VectorCAST flags for review says so, as
 * do the headers above it and a banner at the top, whose button marks all of
 * them.
 */
export function checkReportHtml(options: {
  scope: string;
  groups: ReportGroup[];
  // Tests of the scope that tests2check left out: those not linked to a
  // requirement.
  unchecked?: string[];
  reviewStatus?: ReportReviewStatus;
  nonce: string;
  cspSource: string;
}): string {
  const { scope, groups, unchecked = [], nonce, cspSource } = options;
  const reviewStatus: ReportReviewStatus = options.reviewStatus ?? {
    needsReview: {},
    reviewed: {},
  };
  // Inside a script, "<" could end it.
  const initialReviewStatus = JSON.stringify(reviewStatus).replace(
    /</g,
    "\\u003c"
  );
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
    summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; list-style: none; cursor: pointer; }
    summary::-webkit-details-marker { display: none; }
    summary::before { content: ""; flex: none; align-self: flex-start; margin: 0.42em 2px 0 0; border-style: solid; border-width: 0.3em 0 0.3em 0.5em; border-color: transparent transparent transparent currentColor; opacity: 0.8; }
    details[open] > summary::before { transform: rotate(90deg); }
    summary .title { flex: 1 1 14em; min-width: 0; overflow-wrap: anywhere; }
    details.test > summary .title { flex-basis: 28em; }
    summary .actions { flex: none; display: flex; gap: 8px; margin-left: auto; white-space: nowrap; }
    details.unit { margin: 18px 0 0; }
    details.unit > summary { font-size: 1.15em; font-weight: 600; padding: 6px 8px; background: var(--vscode-sideBarSectionHeader-background); border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
    details.function { margin: 10px 0 0 16px; }
    details.function > summary { font-size: 1.05em; font-weight: 600; padding: 4px 8px; background: var(--vscode-sideBarSectionHeader-background); border-left: 3px solid var(--vscode-panel-border); }
    .counts { font-weight: normal; color: var(--vscode-descriptionForeground); }
    .label, .counts, .reviewed-count { margin-right: 8px; }
    .counts, .reviewed-count, .review-count { display: inline-block; white-space: nowrap; }
    details.test { border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin: 8px 0 8px 32px; padding: 4px 10px; }
    .name { font-weight: 600; }
    .verdict.pass .mark { color: var(--vscode-testing-iconPassed); }
    .verdict.fail .mark { color: var(--vscode-testing-iconFailed); }
    .verdict.other .mark { color: var(--vscode-testing-iconQueued); }
    section.requirement { margin: 8px 0 8px 24px; }
    section.requirement h4 { font-size: 1em; margin: 8px 0 2px; }
    dt { font-weight: 600; margin-top: 6px; }
    dd { margin: 0 0 0 12px; white-space: pre-wrap; }
    dd ul { margin: 0; padding-left: 18px; }
    button.open { border: none; border-radius: 2px; padding: 2px 10px; cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    button.open:hover { background: var(--vscode-button-hoverBackground); }
    button.open.group { font-weight: normal; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    .stale-banner { margin: 8px 0 12px; padding: 6px 10px; border: 1px solid var(--vscode-editorWarning-foreground); border-radius: 4px; }
    .stale-banner .mark, details.stale > summary .title::after { color: var(--vscode-editorWarning-foreground); }
    details.stale > summary .title::after { content: " \u26A0 out of date"; font-weight: normal; white-space: nowrap; }
    button.rerun { margin-left: 12px; border: none; border-radius: 2px; padding: 2px 10px; cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background); font: inherit; }
    button.open { font: inherit; font-size: var(--vscode-font-size); }
    .passed { color: var(--vscode-testing-iconPassed); }
    .failed { color: var(--vscode-testing-iconFailed); }
    button.open.group:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .review-flag { display: inline-block; white-space: nowrap; margin-left: 4px; padding: 0 7px; border: 1px solid currentColor; border-radius: 9px; font-size: 0.85em; font-weight: normal; }
    .review-flag:empty, .review-count:empty, .reviewed-count:empty { display: none; }
    .review-flag, .review-count, .review-banner .mark { color: var(--vscode-editorWarning-foreground); }
    .review-count, .reviewed-count { font-weight: normal; }
    .reviewed-count { color: var(--vscode-descriptionForeground); }
    .reviewed-count.all { color: var(--vscode-testing-iconPassed); }
    button.mark-reviewed { min-width: 9.8em; border: 1px solid transparent; border-radius: 2px; padding: 1px 10px; cursor: pointer; font: inherit; font-size: var(--vscode-font-size); color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button.mark-reviewed:hover { background: var(--vscode-button-secondaryHoverBackground); }
    details.reviewed > summary button.mark-reviewed { color: var(--vscode-testing-iconPassed); background: transparent; border-color: currentColor; }
    details.reviewed > summary button.mark-reviewed:hover { background: var(--vscode-toolbar-hoverBackground); }
    .review-banner { margin: 8px 0 12px; padding: 6px 10px; border: 1px solid var(--vscode-editorWarning-foreground); border-radius: 4px; }
    .review-banner button.mark-reviewed { min-width: 0; margin-left: 12px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    .review-banner button.mark-reviewed:hover { background: var(--vscode-button-hoverBackground); }
  </style>
</head>
<body>
  <h1>Requirements check: ${escapeHtml(scope)}</h1>
  <p class="summary-line">${countsHtml(verdicts)}.${uncheckedHtml(unchecked)} <span class="disclaimer">AI-generated requirements check. Review before relying on it.</span></p>
  <p id="review-banner" class="review-banner" hidden><span class="mark">\u26A0 </span><span class="text"></span><button type="button" class="mark-reviewed"></button></p>
  ${[...units].map(([unitName, unitGroups]) => unitHtml(unitName, unitGroups)).join("\n")}
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.addEventListener("click", (event) => {
      if (event.target.closest("button.rerun")) {
        vscode.postMessage({ type: "rerun" });
        return;
      }
      // A test's "Mark as reviewed" marks that test, or takes its mark
      // back; the banner's marks every flagged test of the report.
      const mark = event.target.closest("button.mark-reviewed");
      if (mark) {
        event.preventDefault();
        const flagged = [...document.querySelectorAll("details.test.needs-review")];
        const row = mark.closest("details.test");
        vscode.postMessage({
          type: row && row.classList.contains("reviewed") ? "unmark-reviewed" : "mark-reviewed",
          testIds: mark.dataset.testId
            ? [mark.dataset.testId]
            : flagged.map((row) => row.dataset.testId),
        });
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
    // Which tests were reviewed and which need review: each test's button
    // marks it as reviewed or, once it is, says so and takes that back; a
    // flagged test says that it needs review; the headers count both, and a
    // banner marks all flagged tests.
    function showReviewStatus(status) {
      const needsReview = status.needsReview || {};
      const reviewed = status.reviewed || {};
      for (const row of document.querySelectorAll("details.test[data-test-id]")) {
        const changed = needsReview[row.dataset.testId];
        const marked = !changed && Object.prototype.hasOwnProperty.call(reviewed, row.dataset.testId);
        row.classList.toggle("needs-review", !!changed);
        row.classList.toggle("reviewed", marked);
        const flag = row.querySelector(".review-flag");
        flag.textContent = changed ? "needs review" : "";
        flag.title = changed ? "Changed since this test was last reviewed: " + changed.join(", ") : "";
        const button = row.querySelector("button.mark-reviewed");
        const day = marked ? reviewed[row.dataset.testId] : "";
        button.textContent = marked ? "\u2714 Reviewed" : "Mark as reviewed";
        button.title = marked
          ? "You marked this test as reviewed" + (day ? " on " + day : "") + ". ${UNMARK_TOOLTIP}."
          : changed ? "${MARK_FLAGGED_TOOLTIP}" : "${MARK_TOOLTIP}";
      }
      const needing = (count) => count === 1 ? "1 test needs review" : count + " tests need review";
      for (const header of document.querySelectorAll("details.unit, details.function")) {
        const count = header.querySelectorAll("details.test.needs-review").length;
        header.querySelector(":scope > summary .review-count").textContent = count ? needing(count) : "";
        const markable = header.querySelectorAll("details.test[data-test-id]").length;
        const done = header.querySelectorAll("details.test.reviewed").length;
        const progress = header.querySelector(":scope > summary .reviewed-count");
        progress.textContent = markable ? done + " of " + markable + " reviewed" : "";
        progress.classList.toggle("all", markable > 0 && done === markable);
      }
      const total = document.querySelectorAll("details.test.needs-review").length;
      const banner = document.getElementById("review-banner");
      banner.hidden = total === 0;
      banner.querySelector(".text").textContent = needing(total) + ": a requirement " +
        (total === 1 ? "it is" : "they are") + " linked to changed. Check that " +
        (total === 1 ? "it still fits" : "they still fit") + " it.";
      banner.querySelector("button").textContent = total === 1 ? "Mark as reviewed" : "Mark all " + total + " as reviewed";
    }
    showReviewStatus(${initialReviewStatus});
    // The extension says which checked tests changed since the check: a
    // banner with a re-run button, and a mark on those tests and their headers.
    window.addEventListener("message", (event) => {
      const message = event.data;
      if (message && message.type === "review-status") showReviewStatus(message);
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
