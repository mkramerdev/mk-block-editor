import { describe, expect, it, vi } from "vitest";
import type {
  ProseMirrorProposalAdapter,
  ProseMirrorStateProposal,
} from "./transactions/proposal.ts";
import { createBlockLocalProseMirrorView } from "./view/create-block-local-view.ts";
import { createBlockLocalProseMirrorState } from "./state/create-block-local-state.ts";
import { proseMirrorPositionToCanonicalOffset } from "../caret/coordinates/offset-codec.ts";
import { createBlockLocalProseMirrorSchema } from "../schema/block-local/schema.ts";
import { hardBreakNodeView } from "../nodeviews/hard-break-node-view.ts";
import { isEditorOwnedDeletionTransaction } from "../plugins/input/deletion-beforeinput.ts";
import { testBlockId, textEnd } from "../testing/block-editor-test-support.ts";

describe("block editor view lifecycle", () => {
  it("installs a canonical caret in the initial state before mounting", () => {
    const state = createBlockLocalProseMirrorState({
      blockId: testBlockId,
      blockType: "paragraph",
      doc: "abcdef",
      selection: { canonicalOffset: 4 },
    });

    expect(state.selection.empty).toBe(true);
    expect(
      proseMirrorPositionToCanonicalOffset(state.selection.head, state),
    ).toBe(4);
  });
  it("mounts a block-local EditorView and proposes complete transactions", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const proposals: ProseMirrorStateProposal[] = [];
    const view = createBlockLocalProseMirrorView({
      mount: host,
      blockId: testBlockId,
      blockType: "paragraph",
      doc: "abc",
      proposalAdapter: acceptingAdapter((proposal) => proposals.push(proposal)),
    });

    expect(view.dom.getAttribute("data-block-id")).toBe(testBlockId);
    expect(view.dom.getAttribute("role")).toBe("textbox");

    view.dispatch(view.state.tr.insertText("!", textEnd(view.state)));
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.transactions).toHaveLength(1);
    expect(proposals[0]?.transactions[0]?.docChanged).toBe(true);
    expect(view.state.doc.textContent).toBe("abc!");

    view.destroy();
    host.remove();
  });

  it("claims a browser-resolved backward deletion before native DOM mutation", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const proposals: ProseMirrorStateProposal[] = [];
    const emoji = "👨‍👩‍👧‍👦";
    const view = createBlockLocalProseMirrorView({
      mount: host,
      blockId: testBlockId,
      blockType: "paragraph",
      doc: `A${emoji}B`,
      proposalAdapter: acceptingAdapter((proposal) => proposals.push(proposal)),
    });
    view.focus();
    const text = host.querySelector("[data-block-node]")?.firstChild;
    expect(text).toBeInstanceOf(Text);
    const event = deletionBeforeInput(
      "deleteContentBackward",
      text!,
      1,
      text!,
      1 + emoji.length,
    );

    expect(host.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(host.textContent).toBe("AB");
    expect(view.state.doc.textContent).toBe("AB");
    expect(proposals).toHaveLength(1);
    expect(
      proposals[0]?.transactions.some(isEditorOwnedDeletionTransaction),
    ).toBe(true);

    view.destroy();
    host.remove();
  });

  it("retains native deletion fallback without one usable target range", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const proposals: ProseMirrorStateProposal[] = [];
    const view = createBlockLocalProseMirrorView({
      mount: host,
      blockId: testBlockId,
      blockType: "paragraph",
      doc: "abc",
      proposalAdapter: acceptingAdapter((proposal) => proposals.push(proposal)),
    });
    view.focus();
    const event = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "deleteContentBackward",
    });

    expect(host.dispatchEvent(event)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(view.state.doc.textContent).toBe("abc");
    expect(proposals).toHaveLength(0);

    view.destroy();
    host.remove();
  });

  it("does not force layout to scroll an already-established native typing selection", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const view = createBlockLocalProseMirrorView({
      mount: host,
      blockId: testBlockId,
      blockType: "paragraph",
      doc: "abc",
      proposalAdapter: acceptingAdapter(),
    });
    const rootBounds = vi.spyOn(view.dom, "getBoundingClientRect");
    const hadRangeRects = "getClientRects" in Range.prototype;
    if (!hadRangeRects) {
      Object.defineProperty(Range.prototype, "getClientRects", {
        configurable: true,
        value: () => [],
      });
    }
    const rangeRects = vi.spyOn(Range.prototype, "getClientRects");

    try {
      expect(
        view.someProp("handleScrollToSelection", (handler) => handler(view)),
      ).toBe(true);
      view.dispatch(
        view.state.tr.insertText("!", textEnd(view.state)).scrollIntoView(),
      );
      expect(view.state.doc.textContent).toBe("abc!");
      expect(rootBounds).not.toHaveBeenCalled();
      expect(rangeRects).not.toHaveBeenCalled();
    } finally {
      rangeRects.mockRestore();
      if (!hadRangeRects)
        Reflect.deleteProperty(Range.prototype, "getClientRects");
      view.destroy();
      host.remove();
    }
  });

  it("uses the caller-owned mount as the actual editable root", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const connectedContentEditableWrites: Element[] = [];
    const originalSetAttribute = Element.prototype.setAttribute;
    const setAttribute = vi
      .spyOn(Element.prototype, "setAttribute")
      .mockImplementation(function (this: Element, name, value) {
        if (name === "contenteditable" && this.isConnected) {
          connectedContentEditableWrites.push(this);
        }
        return originalSetAttribute.call(this, name, value);
      });
    const view = createBlockLocalProseMirrorView({
      mount: root,
      blockId: testBlockId,
      blockType: "paragraph",
      doc: "abc",
      attributes: { class: "editor-web-block-mount" },
      proposalAdapter: acceptingAdapter(),
    });

    try {
      expect(view.dom).toBe(root);
      expect(view.dom.classList.contains("ProseMirror")).toBe(true);
      expect(view.dom.classList.contains("editor-web-block-mount")).toBe(true);
      expect(connectedContentEditableWrites).toEqual([root]);
    } finally {
      setAttribute.mockRestore();
      view.destroy();
      root.remove();
    }
  });

  it("destroys one block binding before a fresh view mounts on another root", () => {
    const firstRoot = document.createElement("div");
    const secondRoot = document.createElement("div");
    document.body.append(firstRoot, secondRoot);
    const firstProposals: ProseMirrorStateProposal[] = [];
    const secondProposals: ProseMirrorStateProposal[] = [];
    let firstBeforeInputEvents = 0;
    let secondBeforeInputEvents = 0;
    const firstView = createBlockLocalProseMirrorView({
      mount: firstRoot,
      blockId: testBlockId,
      blockType: "paragraph",
      doc: "first",
      handleDOMEvents: {
        beforeinput: () => {
          firstBeforeInputEvents += 1;
          return false;
        },
      },
      proposalAdapter: acceptingAdapter((proposal) =>
        firstProposals.push(proposal),
      ),
    });

    try {
      expect(firstView.dom).toBe(firstRoot);
      expect(
        document.querySelectorAll('[contenteditable="true"]'),
      ).toHaveLength(1);
      firstView.dispatch(
        firstView.state.tr.insertText("!", textEnd(firstView.state)),
      );
      expect(firstProposals).toHaveLength(1);
      expect(firstView.state.doc.textContent).toBe("first!");

      firstRoot.dispatchEvent(new InputEvent("beforeinput", { bubbles: true }));
      expect(firstBeforeInputEvents).toBe(1);
      firstView.destroy();
      expect(firstView.isDestroyed).toBe(true);
      expect(firstRoot.textContent).toBe("");

      const secondView = createBlockLocalProseMirrorView({
        mount: secondRoot,
        blockId: "second-block" as typeof testBlockId,
        blockType: "paragraph",
        doc: "second",
        handleDOMEvents: {
          beforeinput: () => {
            secondBeforeInputEvents += 1;
            return false;
          },
        },
        proposalAdapter: acceptingAdapter((proposal) =>
          secondProposals.push(proposal),
        ),
      });

      expect(secondView).not.toBe(firstView);
      expect(secondView.dom).toBe(secondRoot);
      expect(secondView.isDestroyed).toBe(false);
      expect(
        document.querySelectorAll('[contenteditable="true"]'),
      ).toHaveLength(1);
      firstRoot.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          data: "stale",
          inputType: "insertText",
        }),
      );
      expect(firstBeforeInputEvents).toBe(1);
      expect(secondBeforeInputEvents).toBe(0);
      expect(firstProposals).toHaveLength(1);
      expect(secondRoot.textContent).toBe("second");
      secondView.dispatch(
        secondView.state.tr.insertText("!", textEnd(secondView.state)),
      );
      expect(secondProposals).toHaveLength(1);
      secondView.destroy();
      expect(secondView.isDestroyed).toBe(true);
    } finally {
      if (!firstView.isDestroyed) firstView.destroy();
      firstRoot.remove();
      secondRoot.remove();
    }
  });

  it("passes custom schema and document mapping through state creation", () => {
    const mount = document.createElement("div");
    const schema = createBlockLocalProseMirrorSchema({
      nodes: {
        callout_text: {
          content: "inline*",
          group: "block",
          parseDOM: [{ tag: "aside[data-block-node='callout']" }],
          toDOM: () => ["aside", { "data-block-node": "callout" }, 0],
        },
      },
    });
    const view = createBlockLocalProseMirrorView({
      mount,
      blockId: testBlockId,
      blockType: "callout",
      doc: "Custom",
      schema,
      documentMapping: { blockTextNodeNames: { callout: "callout_text" } },
      proposalAdapter: acceptingAdapter(),
    });

    try {
      expect(view.state.doc.firstChild?.type.name).toBe("callout_text");
      expect(
        mount.querySelector("aside[data-block-node='callout']")?.textContent,
      ).toBe("Custom");
    } finally {
      view.destroy();
    }
  });

  it("renders base hard-break node views as inline-only DOM nodes", () => {
    const br = hardBreakNodeView();
    expect(br.dom.nodeName).toBe("BR");
    expect(br.ignoreMutation?.({} as MutationRecord)).toBe(true);
  });

  it("normalizes caller-owned block attrs to the neutral rich-text node", () => {
    const mount = document.createElement("div");
    const view = createBlockLocalProseMirrorView({
      mount,
      blockId: testBlockId,
      blockType: "heading",
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Metadata heading" }],
          },
        ],
      },
      pluginOptions: { headingLevel: 3 },
      proposalAdapter: acceptingAdapter(),
    });

    try {
      expect(view.state.doc.firstChild?.attrs.level).toBeUndefined();
      expect(
        mount.querySelector("p[data-block-node='paragraph']")?.textContent,
      ).toBe("Metadata heading");
      expect(mount.querySelector("h3[data-block-node='heading']")).toBeNull();
      expect(mount.querySelector("h1[data-block-node='heading']")).toBeNull();
    } finally {
      view.destroy();
    }
  });

  it("renders mapped heading content with the caller-owned metadata level", () => {
    const mount = document.createElement("div");
    const view = createBlockLocalProseMirrorView({
      mount,
      blockId: testBlockId,
      blockType: "heading",
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Metadata heading" }],
          },
        ],
      },
      documentMapping: {
        blockTextNodeNames: { heading: "heading" },
        blockTextNodeAttrs: { heading: { level: 3 } },
      },
      pluginOptions: { headingLevel: 3 },
      proposalAdapter: acceptingAdapter(),
    });

    try {
      expect(view.state.doc.firstChild?.type.name).toBe("heading");
      expect(view.state.doc.firstChild?.attrs.level).toBe(3);
      expect(
        mount.querySelector("h3[data-block-node='heading']")?.textContent,
      ).toBe("Metadata heading");
      expect(mount.querySelector("p[data-block-node='paragraph']")).toBeNull();
    } finally {
      view.destroy();
    }
  });
});

function acceptingAdapter(
  onProposal?: (proposal: ProseMirrorStateProposal) => void,
): ProseMirrorProposalAdapter {
  return {
    isProjectingFinalizedContent: () => false,
    readContentBaseToken: () => ({
      graphRevision: 1,
      blockId: testBlockId,
      blockType: "paragraph",
      contentRevision: 1,
    }),
    evaluateProposal(proposal) {
      onProposal?.(proposal);
      return { kind: "accepted", state: proposal.proposedState };
    },
  };
}

function deletionBeforeInput(
  inputType: "deleteContentBackward" | "deleteContentForward",
  startContainer: Node,
  startOffset: number,
  endContainer: Node,
  endOffset: number,
): InputEvent {
  const event = new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    inputType,
  });
  Object.defineProperty(event, "getTargetRanges", {
    value: () => [
      { startContainer, startOffset, endContainer, endOffset } as StaticRange,
    ],
  });
  return event;
}
