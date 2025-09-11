const vscode = acquireVsCodeApi();

window.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("sourceFileInput");
  const lineInput = document.getElementById("lineNumberInput");
  const enviroSelect = document.getElementById("enviroPathSelect");

  const varSelect = document.getElementById("varSelect");
  const varValueInput = document.getElementById("varValueInput");
  const btnAddVar = document.getElementById("btnAddVar");
  const varList = document.getElementById("varList");
  const functionNameDiv = document.getElementById("functionName");

  const codeBlock = document.getElementById("codeBlock");
  const functionCodeContainer = document.getElementById("functionCode");

  // Prefill from defaults
  fileInput.value = window.defaultSourceFile || "";
  lineInput.value = window.defaultLineNumber || "";

  // Populate environment dropdown
  if (Array.isArray(window.enviroPaths)) {
    enviroSelect.innerHTML = ""; // clear
    window.enviroPaths.forEach((fullPath) => {
      const opt = document.createElement("option");
      opt.value = fullPath;
      opt.textContent = fullPath.split(/[/\\]/).pop();
      enviroSelect.appendChild(opt);
    });
  }

  // Function info (ensure defaults exist)
  const fn = window.fileFunction || {
    name: null,
    params: [],
    startLine: 1,
    endLine: 1,
    code: "",
    selectedLine: 1,
  };

  if (fn && fn.name) {
    functionNameDiv.textContent = `${fn.name}(${(fn.params || []).join(", ")}) [lines ${fn.startLine}-${fn.endLine}]`;
  } else {
    functionNameDiv.textContent = "No function detected near this line (file-level context).";
  }

  // Render code: split into lines, show absolute line numbers (startLine + idx),
  // highlight the absolute selected line (startLine + selectedLine - 1)
  function renderFunctionCode(codeText, startLine, selectedLineWithinFunction) {
    codeBlock.innerHTML = ""; // clear
    const lines = codeText.replace(/\t/g, "    ").split(/\r?\n/);
    const absSelectedLine = Number(startLine) + Number(selectedLineWithinFunction) - 1;

    lines.forEach((ln, idx) => {
      const lineNo = idx + 1; // 1-based inside function
      const gutterNumber = Number(startLine) + idx; // absolute file line

      const row = document.createElement("div");
      row.className = "code-line";
      row.dataset.line = String(gutterNumber);

      const gutter = document.createElement("span");
      gutter.className = "gutter";
      // pad to at least width 4 but adapt to bigger numbers
      const pad = Math.max(4, String(fn.endLine).length);
      gutter.textContent = String(gutterNumber).padStart(pad, " ");

      const content = document.createElement("span");
      content.className = "content";
      content.textContent = ln || " "; // keep empty lines visible

      row.appendChild(gutter);
      row.appendChild(content);

      if (gutterNumber === absSelectedLine) {
        row.classList.add("highlight");
        // scroll to center later
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
      varList.textContent = "No variable/value pairs added.";
      return;
    }
    chosen.forEach((pair, idx) => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.gap = "8px";
      row.style.alignItems = "center";
      row.style.marginBottom = "6px";

      const name = document.createElement("div");
      name.textContent = pair.name;
      name.style.minWidth = "140px";
      name.style.color = "#e6e6e6";

      const val = document.createElement("div");
      val.textContent = pair.value;
      val.style.flex = "1";
      val.style.color = "#bfbfbf";

      const btnRem = document.createElement("button");
      btnRem.textContent = "Remove";
      btnRem.addEventListener("click", () => {
        chosen.splice(idx, 1);
        renderVarList();
      });

      row.appendChild(name);
      row.appendChild(val);
      row.appendChild(btnRem);
      varList.appendChild(row);
    });
  }

  btnAddVar.addEventListener("click", () => {
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
    if (existingIndex >= 0) chosen.splice(existingIndex, 1);
    chosen.push({ name: varName, value: val });
    varValueInput.value = "";
    renderVarList();
  });

  // Submit
  document.getElementById("btnSubmit").addEventListener("click", () => {
    vscode.postMessage({
      command: "submit",
      sourceFile: fileInput.value.trim(),
      line: lineInput.value.trim(),
      enviroPath: enviroSelect.value,
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
