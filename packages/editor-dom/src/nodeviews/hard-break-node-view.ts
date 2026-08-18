import type { NodeView } from "../prosemirror/index.ts";

export const hardBreakNodeView = (): NodeView => ({
  dom: document.createElement("br"),
  ignoreMutation: () => true,
});
