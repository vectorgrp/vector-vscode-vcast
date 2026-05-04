// Shared mutable state for the requirements editor webview.
// Lives in one module so cards.js / filter.js / save.js / the entry script
// all reference the same singletons via ES-module live bindings.

export const vscode = acquireVsCodeApi();
export const state = window.__rgwState;

// Pending edits split three ways:
//   dirty   — in-place edits to existing requirements (key -> {req, trace})
//   removed — keys of existing requirements marked for soft-deletion
//   added   — pending new requirements not yet on disk
// All three flush on Save and reset on a successful saved/inferred.
export const dirty = new Map();
export const removed = new Set();
export const added = []; // {tempId, key, title, description, unit, function, keyValid}

let nextTempId = 1;
export function nextTempIdValue() {
  return "__pending_" + nextTempId++ + "__";
}

// DOM refs the rest of the modules rely on. Looked up once at module load —
// `<script type="module">` is deferred, so the elements exist by the time
// this evaluates.
export const saveBtn = document.getElementById("save-btn");
export const inferBtn = document.getElementById("infer-btn");
// addBtn is null when bodies aren't editable (the template omits it).
export const addBtn = document.getElementById("add-btn");
export const reqsBody = document.getElementById("reqs-body");
export const searchInput = document.getElementById("search-input");
export const searchCount = document.getElementById("search-count");
export const filterUnit = document.getElementById("filter-unit");
export const filterFunction = document.getElementById("filter-function");

/**
 * Existing keys across all buckets, minus any soft-removed ones — those
 * don't count, the user can add a fresh requirement with the same key in
 * the same save (the Save flow drops the removed entry first).
 */
export function existingKeys() {
  const keys = new Set();
  for (const bucket of Object.values(state.requirements)) {
    for (const k of Object.keys(bucket)) {
      if (!removed.has(k)) keys.add(k);
    }
  }
  return keys;
}

export function refreshButtonStates() {
  const hasChanges = dirty.size > 0 || removed.size > 0 || added.length > 0;
  const hasInvalid = added.some((a) => !a.keyValid);
  saveBtn.disabled = !hasChanges || hasInvalid;
  if (addBtn) addBtn.disabled = false;
  // Don't clobber unsaved local edits with an inference.
  inferBtn.disabled = hasChanges;
}

export function setDirty(reqId, scope, field, value) {
  if (!dirty.has(reqId)) dirty.set(reqId, { req: {}, trace: {} });
  dirty.get(reqId)[scope][field] = value;
  refreshButtonStates();
}
