import {
  isRichTextDocument,
  richTextDocumentContentSize,
  type RichTextDocumentNodeJson,
} from "../../content/rich-text/rich-inline-content.ts";
import type { BlockDefinition } from "../../definitions/block-definition.ts";
import type { BlockType, VersionedBlock } from "../../document/model/block.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";
import type { TransactionReadableContent } from "../transactions/types.ts";

export interface CanonicalNavigationInput {
  readonly originBlockId: BlockId;
  readonly blocks: Readonly<Record<BlockId, VersionedBlock>>;
  readonly rootBlockIds: readonly BlockId[];
  readonly childIdsByParentId: Readonly<
    Partial<Record<BlockId, readonly BlockId[]>>
  >;
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  readonly readContent: (
    blockId: BlockId,
    blockType: BlockType,
  ) => TransactionReadableContent | null;
}

export type CanonicalMergeTargetResult =
  | {
      readonly ok: true;
      readonly blockId: BlockId;
      readonly content: RichTextDocumentNodeJson;
      readonly contentVersion: string | null;
      readonly originalLength: number;
      readonly crossedAncestorIds: readonly BlockId[];
      readonly originAncestorIds: readonly BlockId[];
    }
  | {
      readonly ok: false;
      readonly reason: "missing-source" | "blocked" | "no-target";
    };

export type CanonicalSelectionNavigationResult =
  | {
      readonly ok: true;
      readonly blockId: BlockId;
      readonly kind: "text" | "atomic";
      readonly offset: number;
    }
  | { readonly ok: false; readonly reason: "missing-source" | "no-target" };

type Direction = "previous" | "next";
type Candidate =
  | {
      readonly kind: "text";
      readonly block: VersionedBlock;
      readonly content: RichTextDocumentNodeJson;
      readonly version: string | null;
      readonly length: number;
    }
  | { readonly kind: "atomic"; readonly block: VersionedBlock };
type Descent =
  | { readonly kind: "candidate"; readonly candidate: Candidate }
  | { readonly kind: "none" };

export function findCanonicalMergeTarget(
  input: CanonicalNavigationInput,
  direction: Direction,
): CanonicalMergeTargetResult {
  const source = liveBlock(input.blocks, input.originBlockId);
  if (!source) return { ok: false, reason: "missing-source" };
  const crossed: BlockId[] = [];
  let cursor = source;
  while (true) {
    const adjacent = adjacentSiblingIds(input, cursor);
    const siblingId =
      direction === "previous"
        ? adjacent.previousSiblingId
        : adjacent.nextSiblingId;
    const sibling = siblingId ? liveBlock(input.blocks, siblingId) : null;
    if (sibling) {
      const descended = descend(input, sibling, direction);
      if (descended.kind === "candidate") {
        if (descended.candidate.kind === "atomic") {
          return { ok: false, reason: "blocked" };
        }
        return {
          ok: true,
          blockId: descended.candidate.block.id,
          content: descended.candidate.content,
          contentVersion: descended.candidate.version,
          originalLength: descended.candidate.length,
          crossedAncestorIds: [...crossed],
          originAncestorIds: ancestorIds(input.blocks, source),
        };
      }
    }
    if (!cursor.parentId) break;
    const parent = liveBlock(input.blocks, cursor.parentId);
    if (!parent) break;
    crossed.push(parent.id);
    cursor = parent;
  }
  return { ok: false, reason: "no-target" };
}

export function findCanonicalSelectionTarget(
  input: CanonicalNavigationInput,
  direction: Direction,
): CanonicalSelectionNavigationResult {
  const source = liveBlock(input.blocks, input.originBlockId);
  if (!source) return { ok: false, reason: "missing-source" };
  let cursor = source;
  while (true) {
    const adjacent = adjacentSiblingIds(input, cursor);
    const siblingId =
      direction === "previous"
        ? adjacent.previousSiblingId
        : adjacent.nextSiblingId;
    const sibling = siblingId ? liveBlock(input.blocks, siblingId) : null;
    if (sibling) {
      const descended = descend(input, sibling, direction);
      if (descended.kind === "candidate") {
        const candidate = descended.candidate;
        return candidate.kind === "text"
          ? {
              ok: true,
              blockId: candidate.block.id,
              kind: "text",
              offset: direction === "previous" ? candidate.length : 0,
            }
          : {
              ok: true,
              blockId: candidate.block.id,
              kind: "atomic",
              offset: 0,
            };
      }
    }
    if (!cursor.parentId) break;
    const parent = liveBlock(input.blocks, cursor.parentId);
    if (!parent) break;
    cursor = parent;
  }
  return { ok: false, reason: "no-target" };
}

function descend(
  input: CanonicalNavigationInput,
  block: VersionedBlock,
  direction: Direction,
): Descent {
  const definition = input.blockDefinitions[block.type];
  if (!definition) return { kind: "none" };
  if (definition.kind === "text") {
    const readable = input.readContent(block.id, block.type);
    if (!readable || !isRichTextDocument(readable.content)) {
      return { kind: "none" };
    }
    return {
      kind: "candidate",
      candidate: {
        kind: "text",
        block,
        content: readable.content,
        version: readable.version,
        length: richTextDocumentContentSize(readable.content),
      },
    };
  }
  if (definition.kind === "atomic") {
    return { kind: "candidate", candidate: { kind: "atomic", block } };
  }
  const children = liveChildren(input, block.id);
  const ordered = direction === "previous" ? [...children].reverse() : children;
  for (const child of ordered) {
    const result = descend(input, child, direction);
    if (result.kind !== "none") return result;
  }
  return { kind: "none" };
}

function ancestorIds(
  blocks: Readonly<Record<BlockId, VersionedBlock>>,
  source: VersionedBlock,
): BlockId[] {
  const result: BlockId[] = [];
  let parentId = source.parentId;
  while (parentId) {
    const parent = liveBlock(blocks, parentId);
    if (!parent) break;
    result.push(parent.id);
    parentId = parent.parentId;
  }
  return result;
}

function liveChildren(
  input: CanonicalNavigationInput,
  parentId: BlockId | null,
): readonly VersionedBlock[] {
  const childIds =
    parentId === null
      ? input.rootBlockIds
      : (input.childIdsByParentId[parentId] ?? []);
  return childIds
    .map((blockId) => input.blocks[blockId])
    .filter((block): block is VersionedBlock =>
      Boolean(block && !block.tombstone),
    );
}

function adjacentSiblingIds(
  input: CanonicalNavigationInput,
  block: VersionedBlock,
): {
  readonly previousSiblingId: BlockId | null;
  readonly nextSiblingId: BlockId | null;
} {
  const ids =
    block.parentId === null
      ? input.rootBlockIds
      : (input.childIdsByParentId[block.parentId] ?? []);
  const index = ids.indexOf(block.id);
  return {
    previousSiblingId: index > 0 ? (ids[index - 1] ?? null) : null,
    nextSiblingId: index >= 0 ? (ids[index + 1] ?? null) : null,
  };
}

function liveBlock(
  blocks: Readonly<Record<BlockId, VersionedBlock>>,
  blockId: BlockId,
): VersionedBlock | null {
  const block = blocks[blockId];
  return block && !block.tombstone ? block : null;
}
