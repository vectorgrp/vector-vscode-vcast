// The page the requirements check reports share: its frame and the look of
// what they have in common (units and functions that fold, counts, marks,
// buttons, the out-of-date banner). Kept free of the vscode module so the
// reports can be unit tested.

import { escapeHtml } from "./testReviewData";

export const AI_DISCLAIMER =
  "AI-generated requirements check. Review before relying on it.";

const SHARED_STYLES = `
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); line-height: 1.5; max-width: 1100px; padding: 0 20px 24px; }
    h1 { font-size: 1.4em; font-weight: 600; margin: 18px 0 2px; }
    .summary-line { color: var(--vscode-descriptionForeground); margin: 0 0 12px; }
    .disclaimer { font-style: italic; }
    summary { cursor: pointer; border-radius: 4px; display: flex; align-items: baseline; gap: 8px; }
    summary::-webkit-details-marker { display: none; }
    summary::before { content: "▸"; flex: none; width: 0.8em; color: var(--vscode-descriptionForeground); }
    details[open] > summary::before { content: "▾"; }
    /* What a header says wraps; its buttons stay at the right of its first line. */
    summary > .heading { flex: 1; min-width: 0; }
    summary > button { flex: none; }
    summary:focus-visible, button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
    details.unit { margin-top: 16px; }
    details.unit > summary { font-size: 1.1em; font-weight: 600; padding: 6px 10px; background: var(--vscode-sideBarSectionHeader-background); border: 1px solid var(--vscode-panel-border); }
    details.function { margin: 6px 0 0 16px; }
    details.function > summary { font-weight: 600; padding: 4px 10px; }
    details.function > summary:hover { background: var(--vscode-list-hoverBackground); }
    section.requirement { margin: 8px 0 8px 24px; }
    section.requirement h4 { font-size: 1em; margin: 8px 0 2px; }
    section.requirement > p { margin: 2px 0; }
    .counts { font-weight: normal; color: var(--vscode-descriptionForeground); }
    .mark.pass, .passed { color: var(--vscode-testing-iconPassed); }
    .mark.fail, .failed { color: var(--vscode-testing-iconFailed); }
    .mark.other { color: var(--vscode-testing-iconQueued); }
    button { font: inherit; font-size: var(--vscode-font-size); font-weight: normal; border: none; border-radius: 2px; padding: 2px 10px; cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .stale-banner { margin: 8px 0 12px; padding: 6px 10px; border: 1px solid var(--vscode-editorWarning-foreground); border-radius: 4px; }
    .stale-banner button { margin-left: 12px; }
    .stale-banner .mark, .stale-tag { color: var(--vscode-editorWarning-foreground); }
    .stale-tag { font-weight: normal; }
`;

const MARKS = { pass: "✔", fail: "✘", other: "•" };

/** A check mark, a cross or a dot, in the test explorer's colors. */
export function markHtml(kind: keyof typeof MARKS): string {
  return `<span class="mark ${kind}">${MARKS[kind]}</span>`;
}

/**
 * A report as a webview page: the shared look plus the report's own
 * `styles`, its `body` and its `script`, which gets `vscode` to post messages
 * with. Inline styles and scripts run under the page's nonce only.
 */
export function reportPageHtml(page: {
  title: string;
  nonce: string;
  cspSource: string;
  styles: string;
  body: string;
  script: string;
}): string {
  const { nonce } = page;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}' ${page.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(page.title)}</title>
  <style nonce="${nonce}">${SHARED_STYLES}${page.styles}</style>
</head>
<body>
  ${page.body}
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
${page.script}
  </script>
</body>
</html>`;
}
