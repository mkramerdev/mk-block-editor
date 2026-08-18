import { isBlockEditorComposing } from "@repo/editor-dom/block-editor";
import { Plugin } from "@repo/editor-dom/prosemirror";
import type { EditorBlockKeybindingRuntimeContext } from "./resolver.ts";
import { resolveBlockKeybinding } from "./resolver.ts";
import { readEditorKeybindingPlatform } from "./chord.ts";

export function createEditorKeybindingPlugin(
  runtime: Omit<EditorBlockKeybindingRuntimeContext, "view">,
): Plugin {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (event.defaultPrevented || isBlockEditorComposing(view.state)) {
          return false;
        }
        const platform = readEditorKeybindingPlatform(
          view.dom.ownerDocument.defaultView,
        );
        const blockResult = resolveBlockKeybinding(
          event,
          { ...runtime, view },
          platform,
        );
        if (blockResult.kind === "handled") return true;
        return false;
      },
    },
  });
}
