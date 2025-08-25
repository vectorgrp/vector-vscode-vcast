const vscode = acquireVsCodeApi();

window.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("sourceFileInput");
  const lineInput = document.getElementById("lineNumberInput");

  // Prefill from defaults
  fileInput.value = window.defaultSourceFile || "";
  lineInput.value = window.defaultLineNumber || "";

  // Submit
  document.getElementById("btnSubmit").addEventListener("click", () => {
    vscode.postMessage({
      command: "submit",
      sourceFile: fileInput.value.trim(),
      line: lineInput.value.trim(),
    });
  });

  // Cancel
  document.getElementById("btnCancel").addEventListener("click", () => {
    vscode.postMessage({ command: "cancel" });
  });
});