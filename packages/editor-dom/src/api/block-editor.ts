export { createBlockLocalProseMirrorState } from "../block-editor/state/create-block-local-state.ts";
export { materializeCanonicalBlockLocalProseMirrorDocument } from "../schema/block-local/document-parsing.ts";
export {
  createBlockLocalProseMirrorView,
  createBlockLocalProseMirrorViewProps,
} from "../block-editor/view/create-block-local-view.ts";
export type { CreateBlockLocalProseMirrorViewOptions } from "../block-editor/options/view-options.ts";
export { isComposing as isBlockEditorComposing } from "../plugins/input/composition.ts";
export { isEditorOwnedDeletionTransaction } from "../plugins/input/deletion-beforeinput.ts";
export { createBlockLocalDomPlugins } from "../plugins/aggregate/create-block-local-dom-plugins.ts";
export type {
  BlockDomKeyBehaviorEvent,
  BlockDomKeyBehaviorKey,
  BlockDomKeyBehaviorResult,
  BlockDomTextSelectionRange,
} from "../block-editor/options/key-behavior.ts";
export type { CreateBlockLocalProseMirrorStateOptions } from "../block-editor/state/create-block-local-state.ts";
export type { TextPlaceholder } from "../block-editor/options/plugin-options.ts";
export {
  deriveProseMirrorOperations,
  proposalChangesDocument,
  proposalChangesSelection,
} from "../block-editor/transactions/proposal.ts";
export {
  applyFinalizedContentOperations,
  projectFinalizedTextSelection,
} from "../block-editor/transactions/finalized-content.ts";
export type {
  ProseMirrorProposalAdapter,
  ProseMirrorProposalDisposition,
  ProseMirrorStateProposal,
} from "../block-editor/transactions/proposal.ts";
