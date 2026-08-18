import type {
  EditorDocumentLayerInteractionPort,
  EditorDocumentLayerKeyboardEvent,
  EditorDocumentLayerKeydownHandler,
  EditorDocumentLayerKeydownResult,
} from "./contracts.ts";

export interface EditorDocumentLayerKeyboardDispatcher {
  readonly dispatchKeydown: (
    event: KeyboardEvent,
  ) => EditorDocumentLayerKeydownResult;
}

export interface EditorDocumentLayerInteractionController {
  readonly port: EditorDocumentLayerInteractionPort;
  readonly keyboard: EditorDocumentLayerKeyboardDispatcher;
  /** Imperative-owner teardown; React render owners rely on registration cleanup and reachability. */
  dispose(): void;
}

/** Creates the interaction ownership boundary for one mounted EditorDocument. */
export function createEditorDocumentLayerInteractionController(): EditorDocumentLayerInteractionController {
  const registrations: Array<{
    readonly handler: EditorDocumentLayerKeydownHandler;
  }> = [];
  let disposed = false;
  const port: EditorDocumentLayerInteractionPort = Object.freeze({
    registerKeydownHandler(handler: EditorDocumentLayerKeydownHandler) {
      if (disposed) return () => undefined;
      const registration = { handler };
      registrations.push(registration);
      let registered = true;
      return () => {
        if (!registered) return;
        registered = false;
        const index = registrations.indexOf(registration);
        if (index >= 0) registrations.splice(index, 1);
      };
    },
  });
  return {
    port,
    keyboard: Object.freeze({
      dispatchKeydown(event: KeyboardEvent) {
        const normalized = normalizeKeyboardEvent(event);
        for (const { handler } of [...registrations].reverse()) {
          if (handler(normalized) === "handled") return "handled";
        }
        return "unhandled";
      },
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      registrations.length = 0;
    },
  };
}

function normalizeKeyboardEvent(
  event: KeyboardEvent,
): EditorDocumentLayerKeyboardEvent {
  return Object.freeze({
    key: event.key,
    code: event.code,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    repeat: event.repeat,
    isComposing: event.isComposing,
  });
}
