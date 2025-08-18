const vscode = acquireVsCodeApi();

window.addEventListener("DOMContentLoaded", () => {
  const projectName = window.projectName || "";
  const compilerData = window.compilerData || [];

  document.getElementById("projectNameDisplay").textContent = projectName;

  const input = document.getElementById("compilerInput");
  const suggestions = document.getElementById("suggestions");

  let filtered = [];
  let activeIndex = -1;

  function renderSuggestions(list) {
    suggestions.innerHTML = "";
    if (!list.length) {
      suggestions.classList.remove("visible");
      return;
    }

    list.forEach((item, i) => {
      const li = document.createElement("li");
      li.textContent = item;
      li.addEventListener("mousedown", () => {
        input.value = item;
        suggestions.classList.remove("visible");
      });
      if (i === activeIndex) li.classList.add("active");
      suggestions.appendChild(li);
    });

    suggestions.classList.add("visible");
  }

  function updateSuggestions(showAll = false) {
    const value = input.value.toLowerCase().trim();
    filtered = showAll || !value
      ? [...compilerData]
      : compilerData.filter(c => c.toLowerCase().includes(value));

    activeIndex = -1;
    renderSuggestions(filtered);
  }

  input.addEventListener("input", () => updateSuggestions());
  input.addEventListener("focus", () => updateSuggestions(true));

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % filtered.length;
      renderSuggestions(filtered);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + filtered.length) % filtered.length;
      renderSuggestions(filtered);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[activeIndex]) {
        input.value = filtered[activeIndex];
        suggestions.classList.remove("visible");
      }
    } else if (e.key === "Escape") {
      suggestions.classList.remove("visible");
    }
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".autocomplete")) {
      suggestions.classList.remove("visible");
    }
  });

  // Always send 'submit' so extension validation runs
  document.getElementById("btnSubmit").addEventListener("click", () => {
    const compiler = input.value.trim();
    vscode.postMessage({ command: 'submit', compilerName: compiler });
  });

  document.getElementById("btnCancel").addEventListener("click", () => {
    vscode.postMessage({ command: 'cancel' });
  });
});
