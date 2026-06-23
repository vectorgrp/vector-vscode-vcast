// Search + unit/function filter for the requirements editor.

import {
  state,
  filterUnit,
  filterFunction,
  searchInput,
  searchCount,
  reqsBody,
} from "./state.js";

// Sentinel value for "(Not set)" in the unit/function dropdowns. Real
// values are arbitrary strings; this one starts with NUL so it can't
// collide with a legitimate identifier.
export const NOT_SET = "\u0000not-set";

function fillSelect(sel, label, items) {
  const previous = sel.value;
  while (sel.firstChild) sel.removeChild(sel.firstChild);

  const any = document.createElement("option");
  any.value = "";
  any.textContent = `(Any ${label})`;
  sel.appendChild(any);

  const none = document.createElement("option");
  none.value = NOT_SET;
  none.textContent = "(Not set)";
  sel.appendChild(none);

  for (const v of [...items].sort((a, b) => a.localeCompare(b))) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  }

  sel.value = [...sel.options].some((o) => o.value === previous)
    ? previous
    : "";
}

// All units known to the env plus any "(not in env)" stragglers that appear
// in current traceability.
function collectUnits() {
  const units = new Set();
  const map = state.unitsToFunctions || {};
  for (const u of Object.keys(map)) units.add(u);
  for (const trace of Object.values(state.traceability)) {
    if (trace?.unit) units.add(trace.unit);
  }
  return units;
}

// Functions to offer in the function dropdown, scoped to the selected unit:
// only that unit's functions (env list + traceability stragglers under it).
// With no unit selected ("(Any)") every function is offered; with "(Not set)"
// only functions of requirements that have no unit.
function collectFunctions(selectedUnit) {
  const fns = new Set();
  const map = state.unitsToFunctions || {};
  if (selectedUnit === NOT_SET) {
    for (const trace of Object.values(state.traceability)) {
      if (trace?.function && !trace.unit) fns.add(trace.function);
    }
  } else if (selectedUnit) {
    for (const f of map[selectedUnit] || []) fns.add(f);
    for (const trace of Object.values(state.traceability)) {
      if (trace?.function && trace.unit === selectedUnit) fns.add(trace.function);
    }
  } else {
    for (const u of Object.keys(map)) for (const f of map[u] || []) fns.add(f);
    for (const trace of Object.values(state.traceability)) {
      if (trace?.function) fns.add(trace.function);
    }
  }
  return fns;
}

/**
 * Populate the unit and function dropdowns. Options come from the env's
 * canonical list (so a brand-new unit shows up before anything traces to
 * it — that's exactly when filtering down to "(Not set)" is most useful)
 * plus any "(not in env)" stragglers that legitimately appear in current
 * traceability. Both dropdowns also offer "(Any)" and "(Not set)" — the
 * latter is what to pick when looking for requirements that still need
 * traceability. The function dropdown is scoped to the selected unit so a
 * unit's functions don't bleed across units (mirrors the per-card behaviour).
 */
export function rebuildFilterDropdowns() {
  if (!filterUnit || !filterFunction) return;
  fillSelect(filterUnit, "unit", collectUnits());
  fillSelect(filterFunction, "function", collectFunctions(filterUnit.value));
}

/**
 * Run when the unit filter changes: re-scope the function dropdown to the
 * newly selected unit (dropping a now-irrelevant function selection), then
 * re-apply the filter.
 */
export function onUnitFilterChange() {
  if (filterFunction) {
    fillSelect(filterFunction, "function", collectFunctions(filterUnit.value));
  }
  applyFilter();
}

/**
 * Hide cards that fail any of the active filters: the search text
 * (substring AND on whitespace tokens, against the card's live inputs),
 * the unit dropdown, and the function dropdown. "(Not set)" matches cards
 * whose corresponding trace field is empty. Pending-add cards are always
 * shown so a half-typed new requirement doesn't disappear under the user.
 * Group headings collapse when all their cards are hidden.
 */
export function applyFilter() {
  if (!searchInput) return;
  const q = searchInput.value.trim().toLowerCase();
  const tokens = q ? q.split(/\s+/) : [];
  const matchesText = (haystack) =>
    tokens.every((t) => haystack.includes(t));

  const unitFilter = filterUnit ? filterUnit.value : "";
  const fnFilter = filterFunction ? filterFunction.value : "";
  const matchesField = (val, filter) => {
    if (!filter) return true;
    if (filter === NOT_SET) return !val;
    return val === filter;
  };

  let currentHeader = null;
  let currentHeaderHasVisible = false;
  let totalReal = 0;
  let visibleReal = 0;

  for (const el of reqsBody.children) {
    if (el.tagName === "H2") {
      if (currentHeader) {
        currentHeader.classList.toggle(
          "h2--hidden",
          !currentHeaderHasVisible
        );
      }
      currentHeader = el;
      currentHeaderHasVisible = false;
    } else if (el.classList.contains("req")) {
      if (el.classList.contains("req--pending-added")) {
        el.classList.remove("req--hidden");
        continue;
      }
      totalReal++;
      // Pull the searchable fields off the live inputs — that way a
      // mid-edit value is searchable immediately without an extra
      // bookkeeping step in the field-change path.
      const reqId = el.dataset.reqId || "";
      const titleEl = el.querySelector('[data-field="title"]');
      const descEl = el.querySelector('[data-field="description"]');
      const unitEl = el.querySelector(
        '[data-scope="trace"][data-field="unit"]'
      );
      const fnEl = el.querySelector(
        '[data-scope="trace"][data-field="function"]'
      );
      const unitVal = unitEl ? unitEl.value : "";
      const fnVal = fnEl ? fnEl.value : "";
      const haystack = (
        reqId +
        " " +
        (titleEl ? titleEl.value : "") +
        " " +
        (descEl ? descEl.value : "") +
        " " +
        unitVal +
        " " +
        fnVal
      ).toLowerCase();
      const visible =
        (tokens.length === 0 || matchesText(haystack)) &&
        matchesField(unitVal, unitFilter) &&
        matchesField(fnVal, fnFilter);
      el.classList.toggle("req--hidden", !visible);
      if (visible) {
        currentHeaderHasVisible = true;
        visibleReal++;
      }
    }
  }
  if (currentHeader) {
    currentHeader.classList.toggle("h2--hidden", !currentHeaderHasVisible);
  }

  if (searchCount) {
    const filtersActive =
      tokens.length > 0 || !!unitFilter || !!fnFilter;
    searchCount.textContent = filtersActive
      ? `${visibleReal} of ${totalReal}`
      : "";
  }
}
