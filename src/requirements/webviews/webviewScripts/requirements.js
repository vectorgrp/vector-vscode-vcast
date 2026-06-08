// Requirements editor webview entry. Wires DOM events to the four feature
// modules:
//
//   state.js   — pending edits (dirty / removed / added) + DOM refs
//   cards.js   — DOM building + grouping + edit handlers + add/remove
//   filter.js  — search + unit/function dropdowns
//   save.js    — save payload + refresh handler
//
// State (`window.__rgwState`) is injected as a JSON blob by the extension
// at load time. The cards section is empty in the rendered HTML — every
// element comes from the script via safe DOM APIs (createElement /
// textContent).
//
// Wire protocol (see src/requirements/webview/messages.ts):
//   FROM webview: { type: "save" | "infer-traceability" | "open-source" }
//   TO   webview: { type: "saved" | "inferred" | "save-failed" | "infer-failed" | "infer-cancelled" }

import {
  vscode,
  saveBtn,
  inferBtn,
  addBtn,
  reqsBody,
  searchInput,
  filterUnit,
  filterFunction,
  refreshButtonStates,
} from "./state.js";
import {
  appendPendingAdd,
  toggleRemoveExisting,
  discardPendingAdd,
  handleFieldChange,
  rebuildBody,
} from "./cards.js";
import { applyFilter, onUnitFilterChange } from "./filter.js";
import { postSave, postInfer, applyRefreshedBundle } from "./save.js";

// ---------- Event delegation on the cards container ----------------------

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
    return;
  }

  if (t.matches(".open-source-btn") && !t.disabled) {
    const card = t.closest(".req");
    if (!card) return;
    const unitEl = card.querySelector(
      '[data-scope="trace"][data-field="unit"]'
    );
    const fnEl = card.querySelector(
      '[data-scope="trace"][data-field="function"]'
    );
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

// ---------- Toolbar + filter listeners -----------------------------------

if (addBtn) addBtn.addEventListener("click", appendPendingAdd);
saveBtn.addEventListener("click", postSave);
inferBtn.addEventListener("click", postInfer);

if (searchInput) searchInput.addEventListener("input", applyFilter);
if (filterUnit) filterUnit.addEventListener("change", onUnitFilterChange);
if (filterFunction) filterFunction.addEventListener("change", applyFilter);

// ---------- Extension → webview messages ---------------------------------

window.addEventListener("message", (event) => {
  // VS Code webview messages always arrive with a `vscode-webview:` origin
  // (or the panel's configured `vscode-webview-resource:` variant). Anything
  // else is from an unrelated frame and must be ignored.
  if (!/^vscode-webview(-resource)?:/.test(event.origin)) return;

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

// ---------- Initial render -----------------------------------------------
// rebuildBody() builds cards, populates filter dropdowns, and applies the
// (empty) filter. Buttons start in their initial states.
rebuildBody();
refreshButtonStates();
