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

  // Per-row UI state, indexed by row position in payload.rows.
  // Each entry: { mode: 'Auto'|'Fixed'|'Range', value: '', lo: '', hi: '', skipAdj: false }
  // Pre-populate from any persisted overrides the extension passed in
  // (re-runs of the same unit retain previous edits).
  const state = payload.rows.map(() => ({
    mode: "Auto",
    value: "",
    lo: "",
    hi: "",
    skipAdj: false,
  }));
  if (Array.isArray(payload.savedOverrides)) {
    for (const o of payload.savedOverrides) {
      if (typeof o.rowIndex !== "number") continue;
      if (o.rowIndex < 0 || o.rowIndex >= state.length) continue;
      state[o.rowIndex] = {
        mode: o.mode || "Auto",
        value: o.value || "",
        lo: o.lo || "",
        hi: o.hi || "",
        skipAdj: !!o.skipAdj,
      };
    }
  }

  // A row is "scalar-editable" if its annotation looks like enum:S:N or
  // enum:U:N. Arrays, pointers, function pointers stay Auto-only in
  // iteration 2.
  function isScalar(row) {
    return /^enum:[SU]:\d+/.test(row.annotation || "");
  }

  const body = document.getElementById("rows-body");
  payload.rows.forEach((row, idx) => {
    const tr = document.createElement("tr");
    if (!isScalar(row)) tr.classList.add("no-effect");

    appendText(tr, row.scope);
    appendText(tr, row.routine);
    appendText(tr, row.nodeStr);
    appendText(tr, row.nodeType);
    appendText(tr, row.annotation);

    const modeTd = document.createElement("td");
    const sel = document.createElement("select");
    sel.className = "mode-select";
    for (const opt of ["Auto", "Fixed", "Range"]) {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      sel.appendChild(o);
    }
    sel.value = state[idx].mode;
    sel.disabled = !isScalar(row);
    sel.addEventListener("change", () => {
      state[idx].mode = sel.value;
      renderValueCell(valueTd, idx, row);
    });
    modeTd.appendChild(sel);
    tr.appendChild(modeTd);

    const valueTd = document.createElement("td");
    valueTd.className = "value-cell";
    renderValueCell(valueTd, idx, row);
    tr.appendChild(valueTd);

    const skipTd = document.createElement("td");
    skipTd.className = "skip-cell";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = state[idx].skipAdj;
    cb.disabled = !isScalar(row);
    cb.addEventListener("change", () => {
      state[idx].skipAdj = cb.checked;
    });
    skipTd.appendChild(cb);
    tr.appendChild(skipTd);

    body.appendChild(tr);
  });

  function appendText(tr, text) {
    const td = document.createElement("td");
    td.textContent = text || "";
    tr.appendChild(td);
  }

  function renderValueCell(td, idx, row) {
    td.innerHTML = "";
    const s = state[idx];
    if (s.mode === "Auto" || !isScalar(row)) {
      const span = document.createElement("span");
      span.className = "dash";
      span.textContent = "—";
      td.appendChild(span);
      return;
    }
    if (s.mode === "Fixed") {
      const inp = makeInput(s.value || "", (v) => {
        s.value = v;
      });
      inp.placeholder = "value";
      td.appendChild(inp);
    } else if (s.mode === "Range") {
      const loInp = makeInput(s.lo || "", (v) => {
        s.lo = v;
      });
      loInp.placeholder = "lo";
      const sep = document.createElement("span");
      sep.textContent = ", ";
      const hiInp = makeInput(s.hi || "", (v) => {
        s.hi = v;
      });
      hiInp.placeholder = "hi";
      td.appendChild(loInp);
      td.appendChild(sep);
      td.appendChild(hiInp);
    }
  }

  function makeInput(initial, onChange) {
    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "value-input";
    inp.value = initial;
    inp.addEventListener("input", () => {
      onChange(inp.value);
      markInputValidity(inp);
    });
    markInputValidity(inp);
    return inp;
  }

  // Accept decimal (-?\d+), hex (0x[0-9a-f]+). Empty string is allowed
  // mid-typing — collectOverrides drops empty entries.
  function isNumericish(s) {
    if (s.trim() === "") return true;
    return /^-?\d+$/.test(s.trim()) || /^0x[0-9a-fA-F]+$/.test(s.trim());
  }

  function markInputValidity(inp) {
    if (isNumericish(inp.value)) {
      inp.classList.remove("invalid");
      inp.title = "";
    } else {
      inp.classList.add("invalid");
      inp.title =
        "Enter an integer (decimal or 0x-prefixed hex). For 'c' use 99.";
    }
  }

  // Collect overrides into the shape the extension expects. Auto rows
  // are omitted from the override list (autogen handles them). Empty
  // fields in Fixed/Range mode are treated as Auto with a console
  // warning — keeps a slip of the keyboard from breaking the run.
  // Returns { overrides, badRowIndices } so the caller can decide
  // whether to abort on validation errors. One bad row in manual mode
  // tanks the whole pyatg run, so we block submission until cleared.
  function collectOverrides() {
    const overrides = [];
    const badRowIndices = [];
    payload.rows.forEach((row, idx) => {
      const s = state[idx];
      if (!isScalar(row)) return;
      if (s.mode === "Auto" && !s.skipAdj) return;
      const entry = {
        rowIndex: idx,
        mode: s.mode,
        skipAdj: s.skipAdj,
        value: s.value.trim(),
        lo: s.lo.trim(),
        hi: s.hi.trim(),
      };
      if (s.mode === "Fixed") {
        if (entry.value === "") return;
        if (!isNumericish(entry.value)) {
          badRowIndices.push(idx);
          return;
        }
      } else if (s.mode === "Range") {
        if (entry.lo === "" || entry.hi === "") return;
        if (!isNumericish(entry.lo) || !isNumericish(entry.hi)) {
          badRowIndices.push(idx);
          return;
        }
      }
      overrides.push(entry);
    });
    return { overrides, badRowIndices };
  }

  function renderError(text) {
    let bar = document.getElementById("error-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "error-bar";
      bar.className = "error-bar";
      document.body.insertBefore(bar, document.querySelector("footer"));
    }
    bar.textContent = text;
    bar.style.display = text ? "block" : "none";
  }

  document.getElementById("btn-generate").addEventListener("click", () => {
    const { overrides, badRowIndices } = collectOverrides();
    if (badRowIndices.length > 0) {
      const bad = badRowIndices
        .map((i) => payload.rows[i].nodeStr)
        .join(", ");
      renderError(
        `Cannot submit: non-numeric value(s) in ${bad}. Fix the highlighted field(s) and try again.`
      );
      return;
    }
    renderError("");
    vscode.postMessage({ command: "generate", overrides });
  });
  document.getElementById("btn-cancel").addEventListener("click", () => {
    vscode.postMessage({ command: "cancel" });
  });
})();
