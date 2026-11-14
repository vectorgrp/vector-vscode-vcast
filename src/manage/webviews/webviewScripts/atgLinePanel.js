// ATG Test for Line — panel webview script.
//
// The extension host owns all state and pushes it here as a single `state`
// message; this file only renders and reports user intent back. Rendering is
// keyed so that typing into a value field is never interrupted by a re-render.

(function () {
  "use strict";

  const vscode = acquireVsCodeApi();
  const byId = (id) => document.getElementById(id);

  const elements = {
    inactive: byId("inactive"),
    app: byId("app"),
    crumbFile: byId("crumbFile"),
    crumbFunction: byId("crumbFn"),
    crumbLine: byId("crumbLine"),
    decisionBox: byId("decisionBox"),
    actionsSeparator: byId("actionsSep"),
    truthSegment: byId("truthSeg"),
    generateButton: byId("btnFetch"),
    cancelButton: byId("btnCancel"),
    code: byId("code"),
    variableList: byId("varList"),
    variableCount: byId("varCount"),
    emptyState: byId("emptyState"),
    quickAdd: byId("quickAdd"),
    quickAddInput: byId("quickAddInput"),
    quickAddList: byId("quickAddList"),
    footerInfo: byId("footerInfo"),
    tooltip: byId("tooltip"),
    main: document.querySelector(".main"),
    splitter: byId("splitter"),
  };

  let state = null;
  let codeKey = "";
  let lastScrolledTarget = 0;
  const lineRows = new Map(); // line number -> row element

  function postToExtension(message) {
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

  const TWO_CHAR_OPERATORS = [
    "->", "::", "==", "!=", "<=", ">=", "<<", ">>", "&&", "||",
    "+=", "-=", "*=", "/=", "++", "--",
  ];
  const ONE_CHAR_OPERATORS = "+-*/%&|^~!<>=?:.";
  const OPEN_BRACKETS = "([{";
  const CLOSE_BRACKETS = ")]}";

  function nextNonSpace(text, from) {
    let index = from;
    while (index < text.length && /\s/.test(text[index])) index++;
    return index;
  }

  // "T name", "T* name", "T& name" at the start of a statement or parameter:
  // the identifier at [start] is a type if what precedes it is a statement /
  // parameter boundary and what follows is an optional declarator followed by
  // another identifier. Expressions like "a * b" or "x && y" do not qualify.
  function looksLikeDeclarationType(text, start, afterIdentifier) {
    let before = start - 1;
    while (before >= 0 && /\s/.test(text[before])) before--;
    if (before >= 0 && !/[;{}(,]/.test(text[before])) return false;

    let after = afterIdentifier;
    if (text[after] === "*" || text[after] === "&") {
      if (text[after] === "&" && text[after + 1] === "&") return false;
      while (text[after] === "*" || text[after] === "&") after++;
      after = nextNonSpace(text, after);
    }
    return /[a-zA-Z_]/.test(text[after] || "");
  }

  function tokenizeLine(text, inBlockComment) {
    const tokens = [];
    let position = 0;
    const pushToken = (type, start, end) =>
      tokens.push({ type, col: start, text: text.slice(start, end) });

    // Whole-line preprocessor directive
    if (!inBlockComment && /^\s*#/.test(text)) {
      const directiveStart = nextNonSpace(text, 0);
      if (directiveStart > 0) pushToken("whitespace", 0, directiveStart);
      pushToken("preproc", directiveStart, text.length);
      return { tokens, inBlockComment: false };
    }

    let previousWord = null; // last identifier/keyword token text, for "struct Foo"

    while (position < text.length) {
      if (inBlockComment) {
        const commentEnd = text.indexOf("*/", position);
        if (commentEnd === -1) {
          pushToken("comment", position, text.length);
          return { tokens, inBlockComment: true };
        }
        pushToken("comment", position, commentEnd + 2);
        position = commentEnd + 2;
        inBlockComment = false;
        continue;
      }
      const character = text[position];
      const twoCharacters = text.slice(position, position + 2);

      if (twoCharacters === "//") {
        pushToken("comment", position, text.length);
        return { tokens, inBlockComment: false };
      }
      if (twoCharacters === "/*") {
        const commentEnd = text.indexOf("*/", position + 2);
        if (commentEnd === -1) {
          pushToken("comment", position, text.length);
          return { tokens, inBlockComment: true };
        }
        pushToken("comment", position, commentEnd + 2);
        position = commentEnd + 2;
        continue;
      }
      if (character === '"' || character === "'") {
        let scan = position + 1;
        while (scan < text.length) {
          if (text[scan] === "\\" && scan + 1 < text.length) {
            scan += 2;
            continue;
          }
          if (text[scan] === character) {
            scan++;
            break;
          }
          scan++;
        }
        pushToken("string", position, scan);
        position = scan;
        continue;
      }
      if (/\s/.test(character)) {
        let scan = position;
        while (scan < text.length && /\s/.test(text[scan])) scan++;
        pushToken("whitespace", position, scan);
        position = scan;
        continue;
      }
      if (/[0-9]/.test(character)) {
        let scan = position;
        while (scan < text.length && /[0-9a-fA-FxXuUlL.]/.test(text[scan])) scan++;
        pushToken("number", position, scan);
        position = scan;
        continue;
      }
      if (/[a-zA-Z_]/.test(character)) {
        let scan = position;
        while (scan < text.length && /[a-zA-Z0-9_]/.test(text[scan])) scan++;
        const word = text.slice(position, scan);
        let tokenType;
        if (CONTROL_KEYWORDS.has(word)) {
          tokenType = "keyword";
        } else if (TYPE_KEYWORDS.has(word)) {
          tokenType = "typekw";
        } else {
          // Heuristics for plain identifiers: call, type, or variable-ish.
          const nextIndex = nextNonSpace(text, scan);
          const nextCharacter = text[nextIndex] || "";
          const nextTwoCharacters = text.slice(nextIndex, nextIndex + 2);
          if (previousWord !== null && TYPE_INTRODUCERS.has(previousWord)) {
            tokenType = "type"; // struct Foo
          } else if (nextTwoCharacters === "::") {
            tokenType = "type"; // Foo::bar
          } else if (nextCharacter === "(") {
            tokenType = "func"; // foo(
          } else if (looksLikeDeclarationType(text, position, nextIndex)) {
            tokenType = "type"; // OrderType* Order / MyType value
          } else {
            tokenType = "ident";
          }
        }
        pushToken(tokenType, position, scan);
        previousWord = word;
        position = scan;
        continue;
      }
      if (TWO_CHAR_OPERATORS.includes(twoCharacters)) {
        pushToken("operator", position, position + 2);
        position += 2;
        continue;
      }
      if (ONE_CHAR_OPERATORS.includes(character)) {
        pushToken("operator", position, position + 1);
      } else {
        pushToken("punctuation", position, position + 1);
      }
      if (!/\s/.test(character)) previousWord = null;
      position++;
    }
    return { tokens, inBlockComment };
  }

  // ─── Tooltip ────────────────────────────────────────────────────

  let tooltipTimer = null;

  function showTooltip(anchor, html, options) {
    const tooltip = elements.tooltip;
    tooltip.innerHTML = html;
    tooltip.classList.toggle("warn", !!(options && options.warn));
    tooltip.hidden = false;
    const anchorRect = anchor.getBoundingClientRect();
    const tooltipWidth = tooltip.offsetWidth;
    const tooltipHeight = tooltip.offsetHeight;
    let left = anchorRect.left;
    let top = anchorRect.top - tooltipHeight - 6;
    if (top < 4) top = anchorRect.bottom + 6;
    if (left + tooltipWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - tooltipWidth - 8);
    }
    tooltip.style.left = left + "px";
    tooltip.style.top = top + "px";
    if (tooltipTimer) {
      clearTimeout(tooltipTimer);
      tooltipTimer = null;
    }
    if (options && options.autoHide) {
      tooltipTimer = setTimeout(hideTooltip, options.autoHide);
    }
  }

  function hideTooltip() {
    elements.tooltip.hidden = true;
    if (tooltipTimer) {
      clearTimeout(tooltipTimer);
      tooltipTimer = null;
    }
  }

  const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
  }

  // ─── Header ─────────────────────────────────────────────────────

  function renderHeader() {
    elements.crumbFile.textContent = state.fileName || "";
    elements.crumbFile.title = state.fileName || "";
    elements.crumbFunction.textContent = state.functionName || "(file scope)";
    elements.crumbFunction.title = state.functionName
      ? `${state.functionName}  ·  lines ${state.funcStartLine}–${state.funcEndLine}`
      : "";
    elements.crumbLine.textContent = `Line ${state.targetLine}`;

    elements.decisionBox.hidden = !state.isDecision;
    elements.actionsSeparator.hidden = !state.isDecision;
    elements.truthSegment.querySelectorAll("button").forEach((button) => {
      button.classList.toggle(
        "active",
        (button.dataset.truth || "") === (state.truthValue || "")
      );
    });
  }

  function renderFooter() {
    const constraintCount = state.variables.length;
    const parts = [];
    if (state.enviroName) parts.push(state.enviroName);
    parts.push(`${constraintCount} constraint${constraintCount === 1 ? "" : "s"}`);
    if (state.targetable && state.targetable.length === 0) {
      parts.push("no coverage data: any line can be targeted");
    }
    elements.footerInfo.textContent = parts.join("  ·  ");
    elements.footerInfo.title = elements.footerInfo.textContent;
  }

  // ─── Code preview ───────────────────────────────────────────────

  function renderCode() {
    const key =
      state.previewStart + "|" + state.lines.join("\n") + "|" +
      state.tokens
        .map((token) => `${token.line}:${token.start}:${token.end}:${token.path}`)
        .join(",");
    if (key !== codeKey) {
      codeKey = key;
      buildCode();
    }
    applySelection();
    applyLineTitles();
    applyTarget();
  }

  function buildCode() {
    elements.code.innerHTML = "";
    lineRows.clear();

    const clickableTokenAt = new Map();
    for (const token of state.tokens) {
      clickableTokenAt.set(`${token.line}:${token.start}`, token);
    }

    const lastLineNumber = state.previewStart + state.lines.length - 1;
    const gutterWidth = Math.max(3, String(lastLineNumber).length);
    const fragment = document.createDocumentFragment();
    let inBlockComment = false;
    let bracketDepth = 0; // carried across lines for rainbow brackets

    state.lines.forEach((lineText, lineOffset) => {
      const lineNumber = state.previewStart + lineOffset;
      const row = document.createElement("div");
      row.className = "line";
      row.dataset.line = String(lineNumber);

      const gutter = document.createElement("span");
      gutter.className = "ln";
      gutter.textContent = String(lineNumber).padStart(gutterWidth, " ");
      row.appendChild(gutter);

      const content = document.createElement("span");
      content.className = "content";

      const tokenized = tokenizeLine(lineText, inBlockComment);
      inBlockComment = tokenized.inBlockComment;
      for (const token of tokenized.tokens) {
        const span = document.createElement("span");
        const clickable =
          token.type === "ident" || token.type === "type" || token.type === "func"
            ? clickableTokenAt.get(`${lineNumber}:${token.col}`)
            : undefined;
        const isSingleBracket = token.type === "punctuation" && token.text.length === 1;
        if (clickable) {
          // The host decided this identifier is a constrainable variable;
          // that always wins over the colouring heuristics.
          span.className = "var";
          span.dataset.path = clickable.path;
          span.dataset.type = clickable.displayType || "unknown";
          span.dataset.line = String(lineNumber);
        } else if (isSingleBracket && OPEN_BRACKETS.includes(token.text)) {
          span.className = "pn br" + ((bracketDepth % 3) + 1);
          bracketDepth++;
        } else if (isSingleBracket && CLOSE_BRACKETS.includes(token.text)) {
          bracketDepth = Math.max(0, bracketDepth - 1);
          span.className = "pn br" + ((bracketDepth % 3) + 1);
        } else {
          span.className = TOKEN_CLASS[token.type] || "";
        }
        span.textContent = token.text;
        content.appendChild(span);
      }
      row.appendChild(content);
      fragment.appendChild(row);
      lineRows.set(lineNumber, row);
    });

    elements.code.appendChild(fragment);
  }

  function selectedPaths() {
    return new Set(state.variables.map((variable) => variable.path));
  }

  function applySelection() {
    const selected = selectedPaths();
    elements.code.querySelectorAll(".var").forEach((span) => {
      span.classList.toggle("selected", selected.has(span.dataset.path));
    });
  }

  function applyLineTitles() {
    lineRows.forEach((row, lineNumber) => {
      row.firstChild.title = lineNumber === state.targetLine ? "ATG target line" : "";
    });
  }

  function applyTarget() {
    lineRows.forEach((row, lineNumber) => {
      row.classList.toggle("target", lineNumber === state.targetLine);
    });
    if (state.targetLine !== lastScrolledTarget) {
      lastScrolledTarget = state.targetLine;
      const targetRow = lineRows.get(state.targetLine);
      if (targetRow) {
        requestAnimationFrame(() =>
          targetRow.scrollIntoView({ block: "center", behavior: "smooth" })
        );
      }
    }
  }

  elements.code.addEventListener("click", (event) => {
    if (event.target.closest(".ln")) return;
    const variableSpan = event.target.closest(".var");
    if (variableSpan) {
      hideTooltip();
      postToExtension({
        command: "toggleVariable",
        path: variableSpan.dataset.path,
        line: Number(variableSpan.dataset.line),
      });
    }
  });

  elements.code.addEventListener("dblclick", (event) => {
    const row = event.target.closest(".line");
    if (!row || event.target.closest(".var") || event.target.closest(".ln")) return;
    postToExtension({ command: "revealLine", line: Number(row.dataset.line) });
  });

  elements.code.addEventListener("mouseover", (event) => {
    const variableSpan = event.target.closest(".var");
    if (!variableSpan) return;
    const isSelected = selectedPaths().has(variableSpan.dataset.path);
    showTooltip(
      variableSpan,
      `<code>${escapeHtml(variableSpan.dataset.path)}</code> : <code>${escapeHtml(variableSpan.dataset.type)}</code>` +
        `<span class="hint">click to ${isSelected ? "remove" : "constrain"}</span>`
    );
    crossHighlightCard(variableSpan.dataset.path, true);
  });

  elements.code.addEventListener("mouseout", (event) => {
    const variableSpan = event.target.closest(".var");
    if (!variableSpan) return;
    hideTooltip();
    crossHighlightCard(variableSpan.dataset.path, false);
  });

  function crossHighlightCard(path, highlighted) {
    elements.variableList.querySelectorAll(".var-card").forEach((card) => {
      if (card.dataset.path === path) card.classList.toggle("cross", highlighted);
    });
  }

  function crossHighlightCode(path, highlighted) {
    elements.code.querySelectorAll(".var").forEach((span) => {
      if (span.dataset.path === path) span.classList.toggle("cross", highlighted);
    });
  }

  // ─── Constraints list (keyed render) ───────────────────────────

  // Everything about a variable that changes the card's structure. Value
  // changes alone do not, so they can be applied in place.
  function cardSignature(variable) {
    return [
      variable.kind,
      variable.displayType,
      (variable.enumValues || []).join(","),
      (variable.entries || []).length,
    ].join("|");
  }

  function renderVariables() {
    const variables = state.variables;
    elements.variableCount.textContent = String(variables.length);
    elements.emptyState.hidden = variables.length > 0;

    const existingCards = new Map();
    elements.variableList
      .querySelectorAll(".var-card")
      .forEach((card) => existingCards.set(card.dataset.path, card));
    const seenPaths = new Set();

    variables.forEach((variable, position) => {
      seenPaths.add(variable.path);
      let card = existingCards.get(variable.path);
      if (!card || card.dataset.sig !== cardSignature(variable)) {
        const freshCard = buildCard(variable);
        if (card) card.replaceWith(freshCard);
        else elements.variableList.appendChild(freshCard);
        card = freshCard;
      } else {
        updateCardValues(card, variable);
      }
      if (elements.variableList.children[position] !== card) {
        elements.variableList.insertBefore(
          card,
          elements.variableList.children[position] || null
        );
      }
    });

    existingCards.forEach((card, path) => {
      if (!seenPaths.has(path)) card.remove();
    });
  }

  function makeInput(extraClass, value, placeholder, onInput) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "input " + (extraClass || "");
    input.value = value || "";
    input.placeholder = placeholder || "";
    input.spellcheck = false;
    input.autocomplete = "off";
    input.addEventListener("input", () => onInput(input.value));
    return input;
  }

  function makeSelect(options, currentValue, onChange) {
    const select = document.createElement("select");
    select.className = "input";
    for (const [optionValue, optionLabel] of options) {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = optionLabel;
      if (optionValue === currentValue) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }

  function removeIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("class", "ico");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M8 8.7l3.6 3.6.7-.7L8.7 8l3.6-3.6-.7-.7L8 7.3 4.4 3.7l-.7.7L7.3 8l-3.6 3.6.7.7L8 8.7z");
    svg.appendChild(path);
    return svg;
  }

  function placeholderForKind(kind) {
    if (kind === "string") return 'text, e.g. "abc"';
    if (kind === "float") return "number, e.g. 1.5";
    if (kind === "int" || kind === "char") return "value, e.g. 42";
    return "any value";
  }

  function buildArrayEntryRow(variable, entry, entryIndex) {
    const row = document.createElement("div");
    row.className = "value-row";

    const label = document.createElement("span");
    label.className = "arr-label";
    label.textContent = variable.path + "[";
    row.appendChild(label);

    row.appendChild(
      makeInput("idx", entry.index, "index", (newIndex) =>
        postToExtension({
          command: "updateArrayEntry",
          path: variable.path,
          entryIndex,
          field: "index",
          fieldValue: newIndex,
        })
      )
    );

    const equals = document.createElement("span");
    equals.className = "eq";
    equals.textContent = "] =";
    row.appendChild(equals);

    row.appendChild(
      makeInput("val", entry.value, "value", (newValue) =>
        postToExtension({
          command: "updateArrayEntry",
          path: variable.path,
          entryIndex,
          field: "value",
          fieldValue: newValue,
        })
      )
    );

    const removeEntryButton = document.createElement("button");
    removeEntryButton.type = "button";
    removeEntryButton.className = "icon-btn remove";
    removeEntryButton.title = "Remove this index";
    removeEntryButton.appendChild(removeIcon());
    removeEntryButton.addEventListener("click", () =>
      postToExtension({ command: "removeArrayEntry", path: variable.path, entryIndex })
    );
    row.appendChild(removeEntryButton);
    return row;
  }

  function buildBoolSegment(variable, onValue) {
    const segment = document.createElement("div");
    segment.className = "seg small";
    segment.setAttribute("role", "group");
    for (const [choiceValue, choiceLabel] of [["", "any"], ["true", "true"], ["false", "false"]]) {
      const choiceButton = document.createElement("button");
      choiceButton.type = "button";
      choiceButton.dataset.val = choiceValue;
      choiceButton.textContent = choiceLabel;
      choiceButton.classList.toggle("active", (variable.value || "") === choiceValue);
      choiceButton.addEventListener("click", () => {
        segment
          .querySelectorAll("button")
          .forEach((other) => other.classList.toggle("active", other === choiceButton));
        onValue(choiceValue);
      });
      segment.appendChild(choiceButton);
    }
    return segment;
  }

  function buildCard(variable) {
    const card = document.createElement("div");
    card.className = "var-card";
    card.dataset.path = variable.path;
    card.dataset.sig = cardSignature(variable);

    card.addEventListener("mouseenter", () => {
      crossHighlightCode(variable.path, true);
      postToExtension({ command: "highlightInEditor", path: variable.path });
    });
    card.addEventListener("mouseleave", () => {
      crossHighlightCode(variable.path, false);
      postToExtension({ command: "clearHighlight" });
    });

    // Head: name · type · remove
    const head = document.createElement("div");
    head.className = "var-head";

    const name = document.createElement("span");
    name.className = "var-name";
    name.textContent = variable.path;
    name.title = variable.path;
    head.appendChild(name);

    const kindClass = "kind-" + (variable.kind || "unknown").replace(/[^a-z]/gi, "");
    card.classList.add(kindClass);

    const typeBadge = document.createElement("span");
    typeBadge.className = "badge " + kindClass;
    typeBadge.textContent = variable.displayType || variable.kind || "unknown";
    typeBadge.title = `${typeBadge.textContent} (${variable.kind || "unknown"})`;
    head.appendChild(typeBadge);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "icon-btn remove";
    removeButton.title = `Remove ${variable.path}`;
    removeButton.setAttribute("aria-label", removeButton.title);
    removeButton.appendChild(removeIcon());
    removeButton.addEventListener("click", () =>
      postToExtension({ command: "removeVariable", path: variable.path })
    );
    head.appendChild(removeButton);

    card.appendChild(head);

    // Body: value editor(s)
    const body = document.createElement("div");
    body.className = "var-body";

    if (variable.kind === "array") {
      (variable.entries || []).forEach((entry, entryIndex) => {
        body.appendChild(buildArrayEntryRow(variable, entry, entryIndex));
      });

      const addEntryButton = document.createElement("button");
      addEntryButton.type = "button";
      addEntryButton.className = "link-btn";
      addEntryButton.textContent = "+ Add another index";
      addEntryButton.addEventListener("click", () =>
        postToExtension({ command: "addArrayEntry", path: variable.path })
      );
      body.appendChild(addEntryButton);
    } else {
      const row = document.createElement("div");
      row.className = "value-row";
      const equals = document.createElement("span");
      equals.className = "eq";
      equals.textContent = "=";
      row.appendChild(equals);

      const onValue = (newValue) =>
        postToExtension({ command: "updateValue", path: variable.path, value: newValue });

      const hasEnumValues =
        variable.kind === "enum" && variable.enumValues && variable.enumValues.length > 0;
      if (hasEnumValues) {
        const options = [["", "any value"], ...variable.enumValues.map((name) => [name, name])];
        row.appendChild(makeSelect(options, variable.value, onValue));
      } else if (variable.kind === "bool") {
        row.appendChild(buildBoolSegment(variable, onValue));
      } else {
        row.appendChild(
          makeInput("val", variable.value, placeholderForKind(variable.kind), onValue)
        );
      }
      body.appendChild(row);
    }

    card.appendChild(body);
    return card;
  }

  // Update values in-place without disturbing the field the user is typing in.
  function updateCardValues(card, variable) {
    const focusedElement = document.activeElement;
    const setUnlessFocused = (field, newValue) => {
      if (!field || field === focusedElement) return;
      if (field.tagName === "INPUT" || field.tagName === "SELECT") {
        if (field.value !== (newValue || "")) field.value = newValue || "";
      }
    };
    if (variable.kind === "array") {
      const rows = card.querySelectorAll(".value-row");
      (variable.entries || []).forEach((entry, entryIndex) => {
        const row = rows[entryIndex];
        if (!row) return;
        setUnlessFocused(row.querySelector(".input.idx"), entry.index);
        setUnlessFocused(row.querySelector(".input.val"), entry.value);
      });
    } else if (variable.kind === "bool") {
      card.querySelectorAll(".seg button").forEach((choiceButton) => {
        choiceButton.classList.toggle(
          "active",
          (choiceButton.dataset.val || "") === (variable.value || "")
        );
      });
    } else {
      setUnlessFocused(card.querySelector(".value-row .input"), variable.value);
    }
  }

  // ─── Quick add ─────────────────────────────────────────────────

  const MAX_QUICK_ADD_RESULTS = 80;
  let quickAddOpen = false;
  let quickAddActiveIndex = -1;
  let quickAddItems = [];

  function quickAddCandidates(filterText) {
    const alreadySelected = selectedPaths();
    const needle = filterText.trim().toLowerCase();
    const candidates = [];
    for (const knownVariable of state.known || []) {
      if (alreadySelected.has(knownVariable.path)) continue;
      if (needle && !knownVariable.path.toLowerCase().includes(needle)) continue;
      candidates.push(knownVariable);
      if (candidates.length >= MAX_QUICK_ADD_RESULTS) break;
    }
    return candidates;
  }

  function highlightMatch(text, filterText) {
    if (!filterText) return escapeHtml(text);
    const matchStart = text.toLowerCase().indexOf(filterText.toLowerCase());
    if (matchStart < 0) return escapeHtml(text);
    const matchEnd = matchStart + filterText.length;
    return (
      escapeHtml(text.slice(0, matchStart)) +
      "<mark>" + escapeHtml(text.slice(matchStart, matchEnd)) + "</mark>" +
      escapeHtml(text.slice(matchEnd))
    );
  }

  function groupLabel(group) {
    if (group === "parameter") return "param";
    if (group === "unknown") return "";
    return group;
  }

  function renderQuickAdd() {
    const filterText = elements.quickAddInput.value.trim();
    quickAddItems = quickAddCandidates(filterText);
    elements.quickAddList.innerHTML = "";
    if (quickAddItems.length === 0) {
      const emptyItem = document.createElement("li");
      emptyItem.className = "none";
      if ((state.known || []).length === 0) {
        emptyItem.textContent = "No variable information available for this function";
      } else if (filterText) {
        emptyItem.textContent = `No variables match “${filterText}”`;
      } else {
        emptyItem.textContent = "All known variables are already constrained";
      }
      elements.quickAddList.appendChild(emptyItem);
      quickAddActiveIndex = -1;
    } else {
      quickAddActiveIndex = Math.min(
        Math.max(quickAddActiveIndex, 0),
        quickAddItems.length - 1
      );
      quickAddItems.forEach((knownVariable, itemIndex) => {
        const item = document.createElement("li");
        item.setAttribute("role", "option");
        item.classList.toggle("active", itemIndex === quickAddActiveIndex);
        const kindClass = "kind-" + (knownVariable.kind || "unknown").replace(/[^a-z]/gi, "");
        item.innerHTML =
          `<span class="qa-path">${highlightMatch(knownVariable.path, filterText)}</span>` +
          `<span class="qa-type ${kindClass}">${escapeHtml(knownVariable.displayType || knownVariable.kind)}</span>` +
          `<span class="qa-group group-${escapeHtml(knownVariable.group)}">${escapeHtml(groupLabel(knownVariable.group))}</span>`;
        item.addEventListener("mousedown", (event) => {
          event.preventDefault(); // keep focus in the input
          chooseQuickAdd(knownVariable);
        });
        item.addEventListener("mousemove", () => {
          if (quickAddActiveIndex !== itemIndex) {
            quickAddActiveIndex = itemIndex;
            markActiveQuickAddItem();
          }
        });
        elements.quickAddList.appendChild(item);
      });
    }
    elements.quickAddList.hidden = false;
    quickAddOpen = true;
  }

  function markActiveQuickAddItem() {
    elements.quickAddList.querySelectorAll("li[role=option]").forEach((item, itemIndex) => {
      item.classList.toggle("active", itemIndex === quickAddActiveIndex);
      if (itemIndex === quickAddActiveIndex) item.scrollIntoView({ block: "nearest" });
    });
  }

  function closeQuickAdd() {
    elements.quickAddList.hidden = true;
    quickAddOpen = false;
    quickAddActiveIndex = -1;
  }

  function chooseQuickAdd(knownVariable) {
    postToExtension({ command: "addVariable", path: knownVariable.path });
    elements.quickAddInput.value = "";
    quickAddActiveIndex = 0;
    renderQuickAdd();
  }

  function moveQuickAddSelection(step) {
    if (!quickAddItems.length) return;
    const count = quickAddItems.length;
    quickAddActiveIndex = (quickAddActiveIndex + step + count) % count;
    markActiveQuickAddItem();
  }

  elements.quickAddInput.addEventListener("focus", () => {
    quickAddActiveIndex = 0;
    renderQuickAdd();
  });
  elements.quickAddInput.addEventListener("input", () => {
    quickAddActiveIndex = 0;
    renderQuickAdd();
  });
  elements.quickAddInput.addEventListener("blur", () => setTimeout(closeQuickAdd, 120));
  elements.quickAddInput.addEventListener("keydown", (event) => {
    if (!quickAddOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      renderQuickAdd();
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowDown") {
      moveQuickAddSelection(1);
      event.preventDefault();
    } else if (event.key === "ArrowUp") {
      moveQuickAddSelection(-1);
      event.preventDefault();
    } else if (event.key === "Enter") {
      const activeItem = quickAddOpen && quickAddActiveIndex >= 0 && quickAddItems[quickAddActiveIndex];
      if (activeItem) chooseQuickAdd(activeItem);
      event.preventDefault();
    } else if (event.key === "Escape") {
      if (quickAddOpen) closeQuickAdd();
      else elements.quickAddInput.blur();
      event.stopPropagation();
    }
  });

  // ─── Header / global actions ───────────────────────────────────

  elements.truthSegment.addEventListener("click", (event) => {
    const truthButton = event.target.closest("button[data-truth]");
    if (!truthButton) return;
    postToExtension({ command: "setTruthValue", value: truthButton.dataset.truth || "" });
  });

  elements.crumbLine.addEventListener("click", () => {
    if (state) postToExtension({ command: "revealLine", line: state.targetLine });
  });

  elements.generateButton.addEventListener("click", () =>
    postToExtension({ command: "fetchTest" })
  );
  elements.cancelButton.addEventListener("click", () => postToExtension({ command: "cancel" }));

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      if (state && state.isActive) postToExtension({ command: "fetchTest" });
    }
  });

  window.addEventListener("resize", hideTooltip);
  elements.code.addEventListener("scroll", hideTooltip);

  // ─── Resizable split (remembered per webview) ──────────────────

  function loadPersistedState() {
    try {
      return vscode.getState() || {};
    } catch (error) {
      return {};
    }
  }

  function savePersistedState(changes) {
    try {
      vscode.setState({ ...loadPersistedState(), ...changes });
    } catch (error) {
      /* persisted state is a convenience only */
    }
  }

  function isColumnLayout() {
    return getComputedStyle(elements.main).flexDirection === "column";
  }

  function applySplit(persisted) {
    if (typeof persisted.codeSize === "number") {
      elements.main.style.setProperty("--code-size", persisted.codeSize + "%");
    }
    if (typeof persisted.sideSize === "number") {
      elements.main.style.setProperty("--side-size", persisted.sideSize + "%");
    }
  }

  applySplit(loadPersistedState());

  elements.splitter.addEventListener("pointerdown", (downEvent) => {
    downEvent.preventDefault();
    const columnLayout = isColumnLayout();
    const mainRect = elements.main.getBoundingClientRect();
    elements.splitter.setPointerCapture(downEvent.pointerId);
    elements.splitter.classList.add("dragging");
    document.body.classList.add("resizing");
    document.body.style.cursor = columnLayout ? "row-resize" : "col-resize";
    let percent = null;

    const onPointerMove = (moveEvent) => {
      if (columnLayout) {
        // constraints pane is on top; its height follows the pointer
        percent = ((moveEvent.clientY - mainRect.top) / mainRect.height) * 100;
        percent = Math.min(85, Math.max(15, percent));
        elements.main.style.setProperty("--side-size", percent + "%");
      } else {
        percent = ((moveEvent.clientX - mainRect.left) / mainRect.width) * 100;
        percent = Math.min(80, Math.max(20, percent));
        elements.main.style.setProperty("--code-size", percent + "%");
      }
    };
    const onPointerUp = (upEvent) => {
      elements.splitter.removeEventListener("pointermove", onPointerMove);
      elements.splitter.removeEventListener("pointerup", onPointerUp);
      elements.splitter.removeEventListener("pointercancel", onPointerUp);
      elements.splitter.classList.remove("dragging");
      document.body.classList.remove("resizing");
      document.body.style.cursor = "";
      try {
        elements.splitter.releasePointerCapture(upEvent.pointerId);
      } catch (error) {
        /* already released */
      }
      if (percent !== null) {
        savePersistedState(columnLayout ? { sideSize: percent } : { codeSize: percent });
      }
    };
    elements.splitter.addEventListener("pointermove", onPointerMove);
    elements.splitter.addEventListener("pointerup", onPointerUp);
    elements.splitter.addEventListener("pointercancel", onPointerUp);
  });

  // Double-click resets to the default split
  elements.splitter.addEventListener("dblclick", () => {
    elements.main.style.removeProperty("--code-size");
    elements.main.style.removeProperty("--side-size");
    savePersistedState({ codeSize: undefined, sideSize: undefined });
  });

  // ─── Render entry point ────────────────────────────────────────

  function render() {
    if (!state || !state.isActive) {
      elements.app.hidden = true;
      elements.inactive.hidden = false;
      codeKey = "";
      lastScrolledTarget = 0;
      elements.code.innerHTML = "";
      elements.variableList.innerHTML = "";
      lineRows.clear();
      hideTooltip();
      closeQuickAdd();
      return;
    }
    elements.inactive.hidden = true;
    elements.app.hidden = false;
    renderHeader();
    renderCode();
    renderVariables();
    renderFooter();
    if (quickAddOpen) renderQuickAdd();
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message && message.command === "state") {
      state = message.state;
      render();
    }
  });

  render();
  postToExtension({ command: "ready" });
})();
