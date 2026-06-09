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

  // ── Source pane ────────────────────────────────────────────────────
  const srcFilenameEl = document.getElementById("source-filename");
  const srcBody = document.getElementById("source-body");
  // Strip the workspace prefix so the pane header is just the basename
  // (full path is already in the subtitle).
  srcFilenameEl.textContent = (payload.sourceFile || "").split("/").pop() || "";

  // Build click-to-jump indices for the source pane.
  //   pathToRowIndex maps a fully-qualified dotted path → row index
  //     (e.g. "pt.x" → its own row). Array suffixes are stripped, so
  //     "arr[*]" indexes as "arr".
  //   rootToRowIndex maps a bare root identifier → first matching row
  //     (e.g. "pt" → the first pt.* row). Used as a fall-back when no
  //     longer dotted match exists.
  const pathToRowIndex = new Map();
  const rootToRowIndex = new Map();
  payload.rows.forEach((row, idx) => {
    const ns = row.nodeStr || "";
    const path = ns.replace(/\[[^\]]*\]/g, "");
    if (path && !pathToRowIndex.has(path)) pathToRowIndex.set(path, idx);
    const root = (path.match(/^[A-Za-z_]\w*/) || [])[0];
    if (root && !rootToRowIndex.has(root)) rootToRowIndex.set(root, idx);
  });

  // ── Tiny C/C++ lexer (keyword/type sets) ──────────────────────────
  // Declared *before* the source-rendering loop, because renderCodeLine
  // -> pushIdent reads them and the loop fires immediately. `const`
  // declarations are in the temporal dead zone until the line that
  // declares them is reached.

  const C_KEYWORDS = new Set([
    "auto", "break", "case", "const", "continue", "default", "do",
    "else", "enum", "extern", "for", "goto", "if", "register",
    "return", "sizeof", "static", "struct", "switch", "typedef",
    "union", "volatile", "while", "inline", "restrict", "_Bool",
    "_Static_assert", "_Atomic",
    // C++ extras (mild guess — we lex .cpp the same way)
    "class", "namespace", "template", "typename", "public", "private",
    "protected", "virtual", "override", "final", "new", "delete",
    "this", "nullptr", "constexpr", "noexcept", "using",
  ]);
  const C_TYPES = new Set([
    "void", "char", "short", "int", "long", "float", "double",
    "signed", "unsigned", "bool", "size_t", "ssize_t", "ptrdiff_t",
    "int8_t", "int16_t", "int32_t", "int64_t",
    "uint8_t", "uint16_t", "uint32_t", "uint64_t",
    "intptr_t", "uintptr_t", "FILE", "wchar_t",
  ]);

  const sourceText = typeof payload.sourceContent === "string"
    ? payload.sourceContent
    : "";
  const lines = sourceText.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  // Lexer state carries across lines for multi-line /* ... */ comments.
  let inBlockComment = false;
  lines.forEach((line, idx) => {
    const tr = document.createElement("tr");
    const numTd = document.createElement("td");
    numTd.className = "lineno";
    numTd.textContent = String(idx + 1);
    const codeTd = document.createElement("td");
    codeTd.className = "codeline";
    inBlockComment = renderCodeLine(codeTd, line, inBlockComment);
    tr.appendChild(numTd);
    tr.appendChild(codeTd);
    srcBody.appendChild(tr);
  });

  function pushText(td, text) {
    if (text) td.appendChild(document.createTextNode(text));
  }
  function pushSpan(td, cls, text) {
    const span = document.createElement("span");
    span.className = cls;
    span.textContent = text;
    td.appendChild(span);
  }
  // pushIdent renders one identifier token (bare or dotted). Keywords
  // and primitive types take precedence over click-jump (no underlining
  // of `int` or `struct`). Otherwise: if a row matches this exact text,
  // make it clickable; if not, fall back to plain text.
  function pushIdent(td, text) {
    if (C_KEYWORDS.has(text)) {
      pushSpan(td, "tok-keyword", text);
      return;
    }
    if (C_TYPES.has(text)) {
      pushSpan(td, "tok-type", text);
      return;
    }
    const rowIndex = pathToRowIndex.has(text)
      ? pathToRowIndex.get(text)
      : rootToRowIndex.has(text)
        ? rootToRowIndex.get(text)
        : null;
    if (rowIndex !== null) {
      const span = document.createElement("span");
      span.className = "src-ident";
      span.textContent = text;
      span.dataset.rowIndex = String(rowIndex);
      span.addEventListener("click", onIdentifierClick);
      td.appendChild(span);
    } else {
      pushText(td, text);
    }
  }

  function renderCodeLine(td, line, inBlockComment) {
    let i = 0;
    const n = line.length;
    while (i < n) {
      // Continue an open /* */ comment from a previous line.
      if (inBlockComment) {
        const end = line.indexOf("*/", i);
        if (end === -1) {
          pushSpan(td, "tok-comment", line.slice(i));
          return true;
        }
        pushSpan(td, "tok-comment", line.slice(i, end + 2));
        i = end + 2;
        inBlockComment = false;
        continue;
      }
      const c = line[i];
      const c2 = line.slice(i, i + 2);

      // Line comment
      if (c2 === "//") {
        pushSpan(td, "tok-comment", line.slice(i));
        return false;
      }
      // Block comment
      if (c2 === "/*") {
        const end = line.indexOf("*/", i + 2);
        if (end === -1) {
          pushSpan(td, "tok-comment", line.slice(i));
          return true;
        }
        pushSpan(td, "tok-comment", line.slice(i, end + 2));
        i = end + 2;
        continue;
      }
      // Preprocessor directive — colour from # to end of line, but
      // first ensure we're at the start of the (non-whitespace) line.
      if (c === "#") {
        const before = line.slice(0, i);
        if (/^\s*$/.test(before)) {
          pushSpan(td, "tok-preproc", line.slice(i));
          return inBlockComment;
        }
      }
      // String literal "..."
      if (c === '"') {
        let j = i + 1;
        while (j < n && line[j] !== '"') {
          if (line[j] === "\\" && j + 1 < n) j += 2;
          else j += 1;
        }
        if (j < n) j += 1; // include the closing quote if present
        pushSpan(td, "tok-string", line.slice(i, j));
        i = j;
        continue;
      }
      // Char literal '...'
      if (c === "'") {
        let j = i + 1;
        while (j < n && line[j] !== "'") {
          if (line[j] === "\\" && j + 1 < n) j += 2;
          else j += 1;
        }
        if (j < n) j += 1;
        pushSpan(td, "tok-string", line.slice(i, j));
        i = j;
        continue;
      }
      // Number (decimal, hex, float). Accepts trailing U/L/UL/f suffixes.
      if (/\d/.test(c) || (c === "." && i + 1 < n && /\d/.test(line[i + 1]))) {
        let j = i;
        if (line.slice(i, i + 2).match(/^0[xX]$/)) {
          j = i + 2;
          while (j < n && /[0-9a-fA-F_']/.test(line[j])) j += 1;
        } else {
          while (j < n && /[0-9.eE+\-_']/.test(line[j])) {
            // Allow + or - only right after an e/E
            if ((line[j] === "+" || line[j] === "-") &&
                !(j > i && (line[j - 1] === "e" || line[j - 1] === "E"))) {
              break;
            }
            j += 1;
          }
        }
        while (j < n && /[uUlLfF]/.test(line[j])) j += 1;
        pushSpan(td, "tok-number", line.slice(i, j));
        i = j;
        continue;
      }
      // Identifier — optionally extended through .field accesses so
      // that pt.x is recognised as one clickable span (matching the
      // pt.x row) rather than `pt` + `.x`. Longest dotted match wins;
      // if no full dotted path matches a row, we fall back to the
      // shortest sequence (bare ident only).
      if (/[A-Za-z_]/.test(c)) {
        let j = i + 1;
        while (j < n && /[A-Za-z0-9_]/.test(line[j])) j += 1;

        // Capture segment end positions so we can shrink back if the
        // full path doesn't match any row.
        const ends = [j];
        let k = j;
        while (k < n && line[k] === ".") {
          const sStart = k + 1;
          if (sStart >= n || !/[A-Za-z_]/.test(line[sStart])) break;
          let sEnd = sStart + 1;
          while (sEnd < n && /[A-Za-z0-9_]/.test(line[sEnd])) sEnd += 1;
          ends.push(sEnd);
          k = sEnd;
        }

        // Longest-first match.
        let consumed = j;
        for (let depth = ends.length; depth >= 1; depth -= 1) {
          const end = ends[depth - 1];
          const candidate = line.slice(i, end);
          if (pathToRowIndex.has(candidate)) {
            pushIdent(td, candidate);
            consumed = end;
            break;
          }
        }
        if (consumed === j) {
          // No dotted match — fall back to bare ident (pushIdent will
          // still root-match if applicable).
          pushIdent(td, line.slice(i, j));
        }
        i = consumed;
        continue;
      }
      // Punctuation / operators / whitespace — passthrough.
      pushText(td, c);
      i += 1;
    }
    return inBlockComment;
  }

  function onIdentifierClick(ev) {
    const idx = Number(ev.currentTarget.dataset.rowIndex);
    if (Number.isNaN(idx)) return;
    const targetRow = document.querySelector(
      `#rows-body tr[data-row-index="${idx}"]`
    );
    if (!targetRow) return;
    targetRow.scrollIntoView({ behavior: "smooth", block: "center" });
    targetRow.classList.add("flash");
    // Drop the flash class after the CSS animation completes (~1.2s)
    // so a re-click can re-trigger it.
    setTimeout(() => targetRow.classList.remove("flash"), 1300);
  }

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
    tr.dataset.rowIndex = String(idx);
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

  // Parse a value cell into the decimal-string form pyatg accepts.
  // Returns null for invalid input. Empty string returns null too;
  // callers check that separately (mid-typing is allowed).
  //
  // Accepts:
  //   42, -7, 0x63                -- numeric literals
  //   'c', '\n', '\\', '\x63'     -- C-style char literals (normalised)
  // pyatg's own inline-value parser rejects 'c' as a named-class
  // reference, so we convert client-side before submit.
  const NAMED_ESCAPES = {
    n: 10, t: 9, r: 13, "0": 0, "\\": 92,
    "'": 39, '"': 34, b: 8, f: 12, v: 11, a: 7,
  };

  function parseValue(s) {
    s = s.trim();
    if (s === "") return null;
    if (/^-?\d+$/.test(s)) return s;
    if (/^0x[0-9a-fA-F]+$/.test(s)) return String(parseInt(s, 16));
    const m = s.match(/^'(.+)'$/);
    if (!m) return null;
    const inner = m[1];
    if (inner.length === 1 && inner !== "\\") {
      return String(inner.charCodeAt(0));
    }
    if (inner[0] === "\\") {
      const esc = inner.slice(1);
      const hx = esc.match(/^x([0-9a-fA-F]+)$/);
      if (hx) return String(parseInt(hx[1], 16));
      const oct = esc.match(/^([0-7]{1,3})$/);
      if (oct) return String(parseInt(oct[1], 8));
      if (esc.length === 1 && NAMED_ESCAPES.hasOwnProperty(esc)) {
        return String(NAMED_ESCAPES[esc]);
      }
    }
    return null;
  }

  function isValidValue(s) {
    if (s.trim() === "") return true;
    return parseValue(s) !== null;
  }

  function markInputValidity(inp) {
    if (isValidValue(inp.value)) {
      inp.classList.remove("invalid");
      inp.title = "";
    } else {
      inp.classList.add("invalid");
      inp.title =
        "Enter an integer (42, -7, 0x63) or a C char literal ('c', '\\n', '\\x63').";
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
        const v = parseValue(entry.value);
        if (v === null) {
          badRowIndices.push(idx);
          return;
        }
        entry.value = v;
      } else if (s.mode === "Range") {
        if (entry.lo === "" || entry.hi === "") return;
        const lo = parseValue(entry.lo);
        const hi = parseValue(entry.hi);
        if (lo === null || hi === null) {
          badRowIndices.push(idx);
          return;
        }
        entry.lo = lo;
        entry.hi = hi;
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
