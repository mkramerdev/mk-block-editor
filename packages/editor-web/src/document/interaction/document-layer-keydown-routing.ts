import type { EditorDocumentLayerKeyboardDispatcher } from "../../runtime/document/document-layer-interactions.ts";
import type { EditorDocumentInputRouting } from "../../runtime/keybindings/document-input-routing.ts";

export function routeEditorDocumentKeydown(
  event: KeyboardEvent,
  layerKeyboard: EditorDocumentLayerKeyboardDispatcher,
  documentInput: EditorDocumentInputRouting | null,
  routeCanonicalSelection: (event: KeyboardEvent) => void,
): void {
  if (layerKeyboard.dispatchKeydown(event) === "handled") {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  documentInput?.keydown(event);
  routeCanonicalSelection(event);
}
