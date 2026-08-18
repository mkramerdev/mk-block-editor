import type { BlockId } from "../../kernel/identity/ids.ts";

/** Transient canonical-selection suggestion for block-graph planners. */
export interface BlockGraphSelectionSuggestion {
  readonly blockId: BlockId;
  readonly offset?: number | null;
}
