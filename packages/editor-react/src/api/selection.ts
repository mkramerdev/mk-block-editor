export {
  createPlainTextCanonicalFragment,
  materializeEditorSelectionFragmentCandidate,
  resolveEditorSelectionSnapshotTextAnchors,
  resolveCommittedSelectionSnapshotTextAnchors,
} from "../selection/materialization/materialize.ts";
export { getEditorSelectionCommandEligibility } from "../selection/materialization/command-eligibility.ts";
export { readCurrentSelectionInlineMarkFormatStates } from "../selection/formatting/inline-mark-state.ts";
export { resolveStructuralEditRange } from "../selection/editing/resolve-structural-edit-range.ts";
export type { ResolveStructuralEditRangeOptions } from "../selection/editing/resolve-structural-edit-range.ts";
export {
  anchorResolutionFailure,
  createEditorSelectionTextAnchor,
  isEditorSelectionTextAnchor,
  resolveEditorSelectionTextAnchorPoint,
  validateEditorSelectionTextAnchor,
} from "../selection/anchors/text-anchor.ts";
export { rebaseCommittedSelectionAnchors } from "../selection/anchors/rebase-committed-selection.ts";
export {
  createEditorLogicalSelectionPoint,
  normalizeSelectionOffset,
  normalizeSelectionPointForGraph,
} from "../selection/normalization/normalize-point.ts";
export {
  normalizeNewSelection,
  normalizeSelectionRange,
  normalizeSelectionRangeResult,
} from "../selection/normalization/normalize-range.ts";
export {
  canStartSelectionFromBlock,
  canTargetEditorBlockSelection,
  readEditorBlockSelectionTarget,
} from "../selection/graph/reader.ts";
export {
  collectEditorSelectionTraversalIds,
  compareEditorSelectionOrder,
  findAdjacentEditorSelectionTarget,
  readDirectEditorSelectionTargets,
} from "../selection/graph/traversal.ts";
export { createSelectionController } from "../selection/controller/controller.ts";
export {
  createCommittedSelectionSnapshot,
  deriveCommittedSelectionProjection,
  registerInternalSelectionSubsystem,
  validateCommittedSelectionOwnership,
} from "../selection/model/committed-selection-snapshot.ts";
export { createEditorSelectionDragDiagnosticPayload } from "../selection/controller/drag-diagnostics.ts";
export { createIdleSelectionSnapshot } from "../selection/model/snapshot.ts";
export { validateEditorSelectionInvalidation } from "../selection/controller/invalidation.ts";
export { blockInternalSelectionSubsystemId } from "../selection/model/types.ts";
export {
  editorStableSelectionsEqual,
  projectCanonicalSelectionToStable,
  projectCanonicalSelectionToTransaction,
  projectTransactionSelectionToStable,
} from "../selection/model/stable-selection.ts";
export { keyboardSelectionDirectionFromKey } from "../selection/keyboard/keyboard.ts";
export { moveEditorKeyboardSelectionEndpoint } from "../selection/keyboard/endpoint-movement.ts";
export type { CreateEditorSelectionTextAnchorResult } from "../selection/anchors/text-anchor.ts";
export type {
  RebasedCommittedSelectionSnapshot,
  SelectionAnchorRebaseContext,
  SelectionAnchorRebaseFailureReason,
  SelectionAnchorRebaseResult,
} from "../selection/anchors/rebase-committed-selection.ts";
export type {
  CreateEditorKeyboardSelectionPointOptions,
  MoveEditorKeyboardSelectionEndpointFailure,
  MoveEditorKeyboardSelectionEndpointOptions,
  MoveEditorKeyboardSelectionEndpointResult,
} from "../selection/keyboard/endpoint-movement.ts";
export type {
  EditorKeyboardSelectionDirection,
  EditorKeyboardSelectionKey,
} from "../selection/keyboard/keyboard.ts";
export type {
  MapEditorKeyboardSelectionVisualLineOptions,
  MapEditorKeyboardSelectionVisualLineResult,
  MoveEditorKeyboardSelectionVisualLineOptions,
  MoveEditorKeyboardSelectionVisualLineResult,
} from "../selection/keyboard/visual-line-navigation.ts";
export type { CreateEditorLogicalSelectionPointOptions } from "../selection/normalization/normalize-point.ts";
export type {
  EditorNormalizedSelectionRange,
  NormalizeNewSelectionInput,
  NormalizeEditorSelectionRangeResult,
} from "../selection/normalization/normalize-range.ts";
export type {
  EditorBlockSelectionTarget,
  EditorSelectionGraphReader,
} from "../selection/graph/reader.ts";
export type {
  BlockInternalSelectionSubsystem,
  CanonicalSelectionSettlementResult,
  EditorLogicalSelectionPoint,
  EditorSelectionDirection,
  EditorSelection,
  EditorSelectionDragDiagnosticPayload,
  EditorSelectionEncodedTextAnchor,
  EditorSelectionEndpointTarget,
  EditorSelectionEndpointPayload,
  EditorSelectionFailure,
  EditorSelectionFailureReason,
  EditorSelectionInvalidation,
  EditorSelectionInvalidationReason,
  EditorSelectionPhase,
  EditorSelectionRangeCoverage,
  EditorSelectionRangeBlock,
  EditorSelectionSnapshot,
  EditorSelectionSnapshotEndpoint,
  EditorSelectionTextAffinity,
  EditorSelectionTextAnchor,
  EditorSelectionTextAnchorPayload,
  EditorSelectionTextAnchorResolutionResult,
  EditorSelectionTextAnchorResolver,
  EditorStableSelection,
  RegisteredInternalSelectionSubsystem,
  RegisteredInternalSelectionSubsystemId,
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
  SelectionController,
  TextPointerGesturePresentationClaim,
} from "../selection/controller/controller.ts";
export type {
  CanonicalLocalSelection,
  EditorCanonicalSelectionReader,
} from "../selection/model/canonical-selection.ts";
export {
  noLocalSelectionPaint,
  type EditorLocalSelectionPaintReader,
  type LocalSelectionPaintModel,
} from "../selection/model/local-selection-paint.ts";
export type {
  EditorSelectionPresentationReader,
  NativeSelectionPaintMode,
  SelectionCompositionSessionSnapshot,
  SelectionPresentationSnapshot,
  SelectionSettlementMarker,
} from "../selection/model/presentation.ts";
export type {
  CommittedInternalSelection,
  CommittedSelectionDeferredDescriptor,
  CommittedSelectionDerivation,
  CommittedSelectionEndpoints,
  CommittedSelectionFocusDescriptor,
  CommittedSelectionOwner,
  CommittedSelectionBlock,
  CommittedSelectionSnapshot,
  CommittedSelectionSnapshotConstructionFailureReason,
  CommittedSelectionSnapshotConstructionResult,
  CommittedSelectionSnapshotInput,
  SelectionDocumentProjection,
  SelectionOwnershipValidationFailureReason,
  SelectionOwnershipValidationResult,
} from "../selection/model/committed-selection-snapshot.ts";
export type {
  EditorSelectionCommandEligibility,
  EditorSelectionCommandIneligibleReason,
} from "../selection/materialization/command-eligibility.ts";
export type {
  MaterializeEditorSelectionFragmentCandidateOptions,
  MaterializeEditorSelectionFragmentCandidateResult,
  ResolveCommittedSelectionSnapshotTextAnchorsResult,
  ResolveEditorSelectionSnapshotTextAnchorsResult,
} from "../selection/materialization/materialize.ts";
export type {
  EditorSelectionInlineMarkFormatAction,
  EditorSelectionInlineMarkFormatIneligibleReason,
  EditorSelectionInlineMarkFormatName,
  EditorSelectionInlineMarkFormatPlan,
  EditorSelectionInlineMarkFormatRange,
  EditorSelectionInlineMarkFormatState,
  EditorReadCurrentSelectionInlineMarkFormatStatesOptions,
  FormatSelectionInlineMarkOptions,
  FormatSelectionInlineMarkResult,
  ReadCurrentSelectionInlineMarkFormatStatesOptions,
  ReadSelectionInlineMarkFormatStatesResult,
  SelectionInlineMarkFormatStates,
} from "../selection/formatting/inline-mark-state.ts";
