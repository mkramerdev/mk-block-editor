import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createBlockLocalProseMirrorSchema } from "@repo/editor-dom/schema";
import {
  createBlockLocalProseMirrorView,
  type ProseMirrorProposalAdapter,
  type ProseMirrorStateProposal,
} from "@repo/editor-dom/block-editor";
import { asBlockId } from "@repo/editor-core/kernel";
import type {
  EditorView,
  NodeViewConstructor,
  PMNode,
} from "@repo/editor-dom/prosemirror";
import {
  InlineAtomPortalHost,
  InlineAtomPortalRegistry,
} from "./inline-atom-portal-registry.tsx";
import {
  createInlineAtomNodeView,
  createInlineAtomNodeViews,
  type InlineAtomNodeView,
} from "./inline-atom-node-view.ts";

const renderMention = vi.fn((metadata: Readonly<Record<string, unknown>>) => (
  <span data-mention-id={String(metadata.id)}>
    mention:{String(metadata.id)}
  </span>
));
const mentionDefinition = {
  type: "mention",
  metadata: { id: { type: "string", required: true } },
  render: renderMention,
} as const;
const emojiDefinition = {
  type: "emoji",
  metadata: { value: { type: "string", required: true } },
  render: () => <span>emoji</span>,
} as const;
const inlineAtomBlockId = asBlockId("inline-atom-realm");

describe("document-owned inline atom portals", () => {
  let portals: InlineAtomPortalRegistry;

  beforeEach(() => {
    portals = new InlineAtomPortalRegistry();
    renderMention.mockClear();
  });

  it("does not create or synchronously unmount an independent React root", () => {
    const source = readFileSync(
      join(process.cwd(), "src/runtime/content/inline-atom-node-view.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/react-dom\/client|createRoot|root\.unmount/u);
  });

  it("creates and updates one portal NodeView in the mounted document realm", () => {
    const owner = render(<InlineAtomPortalHost registry={portals} />);
    const realmA = document;
    const realmB = document.implementation.createHTMLDocument("realm-b");
    const mount = realmB.createElement("div");
    realmB.body.append(mount);
    const schema = createBlockLocalProseMirrorSchema({
      inlineAtoms: [mentionDefinition, emojiDefinition],
    });
    const views = createInlineAtomNodeViews(
      [mentionDefinition, emojiDefinition],
      portals,
    );
    let editorView!: EditorView;
    act(() => {
      editorView = createBlockLocalProseMirrorView({
        mount,
        blockId: inlineAtomBlockId,
        blockType: "textBlock",
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "mention", metadata: { id: "user-123" } }],
            },
          ],
        },
        schema,
        nodeViews: { ...views },
        proposalAdapter: acceptingAdapter(),
      });
    });

    const atom = mount.querySelector("[data-inline-atom-type='mention']");
    expect(Object.keys(views).sort()).toStrictEqual(["emoji", "mention"]);
    expect(atom?.ownerDocument).toBe(realmB);
    expect(atom?.ownerDocument).not.toBe(realmA);
    expect(atom?.nodeName).toBe("SPAN");
    expect((atom as HTMLElement).contentEditable).toBe("false");
    expect((atom as HTMLElement).dataset.inlineAtomType).toBe("mention");
    expect(renderMention).toHaveBeenCalledWith({ id: "user-123" });
    expect(atom?.textContent).toBe("mention:user-123");

    act(() => {
      editorView.updateState(
        editorView.state.apply(
          editorView.state.tr.setNodeMarkup(1, undefined, {
            metadata: { id: "user-456" },
          }),
        ),
      );
    });
    expect(mount.querySelector("[data-inline-atom-type='mention']")).toBe(atom);
    expect(atom?.textContent).toBe("mention:user-456");
    expect(renderMention).toHaveBeenLastCalledWith({ id: "user-456" });

    act(() => editorView.destroy());
    expect(atom?.textContent).toBe("");
    owner.unmount();
    portals.dispose();
  });

  it("updates the same portal for metadata and rejects another node type", () => {
    const owner = render(<InlineAtomPortalHost registry={portals} />);
    const schema = createBlockLocalProseMirrorSchema({
      inlineAtoms: [mentionDefinition, emojiDefinition],
    });
    let view!: InlineAtomNodeView;
    act(() => {
      view = instantiateNodeView(
        createInlineAtomNodeView(mentionDefinition, portals),
        schema.nodes.mention!.create({ metadata: { id: "user-1" } }),
      );
    });
    const dom = view.dom;

    act(() => {
      expect(
        view.update?.(
          schema.nodes.mention!.create({ metadata: { id: "user-2" } }),
        ),
      ).toBe(true);
    });
    expect(view.dom).toBe(dom);
    expect(renderMention).toHaveBeenLastCalledWith({ id: "user-2" });
    expect((view.dom as HTMLElement).textContent).toBe("mention:user-2");
    expect(
      view.update?.(
        schema.nodes.emoji!.create({ metadata: { value: "emoji" } }),
      ),
    ).toBe(false);
    owner.unmount();
    portals.dispose();
  });

  it("removes only the destroyed atom entry and cleanup is idempotent", () => {
    render(<InlineAtomPortalHost registry={portals} />);
    const schema = createBlockLocalProseMirrorSchema({
      inlineAtoms: [mentionDefinition],
    });
    const create = createInlineAtomNodeView(mentionDefinition, portals);
    let first!: InlineAtomNodeView;
    let second!: InlineAtomNodeView;
    act(() => {
      first = instantiateNodeView(
        create,
        schema.nodes.mention!.create({ metadata: { id: "first" } }),
      );
      second = instantiateNodeView(
        create,
        schema.nodes.mention!.create({ metadata: { id: "second" } }),
      );
    });

    expect(
      first.ignoreMutation?.({ type: "childList" } as MutationRecord),
    ).toBe(true);
    expect(
      first.ignoreMutation?.({ type: "selection", target: first.dom }),
    ).toBe(false);
    expect(first.dom.textContent).toBe("mention:first");
    expect(second.dom.textContent).toBe("mention:second");
    act(() => first.destroy?.());
    expect(first.dom.textContent).toBe("");
    expect(second.dom.textContent).toBe("mention:second");
    act(() => first.destroy?.());
    expect(second.dom.textContent).toBe("mention:second");
    act(() => second.destroy?.());
    expect(second.dom.textContent).toBe("");
    portals.dispose();
  });
});

function instantiateNodeView(
  constructor: NodeViewConstructor,
  node: PMNode,
  ownerDocument: Document = document,
): InlineAtomNodeView {
  const view = {
    dom: ownerDocument.createElement("div"),
  } as unknown as EditorView;
  const args = [
    node,
    view,
    () => 0,
    [],
    {},
  ] as unknown as Parameters<NodeViewConstructor>;
  return constructor(...args) as InlineAtomNodeView;
}

function acceptingAdapter(): ProseMirrorProposalAdapter {
  return {
    isProjectingFinalizedContent: () => false,
    readContentBaseToken: () => ({
      graphRevision: 1,
      blockId: inlineAtomBlockId,
      blockType: "textBlock" as const,
      contentRevision: 1,
    }),
    evaluateProposal: (proposal: ProseMirrorStateProposal) => ({
      kind: "accepted",
      state: proposal.proposedState,
    }),
  };
}
