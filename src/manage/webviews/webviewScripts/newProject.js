const vscode = acquireVsCodeApi();

window.addEventListener("DOMContentLoaded", () => {
  const compilers = window.compilerData || [];
  const defaultDir = window.defaultDir || "";

  const targetInput = document.getElementById("targetDirInput");
  const browseBtn   = document.getElementById("btnBrowse");
  const nameInput   = document.getElementById("projectNameInput");
  const compInput   = document.getElementById("compilerInput");
  const suggestions = document.getElementById("suggestions");

  // initialize target folder
  let targetDir = defaultDir;
  targetInput.value = targetDir;

  // browse for folder
  browseBtn.addEventListener("click", () => {
    vscode.postMessage({ command: "browseForDir" });
  });

  // receive chosen folder
  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (msg.command === "setTargetDir") {
      targetDir = msg.targetDir;
      targetInput.value = targetDir;
    }
  });

  // autocomplete setup (unchanged)...
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

  // submit
  document.getElementById("btnSubmit").addEventListener("click", () => {
    vscode.postMessage({
      command: "submit",
      projectName: nameInput.value.trim(),
      compilerName: compInput.value.trim(),
      targetDir
    });
  });

  // cancel
  document.getElementById("btnCancel").addEventListener("click", () => {
    vscode.postMessage({ command: "cancel" });
  });
});