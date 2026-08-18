export { EditorImplementation } from "../controller/editor-implementation.ts";

export type {
  EditorDocumentUpdate,
  CanonicalEditorCommit,
  CanonicalEditorBlockGraphChange,
  CanonicalEditorBlockPlacement,
  EditorManifestData,
  EditorBlockMetadataUpdateOptions,
  EditorBlockDeletion,
  EditorBlockDeletionResult,
  EditorBlockTypeReplacement,
  EditorStructuralBlockMove,
  EditorContentMutationOptions,
  EditorInlineAtomUpdate,
  EditorMarkUpdate,
  EditorTextDeletion,
  EditorTextInsertion,
  EditorFocusActionResult,
  EditorNativeFocusRequest,
  EditorNativeFocusRequestResult,
  EditorNativeFocusTargetKind,
  EditorBlockFocusOptions,
  EditorTextFocusOptions,
  EditorBlockGraphPatchApplication,
  EditorInfo,
  EditorHistoryCommands,
  EditorCommandAvailability,
  EditorCommandAvailabilityReader,
  EditorSnapshotReconciliation,
} from "./contracts.ts";
export type { EditorHistoryResult, EditorOperation } from "../history.ts";
export type { EditorSelection } from "../../../selection/model/types.ts";
export type {
  EditorBlockInternalSelectionEffect,
  EditorCanonicalSelectionEffect,
  EditorSelectionEffect,
  EditorTransactionSelectionEffect,
} from "../operations/mutation.ts";
export type {
  EditorLocalMutationProvenance,
  EditorLocalTypingProvenance,
} from "../operations/local-mutation-provenance.ts";
export { isContentCommitRejection } from "../operations/content-commit.ts";
export type {
  AppliedContentBlock,
  AppliedContentCommit,
  ContentCommitRejection,
  ContentCommitRejectionReason,
  EditorContentBaseToken,
  EditorContentCheckpoint,
  EditorOpaqueContentCheckpoint,
  EditorContentCommitChange,
  EditorContentCommitInput,
  EditorContentCommitPort,
  EditorContentOperationUpdate,
  EditorContentOperationProposal,
  EditorContentOperationProposalResult,
  EditorPreparedContentSelection,
  EditorPreparedContentSelectionPoint,
  EditorRemoteContentCommitInput,
  EditorRemoteContentUpdateProposal,
  EditorEncodedContent,
  ValidatedContentCommit,
} from "../operations/content-commit.ts";
export type {
  EditorTransactionFailurePhase,
  EditorTransactionResult,
} from "../operations/mutation.ts";
export { executeStructuralEditComposition } from "../operations/structural-composition.ts";
export { resolveCanonicalEditComposition } from "../operations/canonical-edit-composition.ts";
export { resolveTypingTriggerFragmentComposition } from "../operations/typing-trigger-fragment-composition.ts";
export type {
  ResolvedStructuralEditComposition,
  StructuralEditTransactionPort,
  StructuralTextJoin,
} from "../operations/structural-composition.ts";
export type {
  CanonicalEditCompositionGraph,
  CanonicalEditTarget,
} from "../operations/canonical-edit-composition.ts";
