import type { BlockInternalSelectionSubsystem } from "./types.ts";
import type { CommittedSelectionSnapshot } from "./committed-selection-snapshot.ts";

export type CanonicalLocalSelection =
  | { readonly kind: "none"; readonly revision: number }
  | {
      readonly kind: "document";
      readonly revision: number;
      readonly snapshot: CommittedSelectionSnapshot;
    }
  | {
      readonly kind: "block-internal";
      readonly revision: number;
      readonly subsystem: BlockInternalSelectionSubsystem;
      readonly snapshot: CommittedSelectionSnapshot;
    };

export interface EditorCanonicalSelectionReader {
  getSnapshot(): CanonicalLocalSelection;
  subscribe(listener: () => void): () => void;
}
