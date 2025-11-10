const vscode = acquireVsCodeApi();
let jsonData = window.initialJson;
let undoStack = [];
let collapsedKeys = new Set();

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

// Initial state
addSection.style.display = "none"; // << Ensure hidden on start

pushUndo();
renderFilters();
renderObjects();

// Undo logic remains for Ctrl+Z
function pushUndo() { undoStack.push(JSON.stringify(jsonData)); }

document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key === "z") {
    if (!undoStack.length) return;
    jsonData = JSON.parse(undoStack.pop());
    renderObjects();
  }
});

// Save / Cancel
btnSave.addEventListener("click", () =>
  vscode.postMessage({ command: "saveJson", data: jsonData })
);
btnCancel.addEventListener("click", () =>
  vscode.postMessage({ command: "cancel" })
);

// Filters
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

// Objects Display
function renderObjects() {
  jsonContainer.innerHTML = "";
  const keys = Object.keys(jsonData[Object.keys(jsonData)[0]] || {});
  Object.entries(jsonData).forEach(([objKey, objVal]) => {
    const div = document.createElement("div");
    div.className = "json-object";
    div.innerHTML = `<div class="json-object-key">${objKey}</div>`;
    keys.forEach(k => {
      if (!collapsedKeys.has(k)) {
        const val = objVal[k] ?? "";
        const kv = document.createElement("div");
        kv.className = "key-value";
        kv.innerHTML = `<div style="width:150px">${k}:</div><input data-parent="${objKey}" data-key="${k}" value="${val}"/>`;
        div.appendChild(kv);
      }
    });
    jsonContainer.appendChild(div);
  });

  jsonContainer.querySelectorAll("input").forEach(input => {
    input.addEventListener("input", e => {
      const k = e.target.dataset.key;
      const parent = e.target.dataset.parent;
      jsonData[parent][k] = e.target.value;
      pushUndo();
    });
  });
}

// ---------------------
// ADD NEW REQUIREMENT UI
// ---------------------

showAddFormBtn.addEventListener("click", () => {
  buildAddForm();
  addSection.style.display = "block";
  showAddFormBtn.style.display = "none";
});

// Build empty fields matching structure
function buildAddForm() {
  addRows.innerHTML = "";
  const sample = jsonData[Object.keys(jsonData)[0]] || {};
  const keys = Object.keys(sample);

  keys.forEach(k => {
    const wrapper = document.createElement("div");
    wrapper.className = "key-value";

    // REQUIRED placeholder only for key, unit, function
    const isRequired = (k === "id" || k === "unit" || k === "function");
    const placeholder = isRequired ? "(required)" : "";

    wrapper.innerHTML = `
      <div style="width:120px">${k}:</div>
      <input data-key="${k}" placeholder="${placeholder}" />
    `;
    addRows.appendChild(wrapper);
  });
}


// Cancel add requirement
addCancelBtn.addEventListener("click", () => {
  addSection.style.display = "none";
  showAddFormBtn.style.display = "block";
});

addConfirmBtn.addEventListener("click", () => {
  const newEntry = {};
  const inputs = addRows.querySelectorAll("input");

  // Clear previous error states
  inputs.forEach(inp => inp.classList.remove("input-error"));

  inputs.forEach(inp => newEntry[inp.dataset.key] = inp.value.trim());

  // Validate required fields
  let valid = true;
  ["unit", "function", "id"].forEach(requiredKey => {
    const field = addRows.querySelector(`input[data-key="${requiredKey}"]`);
    if (!newEntry[requiredKey]) {
      valid = false;
      field.classList.add("input-error");
    }
  });

  if (!valid) return; // Stop, show red highlight

  jsonData[newEntry.id] = newEntry;

  pushUndo();
  renderObjects();

  // Hide form again
  addSection.style.display = "none";
  showAddFormBtn.style.display = "block";
});

