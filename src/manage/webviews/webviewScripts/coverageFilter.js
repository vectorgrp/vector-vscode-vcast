const vscode = acquireVsCodeApi();

window.addEventListener("DOMContentLoaded", () => {
  /** @type {string[]} */
  const enviros = window.enviroData || [];
  /** @type {string[]} */
  const enabledEnviros = window.enabledEnviros || [];
  /** @type {string} */
  const filePath = window.filePath || "";

  document.getElementById("fileLabel").textContent = filePath;

  const listEl = document.getElementById("enviroList");

  // Track state: map enviroPath -> checked boolean
  /** @type {Map<string, boolean>} */
  const state = new Map();
  for (const e of enviros) {
    // enabled if present in enabledEnviros (or enabledEnviros is empty → all enabled)
    const isEnabled =
      enabledEnviros.length === 0 ? true : enabledEnviros.includes(e);
    state.set(e, isEnabled);
  }

  function renderList() {
    listEl.innerHTML = "";
    if (enviros.length === 0) {
      const msg = document.createElement("div");
      msg.className = "empty-msg";
      msg.textContent = "No environments found for this file.";
      listEl.appendChild(msg);
      return;
    }

    for (const envPath of enviros) {
      const checked = state.get(envPath) ?? true;

      const item = document.createElement("div");
      item.className = "enviro-item" + (checked ? " checked" : "");

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.id = "cb_" + envPath;
      cb.checked = checked;

      const lbl = document.createElement("label");
      lbl.htmlFor = cb.id;
      lbl.textContent = envPath;

      cb.addEventListener("change", () => {
        state.set(envPath, cb.checked);
        item.classList.toggle("checked", cb.checked);
      });

      // clicking the row also toggles
      item.addEventListener("click", (e) => {
        if (e.target === cb || e.target === lbl) return;
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event("change"));
      });

      item.appendChild(cb);
      item.appendChild(lbl);
      listEl.appendChild(item);
    }
  }

  renderList();

  document.getElementById("btnSelectAll").addEventListener("click", () => {
    for (const k of state.keys()) state.set(k, true);
    renderList();
  });

  document.getElementById("btnDeselectAll").addEventListener("click", () => {
    for (const k of state.keys()) state.set(k, false);
    renderList();
  });

  document.getElementById("btnApply").addEventListener("click", () => {
    const enabled = [...state.entries()]
      .filter(([, v]) => v)
      .map(([k]) => k);
    vscode.postMessage({ command: "apply", filePath, enabledEnviros: enabled });
  });

  document.getElementById("btnCancel").addEventListener("click", () => {
    vscode.postMessage({ command: "cancel" });
  });
});
