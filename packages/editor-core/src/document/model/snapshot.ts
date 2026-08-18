import type { Block } from "./block.ts";
import type { RichTextDocumentNodeJson } from "../../content/rich-text/rich-inline-types.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";
import type {
  EditorContentCheckpoint,
  EditorOpaqueContentCheckpoint,
} from "../../kernel/content/encoded-content.ts";

export type EditorTextBlockContent = RichTextDocumentNodeJson;

/**
 * Editable state for one mounted editor instance.
 *
 * Outer packages decide how an instance is loaded or routed. This shape only
 * carries the complete ordered graph, block records, and content data needed
 * to render and edit that one instance.
 */
export interface EditorInstanceSnapshot {
  readonly blockGraphVersion: number;
  readonly blocks: Readonly<Record<BlockId, Block>>;
  readonly rootBlockIds: readonly BlockId[];
  readonly childIdsByParentId: Readonly<
    Partial<Record<BlockId, readonly BlockId[]>>
  >;
  /** Rich-text content for live text-based blocks only. */
  readonly content: Readonly<Partial<Record<BlockId, EditorTextBlockContent>>>;
  /** Opaque accumulated state for each independent text block. */
  readonly opaqueContentCheckpoints: Readonly<
    Partial<Record<BlockId, EditorOpaqueContentCheckpoint>>
  >;
}

/**
 * Changed block data emitted by an editor instance after a local edit.
 *
 * This is intentionally smaller than a full editor instance snapshot: it only
 * carries the affected ids, live block records, content for those live records,
 * and deleted ids needed by the owner to persist the edit.
 */
export interface EditorInstanceBlockSlice {
  readonly blockGraphVersion: number;
  readonly affectedBlockIds: readonly BlockId[];
  readonly blocks: Readonly<Record<BlockId, Block>>;
  readonly rootBlockIds: readonly BlockId[];
  readonly childIdsByParentId: Readonly<
    Partial<Record<BlockId, readonly BlockId[]>>
  >;
  readonly content: Readonly<Partial<Record<BlockId, EditorTextBlockContent>>>;
  /** Hydrated accumulated state for affected persistence rows only. */
  readonly contentCheckpoints: Readonly<
    Partial<Record<BlockId, EditorContentCheckpoint>>
  >;
  readonly deletedBlockIds?: readonly BlockId[];
}
