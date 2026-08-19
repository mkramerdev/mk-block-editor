import { afterEach, describe, expect, it, vi } from "vitest";
import { asBlockId } from "@repo/editor-core/kernel";
import {
  Plugin,
  TextSelection,
  type EditorState,
  EditorView,
  type Transaction,
} from "../prosemirror/index.ts";
import { createBlockLocalProseMirrorState } from "./state/create-block-local-state.ts";
import { applyBlockTransaction } from "./transactions/dispatch.ts";
import type {
  ProseMirrorProposalAdapter,
  ProseMirrorStateProposal,
} from "./transactions/proposal.ts";

const blockId = asBlockId("01890f07-1c00-7000-8000-000000000301");
const base = {
  graphRevision: 7,
  blockId,
  blockType: "paragraph" as const,
  contentRevision: 11,
};
const testViews: EditorView[] = [];

afterEach(() => {
  for (const view of testViews.splice(0)) {
    const dom = view.dom;
    if (!view.isDestroyed) view.destroy();
    dom.remove();
  }
});

describe("applyBlockTransaction", () => {
  it("preserves the real view's proposed range for the selection owner", () => {
    const state = createState([]);
    const view = createTestView(state);
    let proposed: ProseMirrorStateProposal | null = null;

    applyBlockTransaction(
      view,
      state.tr.setSelection(TextSelection.create(state.doc, 1, 3)),
      {
        blockId,
        blockType: "paragraph",
        proposalAdapter: adapter((proposal) => {
          proposed = proposal;
          return { kind: "rejected", state: proposal.proposedState };
        }),
      },
    );

    const captured = requireProposal(proposed);
    expect(captured.proposedState.selection.empty).toBe(false);
    expect(view.state.selection.empty).toBe(false);
    expect(view.state.selection.anchor).toBe(1);
    expect(view.state.selection.head).toBe(3);
  });

  it("does not propose or install a transaction rejected by filterTransaction", () => {
    const filterTransaction = vi.fn(() => false);
    const state = createState([
      new Plugin({
        filterTransaction,
      }),
    ]);
    const view = createTestView(state);
    const evaluateProposal = vi.fn();

    const result = applyBlockTransaction(view, state.tr.insertText("x", 2), {
      blockId,
      blockType: "paragraph",
      proposalAdapter: adapter(evaluateProposal),
    });

    expect(result.status).toBe("filtered");
    expect(filterTransaction).toHaveBeenCalledTimes(1);
    expect(evaluateProposal).not.toHaveBeenCalled();
    expect(view.updateState).not.toHaveBeenCalled();
    expect(view.state).toBe(state);
  });

  it("retains an appended document-changing transaction in the proposal", () => {
    const appendTransaction = vi.fn(
      (
        transactions: readonly Transaction[],
        _oldState: EditorState,
        state: EditorState,
      ) => {
        if (transactions.some((transaction) => transaction.getMeta("append")))
          return null;
        return state.tr
          .insertText("!", state.doc.content.size - 1)
          .setMeta("append", true);
      },
    );
    const state = createState([new Plugin({ appendTransaction })]);
    const view = createTestView(state);
    let captured: ProseMirrorStateProposal | null = null;

    const result = applyBlockTransaction(view, state.tr.insertText("x", 2), {
      blockId,
      blockType: "paragraph",
      proposalAdapter: adapter((proposal) => {
        captured = proposal;
        return { kind: "accepted", state: proposal.proposedState };
      }),
    });

    expect(result.status).toBe("installed");
    const proposal = requireProposal(captured);
    expect(proposal.transactions).toHaveLength(2);
    expect(proposal.transactions[1]?.docChanged).toBe(true);
    expect(view.state).toBe(proposal.proposedState);
    expect(view.state.doc.textContent).toBe("axbc!");
  });

  it("retains multiple appended transactions in application order", () => {
    let firstAppended = false;
    let secondAppended = false;
    const first = new Plugin({
      appendTransaction(_transactions, _oldState, state) {
        if (firstAppended) return null;
        firstAppended = true;
        return state.tr
          .insertText("1", state.doc.content.size - 1)
          .setMeta("first", true);
      },
    });
    const second = new Plugin({
      appendTransaction(_transactions, _oldState, state) {
        if (!firstAppended || secondAppended) return null;
        secondAppended = true;
        return state.tr
          .insertText("2", state.doc.content.size - 1)
          .setMeta("second", true);
      },
    });
    const state = createState([first, second]);
    const view = createTestView(state);
    let captured: ProseMirrorStateProposal | null = null;

    applyBlockTransaction(view, state.tr.insertText("x", 2), {
      blockId,
      blockType: "paragraph",
      proposalAdapter: adapter((proposal) => {
        captured = proposal;
        return { kind: "accepted", state: proposal.proposedState };
      }),
    });

    const proposal = requireProposal(captured);
    expect(proposal.transactions).toHaveLength(3);
    expect(
      proposal.transactions.map((transaction) => transaction.doc.textContent),
    ).toEqual(["axbc", "axbc1", "axbc12"]);
  });

  it("executes filter and append behavior once and installs the exact proposal state", () => {
    const filterTransaction = vi.fn(() => true);
    const appendTransaction = vi.fn(() => null);
    const state = createState([
      new Plugin({ filterTransaction, appendTransaction }),
    ]);
    const view = createTestView(state);
    let proposedState: EditorState | null = null;

    applyBlockTransaction(view, state.tr.insertText("x", 2), {
      blockId,
      blockType: "paragraph",
      proposalAdapter: adapter((proposal) => {
        proposedState = proposal.proposedState;
        return { kind: "accepted", state: proposal.proposedState };
      }),
    });

    expect(filterTransaction).toHaveBeenCalledTimes(1);
    expect(appendTransaction).toHaveBeenCalledTimes(1);
    expect(view.state).toBe(proposedState);
  });

  it("keeps projection-time plugin transactions view-local", () => {
    const state = createState([]);
    const view = createTestView(state);
    const readContentBaseToken = vi.fn(() => base);
    const evaluateProposal = vi.fn();

    const result = applyBlockTransaction(view, state.tr.setMeta("blur", true), {
      blockId,
      blockType: "paragraph",
      proposalAdapter: {
        isProjectingFinalizedContent: () => true,
        readContentBaseToken,
        evaluateProposal,
      },
    });

    expect(result).toMatchObject({ status: "projected", proposal: null });
    expect(readContentBaseToken).not.toHaveBeenCalled();
    expect(evaluateProposal).not.toHaveBeenCalled();
    expect(view.updateState).toHaveBeenCalledOnce();
  });

  it("ignores transactions dispatched to destroyed editor views", () => {
    const view = createTestView(createState([]));
    const updateState = vi.spyOn(view, "updateState");
    view.destroy();

    const result = applyBlockTransaction(
      view,
      { docChanged: true } as Transaction,
      {
        blockId,
        blockType: "paragraph",
        proposalAdapter: adapter(vi.fn()),
      },
    );

    expect(updateState).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "destroyed",
      proposal: null,
      state: view.state,
    });
  });
});

function createState(plugins: readonly Plugin[]): EditorState {
  return createBlockLocalProseMirrorState({
    blockId,
    blockType: "paragraph",
    doc: "abc",
    plugins,
  });
}

function createTestView(state: EditorState): EditorView {
  const mount = document.createElement("div");
  document.body.append(mount);
  const view = new EditorView({ mount }, { state });
  vi.spyOn(view, "updateState");
  testViews.push(view);
  return view;
}

function adapter(
  evaluateProposal: ProseMirrorProposalAdapter["evaluateProposal"],
): ProseMirrorProposalAdapter {
  return {
    isProjectingFinalizedContent: () => false,
    readContentBaseToken: () => base,
    evaluateProposal,
  };
}

function requireProposal(
  proposal: ProseMirrorStateProposal | null,
): ProseMirrorStateProposal {
  expect(proposal).not.toBeNull();
  if (proposal === null) throw new Error("proposal was not captured");
  return proposal;
}
