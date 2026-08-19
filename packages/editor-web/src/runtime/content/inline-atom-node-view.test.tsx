import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createBlockLocalProseMirrorSchema } from "@repo/editor-dom/schema";
import {
  InlineAtomPortalHost,
  InlineAtomPortalRegistry,
} from "./inline-atom-portal-registry.tsx";
import {
  createInlineAtomNodeView,
  createInlineAtomNodeViews,
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

  it("creates one portal NodeView per exact definition and renders metadata", () => {
    const owner = render(<InlineAtomPortalHost registry={portals} />);
    const schema = createBlockLocalProseMirrorSchema({
      inlineAtoms: [mentionDefinition, emojiDefinition],
    });
    const views = createInlineAtomNodeViews(
      [mentionDefinition, emojiDefinition],
      portals,
    );
    const mention = schema.nodes.mention!.create({
      metadata: { id: "user-123" },
    });
    let view!: ReturnType<(typeof views)["mention"]>;
    act(() => {
      view = views.mention!(mention);
    });

    expect(Object.keys(views).sort()).toStrictEqual(["emoji", "mention"]);
    expect(view.dom).toBeInstanceOf(HTMLElement);
    expect((view.dom as HTMLElement).contentEditable).toBe("false");
    expect((view.dom as HTMLElement).dataset.inlineAtomType).toBe("mention");
    expect(renderMention).toHaveBeenCalledWith({ id: "user-123" });
    expect((view.dom as HTMLElement).textContent).toBe("mention:user-123");
    expect(view).not.toHaveProperty("contentDOM");
    owner.unmount();
    portals.dispose();
  });

  it("updates the same portal for metadata and rejects another node type", () => {
    const owner = render(<InlineAtomPortalHost registry={portals} />);
    const schema = createBlockLocalProseMirrorSchema({
      inlineAtoms: [mentionDefinition, emojiDefinition],
    });
    let view!: ReturnType<ReturnType<typeof createInlineAtomNodeView>>;
    act(() => {
      view = createInlineAtomNodeView(
        mentionDefinition,
        portals,
      )(schema.nodes.mention!.create({ metadata: { id: "user-1" } }));
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
    let first!: ReturnType<typeof create>;
    let second!: ReturnType<typeof create>;
    act(() => {
      first = create(
        schema.nodes.mention!.create({ metadata: { id: "first" } }),
      );
      second = create(
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
