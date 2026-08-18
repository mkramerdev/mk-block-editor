import type { CanonicalLocalSelection } from "./canonical-selection.ts";
import type { CommittedSelectionSnapshot } from "./committed-selection-snapshot.ts";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorContentBaseToken } from "@repo/editor-core/operations";
import type { SelectionSettlementContext } from "./types.ts";

export type SelectionSettlementKind = "selection" | "clear";

export interface SelectionSettlementMarker {
  readonly sequence: number;
  readonly kind: SelectionSettlementKind;
  readonly canonicalRevision: number;
  readonly publication: SelectionSettlementContext["publication"];
  readonly cause: SelectionSettlementContext["cause"];
}

export type NativeSelectionPaintMode =
  | "visible"
  | "hidden-for-global-selection"
  | "composition-owned";

export interface SelectionCompositionSessionSnapshot {
  readonly revision: number;
  readonly frozenSelection: CommittedSelectionSnapshot;
  readonly selectionRevision: number;
  readonly graphRevision: number;
  readonly baseTokens: readonly EditorContentBaseToken[];
  readonly hostBlockId: BlockId;
  readonly hasUnpublishedDraft: boolean;
  readonly latestText: string | null;
}

export interface SelectionPresentationSnapshot {
  readonly canonical: CanonicalLocalSelection;
  readonly settlement: SelectionSettlementMarker | null;
  readonly nativeSelectionPaintMode: NativeSelectionPaintMode;
  readonly composition: SelectionCompositionSessionSnapshot | null;
}

export interface EditorSelectionPresentationReader {
  getSnapshot(): SelectionPresentationSnapshot;
  getServerSnapshot(): SelectionPresentationSnapshot;
  subscribe(listener: () => void): () => void;
}
