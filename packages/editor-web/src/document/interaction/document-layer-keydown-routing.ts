import type { EditorDocumentLayerKeyboardDispatcher } from "../../runtime/document/document-layer-interactions.ts";
import type { EditorDocumentInputRouting } from "../../runtime/keybindings/document-input-routing.ts";
import type { ResolvedNativeFocusTarget } from "../../runtime/document/native-focus-coordinator.ts";

export function routeEditorDocumentKeydown(
  event: KeyboardEvent,
  layerKeyboard: EditorDocumentLayerKeyboardDispatcher,
  documentInput: EditorDocumentInputRouting | null,
  resolveNativeFocusTarget: (
    target: EventTarget | null,
  ) => ResolvedNativeFocusTarget,
  routeCanonicalSelection: (
    event: KeyboardEvent,
    nativeFocus: ResolvedNativeFocusTarget,
  ) => void,
): void {
  if (layerKeyboard.dispatchKeydown(event) === "handled") {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const nativeFocus = resolveNativeFocusTarget(event.target);
  documentInput?.keydown(event, nativeFocus);
  routeCanonicalSelection(event, nativeFocus);
}
