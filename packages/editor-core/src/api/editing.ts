export { incrementVersion } from "../editing/block-editing/block-version.ts";
export type { BlockGraphSelectionSuggestion } from "../editing/selection/planning-suggestions.ts";
export {
  getAncestorIds,
  resolveEditableFocusTarget,
} from "../editing/block-tree.ts";
export { isEditableFocusTarget } from "../editing/focus/focus-targets.ts";
export { planBlockTreeCreation } from "../editing/block-editing/creation-planner.ts";
export { materializeBlockCreationMetadata } from "../editing/block-editing/creation-planner.ts";
export { createCollisionSafeBlockIdAllocator } from "../editing/block-editing/block-id-allocator.ts";
export type {
  CollisionSafeBlockIdAllocator,
  CreateCollisionSafeBlockIdAllocatorOptions,
} from "../editing/block-editing/block-id-allocator.ts";
export { blockCreationSelectionTargetKind } from "../editing/block-editing/creation-selection.ts";
export type { BlockCreationSelectionTargetKind } from "../editing/block-editing/creation-selection.ts";
export {
  planGenericEnter,
  planTextSplitAtPlacement,
} from "../editing/enter/plan-enter.ts";
export { planBlockBoundaryBackspace } from "../editing/backspace/plan-backspace.ts";
export { planBlockBoundaryDelete } from "../editing/delete/plan-delete.ts";
export { planStructuralRangeDeletion } from "../editing/range-deletion/plan-range-deletion.ts";
export {
  assertValidCanonicalBlockFragment,
  createCanonicalBlockFragment,
  createCanonicalBlockRecord,
  duplicateCanonicalBlockSubtrees,
  materializeCanonicalBlockCreation,
  reidentifyCanonicalBlockFragment,
  validateCanonicalBlockFragment,
} from "../editing/canonical-fragment.ts";
export type {
  CanonicalBlockFragment,
  CanonicalBlockRecord,
  CanonicalFragmentBoundary,
  CanonicalFragmentValidationOptions,
  CreateCanonicalBlockFragmentOptions,
  CreateCanonicalBlockRecordOptions,
  DuplicateCanonicalBlockSubtreesOptions,
  MaterializeCanonicalBlockCreationOptions,
  MaterializedCanonicalBlockCreation,
  ReidentifyCanonicalBlockFragmentOptions,
} from "../editing/canonical-fragment.ts";
export {
  findPreviousCanonicalSelectionTarget,
  findPreviousMergeTarget,
} from "../editing/backspace/previous-navigation.ts";
export { findCanonicalSelectionTarget } from "../editing/boundary/canonical-navigation.ts";
export type {
  BlockBoundaryBackspaceContentSnapshot,
  BlockBoundaryBackspaceSelection,
  PlanBlockBoundaryBackspaceInput,
  PlanBlockBoundaryBackspaceResult,
} from "../editing/backspace/plan-backspace.ts";
export type {
  PlanBlockBoundaryDeleteInput,
  PlanBlockBoundaryDeleteResult,
} from "../editing/delete/plan-delete.ts";
export type {
  PlanStructuralRangeDeletionInput,
  PlanStructuralRangeDeletionResult,
  StructuralRangeDeletionIntent,
} from "../editing/range-deletion/plan-range-deletion.ts";
export type {
  CanonicalSelectionNavigationResult,
  CanonicalNavigationInput,
  PreviousMergeTargetResult,
} from "../editing/backspace/previous-navigation.ts";
export type {
  GenericEnterContentSnapshot,
  GenericEnterSelection,
  PlanGenericEnterInput,
  PlanGenericEnterResult,
  PlanTextSplitAtPlacementInput,
  PlanTextSplitAtPlacementResult,
} from "../editing/enter/plan-enter.ts";
export type {
  BlockTreeCreationPlan,
  PlannedBlockTreeNode,
  PlanBlockTreeCreationInput,
} from "../editing/block-editing/creation-planner.ts";
export {
  applyStructuralTransaction,
  createVersionedBlockRecordOverlay,
} from "../editing/transactions/apply.ts";
export { validateStructuralDocument } from "../editing/transactions/validate-document.ts";
export {
  childIdsAt,
  placementAtIndex,
  resolveBlockPlacement,
  validateBlockPlacement,
} from "../editing/transactions/boundary.ts";
export {
  findAdjacentValidInsertionPlacement,
  structuralPlacementAcceptsBlockType,
} from "../editing/transactions/navigation.ts";
export { splitText } from "../editing/transactions/primitives/split-text.ts";
export { deleteRange } from "../editing/transactions/primitives/delete-range.ts";
export { joinTextBlocks } from "../editing/transactions/primitives/join-text-blocks.ts";
export { appendTextBlockContent } from "../editing/transactions/primitives/append-text-block-content.ts";
export { insertBlocks } from "../editing/transactions/primitives/insert-blocks.ts";
export { removeBlocks } from "../editing/transactions/primitives/remove-blocks.ts";
export { moveBlocks } from "../editing/transactions/primitives/move-blocks.ts";
export { replaceBlocks } from "../editing/transactions/primitives/replace-blocks.ts";
export { restoreBlocks } from "../editing/transactions/primitives/restore-blocks.ts";
export { replaceContent } from "../editing/transactions/primitives/replace-content.ts";
export { replaceBlockMetadata } from "../editing/transactions/primitives/replace-block-metadata.ts";
export { setSelection } from "../editing/transactions/primitives/set-selection.ts";
export type {
  AdjacentInsertionNavigationInput,
  AdjacentInsertionNavigationResult,
} from "../editing/transactions/navigation.ts";
export type {
  AppliedStructuralTransaction,
  ApplyStructuralTransactionOptions,
  ReplaceBlockMetadataOperation,
  BlockPlacement,
  ResolvedBlockPlacement,
  StructuralTransactionContext,
  StructuralTransactionOperation,
  StructuralTransactionPlan,
  StructuralTransactionPreconditions,
  StructuralTransactionResult,
  StructuralEditRange,
  StructuralEditRangeBlock,
  StructuralEditRangeBoundary,
  TransactionBlockReplacement,
  TransactionContentInput,
  TransactionSelectionTarget,
  TransactionReadableContent,
  TransactionRestoredBlockRecord,
} from "../editing/transactions/types.ts";
export type {
  StructuralDocumentValidator,
  StructuralDocumentValidatorInput,
  StructuralDocumentIssue,
  StructuralDocumentIssueKind,
  StructuralDocumentSelection,
  StructuralDocumentSelectionPoint,
  StructuralDocumentValidationResult,
  ValidateStructuralDocumentInput,
} from "../editing/transactions/validate-document.ts";
