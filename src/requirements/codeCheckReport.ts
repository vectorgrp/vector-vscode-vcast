// The report of a check of the code against the requirements: every checked
// function of an environment, by unit, as a webview page. Kept free of the
// vscode module so it can be unit tested.

import {
  CheckedFunction,
  commentLineOf,
  countText,
  EnvironmentCheck,
  Finding,
  findingsSummary,
  kindLabel,
  openFindings,
} from "./codeCheckData";
import { AI_DISCLAIMER, markHtml, reportPageHtml } from "./reportPage";
import { escapeHtml } from "./testReviewData";

const STALE_TAG = '<span class="stale-tag">⚠ out of date</span>';

// A button posts its data attributes: `{ type: <action>, unit?, function?, id? }`.
function buttonHtml(
  action: string,
  label: string,
  data: Record<string, string> = {},
  secondary = false
): string {
  const attributes = Object.entries(data)
    .map(([name, value]) => ` data-${name}="${escapeHtml(value)}"`)
    .join("");
  return `<button type="button"${secondary ? ' class="secondary"' : ""} data-action="${action}"${attributes}>${label}</button>`;
}

function findingHtml(finding: Finding, dismissed: string[]): string {
  const isDismissed = dismissed.includes(finding.id);
  const button = isDismissed
    ? buttonHtml("restore", "Restore", { id: finding.id }, true)
    : buttonHtml("dismiss", "Dismiss", { id: finding.id }, true);
  return `<p class="finding${isDismissed ? " dismissed" : ""}">
  <span class="kind ${escapeHtml(finding.kind)}">${kindLabel(finding.kind)}</span>
  <span class="description">${escapeHtml(finding.description)}</span>
  ${button}
</p>`;
}

// A requirement with the findings about it, or a check mark when the
// function implements it as far as the check can tell.
function requirementHtml(
  requirement: CheckedFunction["requirements"][number],
  findings: Finding[],
  dismissed: string[]
): string {
  const failed = findings.some((finding) => !dismissed.includes(finding.id));
  return `<section class="requirement">
  <h4>${markHtml(failed ? "fail" : "pass")} ${escapeHtml(requirement.key)}</h4>
  <p>${escapeHtml(requirement.description)}</p>
  ${findings.map((finding) => findingHtml(finding, dismissed)).join("\n")}
</section>`;
}

// A function: its requirements, each with its findings, then the findings
// about no requirement of it (behavior that none describes).
function functionHtml(checked: CheckedFunction, dismissed: string[]): string {
  const open = openFindings(checked, dismissed);
  const keys = checked.requirements.map((requirement) => requirement.key);
  const aboutNone = checked.findings.filter(
    (finding) => !keys.includes(finding.requirementKey ?? "")
  );
  const names = { unit: checked.unit, function: checked.name };
  return `<details class="function" data-id="${escapeHtml(`${checked.unit}|${checked.name}`)}"${open.length ? " open" : ""}>
  <summary><span class="heading">${markHtml(open.length ? "fail" : "pass")} ${escapeHtml(checked.name)} <span class="counts">${findingsSummary(open)}</span> ${checked.stale ? STALE_TAG : ""}</span>
    ${buttonHtml("recheck", "Check again", names, true)}${commentLineOf(checked) ? buttonHtml("show", "Show in code", names, open.length === 0) : ""}</summary>
  ${checked.requirements
    .map((requirement) =>
      requirementHtml(
        requirement,
        checked.findings.filter(
          (finding) => finding.requirementKey === requirement.key
        ),
        dismissed
      )
    )
    .join("\n")}
  ${aboutNone.map((finding) => findingHtml(finding, dismissed)).join("\n")}
</details>`;
}

function unitHtml(
  unit: string,
  functions: CheckedFunction[],
  dismissed: string[]
): string {
  const open = functions.flatMap((checked) => openFindings(checked, dismissed));
  return `<details class="unit" data-id="${escapeHtml(unit)}" open>
  <summary><span class="heading">${escapeHtml(unit)} <span class="counts">${countText(functions.length, "function")}, ${findingsSummary(open)}</span></span></summary>
  ${functions.map((checked) => functionHtml(checked, dismissed)).join("\n")}
</details>`;
}

/**
 * The page: what was found in all, then each unit and under it each checked
 * function with its requirements and findings; a function with findings
 * starts unfolded. The page is rendered anew whenever the check changes, so
 * it remembers what the user folded and how far they scrolled.
 */
export function codeCheckReportHtml(options: {
  enviroName: string;
  check: EnvironmentCheck;
  nonce: string;
  cspSource: string;
}): string {
  const { enviroName, check, nonce, cspSource } = options;
  const { functions, dismissed } = check;
  const units = new Map<string, CheckedFunction[]>();
  for (const checked of functions) {
    units.set(checked.unit, [...(units.get(checked.unit) ?? []), checked]);
  }
  const open = functions.flatMap((checked) => openFindings(checked, dismissed));
  const dismissedCount =
    functions.flatMap((checked) => checked.findings).length - open.length;
  const staleCount = functions.filter((checked) => checked.stale).length;
  const staleBanner = staleCount
    ? `<p class="stale-banner"><span class="mark">⚠</span> Out of date: the code or the requirements of ${countText(staleCount, "function")} changed since the check.</p>`
    : "";

  return reportPageHtml({
    title: "Code against requirements",
    nonce,
    cspSource,
    styles: `
    .actions button { margin-right: 8px; padding: 4px 12px; }
    /* The actions of a row show while it is pointed at or has the focus; a
       function with findings always offers its code. */
    details.function > summary button.secondary { opacity: 0; }
    details.function > summary:hover button, details.function > summary:focus-within button { opacity: 1; }
    .finding { display: flex; align-items: baseline; gap: 8px; margin: 6px 0; }
    .finding .description { flex: 1; }
    .finding.dismissed .description { color: var(--vscode-disabledForeground); text-decoration: line-through; }
    .finding.dismissed .kind { opacity: 0.5; }
    .kind { flex: none; border: 1px solid; border-radius: 10px; padding: 0 8px; font-size: 0.85em; white-space: nowrap; }
    .kind.violation, .kind.missing { color: var(--vscode-editorError-foreground); }
    .kind.undocumented { color: var(--vscode-editorWarning-foreground); }
    details.function > .finding { margin-left: 24px; }
`,
    body: `<h1>Code against requirements: ${escapeHtml(enviroName)}</h1>
  <p class="summary-line">${countText(functions.length, "function")} checked: ${findingsSummary(open)}${dismissedCount ? `, ${dismissedCount} dismissed` : ""}. <span class="disclaimer">${AI_DISCLAIMER}</span></p>
  <p class="actions">${buttonHtml("recheck", "Check all again")}${buttonHtml("clear", "Clear", {}, true)}</p>
  ${staleBanner}
  ${[...units].map(([unit, checked]) => unitHtml(unit, checked, dismissed)).join("\n")}`,
    script: `    document.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      // A button in a header must not fold what it heads.
      event.preventDefault();
      const { action, ...data } = button.dataset;
      vscode.postMessage({ type: action, ...data });
    });

    const view = vscode.getState() ?? { open: {}, scroll: 0 };
    for (const details of document.querySelectorAll("details[data-id]")) {
      const id = details.dataset.id;
      if (id in view.open) details.open = view.open[id];
      details.addEventListener("toggle", () => {
        view.open[id] = details.open;
        vscode.setState(view);
      });
    }
    window.scrollTo(0, view.scroll);
    window.addEventListener("scroll", () => {
      view.scroll = window.scrollY;
      vscode.setState(view);
    });`,
  });
}
