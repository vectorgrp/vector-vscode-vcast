// How each requirement fared in the last check of the code against the
// requirements: a chip in its card's header, which shows the function the
// requirement is traced to in the code, with the findings.

import { state, reqsBody } from "./state.js";

const STATUS_TEXT = {
  implemented: "✔ Implemented",
  violated: "✘ Violated",
  missing: "✘ Not implemented",
};

/** The chip of a requirement; hidden when the requirement was not checked. */
export function buildCheckChip(reqId) {
  const chip = document.createElement("button");
  chip.className = "req-check";
  const check = state.codeChecks?.[reqId];
  if (!check) {
    chip.hidden = true;
    return chip;
  }
  chip.classList.add(
    check.stale ? "req-check--stale" : "req-check--" + check.status
  );
  chip.textContent =
    STATUS_TEXT[check.status] + (check.stale ? " (out of date)" : "");
  chip.title = [
    ...check.details,
    "AI-generated check of " + check.function + ". Click to show it in the code.",
  ].join("\n\n");
  chip.dataset.unit = check.unit;
  chip.dataset.function = check.function;
  return chip;
}

/** Shows the checks on the cards, after the check of the code changed. */
export function showCodeChecks(checks) {
  state.codeChecks = checks;
  for (const card of reqsBody.querySelectorAll(".req[data-req-id]")) {
    card
      .querySelector(".req-check")
      .replaceWith(buildCheckChip(card.dataset.reqId));
  }
}
