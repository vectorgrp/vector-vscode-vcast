import type {
  RGWFileMtimes,
  RGWRequirement,
  RGWRequirementsFile,
  RGWTraceabilityEntry,
  RGWTraceabilityFile,
} from "../rgwIo";

// Wire protocol for the requirements webview ↔ extension.
// Discriminated unions on `type`. The webview script and extension handler
// both branch on these — keep them in sync.

// --------- Card payloads carried by saved/inferred -------------------------

export interface RequirementEntry {
  source: string;
  id: string;
  req: RGWRequirement;
  trace: RGWTraceabilityEntry;
}

export interface RequirementGroup {
  name: string;
  entries: RequirementEntry[];
}

// --------- Webview → Extension ---------------------------------------------

export interface SaveMessage {
  type: "save";
  updates: {
    requirements: RGWRequirementsFile;
    traceability: RGWTraceabilityFile;
  };
  expectedMtimes: Pick<RGWFileMtimes, "requirements" | "traceability">;
}

export interface InferTraceabilityMessage {
  type: "infer-traceability";
}

export interface OpenSourceMessage {
  type: "open-source";
  /** Unit name as it appears in `envData.unitData[i]` (matches source basename). */
  unit: string;
  /** Function name within the unit, or null to just open the file. */
  function: string | null;
}

export type FromWebview =
  | SaveMessage
  | InferTraceabilityMessage
  | OpenSourceMessage;

// --------- Extension → Webview ---------------------------------------------

interface BundleRefreshPayload {
  mtimes: RGWFileMtimes;
  requirements: RGWRequirementsFile;
  traceability: RGWTraceabilityFile;
  /**
   * Structured grouping for re-rendering the cards section. The webview
   * builds the DOM from this — we deliberately don't ship pre-built HTML
   * over the wire so the webview script has no `innerHTML` surface for
   * postMessage payloads.
   */
  groups: RequirementGroup[];
}

export interface SavedMessage extends BundleRefreshPayload {
  type: "saved";
}

export interface InferredMessage extends BundleRefreshPayload {
  type: "inferred";
}

export interface SaveFailedMessage {
  type: "save-failed";
  message: string;
}

export interface InferFailedMessage {
  type: "infer-failed";
  message: string;
}

export interface InferCancelledMessage {
  type: "infer-cancelled";
}

export type ToWebview =
  | SavedMessage
  | InferredMessage
  | SaveFailedMessage
  | InferFailedMessage
  | InferCancelledMessage;
