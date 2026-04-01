const vscode = acquireVsCodeApi();

window.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("sourceFileInput");
  const lineInput = document.getElementById("lineNumberInput");
  const enviroSelect = document.getElementById("enviroPathSelect");
  const codeBlock = document.getElementById("codeBlock");
  const selectedVarsList = document.getElementById("selectedVarsList");

  fileInput.value = window.defaultSourceFile || "";
  lineInput.value = window.defaultLineNumber || "";

  // Populate environment dropdown
  if (enviroSelect) {
    enviroSelect.innerHTML = "";
    if (Array.isArray(window.enviroPaths) && window.enviroPaths.length > 0) {
      window.enviroPaths.forEach((fullPath) => {
        const opt = document.createElement("option");
        opt.value = fullPath;
        opt.textContent = fullPath.split(/[/\\]/).pop();
        enviroSelect.appendChild(opt);
      });
      enviroSelect.selectedIndex = 0;
    }
  }

  // Function info
  const fn = window.fileFunction || {
    name: null, params: [], startLine: 1, endLine: 1, code: "", selectedLine: 1,
  };

  const functionTitle = document.getElementById("functionTitle");
  if (functionTitle && fn && fn.name) {
    const paramsPreview = (fn.params || []).join(", ");
    functionTitle.textContent = `Source Function: ${fn.name}(${paramsPreview}) [lines ${fn.startLine}-${fn.endLine}]`;
  } else if (functionTitle) {
    functionTitle.textContent = "Source Function: (file-level)";
  }

  // ─── Variable Lookup Map ────────────────────────────────────────────
  // Maps bare variable names to type info, with children for struct fields

  const variableLookup = new Map();

  function addToLookup(nodes, parentMap) {
    if (!nodes) return;
    for (const node of nodes) {
      const entry = {
        displayType: node.displayType || "",
        kind: node.kind || "unknown",
        enumValues: node.enumValues || [],
        children: new Map(),
      };
      if (node.children && node.children.length > 0) {
        addToLookup(node.children, entry.children);
      }
      parentMap.set(node.name, entry);
    }
  }

  const varData = window.variableData;
  if (varData) {
    addToLookup(varData.parameters, variableLookup);
    addToLookup(varData.globals, variableLookup);
    if (varData.locals) {
      addToLookup(varData.locals, variableLookup);
    }
  }

  // ─── Selected Variables State ───────────────────────────────────────

  const selectedVars = new Map(); // path → {displayType, kind, enumValues, value}

  // ─── C/C++ Tokenizer ───────────────────────────────────────────────

  const C_KEYWORDS = new Set([
    "auto","break","case","char","const","continue","default","do","double",
    "else","enum","extern","float","for","goto","if","inline","int","long",
    "register","return","short","signed","sizeof","static","struct","switch",
    "typedef","union","unsigned","void","volatile","while",
    "bool","class","namespace","template","this","true","false","nullptr",
    "new","delete","virtual","override","final","public","private","protected",
    "constexpr","noexcept","using","typename","try","catch","throw",
  ]);

  function tokenizeLine(text, inBlockComment) {
    const tokens = [];
    let i = 0;
    while (i < text.length) {
      // Block comment continuation
      if (inBlockComment) {
        const end = text.indexOf("*/", i);
        if (end === -1) {
          tokens.push({ type: "comment", text: text.slice(i) });
          return { tokens, inBlockComment: true };
        }
        tokens.push({ type: "comment", text: text.slice(i, end + 2) });
        i = end + 2;
        inBlockComment = false;
        continue;
      }

      const ch = text[i];
      const ch2 = text.slice(i, i + 2);

      // Line comment
      if (ch2 === "//") {
        tokens.push({ type: "comment", text: text.slice(i) });
        return { tokens, inBlockComment: false };
      }

      // Block comment start
      if (ch2 === "/*") {
        const end = text.indexOf("*/", i + 2);
        if (end === -1) {
          tokens.push({ type: "comment", text: text.slice(i) });
          return { tokens, inBlockComment: true };
        }
        tokens.push({ type: "comment", text: text.slice(i, end + 2) });
        i = end + 2;
        continue;
      }

      // String literal
      if (ch === '"' || ch === "'") {
        let j = i + 1;
        while (j < text.length) {
          if (text[j] === "\\" && j + 1 < text.length) { j += 2; continue; }
          if (text[j] === ch) { j++; break; }
          j++;
        }
        tokens.push({ type: "string", text: text.slice(i, j) });
        i = j;
        continue;
      }

      // Whitespace
      if (/\s/.test(ch)) {
        let j = i;
        while (j < text.length && /\s/.test(text[j])) j++;
        tokens.push({ type: "whitespace", text: text.slice(i, j) });
        i = j;
        continue;
      }

      // Number
      if (/[0-9]/.test(ch) || (ch === "." && i + 1 < text.length && /[0-9]/.test(text[i + 1]))) {
        let j = i;
        while (j < text.length && /[0-9a-fA-FxXuUlL.]/.test(text[j])) j++;
        tokens.push({ type: "number", text: text.slice(i, j) });
        i = j;
        continue;
      }

      // Identifier or keyword
      if (/[a-zA-Z_]/.test(ch)) {
        let j = i;
        while (j < text.length && /[a-zA-Z0-9_]/.test(text[j])) j++;
        const word = text.slice(i, j);
        tokens.push({ type: C_KEYWORDS.has(word) ? "keyword" : "ident", text: word });
        i = j;
        continue;
      }

      // Multi-char operators
      if (["->", "::", "==", "!=", "<=", ">=", "<<", ">>", "&&", "||", "+=", "-=", "*=", "/="].includes(ch2)) {
        tokens.push({ type: "operator", text: ch2 });
        i += 2;
        continue;
      }

      // Single char operator or punctuation
      if ("+-*/%&|^~!<>=?:".includes(ch)) {
        tokens.push({ type: "operator", text: ch });
      } else if ("(){}[];,#".includes(ch)) {
        tokens.push({ type: "punctuation", text: ch });
      } else if (ch === ".") {
        tokens.push({ type: "operator", text: ch });
      } else {
        tokens.push({ type: "punctuation", text: ch });
      }
      i++;
    }
    return { tokens, inBlockComment };
  }

  // ─── Variable Path Resolution ──────────────────────────────────────

  function resolveClickedPath(span) {
    // Walk backward through sibling spans to build member access chain
    // e.g., clicking "g" in "s->f.s->g" builds path "s.f.s.g"
    const segments = [span.dataset.name];
    let cur = span;

    while (cur) {
      // Skip whitespace siblings backward
      let prev = cur.previousElementSibling;
      while (prev && prev.classList.contains("ws")) prev = prev.previousElementSibling;

      // Check for . or -> operator
      if (!prev) break;
      if (!(prev.classList.contains("op") && (prev.textContent === "." || prev.textContent === "->"))) break;

      // Skip whitespace before the operator
      let prevIdent = prev.previousElementSibling;
      while (prevIdent && prevIdent.classList.contains("ws")) prevIdent = prevIdent.previousElementSibling;

      // Must be an identifier
      if (!prevIdent || !prevIdent.classList.contains("id")) break;

      segments.unshift(prevIdent.dataset.name);
      cur = prevIdent;
    }

    return segments.join(".");
  }

  function lookupPath(path) {
    // Walk the variableLookup tree to find info for a dotted path
    const parts = path.split(".");
    let current = variableLookup;
    let info = null;

    for (let i = 0; i < parts.length; i++) {
      const entry = current.get(parts[i]);
      if (!entry) return null;
      info = entry;
      current = entry.children;
    }
    return info;
  }

  function isClickable(info) {
    // Pointers and scalars are clickable; by-value structs are not
    return info && info.kind !== "struct";
  }

  // ─── Render Tokenized Code ─────────────────────────────────────────

  const TOKEN_CLASS = {
    ident: "id", keyword: "kw", number: "num", string: "str",
    comment: "cmt", operator: "op", punctuation: "pn", whitespace: "ws",
  };

  function renderFunctionCode(codeText, startLine, selectedLineWithinFunction) {
    codeBlock.innerHTML = "";
    const lines = codeText.replace(/\t/g, "    ").split(/\r?\n/);
    const absSelectedLine = Number(startLine) + Number(selectedLineWithinFunction) - 1;
    let inBlockComment = false;

    lines.forEach((ln, idx) => {
      const gutterNumber = Number(startLine) + idx;

      const row = document.createElement("div");
      row.className = "code-line";
      row.dataset.line = String(gutterNumber);

      const gutter = document.createElement("span");
      gutter.className = "gutter";
      const pad = Math.max(4, String(fn.endLine).length);
      gutter.textContent = String(gutterNumber).padStart(pad, " ");
      row.appendChild(gutter);

      const content = document.createElement("span");
      content.className = "content";

      // Tokenize and create spans
      const result = tokenizeLine(ln, inBlockComment);
      inBlockComment = result.inBlockComment;

      for (const tok of result.tokens) {
        const span = document.createElement("span");
        span.className = TOKEN_CLASS[tok.type] || "";
        span.textContent = tok.text;

        if (tok.type === "ident") {
          span.dataset.name = tok.text;
          // Check if this identifier is known in the variable lookup
          // (we'll also handle dotted paths via click resolution)
          if (variableLookup.has(tok.text)) {
            const info = variableLookup.get(tok.text);
            if (isClickable(info)) {
              span.classList.add("clickable");
            } else if (info.kind === "struct") {
              span.classList.add("struct-id");
            }
          }
        }

        content.appendChild(span);
      }

      row.appendChild(content);

      if (gutterNumber === absSelectedLine) {
        row.classList.add("highlight");
        setTimeout(() => row.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
      }

      codeBlock.appendChild(row);
    });

    // Also mark struct field identifiers as clickable if they follow . or ->
    // These won't be top-level in variableLookup but are reachable via paths
    markFieldIdentifiers();
  }

  function markFieldIdentifiers() {
    // Any identifier that follows . or -> is a field access and should be clickable
    // even if we don't have type info for it (unknown type, text input)
    const allIdents = codeBlock.querySelectorAll(".id:not(.clickable):not(.struct-id)");
    for (const span of allIdents) {
      let prev = span.previousElementSibling;
      while (prev && prev.classList.contains("ws")) prev = prev.previousElementSibling;
      if (prev && prev.classList.contains("op") && (prev.textContent === "." || prev.textContent === "->")) {
        const path = resolveClickedPath(span);
        const info = lookupPath(path);
        if (info) {
          if (isClickable(info)) {
            span.classList.add("clickable");
          } else if (info.kind === "struct") {
            span.classList.add("struct-id");
          }
        } else {
          // Unknown field access - still clickable with unknown type
          span.classList.add("clickable");
        }
      }
    }
  }

  renderFunctionCode(fn.code || "", fn.startLine || 1, fn.selectedLine || 1);

  // ─── Click Handler (identifiers) ──────────────────────────────────

  codeBlock.addEventListener("click", (e) => {
    // Handle gutter click to move target line
    const gutterSpan = e.target.closest(".gutter");
    if (gutterSpan) {
      const row = gutterSpan.closest(".code-line");
      if (row) {
        const newLine = row.dataset.line;
        lineInput.value = newLine;
        // Move the highlight
        codeBlock.querySelectorAll(".code-line.highlight").forEach((r) => r.classList.remove("highlight"));
        row.classList.add("highlight");
      }
      return;
    }

    const span = e.target.closest(".id.clickable");
    if (!span) return;

    const path = resolveClickedPath(span);
    const info = lookupPath(path);
    if (info && !isClickable(info)) return; // by-value struct, not assignable

    if (selectedVars.has(path)) {
      selectedVars.delete(path);
    } else {
      selectedVars.set(path, {
        displayType: info ? info.displayType : "",
        kind: info ? info.kind : "unknown",
        enumValues: info ? (info.enumValues || []) : [],
        value: "",
      });
    }

    refreshSelectedHighlights();
    renderSelectedVarsList();
  });

  // ─── Hover Tooltip + Cross-Highlighting ───────────────────────────

  let tooltipEl = null;

  function removeTooltip() {
    if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
  }

  function clearCrossHighlights() {
    codeBlock.querySelectorAll(".cross-highlight").forEach((el) => el.classList.remove("cross-highlight"));
    selectedVarsList.querySelectorAll(".cross-highlight").forEach((el) => el.classList.remove("cross-highlight"));
  }

  // Hover on code token → show tooltip + highlight matching table row
  codeBlock.addEventListener("mouseover", (e) => {
    const span = e.target.closest(".id.clickable, .id.struct-id");
    if (!span) { removeTooltip(); clearCrossHighlights(); return; }

    const path = resolveClickedPath(span);
    const info = lookupPath(path);

    // Tooltip
    removeTooltip();
    tooltipEl = document.createElement("div");
    tooltipEl.className = "inline-tooltip";
    const dispType = info ? info.displayType : "unknown";
    const action = selectedVars.has(path) ? "(click to remove)" : (info && !isClickable(info)) ? "(struct)" : "(click to add)";
    tooltipEl.textContent = `${path} : ${dispType} ${action}`;

    const containerRect = document.getElementById("functionCode").getBoundingClientRect();
    const spanRect = span.getBoundingClientRect();
    tooltipEl.style.left = (spanRect.left - containerRect.left) + "px";
    tooltipEl.style.top = (spanRect.top - containerRect.top - 22) + "px";
    document.getElementById("functionCode").appendChild(tooltipEl);

    // Cross-highlight: find the matching table row
    clearCrossHighlights();
    if (selectedVars.has(path)) {
      const row = selectedVarsList.querySelector(`.selected-var-item[data-path="${path}"]`);
      if (row) row.classList.add("cross-highlight");
    }
  });

  codeBlock.addEventListener("mouseout", (e) => {
    const span = e.target.closest(".id");
    if (span) {
      removeTooltip();
      clearCrossHighlights();
    }
  });

  // ─── Selected Variables Highlighting ───────────────────────────────

  function refreshSelectedHighlights() {
    const selectedPaths = new Set(selectedVars.keys());

    codeBlock.querySelectorAll(".id.clickable").forEach((span) => {
      const path = resolveClickedPath(span);
      // Mark tokens that have values in the table
      let hasValue = false;
      for (const selPath of selectedPaths) {
        if (selPath === path || selPath.startsWith(path + ".")) {
          hasValue = true;
          break;
        }
      }
      span.classList.toggle("has-value", hasValue);
    });
  }

  // ─── Selected Variables List ───────────────────────────────────────

  function renderSelectedVarsList() {
    selectedVarsList.innerHTML = "";

    if (selectedVars.size === 0) {
      const hint = document.createElement("div");
      hint.className = "no-selection-hint";
      hint.textContent = "Click on a variable in the source code to add it here.";
      selectedVarsList.appendChild(hint);
      return;
    }

    for (const [path, info] of selectedVars.entries()) {
      const item = document.createElement("div");
      item.className = "selected-var-item";
      item.dataset.path = path;

      // Cross-highlight: hover on table row → highlight code tokens
      item.addEventListener("mouseenter", () => {
        clearCrossHighlights();
        codeBlock.querySelectorAll(".id.clickable.has-value").forEach((span) => {
          const spanPath = resolveClickedPath(span);
          if (spanPath === path || path.startsWith(spanPath + ".")) {
            span.classList.add("cross-highlight");
          }
        });
      });
      item.addEventListener("mouseleave", () => {
        clearCrossHighlights();
      });

      const name = document.createElement("span");
      name.className = "sv-name";
      name.textContent = path;
      item.appendChild(name);

      const badge = document.createElement("span");
      badge.className = `type-badge ${info.kind || "unknown"}`;
      badge.textContent = info.displayType || info.kind;
      item.appendChild(badge);

      // Value input: enum dropdown, bool dropdown, or text input
      if (info.kind === "enum" && info.enumValues && info.enumValues.length > 0) {
        const sel = document.createElement("select");
        sel.className = "sv-value";
        sel.dataset.path = path;
        const empty = document.createElement("option");
        empty.value = "";
        empty.textContent = "-- select --";
        sel.appendChild(empty);
        for (const ev of info.enumValues) {
          const opt = document.createElement("option");
          opt.value = ev;
          opt.textContent = ev;
          if (info.value === ev) opt.selected = true;
          sel.appendChild(opt);
        }
        sel.addEventListener("change", () => { info.value = sel.value; });
        item.appendChild(sel);
      } else if (info.kind === "bool") {
        const sel = document.createElement("select");
        sel.className = "sv-value";
        sel.dataset.path = path;
        const empty = document.createElement("option");
        empty.value = "";
        empty.textContent = "-- select --";
        sel.appendChild(empty);
        for (const bv of ["true", "false"]) {
          const opt = document.createElement("option");
          opt.value = bv;
          opt.textContent = bv;
          if (info.value === bv) opt.selected = true;
          sel.appendChild(opt);
        }
        sel.addEventListener("change", () => { info.value = sel.value; });
        item.appendChild(sel);
      } else {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "sv-value";
        input.dataset.path = path;
        input.placeholder = info.displayType || "value";
        input.value = info.value || "";
        input.addEventListener("input", () => { info.value = input.value; });
        item.appendChild(input);
      }

      const removeBtn = document.createElement("button");
      removeBtn.className = "remove-btn";
      removeBtn.textContent = "\u00d7";
      removeBtn.title = `Remove ${path}`;
      removeBtn.addEventListener("click", () => {
        selectedVars.delete(path);
        refreshSelectedHighlights();
        renderSelectedVarsList();
      });
      item.appendChild(removeBtn);

      selectedVarsList.appendChild(item);
    }
  }

  // ─── Value Collection ──────────────────────────────────────────────

  function collectConfiguredValues() {
    const values = [];
    for (const [path, info] of selectedVars.entries()) {
      const val = info.value ? info.value.trim() : "";
      if (val) {
        values.push({ name: path, value: val });
      }
    }
    return values;
  }

  // ─── Submit / Cancel ───────────────────────────────────────────────

  document.getElementById("btnSubmit").addEventListener("click", () => {
    const values = collectConfiguredValues();
    vscode.postMessage({
      command: "submit",
      sourceFile: fileInput.value.trim(),
      line: lineInput.value.trim(),
      enviroPath: enviroSelect ? enviroSelect.value : "",
      variableValues: values,
    });
  });

  document.getElementById("btnCancel").addEventListener("click", () => {
    vscode.postMessage({ command: "cancel" });
  });

  // ─── Receive async locals from extension ───────────────────────────

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.command === "addLocals" && message.locals) {
      // Merge into lookup
      addToLookup(message.locals, variableLookup);
      // Update clickable classes on existing identifier spans
      codeBlock.querySelectorAll(".id:not(.clickable):not(.struct-id)").forEach((span) => {
        const name = span.dataset.name;
        if (variableLookup.has(name)) {
          const info = variableLookup.get(name);
          if (isClickable(info)) {
            span.classList.add("clickable");
          } else if (info.kind === "struct") {
            span.classList.add("struct-id");
          }
        }
      });
      // Also re-check field identifiers
      markFieldIdentifiers();
    }
  });
});
