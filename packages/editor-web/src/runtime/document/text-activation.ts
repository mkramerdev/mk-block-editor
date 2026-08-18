import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorSelectionTextAffinity } from "@repo/editor-react/selection";

export type TextActivationFocusMode = "acquire" | "adopt";

export interface TextActivationRequest {
  readonly blockId: BlockId;
  readonly canonicalSelectionRevision: number;
  readonly canonicalTextOffset: number;
  readonly affinity: EditorSelectionTextAffinity | null;
  readonly preventScroll: boolean;
}

export interface TextActivationObligation extends TextActivationRequest {
  readonly identity: symbol;
  readonly projectionIdentity: symbol;
  readonly focusMode: TextActivationFocusMode;
}

export type TextActivationObligationState =
  | "pending"
  | "consumed"
  | "superseded"
  | "cancelled";

/** A revision-bound, exactly-once hand-off from canonical selection to input. */
export class OwnedTextActivationObligation {
  private lifecycle: TextActivationObligationState = "pending";

  constructor(readonly value: TextActivationObligation) {}

  state(): TextActivationObligationState {
    return this.lifecycle;
  }

  consume(): TextActivationObligation {
    if (this.lifecycle !== "pending") {
      throw new Error(`Cannot consume a ${this.lifecycle} text activation.`);
    }
    this.lifecycle = "consumed";
    return this.value;
  }

  supersede(): void {
    if (this.lifecycle === "pending") this.lifecycle = "superseded";
  }

  cancel(): void {
    if (this.lifecycle === "pending") this.lifecycle = "cancelled";
  }
}
