import type { EditorTextBlockContent } from "@repo/editor-core/codecs";
import type { EditorContentOperationUpdate } from "@repo/editor-core/content/rich-text";
import type { BlockType } from "@repo/editor-core/document";
import type { BlockId, JsonObject } from "@repo/editor-core/kernel";
import type { UpdateBlockMetadataOperation } from "@repo/editor-core/operations";

export interface EditorTransportBlockPlacement {
  readonly parentId: BlockId | null;
  readonly previousSiblingId: BlockId | null;
  readonly nextSiblingId: BlockId | null;
}

export type EditorTransportBlockGraphChange =
  | {
      readonly kind: "create";
      readonly blockId: BlockId;
      readonly blockType: BlockType;
      readonly placement: EditorTransportBlockPlacement;
      readonly initialMetadata?: JsonObject;
    }
  | {
      readonly kind: "move" | "restore";
      readonly blockId: BlockId;
      readonly placement: EditorTransportBlockPlacement;
    }
  | { readonly kind: "delete"; readonly blockId: BlockId }
  | {
      readonly kind: "change-type";
      readonly blockId: BlockId;
      readonly blockType: BlockType;
    };

export interface EditorTransportContentUpdate {
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly update: EditorContentOperationUpdate;
  readonly readProjection: EditorTextBlockContent;
}

export interface EditorTransportTransaction {
  readonly transactionId: string;
  readonly historyAction: "command" | "undo" | "redo";
  readonly graph: {
    readonly changes: readonly EditorTransportBlockGraphChange[];
  } | null;
  readonly metadata: UpdateBlockMetadataOperation | null;
  readonly content: readonly EditorTransportContentUpdate[];
}
