import type { BlockDefinition } from "@repo/editor-core/definitions";
import type { BlockType, VersionedBlock } from "@repo/editor-core/document";
import {
  findAdjacentValidInsertionPlacement,
  materializeCanonicalBlockCreation,
  structuralPlacementAcceptsBlockType,
  type BlockPlacement,
  type StructuralEditRange,
} from "@repo/editor-core/editing";
import {
  cloneJsonValue,
  type BlockId,
  type JsonObject,
} from "@repo/editor-core/kernel";
import type { RichTextDocumentNodeJson } from "@repo/editor-core/content/rich-text";
import type {
  EditableEditor,
  EditorDocumentRuntime,
  EditorTransactionSelectionEffect,
} from "../runtime/document/contracts.ts";
import { resolveCanonicalCreationSelection } from "./canonical-creation-selection.ts";

export type CanonicalBlockCreationEditor = Pick<
  EditableEditor,
  | "deleteBlocks"
  | "deleteRange"
  | "getBlock"
  | "getChildBlockIds"
  | "getRootBlockIds"
  | "insertBlocks"
  | "setTransactionSelection"
  | "transaction"
>;

interface CanonicalBlockCreationCommitBase {
  readonly editor: CanonicalBlockCreationEditor;
  readonly graphRevision: number;
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  readonly blockType: BlockType;
  readonly metadata?: JsonObject;
  readonly defaultContentCount?: number;
  readonly content?: RichTextDocumentNodeJson;
  readonly plainText?: string;
  readonly initialText?: string;
  readonly sourceTextRange?: {
    readonly from: number;
    readonly to: number;
  };
  readonly expectedContentVersion?: string | null;
  readonly createBlockId?: () => BlockId;
  readonly selection: EditorTransactionSelectionEffect | "created";
  readonly selectionOffset?: number;
}

export interface CanonicalBlockCreationCommitInput extends CanonicalBlockCreationCommitBase {
  readonly targetBlockId: BlockId;
  readonly placement: "after" | "replace";
}

export interface CanonicalBlockCreationAtPlacementInput
  extends CanonicalBlockCreationCommitBase {
  readonly placement: BlockPlacement;
  readonly source?: {
    readonly block: VersionedBlock;
    readonly remove: boolean;
  };
}

export type CanonicalBlockCreationCommitResult =
  | {
      readonly ok: true;
      readonly rootBlockId: BlockId;
      readonly selectionBlockId: BlockId | null;
      readonly changedBlockIds: readonly BlockId[];
      readonly transaction: Extract<
        ReturnType<EditableEditor["transaction"]>,
        { readonly ok: true; readonly changed: true }
      >;
    }
  | {
      readonly ok: false;
      readonly message: string;
      readonly transactionAttempted?: boolean;
    };

/**
 * Plans and commits application-created canonical content together with any
 * trigger deletion and final selection settlement in one editor transaction.
 */
export function commitCanonicalBlockCreation(
  input: CanonicalBlockCreationCommitInput,
): CanonicalBlockCreationCommitResult {
  const target = input.editor.getBlock(input.targetBlockId);
  if (!target || target.tombstone) {
    return {
      ok: false,
      message: `Block ${input.targetBlockId} is unavailable.`,
    };
  }
  const parentId = target.parentId;
  const siblings = readDirectBlockIds(input.editor, parentId);
  const targetIndex = siblings.indexOf(target.id);
  if (targetIndex < 0) {
    return {
      ok: false,
      message: "The target sibling boundary is unavailable.",
    };
  }
  const replacing = input.placement === "replace";
  if (replacing && input.sourceTextRange !== undefined) {
    return {
      ok: false,
      message: "A complete source replacement cannot retain a text range.",
    };
  }
  const graph = readPublicEditorGraph(input.editor);
  const directPlacement = {
    parentId,
    childIndex: targetIndex + 1,
  };
  const targetDefinition = input.blockDefinitions[target.type];
  const adjacent = replacing
    ? null
    : targetDefinition?.kind === "wrapper" &&
        targetDefinition.contentBoundary &&
        structuralPlacementAcceptsBlockType({
          placement: directPlacement,
          proposedType: input.blockType,
          ...graph,
          blockDefinitions: input.blockDefinitions,
        })
      ? {
          ok: true as const,
          placement: directPlacement,
          remainsInsideDirectParent: true,
          crossedAncestorIds: [],
        }
      : findAdjacentValidInsertionPlacement({
          originBlockId: target.id,
          proposedType: input.blockType,
          ...graph,
          blockDefinitions: input.blockDefinitions,
        });
  if (!replacing && (!adjacent || !adjacent.ok)) {
    return {
      ok: false,
      message: "No adjacent structural boundary accepts the requested block.",
    };
  }
  let resolvedPlacement: BlockPlacement;
  if (replacing) {
    resolvedPlacement = { parentId, childIndex: targetIndex };
  } else {
    if (!adjacent?.ok) {
      return {
        ok: false,
        message: "No adjacent structural boundary accepts the requested block.",
      };
    }
    resolvedPlacement = adjacent.placement;
  }
  return commitCanonicalBlockCreationAtPlacement({
    ...input,
    placement: resolvedPlacement,
    source: { block: target, remove: replacing },
  });
}

export function commitCanonicalBlockCreationAtPlacement(
  input: CanonicalBlockCreationAtPlacementInput,
): CanonicalBlockCreationCommitResult {
  const source = input.source?.block ?? null;
  const replacing = input.source?.remove ?? false;
  if (!source && input.sourceTextRange !== undefined) {
    return {
      ok: false,
      message: "Source text deletion requires an anchored source block.",
    };
  }
  const graph = readPublicEditorGraph(input.editor);
  if (
    !input.placement ||
    !Number.isInteger(input.placement.childIndex) ||
    input.placement.childIndex < 0
  ) {
    return { ok: false, message: "The insertion placement is invalid." };
  }
  if (input.placement.parentId !== null) {
    const parent = graph.blocks[input.placement.parentId];
    if (!parent || parent.tombstone) {
      return { ok: false, message: "The insertion parent is unavailable." };
    }
    if (input.blockDefinitions[parent.type]?.kind !== "wrapper") {
      return {
        ok: false,
        message: "The insertion parent does not accept child blocks.",
      };
    }
  }
  if (
    !replacing &&
    !structuralPlacementAcceptsBlockType({
      ...graph,
      blockDefinitions: input.blockDefinitions,
      placement: input.placement,
      proposedType: input.blockType,
    })
  ) {
    return {
      ok: false,
      message: "The exact insertion placement does not accept this block.",
    };
  }
  let creation: ReturnType<typeof materializeCanonicalBlockCreation>;
  try {
    creation = materializeCanonicalBlockCreation({
      blockDefinitions: input.blockDefinitions,
      type: input.blockType,
      ...(input.metadata === undefined
        ? {}
        : { metadata: cloneJsonValue(input.metadata) }),
      ...(input.defaultContentCount === undefined
        ? {}
        : { defaultContentCount: input.defaultContentCount }),
      ...(input.content === undefined
        ? {}
        : { content: cloneJsonValue(input.content) }),
      ...(input.plainText === undefined ? {} : { plainText: input.plainText }),
      ...(input.initialText === undefined
        ? {}
        : { initialText: input.initialText }),
      ...(input.createBlockId === undefined
        ? {}
        : { createBlockId: input.createBlockId }),
      reservedBlockIds: new Set(Object.keys(graph.blocks) as BlockId[]),
    });
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const textDeletion =
    source && !replacing && input.sourceTextRange
      ? textDeletionRange(
          source,
          input.sourceTextRange,
          input.graphRevision,
          input.expectedContentVersion ?? source.contentVersion,
        )
      : null;
  const selection = resolveCreationSelection(input, creation);
  if (!selection.ok) return selection;
  const result = input.editor.transaction(() => {
    if (replacing && source) {
      // Keep a valid staged root while replacing the final live root.
      input.editor.insertBlocks(input.placement, creation.fragment);
      input.editor.deleteBlocks({
        blockIds: [source.id],
        includeDescendants: true,
        expectedParents: { [source.id]: source.parentId },
      });
    } else {
      if (textDeletion) input.editor.deleteRange(textDeletion);
      input.editor.insertBlocks(input.placement, creation.fragment);
    }
    input.editor.setTransactionSelection(selection.selection);
  });
  if (!result.ok || !result.changed) {
    return {
      ok: false,
      message: result.ok ? "The insertion made no change." : result.message,
      transactionAttempted: true,
    };
  }
  return {
    ok: true,
    rootBlockId: creation.rootBlockId,
    selectionBlockId: creation.selectionBlockId,
    changedBlockIds: [
      ...(source ? [source.id] : []),
      ...creation.fragment.blocks.map((block) => block.id),
    ],
    transaction: result,
  };
}

function resolveCreationSelection(
  input: CanonicalBlockCreationAtPlacementInput,
  creation: ReturnType<typeof materializeCanonicalBlockCreation>,
):
  | { readonly ok: true; readonly selection: EditorTransactionSelectionEffect }
  | { readonly ok: false; readonly message: string } {
  if (input.selection !== "created") {
    return { ok: true, selection: input.selection };
  }
  if (!creation.selectionBlockId) {
    return {
      ok: false,
      message: "Canonical creation did not produce a selection target.",
    };
  }
  return resolveCanonicalCreationSelection(
    creation.fragment,
    input.blockDefinitions,
    {
      selectionBlockId: creation.selectionBlockId,
      ...(input.selectionOffset === undefined
        ? {}
        : { selectionOffset: input.selectionOffset }),
    },
  );
}

function textDeletionRange(
  block: VersionedBlock,
  range: { readonly from: number; readonly to: number },
  graphRevision: number,
  expectedContentVersion: string | null,
): StructuralEditRange {
  return {
    graphRevision,
    selectionRevision: 0,
    blocks: [
      {
        kind: "text",
        blockId: block.id,
        blockType: block.type,
        parentId: block.parentId,
        from: range.from,
        to: range.to,
        expectedContentVersion,
      },
    ],
    start: { kind: "text", blockId: block.id, offset: range.from },
    end: { kind: "text", blockId: block.id, offset: range.to },
  };
}

export function readPublicEditorGraph(
  editor: Pick<
    EditorDocumentRuntime,
    "getBlock" | "getChildBlockIds" | "getRootBlockIds"
  >,
): {
  readonly blocks: Readonly<Record<BlockId, VersionedBlock>>;
  readonly rootBlockIds: readonly BlockId[];
  readonly childIdsByParentId: Readonly<
    Partial<Record<BlockId, readonly BlockId[]>>
  >;
} {
  const rootBlockIds = [...editor.getRootBlockIds()];
  const blocks: Partial<Record<BlockId, VersionedBlock>> = {};
  const childIdsByParentId: Partial<Record<BlockId, readonly BlockId[]>> = {};
  const pending = [...rootBlockIds].reverse();
  const visited = new Set<BlockId>();
  while (pending.length > 0) {
    const blockId = pending.pop()!;
    if (visited.has(blockId)) continue;
    visited.add(blockId);
    const block = editor.getBlock(blockId);
    if (!block || block.tombstone) continue;
    blocks[blockId] = block;
    const childIds = [...editor.getChildBlockIds(blockId)];
    if (childIds.length > 0) childIdsByParentId[blockId] = childIds;
    for (let index = childIds.length - 1; index >= 0; index -= 1) {
      pending.push(childIds[index]!);
    }
  }
  return {
    blocks: blocks as Readonly<Record<BlockId, VersionedBlock>>,
    rootBlockIds,
    childIdsByParentId,
  };
}

export function readDirectBlockIds(
  editor: Pick<EditorDocumentRuntime, "getChildBlockIds" | "getRootBlockIds">,
  parentId: BlockId | null,
): readonly BlockId[] {
  return parentId === null
    ? editor.getRootBlockIds()
    : editor.getChildBlockIds(parentId);
}
