import type { NodeViewConstructor } from "@repo/editor-dom/prosemirror";
import type { ResolvedTextDomPresentation } from "../../document/blocks/text-dom-presentation.ts";

/** Presents the neutral paragraph node through renderer-owned semantic DOM. */
export function createTextDomNodeView(
  presentation: ResolvedTextDomPresentation,
): NodeViewConstructor {
  return (_node, view) => {
    const dom = view.dom.ownerDocument.createElement(presentation.element);
    for (const [name, value] of Object.entries(presentation.attributes)) {
      dom.setAttribute(name, value);
    }
    dom.dataset.blockNode = "paragraph";
    return { dom, contentDOM: dom };
  };
}
