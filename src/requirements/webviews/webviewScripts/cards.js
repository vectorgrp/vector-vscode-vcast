// DOM construction + grouping + edit handling for requirement cards.

import {
  state,
  dirty,
  removed,
  added,
  reqsBody,
  setDirty,
  refreshButtonStates,
  existingKeys,
  nextTempIdValue,
} from "./state.js";
import { rebuildFilterDropdowns, applyFilter } from "./filter.js";

// ---------- Low-level DOM builders ---------------------------------------

function buildField(label, child) {
  const div = document.createElement("div");
  div.className = "field";
  const lbl = document.createElement("label");
  lbl.textContent = label;
  div.appendChild(lbl);
  div.appendChild(child);
  return div;
}

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

function buildRemoveButton(reqId) {
  const btn = document.createElement("button");
  btn.className = "req-remove-btn";
  btn.dataset.action = "remove";
  btn.dataset.reqId = reqId;
  btn.title = "Remove this requirement";
  btn.textContent = "×";
  return btn;
}

// ---------- Card builders ------------------------------------------------

export function buildCard(entry) {
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
    (lastMod ? "modified: " + lastMod + " · " : "") +
    "source: " +
    entry.source;
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

export function buildPendingAddCard(pending) {
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

// ---------- Grouping + body rebuild --------------------------------------

/**
 * Flatten the bundle in `state` into ordered groups keyed by
 * `function || unit || source`. Single source of truth for grouping —
 * the wire protocol doesn't ship pre-grouped data, so this is what
 * everyone (initial load + every saved/inferred refresh) uses.
 */
function groupRequirementsFromState() {
  const flat = [];
  for (const [source, bucket] of Object.entries(state.requirements)) {
    for (const [id, req] of Object.entries(bucket)) {
      flat.push({
        source,
        id,
        req,
        trace: state.traceability[id] || {
          unit: null,
          function: null,
          lines: null,
        },
      });
    }
  }
  const buckets = {};
  const order = [];
  for (const entry of flat) {
    const key =
      entry.trace.function ||
      entry.trace.unit ||
      entry.source ||
      "Unknown";
    if (!buckets[key]) {
      buckets[key] = [];
      order.push(key);
    }
    buckets[key].push(entry);
  }
  return order.map((name) => ({ name, entries: buckets[name] }));
}

export function rebuildBody() {
  const groups = groupRequirementsFromState();
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
  rebuildFilterDropdowns();
  applyFilter();
}

// ---------- Pending-key validation ---------------------------------------

export function validatePendingKey(pending, inputEl, errorEl) {
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

export function revalidateAllPendingKeys() {
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

// ---------- Field-change handling ----------------------------------------

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

function updateOpenSourceForCard(card, unit) {
  if (!card) return;
  const btn = card.querySelector(".open-source-btn");
  if (btn) btn.disabled = !unit;
}

export function handleFieldChange(el) {
  // Pending-added card: route the edit into the `added` entry directly.
  if (el.dataset.tempId) {
    const pending = pendingForTempId(el.dataset.tempId);
    if (!pending) return;
    const field = el.dataset.field;
    const value = el.value;
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
        // Drop the function when the unit changes — keeping a stale
        // function would create mismatched traceability the user almost
        // certainly didn't intend.
        const card = el.closest(".req");
        pending.function = null;
        refreshFunctionOptions(card, pending.unit, null);
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
    // Same rule as for pending cards: drop the function on unit change.
    const card = el.closest(".req");
    refreshFunctionOptions(card, value, null);
    setDirty(reqId, "trace", "function", null);
    const fnSelect = card.querySelector(
      '[data-scope="trace"][data-field="function"]'
    );
    if (fnSelect) fnSelect.classList.add("dirty");
    updateOpenSourceForCard(card, value);
  }

  // The filter reads input values directly at apply time, so a fresh
  // edit becomes searchable immediately without any per-edit bookkeeping
  // here. We don't re-apply the filter on edit because doing so could
  // yank a card the user is actively editing out from under them.
}

// ---------- Add / remove -------------------------------------------------

export function appendPendingAdd() {
  const pending = {
    tempId: nextTempIdValue(),
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

export function toggleRemoveExisting(reqId) {
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

export function discardPendingAdd(tempId) {
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
