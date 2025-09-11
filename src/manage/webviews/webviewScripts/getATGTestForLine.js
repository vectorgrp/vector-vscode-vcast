const vscode = acquireVsCodeApi();

window.addEventListener("DOMContentLoaded", () => {
  const dialogTitle = document.getElementById("dialogTitle");
  const fileInput = document.getElementById("sourceFileInput");
  const lineInput = document.getElementById("lineNumberInput");
  const enviroSelect = document.getElementById("enviroPathSelect");

  const varSelect = document.getElementById("varSelect");
  const varValueInput = document.getElementById("varValueInput");
  const btnAddVar = document.getElementById("btnAddVar");
  const varList = document.getElementById("varList");

  const codeBlock = document.getElementById("codeBlock");

  // Prefill from defaults
  fileInput.value = window.defaultSourceFile || "";
  lineInput.value = window.defaultLineNumber || "";

  // Populate environment dropdown if present & data provided.
  if (enviroSelect) {
    enviroSelect.innerHTML = ""; // clear
    if (Array.isArray(window.enviroPaths) && window.enviroPaths.length > 0) {
      window.enviroPaths.forEach((fullPath) => {
        const opt = document.createElement("option");
        opt.value = fullPath;
        opt.textContent = fullPath.split(/[/\\]/).pop();
        enviroSelect.appendChild(opt);
      });
      enviroSelect.selectedIndex = 0;
    } else {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "-- no environments --";
      placeholder.disabled = true;
      placeholder.selected = true;
      enviroSelect.appendChild(placeholder);
    }
  }

  const functionTitle = document.getElementById("functionTitle");

  // Function info
  const fn = window.fileFunction || {
    name: null,
    params: [],
    startLine: 1,
    endLine: 1,
    code: "",
    selectedLine: 1,
  };
  
  if (functionTitle) {
    if (fn && fn.name) {
      const paramsPreview = (fn.params || []).join(", ");
      functionTitle.textContent = `Source Function: ${fn.name}(${paramsPreview}) [lines ${fn.startLine}-${fn.endLine}]`;
    } else {
      functionTitle.textContent = "Source Function: (file-level)";
    }
  }
  
  // Render code: split into lines, show absolute line numbers (startLine + idx),
  // highlight the absolute selected line (startLine + selectedLine - 1)
  function renderFunctionCode(codeText, startLine, selectedLineWithinFunction) {
    codeBlock.innerHTML = ""; // clear
    const lines = codeText.replace(/\t/g, "    ").split(/\r?\n/);
    const absSelectedLine = Number(startLine) + Number(selectedLineWithinFunction) - 1;

    lines.forEach((ln, idx) => {
      const gutterNumber = Number(startLine) + idx; // absolute file line

      const row = document.createElement("div");
      row.className = "code-line";
      row.dataset.line = String(gutterNumber);

      const gutter = document.createElement("span");
      gutter.className = "gutter";
      const pad = Math.max(4, String(fn.endLine).length);
      gutter.textContent = String(gutterNumber).padStart(pad, " ");

      const content = document.createElement("span");
      content.className = "content";
      content.textContent = ln || " ";

      row.appendChild(gutter);
      row.appendChild(content);

      if (gutterNumber === absSelectedLine) {
        row.classList.add("highlight");
        setTimeout(() => {
          row.scrollIntoView({ block: "center", behavior: "smooth" });
        }, 50);
      }

      codeBlock.appendChild(row);
    });
  }

  // Populate variable dropdown (file-level)
  const variables = Array.isArray(window.fileVariables) ? window.fileVariables : [];
  varSelect.innerHTML = "";
  const customOpt = document.createElement("option");
  customOpt.value = "__custom__";
  customOpt.textContent = "-- custom variable name --";
  varSelect.appendChild(customOpt);
  for (const v of variables) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    varSelect.appendChild(o);
  }

  // list of {name, value}
  const chosen = [];

  function renderVarList() {
    varList.innerHTML = "";
    if (chosen.length === 0) {
      const p = document.createElement("div");
      p.textContent = "No variable/value pairs added.";
      p.style.color = "#bfbfbf";
      varList.appendChild(p);
      return;
    }

    chosen.forEach((pair, idx) => {
      const item = document.createElement("div");
      item.className = "var-item";
      item.dataset.index = String(idx);

      const key = document.createElement("div");
      key.className = "var-key";
      key.title = pair.name;
      key.textContent = pair.name;

      const value = document.createElement("div");
      value.className = "var-value";
      value.title = pair.value;
      value.textContent = pair.value;

      const btnRem = document.createElement("button");
      btnRem.className = "remove-button";
      btnRem.type = "button";
      btnRem.title = `Remove ${pair.name}`;
      btnRem.setAttribute("aria-label", `Remove variable ${pair.name}`);
      btnRem.innerHTML = "✖";

      btnRem.addEventListener("click", () => {
        const removeIndex = Number(item.dataset.index);
        if (!Number.isNaN(removeIndex)) {
          chosen.splice(removeIndex, 1);
          renderVarList();
        }
      });

      item.appendChild(key);
      item.appendChild(value);
      item.appendChild(btnRem);
      varList.appendChild(item);
    });
  }

  function addVariableFromInputs() {
    let varName = varSelect.value;
    if (varName === "__custom__") {
      varName = prompt("Enter custom variable name:");
      if (!varName) return;
    }
    const val = varValueInput.value.trim();
    if (!val) {
      alert("Please enter a value for the variable.");
      return;
    }
    const existingIndex = chosen.findIndex(c => c.name === varName);
    if (existingIndex >= 0) {
      chosen.splice(existingIndex, 1);
    }
    chosen.push({ name: varName, value: val });
    varValueInput.value = "";
    varValueInput.focus();
    renderVarList();
  }

  btnAddVar.addEventListener("click", addVariableFromInputs);

  varValueInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addVariableFromInputs();
    }
  });

  // Submit
  document.getElementById("btnSubmit").addEventListener("click", () => {
    vscode.postMessage({
      command: "submit",
      sourceFile: fileInput.value.trim(),
      line: lineInput.value.trim(),
      enviroPath: enviroSelect ? enviroSelect.value : "",
      variableValues: chosen,
    });
  });

  // Cancel
  document.getElementById("btnCancel").addEventListener("click", () => {
    vscode.postMessage({ command: "cancel" });
  });

  // initial render of function code using absolute gutter numbers
  renderFunctionCode(fn.code || "", fn.startLine || 1, fn.selectedLine || 1);
  renderVarList();
});
