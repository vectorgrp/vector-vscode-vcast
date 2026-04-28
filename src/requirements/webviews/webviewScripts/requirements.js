// Requirements editor webview script.
//
// State (`window.__rgwState`) is injected as a JSON blob by the extension at
// load time and refreshed on `saved` / `inferred` messages, which carry a
// `groups` array (typed RequirementGroup[]). The cards section is rebuilt
// from that data using safe DOM APIs (createElement / textContent) — we
// deliberately don't accept pre-built HTML over postMessage.
//
// Wire protocol (see src/requirements/webview/messages.ts):
//   FROM webview: { type: "save" | "infer-traceability" }
//   TO   webview: { type: "saved" | "inferred" | "save-failed" | "infer-failed" | "infer-cancelled" }

(function () {
  const vscode = acquireVsCodeApi();
  const state = window.__rgwState;
  // reqId -> { req: {title?, description?}, trace: {unit?, function?} }
  const dirty = new Map();

  const saveBtn = document.getElementById("save-btn");
  const inferBtn = document.getElementById("infer-btn");
  const reqsBody = document.getElementById("reqs-body");

  function setDirty(reqId, scope, field, value) {
    if (!dirty.has(reqId)) dirty.set(reqId, { req: {}, trace: {} });
    dirty.get(reqId)[scope][field] = value;
    saveBtn.disabled = dirty.size === 0;
    inferBtn.disabled = dirty.size > 0; // don't clobber unsaved local edits
  }

  // ---------- DOM builders ------------------------------------------------

  function buildTraceField(field, current, options, reqId) {
    let el;
    if (!options) {
      el = document.createElement("input");
      el.type = "text";
      el.value = current ?? "";
    } else {
      el = document.createElement("select");
      const noneOpt = document.createElement("option");
      noneOpt.value = "";
      noneOpt.textContent = "(none)";
      if (!current) noneOpt.selected = true;
      el.appendChild(noneOpt);

      let found = !current;
      for (const o of options) {
        const opt = document.createElement("option");
        opt.value = o;
        opt.textContent = o;
        if (o === current) {
          opt.selected = true;
          found = true;
        }
        el.appendChild(opt);
      }
      if (!found) {
        const opt = document.createElement("option");
        opt.value = current;
        opt.textContent = current + " (not in env)";
        opt.selected = true;
        el.appendChild(opt);
      }
    }
    el.dataset.reqId = reqId;
    el.dataset.scope = "trace";
    el.dataset.field = field;
    return el;
  }

  function buildField(label, child) {
    const div = document.createElement("div");
    div.className = "field";
    const lbl = document.createElement("label");
    lbl.textContent = label;
    div.appendChild(lbl);
    div.appendChild(child);
    return div;
  }

  function buildCard(entry) {
    const policy = state.policy;
    const lockedBodies = !policy.bodiesEditable;

    const card = document.createElement("div");
    card.className = "req";

    const header = document.createElement("div");
    header.className = "req-header";
    const id = document.createElement("div");
    id.className = "req-id";
    id.textContent = entry.id;
    const meta = document.createElement("div");
    meta.className = "req-meta";
    const lastMod = entry.req.last_modified ?? "";
    meta.textContent =
      (lastMod ? "modified: " + lastMod + " · " : "") + "source: " + entry.source;
    header.appendChild(id);
    header.appendChild(meta);
    card.appendChild(header);

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.dataset.reqId = entry.id;
    titleInput.dataset.scope = "req";
    titleInput.dataset.field = "title";
    titleInput.value = entry.req.title ?? "";
    if (lockedBodies) titleInput.disabled = true;
    card.appendChild(buildField("Title", titleInput));

    const descArea = document.createElement("textarea");
    descArea.dataset.reqId = entry.id;
    descArea.dataset.scope = "req";
    descArea.dataset.field = "description";
    descArea.value = entry.req.description ?? "";
    if (lockedBodies) descArea.disabled = true;
    card.appendChild(buildField("Description", descArea));

    const traceRow = document.createElement("div");
    traceRow.className = "field trace-row";

    const unitOptions = state.unitsToFunctions
      ? Object.keys(state.unitsToFunctions)
      : null;
    const unitField = buildTraceField(
      "unit",
      entry.trace.unit ?? "",
      unitOptions,
      entry.id
    );

    const fnOptions = state.unitsToFunctions
      ? state.unitsToFunctions[entry.trace.unit ?? ""] ?? []
      : null;
    const fnField = buildTraceField(
      "function",
      entry.trace.function ?? "",
      fnOptions,
      entry.id
    );

    const unitWrap = document.createElement("div");
    const unitLabel = document.createElement("label");
    unitLabel.textContent = "Traceability: unit";
    unitWrap.appendChild(unitLabel);
    unitWrap.appendChild(unitField);

    const fnWrap = document.createElement("div");
    const fnLabel = document.createElement("label");
    fnLabel.textContent = "Traceability: function";
    fnWrap.appendChild(fnLabel);
    fnWrap.appendChild(fnField);

    traceRow.appendChild(unitWrap);
    traceRow.appendChild(fnWrap);
    card.appendChild(traceRow);

    return card;
  }

  function rebuildBody(groups) {
    const frag = document.createDocumentFragment();
    for (const group of groups) {
      const h2 = document.createElement("h2");
      h2.textContent = group.name;
      frag.appendChild(h2);
      for (const entry of group.entries) {
        frag.appendChild(buildCard(entry));
      }
    }
    reqsBody.replaceChildren(frag);
  }

  // ---------- Field-change handling --------------------------------------

  function refreshFunctionOptions(card, selectedUnit, currentFunction) {
    const fnSelect = card.querySelector(
      '[data-scope="trace"][data-field="function"]'
    );
    if (!fnSelect || fnSelect.tagName !== "SELECT") return;
    const map = state.unitsToFunctions || {};
    const fns = selectedUnit && map[selectedUnit] ? map[selectedUnit] : [];
    const desired = currentFunction != null ? String(currentFunction) : "";

    // Rebuild via DOM API rather than innerHTML so we never mix in HTML.
    while (fnSelect.firstChild) fnSelect.removeChild(fnSelect.firstChild);
    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "(none)";
    if (!desired) noneOpt.selected = true;
    fnSelect.appendChild(noneOpt);

    let found = !desired;
    for (const fn of fns) {
      const opt = document.createElement("option");
      opt.value = fn;
      opt.textContent = fn;
      if (fn === desired) {
        opt.selected = true;
        found = true;
      }
      fnSelect.appendChild(opt);
    }
    if (!found) {
      const opt = document.createElement("option");
      opt.value = desired;
      opt.textContent = desired + " (not in env)";
      opt.selected = true;
      fnSelect.appendChild(opt);
    }
  }

  function handleFieldChange(el) {
    const reqId = el.dataset.reqId;
    const scope = el.dataset.scope;
    const field = el.dataset.field;
    let value = el.value;
    if (field === "unit" || field === "function") {
      value = value === "" ? null : value;
    }
    setDirty(reqId, scope, field, value);
    el.classList.add("dirty");

    if (field === "unit") {
      const card = el.closest(".req");
      const dirtyEntry = dirty.get(reqId);
      const currentFn =
        dirtyEntry && dirtyEntry.trace && "function" in dirtyEntry.trace
          ? dirtyEntry.trace.function
          : (state.traceability[reqId] && state.traceability[reqId].function) ||
            null;
      refreshFunctionOptions(card, value, currentFn);
      // function dropdown's value may have changed implicitly; record it
      const fnSelect = card.querySelector(
        '[data-scope="trace"][data-field="function"]'
      );
      if (fnSelect) {
        const newFn = fnSelect.value === "" ? null : fnSelect.value;
        setDirty(reqId, "trace", "function", newFn);
        fnSelect.classList.add("dirty");
      }
    }
  }

  // Event delegation on the cards container so listeners survive children
  // replacement when the body is regrouped after save/infer.
  reqsBody.addEventListener("input", (e) => {
    const t = e.target;
    if (t && t.matches && t.matches("[data-field]") && t.tagName !== "SELECT") {
      handleFieldChange(t);
    }
  });
  reqsBody.addEventListener("change", (e) => {
    const t = e.target;
    if (t && t.matches && t.matches("[data-field]") && t.tagName === "SELECT") {
      handleFieldChange(t);
    }
  });

  // ---------- Save / infer ------------------------------------------------

  saveBtn.addEventListener("click", () => {
    const updates = {
      requirements: JSON.parse(JSON.stringify(state.requirements)),
      traceability: JSON.parse(JSON.stringify(state.traceability)),
    };
    for (const [reqId, patch] of dirty.entries()) {
      if (state.policy.bodiesEditable && Object.keys(patch.req).length > 0) {
        for (const bucket of Object.keys(updates.requirements)) {
          if (updates.requirements[bucket][reqId]) {
            Object.assign(updates.requirements[bucket][reqId], patch.req);
            break;
          }
        }
      }
      if (Object.keys(patch.trace).length > 0) {
        const existing = updates.traceability[reqId] || {
          unit: null,
          function: null,
          lines: null,
        };
        updates.traceability[reqId] = { ...existing, ...patch.trace };
      }
    }
    saveBtn.disabled = true;
    inferBtn.disabled = true;
    vscode.postMessage({
      type: "save",
      updates,
      expectedMtimes: state.mtimes,
    });
  });

  inferBtn.addEventListener("click", () => {
    inferBtn.disabled = true;
    saveBtn.disabled = true;
    vscode.postMessage({ type: "infer-traceability" });
  });

  function applyRefreshedBundle(msg) {
    dirty.clear();
    state.mtimes = msg.mtimes;
    state.requirements = msg.requirements;
    state.traceability = msg.traceability;
    if (Array.isArray(msg.groups)) rebuildBody(msg.groups);
    saveBtn.disabled = true;
    inferBtn.disabled = false;
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "saved" || msg.type === "inferred") {
      applyRefreshedBundle(msg);
    } else if (msg.type === "save-failed") {
      saveBtn.disabled = false;
      inferBtn.disabled = dirty.size > 0;
    } else if (msg.type === "infer-failed" || msg.type === "infer-cancelled") {
      saveBtn.disabled = dirty.size === 0;
      inferBtn.disabled = dirty.size > 0;
    }
  });
})();
