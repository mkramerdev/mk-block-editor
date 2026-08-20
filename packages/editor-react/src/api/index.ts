export { createEditorExternalStore } from "../store/external-store.ts";
export { createInitialEditorSessionState } from "../store/session-state.ts";
export type {
  EditorExternalStore,
  EditorSessionState,
} from "../store/contracts.ts";

export {
  createPlainTextCanonicalFragment,
  materializeEditorSelectionFragment,
} from "../selection/materialization/materialize.ts";
export { getEditorSelectionCommandEligibility } from "../selection/materialization/command-eligibility.ts";
export { resolveStructuralEditRange } from "../selection/editing/resolve-structural-edit-range.ts";
export {
  createEditorSelectionTextAnchor,
  resolveEditorSelectionTextAnchorPoint,
} from "../selection/anchors/text-anchor.ts";
export { rebaseCommittedSelectionAnchors } from "../selection/anchors/rebase-committed-selection.ts";
export {
  normalizeNewSelection,
  normalizeSelectionRange,
  normalizeSelectionRangeResult,
} from "../selection/normalization/normalize-range.ts";
export { createSelectionController } from "../selection/controller/controller.ts";
export {
  createCommittedSelectionSnapshot,
  deriveCommittedSelectionProjection,
  registerInternalSelectionSubsystem,
  validateCommittedSelectionOwnership,
} from "../selection/model/committed-selection-snapshot.ts";
export type { SelectionController } from "../selection/controller/controller.ts";
export type {
  CanonicalLocalSelection,
  EditorCanonicalSelectionReader,
} from "../selection/model/canonical-selection.ts";
export type {
  CommittedSelectionDerivation,
  CommittedSelectionBlock,
  CommittedSelectionSnapshot,
  SelectionDocumentProjection,
  SelectionOwnershipValidationResult,
} from "../selection/model/committed-selection-snapshot.ts";
export { createEditorSelectionDragDiagnosticPayload } from "../selection/controller/drag-diagnostics.ts";
export { validateEditorSelectionInvalidation } from "../selection/controller/invalidation.ts";
export { blockInternalSelectionSubsystemId } from "../selection/model/types.ts";
export {
  editorStableSelectionsEqual,
  projectCanonicalSelectionToStable,
  projectCanonicalSelectionToTransaction,
  projectTransactionSelectionToStable,
} from "../selection/model/stable-selection.ts";
export type {
  BlockInternalSelectionSubsystem,
  EditorLogicalSelectionPoint,
  EditorSelection,
  EditorSelectionDragDiagnosticPayload,
  EditorSelectionFailure,
  EditorSelectionFailureReason,
  EditorSelectionInvalidation,
  EditorSelectionInvalidationReason,
  EditorSelectionRangeBlock,
  EditorSelectionSnapshot,
  EditorSelectionSnapshotEndpoint,
  EditorSelectionTextAnchor,
  EditorStableSelection,
  EditorSelectionTextAnchorResolutionResult,
  EditorSelectionTextAnchorResolver,
  SelectionBlockOwner,
  StableBlockInternalSelection,
  StableDocumentSelection,
  StableDocumentSelectionPoint,
  StableEditorSelection,
  EditorTransactionSelection,
  SelectionCause,
  SelectionPublication,
  SelectionSettlementContext,
} from "../selection/model/types.ts";
export type {
  EditorBlockSelectionTarget,
  EditorSelectionGraphReader,
} from "../selection/graph/reader.ts";
export type {
  EditorSelectionCommandEligibility,
  EditorSelectionCommandIneligibleReason,
} from "../selection/materialization/command-eligibility.ts";

export { createInitialEditorManifestState } from "./editor.ts";
export { EDITOR_REDO_COMMAND_ID, EDITOR_UNDO_COMMAND_ID } from "./editor.ts";
export type { EditorManifestState } from "./editor.ts";
