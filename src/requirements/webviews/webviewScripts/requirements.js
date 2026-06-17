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
  state,
  saveBtn,
  inferBtn,
  inferCaret,
  inferMenu,
  addBtn,
  verifyBtn,
  generateTestsBtn,
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

if (verifyBtn) {
  verifyBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "verify-against-code" });
  });
}

if (generateTestsBtn) {
  generateTestsBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "generate-tests" });
  });
}

// Default action: untraced-only when supported (split button), else full infer.
inferBtn.addEventListener("click", () =>
  postInfer(state.onlyUntracedSupported === true)
);

// Split-button caret + menu (present only when --only-untraced is supported),
// wired to the WAI-ARIA menu-button keyboard pattern.
const inferMenuItems = () =>
  inferMenu ? [...inferMenu.querySelectorAll(".infer-menu-item")] : [];
const isInferMenuOpen = () => !!inferMenu && !inferMenu.hidden;

function openInferMenu(focusIndex = 0) {
  if (!inferMenu || !inferCaret || inferCaret.disabled) return;
  inferMenu.hidden = false;
  inferCaret.setAttribute("aria-expanded", "true");
  const items = inferMenuItems();
  const target = focusIndex < 0 ? items[items.length - 1] : items[focusIndex];
  if (target) target.focus();
}
function closeInferMenu(returnFocus = false) {
  if (!inferMenu) return;
  inferMenu.hidden = true;
  if (inferCaret) {
    inferCaret.setAttribute("aria-expanded", "false");
    if (returnFocus) inferCaret.focus();
  }
}

if (inferCaret && inferMenu) {
  const inferGroup = document.getElementById("infer-group");

  inferCaret.addEventListener("click", (e) => {
    e.stopPropagation(); // don't let the document handler immediately re-close
    if (inferCaret.disabled) return;
    if (isInferMenuOpen()) closeInferMenu();
    else openInferMenu();
  });
  inferCaret.addEventListener("keydown", (e) => {
    if (inferCaret.disabled) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      openInferMenu(0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      openInferMenu(-1);
    }
  });

  inferMenu.addEventListener("click", (e) => {
    const item = e.target.closest(".infer-menu-item");
    if (!item) return;
    closeInferMenu();
    postInfer(item.dataset.onlyUntraced === "true");
  });
  inferMenu.addEventListener("keydown", (e) => {
    const items = inferMenuItems();
    if (!items.length) return;
    const idx = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(idx + 1) % items.length].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length].focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0].focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1].focus();
    }
  });

  // Dismiss on outside click, Escape (returns focus to caret), or Tab-out.
  document.addEventListener("click", () => closeInferMenu());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isInferMenuOpen()) closeInferMenu(true);
  });
  if (inferGroup) {
    inferGroup.addEventListener("focusout", (e) => {
      if (!inferGroup.contains(e.relatedTarget)) closeInferMenu();
    });
  }
}

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
