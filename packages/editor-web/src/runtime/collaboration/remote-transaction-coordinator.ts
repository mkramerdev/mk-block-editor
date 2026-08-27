import {
  EditorImmutableBinary,
  extractPlainTextFromRichTextDocument,
} from "@repo/editor-core/content/rich-text";
import type { BlockType, VersionedBlock } from "@repo/editor-core/document";
import { validateStructuralDocument } from "@repo/editor-core/editing";
import {
  isStructuralKey,
  type BlockId,
  type JsonObject,
} from "@repo/editor-core/kernel";
import {
  applyBlockMetadataUpdates,
  validateUpdateBlockMetadataOperation,
} from "@repo/editor-core/metadata";
import {
  isContentCommitRejection,
  type EditorContentBaseToken,
  type EditorLogicalBlockMetadataOperation,
  type ValidatedContentCommit,
} from "@repo/editor-core/operations";
import {
  type EditorSelectionGraphReader,
  type SelectionController,
} from "@repo/editor-react/selection";
import type { EditorContentRuntime } from "@repo/editor-core/content";
import type { EditableEditorDefinition } from "../definition/contracts.ts";
import type { AdditionalSelectionManager } from "./additional-selection-manager.ts";
import type {
  RemoteEditorTransaction,
  RemoteTransactionResult,
  RemoteTransactionSelectionResult,
} from "./contracts.ts";

export interface RemoteCanonicalState {
  readonly blockGraphVersion: number;
  readonly blocks: Readonly<Record<BlockId, VersionedBlock>>;
  readonly rootBlockIds: readonly BlockId[];
  readonly childIdsByParentId: Readonly<
    Partial<Record<BlockId, readonly BlockId[]>>
  >;
}

interface PreparedRemoteCanonicalTransaction {
  readonly nextState: RemoteCanonicalState;
  readonly validatedContent: ValidatedContentCommit;
  readonly changedBlockIds: readonly BlockId[];
  readonly contentChangedBlockIds: readonly BlockId[];
}

export interface RemoteTransactionCanonicalHost extends EditorSelectionGraphReader {
  readonly definition: EditableEditorDefinition;
  readonly contentRuntime: EditorContentRuntime;
  readonly selectionController: SelectionController;
  getSelectionGraphRevision(): number;
  isDisposed(): boolean;
  readRemoteCanonicalState(): RemoteCanonicalState;
  commitValidatedRemoteTransaction(input: {
    readonly nextState: RemoteCanonicalState;
    readonly validatedContent: ValidatedContentCommit;
    readonly changedBlockIds: readonly BlockId[];
    readonly contentChangedBlockIds: readonly BlockId[];
    readonly afterCanonicalStateInstalled: () => void;
  }): number;
}

export interface RemoteTransactionCoordinator {
  applyRemoteTransaction(
    transaction: RemoteEditorTransaction,
  ): RemoteTransactionResult;
}

export function createRemoteTransactionCoordinator(input: {
  readonly host: RemoteTransactionCanonicalHost;
  readonly additionalSelections: AdditionalSelectionManager;
}): RemoteTransactionCoordinator {
  return Object.freeze({
    applyRemoteTransaction(
      envelope: RemoteEditorTransaction,
    ): RemoteTransactionResult {
      const host = input.host;
      if (host.isDisposed())
        return rejected("editor-disposed", "Editor is disposed");
      const decoded = decodeContentTransaction(
        envelope.transaction,
        host.definition,
        host.contentRuntime.format,
        host.contentRuntime.operationVersion,
      );
      if (!decoded.ok) return rejected("invalid-transaction", decoded.message);

      const prepared = prepareRemoteCanonicalTransaction(host, decoded.value);
      if (!prepared.ok) return rejected("preparation-failed", prepared.message);
      let authorSelection: RemoteTransactionSelectionResult | null = null;
      try {
        host.commitValidatedRemoteTransaction({
          ...prepared.value,
          afterCanonicalStateInstalled: () => {
            authorSelection = applyAuthorSelection(
              input.additionalSelections,
              envelope.authorSelection,
            );
          },
        });
        if (!authorSelection) {
          throw new Error(
            "Remote transaction host did not install author selection state.",
          );
        }
        return {
          status: "applied",
          changedBlockIds: prepared.value.changedBlockIds,
          authorSelection,
        };
      } catch (error) {
        return rejected("commit-failed", errorMessage(error));
      }
    },
  });
}

function applyAuthorSelection(
  manager: AdditionalSelectionManager,
  sidecar: RemoteEditorTransaction["authorSelection"],
): RemoteTransactionSelectionResult {
  if (sidecar.kind === "no-author-selection") {
    manager.reResolve();
    return { status: "ignored-no-author" };
  }
  return manager.reconcileAndApplyTransactionSelection({
    subject: sidecar.subject,
    selectionRevision: sidecar.selectionRevision,
    selection: sidecar.selectionAfter,
  });
}

function prepareRemoteCanonicalTransaction(
  host: RemoteTransactionCanonicalHost,
  transaction: DecodedContentTransaction,
):
  | { readonly ok: true; readonly value: PreparedRemoteCanonicalTransaction }
  | { readonly ok: false; readonly message: string } {
  const current = host.readRemoteCanonicalState();
  let graph: Omit<RemoteCanonicalState, "blockGraphVersion"> = {
    blocks: current.blocks,
    rootBlockIds: current.rootBlockIds,
    childIdsByParentId: current.childIdsByParentId,
  };
  const changed = new Set<BlockId>();
  try {
    if (transaction.graph) {
      graph = applyStableGraphDelta(graph, transaction.graph, changed);
    }
    if (transaction.metadata) {
      const metadata = applyBlockMetadataUpdates({
        operation: transaction.metadata,
        blocks: graph.blocks,
        blockDefinitions: host.definition.blocks,
        getDirectChildIds: (blockId) =>
          graph.childIdsByParentId[blockId] ?? emptyBlockIds,
      });
      if (!metadata.ok)
        return { ok: false, message: metadata.errors.join("; ") };
      graph = { ...graph, blocks: metadata.blocks };
      metadata.affectedBlockIds.forEach((blockId) => changed.add(blockId));
    }
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }

  const resultingGraphRevision = current.blockGraphVersion + 1;
  const introducedBlocks: Partial<Record<BlockId, BlockType>> = {};
  const removedBlockIds: BlockId[] = [];
  for (const [blockId, block] of Object.entries(graph.blocks) as [
    BlockId,
    VersionedBlock,
  ][]) {
    const before = current.blocks[blockId];
    if (
      !block.tombstone &&
      (!before || before.tombstone) &&
      host.definition.blocks[block.type]?.kind === "text"
    ) {
      introducedBlocks[blockId] = block.type;
    }
  }
  for (const [blockId, block] of Object.entries(current.blocks) as [
    BlockId,
    VersionedBlock,
  ][]) {
    if (
      !block.tombstone &&
      graph.blocks[blockId]?.tombstone &&
      host.definition.blocks[block.type]?.kind === "text"
    ) {
      removedBlockIds.push(blockId);
    }
  }

  let updates: readonly {
    readonly base: EditorContentBaseToken;
    readonly update: DecodedContentUpdate["update"];
    readonly readProjection: DecodedContentUpdate["readProjection"];
  }[];
  try {
    updates = transaction.content.map((candidate) => {
      const target = graph.blocks[candidate.blockId];
      if (
        !target ||
        target.tombstone ||
        target.type !== candidate.blockType ||
        host.definition.blocks[target.type]?.kind !== "text"
      ) {
        throw new Error(
          `Remote content targets unavailable text block ${candidate.blockId}`,
        );
      }
      const before = current.blocks[candidate.blockId];
      const base =
        before && !before.tombstone
          ? host.contentRuntime.readContentBaseToken(
              candidate.blockId,
              candidate.blockType,
              current.blockGraphVersion,
            )
          : {
              graphRevision: current.blockGraphVersion,
              blockId: candidate.blockId,
              blockType: candidate.blockType,
              contentRevision: 0,
            };
      return {
        base,
        update: candidate.update,
        readProjection: candidate.readProjection,
      };
    });
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }

  const validated = host.contentRuntime.validateRemoteContentCommit({
    graphRevision: current.blockGraphVersion,
    resultingGraphRevision,
    updates,
    introducedBlocks,
    removedBlockIds,
    origin: Object.freeze({
      kind: "remote-editor-transaction",
      transactionId: transaction.transactionId,
    }),
  });
  if (isContentCommitRejection(validated))
    return { ok: false, message: validated.message };
  for (const candidate of transaction.content) changed.add(candidate.blockId);

  const validation = validateStructuralDocument({
    ...graph,
    blockDefinitions: host.definition.blocks,
    validators: host.definition.documentValidators,
    readContent: (blockId, blockType) => {
      const content = host.contentRuntime.readValidatedBlockContent(
        validated,
        blockId,
        blockType,
      );
      return content
        ? {
            content,
            plainText: extractPlainTextFromRichTextDocument(content),
            version: graph.blocks[blockId]?.contentVersion ?? null,
          }
        : null;
    },
  });
  if (!validation.valid)
    return {
      ok: false,
      message: validation.issues.map((issue) => issue.message).join("; "),
    };
  if (changed.size === 0)
    return {
      ok: false,
      message: "Remote transaction contains no semantic changes",
    };

  return {
    ok: true,
    value: {
      nextState: { blockGraphVersion: resultingGraphRevision, ...graph },
      validatedContent: validated,
      changedBlockIds: Object.freeze([...changed]),
      contentChangedBlockIds: validated.affectedBlockIds,
    },
  };
}

interface StablePlacement {
  readonly parentId: BlockId | null;
  readonly previousSiblingId: BlockId | null;
  readonly nextSiblingId: BlockId | null;
}
type StableChange =
  | {
      readonly kind: "create";
      readonly blockId: BlockId;
      readonly blockType: BlockType;
      readonly placement: StablePlacement;
      readonly initialMetadata?: JsonObject;
    }
  | {
      readonly kind: "move" | "restore";
      readonly blockId: BlockId;
      readonly placement: StablePlacement;
    }
  | { readonly kind: "delete"; readonly blockId: BlockId }
  | {
      readonly kind: "change-type";
      readonly blockId: BlockId;
      readonly blockType: BlockType;
    };

function applyStableGraphDelta(
  current: Omit<RemoteCanonicalState, "blockGraphVersion">,
  changes: readonly StableChange[],
  changed: Set<BlockId>,
): Omit<RemoteCanonicalState, "blockGraphVersion"> {
  const blocks = { ...current.blocks } as Record<BlockId, VersionedBlock>;
  let roots = [...current.rootBlockIds];
  const children = Object.fromEntries(
    Object.entries(current.childIdsByParentId).map(([id, ids]) => [
      id,
      [...(ids ?? [])],
    ]),
  ) as Record<BlockId, BlockId[]>;
  const sequence = (parentId: BlockId | null): BlockId[] =>
    parentId === null ? roots : (children[parentId] ??= []);
  const detach = (blockId: BlockId) => {
    roots = roots.filter((id) => id !== blockId);
    for (const ids of Object.values(children)) {
      const index = ids.indexOf(blockId);
      if (index >= 0) ids.splice(index, 1);
    }
  };
  const insert = (blockId: BlockId, placement: StablePlacement) => {
    detach(blockId);
    const ids = sequence(placement.parentId);
    let index: number;
    if (placement.previousSiblingId !== null) {
      index = ids.indexOf(placement.previousSiblingId) + 1;
      if (index === 0)
        throw new Error("Previous sibling anchor is unavailable");
      if (
        placement.nextSiblingId !== null &&
        ids[index] !== placement.nextSiblingId
      )
        throw new Error("Sibling anchors are not adjacent");
    } else if (placement.nextSiblingId !== null) {
      index = ids.indexOf(placement.nextSiblingId);
      if (index < 0) throw new Error("Next sibling anchor is unavailable");
    } else {
      index = ids.length;
    }
    ids.splice(index, 0, blockId);
  };
  for (const change of changes) {
    const existing = blocks[change.blockId];
    if (change.kind === "create") {
      if (existing)
        throw new Error(`Created block ${change.blockId} already exists`);
      if (
        change.placement.parentId !== null &&
        (!blocks[change.placement.parentId] ||
          blocks[change.placement.parentId]!.tombstone)
      )
        throw new Error("Created block parent is unavailable");
      blocks[change.blockId] = {
        id: change.blockId,
        type: change.blockType,
        parentId: change.placement.parentId,
        tombstone: null,
        ...(change.initialMetadata ? { metadata: change.initialMetadata } : {}),
        metadataVersion: "1",
        contentVersion: null,
      };
      insert(change.blockId, change.placement);
    } else if (!existing) {
      throw new Error(`Graph target ${change.blockId} is unavailable`);
    } else if (change.kind === "delete") {
      detach(change.blockId);
      blocks[change.blockId] = {
        ...existing,
        tombstone: { deletedAt: Date.now(), reason: "user-delete" },
      };
    } else if (change.kind === "change-type") {
      if (existing.tombstone)
        throw new Error("Cannot change the type of a deleted block");
      blocks[change.blockId] = { ...existing, type: change.blockType };
    } else {
      if (
        change.placement.parentId !== null &&
        (!blocks[change.placement.parentId] ||
          blocks[change.placement.parentId]!.tombstone)
      )
        throw new Error("Graph placement parent is unavailable");
      blocks[change.blockId] = {
        ...existing,
        parentId: change.placement.parentId,
        tombstone: null,
      };
      insert(change.blockId, change.placement);
    }
    changed.add(change.blockId);
  }
  for (const [blockId, block] of Object.entries(blocks) as [
    BlockId,
    VersionedBlock,
  ][]) {
    if (block.tombstone && children[blockId]?.length === 0)
      delete children[blockId];
  }
  return {
    blocks: Object.freeze(blocks),
    rootBlockIds: Object.freeze(roots),
    childIdsByParentId: Object.freeze(
      Object.fromEntries(
        Object.entries(children).map(([id, ids]) => [id, Object.freeze(ids)]),
      ),
    ),
  };
}

interface DecodedContentUpdate {
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly update: import("@repo/editor-core/content/rich-text").EditorContentOperationUpdate;
  readonly readProjection: import("@repo/editor-core/content/rich-text").RichTextDocumentNodeJson;
}
interface DecodedContentTransaction {
  readonly transactionId: string;
  readonly graph: readonly StableChange[] | null;
  readonly metadata: EditorLogicalBlockMetadataOperation | null;
  readonly content: readonly DecodedContentUpdate[];
}

function decodeContentTransaction(
  value: unknown,
  definition: EditableEditorDefinition,
  contentFormat: string,
  contentVersion: number,
):
  | { readonly ok: true; readonly value: DecodedContentTransaction }
  | { readonly ok: false; readonly message: string } {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "transactionId",
      "historyAction",
      "graph",
      "metadata",
      "content",
    ])
  )
    return { ok: false, message: "Remote content transaction is malformed" };
  if (
    typeof value.transactionId !== "string" ||
    value.transactionId.length === 0
  )
    return { ok: false, message: "Remote transaction id is invalid" };
  if (
    value.historyAction !== "command" &&
    value.historyAction !== "undo" &&
    value.historyAction !== "redo"
  ) {
    return {
      ok: false,
      message: "Remote transaction history action is invalid",
    };
  }
  const graph = decodeStableGraph(value.graph, definition);
  if (!graph.ok) return graph;
  let metadata: EditorLogicalBlockMetadataOperation | null = null;
  if (value.metadata !== null) {
    const validation = validateUpdateBlockMetadataOperation(value.metadata);
    if (!validation.valid)
      return { ok: false, message: validation.errors.join("; ") };
    metadata = value.metadata as EditorLogicalBlockMetadataOperation;
  }
  if (!Array.isArray(value.content))
    return { ok: false, message: "Remote content updates must be an array" };
  const content: DecodedContentUpdate[] = [];
  const targets = new Set<string>();
  for (const candidate of value.content) {
    if (
      !isRecord(candidate) ||
      typeof candidate.blockId !== "string" ||
      !isStructuralKey(candidate.blockId) ||
      typeof candidate.blockType !== "string" ||
      !definition.blocks[candidate.blockType as BlockType] ||
      !isRecord(candidate.readProjection)
    ) {
      return { ok: false, message: "Remote content update is malformed" };
    }
    if (targets.has(candidate.blockId))
      return {
        ok: false,
        message: `Duplicate remote content update for ${candidate.blockId}`,
      };
    targets.add(candidate.blockId);
    const payload = decodeRemoteContentPayload(
      candidate,
      contentFormat,
      contentVersion,
    );
    if (!payload.ok) return payload;
    content.push({
      blockId: candidate.blockId as BlockId,
      blockType: candidate.blockType as BlockType,
      update: {
        kind: "operation",
        format: contentFormat,
        version: contentVersion,
        payload: payload.payload,
      },
      readProjection:
        candidate.readProjection as import("@repo/editor-core/content/rich-text").RichTextDocumentNodeJson,
    });
  }
  if (graph.value === null && metadata === null && content.length === 0)
    return {
      ok: false,
      message: "Remote transaction contains no semantic content",
    };
  return {
    ok: true,
    value: {
      transactionId: value.transactionId,
      graph: graph.value,
      metadata,
      content: Object.freeze(content),
    },
  };
}

function decodeRemoteContentPayload(
  candidate: Record<string, unknown>,
  contentFormat: string,
  contentVersion: number,
):
  | { readonly ok: true; readonly payload: EditorImmutableBinary }
  | { readonly ok: false; readonly message: string } {
  if (
    hasExactKeys(candidate, [
      "blockId",
      "blockType",
      "update",
      "readProjection",
    ])
  ) {
    const update = candidate.update;
    if (
      !isRecord(update) ||
      !hasExactKeys(update, ["kind", "format", "version", "payload"]) ||
      update.kind !== "operation" ||
      update.format !== contentFormat ||
      update.version !== contentVersion ||
      !(update.payload instanceof EditorImmutableBinary) ||
      update.payload.byteLength === 0
    ) {
      return {
        ok: false,
        message: "Remote binary content update is malformed",
      };
    }
    return { ok: true, payload: update.payload };
  }
  return { ok: false, message: "Remote content update is malformed" };
}

function decodeStableGraph(
  value: unknown,
  definition: EditableEditorDefinition,
):
  | { readonly ok: true; readonly value: readonly StableChange[] | null }
  | { readonly ok: false; readonly message: string } {
  if (value === null) return { ok: true, value: null };
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["changes"]) ||
    !Array.isArray(value.changes) ||
    value.changes.length === 0
  )
    return { ok: false, message: "Remote graph delta is malformed" };
  for (const change of value.changes) {
    if (
      !isRecord(change) ||
      typeof change.kind !== "string" ||
      typeof change.blockId !== "string" ||
      !isStructuralKey(change.blockId)
    )
      return { ok: false, message: "Remote graph change is malformed" };
    if (change.kind === "create" || change.kind === "change-type") {
      if (
        typeof change.blockType !== "string" ||
        !definition.blocks[change.blockType as BlockType]
      )
        return { ok: false, message: "Remote graph block type is invalid" };
    }
    if (
      change.kind === "create" ||
      change.kind === "move" ||
      change.kind === "restore"
    ) {
      if (!validPlacement(change.placement))
        return { ok: false, message: "Remote graph placement is malformed" };
    } else if (change.kind !== "delete" && change.kind !== "change-type")
      return { ok: false, message: "Remote graph change kind is invalid" };
  }
  return { ok: true, value: value.changes as readonly StableChange[] };
}

function validPlacement(value: unknown): value is StablePlacement {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["parentId", "previousSiblingId", "nextSiblingId"]) &&
    [value.parentId, value.previousSiblingId, value.nextSiblingId].every(
      (id) => id === null || (typeof id === "string" && isStructuralKey(id)),
    )
  );
}

function rejected(
  reason: Extract<RemoteTransactionResult, { status: "rejected" }>["reason"],
  message: string,
): Extract<RemoteTransactionResult, { status: "rejected" }> {
  return {
    status: "rejected",
    reason,
    message,
    authorSelection: { status: "not-processed" },
  };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  );
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
const emptyBlockIds = Object.freeze([]) as readonly BlockId[];
