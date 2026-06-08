(function () {
  // VS Code injects acquireVsCodeApi on the global scope.
  const vscode = acquireVsCodeApi();

  const payloadEl = document.getElementById("payload");
  const payload = JSON.parse(payloadEl.textContent || "{}");

  const subtitle = document.getElementById("subtitle");
  subtitle.textContent = `${payload.sourceFile}  ·  env: ${payload.enviroPath}`;

  const rowCount = document.getElementById("row-count");
  rowCount.textContent = `${payload.rows.length} controllable input${
    payload.rows.length === 1 ? "" : "s"
  }`;

  const body = document.getElementById("rows-body");
  for (const row of payload.rows) {
    const tr = document.createElement("tr");
    const cells = [
      row.scope,
      row.routine,
      row.nodeStr,
      row.nodeType,
      row.annotation,
    ];
    for (const c of cells) {
      const td = document.createElement("td");
      td.textContent = c;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }

  document.getElementById("btn-generate").addEventListener("click", () => {
    vscode.postMessage({ command: "generate" });
  });
  document.getElementById("btn-cancel").addEventListener("click", () => {
    vscode.postMessage({ command: "cancel" });
  });
})();
