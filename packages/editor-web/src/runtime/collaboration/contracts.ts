import type { BlockId } from "@repo/editor-core/kernel";
import type {
  EditorLogicalSelectionPoint,
  StableEditorSelection,
} from "@repo/editor-react/selection";

/** A collaboration participant scoped to one concrete client session. */
export interface CollaborationSubject {
  readonly actorId: string;
  readonly clientId: string;
  readonly sessionId: string;
}

declare const collaborationSubjectKeyBrand: unique symbol;

export type CollaborationSubjectKey = string & {
  readonly [collaborationSubjectKeyBrand]: "CollaborationSubjectKey";
};

export type SelectionRevision = number;

/** Stable remote selection decoded independently of local transaction data. */
export type RemoteStableSelection =
  | {
      readonly kind: "selection";
      readonly selection: StableEditorSelection;
    }
  | { readonly kind: "none" };

/**
 * Durable semantic input accepted by the collaboration service. Every field
 * is untrusted at this boundary and is decoded before any canonical state is
 * mutated.
 */
export interface UntrustedAcceptedEditorTransaction {
  readonly transactionId: unknown;
  readonly historyAction: unknown;
  readonly graph: unknown;
  readonly metadata: unknown;
  readonly content: unknown;
}

export type RemoteEditorAuthorSelection =
  | {
      readonly kind: "author-selection";
      readonly subject: unknown;
      readonly selectionRevision: unknown;
      readonly selectionAfter: unknown;
    }
  | { readonly kind: "no-author-selection" };

export interface RemoteEditorTransaction {
  readonly transaction: UntrustedAcceptedEditorTransaction;
  readonly authorSelection: RemoteEditorAuthorSelection;
}

export type RemoteTransactionSelectionResult =
  | { readonly status: "installed"; readonly subject: CollaborationSubjectKey }
  | { readonly status: "unresolved"; readonly subject: CollaborationSubjectKey }
  | { readonly status: "cleared"; readonly subject: CollaborationSubjectKey }
  | { readonly status: "invalid"; readonly subject: CollaborationSubjectKey }
  | { readonly status: "stale"; readonly subject: CollaborationSubjectKey }
  | { readonly status: "duplicate"; readonly subject: CollaborationSubjectKey }
  | { readonly status: "ignored-invalid-envelope" }
  | { readonly status: "ignored-no-author" };

export type RemoteTransactionResult =
  | {
      readonly status: "applied";
      readonly changedBlockIds: readonly BlockId[];
      readonly authorSelection: RemoteTransactionSelectionResult;
    }
  | {
      readonly status: "rejected";
      readonly reason:
        | "invalid-transaction"
        | "preparation-failed"
        | "commit-failed"
        | "editor-disposed";
      readonly message: string;
      readonly authorSelection: { readonly status: "not-processed" };
    };

export interface RemoteSelectionSnapshotEntry {
  readonly subject: CollaborationSubject;
  readonly selectionRevision: SelectionRevision;
  readonly selection: unknown;
  /** Canonical #RRGGBB color used by generic caret/range paint. */
  readonly color?: string;
}

export interface RemoteSelectionSnapshot {
  readonly entries: readonly RemoteSelectionSnapshotEntry[];
}

export interface ResolvedAdditionalDocumentSelection {
  readonly kind: "document";
  readonly direction: "forward" | "backward";
  readonly anchor: EditorLogicalSelectionPoint;
  readonly focus: EditorLogicalSelectionPoint;
  readonly blockIds: readonly BlockId[];
  readonly focusTarget: ResolvedSelectionFocusTarget;
}

export interface ResolvedAdditionalBlockInternalSelection {
  readonly kind: "block-internal";
  readonly blockId: BlockId;
  readonly subsystem: string;
  readonly payload: import("@repo/editor-core/kernel").JsonValue;
  readonly focusTarget: ResolvedSelectionFocusTarget | null;
  /** Optional semantic anchor for badges/decorations, independent of focus. */
  readonly decorationTarget: ResolvedSelectionFocusTarget | null;
}

/** Logical selection focus. Geometry is measured only by web presentation. */
export type ResolvedSelectionFocusTarget =
  | {
      readonly kind: "text";
      readonly blockId: BlockId;
      readonly point: EditorLogicalSelectionPoint;
    }
  | {
      readonly kind: "block";
      readonly blockId: BlockId;
      readonly target: string | null;
    };

export type ResolvedEditorSelection =
  | ResolvedAdditionalDocumentSelection
  | ResolvedAdditionalBlockInternalSelection;

export type AdditionalSelectionResolution =
  | "resolved"
  | "unresolved"
  | "cleared"
  | "invalid"
  | "inactive";

export interface AdditionalSelectionRecord {
  readonly subject: CollaborationSubjectKey;
  readonly watermark: SelectionRevision;
  readonly color: string | null;
  readonly active: boolean;
  readonly stableSelection: RemoteStableSelection | null;
  readonly resolvedSelection: ResolvedEditorSelection | null;
  readonly resolution: AdditionalSelectionResolution;
}

export interface EditorAdditionalSelectionReader {
  getSnapshot(): readonly AdditionalSelectionRecord[];
  subscribe(listener: () => void): () => void;
  getBlockSnapshot(blockId: BlockId): readonly AdditionalSelectionRecord[];
  subscribeBlock(blockId: BlockId, listener: () => void): () => void;
  getBlockInternalSnapshot(
    blockId: BlockId,
  ): readonly AdditionalSelectionRecord[];
  subscribeBlockInternal(blockId: BlockId, listener: () => void): () => void;
}
