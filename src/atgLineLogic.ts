// Pure helpers for the "ATG Test for Line" feature.
//
// Nothing in this module imports vscode, so the same logic drives both the
// editor decorations and the panel webview, and it can be unit tested without
// an extension host.

export type VariableGroup = "parameter" | "global" | "local" | "unknown";

export interface VariableInfo {
  displayType: string;
  kind: string;
  enumValues: string[];
  group: VariableGroup;
  children: Map<string, VariableInfo>;
}

export interface ArrayEntry {
  index: string;
  value: string;
}

export interface SelectedVariable {
  displayType: string;
  kind: string;
  enumValues: string[];
  value: string;
  entries: ArrayEntry[];
}

/** An identifier occurrence the user can click to constrain. */
export interface ClickableToken {
  /** 1-based source line. */
  line: number;
  /** 0-based start column, inclusive. */
  start: number;
  /** 0-based end column, exclusive. */
  end: number;
  /** Dotted access path, e.g. "Order.Entree". */
  path: string;
  displayType: string;
  kind: string;
}

/** Flattened entry of the variable lookup, used by the panel's quick-add list. */
export interface KnownVariable {
  path: string;
  displayType: string;
  kind: string;
  group: VariableGroup;
  enumValues: string[];
}

/**
 * Merge a tree of variable nodes (as produced by vTestInterface's
 * getVariableInfo / getLocalVariables modes) into a lookup map.
 */
export function buildLookupFromNodes(
  nodes: any[] | undefined,
  target: Map<string, VariableInfo>,
  group: VariableGroup = "unknown"
): void {
  if (!nodes) return;
  for (const node of nodes) {
    if (!node || typeof node.name !== "string") continue;
    const entry: VariableInfo = {
      displayType: node.displayType || "",
      kind: node.kind || "unknown",
      enumValues: Array.isArray(node.enumValues) ? node.enumValues : [],
      group,
      children: new Map(),
    };
    if (Array.isArray(node.children) && node.children.length > 0) {
      buildLookupFromNodes(node.children, entry.children, group);
    }
    target.set(node.name, entry);
  }
}

/** Resolve a dotted path ("a.b.c") against the lookup tree. */
export function lookupPath(
  lookup: Map<string, VariableInfo>,
  pathStr: string
): VariableInfo | null {
  const parts = pathStr.split(".");
  let current = lookup;
  let info: VariableInfo | null = null;
  for (const part of parts) {
    const entry = current.get(part);
    if (!entry) return null;
    info = entry;
    current = entry.children;
  }
  return info;
}

/**
 * Given an identifier at `col` in `line`, walk backwards over "." and "->"
 * member accesses to build the full dotted path.
 *   resolvePathFromLine("x = s->f.g;", 9, "g")  ->  "s.f.g"
 */
export function resolvePathFromLine(
  line: string,
  col: number,
  name: string
): string {
  const segments = [name];
  let pos = col;

  while (pos > 0) {
    let p = pos - 1;
    while (p >= 0 && /\s/.test(line[p])) p--;

    if (p >= 1 && line[p - 1] === "-" && line[p] === ">") {
      p -= 2;
    } else if (p >= 0 && line[p] === ".") {
      p--;
    } else {
      break;
    }

    while (p >= 0 && /\s/.test(line[p])) p--;

    const identEnd = p + 1;
    while (p >= 0 && /[a-zA-Z0-9_]/.test(line[p])) p--;
    p++;

    if (p < identEnd) {
      segments.unshift(line.substring(p, identEnd));
      pos = p;
    } else {
      break;
    }
  }

  return segments.join(".");
}

/**
 * True if the line text starts a decision (if / else if / while / for /
 * switch / do-while / ternary). A leading "}" is tolerated so that
 * "} else if (" and "} while (" count.
 */
export function isDecisionLineText(text: string): boolean {
  const t = text.trimStart();
  return (
    /^(}\s*)?(if|else\s+if|while|for|switch)\s*\(/.test(t) ||
    /}\s*while\s*\(/.test(t) ||
    /\?\s*.*\s*:/.test(t)
  );
}

/**
 * If `fullPath` is subscripted on the line (e.g. "buf[i]"), return the index
 * expression text, otherwise "".
 */
export function getDefaultIndexFromLineText(
  lineText: string,
  fullPath: string
): string {
  const escaped = fullPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}\\s*\\[\\s*([^\\]]+?)\\s*\\]`);
  const m = regex.exec(lineText);
  return m ? m[1].trim() : "";
}

/**
 * Locate the function body that contains `functionName` in `lines`.
 * Returns 1-based inclusive bounds. Falls back to the whole file.
 */
export function findFunctionBounds(
  lines: string[],
  functionName?: string
): { start: number; end: number } {
  const whole = { start: 1, end: Math.max(1, lines.length) };
  if (!functionName) return whole;

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(functionName) || !/\(/.test(lines[i])) continue;

    let depth = 0;
    let sawBrace = false;
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === "{") {
          depth++;
          sawBrace = true;
        } else if (ch === "}") {
          depth--;
          if (sawBrace && depth === 0) {
            return { start: i + 1, end: j + 1 };
          }
        }
      }
    }
    // Opening line found but the body never closed: take the rest of the file.
    return { start: i + 1, end: lines.length };
  }
  return whole;
}

/**
 * Find every identifier occurrence in [startLine, endLine] (1-based,
 * inclusive) that the user may constrain. An identifier is clickable when the
 * lookup knows it as a non-struct value, or when it is an unknown field access
 * ("p->x" where x is not in the lookup). Identifiers in line comments are
 * skipped.
 */
export function computeClickableTokens(
  lines: string[],
  startLine: number,
  endLine: number,
  lookup: Map<string, VariableInfo>
): ClickableToken[] {
  const result: ClickableToken[] = [];
  const identRegex = /\b([a-zA-Z_]\w*)\b/g;

  const first = Math.max(1, startLine);
  const last = Math.min(endLine, lines.length);

  for (let lineNo = first; lineNo <= last; lineNo++) {
    const line = lines[lineNo - 1];
    if (!line) continue;

    const commentStart = line.indexOf("//");
    identRegex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = identRegex.exec(line)) !== null) {
      const name = match[1];
      const col = match.index;
      if (commentStart !== -1 && col > commentStart) break;

      const fullPath = resolvePathFromLine(line, col, name);
      const info = lookupPath(lookup, fullPath);
      if (info && info.kind === "struct") continue; // by-value struct: not assignable

      const before = line.substring(0, col).trimEnd();
      const isFieldAccess = before.endsWith("->") || before.endsWith(".");
      if (!info && !isFieldAccess) continue;

      result.push({
        line: lineNo,
        start: col,
        end: col + name.length,
        path: fullPath,
        displayType: info?.displayType || "",
        kind: info?.kind || "unknown",
      });
    }
  }
  return result;
}

/**
 * Flatten the lookup tree into a sorted list of assignable paths. By-value
 * structs are not listed themselves, but their fields are.
 */
export function flattenLookup(
  lookup: Map<string, VariableInfo>
): KnownVariable[] {
  const out: KnownVariable[] = [];
  const walk = (map: Map<string, VariableInfo>, prefix: string) => {
    for (const [name, info] of map) {
      const p = prefix ? `${prefix}.${name}` : name;
      if (info.kind !== "struct") {
        out.push({
          path: p,
          displayType: info.displayType,
          kind: info.kind,
          group: info.group,
          enumValues: info.enumValues,
        });
      }
      if (info.children.size > 0) walk(info.children, p);
    }
  };
  walk(lookup, "");

  const groupOrder: Record<VariableGroup, number> = {
    parameter: 0,
    local: 1,
    global: 2,
    unknown: 3,
  };
  out.sort((a, b) => {
    const g = groupOrder[a.group] - groupOrder[b.group];
    if (g !== 0) return g;
    return a.path.localeCompare(b.path);
  });
  return out;
}

/**
 * Turn the selected variables into the name/value pairs ATG expects. Array
 * variables contribute one pair per filled-in index; anything without a value
 * is dropped.
 */
export function buildVariableValues(
  selected: Map<string, SelectedVariable>
): { name: string; value: string }[] {
  const values: { name: string; value: string }[] = [];
  for (const [name, info] of selected) {
    if (info.kind === "array" && info.entries.length > 0) {
      for (const entry of info.entries) {
        const idx = entry.index.trim();
        const val = entry.value.trim();
        if (idx && val) values.push({ name: `${name}[${idx}]`, value: val });
      }
    } else if (info.value.trim()) {
      values.push({ name, value: info.value.trim() });
    }
  }
  return values;
}

/**
 * Choose the slice of the function to show in the panel. Long functions are
 * clamped to a window around the target line so the webview stays light.
 * Returns 1-based inclusive bounds.
 */
export function choosePreviewWindow(
  funcStart: number,
  funcEnd: number,
  targetLine: number,
  maxLines = 400
): { start: number; end: number } {
  if (funcEnd - funcStart + 1 <= maxLines) {
    return { start: funcStart, end: funcEnd };
  }
  const before = Math.floor(maxLines * 0.4);
  let start = Math.max(funcStart, targetLine - before);
  let end = start + maxLines - 1;
  if (end > funcEnd) {
    end = funcEnd;
    start = Math.max(funcStart, end - maxLines + 1);
  }
  return { start, end };
}
