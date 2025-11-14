const vscode = acquireVsCodeApi();
let jsonData = window.initialJson;
let undoStack = [];
let collapsedKeys = new Set();
const dropdownData = window.webviewDropdownData; // {unit1:[f1,f2], unit2:[f3,f4]}

const jsonContainer = document.getElementById("jsonContainer");
const filterBar = document.getElementById("filterBar");
const addSection = document.getElementById("addSection");
const addRows = document.getElementById("addRows");

// Buttons
const showAddFormBtn = document.getElementById("showAddForm");
const addCancelBtn = document.getElementById("btnAddCancel");
const addConfirmBtn = document.getElementById("btnAddConfirm");
const btnSave = document.getElementById("btnSave");
const btnCancel = document.getElementById("btnCancel");

addSection.style.display = "none"; // hide add form initially

pushUndo();
renderFilters();
renderObjects();

// ----------------------
// UNDO STACK
// ----------------------
function pushUndo() { undoStack.push(JSON.stringify(jsonData)); }

document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key === "z") {
    if (!undoStack.length) return;
    jsonData = JSON.parse(undoStack.pop());
    renderObjects();
  }
});

// ----------------------
// SAVE / CANCEL
// ----------------------
btnSave.addEventListener("click", () => {
  let valid = true;

  // Validate all requirements before saving
  Object.entries(jsonData).forEach(([reqId, reqObj]) => {
    ["id", "unit", "function"].forEach(key => {
      const input = jsonContainer.querySelector(
        `[data-parent="${reqId}"][data-key="${key}"]`
      );
      if (!reqObj[key] || reqObj[key].trim() === "") {
        valid = false;
        if (input) input.classList.add("input-error");
      } else {
        if (input) input.classList.remove("input-error");
      }
    });
  });

  if (!valid) {
    vscode.window.showWarningMessage(
      "Please fill in all required fields (id, unit, function) before saving."
    );
    return;
  }

  // All required fields filled, send to extension
  vscode.postMessage({ command: "saveJson", data: jsonData });
});

btnCancel.addEventListener("click", () =>
  vscode.postMessage({ command: "cancel" })
);

// ----------------------
// FILTER BAR
// ----------------------
function renderFilters() {
  filterBar.innerHTML = "";
  const keys = Object.keys(jsonData[Object.keys(jsonData)[0]] || {});
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

// ----------------------
// RENDER REQUIREMENTS
// ----------------------
function renderObjects() {
  jsonContainer.innerHTML = "";
  const keys = Object.keys(jsonData[Object.keys(jsonData)[0]] || {});

  Object.entries(jsonData).forEach(([objKey, objVal]) => {
    const div = document.createElement("div");
    div.className = "json-object";
    div.dataset.objKey = objKey; // Track current object key
    div.innerHTML = `<div class="json-object-key">${objKey}</div>`;

    keys.forEach(k => {
      if (!collapsedKeys.has(k)) {
        const kv = document.createElement("div");
        kv.className = "key-value";
        kv.innerHTML = `<div style="width:150px">${k}:</div>`;

        // ID / regular input
        if (k === "id" || (k !== "unit" && k !== "function")) {
          const input = document.createElement("input");
          input.dataset.parent = objKey;
          input.dataset.key = k;
          input.value = objVal[k] ?? "";

          input.addEventListener("input", e => {
            const parent = e.target.dataset.parent;
            const key = e.target.dataset.key;
            const value = e.target.value;

            // If the ID changes, rename the key in jsonData
            if (key === "id" && value !== parent) {
              jsonData[value] = { ...jsonData[parent], id: value };
              delete jsonData[parent];

              // Update dataset.parent for all inputs/selects in this row
              div.querySelectorAll("input, select").forEach(el => {
                el.dataset.parent = value;
              });

              // Update div header
              div.querySelector(".json-object-key").textContent = value;
              div.dataset.objKey = value;
            } else {
              jsonData[parent][key] = value;
            }

            pushUndo();
          });

          kv.appendChild(input);
        }

        // UNIT DROPDOWN
        else if (k === "unit") {
          const select = document.createElement("select");
          select.dataset.parent = objKey;
          select.dataset.key = k;
          select.innerHTML = Object.keys(dropdownData).map(u => `<option value="${u}">${u}</option>`).join("");
          if (objVal.unit) select.value = objVal.unit;
          select.addEventListener("change", onUnitChange);
          kv.appendChild(select);
        }

        // FUNCTION DROPDOWN
        else if (k === "function") {
          const select = document.createElement("select");
          select.dataset.parent = objKey;
          select.dataset.key = k;

          const currentUnit = objVal.unit;
          if (currentUnit && dropdownData[currentUnit]) {
            select.innerHTML = dropdownData[currentUnit].map(f => `<option value="${f}">${f}</option>`).join("");
          } else {
            select.innerHTML = Object.values(dropdownData).flat().map(f => `<option value="${f}">${f}</option>`).join("");
          }

          if (objVal.function) select.value = objVal.function;
          select.addEventListener("change", onFunctionChange);
          kv.appendChild(select);
        }

        div.appendChild(kv);
      }
    });

    jsonContainer.appendChild(div);
  });
}

// ----------------------
// UNIT/FUNCTION LOGIC
// ----------------------
function onUnitChange(e) {
  const unit = e.target.value;
  const parent = e.target.dataset.parent;
  jsonData[parent].unit = unit;

  const functionSelect = Array.from(
    jsonContainer.querySelectorAll(`select[data-parent="${parent}"][data-key="function"]`)
  )[0];

  functionSelect.innerHTML = `<option value="">--</option>`;
  if (unit && dropdownData[unit]) {
    dropdownData[unit].forEach(f => {
      functionSelect.innerHTML += `<option value="${f}">${f}</option>`;
    });

    if (!dropdownData[unit].includes(jsonData[parent].function)) {
      jsonData[parent].function = "";
      functionSelect.value = "";
    }
  } else {
    Object.values(dropdownData).flat().forEach(f => {
      functionSelect.innerHTML += `<option value="${f}">${f}</option>`;
    });
  }

  pushUndo();
}

function onFunctionChange(e) {
  const func = e.target.value;
  const parent = e.target.dataset.parent;
  jsonData[parent].function = func;

  // Autocomplete unit if empty
  if (!jsonData[parent].unit && func) {
    for (const [unit, funcs] of Object.entries(dropdownData)) {
      if (funcs.includes(func)) {
        jsonData[parent].unit = unit;

        const unitSelect = Array.from(
          jsonContainer.querySelectorAll(`select[data-parent="${parent}"][data-key="unit"]`)
        )[0];
        unitSelect.value = unit;

        // trigger unit change to filter functions correctly
        const event = new Event('change');
        unitSelect.dispatchEvent(event);

        // restore function selection
        const funcSelect = Array.from(
          jsonContainer.querySelectorAll(`select[data-parent="${parent}"][data-key="function"]`)
        )[0];
        funcSelect.value = func;

        break;
      }
    }
  }

  pushUndo();
}

// ----------------------
// ADD NEW REQUIREMENT FORM
// ----------------------
showAddFormBtn.addEventListener("click", () => {
  buildAddForm();
  addSection.style.display = "block";
  showAddFormBtn.style.display = "none";
});

function buildAddForm() {
  addRows.innerHTML = "";
  const sample = jsonData[Object.keys(jsonData)[0]] || {};

  Object.keys(sample).forEach(k => {
    const wrapper = document.createElement("div");
    wrapper.className = "key-value";

    const isRequired = (k === "id" || k === "unit" || k === "function");
    const placeholder = isRequired ? "(required)" : "";

    wrapper.innerHTML = `<div style="width:120px">${k}:</div>`;

    if (k === "unit") {
      const select = document.createElement("select");
      select.dataset.key = k;
      select.innerHTML = `<option value="">--</option>` + Object.keys(dropdownData).map(u => `<option value="${u}">${u}</option>`).join("");
      wrapper.appendChild(select);
    } else if (k === "function") {
      const select = document.createElement("select");
      select.dataset.key = k;
      // Initial: all functions
      select.innerHTML = `<option value="">--</option>` + Object.values(dropdownData).flat().map(f => `<option value="${f}">${f}</option>`).join("");
      wrapper.appendChild(select);
    } else {
      const input = document.createElement("input");
      input.dataset.key = k;
      input.placeholder = placeholder;
      wrapper.appendChild(input);
    }

    addRows.appendChild(wrapper);
  });

  const unitSelect = addRows.querySelector(`select[data-key="unit"]`);
  const funcSelect = addRows.querySelector(`select[data-key="function"]`);

  // Unit -> filter functions
  unitSelect.addEventListener("change", e => {
    const unit = e.target.value;
    funcSelect.innerHTML = `<option value="">--</option>`;
    if (unit && dropdownData[unit]) {
      dropdownData[unit].forEach(f => funcSelect.innerHTML += `<option value="${f}">${f}</option>`);
      if (!dropdownData[unit].includes(funcSelect.value)) funcSelect.value = "";
    } else {
      Object.values(dropdownData).flat().forEach(f => funcSelect.innerHTML += `<option value="${f}">${f}</option>`);
    }
  });

  // Function -> auto-select unit if unit empty
  funcSelect.addEventListener("change", e => {
    const func = e.target.value;
    if (!unitSelect.value && func) {
      for (const [unit, funcs] of Object.entries(dropdownData)) {
        if (funcs.includes(func)) {
          const previousFunc = func;
          unitSelect.value = unit;
          const event = new Event('change');
          unitSelect.dispatchEvent(event);
          funcSelect.value = previousFunc;
          break;
        }
      }
    }
  });
}

addCancelBtn.addEventListener("click", () => {
  addSection.style.display = "none";
  showAddFormBtn.style.display = "block";
});

addConfirmBtn.addEventListener("click", () => {
  const newEntry = {};
  const inputs = addRows.querySelectorAll("input, select");

  inputs.forEach(inp => inp.classList.remove("input-error"));
  inputs.forEach(inp => newEntry[inp.dataset.key] = inp.value.trim());

  let valid = true;
  ["unit", "function", "id"].forEach(requiredKey => {
    const field = addRows.querySelector(`[data-key="${requiredKey}"]`);
    if (!newEntry[requiredKey]) { valid = false; field.classList.add("input-error"); }
  });
  if (!valid) return;

  jsonData[newEntry.id] = newEntry;
  pushUndo();
  renderObjects();

  addSection.style.display = "none";
  showAddFormBtn.style.display = "block";
});
