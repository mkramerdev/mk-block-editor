import type { BlockType } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";

export interface EditorLocalTypingProvenance {
  readonly kind: "typing";
  readonly text: string;
  readonly inputType: "text" | "replacement" | "dictation" | "composition";
  readonly finalSelection?: {
    readonly blockId: BlockId;
    readonly blockType: BlockType;
    readonly offset: number;
  };
}

/** Ephemeral context for one local canonical mutation. */
export type EditorLocalMutationProvenance = EditorLocalTypingProvenance;
