export type { EditorBlockCommandRequest } from "../runtime/document/commands/command-request.ts";

export {
  createEditorInlineCommandDescriptors,
  getEditorInlineCommandDescriptor,
  unavailableInlineMarkCommandState,
  unavailableInlineMarkCommandStateMap,
} from "../runtime/inline-content/inline-commands.ts";
export type {
  EditorInlineCommandAvailability,
  EditorInlineCommandDescriptor,
  EditorInlineCommandId,
  EditorInlineCommandStateMap,
  EditorInlineMarkCommandAction,
  EditorInlineMarkCommandOptions,
  EditorInlineMarkCommandState,
  EditorInlineMarkCommandStateMap,
} from "../runtime/inline-content/inline-commands.ts";

export { EditorImplementation } from "../runtime/document/api/editor.ts";
export {
  EDITOR_REDO_COMMAND_ID,
  EDITOR_UNDO_COMMAND_ID,
} from "../runtime/document/api/command-identities.ts";
export type {
  EditorDocumentUpdate,
  CanonicalEditorCommit,
  CanonicalEditorBlockGraphChange,
  CanonicalEditorBlockPlacement,
  EditorManifestData,
  EditorBlockGraphPatchApplication,
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
  EditorInfo,
  EditorHistoryCommands,
  EditorCommandAvailability,
  EditorCommandAvailabilityReader,
  EditorSnapshotReconciliation,
  EditorTransactionFailurePhase,
  EditorTransactionResult,
  EditorHistoryResult,
  EditorOperation,
  EditorSelection,
  EditorBlockInternalSelectionEffect,
  EditorCanonicalSelectionEffect,
  EditorSelectionEffect,
  EditorTransactionSelectionEffect,
  EditorLocalMutationProvenance,
  EditorLocalTypingProvenance,
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
  EditorRemoteContentUpdateProposal,
  EditorRemoteContentCommitInput,
  EditorEncodedContent,
  ValidatedContentCommit,
} from "../runtime/document/api/editor.ts";
export { isContentCommitRejection } from "../runtime/document/api/editor.ts";
export type {
  EditorContentOperationApplyResult,
  EditorContentOperationFailure,
  EditorOperationFailureReason,
  EditorOperationRequest,
  EditorOperationResult,
  EditorOperationSuggestion,
  EditorSelectionSuggestion,
} from "../runtime/document/operations/mutation.ts";

export {
  createEditorCommandState,
  createInitialEditorCommandState,
  createInitialEditorManifestState,
  splitEditorCommandState,
} from "../runtime/document/state/command-state.ts";
export type {
  EditorCommandState,
  EditorManifestState,
} from "../runtime/document/state/command-state.ts";
export { executeStructuralEditComposition } from "../runtime/document/operations/structural-composition.ts";
export { resolveCanonicalEditComposition } from "../runtime/document/operations/canonical-edit-composition.ts";
export { resolveTypingTriggerFragmentComposition } from "../runtime/document/operations/typing-trigger-fragment-composition.ts";
export type {
  ResolvedStructuralEditComposition,
  StructuralEditTransactionPort,
  StructuralTextJoin,
} from "../runtime/document/operations/structural-composition.ts";
export type {
  CanonicalEditCompositionGraph,
  CanonicalEditTarget,
} from "../runtime/document/operations/canonical-edit-composition.ts";
