import {
  isRichTextDocument,
  richTextBlockInlineContent,
  richTextDocumentContentSize,
  type RichTextDocumentNodeJson,
} from "../../content/rich-text/rich-inline-content.ts";
import type { BlockDefinition } from "../../definitions/block-definition.ts";
import {
  blockDefinitionAcceptsSequence,
  resolveRestorativeDefault,
} from "../../definitions/structural-queries.ts";
import type { BlockType, VersionedBlock } from "../../document/model/block.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";
import type { CanonicalBlockRecord } from "../canonical-fragment.ts";
import { planBlockTreeCreation } from "../block-editing/creation-planner.ts";
import { findCanonicalMergeTarget } from "../boundary/canonical-navigation.ts";
import { insertBlocks } from "../transactions/primitives/insert-blocks.ts";
import { moveBlocks } from "../transactions/primitives/move-blocks.ts";
import { removeBlocks } from "../transactions/primitives/remove-blocks.ts";
import { appendTextBlockContent } from "../transactions/primitives/append-text-block-content.ts";
import { setSelection } from "../transactions/primitives/set-selection.ts";
import type {
  StructuralTransactionOperation,
  StructuralTransactionPlan,
  TransactionReadableContent,
} from "../transactions/types.ts";

export interface PlanBlockBoundaryDeleteInput {
  readonly selectionBlockId: BlockId;
  readonly selection: { readonly from: number; readonly to: number };
  readonly content: {
    readonly content: RichTextDocumentNodeJson;
    readonly plainText: string;
    readonly version: string | null;
  };
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
  readonly createBlockId?: () => BlockId;
}

export type PlanBlockBoundaryDeleteResult =
  | {
      readonly ok: true;
      readonly handled: true;
      readonly plan: StructuralTransactionPlan;
    }
  | {
      readonly ok: true;
      readonly handled: false;
      readonly reason: "no-next-target";
    }
  | {
      readonly ok: false;
      readonly reason:
        | "missing-block"
        | "not-text"
        | "invalid-content"
        | "invalid-selection"
        | "local-content-route-required"
        | "stale-content"
        | "invalid-compound"
        | "invalid-result";
      readonly message: string;
    };

export function planBlockBoundaryDelete(
  input: PlanBlockBoundaryDeleteInput,
): PlanBlockBoundaryDeleteResult {
  try {
    const survivor = liveBlock(input.blocks, input.selectionBlockId);
    if (!survivor)
      return failure("missing-block", "focused block is unavailable");
    const definition = input.blockDefinitions[survivor.type];
    if (definition?.kind !== "text") {
      return failure("not-text", "focused block is not editable text");
    }
    if (!isRichTextDocument(input.content.content)) {
      return failure(
        "invalid-content",
        "focused block content is not rich text",
      );
    }
    if (survivor.contentVersion !== input.content.version) {
      return failure("stale-content", "focused block content version changed");
    }
    const size = richTextDocumentContentSize(input.content.content);
    const { from, to } = input.selection;
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 0 ||
      to < from ||
      to > size
    ) {
      return failure(
        "invalid-selection",
        "selection is outside the focused block",
      );
    }
    if (from !== size || to !== size) {
      return failure(
        "local-content-route-required",
        "same-block Delete must be handled by the block-local content runtime",
      );
    }
    const target = findCanonicalMergeTarget(
      {
        originBlockId: survivor.id,
        blocks: input.blocks,
        rootBlockIds: input.rootBlockIds,
        childIdsByParentId: input.childIdsByParentId,
        blockDefinitions: input.blockDefinitions,
        readContent: input.readContent,
      },
      "next",
    );
    if (!target.ok) {
      return { ok: true, handled: false, reason: "no-next-target" };
    }
    const donor = liveBlock(input.blocks, target.blockId);
    if (!donor) return failure("missing-block", "merge target is unavailable");
    const cleanup = planForwardCleanup(input, donor);
    const operations: StructuralTransactionOperation[] = [
      appendTextBlockContent({
        destinationBlockId: survivor.id,
        sourceBlockId: donor.id,
        expectedDestinationContentVersion: survivor.contentVersion,
        expectedSourceContentVersion: target.contentVersion,
        operation: {
          kind: "insertInlineContent",
          blockId: survivor.id,
          blockType: survivor.type,
          target: { kind: "text" },
          position: { blockId: survivor.id, offset: size },
          content: richTextBlockInlineContent(target.content),
        },
      }),
      ...cleanup.operations,
      setSelection({
        kind: "text-offset",
        blockId: survivor.id,
        offset: size,
      }),
    ];
    const expectedBlocks = uniqueBlocks([
      survivor,
      donor,
      ...cleanup.expectations,
    ]);
    return {
      ok: true,
      handled: true,
      plan: {
        origin: "generic-delete",
        operations,
        preconditions: {
          blocks: expectedBlocks.map((block) => ({
            blockId: block.id,
            type: block.type,
            parentId: block.parentId,
          })),
          contentVersions: {
            [survivor.id]: input.content.version,
            [donor.id]: target.contentVersion,
          },
        },
      },
    };
  } catch (error) {
    return failure(
      "invalid-result",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function planForwardCleanup(
  input: PlanBlockBoundaryDeleteInput,
  donor: VersionedBlock,
): {
  readonly operations: readonly StructuralTransactionOperation[];
  readonly expectations: readonly VersionedBlock[];
} {
  const compound = compoundPrimaryContext(input, donor);
  if (compound) {
    const promoted = liveChildren(input, compound.contentWrapper.id);
    const siblings = liveChildren(input, compound.wrapper.parentId);
    const wrapperIndex = siblings.findIndex(
      (block) => block.id === compound.wrapper.id,
    );
    if (wrapperIndex < 0) throw new Error("compound wrapper is not canonical");
    if (compound.wrapper.parentId !== null) {
      const parent = liveBlock(input.blocks, compound.wrapper.parentId);
      const parentDefinition = parent
        ? input.blockDefinitions[parent.type]
        : undefined;
      const finalTypes = [
        ...siblings.slice(0, wrapperIndex).map((block) => block.type),
        ...promoted.map((block) => block.type),
        ...siblings.slice(wrapperIndex + 1).map((block) => block.type),
      ];
      if (
        !parentDefinition ||
        !blockDefinitionAcceptsSequence(
          input.blockDefinitions,
          parentDefinition,
          finalTypes,
        )
      ) {
        throw new Error("compound promotion violates destination content");
      }
    }
    return {
      operations: [
        ...(promoted.length === 0
          ? []
          : [
              moveBlocks({
                blockIds: promoted.map((block) => block.id),
                sourcePlacement: {
                  parentId: compound.contentWrapper.id,
                  childIndex: 0,
                },
                destinationPlacement: {
                  parentId: compound.wrapper.parentId,
                  childIndex: wrapperIndex,
                },
              }),
            ]),
        removeBlocks({
          blockIds: [compound.wrapper.id],
          includeDescendants: true,
          expectedParents: {
            [compound.wrapper.id]: compound.wrapper.parentId,
          },
        }),
      ],
      expectations: [compound.wrapper, compound.contentWrapper, ...promoted],
    };
  }

  const expectations: VersionedBlock[] = [donor];
  let removalRoot = donor;
  let parent = donor.parentId ? liveBlock(input.blocks, donor.parentId) : null;
  while (parent) {
    expectations.push(parent);
    const definition = input.blockDefinitions[parent.type];
    if (definition?.kind !== "wrapper") {
      throw new Error(`cleanup parent ${parent.type} is not a wrapper`);
    }
    const remaining = liveChildren(input, parent.id).filter(
      (child) => child.id !== removalRoot.id,
    );
    if (
      blockDefinitionAcceptsSequence(
        input.blockDefinitions,
        definition,
        remaining.map((child) => child.type),
      )
    ) {
      break;
    }
    const restorativeDefault = resolveRestorativeDefault(
      input.blockDefinitions,
      definition,
    );
    if (remaining.length === 0 && restorativeDefault) {
      const creation = planBlockTreeCreation({
        blockDefinitions: input.blockDefinitions,
        type: restorativeDefault.defaultType,
        parentId: parent.id,
        selection: false,
        ...(input.createBlockId ? { createBlockId: input.createBlockId } : {}),
        reservedBlockIds: new Set(Object.keys(input.blocks) as BlockId[]),
      });
      const records = creation.nodes.map(
        (node): CanonicalBlockRecord => ({
          id: node.id,
          type: node.type,
          parentId: node.parentId,
          ...(node.metadata === undefined ? {} : { metadata: node.metadata }),
        }),
      );
      return {
        operations: [
          removeBlocks({
            blockIds: [removalRoot.id],
            includeDescendants: true,
            expectedParents: { [removalRoot.id]: removalRoot.parentId },
          }),
          insertBlocks({
            placement: { parentId: parent.id, childIndex: 0 },
            blocks: records,
          }),
        ],
        expectations,
      };
    }
    removalRoot = parent;
    parent = parent.parentId ? liveBlock(input.blocks, parent.parentId) : null;
  }
  return {
    operations: [
      removeBlocks({
        blockIds: [removalRoot.id],
        includeDescendants: true,
        expectedParents: { [removalRoot.id]: removalRoot.parentId },
      }),
    ],
    expectations,
  };
}

function compoundPrimaryContext(
  input: PlanBlockBoundaryDeleteInput,
  donor: VersionedBlock,
): {
  readonly wrapper: VersionedBlock;
  readonly contentWrapper: VersionedBlock;
} | null {
  const wrapper = donor.parentId
    ? liveBlock(input.blocks, donor.parentId)
    : null;
  if (!wrapper) return null;
  const definition = input.blockDefinitions[wrapper.type];
  const policy =
    definition?.kind === "wrapper" ? definition.compound : undefined;
  if (!policy || donor.type !== policy.primaryTextChildType) return null;
  const children = liveChildren(input, wrapper.id);
  const contentWrapper = children[1];
  if (
    children[0]?.id !== donor.id ||
    !contentWrapper ||
    contentWrapper.type !== policy.contentWrapperChildType
  ) {
    throw new Error(`compound wrapper ${wrapper.id} is invalid`);
  }
  return { wrapper, contentWrapper };
}

function liveChildren(
  input: PlanBlockBoundaryDeleteInput,
  parentId: BlockId | null,
): readonly VersionedBlock[] {
  const ids =
    parentId === null
      ? input.rootBlockIds
      : (input.childIdsByParentId[parentId] ?? []);
  return ids
    .map((id) => input.blocks[id])
    .filter((block): block is VersionedBlock =>
      Boolean(block && !block.tombstone),
    );
}

function liveBlock(
  blocks: Readonly<Record<BlockId, VersionedBlock>>,
  blockId: BlockId,
): VersionedBlock | null {
  const block = blocks[blockId];
  return block && !block.tombstone ? block : null;
}

function uniqueBlocks(values: readonly VersionedBlock[]): VersionedBlock[] {
  return [...new Map(values.map((value) => [value.id, value])).values()];
}

function failure(
  reason: Extract<PlanBlockBoundaryDeleteResult, { ok: false }>["reason"],
  message: string,
): PlanBlockBoundaryDeleteResult {
  return { ok: false, reason, message };
}
