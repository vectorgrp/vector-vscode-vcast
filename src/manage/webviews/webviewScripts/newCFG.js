const vscode = acquireVsCodeApi();

window.addEventListener("DOMContentLoaded", () => {
  const compilers = window.compilerData || [];
  const defaultDB = window.defaultDB || "";

  const compInput = document.getElementById("compilerInput");
  const suggestions = document.getElementById("suggestions");

  // Toggle checkboxes
  const codedCheckbox = document.getElementById("enableCodedTests");
  const defaultCheckbox = document.getElementById("defaultCFG");

  // DB Elements
  const dbOptionRow = document.getElementById("dbOptionRow");
  const dbPathLabel = document.getElementById("dbPathLabel");
  const dbCheckbox = document.getElementById("useDefaultDB");

  // If extension injected defaults, apply them
  if (typeof window.enableCodedTests !== "undefined" && codedCheckbox) {
    codedCheckbox.checked = !!window.enableCodedTests;
  }
  if (typeof window.defaultCFG !== "undefined" && defaultCheckbox) {
    defaultCheckbox.checked = !!window.defaultCFG;
  }

  // --- DB Toggle Visibility Logic ---
  if (defaultDB) {
    // Setting exists and file exists -> Show the toggle
    dbOptionRow.style.display = "flex";
    dbPathLabel.textContent = defaultDB; 
  } else {
    // Setting empty OR file not found -> Keep hidden
    dbOptionRow.style.display = "none";
  }

  // Autocomplete setup
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

  // Submit button
  document.getElementById("btnSubmit").addEventListener("click", () => {
    vscode.postMessage({
      command: "submit",
      compilerName: (compInput.value || "").trim(),
      // Toggle Values
      enableCodedTests: !!(codedCheckbox && codedCheckbox.checked),
      defaultCFG: !!(defaultCheckbox && defaultCheckbox.checked),
      useDefaultDB: !!(dbCheckbox && dbCheckbox.checked)
    });
  });

  // Cancel button
  document.getElementById("btnCancel").addEventListener("click", () => {
    vscode.postMessage({ command: "cancel" });
  });
});