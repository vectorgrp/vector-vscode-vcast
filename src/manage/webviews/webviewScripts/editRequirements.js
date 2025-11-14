// webview.js
// ------------------------------
// Webview logic for Edit Requirements
// ------------------------------
const vscode = acquireVsCodeApi();

// State
let jsonData = window.initialJson || {};
let undoStack = [];
let collapsedKeys = new Set();
const dropdownData = window.webviewDropdownData || {}; // { unit1: [f1,f2], unit2: [...] }

// DOM refs
const jsonContainer = document.getElementById("jsonContainer");
const filterBar = document.getElementById("filterBar");
const addSection = document.getElementById("addSection");
const addRows = document.getElementById("addRows");

const showAddFormBtn = document.getElementById("showAddForm");
const addCancelBtn = document.getElementById("btnAddCancel");
const addConfirmBtn = document.getElementById("btnAddConfirm");
const btnSave = document.getElementById("btnSave");
const btnCancel = document.getElementById("btnCancel");

// Hide add section initially
addSection.style.display = "none";

// Initial render
pushUndo();
renderFilters();
renderObjects();

/* -------------------------
   Utility helpers
   ------------------------- */

/**
 * Return true if a requirement is considered High-Level (HL).
 * HL is detected if the object key contains "_HL." OR the object's id contains "_HL."
 */
function isHighLevel(objKey, objVal) {
  try {
    return (
      (typeof objKey === "string" && objKey.includes("_HL.")) ||
      (objVal && typeof objVal.id === "string" && objVal.id.includes("_HL."))
    );
  } catch {
    return false;
  }
}

/** Push current state to undo stack (simple serialization) */
function pushUndo() {
  try {
    undoStack.push(JSON.stringify(jsonData));
  } catch {
    // ignore
  }
}

/** Send a message to extension to show a message in VS Code (info/warning/error) */
function showVscodeMessage(type, message) {
  vscode.postMessage({ command: "showMessage", type, message });
}

/* -------------------------
   Keyboard / Undo handling
   ------------------------- */
document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key === "z") {
    if (!undoStack.length) return;
    jsonData = JSON.parse(undoStack.pop());
    renderObjects();
  }
});

/* -------------------------
   Save / Cancel behavior
   ------------------------- */
btnSave.addEventListener("click", () => {
  let valid = true;
  // Clear previous highlights
  jsonContainer.querySelectorAll(".input-error").forEach(el => el.classList.remove("input-error"));

  // Validate each requirement
  for (const [reqId, reqObj] of Object.entries(jsonData)) {
    // id always required
    if (!reqObj.id || String(reqObj.id).trim() === "") {
      valid = false;
      const input = jsonContainer.querySelector(`[data-parent="${reqId}"][data-key="id"]`);
      if (input) input.classList.add("input-error");
    }

    // unit always required
    if (!reqObj.unit || String(reqObj.unit).trim() === "") {
      valid = false;
      const input = jsonContainer.querySelector(`[data-parent="${reqId}"][data-key="unit"]`);
      if (input) input.classList.add("input-error");
    }

    // function required only for non-HL items
    if (!isHighLevel(reqId, reqObj)) {
      if (!reqObj.function || String(reqObj.function).trim() === "") {
        valid = false;
        const input = jsonContainer.querySelector(`[data-parent="${reqId}"][data-key="function"]`);
        if (input) input.classList.add("input-error");
      }
    }
  }

  if (!valid) {
    showVscodeMessage("warning", "Please fill in all required fields. Required: id, unit, and (for non-HL) function.");
    return;
  }

  // For HL requirements, ensure function is explicitly null
  for (const [reqId, reqObj] of Object.entries(jsonData)) {
    if (isHighLevel(reqId, reqObj)) {
      reqObj.function = null;
    }
  }

  // All OK, instruct extension to save
  vscode.postMessage({ command: "saveJson", data: jsonData });
});

btnCancel.addEventListener("click", () => {
  vscode.postMessage({ command: "cancel" });
});

/* -------------------------
   Filters rendering
   ------------------------- */
function renderFilters() {
  filterBar.innerHTML = "";
  const sample = jsonData[Object.keys(jsonData)[0]] || {};
  const keys = Object.keys(sample);
  keys.forEach(k => {
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" data-key="${k}" ${collapsedKeys.has(k) ? "" : "checked"}> ${k}`;
    filterBar.appendChild(label);

    label.querySelector("input").addEventListener("change", e => {
      const key = e.target.dataset.key;
      if (e.target.checked) collapsedKeys.delete(key);
      else collapsedKeys.add(key);
      renderObjects();
    });
  });
}

/* -------------------------
   Main: render the requirement objects
   ------------------------- */
function renderObjects() {
  jsonContainer.innerHTML = "";

  // Defensive: if empty dataset, show hint
  if (!jsonData || Object.keys(jsonData).length === 0) {
    const hint = document.createElement("div");
    hint.style.opacity = "0.7";
    hint.style.fontStyle = "italic";
    hint.textContent = "No requirements to display.";
    jsonContainer.appendChild(hint);
    return;
  }

  const sample = jsonData[Object.keys(jsonData)[0]] || {};
  const keys = Object.keys(sample);

  // Iterate in insertion order (object) — note that renaming IDs updates jsonData
  for (const [objKey, objVal] of Object.entries(jsonData)) {
    const div = document.createElement("div");
    div.className = "json-object";
    div.dataset.objKey = objKey;

    // Header: show object key and HL tag if applicable
    const hl = isHighLevel(objKey, objVal);
    const headerHtml = `
      <div class="json-object-key">
        ${escapeHtml(objKey)}
        ${hl ? `<span class="hl-tag" title="High-Level Requirement">HIGH LEVEL</span>` : ""}
      </div>
    `;
    div.innerHTML = headerHtml;

    // Render each field (respect collapsed keys)
    keys.forEach(k => {
      if (collapsedKeys.has(k)) return;

      const kv = document.createElement("div");
      kv.className = "key-value";
      kv.innerHTML = `<div style="width:150px">${escapeHtml(k)}:</div>`;

      // ID and plain inputs (title, description, last_modified, etc.)
      if (k === "id" || (k !== "unit" && k !== "function")) {
        const input = document.createElement("input");
        input.dataset.parent = objKey;
        input.dataset.key = k;
        input.value = objVal[k] ?? "";

        // If HL and this is id field -> read-only
        if (k === "id" && hl) {
          input.readOnly = true;
          input.classList.add("hl-readonly");
        }

        // Input listener
        input.addEventListener("input", e => {
          const parent = e.target.dataset.parent;
          const key = e.target.dataset.key;
          const value = e.target.value;

          // If it's the id field and user changed, rename the object key in jsonData
          if (key === "id" && value !== parent) {
            // Prevent duplicate IDs
            if (jsonData[value]) {
              // show error and keep old value in UI
              showVscodeMessage("error", `A requirement with ID "${value}" already exists. Choose a unique ID.`);
              input.classList.add("input-error");
              return;
            }

            // Create new key, copy data, delete old key
            jsonData[value] = { ...jsonData[parent], id: value };
            delete jsonData[parent];

            // Update dataset.parent for all elements within this row (so further edits target new key)
            div.querySelectorAll("input, select").forEach(el => {
              el.dataset.parent = value;
            });

            // Update header text and dataset
            const headerEl = div.querySelector(".json-object-key");
            if (headerEl) headerEl.textContent = value + (hl ? " " : "");
            div.dataset.objKey = value;
          } else {
            // Normal field update
            jsonData[parent][key] = value;
          }

          pushUndo();
        });

        kv.appendChild(input);
        div.appendChild(kv);
        return;
      }

      // UNIT dropdown (always shown, editable even for HL)
      if (k === "unit") {
        const select = document.createElement("select");
        select.dataset.parent = objKey;
        select.dataset.key = k;

        // Populate units
        select.innerHTML = Object.keys(dropdownData).map(u => `<option value="${escapeHtmlAttr(u)}">${escapeHtml(u)}</option>`).join("");
        if (objVal.unit) select.value = objVal.unit;

        select.addEventListener("change", onUnitChange);
        kv.appendChild(select);
        div.appendChild(kv);
        return;
      }

      // FUNCTION: for HL items we do NOT render editable dropdown.
      // Instead show a small readonly note indicating 'null' and that it's HL.
      if (k === "function") {
        if (hl) {
          const note = document.createElement("div");
          note.style.flex = "1";
          note.style.alignSelf = "center";
          note.style.color = "#aaaaaa";
          note.textContent = "(high-level requirement — function stored as null)";
          // add a non-editable placeholder element with the same data-key so validation selectors still work (but invisible)
          const hidden = document.createElement("input");
          hidden.style.display = "none";
          hidden.dataset.parent = objKey;
          hidden.dataset.key = "function";
          // add both elements
          kv.appendChild(note);
          kv.appendChild(hidden);
          div.appendChild(kv);
          return;
        }

        // Regular requirement: render function dropdown, filtered by unit if unit present
        const select = document.createElement("select");
        select.dataset.parent = objKey;
        select.dataset.key = k;

        const currentUnit = objVal.unit;
        if (currentUnit && dropdownData[currentUnit]) {
          select.innerHTML = dropdownData[currentUnit].map(f => `<option value="${escapeHtmlAttr(f)}">${escapeHtml(f)}</option>`).join("");
        } else {
          select.innerHTML = Object.values(dropdownData).flat().map(f => `<option value="${escapeHtmlAttr(f)}">${escapeHtml(f)}</option>`).join("");
        }

        if (objVal.function) select.value = objVal.function;
        select.addEventListener("change", onFunctionChange);
        kv.appendChild(select);
        div.appendChild(kv);
        return;
      }

      // fallback append (shouldn't reach)
      div.appendChild(kv);
    });

    jsonContainer.appendChild(div);
  } // end for each object
}

/* -------------------------
   UNIT / FUNCTION interdependency
   ------------------------- */

/** Called when a unit dropdown changes in the main table */
function onUnitChange(e) {
  const unit = e.target.value;
  const parent = e.target.dataset.parent;
  jsonData[parent].unit = unit;

  // find the function select for this parent (if any)
  const functionSelect = Array.from(
    jsonContainer.querySelectorAll(`select[data-parent="${parent}"][data-key="function"]`)
  )[0];

  if (!functionSelect) {
    // no function select present (HL or missing), nothing to do
    pushUndo(); 
    return;
  }

  // Repopulate functionSelect based on chosen unit (or show all if unit empty)
  functionSelect.innerHTML = "";
  if (unit && dropdownData[unit]) {
    dropdownData[unit].forEach(f => {
      functionSelect.innerHTML += `<option value="${escapeHtmlAttr(f)}">${escapeHtml(f)}</option>`;
    });
    // If previously selected function isn't in new list, clear it
    if (!dropdownData[unit].includes(jsonData[parent].function)) {
      jsonData[parent].function = "";
      functionSelect.value = "";
    }
  } else {
    Object.values(dropdownData).flat().forEach(f => {
      functionSelect.innerHTML += `<option value="${escapeHtmlAttr(f)}">${escapeHtml(f)}</option>`;
    });
  }

  pushUndo();
}

/** Called when a function dropdown changes in the main table */
function onFunctionChange(e) {
  const func = e.target.value;
  const parent = e.target.dataset.parent;
  jsonData[parent].function = func;

  // If unit is empty, autocomplete it
  if (!jsonData[parent].unit && func) {
    for (const [unit, funcs] of Object.entries(dropdownData)) {
      if (funcs.includes(func)) {
        // Set unit in model
        jsonData[parent].unit = unit;

        // find the unit select and update it (will trigger filtering)
        const unitSelect = Array.from(
          jsonContainer.querySelectorAll(`select[data-parent="${parent}"][data-key="unit"]`)
        )[0];
        if (unitSelect) {
          unitSelect.value = unit;
          // trigger unit change to repopulate functions correctly
          const event = new Event('change');
          unitSelect.dispatchEvent(event);
        }

        // restore function selection
        const funcSelect = Array.from(
          jsonContainer.querySelectorAll(`select[data-parent="${parent}"][data-key="function"]`)
        )[0];
        if (funcSelect) funcSelect.value = func;

        break;
      }
    }
  }

  pushUndo();
}

/* -------------------------
   ADD NEW REQUIREMENT form
   ------------------------- */

showAddFormBtn.addEventListener("click", () => {
  buildAddForm();
  addSection.style.display = "block";
  showAddFormBtn.style.display = "none";
});

function buildAddForm() {
  addRows.innerHTML = "";

  // Use sample keys from existing requirements if present,
  // otherwise default to common fields
  const sample = jsonData[Object.keys(jsonData)[0]] || {
    id: "",
    title: "",
    description: "",
    unit: "",
    function: "",
    last_modified: ""
  };
  const keys = Object.keys(sample);

  // For later toggling, references
  let unitSelect = null;
  let funcSelect = null;
  let idInput = null;
  let funcNote = null;

  keys.forEach(k => {
    const wrapper = document.createElement("div");
    wrapper.className = "key-value";
    wrapper.innerHTML = `<div style="width:120px">${escapeHtml(k)}:</div>`;

    if (k === "unit") {
      const select = document.createElement("select");
      select.dataset.key = k;
      select.innerHTML = Object.keys(dropdownData).map(u => `<option value="${escapeHtmlAttr(u)}">${escapeHtml(u)}</option>`).join("");
      wrapper.appendChild(select);
      unitSelect = select;
    } else if (k === "function") {
      const select = document.createElement("select");
      select.dataset.key = k;
      // initial: show ALL functions
      select.innerHTML = Object.values(dropdownData).flat().map(f => `<option value="${escapeHtmlAttr(f)}">${escapeHtml(f)}</option>`).join("");
      wrapper.appendChild(select);
      funcSelect = select;

      // place to show HL note when id indicates HL
      funcNote = document.createElement("div");
      funcNote.style.color = "#aaaaaa";
      funcNote.style.fontStyle = "italic";
      funcNote.style.display = "none";
      funcNote.textContent = "(high-level requirement — function will be saved as null)";
      wrapper.appendChild(funcNote);
    } else {
      const input = document.createElement("input");
      input.dataset.key = k;
      input.placeholder = (k === "id" || k === "unit" || k === "function") ? "(required)" : "";
      wrapper.appendChild(input);
      if (k === "id") idInput = input;
    }

    addRows.appendChild(wrapper);
  });

  // If unitSelect exists, wire unit->filter functions
  if (unitSelect && funcSelect) {
    unitSelect.addEventListener("change", () => {
      const unit = unitSelect.value;
      funcSelect.innerHTML = "";
      if (unit && dropdownData[unit]) {
        dropdownData[unit].forEach(f => funcSelect.innerHTML += `<option value="${escapeHtmlAttr(f)}">${escapeHtml(f)}</option>`);
      } else {
        Object.values(dropdownData).flat().forEach(f => funcSelect.innerHTML += `<option value="${escapeHtmlAttr(f)}">${escapeHtml(f)}</option>`);
      }
    });
  }

  // If idInput exists, detect HL pattern and toggle function visibility
  if (idInput && funcSelect && funcNote) {
    function toggleForHL(idVal) {
      const isHL = idVal && idVal.includes("_HL.");
      if (isHL) {
        funcSelect.style.display = "none";
        funcNote.style.display = "block";
      } else {
        funcSelect.style.display = "";
        funcNote.style.display = "none";
      }
    }

    // initial state
    toggleForHL(idInput.value);

    // on input change, toggle
    idInput.addEventListener("input", (e) => {
      toggleForHL(e.target.value);
    });
  }

  // Function-first behavior in add form: if function selected and unit empty, auto fill unit
  if (funcSelect && unitSelect) {
    funcSelect.addEventListener("change", () => {
      const func = funcSelect.value;
      if (!unitSelect.value && func) {
        for (const [u, funcs] of Object.entries(dropdownData)) {
          if (funcs.includes(func)) {
            unitSelect.value = u;
            // trigger unit change event
            const evt = new Event('change');
            unitSelect.dispatchEvent(evt);
            // restore function selection (unit change may have reset it)
            funcSelect.value = func;
            break;
          }
        }
      }
    });
  }
}

/* -------------------------
   Add-form cancel/confirm
   ------------------------- */
addCancelBtn.addEventListener("click", () => {
  addSection.style.display = "none";
  showAddFormBtn.style.display = "block";
});

addConfirmBtn.addEventListener("click", () => {
  const newEntry = {};
  const inputs = addRows.querySelectorAll("input, select");
  inputs.forEach(inp => inp.classList.remove("input-error"));
  inputs.forEach(inp => newEntry[inp.dataset.key] = inp.value.trim());

  // Validate required fields:
  let valid = true;
  // id and unit always required
  const idField = addRows.querySelector(`[data-key="id"]`);
  const unitField = addRows.querySelector(`[data-key="unit"]`);
  const funcField = addRows.querySelector(`[data-key="function"]`);

  if (!newEntry.id) { valid = false; if (idField) idField.classList.add("input-error"); }
  if (!newEntry.unit) { valid = false; if (unitField) unitField.classList.add("input-error"); }

  // function required only if not HL id
  const isNewHL = newEntry.id && newEntry.id.includes("_HL.");
  if (!isNewHL) {
    if (!newEntry.function) { valid = false; if (funcField) funcField.classList.add("input-error"); }
  }

  if (!valid) {
    showVscodeMessage("warning", "Please fill in all required fields before adding. Required: id, unit, and (for non-HL) function.");
    return;
  }

  // Prevent duplicate ID
  if (jsonData[newEntry.id]) {
    showVscodeMessage("error", `A requirement with ID "${newEntry.id}" already exists. Choose a unique ID.`);
    if (idField) idField.classList.add("input-error");
    return;
  }

  // For HL new requirements, ensure function is null
  if (isNewHL) newEntry.function = null;

  // Save into model and re-render
  jsonData[newEntry.id] = newEntry;
  pushUndo();
  renderObjects();

  // Hide add form and confirm to user
  addSection.style.display = "none";
  showAddFormBtn.style.display = "block";
  showVscodeMessage("info", `Requirement "${newEntry.id}" added.`);
});

/* -------------------------
   Small helpers
   ------------------------- */

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escapeHtmlAttr(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
