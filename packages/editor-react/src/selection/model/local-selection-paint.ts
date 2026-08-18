import type { CommittedSelectionSnapshot } from "./committed-selection-snapshot.ts";

export type LocalSelectionPaintModel =
  | { readonly kind: "none" }
  | {
      readonly kind: "range";
      readonly sourceRevision: number;
      readonly snapshot: CommittedSelectionSnapshot;
    };

export interface EditorLocalSelectionPaintReader {
  getSnapshot(): LocalSelectionPaintModel;
  subscribe(listener: () => void): () => void;
}

export const noLocalSelectionPaint: LocalSelectionPaintModel = Object.freeze({
  kind: "none",
});
