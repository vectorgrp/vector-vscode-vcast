import type {
  RGWFileMtimes,
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
  expectedMtimes: Pick<RGWFileMtimes, "requirements" | "traceability">;
}

export interface InferTraceabilityMessage {
  type: "infer-traceability";
}

export type FromWebview = SaveMessage | InferTraceabilityMessage;

// --------- Extension → Webview ---------------------------------------------

interface BundleRefreshPayload {
  mtimes: RGWFileMtimes;
  requirements: RGWRequirementsFile;
  traceability: RGWTraceabilityFile;
  /** Re-rendered cards section (regrouped by current trace.function/unit). */
  body: string;
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
