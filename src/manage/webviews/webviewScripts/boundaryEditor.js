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
  //   pathToRowIndex maps a normalised path (with bracket contents
  //     replaced by [*]) → row index. So "arr[*]" stays "arr[*]" and
  //     "arr" stays "arr"; they get separate entries.
  //   rootToRowIndex maps a bare root identifier → first matching row.
  //     Used only as a fall-back when no full path matches.
  // Normalisation: pyatg writes `arr[*]` for the element-wildcard and
  // also `arr[0]` for fixed-index overrides; we collapse both to the
  // wildcard form so a source occurrence of `arr[3]` matches `arr[*]`.
  function normalisePath(s) {
    return (s || "").replace(/\[[^\]]*\]/g, "[*]");
  }
  const pathToRowIndex = new Map();
  const rootToRowIndex = new Map();
  payload.rows.forEach((row, idx) => {
    const key = normalisePath(row.nodeStr);
    if (key && !pathToRowIndex.has(key)) pathToRowIndex.set(key, idx);
    const root = (key.match(/^[A-Za-z_]\w*/) || [])[0];
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
  // Render one bare identifier (no extension). Keywords / primitive
  // types take precedence over click-jump (we never underline `int`
  // or `struct`). Path lookup goes through normalisePath so e.g. a
  // raw `arr` in source still matches an `arr` row, but if no full
  // match exists falls back to the bare root.
  function pushIdent(td, text) {
    if (C_KEYWORDS.has(text)) {
      pushSpan(td, "tok-keyword", text);
      return;
    }
    if (C_TYPES.has(text)) {
      pushSpan(td, "tok-type", text);
      return;
    }
    const norm = normalisePath(text);
    const rowIndex = pathToRowIndex.has(norm)
      ? pathToRowIndex.get(norm)
      : rootToRowIndex.has(text)
        ? rootToRowIndex.get(text)
        : null;
    if (rowIndex !== null) {
      pushClickableIdent(td, text, rowIndex);
    } else {
      pushText(td, text);
    }
  }

  // Render an already-resolved clickable identifier span. Used by the
  // lexer when it has done its own longest-match lookup and just needs
  // to emit the result.
  function pushClickableIdent(td, text, rowIndex) {
    const span = document.createElement("span");
    span.className = "src-ident";
    span.textContent = text;
    span.dataset.rowIndex = String(rowIndex);
    span.addEventListener("click", onIdentifierClick);
    td.appendChild(span);
  }

  // Consume `[...]` starting at `start`, with nesting. Returns the
  // index just past the matching `]`, or `start` if line[start] isn't
  // `[`. Doesn't handle `]` inside strings — fine for typical C.
  function consumeBracketed(line, start) {
    if (line[start] !== "[") return start;
    let k = start + 1;
    let depth = 1;
    while (k < line.length && depth > 0) {
      if (line[k] === "[") depth += 1;
      else if (line[k] === "]") depth -= 1;
      k += 1;
    }
    return k;
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
      // Identifier — optionally extended through `[...]` and `.field`
      // accesses so that `arr[0]` is one clickable span pointing at
      // the arr[*] row, and `pt.x` is one span at the pt.x row.
      // Longest match wins; we record each candidate end and walk
      // back through them until one normalises to a known path.
      if (/[A-Za-z_]/.test(c)) {
        let j = i + 1;
        while (j < n && /[A-Za-z0-9_]/.test(line[j])) j += 1;
        // Optional bracketed index right after the bare identifier.
        j = consumeBracketed(line, j);

        const ends = [j];
        let cursor = j;
        while (cursor < n && line[cursor] === ".") {
          const segStart = cursor + 1;
          if (segStart >= n || !/[A-Za-z_]/.test(line[segStart])) break;
          let segEnd = segStart + 1;
          while (segEnd < n && /[A-Za-z0-9_]/.test(line[segEnd])) segEnd += 1;
          segEnd = consumeBracketed(line, segEnd);
          ends.push(segEnd);
          cursor = segEnd;
        }

        // Longest-first lookup via normalised path.
        let consumed = -1;
        for (let depth = ends.length; depth >= 1; depth -= 1) {
          const end = ends[depth - 1];
          const literal = line.slice(i, end);
          const norm = normalisePath(literal);
          if (pathToRowIndex.has(norm)) {
            pushClickableIdent(td, literal, pathToRowIndex.get(norm));
            consumed = end;
            break;
          }
        }
        if (consumed < 0) {
          // No dotted/bracketed match — emit just the bare ident and
          // let pushIdent decide (root fallback or plain text).
          const bareEnd = i + (line.slice(i).match(/^[A-Za-z_]\w*/) || [""])[0].length;
          pushIdent(td, line.slice(i, bareEnd));
          consumed = bareEnd;
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
  // Each entry: { mode, value, lo, hi, skipAdj, namedRef }
  //   mode: 'Auto'|'Fixed'|'Range'|'Named'
  //   namedRef: when mode==='Named', the name of a NamedRange in the
  //             namedRanges array; otherwise ''.
  // Pre-populate from any persisted overrides the extension passed in
  // (re-runs of the same unit retain previous edits).
  const state = payload.rows.map(() => ({
    mode: "Auto",
    value: "",
    lo: "",
    hi: "",
    skipAdj: false,
    namedRef: "",
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
        namedRef: o.namedRef || "",
      };
    }
  }

  // ── Named ranges ─────────────────────────────────────────────────
  // Each entry is structured:
  //   { name, subRanges: [{ subName, mode: "Value"|"Range",
  //                         value, lo, hi }, ...] }
  // Sub-names are optional for a single-sub range; for multi-sub
  // bundles the writer auto-fills any blank sub-name on stage 2.
  // The loader normalises both forms (current structured + legacy
  // textual { name, definition }) so old persistence files still work.
  function migrateNamedRange(nr) {
    if (!nr) return { name: "", subRanges: [] };
    if (Array.isArray(nr.subRanges)) {
      return {
        name: String(nr.name || ""),
        subRanges: nr.subRanges.map(normalizeSubRange),
      };
    }
    return {
      name: String(nr.name || ""),
      subRanges: stringDefinitionToSubRanges(String(nr.definition || "")),
    };
  }
  function normalizeSubRange(s) {
    s = s || {};
    return {
      subName: String(s.subName || ""),
      mode: s.mode === "Range" ? "Range" : "Value",
      value: String(s.value || ""),
      lo: String(s.lo || ""),
      hi: String(s.hi || ""),
    };
  }
  function stringDefinitionToSubRanges(def) {
    const lines = def.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const out = [];
    for (const line of lines) {
      let subName = "";
      let rest = line;
      const eq = line.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
      if (eq) { subName = eq[1]; rest = eq[2].trim(); }
      const range = rest.match(
        /^\[\s*(-?\d+|0x[0-9a-fA-F]+)\s*,\s*(-?\d+|0x[0-9a-fA-F]+)\s*\]$/
      );
      if (range) {
        out.push({ subName, mode: "Range", value: "", lo: range[1], hi: range[2] });
      } else {
        out.push({ subName, mode: "Value", value: rest, lo: "", hi: "" });
      }
    }
    return out;
  }
  const namedRanges = Array.isArray(payload.savedNamedRanges)
    ? payload.savedNamedRanges.map(migrateNamedRange)
    : [];

  // Listeners fired whenever the namedRanges list changes shape or
  // content. Per-row value cells in Named mode subscribe so their
  // dropdowns repopulate when the user adds / renames / removes
  // a range.
  const namedListeners = [];
  function onNamedChanged(fn) {
    namedListeners.push(fn);
  }
  function fireNamedChanged() {
    for (const fn of namedListeners) {
      try { fn(); } catch { /* keep others firing */ }
    }
  }

  function isValidRangeName(name) {
    const t = (name || "").trim();
    if (!/^[A-Za-z_]\w*$/.test(t)) return false;
    if (C_KEYWORDS.has(t) || C_TYPES.has(t)) return false;
    if (t === "AUTO_GENERATE" || t === "FORCE_DISABLED_ADJUSTMENT") return false;
    return true;
  }

  // Mark a sub-range value/lo/hi input invalid when it doesn't parse
  // as a number. Empty is OK (mid-typing, or just the wrong column).
  function markSubInputValidity(inp) {
    const v = inp.value.trim();
    if (v === "") {
      inp.classList.remove("invalid");
      return;
    }
    const ok = parseValue(v) !== null;
    inp.classList.toggle("invalid", !ok);
  }

  // Parse "[lo, hi]" with integer / hex / signed endpoints. Returns
  // null if the definition isn't a clean numeric range.
  function parseRangeBrackets(def) {
    const t = (def || "").trim();
    const m = t.match(
      /^\[\s*(-?\d+|0x[0-9a-fA-F]+)\s*,\s*(-?\d+|0x[0-9a-fA-F]+)\s*\]$/
    );
    if (!m) return null;
    const lo = parseValue(m[1]);
    const hi = parseValue(m[2]);
    if (lo === null || hi === null) return null;
    return { lo: Number(lo), hi: Number(hi) };
  }

  // (parseBundle removed — structured sub-ranges are used directly.)

  // Numeric Range subs that overlap with another range's Range sub
  // get an "overlaps" badge. We compare across all named ranges' Range
  // subs in one flat pass so two ranges sharing an endpoint (e.g.
  // slow=[0,10], medium=[10,30]) both light up. Value subs are
  // ignored.
  function detectOverlapRanges() {
    const items = [];
    namedRanges.forEach((nr, rIdx) => {
      nr.subRanges.forEach((sub, sIdx) => {
        if (sub.mode !== "Range") return;
        const lo = parseValue(sub.lo);
        const hi = parseValue(sub.hi);
        if (lo === null || hi === null) return;
        items.push({ rIdx, sIdx, lo: Number(lo), hi: Number(hi) });
      });
    });
    const flagged = new Set();
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const a = items[i], b = items[j];
        if (Math.max(a.lo, b.lo) <= Math.min(a.hi, b.hi)) {
          flagged.add(`${a.rIdx}.${a.sIdx}`);
          flagged.add(`${b.rIdx}.${b.sIdx}`);
        }
      }
    }
    return flagged;
  }

  function renderNamedRanges() {
    const list = document.getElementById("named-list");
    const empty = document.getElementById("named-empty");
    const countPill = document.getElementById("named-count");
    list.innerHTML = "";
    const overlapKeys = detectOverlapRanges();
    namedRanges.forEach((nr, rIdx) => {
      list.appendChild(buildRangeCard(nr, rIdx, overlapKeys));
    });
    countPill.textContent =
      namedRanges.length > 0 ? `(${namedRanges.length})` : "";
    empty.style.display = namedRanges.length === 0 ? "block" : "none";
  }

  function buildRangeCard(nr, rIdx, overlapKeys) {
    const card = document.createElement("div");
    card.className = "named-card";

    // Head: name input + delete-whole-range button.
    const head = document.createElement("div");
    head.className = "named-card-head";
    const nameInp = document.createElement("input");
    nameInp.className = "named-name-input";
    nameInp.placeholder = "Range name (e.g. speed)";
    nameInp.value = nr.name;
    function reflectNameValidity() {
      const t = nameInp.value.trim();
      const dup = t !== "" &&
        namedRanges.some((x, i) => i !== rIdx && x.name.trim() === t);
      const bad = t !== "" && (!isValidRangeName(t) || dup);
      nameInp.classList.toggle("invalid", bad);
      nameInp.title = dup
        ? "Another named range already uses this name."
        : (bad
          ? "Names must be a C-style identifier and not a C keyword."
          : "");
    }
    nameInp.addEventListener("input", () => {
      nr.name = nameInp.value;
      reflectNameValidity();
      fireNamedChanged();
    });
    reflectNameValidity();
    head.appendChild(nameInp);

    const delCard = document.createElement("button");
    delCard.type = "button";
    delCard.className = "named-del named-card-del";
    delCard.textContent = "✕";
    delCard.title = "Delete this named range";
    delCard.addEventListener("click", () => {
      namedRanges.splice(rIdx, 1);
      renderNamedRanges();
      fireNamedChanged();
    });
    head.appendChild(delCard);
    card.appendChild(head);

    // Sub-range table.
    const tbl = document.createElement("table");
    tbl.className = "sub-table";
    tbl.innerHTML =
      "<thead><tr>" +
        "<th>Sub-name (optional)</th>" +
        "<th>Mode</th>" +
        "<th>Value / Lo</th>" +
        "<th>Hi</th>" +
        "<th></th>" +
      "</tr></thead>";
    const tbody = document.createElement("tbody");
    nr.subRanges.forEach((sub, sIdx) => {
      tbody.appendChild(buildSubRow(nr, rIdx, sub, sIdx, overlapKeys));
    });
    tbl.appendChild(tbody);
    card.appendChild(tbl);

    // Add-sub-range button.
    const addSub = document.createElement("button");
    addSub.type = "button";
    addSub.className = "secondary sub-add";
    addSub.textContent = "+ Add sub-range";
    addSub.addEventListener("click", () => {
      nr.subRanges.push({
        subName: "",
        mode: "Range",
        value: "",
        lo: "",
        hi: "",
      });
      renderNamedRanges();
      fireNamedChanged();
    });
    card.appendChild(addSub);
    return card;
  }

  function buildSubRow(parentRange, rIdx, sub, sIdx, overlapKeys) {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    const nameInp = document.createElement("input");
    nameInp.className = "sub-val-input sub-name-input";
    nameInp.placeholder = "(optional)";
    nameInp.value = sub.subName;
    nameInp.addEventListener("input", () => {
      sub.subName = nameInp.value;
      fireNamedChanged();
    });
    nameTd.appendChild(nameInp);
    tr.appendChild(nameTd);

    const modeTd = document.createElement("td");
    const modeSel = document.createElement("select");
    modeSel.className = "sub-mode-select";
    for (const m of ["Value", "Range"]) {
      const o = document.createElement("option");
      o.value = m;
      o.textContent = m;
      modeSel.appendChild(o);
    }
    modeSel.value = sub.mode;
    modeSel.addEventListener("change", () => {
      sub.mode = modeSel.value;
      renderNamedRanges();
      fireNamedChanged();
    });
    modeTd.appendChild(modeSel);
    tr.appendChild(modeTd);

    const valTd = document.createElement("td");
    const valInp = document.createElement("input");
    valInp.className = "sub-val-input";
    valInp.placeholder = sub.mode === "Range" ? "lo" : "value";
    valInp.value = sub.mode === "Range" ? sub.lo : sub.value;
    valInp.addEventListener("input", () => {
      if (sub.mode === "Range") sub.lo = valInp.value;
      else sub.value = valInp.value;
      markSubInputValidity(valInp);
      fireNamedChanged();
    });
    markSubInputValidity(valInp);
    valTd.appendChild(valInp);
    tr.appendChild(valTd);

    const hiTd = document.createElement("td");
    if (sub.mode === "Range") {
      const hiInp = document.createElement("input");
      hiInp.className = "sub-val-input";
      hiInp.placeholder = "hi";
      hiInp.value = sub.hi;
      hiInp.addEventListener("input", () => {
        sub.hi = hiInp.value;
        markSubInputValidity(hiInp);
        fireNamedChanged();
      });
      markSubInputValidity(hiInp);
      hiTd.appendChild(hiInp);
      if (overlapKeys.has(`${rIdx}.${sIdx}`)) {
        const badge = document.createElement("span");
        badge.className = "named-warning";
        badge.textContent = "overlaps";
        badge.title =
          "This sub-range overlaps with another defined range. pyatg dedupes shared endpoints; usually fine.";
        hiTd.appendChild(badge);
      }
    } else {
      const dash = document.createElement("span");
      dash.className = "dash";
      dash.textContent = "—";
      hiTd.appendChild(dash);
    }
    tr.appendChild(hiTd);

    const actTd = document.createElement("td");
    const del = document.createElement("button");
    del.type = "button";
    del.className = "named-del";
    del.textContent = "✕";
    del.title = "Delete this sub-range";
    del.addEventListener("click", () => {
      parentRange.subRanges.splice(sIdx, 1);
      renderNamedRanges();
      fireNamedChanged();
    });
    actTd.appendChild(del);
    tr.appendChild(actTd);
    return tr;
  }

  document.getElementById("named-add").addEventListener("click", () => {
    namedRanges.push({
      name: "",
      subRanges: [
        { subName: "", mode: "Range", value: "", lo: "", hi: "" },
      ],
    });
    renderNamedRanges();
    fireNamedChanged();
    // If the user is currently on Inputs, hop them to Named so they
    // see the new card.
    switchTab("named");
  });

  // Tab bar: switch between Inputs and Named ranges panes.
  function switchTab(which) {
    const showInputs = which === "inputs";
    document.getElementById("tab-inputs").classList.toggle("active", showInputs);
    document.getElementById("tab-named").classList.toggle("active", !showInputs);
    document.getElementById("pane-inputs").classList.toggle("active", showInputs);
    document.getElementById("pane-named").classList.toggle("active", !showInputs);
    document.getElementById("tab-inputs").setAttribute("aria-selected", showInputs);
    document.getElementById("tab-named").setAttribute("aria-selected", !showInputs);
  }
  document.getElementById("tab-inputs").addEventListener("click", () => switchTab("inputs"));
  document.getElementById("tab-named").addEventListener("click", () => switchTab("named"));

  renderNamedRanges();

  // A row is "scalar-editable" if its annotation looks like enum:S:N or
  // enum:U:N. Arrays, pointers, function pointers stay Auto-only in
  // iteration 2.
  function isScalar(row) {
    return /^enum:[SU]:\d+/.test(row.annotation || "");
  }

  // Predict the test values pyatg will emit for one row, given its
  // current Mode / Value / lo / hi / skipAdj. Mirrors what we observed
  // from CLI smoke tests:
  //   - Auto: type-extreme min and max, ±1 always disabled
  //   - Fixed N: N-1, N, N+1 (or just N when skipAdj)
  //   - Range [lo, hi]: lo-1, lo, lo+1, hi-1, hi, hi+1 (or just lo, hi
  //     when skipAdj)
  // Returns { text, isModified } — text is human-readable comma-joined,
  // isModified is true when the row diverges from autogen defaults.
  function predictValues(row, s) {
    const annot = row.annotation || "";
    const m = annot.match(/^enum:([SU]):(\d+)/);
    if (!m || !isScalar(row)) {
      return { text: "(complex)", isModified: false };
    }
    const sign = m[1];
    const bits = Math.min(parseInt(m[2], 10), 32); // clamp to JS-safe
    let typeMin, typeMax;
    if (sign === "U") {
      typeMin = 0;
      typeMax = Math.pow(2, bits) - 1;
    } else {
      typeMin = -Math.pow(2, bits - 1);
      typeMax = Math.pow(2, bits - 1) - 1;
    }
    const autoText = `${typeMin}, ${typeMax}`;

    if (s.mode === "Auto" && !s.skipAdj) {
      return { text: autoText, isModified: false };
    }

    let values = [];
    if (s.mode === "Auto") {
      values = [typeMin, typeMax];
    } else if (s.mode === "Fixed") {
      const v = parseValue(s.value);
      if (v === null) return { text: "(incomplete)", isModified: true };
      const n = Number(v);
      values = s.skipAdj ? [n] : [n - 1, n, n + 1];
    } else if (s.mode === "Range") {
      const lo = parseValue(s.lo);
      const hi = parseValue(s.hi);
      if (lo === null || hi === null) {
        return { text: "(incomplete)", isModified: true };
      }
      const lN = Number(lo);
      const hN = Number(hi);
      values = s.skipAdj
        ? [lN, hN]
        : [lN - 1, lN, lN + 1, hN - 1, hN, hN + 1];
    } else if (s.mode === "Named") {
      if (!s.namedRef) {
        return { text: "(no range selected)", isModified: false };
      }
      const nr = namedRanges.find((x) => (x.name || "").trim() === s.namedRef);
      if (!nr) {
        return { text: `(undefined: ${s.namedRef})`, isModified: true };
      }
      if (!nr.subRanges || nr.subRanges.length === 0) {
        return { text: "(empty)", isModified: true };
      }
      // Each sub-range contributes its boundary cluster;
      // formatValueSet unions and adds `…` between non-contiguous
      // clusters.
      values = [];
      for (const sub of nr.subRanges) {
        if (sub.mode === "Range") {
          const lo = parseValue(sub.lo);
          const hi = parseValue(sub.hi);
          if (lo === null || hi === null) continue;
          const lN = Number(lo);
          const hN = Number(hi);
          if (s.skipAdj) values.push(lN, hN);
          else values.push(lN - 1, lN, lN + 1, hN - 1, hN, hN + 1);
        } else {
          const v = parseValue(sub.value);
          if (v === null) continue;
          const nN = Number(v);
          if (s.skipAdj) values.push(nN);
          else values.push(nN - 1, nN, nN + 1);
        }
      }
      if (values.length === 0) {
        return { text: "(invalid sub-ranges)", isModified: true };
      }
    }
    return { text: formatValueSet(values), isModified: true };
  }

  // Render a list of integer boundary values compactly. Deduplicates
  // (a Range like [0, 2] would otherwise emit 1 twice — lo+1 and
  // hi-1 collide) and inserts `…` between values that aren't
  // arithmetically adjacent so wide ranges stay scannable.
  // Examples:
  //   [-1, 0, 1, 2, 3, 4]                  → "-1, 0, 1, 2, 3, 4"
  //   [-1, 0, 1, 99, 100, 101]             → "-1, 0, 1, …, 99, 100, 101"
  //   [-1, 0, 1, 1, 2, 3]                  → "-1, 0, 1, 2, 3"
  function formatValueSet(values) {
    if (!values || values.length === 0) return "";
    const sorted = Array.from(new Set(values)).sort((a, b) => a - b);
    if (sorted.length === 1) return String(sorted[0]);
    // For a solo pair (Auto, or Range+skipAdj) treat them as two
    // distinct points, not a range with omitted middle.
    if (sorted.length === 2) return sorted.join(", ");
    const parts = [String(sorted[0])];
    for (let k = 1; k < sorted.length; k += 1) {
      if (sorted[k] - sorted[k - 1] > 1) parts.push("…");
      parts.push(String(sorted[k]));
    }
    return parts.join(", ");
  }

  // Mouseenter/leave handlers used by every input row to highlight
  // (and un-highlight) the matching identifier spans in the source
  // pane. Symmetric to the click-to-jump from source -> row.
  function highlightForRow(idx) {
    document
      .querySelectorAll(`.src-ident[data-row-index="${idx}"]`)
      .forEach((s) => s.classList.add("hl"));
  }
  function unhighlightForRow(idx) {
    document
      .querySelectorAll(`.src-ident[data-row-index="${idx}"]`)
      .forEach((s) => s.classList.remove("hl"));
  }

  // Per-row DOM refs to the Generates cell so handlers can refresh it
  // in-place when Mode / Value / Skip change.
  const generatesTdByIndex = new Array(payload.rows.length).fill(null);
  function refreshGenerates(idx) {
    const td = generatesTdByIndex[idx];
    if (!td) return;
    const { text, isModified } = predictValues(payload.rows[idx], state[idx]);
    td.textContent = text;
    td.classList.toggle("modified", isModified);
    td.classList.toggle("empty", text === "(complex)" || text === "(incomplete)");
    // The cell ellipsizes when narrow — set the tooltip to the full
    // predicted text so the user can hover to read it.
    td.title = text;
  }

  const body = document.getElementById("rows-body");
  payload.rows.forEach((row, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.rowIndex = String(idx);
    if (!isScalar(row)) tr.classList.add("no-effect");
    tr.addEventListener("mouseenter", () => highlightForRow(idx));
    tr.addEventListener("mouseleave", () => unhighlightForRow(idx));

    appendText(tr, row.scope);
    appendText(tr, row.routine);
    appendText(tr, row.nodeStr);
    appendText(tr, row.nodeType);
    appendText(tr, row.annotation, "col-annotation");

    const modeTd = document.createElement("td");
    const sel = document.createElement("select");
    sel.className = "mode-select";
    for (const opt of ["Auto", "Fixed", "Range", "Named"]) {
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
      refreshGenerates(idx);
    });
    modeTd.appendChild(sel);
    tr.appendChild(modeTd);

    const valueTd = document.createElement("td");
    valueTd.className = "value-cell";
    renderValueCell(valueTd, idx, row);
    tr.appendChild(valueTd);
    // Keep the Named-mode dropdown in sync with renames / additions /
    // deletions in the named-ranges editor.
    onNamedChanged(() => {
      if (state[idx].mode === "Named") {
        renderValueCell(valueTd, idx, row);
        refreshGenerates(idx);
      }
    });

    const skipTd = document.createElement("td");
    skipTd.className = "skip-cell";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = state[idx].skipAdj;
    cb.disabled = !isScalar(row);
    cb.addEventListener("change", () => {
      state[idx].skipAdj = cb.checked;
      refreshGenerates(idx);
    });
    skipTd.appendChild(cb);
    tr.appendChild(skipTd);

    const genTd = document.createElement("td");
    genTd.className = "generates-cell";
    generatesTdByIndex[idx] = genTd;
    tr.appendChild(genTd);
    refreshGenerates(idx);

    body.appendChild(tr);
  });

  function appendText(tr, text, cls) {
    const td = document.createElement("td");
    if (cls) td.className = cls;
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
        refreshGenerates(idx);
      });
      inp.placeholder = "value";
      td.appendChild(inp);
    } else if (s.mode === "Range") {
      const loInp = makeInput(s.lo || "", (v) => {
        s.lo = v;
        refreshGenerates(idx);
      });
      loInp.placeholder = "lo";
      const sep = document.createElement("span");
      sep.textContent = ", ";
      const hiInp = makeInput(s.hi || "", (v) => {
        s.hi = v;
        refreshGenerates(idx);
      });
      hiInp.placeholder = "hi";
      td.appendChild(loInp);
      td.appendChild(sep);
      td.appendChild(hiInp);
    } else if (s.mode === "Named") {
      const namedSel = document.createElement("select");
      namedSel.className = "mode-select";
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = namedRanges.length === 0
        ? "(no ranges defined)"
        : "(pick one)";
      namedSel.appendChild(blank);
      for (const nr of namedRanges) {
        const nm = (nr.name || "").trim();
        if (!nm) continue;
        const o = document.createElement("option");
        o.value = nm;
        o.textContent = nm;
        namedSel.appendChild(o);
      }
      namedSel.value = s.namedRef || "";
      namedSel.disabled = namedRanges.length === 0;
      namedSel.addEventListener("change", () => {
        s.namedRef = namedSel.value;
        refreshGenerates(idx);
      });
      td.appendChild(namedSel);
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
      } else if (s.mode === "Named") {
        // Drop silently if the user hasn't picked a name or picked one
        // that's no longer defined — treat as Auto for that row.
        if (!s.namedRef) return;
        if (!namedRanges.find((nr) => (nr.name || "").trim() === s.namedRef)) {
          return;
        }
        entry.namedRef = s.namedRef;
      }
      overrides.push(entry);
    });
    return { overrides, badRowIndices };
  }

  // Trim out empty / invalid named ranges and sub-ranges before
  // submit. Bad inputs are flagged inline; here we just drop them
  // silently rather than failing the whole save.
  function collectNamedRanges() {
    const out = [];
    for (const nr of namedRanges) {
      const name = (nr.name || "").trim();
      if (!isValidRangeName(name)) continue;
      const subRanges = [];
      for (const sub of nr.subRanges || []) {
        const subName = (sub.subName || "").trim();
        if (sub.mode === "Range") {
          const lo = (sub.lo || "").trim();
          const hi = (sub.hi || "").trim();
          if (lo === "" || hi === "") continue;
          if (parseValue(lo) === null || parseValue(hi) === null) continue;
          subRanges.push({ subName, mode: "Range", value: "", lo, hi });
        } else {
          const value = (sub.value || "").trim();
          if (value === "") continue;
          if (parseValue(value) === null) continue;
          subRanges.push({ subName, mode: "Value", value, lo: "", hi: "" });
        }
      }
      if (subRanges.length === 0) continue;
      out.push({ name, subRanges });
    }
    return out;
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

  // Show-details toggle (iter 3.6). Hidden by default — annotations
  // are an implementation detail of pyatg's classifier, not a thing
  // the user should normally need. Preference persists across this
  // webview's lifetime (and across hidden/shown transitions thanks
  // to retainContextWhenHidden) via vscode.getState/setState.
  const detailsCheckbox = document.getElementById("toggle-details");
  const rowsTable = document.getElementById("rows-table");
  const savedUiState = vscode.getState ? (vscode.getState() || {}) : {};
  const showDetailsInitial = !!savedUiState.showDetails;
  detailsCheckbox.checked = showDetailsInitial;
  applyShowDetails(showDetailsInitial);
  detailsCheckbox.addEventListener("change", () => {
    applyShowDetails(detailsCheckbox.checked);
    if (vscode.setState) {
      vscode.setState({ ...savedUiState, showDetails: detailsCheckbox.checked });
    }
  });
  function applyShowDetails(on) {
    if (on) rowsTable.classList.add("show-details");
    else rowsTable.classList.remove("show-details");
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
    vscode.postMessage({
      command: "generate",
      overrides,
      namedRanges: collectNamedRanges(),
    });
  });
  document.getElementById("btn-cancel").addEventListener("click", () => {
    vscode.postMessage({ command: "cancel" });
  });

  // Save-draft: write overrides.json without running stage 2 or
  // closing the panel. Lets the user park work-in-progress without
  // committing to a pyatg run.
  let toastTimer = null;
  function showToast(text) {
    const el = document.getElementById("footer-toast");
    el.textContent = text;
    el.classList.add("visible");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove("visible");
    }, 2000);
  }
  document.getElementById("btn-save-draft").addEventListener("click", () => {
    const { overrides, badRowIndices } = collectOverrides();
    if (badRowIndices.length > 0) {
      const bad = badRowIndices
        .map((i) => payload.rows[i].nodeStr)
        .join(", ");
      renderError(
        `Cannot save draft: non-numeric value(s) in ${bad}. Fix the highlighted field(s) and try again.`
      );
      return;
    }
    renderError("");
    vscode.postMessage({
      command: "saveDraft",
      overrides,
      namedRanges: collectNamedRanges(),
    });
    showToast("Draft saved");
  });
})();
