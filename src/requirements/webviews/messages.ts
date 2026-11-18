import type { RequirementCheck } from "../codeCheckData";
import type {
  RGWFileHashes,
  RGWRequirementsFile,
  RGWTraceabilityFile,
} from "../rgwIo";

// Wire protocol for the requirements webview ↔ extension.
// Discriminated unions on `type`. The webview script and extension handler
// both branch on these — keep them in sync.

// --------- Webview → Extension ---------------------------------------------

export interface SaveMessage {
  type: "save";
  updates: {
    requirements: RGWRequirementsFile;
    traceability: RGWTraceabilityFile;
  };
  expectedHashes: Pick<RGWFileHashes, "requirements" | "traceability">;
}

export interface InferTraceabilityMessage {
  type: "infer-traceability";
  /** Only re-infer requirements missing a unit/function. Set only when supported. */
  onlyUntraced: boolean;
}

export interface OpenSourceMessage {
  type: "open-source";
  /** Unit name as it appears in `envData.unitData[i]` (matches source basename). */
  unit: string;
  /** Function name within the unit, or null to just open the file. */
  function: string | null;
}

/** Check the code of the environment against the saved requirements. */
export interface CheckCodeMessage {
  type: "check-code";
}

/** Show a checked function, with its findings, in its source file. */
export interface ShowInCodeMessage {
  type: "show-in-code";
  unit: string;
  function: string;
}

export type FromWebview =
  | SaveMessage
  | InferTraceabilityMessage
  | OpenSourceMessage
  | CheckCodeMessage
  | ShowInCodeMessage;

// --------- Extension → Webview ---------------------------------------------

interface BundleRefreshPayload {
  hashes: RGWFileHashes;
  requirements: RGWRequirementsFile;
  traceability: RGWTraceabilityFile;
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

/** How the requirements fared in the check of the code, by key. */
export interface CodeChecksMessage {
  type: "code-checks";
  checks: Record<string, RequirementCheck>;
}

export type ToWebview =
  | CodeChecksMessage
  | SavedMessage
  | InferredMessage
  | SaveFailedMessage
  | InferFailedMessage
  | InferCancelledMessage;
