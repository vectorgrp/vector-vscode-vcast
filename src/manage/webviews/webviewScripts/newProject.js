const vscode = acquireVsCodeApi();

window.addEventListener("DOMContentLoaded", () => {
  const compilers = window.compilerData || [];
  const defaultCFG = window.defaultCFG || "";
  const defaultRow = document.getElementById("defaultCompilerRow");
  const defaultPath = document.getElementById("defaultCFGPath");
  const orSeparator = document.getElementById("orSeparator");
  const useDefaultCheckbox = document.getElementById("useDefaultCompiler");
  const newCompilerSection = document.getElementById("newCompilerSection");

  const targetInput = document.getElementById("targetDirInput");
  const browseBtn = document.getElementById("btnBrowse");
  const nameInput = document.getElementById("projectNameInput");
  const compInput = document.getElementById("compilerInput");
  const suggestions = document.getElementById("suggestions");

  // Show default CFG row + OR only if defaultCFG exists
  if (defaultCFG) {
    defaultRow.style.display = "flex";
    orSeparator.style.display = "block";
    defaultPath.textContent = defaultCFG;
  } else {
    defaultRow.style.display = "none";
    orSeparator.style.display = "none";
  }

  function updateCompilerVisibility() {
    if (useDefaultCheckbox && useDefaultCheckbox.checked) {
      newCompilerSection.style.display = "none";
      orSeparator.style.display = "none"; // hide OR when default is selected
    } else {
      newCompilerSection.style.display = "block";
      if (defaultCFG) orSeparator.style.display = "block";
    }
  }

  if (useDefaultCheckbox) useDefaultCheckbox.addEventListener("change", updateCompilerVisibility);
  updateCompilerVisibility();

  // Folder browse
  let targetDir = window.defaultDir || "";
  targetInput.value = targetDir;
  browseBtn.addEventListener("click", () => {
    vscode.postMessage({ command: "browseForDir" });
  });
  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (msg.command === "setTargetDir") {
      targetDir = msg.targetDir;
      targetInput.value = targetDir;
    }
  });

  // Autocomplete
  let filtered = [], activeIndex = -1;

  function renderSuggestions() {
    suggestions.innerHTML = "";
    if (!filtered.length) return suggestions.classList.remove("visible");
    filtered.forEach((item, i) => {
      const li = document.createElement("li");
      li.textContent = item;
      if (i === activeIndex) li.classList.add("active");
      li.addEventListener("mousedown", () => {
        compInput.value = item;
        suggestions.classList.remove("visible");
      });
      suggestions.appendChild(li);
    });
    suggestions.classList.add("visible");
  }

  function updateSuggestions(showAll = false) {
    const q = compInput.value.toLowerCase().trim();
    filtered = showAll || !q
      ? [...compilers]
      : compilers.filter(c => c.toLowerCase().includes(q));
    activeIndex = -1;
    renderSuggestions();
  }

  compInput.addEventListener("input", () => updateSuggestions());
  compInput.addEventListener("focus", () => updateSuggestions(true));
  compInput.addEventListener("click", () => updateSuggestions(true));
  compInput.addEventListener("keydown", e => {
    if (!filtered.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % filtered.length;
      renderSuggestions();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + filtered.length) % filtered.length;
      renderSuggestions();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[activeIndex]) {
        compInput.value = filtered[activeIndex];
        suggestions.classList.remove("visible");
      }
    } else if (e.key === "Escape") {
      suggestions.classList.remove("visible");
    }
  });
  document.addEventListener("click", e => {
    if (!e.target.closest(".autocomplete")) suggestions.classList.remove("visible");
  });

  // Submit
  document.getElementById("btnSubmit").addEventListener("click", () => {
    vscode.postMessage({
      command: "submit",
      projectName: nameInput.value.trim(),
      compilerName: useDefaultCheckbox && useDefaultCheckbox.checked
        ? undefined
        : compInput.value.trim(),
      useDefaultCFG: useDefaultCheckbox && useDefaultCheckbox.checked,
      targetDir,
    });
  });

  // Cancel
  document.getElementById("btnCancel").addEventListener("click", () => {
    vscode.postMessage({ command: "cancel" });
  });
});
