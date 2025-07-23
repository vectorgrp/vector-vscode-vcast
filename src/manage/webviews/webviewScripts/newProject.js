const vscode = acquireVsCodeApi();

window.addEventListener("DOMContentLoaded", () => {
  const root = window.workspaceRoot || "";
  const compilers = window.compilerData || [];

  document.getElementById("workspaceDisplay").textContent = root;

  const nameInput = document.getElementById("projectNameInput");
  const compInput = document.getElementById("compilerInput");
  const suggestions = document.getElementById("suggestions");

  let filtered = [], activeIndex = -1;

  function renderSuggestions() {
    suggestions.innerHTML = "";
    if (!filtered.length) {
      suggestions.classList.remove("visible");
      return;
    }
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
    if (!e.target.closest(".autocomplete")) {
      suggestions.classList.remove("visible");
    }
  });

  document.getElementById("btnSubmit").addEventListener("click", () => {
    const projectName  = nameInput.value.trim();
    const compilerName = compInput.value.trim();
    vscode.postMessage({ command: 'submit', projectName, compilerName });
  });

  document.getElementById("btnCancel").addEventListener("click", () => {
    vscode.postMessage({ command: 'cancel' });
  });
});