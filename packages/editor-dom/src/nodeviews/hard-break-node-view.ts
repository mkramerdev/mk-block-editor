import type { NodeViewConstructor } from "../prosemirror/index.ts";

export const hardBreakNodeView: NodeViewConstructor = (_node, view) => ({
  dom: view.dom.ownerDocument.createElement("br"),
  ignoreMutation: () => true,
});
