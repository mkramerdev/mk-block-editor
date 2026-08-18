import {
  validateAndCloneInlineAtomMetadata,
} from "@repo/editor-core/content/inline-atoms";
import type {
  NodeView,
  NodeViewConstructor,
  PMNode,
} from "@repo/editor-dom/prosemirror";
import type { InlineAtomDefinition } from "../definition/contracts.ts";
import type {
  InlineAtomPortalRegistration,
  InlineAtomPortalRegistry,
} from "./inline-atom-portal-registry.tsx";

export function createInlineAtomNodeView(
  definition: InlineAtomDefinition,
  portals: InlineAtomPortalRegistry,
): NodeViewConstructor {
  return (node) => new PortalInlineAtomNodeView(definition, portals, node);
}

export function createInlineAtomNodeViews(
  definitions: readonly InlineAtomDefinition[],
  portals: InlineAtomPortalRegistry,
): Readonly<Record<string, NodeViewConstructor>> {
  return Object.freeze(
    Object.fromEntries(
      definitions.map((definition) => [
        definition.type,
        createInlineAtomNodeView(definition, portals),
      ]),
    ),
  );
}

class PortalInlineAtomNodeView implements NodeView {
  readonly dom: HTMLElement;
  private portal: InlineAtomPortalRegistration | null = null;
  private node: PMNode;

  constructor(
    private readonly definition: InlineAtomDefinition,
    private readonly portals: InlineAtomPortalRegistry,
    node: PMNode,
  ) {
    this.node = node;
    this.dom = document.createElement("span");
    this.dom.contentEditable = "false";
    this.dom.dataset.inlineAtomType = definition.type;
    this.render();
  }

  update(nextNode: PMNode): boolean {
    if (nextNode.type !== this.node.type) return false;
    this.node = nextNode;
    this.render();
    return true;
  }

  ignoreMutation(
    mutation: Parameters<NonNullable<NodeView["ignoreMutation"]>>[0],
  ): boolean {
    return mutation.type !== "selection";
  }

  destroy(): void {
    this.portal?.remove();
    this.portal = null;
  }

  private render(): void {
    const metadata = validateAndCloneInlineAtomMetadata(
      this.node.attrs.metadata,
      this.definition.metadata,
      `${this.definition.type}.metadata`,
    );
    if (!metadata.valid) {
      throw new Error(metadata.errors.join("; "));
    }
    const content = this.definition.render(metadata.value);
    if (this.portal) this.portal.update(content);
    else this.portal = this.portals.register(this.dom, content);
  }
}
