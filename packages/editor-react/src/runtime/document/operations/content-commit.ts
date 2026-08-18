import type {
  AppliedContentCommit,
  ContentCommitRejectionReason,
  EditorContentBaseToken,
  EditorLogicalContentOperation,
} from "@repo/editor-core/operations";
import type { BlockType } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type {
  EditorSelectionDirection,
  EditorSelectionTextAffinity,
} from "../../../selection/model/types.ts";
import type { EditorLocalMutationProvenance } from "./local-mutation-provenance.ts";

export type {
  EditorContentCheckpoint,
  EditorContentOperationUpdate,
  EditorOpaqueContentCheckpoint,
  EditorEncodedContent,
} from "@repo/editor-core/content/rich-text";
export { isContentCommitRejection } from "@repo/editor-core/operations";
export type {
  AppliedContentBlock,
  AppliedContentCommit,
  ContentCommitRejection,
  ContentCommitRejectionReason,
  EditorContentBaseToken,
  EditorContentCommitChange,
  EditorContentCommitInput,
  EditorContentCommitPort,
  EditorPreparedContentTextPoint,
  EditorPreparedContentTextPointValidation,
  EditorRemoteContentUpdateProposal,
  EditorRemoteContentCommitInput,
  ValidatedContentBlock,
  ValidatedContentCommit,
} from "@repo/editor-core/operations";

export interface EditorPreparedContentSelectionPoint {
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly textOffset: number;
  readonly affinity: EditorSelectionTextAffinity | null;
}

export interface EditorPreparedContentSelection {
  readonly direction: EditorSelectionDirection;
  readonly anchor: EditorPreparedContentSelectionPoint;
  readonly focus: EditorPreparedContentSelectionPoint;
}

export interface EditorContentOperationProposal {
  readonly base: EditorContentBaseToken;
  readonly operations: readonly EditorLogicalContentOperation[];
  readonly selectionAfter: EditorPreparedContentSelection | null;
}

/** Internal provenance for callers entering the local proposal firewall. */
export type ContentOperationProposalOrigin =
  | "prosemirror-proposal"
  | "typing-trigger-replacement";

/** Internal policy for presenting an accepted canonical content selection. */
export type ContentSelectionPresentation =
  | "canonical-only"
  | "native-already-established"
  | "restore-native";

export interface ContentOperationProposalAcceptanceContext {
  readonly origin: ContentOperationProposalOrigin;
  readonly selectionPresentation: ContentSelectionPresentation;
  readonly provenance: EditorLocalMutationProvenance | null;
  readonly releaseAfterProposedStateInstalled?: boolean;
  readonly contentCommitOrigin?: unknown;
}

export type EditorContentOperationProposalResult =
  | {
      readonly ok: true;
      readonly commit: AppliedContentCommit;
      readonly release: (() => void) | null;
    }
  | {
      readonly ok: false;
      readonly reason:
        | ContentCommitRejectionReason
        | "application-failed"
        | "no-change";
      readonly message: string;
    };
