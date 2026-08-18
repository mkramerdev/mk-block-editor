import type {
  BlockPlacement,
  CanonicalBlockFragment,
  StructuralEditRange,
} from "@repo/editor-core/editing";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorTransactionResult } from "./mutation.ts";
import type { EditorLocalMutationProvenance } from "./local-mutation-provenance.ts";
import type { EditorTransactionSelectionEffect } from "./mutation.ts";

export interface StructuralTextJoin {
  readonly leftBlockId: BlockId;
  readonly rightBlockId: BlockId;
}

export interface ResolvedStructuralEditComposition {
  readonly deletion?: StructuralEditRange;
  readonly insertions?: readonly {
    readonly placement: BlockPlacement;
    readonly fragment: CanonicalBlockFragment;
  }[];
  readonly joins?: readonly StructuralTextJoin[];
  readonly finalSelection?: EditorTransactionSelectionEffect;
}

export interface StructuralEditTransactionPort {
  transaction(
    callback: () => unknown,
    context?: {
      readonly provenance: EditorLocalMutationProvenance | null;
      readonly selectionPresentation?:
        | "canonical-only"
        | "native-final-selection";
    },
  ): EditorTransactionResult;
  deleteRange(range: StructuralEditRange): unknown;
  insertBlocks(
    placement: BlockPlacement,
    fragment: CanonicalBlockFragment,
  ): unknown;
  joinTextBlocks(leftBlockId: BlockId, rightBlockId: BlockId): unknown;
  setTransactionSelection(selection: EditorTransactionSelectionEffect): void;
}

/**
 * Executes a resolved structural composition using only ordinary mutations.
 * The composition is deliberately transport-agnostic: its fragment may have
 * originated from any canonical producer.
 */
export function executeStructuralEditComposition(
  editor: StructuralEditTransactionPort,
  composition: ResolvedStructuralEditComposition,
  context: {
    readonly provenance: EditorLocalMutationProvenance | null;
    readonly selectionPresentation?:
      | "canonical-only"
      | "native-final-selection";
  },
): EditorTransactionResult {
  return editor.transaction(() => {
    if (composition.deletion) editor.deleteRange(composition.deletion);
    for (const insertion of composition.insertions ?? []) {
      editor.insertBlocks(insertion.placement, insertion.fragment);
    }
    for (const join of composition.joins ?? []) {
      editor.joinTextBlocks(join.leftBlockId, join.rightBlockId);
    }
    if (composition.finalSelection) {
      editor.setTransactionSelection(composition.finalSelection);
    }
  }, context);
}
