// webview.js
// ------------------------------
// Webview logic for Edit Requirements
// ------------------------------
const vscode = acquireVsCodeApi();

// ------------------------------
// State variables
// ------------------------------
let jsonData = window.initialJson || {};
let undoStack = [];
let collapsedKeys = new Set();
let currentTab = "normal"; // "normal" or "highLevel"
const dropdownData = window.webviewDropdownData || {}; // { unit1: [f1,f2], unit2: [...] }

// ------------------------------
// DOM references
// ------------------------------
const jsonContainer = document.getElementById("jsonContainer");
const filterBar = document.getElementById("filterBar");
const addSection = document.getElementById("addSection");
const addRows = document.getElementById("addRows");

const showAddFormBtn = document.getElementById("showAddForm");
const addCancelBtn = document.getElementById("btnAddCancel");
const addConfirmBtn = document.getElementById("btnAddConfirm");
const btnSave = document.getElementById("btnSave");
const btnCancel = document.getElementById("btnCancel");

// Tabs
const tabButtons = document.querySelectorAll(".tab-button");

// Hide "add new requirement" section initially
addSection.style.display = "none";

// Initial render
pushUndo();
renderFilters();
renderObjects();

// ------------------------------
// Utility functions
// ------------------------------

/**
 * Determines whether a requirement is High-Level.
 * High-Level if:
 *   - its ID contains "_HL."
 *   - OR its "function" field is explicitly null
 */
function isHighLevel(objKey, objVal) {
  try {
    if (typeof objKey === "string" && objKey.includes("_HL.")) {
      return true;
    }
    if (objVal && objVal.function === null) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Push the current JSON state onto the undo stack.
 * Uses JSON serialization for simplicity.
 */
function pushUndo() {
  try {
    undoStack.push(JSON.stringify(jsonData));
  } catch (err) {
    console.error("Failed to push undo state:", err);
  }
}

/**
 * Show a message in VS Code via postMessage.
 */
function showVscodeMessage(type, message) {
  vscode.postMessage({ command: "showMessage", type, message });
}

/**
 * Escape HTML content to prevent injection
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Escape string for HTML attributes
 */
function escapeHtmlAttr(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ------------------------------
// Keyboard / Undo handling
// ------------------------------
document.addEventListener("keydown", (e) => {
  const isUndo = (e.ctrlKey || e.metaKey) && e.key === "z";
  if (isUndo) {
    if (undoStack.length === 0) {
      return;
    }
    jsonData = JSON.parse(undoStack.pop());
    renderObjects();
  }
});

// ------------------------------
// Save / Cancel behavior
// ------------------------------
btnSave.addEventListener("click", () => {
  let isValid = true;

  // Remove previous error highlights
  jsonContainer.querySelectorAll(".input-error").forEach((el) => {
    el.classList.remove("input-error");
  });

  // Validate all requirements
  for (const [reqId, reqObj] of Object.entries(jsonData)) {
    // id is required
    if (!reqObj.id || String(reqObj.id).trim() === "") {
      isValid = false;
      const input = jsonContainer.querySelector(
        `[data-parent="${reqId}"][data-key="id"]`
      );
      if (input) input.classList.add("input-error");
    }

    // unit is required
    if (!reqObj.unit || String(reqObj.unit).trim() === "") {
      isValid = false;
      const input = jsonContainer.querySelector(
        `[data-parent="${reqId}"][data-key="unit"]`
      );
      if (input) input.classList.add("input-error");
    }

    // function is required for non-high-level requirements
    if (!isHighLevel(reqId, reqObj)) {
      if (!reqObj.function || String(reqObj.function).trim() === "") {
        isValid = false;
        const input = jsonContainer.querySelector(
          `[data-parent="${reqId}"][data-key="function"]`
        );
        if (input) input.classList.add("input-error");
      }
    }
  }

  if (!isValid) {
    showVscodeMessage(
      "warning",
      "Please fill in all required fields. Required: id, unit, and (for non-HL) function."
    );
    return;
  }

  // Ensure HL requirements have function set to null
  for (const [reqId, reqObj] of Object.entries(jsonData)) {
    if (isHighLevel(reqId, reqObj)) {
      reqObj.function = null;
    }
  }

  vscode.postMessage({ command: "saveJson", data: jsonData });
});

btnCancel.addEventListener("click", () => {
  vscode.postMessage({ command: "cancel" });
});

// ------------------------------
// Tab handling
// ------------------------------
tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    // Reset all tabs
    tabButtons.forEach((b) => b.classList.remove("active"));

    // Activate clicked tab
    btn.classList.add("active");

    currentTab = btn.dataset.tab;
    renderFilters();
    renderObjects();
  });
});

// ------------------------------
// Filters rendering
// ------------------------------
function renderFilters() {
  filterBar.innerHTML = "";

  const filteredData = getFilteredData();
  const allKeys = new Set();

  Object.values(filteredData).forEach((obj) => {
    if (typeof obj === "object" && obj !== null) {
      Object.keys(obj).forEach((k) => allKeys.add(k));
    }
  });

  allKeys.forEach((k) => {
    const label = document.createElement("label");
    const isChecked = collapsedKeys.has(k) ? "" : "checked";
    label.innerHTML = `<input type="checkbox" data-key="${k}" ${isChecked}> ${k}`;
    filterBar.appendChild(label);

    label.querySelector("input").addEventListener("change", (e) => {
      const key = e.target.dataset.key;
      if (e.target.checked) {
        collapsedKeys.delete(key);
      } else {
        collapsedKeys.add(key);
      }
      renderObjects();
    });
  });
}

// ------------------------------
// Main render function
// ------------------------------
function renderObjects() {
  jsonContainer.innerHTML = "";
  const filteredData = getFilteredData();

  if (!filteredData || Object.keys(filteredData).length === 0) {
    const hint = document.createElement("div");
    hint.style.opacity = "0.7";
    hint.style.fontStyle = "italic";
    hint.textContent = "No requirements to display.";
    jsonContainer.appendChild(hint);
    return;
  }

  // Collect keys across all objects
  const keys = new Set();
  Object.values(filteredData).forEach((obj) => {
    if (typeof obj === "object" && obj !== null) {
      Object.keys(obj).forEach((k) => keys.add(k));
    }
  });

  Object.entries(filteredData).forEach(([objKey, objVal]) => {
    const div = document.createElement("div");
    div.className = "json-object";
    div.dataset.objKey = objKey;

    const hl = isHighLevel(objKey, objVal);
    const headerHtml = `<div class="json-object-key">${escapeHtml(
      objKey
    )}${hl ? `<span class="hl-tag">HIGH LEVEL</span>` : ""}</div>`;
    div.innerHTML = headerHtml;

    keys.forEach((k) => {
      if (collapsedKeys.has(k)) {
        return;
      }

      const kv = document.createElement("div");
      kv.className = "key-value";

      // Key label
      const keyLabel = document.createElement("div");
      keyLabel.style.width = "150px";
      keyLabel.textContent = escapeHtml(k) + ":";
      kv.appendChild(keyLabel);

      // Value input
      if (k === "function" && hl) {
        // HL requirement: function stored as null
        const note = document.createElement("div");
        note.style.flex = "1";
        note.style.color = "#aaaaaa";
        note.textContent =
          "(high-level requirement — function stored as null)";
        const hiddenInput = document.createElement("input");
        hiddenInput.style.display = "none";
        hiddenInput.dataset.parent = objKey;
        hiddenInput.dataset.key = "function";

        kv.appendChild(note);
        kv.appendChild(hiddenInput);
        div.appendChild(kv);
        return;
      }

      if (k === "unit") {
        renderUnitSelect(kv, objKey, objVal);
      } else if (k === "function") {
        renderFunctionSelect(kv, objKey, objVal);
      } else {
        renderTextInput(kv, objKey, k);
      }

      div.appendChild(kv);
    });

    jsonContainer.appendChild(div);
  });
}

// ------------------------------
// Render helpers for input types
// ------------------------------
function renderTextInput(container, objKey, key) {
  const input = document.createElement("input");
  input.dataset.parent = objKey;
  input.dataset.key = key;
  input.value = jsonData[objKey][key] ?? "";

  input.addEventListener("input", (e) => {
    const parent = e.target.dataset.parent;
    const key = e.target.dataset.key;
    const value = e.target.value;

    if (key === "id" && value !== parent) {
      if (jsonData[value]) {
        showVscodeMessage("error", `ID "${value}" already exists.`);
        input.classList.add("input-error");
        return;
      }

      jsonData[value] = { ...jsonData[parent], id: value };
      delete jsonData[parent];

      const inputs = container.parentElement.querySelectorAll("input, select");
      inputs.forEach((el) => (el.dataset.parent = value));

      const headerEl = container.parentElement.querySelector(".json-object-key");
      if (headerEl) {
        headerEl.textContent = value;
      }

      container.parentElement.dataset.objKey = value;
    } else {
      jsonData[parent][key] = value;
    }

    pushUndo();
  });

  container.appendChild(input);
}

function renderUnitSelect(container, objKey, objVal) {
  const select = document.createElement("select");
  select.dataset.parent = objKey;
  select.dataset.key = "unit";

  Object.keys(dropdownData).forEach((u) => {
    const opt = document.createElement("option");
    opt.value = u;
    opt.textContent = u;
    select.appendChild(opt);
  });

  if (objVal.unit) {
    select.value = objVal.unit;
  }

  select.addEventListener("change", onUnitChange);
  container.appendChild(select);
}

function renderFunctionSelect(container, objKey, objVal) {
  const select = document.createElement("select");
  select.dataset.parent = objKey;
  select.dataset.key = "function";

  const unit = objVal.unit;
  if (unit && dropdownData[unit]) {
    dropdownData[unit].forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f;
      opt.textContent = f;
      select.appendChild(opt);
    });
  } else {
    Object.values(dropdownData)
      .flat()
      .forEach((f) => {
        const opt = document.createElement("option");
        opt.value = f;
        opt.textContent = f;
        select.appendChild(opt);
      });
  }

  if (objVal.function) {
    select.value = objVal.function;
  }

  select.addEventListener("change", onFunctionChange);
  container.appendChild(select);
}

// ------------------------------
// Filtered data based on tab
// ------------------------------
function getFilteredData() {
  if (currentTab === "normal") {
    return Object.fromEntries(
      Object.entries(jsonData).filter(([k, v]) => !isHighLevel(k, v))
    );
  } else {
    return Object.fromEntries(
      Object.entries(jsonData).filter(([k, v]) => isHighLevel(k, v))
    );
  }
}

// ------------------------------
// UNIT / FUNCTION interdependency
// ------------------------------
function onUnitChange(e) {
  const unit = e.target.value;
  const parent = e.target.dataset.parent;

  jsonData[parent].unit = unit;

  const funcSelect = jsonContainer.querySelector(
    `select[data-parent="${parent}"][data-key="function"]`
  );
  if (!funcSelect) {
    pushUndo();
    return;
  }

  funcSelect.innerHTML = "";
  if (unit && dropdownData[unit]) {
    dropdownData[unit].forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f;
      opt.textContent = f;
      funcSelect.appendChild(opt);
    });

    if (!dropdownData[unit].includes(jsonData[parent].function)) {
      jsonData[parent].function = "";
      funcSelect.value = "";
    }
  } else {
    Object.values(dropdownData)
      .flat()
      .forEach((f) => {
        const opt = document.createElement("option");
        opt.value = f;
        opt.textContent = f;
        funcSelect.appendChild(opt);
      });
  }

  pushUndo();
}

function onFunctionChange(e) {
  const func = e.target.value;
  const parent = e.target.dataset.parent;

  jsonData[parent].function = func;

  if (!jsonData[parent].unit && func) {
    for (const [unit, funcs] of Object.entries(dropdownData)) {
      if (funcs.includes(func)) {
        jsonData[parent].unit = unit;

        const unitSelect = jsonContainer.querySelector(
          `select[data-parent="${parent}"][data-key="unit"]`
        );
        if (unitSelect) {
          unitSelect.value = unit;
          unitSelect.dispatchEvent(new Event("change"));
        }

        const funcSelect = jsonContainer.querySelector(
          `select[data-parent="${parent}"][data-key="function"]`
        );
        if (funcSelect) {
          funcSelect.value = func;
        }
        break;
      }
    }
  }

  pushUndo();
}

// ------------------------------
// Add New Requirement Form
// ------------------------------
showAddFormBtn.addEventListener("click", () => {
  buildAddForm();
  addSection.style.display = "block";
  showAddFormBtn.style.display = "none";
});

addCancelBtn.addEventListener("click", () => {
  addSection.style.display = "none";
  showAddFormBtn.style.display = "block";
});

addConfirmBtn.addEventListener("click", () => {
  handleAddConfirm();
});

// ------------------------------
// Functions for adding new requirement
// ------------------------------
function buildAddForm() {
  addRows.innerHTML = "";

  const sample =
    jsonData[Object.keys(jsonData)[0]] || {
      id: "",
      title: "",
      description: "",
      unit: "",
      function: "",
      last_modified: "",
    };

  const keys = Object.keys(sample);
  let unitSelect = null;
  let funcSelect = null;
  let idInput = null;
  let funcNote = null;

  keys.forEach((k) => {
    const wrapper = document.createElement("div");
    wrapper.className = "key-value";

    const label = document.createElement("div");
    label.style.width = "120px";
    label.textContent = k + ":";
    wrapper.appendChild(label);

    if (k === "unit") {
      const select = document.createElement("select");
      select.dataset.key = k;
      Object.keys(dropdownData).forEach((u) => {
        const opt = document.createElement("option");
        opt.value = u;
        opt.textContent = u;
        select.appendChild(opt);
      });
      wrapper.appendChild(select);
      unitSelect = select;
    } else if (k === "function") {
      const select = document.createElement("select");
      select.dataset.key = k;

      Object.values(dropdownData)
        .flat()
        .forEach((f) => {
          const opt = document.createElement("option");
          opt.value = f;
          opt.textContent = f;
          select.appendChild(opt);
        });

      wrapper.appendChild(select);
      funcSelect = select;

      funcNote = document.createElement("div");
      funcNote.style.color = "#aaaaaa";
      funcNote.style.fontStyle = "italic";
      funcNote.style.display = "none";
      funcNote.textContent =
        "(high-level requirement — function will be saved as null)";
      wrapper.appendChild(funcNote);
    } else {
      const input = document.createElement("input");
      input.dataset.key = k;
      if (k === "id" || k === "unit" || k === "function") {
        input.placeholder = "(required)";
      }
      wrapper.appendChild(input);

      if (k === "id") {
        idInput = input;
      }
    }

    addRows.appendChild(wrapper);
  });

  if (unitSelect && funcSelect) {
    unitSelect.addEventListener("change", () => {
      updateFunctionOptions(unitSelect, funcSelect);
    });
    funcSelect.addEventListener("change", () => {
      syncUnitForFunction(unitSelect, funcSelect);
    });
  }

  if (idInput && funcSelect && funcNote) {
    toggleHLFields(idInput.value, funcSelect, funcNote);

    idInput.addEventListener("input", (e) => {
      toggleHLFields(e.target.value, funcSelect, funcNote);
    });
  }
}

function toggleHLFields(idVal, funcSelect, funcNote) {
  const isHL = idVal && idVal.includes("_HL.");
  if (isHL) {
    funcSelect.style.display = "none";
    funcNote.style.display = "block";
  } else {
    funcSelect.style.display = "";
    funcNote.style.display = "none";
  }
}

function updateFunctionOptions(unitSelect, funcSelect) {
  funcSelect.innerHTML = "";

  const unit = unitSelect.value;
  if (unit && dropdownData[unit]) {
    dropdownData[unit].forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f;
      opt.textContent = f;
      funcSelect.appendChild(opt);
    });
  } else {
    Object.values(dropdownData)
      .flat()
      .forEach((f) => {
        const opt = document.createElement("option");
        opt.value = f;
        opt.textContent = f;
        funcSelect.appendChild(opt);
      });
  }
}

function syncUnitForFunction(unitSelect, funcSelect) {
  const func = funcSelect.value;

  if (!unitSelect.value && func) {
    for (const [unit, funcs] of Object.entries(dropdownData)) {
      if (funcs.includes(func)) {
        unitSelect.value = unit;
        unitSelect.dispatchEvent(new Event("change"));
        funcSelect.value = func;
        break;
      }
    }
  }
}

function handleAddConfirm() {
  const newEntry = {};
  addRows.querySelectorAll("input, select").forEach((el) => {
    el.classList.remove("input-error");
    newEntry[el.dataset.key] = el.value.trim();
  });

  // Validate fields
  let isValid = true;

  const idField = addRows.querySelector(`[data-key="id"]`);
  const unitField = addRows.querySelector(`[data-key="unit"]`);
  const funcField = addRows.querySelector(`[data-key="function"]`);

  if (!newEntry.id) {
    isValid = false;
    if (idField) idField.classList.add("input-error");
  }

  if (!newEntry.unit) {
    isValid = false;
    if (unitField) unitField.classList.add("input-error");
  }

  const isHL = newEntry.id && newEntry.id.includes("_HL.");
  if (!isHL && !newEntry.function) {
    isValid = false;
    if (funcField) funcField.classList.add("input-error");
  }

  if (!isValid) {
    showVscodeMessage(
      "warning",
      "Please fill in all required fields before adding."
    );
    return;
  }

  if (jsonData[newEntry.id]) {
    showVscodeMessage(
      "error",
      `A requirement with ID "${newEntry.id}" already exists.`
    );
    if (idField) idField.classList.add("input-error");
    return;
  }

  if (isHL) {
    newEntry.function = null;
  }

  // Add new entry and sort
  jsonData[newEntry.id] = newEntry;
  jsonData = Object.keys(jsonData)
    .sort()
    .reduce((acc, key) => {
      acc[key] = jsonData[key];
      return acc;
    }, {});

  pushUndo();
  renderObjects();

  addSection.style.display = "none";
  showAddFormBtn.style.display = "block";
  showVscodeMessage("info", `Requirement "${newEntry.id}" added.`);
}
