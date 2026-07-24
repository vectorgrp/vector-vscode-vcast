const vscode = acquireVsCodeApi();

globalThis.addEventListener("DOMContentLoaded", () => {
  const compilers = globalThis.compilerData || [];
  const defaultDB = globalThis.defaultDB || "";

  // Folder picker
  const targetInput = document.getElementById("targetDirInput");
  let targetDir = globalThis.defaultDir || "";
  targetInput.value = targetDir;

  document.getElementById("btnBrowse").addEventListener("click", () => {
    vscode.postMessage({ command: "browseForDir" });
  });

  globalThis.addEventListener("message", (e) => {
    if (e.data.command === "setTargetDir") {
      targetDir = e.data.targetDir;
      targetInput.value = targetDir;
    }
  });

  // Language selector: C/C++ uses the compiler picker (CCAST_.CFG); Ada is
  // GNAT-on-host only, so it hides the compiler picker and coded-tests option
  // (the extension writes a minimal ADACAST_.CFG for it).
  const languageSelect = document.getElementById("languageSelect");
  const compilerSection = document.getElementById("compilerSection");
  const adaNote = document.getElementById("adaNote");
  const codedTestsRow = document.getElementById("codedTestsRow");

  function applyLanguage() {
    const isAda = languageSelect && languageSelect.value === "ada";
    if (compilerSection) compilerSection.style.display = isAda ? "none" : "";
    if (adaNote) adaNote.style.display = isAda ? "block" : "none";
    if (codedTestsRow) codedTestsRow.style.display = isAda ? "none" : "flex";
  }
  if (languageSelect) {
    languageSelect.addEventListener("change", applyLanguage);
    applyLanguage();
  }

  // Compiler autocomplete
  const compInput = document.getElementById("compilerInput");
  const suggestions = document.getElementById("suggestions");

  // Toggle checkboxes
  const codedCheckbox = document.getElementById("enableCodedTests");
  const defaultCheckbox = document.getElementById("defaultCFG");

  // DB elements
  const dbOptionRow = document.getElementById("dbOptionRow");
  const dbPathLabel = document.getElementById("dbPathLabel");
  const dbCheckbox = document.getElementById("useDefaultDB");

  if (globalThis.enableCodedTests !== undefined && codedCheckbox) {
    codedCheckbox.checked = !!globalThis.enableCodedTests;
  }
  if (globalThis.defaultCFG !== undefined && defaultCheckbox) {
    defaultCheckbox.checked = !!globalThis.defaultCFG;
  }

  if (defaultDB) {
    dbOptionRow.style.display = "flex";
    dbPathLabel.textContent = defaultDB;
  } else {
    dbOptionRow.style.display = "none";
  }

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
    const q = (compInput.value || "").toLowerCase().trim();
    filtered = showAll || !q
      ? [...compilers]
      : compilers.filter(c => c.toLowerCase().includes(q));
    activeIndex = -1;
    renderSuggestions();
  }

  compInput.addEventListener("input", () => updateSuggestions());
  compInput.addEventListener("focus", () => updateSuggestions(true));

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

  document.getElementById("btnSubmit").addEventListener("click", () => {
    vscode.postMessage({
      command: "submit",
      language: languageSelect ? languageSelect.value : "c",
      targetDir,
      compilerName: (compInput.value || "").trim(),
      enableCodedTests: !!(codedCheckbox && codedCheckbox.checked),
      defaultCFG: !!(defaultCheckbox && defaultCheckbox.checked),
      useDefaultDB: !!(dbCheckbox && dbCheckbox.checked),
    });
  });

  document.getElementById("btnCancel").addEventListener("click", () => {
    vscode.postMessage({ command: "cancel" });
  });
});