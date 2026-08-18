import type { BlockType } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorView, Transaction } from "../../prosemirror/index.ts";
import type { BlockProposalDispatchResult } from "../options/events.ts";
import type {
  ProseMirrorProposalAdapter,
  ProseMirrorStateProposal,
} from "./proposal.ts";

export interface CreateBlockDispatchOptions {
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly proposalAdapter: ProseMirrorProposalAdapter;
}

export function applyBlockTransaction(
  view: EditorView,
  rootTransaction: Transaction,
  options: CreateBlockDispatchOptions,
): BlockProposalDispatchResult {
  if (view.isDestroyed) {
    return { status: "destroyed", proposal: null, state: view.state };
  }

  const previousState = view.state;
  const applied = previousState.applyTransaction(rootTransaction);
  if (applied.transactions.length === 0) {
    return { status: "filtered", proposal: null, state: previousState };
  }
  if (options.proposalAdapter.isProjectingFinalizedContent()) {
    view.updateState(applied.state);
    return {
      status: "projected",
      proposal: null,
      state: applied.state,
    };
  }
  const base = options.proposalAdapter.readContentBaseToken();

  const proposal: ProseMirrorStateProposal = Object.freeze({
    previousState,
    proposedState: applied.state,
    transactions: Object.freeze([...applied.transactions]),
    base,
  });
  const disposition = options.proposalAdapter.evaluateProposal(proposal, view);
  if (view.isDestroyed) {
    return { status: "destroyed", proposal: null, state: view.state };
  }
  if (view.state !== disposition.state) {
    view.updateState(disposition.state);
  }
  disposition.afterStateInstalled?.();
  return {
    status: "installed",
    proposal,
    disposition,
    state: disposition.state,
  };
}

export function createBlockDispatch(
  options: CreateBlockDispatchOptions,
): (this: EditorView, transaction: Transaction) => void {
  return function dispatchBlockTransaction(
    this: EditorView,
    transaction: Transaction,
  ) {
    applyBlockTransaction(this, transaction, options);
  };
}
