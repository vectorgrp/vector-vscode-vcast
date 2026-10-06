// Save-payload assembly + handler for refresh messages from the extension.

import {
  state,
  dirty,
  removed,
  added,
  vscode,
  saveBtn,
  inferBtn,
  inferCaret,
  addBtn,
  refreshButtonStates,
} from "./state.js";
import { rebuildBody } from "./cards.js";

export function buildSaveUpdates() {
  const updates = {
    requirements: JSON.parse(JSON.stringify(state.requirements)),
    traceability: JSON.parse(JSON.stringify(state.traceability)),
  };

  // 1. Drop soft-removed entries from every bucket and the trace map.
  for (const reqId of removed) {
    for (const bucket of Object.keys(updates.requirements)) {
      if (updates.requirements[bucket][reqId]) {
        delete updates.requirements[bucket][reqId];
      }
    }
    delete updates.traceability[reqId];
  }

  // 2. Apply in-place dirty patches (skipping any that are also removed).
  for (const [reqId, patch] of dirty.entries()) {
    if (removed.has(reqId)) continue;
    if (state.policy.bodiesEditable && Object.keys(patch.req).length > 0) {
      for (const bucket of Object.keys(updates.requirements)) {
        if (updates.requirements[bucket][reqId]) {
          Object.assign(updates.requirements[bucket][reqId], patch.req);
          break;
        }
      }
    }
    if (Object.keys(patch.trace).length > 0) {
      const existing = updates.traceability[reqId] || {
        unit: null,
        function: null,
        lines: null,
      };
      updates.traceability[reqId] = { ...existing, ...patch.trace };
    }
  }

  // 3. Append pending-added entries to the first bucket. The save flow on
  //    the extension side normalizes everything into a single CSV-keyed
  //    bucket anyway, so the choice here doesn't matter.
  let bucketKey = Object.keys(updates.requirements)[0];
  if (!bucketKey) {
    bucketKey = "[CSV] [" + state.gatewayPath + "]";
    updates.requirements[bucketKey] = {};
  }
  for (const pending of added) {
    const key = pending.key.trim();
    updates.requirements[bucketKey][key] = {
      id: key,
      title: pending.title,
      description: pending.description,
    };
    if (pending.unit != null || pending.function != null) {
      updates.traceability[key] = {
        unit: pending.unit ?? null,
        function: pending.function ?? null,
        lines: null,
      };
    }
  }

  return updates;
}

export function postSave() {
  const updates = buildSaveUpdates();
  saveBtn.disabled = true;
  inferBtn.disabled = true;
  if (addBtn) addBtn.disabled = true;
  vscode.postMessage({
    type: "save",
    updates,
    expectedMtimes: state.mtimes,
  });
}

export function postInfer(onlyUntraced) {
  inferBtn.disabled = true;
  if (inferCaret) inferCaret.disabled = true;
  saveBtn.disabled = true;
  if (addBtn) addBtn.disabled = true;
  vscode.postMessage({ type: "infer-traceability", onlyUntraced: !!onlyUntraced });
}

export function applyRefreshedBundle(msg) {
  dirty.clear();
  removed.clear();
  added.length = 0;
  state.mtimes = msg.mtimes;
  state.requirements = msg.requirements;
  state.traceability = msg.traceability;
  rebuildBody();
  refreshButtonStates();
}
