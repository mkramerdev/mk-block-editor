import { richTextDocumentContentSize } from "@repo/editor-core/content/rich-text";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import type { BlockType } from "@repo/editor-core/document";
import {
  blockCreationSelectionTargetKind,
  type CanonicalBlockFragment,
} from "@repo/editor-core/editing";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorTransactionSelectionEffect } from "../runtime/document/contracts.ts";

export interface CanonicalCreationSelectionIntent {
  readonly selectionBlockId: BlockId;
  readonly selectionOffset?: number;
}

export type CanonicalCreationSelectionResolution =
  | {
      readonly ok: true;
      readonly selection: EditorTransactionSelectionEffect;
    }
  | { readonly ok: false; readonly message: string };

/** Resolves explicit creation focus against the final submitted fragment. */
export function resolveCanonicalCreationSelection(
  fragment: CanonicalBlockFragment,
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
  intent: CanonicalCreationSelectionIntent,
): CanonicalCreationSelectionResolution {
  const record = fragment.blocks.find(
    ({ id }) => id === intent.selectionBlockId,
  );
  if (!record) {
    return {
      ok: false,
      message: "The creation selection target is outside the fragment.",
    };
  }
  const definition = blockDefinitions[record.type];
  if (!definition) {
    return {
      ok: false,
      message: "The creation selection target has no registered definition.",
    };
  }
  const targetKind = blockCreationSelectionTargetKind(definition);
  if (targetKind === "text") {
    if (!record.content) {
      return {
        ok: false,
        message: "The creation text selection target is not a content endpoint.",
      };
    }
    const offset = intent.selectionOffset ?? 0;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > richTextDocumentContentSize(record.content)
    ) {
      return {
        ok: false,
        message: "The creation text selection offset is invalid.",
      };
    }
    return {
      ok: true,
      selection: { kind: "text", blockId: record.id, offset },
    };
  }
  if (targetKind === null) {
    return {
      ok: false,
      message:
        definition.kind === "text"
          ? "The creation text selection target is not a content endpoint."
          : "The creation block selection target is not selectable.",
    };
  }
  if (intent.selectionOffset !== undefined) {
    return {
      ok: false,
      message: "A block selection target cannot carry a text offset.",
    };
  }
  return {
    ok: true,
    selection: { kind: "block", blockId: record.id },
  };
}
