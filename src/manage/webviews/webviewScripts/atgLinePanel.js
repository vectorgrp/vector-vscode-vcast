// ATG Test for Line — panel webview script.
//
// The extension host owns all state and pushes it here as a single `state`
// message; this file only renders and reports user intent back. Rendering is
// keyed so that typing into a value field is never interrupted by a re-render.

(function () {
  "use strict";

  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);

  const els = {
    inactive: $("inactive"),
    app: $("app"),
    crumbFile: $("crumbFile"),
    crumbFn: $("crumbFn"),
    crumbLine: $("crumbLine"),
    decisionBox: $("decisionBox"),
    truthSeg: $("truthSeg"),
    btnFetch: $("btnFetch"),
    btnCancel: $("btnCancel"),
    code: $("code"),
    varList: $("varList"),
    varCount: $("varCount"),
    emptyState: $("emptyState"),
    quickAdd: $("quickAdd"),
    quickAddInput: $("quickAddInput"),
    quickAddList: $("quickAddList"),
    footerInfo: $("footerInfo"),
    tooltip: $("tooltip"),
  };

  let state = null;
  let codeKey = "";
  let lastScrolledTarget = 0;
  const lineRows = new Map(); // lineNo -> row element

  function post(message) {
    vscode.postMessage(message);
  }

  // ─── Tokenizer (colouring only; clickability comes from the host) ───

  // Control-flow keywords vs. type/storage keywords get different colours,
  // mirroring what the editor does for C/C++.
  const CONTROL_KEYWORDS = new Set([
    "if", "else", "for", "while", "do", "switch", "case", "default", "break",
    "continue", "return", "goto", "try", "catch", "throw", "new", "delete",
    "sizeof", "using", "namespace", "template", "typename", "this", "operator",
  ]);
  const TYPE_KEYWORDS = new Set([
    "auto", "bool", "char", "const", "constexpr", "double", "enum", "extern",
    "float", "inline", "int", "long", "register", "short", "signed", "static",
    "struct", "typedef", "union", "unsigned", "void", "volatile", "class",
    "virtual", "override", "final", "public", "private", "protected",
    "noexcept", "true", "false", "nullptr", "NULL", "size_t", "int8_t",
    "int16_t", "int32_t", "int64_t", "uint8_t", "uint16_t", "uint32_t",
    "uint64_t",
  ]);
  const TYPE_INTRODUCERS = new Set(["struct", "enum", "union", "class", "typename"]);

  const TOKEN_CLASS = {
    ident: "id", keyword: "kw", typekw: "tk", number: "num", string: "str",
    comment: "cmt", operator: "op", punctuation: "pn", whitespace: "ws",
    preproc: "pp", func: "fn", type: "ty",
  };

  const OPEN_BRACKETS = "([{";
  const CLOSE_BRACKETS = ")]}";

  function nextNonSpace(text, from) {
    let j = from;
    while (j < text.length && /\s/.test(text[j])) j++;
    return j;
  }

  // "T name", "T* name", "T& name" at the start of a statement or parameter:
  // the identifier at [start] is a type if what precedes it is a statement /
  // parameter boundary and what follows is an optional declarator followed by
  // another identifier. Expressions like "a * b" or "x && y" do not qualify.
  function looksLikeDeclarationType(text, start, afterIdent) {
    let p = start - 1;
    while (p >= 0 && /\s/.test(text[p])) p--;
    if (p >= 0 && !/[;{}(,]/.test(text[p])) return false;

    let k = afterIdent;
    if (text[k] === "*" || text[k] === "&") {
      if (text[k] === "&" && text[k + 1] === "&") return false;
      while (text[k] === "*" || text[k] === "&") k++;
      k = nextNonSpace(text, k);
    }
    return /[a-zA-Z_]/.test(text[k] || "");
  }

  function tokenizeLine(text, inBlockComment) {
    const tokens = [];
    let i = 0;
    const push = (type, start, end) => tokens.push({ type, col: start, text: text.slice(start, end) });

    // Whole-line preprocessor directive
    if (!inBlockComment && /^\s*#/.test(text)) {
      const ws = nextNonSpace(text, 0);
      if (ws > 0) push("whitespace", 0, ws);
      push("preproc", ws, text.length);
      return { tokens, inBlockComment: false };
    }

    let prevWord = null; // last identifier/keyword token text, for "struct Foo"

    while (i < text.length) {
      if (inBlockComment) {
        const end = text.indexOf("*/", i);
        if (end === -1) { push("comment", i, text.length); return { tokens, inBlockComment: true }; }
        push("comment", i, end + 2);
        i = end + 2;
        inBlockComment = false;
        continue;
      }
      const ch = text[i];
      const ch2 = text.slice(i, i + 2);

      if (ch2 === "//") { push("comment", i, text.length); return { tokens, inBlockComment: false }; }
      if (ch2 === "/*") {
        const end = text.indexOf("*/", i + 2);
        if (end === -1) { push("comment", i, text.length); return { tokens, inBlockComment: true }; }
        push("comment", i, end + 2);
        i = end + 2;
        continue;
      }
      if (ch === '"' || ch === "'") {
        let j = i + 1;
        while (j < text.length) {
          if (text[j] === "\\" && j + 1 < text.length) { j += 2; continue; }
          if (text[j] === ch) { j++; break; }
          j++;
        }
        push("string", i, j);
        i = j;
        continue;
      }
      if (/\s/.test(ch)) {
        let j = i;
        while (j < text.length && /\s/.test(text[j])) j++;
        push("whitespace", i, j);
        i = j;
        continue;
      }
      if (/[0-9]/.test(ch)) {
        let j = i;
        while (j < text.length && /[0-9a-fA-FxXuUlL.]/.test(text[j])) j++;
        push("number", i, j);
        i = j;
        continue;
      }
      if (/[a-zA-Z_]/.test(ch)) {
        let j = i;
        while (j < text.length && /[a-zA-Z0-9_]/.test(text[j])) j++;
        const word = text.slice(i, j);
        let type;
        if (CONTROL_KEYWORDS.has(word)) {
          type = "keyword";
        } else if (TYPE_KEYWORDS.has(word)) {
          type = "typekw";
        } else {
          // Heuristics for plain identifiers: call, type, or variable-ish.
          const k = nextNonSpace(text, j);
          const next = text[k] || "";
          const next2 = text.slice(k, k + 2);
          if (prevWord !== null && TYPE_INTRODUCERS.has(prevWord)) {
            type = "type"; // struct Foo
          } else if (next2 === "::") {
            type = "type"; // Foo::bar
          } else if (next === "(") {
            type = "func"; // foo(
          } else if (looksLikeDeclarationType(text, i, k)) {
            type = "type"; // OrderType* Order / MyType value
          } else {
            type = "ident";
          }
        }
        push(type, i, j);
        prevWord = word;
        i = j;
        continue;
      }
      if (["->", "::", "==", "!=", "<=", ">=", "<<", ">>", "&&", "||", "+=", "-=", "*=", "/=", "++", "--"].includes(ch2)) {
        push("operator", i, i + 2);
        i += 2;
        continue;
      }
      if ("+-*/%&|^~!<>=?:.".includes(ch)) push("operator", i, i + 1);
      else push("punctuation", i, i + 1);
      if (!/\s/.test(ch)) prevWord = null;
      i++;
    }
    return { tokens, inBlockComment };
  }

  // ─── Tooltip ────────────────────────────────────────────────────

  let tooltipTimer = null;

  function showTooltip(anchor, html, opts) {
    const t = els.tooltip;
    t.innerHTML = html;
    t.classList.toggle("warn", !!(opts && opts.warn));
    t.hidden = false;
    const r = anchor.getBoundingClientRect();
    const tw = t.offsetWidth;
    const th = t.offsetHeight;
    let left = r.left;
    let top = r.top - th - 6;
    if (top < 4) top = r.bottom + 6;
    if (left + tw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - tw - 8);
    t.style.left = left + "px";
    t.style.top = top + "px";
    if (tooltipTimer) { clearTimeout(tooltipTimer); tooltipTimer = null; }
    if (opts && opts.autoHide) tooltipTimer = setTimeout(hideTooltip, opts.autoHide);
  }

  function hideTooltip() {
    els.tooltip.hidden = true;
    if (tooltipTimer) { clearTimeout(tooltipTimer); tooltipTimer = null; }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  // ─── Header ─────────────────────────────────────────────────────

  function renderHeader() {
    els.crumbFile.textContent = state.fileName || "";
    els.crumbFile.title = state.fileName || "";
    els.crumbFn.textContent = state.functionName || "(file scope)";
    els.crumbFn.title = state.functionName
      ? `${state.functionName}  ·  lines ${state.funcStartLine}–${state.funcEndLine}`
      : "";
    els.crumbLine.textContent = `Line ${state.targetLine}`;

    els.decisionBox.hidden = !state.isDecision;
    els.truthSeg.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("active", (b.dataset.truth || "") === (state.truthValue || ""));
    });
  }

  function renderFooter() {
    const n = state.variables.length;
    const parts = [];
    if (state.enviroName) parts.push(state.enviroName);
    parts.push(`${n} constraint${n === 1 ? "" : "s"}`);
    if (state.targetable && state.targetable.length === 0) {
      parts.push("no coverage data: any line can be targeted");
    }
    els.footerInfo.textContent = parts.join("  ·  ");
    els.footerInfo.title = els.footerInfo.textContent;
  }

  // ─── Code preview ───────────────────────────────────────────────

  function renderCode() {
    const key =
      state.previewStart + "|" + state.lines.join("\n") + "|" +
      state.tokens.map((t) => `${t.line}:${t.start}:${t.end}:${t.path}`).join(",");
    if (key !== codeKey) {
      codeKey = key;
      buildCode();
    }
    applySelection();
    applyTargetable();
    applyTarget();
  }

  function buildCode() {
    els.code.innerHTML = "";
    lineRows.clear();

    const tokenAt = new Map();
    for (const t of state.tokens) tokenAt.set(`${t.line}:${t.start}`, t);

    const lastLine = state.previewStart + state.lines.length - 1;
    const width = Math.max(3, String(lastLine).length);
    const frag = document.createDocumentFragment();
    let inBlock = false;
    let bracketDepth = 0; // carried across lines for rainbow brackets

    state.lines.forEach((text, i) => {
      const lineNo = state.previewStart + i;
      const row = document.createElement("div");
      row.className = "line";
      row.dataset.line = String(lineNo);

      const ln = document.createElement("span");
      ln.className = "ln";
      ln.textContent = String(lineNo).padStart(width, " ");
      row.appendChild(ln);

      const content = document.createElement("span");
      content.className = "content";

      const res = tokenizeLine(text, inBlock);
      inBlock = res.inBlockComment;
      for (const tok of res.tokens) {
        const span = document.createElement("span");
        const ct =
          tok.type === "ident" || tok.type === "type" || tok.type === "func"
            ? tokenAt.get(`${lineNo}:${tok.col}`)
            : undefined;
        if (ct) {
          // The host decided this identifier is a constrainable variable;
          // that always wins over the colouring heuristics.
          span.className = "var";
          span.dataset.path = ct.path;
          span.dataset.type = ct.displayType || "unknown";
          span.dataset.line = String(lineNo);
        } else if (tok.type === "punctuation" && tok.text.length === 1 && OPEN_BRACKETS.includes(tok.text)) {
          span.className = "pn br" + ((bracketDepth % 3) + 1);
          bracketDepth++;
        } else if (tok.type === "punctuation" && tok.text.length === 1 && CLOSE_BRACKETS.includes(tok.text)) {
          bracketDepth = Math.max(0, bracketDepth - 1);
          span.className = "pn br" + ((bracketDepth % 3) + 1);
        } else {
          span.className = TOKEN_CLASS[tok.type] || "";
        }
        span.textContent = tok.text;
        content.appendChild(span);
      }
      row.appendChild(content);
      frag.appendChild(row);
      lineRows.set(lineNo, row);
    });

    els.code.appendChild(frag);
  }

  function selectedPaths() {
    return new Set(state.variables.map((v) => v.path));
  }

  function applySelection() {
    const sel = selectedPaths();
    els.code.querySelectorAll(".var").forEach((s) => {
      s.classList.toggle("selected", sel.has(s.dataset.path));
    });
  }

  function applyTargetable() {
    const set = new Set(state.targetable || []);
    const restrict = set.size > 0;
    lineRows.forEach((row, lineNo) => {
      const blocked = restrict && !set.has(lineNo);
      row.classList.toggle("no-target", blocked);
      const ln = row.firstChild;
      ln.title = blocked
        ? "Not a statement or branch line"
        : lineNo === state.targetLine
          ? "Current target line"
          : `Make line ${lineNo} the target`;
    });
  }

  function applyTarget() {
    lineRows.forEach((row, lineNo) => {
      row.classList.toggle("target", lineNo === state.targetLine);
    });
    if (state.targetLine !== lastScrolledTarget) {
      lastScrolledTarget = state.targetLine;
      const row = lineRows.get(state.targetLine);
      if (row) {
        requestAnimationFrame(() => row.scrollIntoView({ block: "center", behavior: "smooth" }));
      }
    }
  }

  els.code.addEventListener("click", (e) => {
    const ln = e.target.closest(".ln");
    if (ln) {
      const row = ln.closest(".line");
      const lineNo = Number(row.dataset.line);
      if (row.classList.contains("no-target")) {
        showTooltip(ln, "Not a statement or branch line, ATG cannot target it.", { warn: true, autoHide: 1600 });
        return;
      }
      if (lineNo !== state.targetLine) post({ command: "setTargetLine", line: lineNo });
      return;
    }
    const v = e.target.closest(".var");
    if (v) {
      hideTooltip();
      post({ command: "toggleVariable", path: v.dataset.path, line: Number(v.dataset.line) });
    }
  });

  els.code.addEventListener("dblclick", (e) => {
    const row = e.target.closest(".line");
    if (!row || e.target.closest(".var") || e.target.closest(".ln")) return;
    post({ command: "revealLine", line: Number(row.dataset.line) });
  });

  els.code.addEventListener("mouseover", (e) => {
    const v = e.target.closest(".var");
    if (!v) return;
    const sel = selectedPaths().has(v.dataset.path);
    showTooltip(
      v,
      `<code>${esc(v.dataset.path)}</code> : <code>${esc(v.dataset.type)}</code>` +
        `<span class="hint">click to ${sel ? "remove" : "constrain"}</span>`
    );
    crossHighlightCard(v.dataset.path, true);
  });

  els.code.addEventListener("mouseout", (e) => {
    const v = e.target.closest(".var");
    if (!v) return;
    hideTooltip();
    crossHighlightCard(v.dataset.path, false);
  });

  function crossHighlightCard(path, on) {
    els.varList.querySelectorAll(".var-card").forEach((c) => {
      if (c.dataset.path === path) c.classList.toggle("cross", on);
    });
  }

  function crossHighlightCode(path, on) {
    els.code.querySelectorAll(".var").forEach((s) => {
      if (s.dataset.path === path) s.classList.toggle("cross", on);
    });
  }

  // ─── Constraints list (keyed render) ───────────────────────────

  function signature(v) {
    return [v.kind, v.displayType, (v.enumValues || []).join(","), (v.entries || []).length].join("|");
  }

  function renderVars() {
    const vars = state.variables;
    els.varCount.textContent = String(vars.length);
    els.emptyState.hidden = vars.length > 0;

    const existing = new Map();
    els.varList.querySelectorAll(".var-card").forEach((el) => existing.set(el.dataset.path, el));
    const seen = new Set();

    vars.forEach((v, idx) => {
      seen.add(v.path);
      let card = existing.get(v.path);
      if (!card || card.dataset.sig !== signature(v)) {
        const fresh = buildCard(v);
        if (card) card.replaceWith(fresh);
        else els.varList.appendChild(fresh);
        card = fresh;
      } else {
        updateCardValues(card, v);
      }
      if (els.varList.children[idx] !== card) {
        els.varList.insertBefore(card, els.varList.children[idx] || null);
      }
    });

    existing.forEach((el, p) => {
      if (!seen.has(p)) el.remove();
    });
  }

  function makeInput(cls, value, placeholder, onInput) {
    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "input " + (cls || "");
    inp.value = value || "";
    inp.placeholder = placeholder || "";
    inp.spellcheck = false;
    inp.autocomplete = "off";
    inp.addEventListener("input", () => onInput(inp.value));
    return inp;
  }

  function makeSelect(options, value, onChange) {
    const sel = document.createElement("select");
    sel.className = "input";
    for (const [val, label] of options) {
      const o = document.createElement("option");
      o.value = val;
      o.textContent = label;
      if (val === value) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => onChange(sel.value));
    return sel;
  }

  function removeIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("class", "ico");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", "M8 8.7l3.6 3.6.7-.7L8.7 8l3.6-3.6-.7-.7L8 7.3 4.4 3.7l-.7.7L7.3 8l-3.6 3.6.7.7L8 8.7z");
    svg.appendChild(p);
    return svg;
  }

  function buildCard(v) {
    const card = document.createElement("div");
    card.className = "var-card";
    card.dataset.path = v.path;
    card.dataset.sig = signature(v);

    card.addEventListener("mouseenter", () => {
      crossHighlightCode(v.path, true);
      post({ command: "highlightInEditor", path: v.path });
    });
    card.addEventListener("mouseleave", () => {
      crossHighlightCode(v.path, false);
      post({ command: "clearHighlight" });
    });

    // Head: name · type · remove
    const head = document.createElement("div");
    head.className = "var-head";

    const name = document.createElement("span");
    name.className = "var-name";
    name.textContent = v.path;
    name.title = v.path;
    head.appendChild(name);

    const kindClass = "kind-" + (v.kind || "unknown").replace(/[^a-z]/gi, "");
    card.classList.add(kindClass);

    const badge = document.createElement("span");
    badge.className = "badge " + kindClass;
    badge.textContent = v.displayType || v.kind || "unknown";
    badge.title = `${badge.textContent} (${v.kind || "unknown"})`;
    head.appendChild(badge);

    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "icon-btn remove";
    rm.title = `Remove ${v.path}`;
    rm.setAttribute("aria-label", rm.title);
    rm.appendChild(removeIcon());
    rm.addEventListener("click", () => post({ command: "removeVariable", path: v.path }));
    head.appendChild(rm);

    card.appendChild(head);

    // Body: value editor(s)
    const body = document.createElement("div");
    body.className = "var-body";

    if (v.kind === "array") {
      (v.entries || []).forEach((entry, ei) => {
        const row = document.createElement("div");
        row.className = "value-row";

        const lbl = document.createElement("span");
        lbl.className = "arr-label";
        lbl.textContent = v.path + "[";
        row.appendChild(lbl);

        row.appendChild(
          makeInput("idx", entry.index, "index", (val) =>
            post({ command: "updateArrayEntry", path: v.path, entryIndex: ei, field: "index", fieldValue: val })
          )
        );

        const eq = document.createElement("span");
        eq.className = "eq";
        eq.textContent = "] =";
        row.appendChild(eq);

        row.appendChild(
          makeInput("val", entry.value, "value", (val) =>
            post({ command: "updateArrayEntry", path: v.path, entryIndex: ei, field: "value", fieldValue: val })
          )
        );

        const erm = document.createElement("button");
        erm.type = "button";
        erm.className = "icon-btn remove";
        erm.title = "Remove this index";
        erm.appendChild(removeIcon());
        erm.addEventListener("click", () => post({ command: "removeArrayEntry", path: v.path, entryIndex: ei }));
        row.appendChild(erm);

        body.appendChild(row);
      });

      const add = document.createElement("button");
      add.type = "button";
      add.className = "link-btn";
      add.textContent = "+ Add another index";
      add.addEventListener("click", () => post({ command: "addArrayEntry", path: v.path }));
      body.appendChild(add);
    } else {
      const row = document.createElement("div");
      row.className = "value-row";
      const eq = document.createElement("span");
      eq.className = "eq";
      eq.textContent = "=";
      row.appendChild(eq);

      const onValue = (val) => post({ command: "updateValue", path: v.path, value: val });

      if (v.kind === "enum" && v.enumValues && v.enumValues.length > 0) {
        row.appendChild(
          makeSelect([["", "any value"], ...v.enumValues.map((e) => [e, e])], v.value, onValue)
        );
      } else if (v.kind === "bool") {
        const seg = document.createElement("div");
        seg.className = "seg small";
        seg.setAttribute("role", "group");
        for (const [val, label] of [["", "any"], ["true", "true"], ["false", "false"]]) {
          const b = document.createElement("button");
          b.type = "button";
          b.dataset.val = val;
          b.textContent = label;
          b.classList.toggle("active", (v.value || "") === val);
          b.addEventListener("click", () => {
            seg.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
            onValue(val);
          });
          seg.appendChild(b);
        }
        row.appendChild(seg);
      } else {
        const placeholder = v.kind === "string" ? "text, e.g. \"abc\"" : v.kind === "float" ? "number, e.g. 1.5" : v.kind === "int" || v.kind === "char" ? "value, e.g. 42" : "any value";
        row.appendChild(makeInput("val", v.value, placeholder, onValue));
      }
      body.appendChild(row);
    }

    card.appendChild(body);
    return card;
  }

  // Update values in-place without disturbing the field the user is typing in.
  function updateCardValues(card, v) {
    const active = document.activeElement;
    const setIfIdle = (el, val) => {
      if (!el || el === active) return;
      if (el.tagName === "INPUT" || el.tagName === "SELECT") {
        if (el.value !== (val || "")) el.value = val || "";
      }
    };
    if (v.kind === "array") {
      const rows = card.querySelectorAll(".value-row");
      (v.entries || []).forEach((entry, ei) => {
        const row = rows[ei];
        if (!row) return;
        setIfIdle(row.querySelector(".input.idx"), entry.index);
        setIfIdle(row.querySelector(".input.val"), entry.value);
      });
    } else if (v.kind === "bool") {
      card.querySelectorAll(".seg button").forEach((b) => {
        b.classList.toggle("active", (b.dataset.val || "") === (v.value || ""));
      });
    } else {
      setIfIdle(card.querySelector(".value-row .input"), v.value);
    }
  }

  // ─── Quick add ─────────────────────────────────────────────────

  let qaOpen = false;
  let qaIndex = -1;
  let qaItems = [];

  function qaCandidates(filter) {
    const sel = selectedPaths();
    const f = filter.trim().toLowerCase();
    const out = [];
    for (const k of state.known || []) {
      if (sel.has(k.path)) continue;
      if (f && !k.path.toLowerCase().includes(f)) continue;
      out.push(k);
      if (out.length >= 80) break;
    }
    return out;
  }

  function highlightMatch(text, filter) {
    if (!filter) return esc(text);
    const i = text.toLowerCase().indexOf(filter.toLowerCase());
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + "<mark>" + esc(text.slice(i, i + filter.length)) + "</mark>" + esc(text.slice(i + filter.length));
  }

  function qaRender() {
    const filter = els.quickAddInput.value.trim();
    qaItems = qaCandidates(filter);
    els.quickAddList.innerHTML = "";
    if (qaItems.length === 0) {
      const li = document.createElement("li");
      li.className = "none";
      li.textContent = (state.known || []).length === 0
        ? "No variable information available for this function"
        : filter ? `No variables match “${filter}”` : "All known variables are already constrained";
      els.quickAddList.appendChild(li);
      qaIndex = -1;
    } else {
      qaIndex = Math.min(Math.max(qaIndex, 0), qaItems.length - 1);
      qaItems.forEach((k, i) => {
        const li = document.createElement("li");
        li.setAttribute("role", "option");
        li.classList.toggle("active", i === qaIndex);
        const kindClass = "kind-" + (k.kind || "unknown").replace(/[^a-z]/gi, "");
        li.innerHTML =
          `<span class="qa-path">${highlightMatch(k.path, filter)}</span>` +
          `<span class="qa-type ${kindClass}">${esc(k.displayType || k.kind)}</span>` +
          `<span class="qa-group group-${esc(k.group)}">${esc(k.group === "parameter" ? "param" : k.group === "unknown" ? "" : k.group)}</span>`;
        li.addEventListener("mousedown", (e) => {
          e.preventDefault(); // keep focus in the input
          qaChoose(k);
        });
        li.addEventListener("mousemove", () => {
          if (qaIndex !== i) { qaIndex = i; qaMarkActive(); }
        });
        els.quickAddList.appendChild(li);
      });
    }
    els.quickAddList.hidden = false;
    qaOpen = true;
  }

  function qaMarkActive() {
    els.quickAddList.querySelectorAll("li[role=option]").forEach((li, i) => {
      li.classList.toggle("active", i === qaIndex);
      if (i === qaIndex) li.scrollIntoView({ block: "nearest" });
    });
  }

  function qaClose() {
    els.quickAddList.hidden = true;
    qaOpen = false;
    qaIndex = -1;
  }

  function qaChoose(k) {
    post({ command: "addVariable", path: k.path });
    els.quickAddInput.value = "";
    qaIndex = 0;
    qaRender();
  }

  els.quickAddInput.addEventListener("focus", () => { qaIndex = 0; qaRender(); });
  els.quickAddInput.addEventListener("input", () => { qaIndex = 0; qaRender(); });
  els.quickAddInput.addEventListener("blur", () => setTimeout(qaClose, 120));
  els.quickAddInput.addEventListener("keydown", (e) => {
    if (!qaOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) { qaRender(); e.preventDefault(); return; }
    if (e.key === "ArrowDown") { if (qaItems.length) { qaIndex = (qaIndex + 1) % qaItems.length; qaMarkActive(); } e.preventDefault(); }
    else if (e.key === "ArrowUp") { if (qaItems.length) { qaIndex = (qaIndex - 1 + qaItems.length) % qaItems.length; qaMarkActive(); } e.preventDefault(); }
    else if (e.key === "Enter") { if (qaOpen && qaIndex >= 0 && qaItems[qaIndex]) qaChoose(qaItems[qaIndex]); e.preventDefault(); }
    else if (e.key === "Escape") { if (qaOpen) qaClose(); else els.quickAddInput.blur(); e.stopPropagation(); }
  });

  // ─── Header / global actions ───────────────────────────────────

  els.truthSeg.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-truth]");
    if (!b) return;
    post({ command: "setTruthValue", value: b.dataset.truth || "" });
  });

  els.crumbLine.addEventListener("click", () => {
    if (state) post({ command: "revealLine", line: state.targetLine });
  });

  els.btnFetch.addEventListener("click", () => post({ command: "fetchTest" }));
  els.btnCancel.addEventListener("click", () => post({ command: "cancel" }));

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (state && state.isActive) post({ command: "fetchTest" });
    }
  });

  window.addEventListener("resize", hideTooltip);
  els.code.addEventListener("scroll", hideTooltip);

  // ─── Render entry point ────────────────────────────────────────

  function render() {
    if (!state || !state.isActive) {
      els.app.hidden = true;
      els.inactive.hidden = false;
      codeKey = "";
      lastScrolledTarget = 0;
      els.code.innerHTML = "";
      els.varList.innerHTML = "";
      lineRows.clear();
      hideTooltip();
      qaClose();
      return;
    }
    els.inactive.hidden = true;
    els.app.hidden = false;
    renderHeader();
    renderCode();
    renderVars();
    renderFooter();
    if (qaOpen) qaRender();
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg && msg.command === "state") {
      state = msg.state;
      render();
    }
  });

  render();
  post({ command: "ready" });
})();
