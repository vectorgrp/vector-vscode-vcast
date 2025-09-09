const vscode = acquireVsCodeApi();

window.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("sourceFileInput");
  const lineInput = document.getElementById("lineNumberInput");
  const enviroSelect = document.getElementById("enviroPathSelect");

  // Prefill from defaults
  fileInput.value = window.defaultSourceFile || "";
  lineInput.value = window.defaultLineNumber || "";

  // Populate environment dropdown
  if (Array.isArray(window.enviroPaths)) {
    enviroSelect.innerHTML = ""; // clear
    window.enviroPaths.forEach((fullPath) => {
      const opt = document.createElement("option");
      // full path submitted
      opt.value = fullPath;        
      // only basename shown               
      opt.textContent = fullPath.split(/[/\\]/).pop();
      enviroSelect.appendChild(opt);
    });
  }

  // Submit
  document.getElementById("btnSubmit").addEventListener("click", () => {
    vscode.postMessage({
      command: "submit",
      sourceFile: fileInput.value.trim(),
      line: lineInput.value.trim(),
      enviroPath: enviroSelect.value, // submit full path
    });
  });

  // Cancel
  document.getElementById("btnCancel").addEventListener("click", () => {
    vscode.postMessage({ command: "cancel" });
  });
});
