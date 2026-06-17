// Verification report webview entry. Receives state via
// `window.__reportState` at load time and via { type: "update", state }
// postMessages thereafter. Builds DOM via safe createElement APIs — no
// innerHTML, so finding descriptions can never break out of their slot.
//
// Wire protocol (see src/requirements/verificationReport.ts):
//   FROM webview: { type: "open-source" | "reverify" }
//   TO   webview: { type: "update", state: ReportState }

const vscode = acquireVsCodeApi();

let state = window.__reportState;

const metaEl = document.getElementById("meta");
const summaryEl = document.getElementById("summary");
const bannerEl = document.getElementById("banner");
const bodyEl = document.getElementById("report-body");

document.getElementById("reverify-btn").addEventListener("click", () => {
  vscode.postMessage({ type: "reverify" });
});

bodyEl.addEventListener("click", (event) => {
  const li = event.target && event.target.closest && event.target.closest("li.finding");
  if (!li || li.classList.contains("stale") || li.classList.contains("out-of-sync")) {
    return;
  }
  const file = li.dataset.file;
  const id = li.dataset.id;
  const line = parseInt(li.dataset.line, 10);
  if (file && id && !Number.isNaN(line)) {
    vscode.postMessage({ type: "open-source", file, line, id });
  }
});

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg && msg.type === "update") {
    state = msg.state;
    render();
  }
});

render();

function render() {
  const stale = new Set(state.staleIds);
  const outOfSync = new Set(state.outOfSyncFiles);
  const isOutOfSync = (f) => !!f.target && outOfSync.has(f.target.file);

  const live = state.findings.filter((f) => !stale.has(f.id) && !isOutOfSync(f));
  const staleCount = state.findings.filter((f) => stale.has(f.id)).length;
  const driftCount = state.findings.filter(isOutOfSync).length;
  const groups = groupByFunction(state.findings);

  renderMeta(staleCount, driftCount);
  renderBanner(outOfSync.size > 0);
  renderSummary(live.length, staleCount, driftCount, groups.length);
  renderBody(groups, stale, isOutOfSync);
}

function renderMeta(staleCount, driftCount) {
  while (metaEl.firstChild) metaEl.removeChild(metaEl.firstChild);
  metaEl.appendChild(
    document.createTextNode(`${state.envName} · ran at ${formatTimestamp(state.ranAt)}`)
  );
  if (staleCount > 0) {
    const note = document.createElement("span");
    note.className = "meta-note stale-note";
    note.title =
      "Findings whose source line has been edited since the run. Re-verify to refresh.";
    note.textContent = ` · ${staleCount} stale`;
    metaEl.appendChild(note);
  }
  if (driftCount > 0) {
    const note = document.createElement("span");
    note.className = "meta-note drift-note";
    note.title =
      "Source files modified after the env was built. Rebuild + re-verify for accurate line locations.";
    note.textContent = ` · ${driftCount} out-of-sync`;
    metaEl.appendChild(note);
  }
}

function renderBanner(visible) {
  bannerEl.classList.toggle("visible", visible);
  while (bannerEl.firstChild) bannerEl.removeChild(bannerEl.firstChild);
  if (visible) {
    bannerEl.appendChild(
      document.createTextNode(
        "⚠ One or more source files have been modified since the env was built. Inline highlights are hidden for affected files; rebuild the env and re-verify to refresh line locations."
      )
    );
  }
}

function renderSummary(liveCount, staleCount, driftCount, groupCount) {
  const parts = [
    `${liveCount} live finding${liveCount === 1 ? "" : "s"}`,
  ];
  if (staleCount > 0) parts.push(`${staleCount} stale (edit invalidated)`);
  if (driftCount > 0) parts.push(`${driftCount} out-of-sync (env not rebuilt)`);
  const tail = `across ${groupCount} function${groupCount === 1 ? "" : "s"}.`;
  summaryEl.textContent = `${parts.join(", ")} ${tail}`;
}

function renderBody(groups, stale, isOutOfSync) {
  while (bodyEl.firstChild) bodyEl.removeChild(bodyEl.firstChild);

  if (state.findings.length === 0) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "✓ No issues — requirements match the code.";
    bodyEl.appendChild(p);
    return;
  }

  for (const group of groups) {
    bodyEl.appendChild(renderGroup(group, stale, isOutOfSync));
  }
}

function renderGroup(group, stale, isOutOfSync) {
  const wrap = document.createElement("div");
  wrap.className = "fn-block";

  const h2 = document.createElement("h2");
  h2.appendChild(document.createTextNode(group.function + " "));
  const unitSpan = document.createElement("span");
  unitSpan.className = "unit";
  unitSpan.textContent = `(${group.unit})`;
  h2.appendChild(unitSpan);
  wrap.appendChild(h2);

  const ul = document.createElement("ul");
  ul.className = "findings";
  for (const finding of group.items) {
    ul.appendChild(
      renderFinding(finding, stale.has(finding.id), isOutOfSync(finding))
    );
  }
  wrap.appendChild(ul);
  return wrap;
}

function renderFinding(finding, isStale, isDrift) {
  const li = document.createElement("li");
  li.dataset.kind = finding.kind;
  if (isStale) li.classList.add("finding", "stale");
  else if (isDrift) li.classList.add("finding", "out-of-sync");
  else li.classList.add("finding");

  const target = finding.target;
  if (target && !isStale && !isDrift) {
    li.dataset.file = target.file;
    li.dataset.line = String(target.currentLine);
    li.dataset.id = finding.id;
  }

  if (isStale) {
    li.appendChild(
      makeBadge("stale", "stale-badge", "Source line has changed since the run.")
    );
  }
  if (isDrift) {
    li.appendChild(
      makeBadge(
        "out-of-sync",
        "drift-badge",
        "Source file modified after env was built. Rebuild + re-verify for accurate locations."
      )
    );
  }
  li.appendChild(makeBadge(finding.kind, null, null));

  if (finding.anchor) {
    const anchor = document.createElement("span");
    anchor.className = "anchor";
    anchor.textContent = finding.anchor;
    li.appendChild(anchor);
  }

  const desc = document.createElement("span");
  desc.textContent = finding.description;
  li.appendChild(desc);

  if (target) {
    const loc = document.createElement("span");
    loc.className = "location";
    loc.textContent = `${basename(target.file)}:${target.originalLine}`;
    li.appendChild(loc);
  }
  return li;
}

function makeBadge(text, extraClass, title) {
  const b = document.createElement("span");
  b.className = extraClass ? `badge ${extraClass}` : "badge";
  if (title) b.title = title;
  b.textContent = text;
  return b;
}

function groupByFunction(findings) {
  const out = [];
  const indexByKey = new Map();
  for (const f of findings) {
    const key = `${f.unit}::${f.function}`;
    let idx = indexByKey.get(key);
    if (idx === undefined) {
      idx = out.length;
      indexByKey.set(key, idx);
      out.push({ unit: f.unit, function: f.function, items: [] });
    }
    out[idx].items.push(f);
  }
  return out;
}

function basename(p) {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx === -1 ? p : p.slice(idx + 1);
}

function formatTimestamp(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
