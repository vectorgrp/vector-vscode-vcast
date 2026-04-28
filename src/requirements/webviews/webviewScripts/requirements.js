// Requirements editor webview script.
//
// State (`window.__rgwState`) is injected as a JSON blob by the extension at
// load time and refreshed on `saved` / `inferred` messages. Listeners are
// delegated on #reqs-body so they survive the innerHTML swap that happens on
// regrouping.
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

  function refreshFunctionOptions(card, selectedUnit, currentFunction) {
    const fnSelect = card.querySelector(
      '[data-scope="trace"][data-field="function"]'
    );
    if (!fnSelect || fnSelect.tagName !== "SELECT") return;
    const map = state.unitsToFunctions || {};
    const fns = selectedUnit && map[selectedUnit] ? map[selectedUnit] : [];
    const desired = currentFunction != null ? String(currentFunction) : "";
    const opts = ['<option value="">(none)</option>'];
    let foundDesired = !desired;
    for (const fn of fns) {
      const sel = fn === desired ? " selected" : "";
      if (fn === desired) foundDesired = true;
      opts.push('<option value="' + fn + '"' + sel + '>' + fn + "</option>");
    }
    if (!foundDesired) {
      opts.push(
        '<option value="' + desired + '" selected>' + desired + " (not in env)</option>"
      );
    }
    fnSelect.innerHTML = opts.join("");
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

  // Event delegation on the cards container so listeners survive innerHTML
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

  saveBtn.addEventListener("click", () => {
    const updates = {
      requirements: JSON.parse(JSON.stringify(state.requirements)),
      traceability: JSON.parse(JSON.stringify(state.traceability)),
    };
    for (const [reqId, patch] of dirty.entries()) {
      if (state.editable && Object.keys(patch.req).length > 0) {
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
    if (typeof msg.body === "string") {
      reqsBody.innerHTML = msg.body;
    }
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
