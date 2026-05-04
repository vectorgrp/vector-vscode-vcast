// Requirements editor webview script.
//
// State (`window.__rgwState`) is injected as a JSON blob by the extension at
// load time and refreshed on `saved` / `inferred` messages, which carry a
// `groups` array (typed RequirementGroup[]). The cards section is rebuilt
// from that data using safe DOM APIs (createElement / textContent).
//
// Wire protocol (see src/requirements/webview/messages.ts):
//   FROM webview: { type: "save" | "infer-traceability" }
//   TO   webview: { type: "saved" | "inferred" | "save-failed" | "infer-failed" | "infer-cancelled" }

(function () {
  const vscode = acquireVsCodeApi();
  const state = window.__rgwState;

  // Pending edits split three ways:
  //   dirty   — in-place edits to existing requirements (key -> {req, trace})
  //   removed — keys of existing requirements marked for soft-deletion
  //   added   — pending new requirements not yet on disk
  // All three flush on Save and reset on a successful saved/inferred.
  const dirty = new Map();
  const removed = new Set();
  const added = []; // {tempId, key, title, description, unit, function, keyValid}
  let nextTempId = 1;

  const saveBtn = document.getElementById("save-btn");
  const inferBtn = document.getElementById("infer-btn");
  const addBtn = document.getElementById("add-btn"); // null when bodies aren't editable
  const reqsBody = document.getElementById("reqs-body");

  // ---------- State helpers ----------------------------------------------

  function existingKeys() {
    // Soft-removed keys don't count: the user can add a fresh requirement
    // with the same key in the same save (the Save flow drops the removed
    // entry before inserting the new one).
    const keys = new Set();
    for (const bucket of Object.values(state.requirements)) {
      for (const k of Object.keys(bucket)) {
        if (!removed.has(k)) keys.add(k);
      }
    }
    return keys;
  }

  function refreshButtonStates() {
    const hasChanges =
      dirty.size > 0 || removed.size > 0 || added.length > 0;
    const hasInvalid = added.some((a) => !a.keyValid);
    saveBtn.disabled = !hasChanges || hasInvalid;
    if (addBtn) addBtn.disabled = false;
    // Don't clobber unsaved local edits with an inference.
    inferBtn.disabled = hasChanges;
  }

  function setDirty(reqId, scope, field, value) {
    if (!dirty.has(reqId)) dirty.set(reqId, { req: {}, trace: {} });
    dirty.get(reqId)[scope][field] = value;
    refreshButtonStates();
  }

  // ---------- DOM builders -----------------------------------------------

  function buildTraceField(field, current, options, refAttrs) {
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
    el.dataset.scope = "trace";
    el.dataset.field = field;
    Object.assign(el.dataset, refAttrs);
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

  function buildTraceRow(currentUnit, currentFn, refAttrs) {
    const traceRow = document.createElement("div");
    traceRow.className = "field trace-row";

    const unitOptions = state.unitsToFunctions
      ? Object.keys(state.unitsToFunctions)
      : null;
    const unitField = buildTraceField(
      "unit",
      currentUnit ?? "",
      unitOptions,
      refAttrs
    );
    const fnOptions = state.unitsToFunctions
      ? state.unitsToFunctions[currentUnit ?? ""] ?? []
      : null;
    const fnField = buildTraceField(
      "function",
      currentFn ?? "",
      fnOptions,
      refAttrs
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
    return traceRow;
  }

  function buildCard(entry) {
    const policy = state.policy;
    const lockedBodies = !policy.bodiesEditable;

    const card = document.createElement("div");
    card.className = "req";
    card.dataset.reqId = entry.id;
    if (removed.has(entry.id)) card.classList.add("req--pending-removal");

    const header = document.createElement("div");
    header.className = "req-header";

    const id = document.createElement("div");
    id.className = "req-id";
    id.textContent = entry.id;
    header.appendChild(id);

    const meta = document.createElement("div");
    meta.className = "req-meta";
    const lastMod = entry.req.last_modified ?? "";
    meta.textContent =
      (lastMod ? "modified: " + lastMod + " · " : "") + "source: " + entry.source;
    if (policy.bodiesEditable) {
      meta.appendChild(document.createTextNode(" "));
      meta.appendChild(buildRemoveButton(entry.id));
    }
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

    card.appendChild(
      buildTraceRow(entry.trace.unit, entry.trace.function, { reqId: entry.id })
    );
    card.appendChild(buildOpenSourceRow(entry.trace.unit ?? ""));
    return card;
  }

  function buildRemoveButton(reqId) {
    const btn = document.createElement("button");
    btn.className = "req-remove-btn";
    btn.dataset.action = "remove";
    btn.dataset.reqId = reqId;
    btn.title = "Remove this requirement";
    btn.textContent = "×";
    return btn;
  }

  function buildPendingAddCard(pending) {
    const card = document.createElement("div");
    card.className = "req req--pending-added";
    card.dataset.tempId = pending.tempId;

    const header = document.createElement("div");
    header.className = "req-header";

    const id = document.createElement("div");
    id.className = "req-id";
    id.textContent = "[New requirement]";
    header.appendChild(id);

    const meta = document.createElement("div");
    meta.className = "req-meta";
    const discardBtn = document.createElement("button");
    discardBtn.className = "req-remove-btn";
    discardBtn.dataset.action = "discard-added";
    discardBtn.dataset.tempId = pending.tempId;
    discardBtn.title = "Discard this new requirement";
    discardBtn.textContent = "×";
    meta.appendChild(discardBtn);
    header.appendChild(meta);
    card.appendChild(header);

    // Key field. Validates against existing + other pending keys on input.
    const keyInput = document.createElement("input");
    keyInput.type = "text";
    keyInput.dataset.tempId = pending.tempId;
    keyInput.dataset.field = "key";
    keyInput.value = pending.key;
    keyInput.placeholder = "Required: unique key under which this is stored";
    const keyField = buildField("Key", keyInput);
    const keyError = document.createElement("div");
    keyError.className = "field-error";
    keyError.dataset.tempId = pending.tempId;
    keyError.dataset.role = "key-error";
    keyField.appendChild(keyError);
    card.appendChild(keyField);

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.dataset.tempId = pending.tempId;
    titleInput.dataset.field = "title";
    titleInput.value = pending.title;
    card.appendChild(buildField("Title", titleInput));

    const descArea = document.createElement("textarea");
    descArea.dataset.tempId = pending.tempId;
    descArea.dataset.field = "description";
    descArea.value = pending.description;
    card.appendChild(buildField("Description", descArea));

    card.appendChild(
      buildTraceRow(pending.unit, pending.function, { tempId: pending.tempId })
    );
    card.appendChild(buildOpenSourceRow(pending.unit ?? ""));

    validatePendingKey(pending, keyInput, keyError);
    return card;
  }

  function buildOpenSourceRow(unit) {
    const row = document.createElement("div");
    row.className = "open-source-row";
    const btn = document.createElement("button");
    btn.className = "open-source-btn";
    btn.dataset.action = "open-source";
    btn.textContent = "↗ Open source";
    btn.title = "Open the unit's source file at the function definition.";
    btn.disabled = !unit;
    row.appendChild(btn);
    return row;
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
    // Pending-added cards live below the persisted groups so the user
    // sees them clearly until they save.
    for (const pending of added) {
      frag.appendChild(buildPendingAddCard(pending));
    }
    reqsBody.replaceChildren(frag);
  }

  // ---------- Pending-key validation -------------------------------------

  function validatePendingKey(pending, inputEl, errorEl) {
    const key = pending.key.trim();
    let problem = "";
    if (!key) {
      problem = "Key is required.";
    } else if (existingKeys().has(key)) {
      problem = "Collides with an existing requirement key.";
    } else if (added.some((a) => a !== pending && a.key.trim() === key)) {
      problem = "Two pending new requirements share this key.";
    }
    pending.keyValid = problem === "";
    inputEl.classList.toggle("invalid", !pending.keyValid);
    if (errorEl) errorEl.textContent = problem;
  }

  function revalidateAllPendingKeys() {
    for (const pending of added) {
      const card = reqsBody.querySelector(
        `.req--pending-added[data-temp-id="${pending.tempId}"]`
      );
      if (!card) continue;
      const inputEl = card.querySelector('[data-field="key"]');
      const errorEl = card.querySelector('[data-role="key-error"]');
      if (inputEl) validatePendingKey(pending, inputEl, errorEl);
    }
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

  function pendingForTempId(tempId) {
    return added.find((a) => a.tempId === tempId);
  }

  function handleFieldChange(el) {
    // Pending-added card: route the edit into the `added` entry directly.
    if (el.dataset.tempId) {
      const pending = pendingForTempId(el.dataset.tempId);
      if (!pending) return;
      const field = el.dataset.field;
      let value = el.value;
      if (field === "key") {
        pending.key = value;
        const card = el.closest(".req");
        const errorEl = card?.querySelector('[data-role="key-error"]');
        validatePendingKey(pending, el, errorEl);
      } else if (field === "title" || field === "description") {
        pending[field] = value;
      } else if (field === "unit" || field === "function") {
        pending[field] = value === "" ? null : value;
        if (field === "unit") {
          const card = el.closest(".req");
          refreshFunctionOptions(card, pending.unit, pending.function);
          const fnSelect = card.querySelector(
            '[data-scope="trace"][data-field="function"]'
          );
          if (fnSelect) {
            pending.function = fnSelect.value === "" ? null : fnSelect.value;
          }
          updateOpenSourceForCard(card, pending.unit);
        }
      }
      refreshButtonStates();
      return;
    }

    // Existing card edit.
    const reqId = el.dataset.reqId;
    if (removed.has(reqId)) return; // ignore edits to soft-deleted cards
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
      const fnSelect = card.querySelector(
        '[data-scope="trace"][data-field="function"]'
      );
      if (fnSelect) {
        const newFn = fnSelect.value === "" ? null : fnSelect.value;
        setDirty(reqId, "trace", "function", newFn);
        fnSelect.classList.add("dirty");
      }
      updateOpenSourceForCard(card, value);
    }
  }

  function updateOpenSourceForCard(card, unit) {
    if (!card) return;
    const btn = card.querySelector(".open-source-btn");
    if (btn) btn.disabled = !unit;
  }

  reqsBody.addEventListener("input", (e) => {
    const t = e.target;
    if (
      t &&
      t.matches &&
      t.matches("[data-field]") &&
      t.tagName !== "SELECT"
    ) {
      handleFieldChange(t);
    }
  });
  reqsBody.addEventListener("change", (e) => {
    const t = e.target;
    if (t && t.matches && t.matches("[data-field]") && t.tagName === "SELECT") {
      handleFieldChange(t);
    }
  });

  // ---------- Add / remove -----------------------------------------------

  function appendPendingAdd() {
    const pending = {
      tempId: "__pending_" + nextTempId++ + "__",
      key: "",
      title: "",
      description: "",
      unit: null,
      function: null,
      keyValid: false,
    };
    added.push(pending);
    reqsBody.appendChild(buildPendingAddCard(pending));
    refreshButtonStates();
  }

  function toggleRemoveExisting(reqId) {
    const card = reqsBody.querySelector(`.req[data-req-id="${reqId}"]`);
    if (!card) return;
    if (removed.has(reqId)) {
      removed.delete(reqId);
      card.classList.remove("req--pending-removal");
      const btn = card.querySelector(".req-remove-btn");
      if (btn) {
        btn.textContent = "×";
        btn.title = "Remove this requirement";
      }
    } else {
      removed.add(reqId);
      card.classList.add("req--pending-removal");
      const btn = card.querySelector(".req-remove-btn");
      if (btn) {
        btn.textContent = "↩";
        btn.title = "Restore this requirement";
      }
    }
    // A soft-delete or restore can flip the validity of pending-add keys
    // that were colliding/uncolliding with the toggled requirement.
    revalidateAllPendingKeys();
    refreshButtonStates();
  }

  function discardPendingAdd(tempId) {
    const idx = added.findIndex((a) => a.tempId === tempId);
    if (idx === -1) return;
    added.splice(idx, 1);
    const card = reqsBody.querySelector(
      `.req--pending-added[data-temp-id="${tempId}"]`
    );
    if (card) card.remove();
    revalidateAllPendingKeys();
    refreshButtonStates();
  }

  if (addBtn) {
    addBtn.addEventListener("click", appendPendingAdd);
  }

  reqsBody.addEventListener("click", (e) => {
    const t = e.target;
    if (!t || !t.matches) return;
    if (t.matches(".req-remove-btn")) {
      const action = t.dataset.action;
      if (action === "remove") {
        toggleRemoveExisting(t.dataset.reqId);
      } else if (action === "discard-added") {
        discardPendingAdd(t.dataset.tempId);
      }
    } else if (t.matches(".open-source-btn") && !t.disabled) {
      const card = t.closest(".req");
      if (!card) return;
      const unitEl = card.querySelector('[data-scope="trace"][data-field="unit"]');
      const fnEl = card.querySelector('[data-scope="trace"][data-field="function"]');
      const unit = unitEl ? unitEl.value : "";
      const fn = fnEl ? fnEl.value : "";
      if (!unit) return;
      vscode.postMessage({
        type: "open-source",
        unit,
        function: fn === "" ? null : fn,
      });
    }
  });

  // ---------- Save / infer ------------------------------------------------

  function buildSaveUpdates() {
    const updates = {
      requirements: JSON.parse(JSON.stringify(state.requirements)),
      traceability: JSON.parse(JSON.stringify(state.traceability)),
    };

    // 1. Drop soft-removed entries from every bucket and the trace map.
    for (const reqId of removed) {
      for (const bucket of Object.keys(updates.requirements)) {
        if (updates.requirements[bucket][reqId]) {
          delete updates.requirements[bucket][reqId];
        }
      }
      delete updates.traceability[reqId];
    }

    // 2. Apply in-place dirty patches (skipping any that are also removed).
    for (const [reqId, patch] of dirty.entries()) {
      if (removed.has(reqId)) continue;
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

    // 3. Append pending-added entries to the first bucket. The save flow on
    //    the extension side normalizes everything into a single CSV-keyed
    //    bucket anyway, so the choice here doesn't matter.
    let bucketKey = Object.keys(updates.requirements)[0];
    if (!bucketKey) {
      bucketKey = "[CSV] [" + state.gatewayPath + "]";
      updates.requirements[bucketKey] = {};
    }
    for (const pending of added) {
      const key = pending.key.trim();
      updates.requirements[bucketKey][key] = {
        id: key,
        title: pending.title,
        description: pending.description,
      };
      if (pending.unit != null || pending.function != null) {
        updates.traceability[key] = {
          unit: pending.unit ?? null,
          function: pending.function ?? null,
          lines: null,
        };
      }
    }

    return updates;
  }

  saveBtn.addEventListener("click", () => {
    const updates = buildSaveUpdates();
    saveBtn.disabled = true;
    inferBtn.disabled = true;
    if (addBtn) addBtn.disabled = true;
    vscode.postMessage({
      type: "save",
      updates,
      expectedMtimes: state.mtimes,
    });
  });

  inferBtn.addEventListener("click", () => {
    inferBtn.disabled = true;
    saveBtn.disabled = true;
    if (addBtn) addBtn.disabled = true;
    vscode.postMessage({ type: "infer-traceability" });
  });

  function applyRefreshedBundle(msg) {
    dirty.clear();
    removed.clear();
    added.length = 0;
    state.mtimes = msg.mtimes;
    state.requirements = msg.requirements;
    state.traceability = msg.traceability;
    if (Array.isArray(msg.groups)) rebuildBody(msg.groups);
    refreshButtonStates();
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "saved" || msg.type === "inferred") {
      applyRefreshedBundle(msg);
    } else if (
      msg.type === "save-failed" ||
      msg.type === "infer-failed" ||
      msg.type === "infer-cancelled"
    ) {
      refreshButtonStates();
    }
  });
})();
