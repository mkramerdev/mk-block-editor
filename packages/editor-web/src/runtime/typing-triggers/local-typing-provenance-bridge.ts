import type {
  EditorLocalMutationProvenance,
  EditorLocalTypingProvenance,
} from "@repo/editor-react/editor";

/**
 * Correlates one trusted trigger-enabled beforeinput edge with the later
 * document-changing ProseMirror proposal from the same browser task.
 */
export class LocalTypingProvenanceBridge {
  private pending: {
    readonly provenance: EditorLocalTypingProvenance;
  } | null = null;
  private disposed = false;

  captureBeforeInput(event: InputEvent): void {
    if (
      this.disposed ||
      !event.isTrusted ||
      event.defaultPrevented ||
      event.isComposing ||
      typeof event.data !== "string" ||
      event.data.length === 0
    ) {
      return;
    }
    const inputType = localTypingInputType(event.inputType);
    if (inputType === null) return;

    this.pending = {
      provenance: Object.freeze({
        kind: "typing",
        text: event.data,
        inputType,
      }),
    };
  }

  consume(): EditorLocalMutationProvenance | null {
    if (this.disposed) return null;
    const provenance = this.pending?.provenance ?? null;
    this.pending = null;
    return provenance;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pending = null;
  }
}

function localTypingInputType(
  inputType: string,
): EditorLocalTypingProvenance["inputType"] | null {
  switch (inputType) {
    case "insertText":
      return "text";
    case "insertReplacementText":
      return "replacement";
    case "insertFromDictation":
      return "dictation";
    default:
      return null;
  }
}
