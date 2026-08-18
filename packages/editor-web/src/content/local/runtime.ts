import type { BlockDefinition } from "@repo/editor-core/definitions";
import type { BlockId } from "@repo/editor-core/kernel";
import { cloneJsonValue, jsonValuesEqual } from "@repo/editor-core/kernel";
import type { BlockType } from "@repo/editor-core/document";
import type { EditorLogicalContentOperation } from "@repo/editor-core/operations";
import {
  richTextBlockInlineContent,
  EditorImmutableBinary,
  type RichTextDocumentNodeJson,
} from "@repo/editor-core/content/rich-text";
import {
  prepareLogicalContentOperations,
  ownPublishedLogicalContentOperations,
  validateContentCommitInput,
  type PreparedLogicalContentOperations,
} from "@repo/editor-core/operations";
import {
  isRichTextDocument,
  normalizeRichTextDocument,
  richTextDocumentContentSize,
  richInlineNodeSize,
} from "@repo/editor-core/content/rich-text";
import { assertValidBlockGraphVersion } from "@repo/editor-core/document";
import type {
  AppliedContentBlock,
  AppliedContentCommit,
  ContentCommitRejection,
  EditorContentBaseToken,
  EditorContentCheckpoint,
  EditorContentCommitChange,
  EditorContentOperationUpdate,
  ValidatedContentCommit,
} from "@repo/editor-react/editor";
import type {
  EditorContentStoreRuntimeOptions,
  EditorContentStoreSlot,
  EditorRawBlockContent,
  EditorBlockContentLease,
} from "../../runtime/content/content-runtime.ts";
import {
  LOCAL_CONTENT_FORMAT,
  LOCAL_CONTENT_FORMAT_VERSION,
  type LocalContentRuntime,
} from "./contracts.ts";
import {
  cloneContent,
  defaultContentForBlockType,
  plainTextForContent,
  readReconciliationProjection,
  readSourceBlockTypes,
  readSourceContent,
} from "./projections.ts";

interface ValidatedBlockState {
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly baseToken: EditorContentBaseToken;
  readonly before: EditorRawBlockContent;
  readonly after: EditorRawBlockContent;
  readonly contentOperations: readonly EditorLogicalContentOperation[];
  readonly inverseContentOperations: readonly EditorLogicalContentOperation[];
  readonly operationUpdate: EditorContentOperationUpdate;
  readonly introduced: boolean;
  readonly restoresAnchorLineage: boolean;
}

interface ValidatedRemovedBlockState {
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly content: EditorRawBlockContent;
  readonly contentRevision: number;
  readonly inverseContentOperations: readonly EditorLogicalContentOperation[];
}

interface ValidatedState {
  status: "validated" | "applied" | "failed";
  readonly graphRevision: number;
  readonly resultingGraphRevision: number;
  readonly blocks: readonly ValidatedBlockState[];
  readonly removedBlocks: readonly ValidatedRemovedBlockState[];
  readonly origin: unknown;
}

interface AppliedState {
  status: "applied" | "released";
  readonly validated: ValidatedState;
}

interface LocalOperationTextAnchor {
  readonly kind: "local-operation-anchor";
  readonly version: 1;
  readonly epoch: number;
  readonly revision: number;
  readonly offset: number;
  readonly assoc: -1 | 0 | 1;
}

const LOCAL_OPERATION_TEXT_ANCHOR_CODEC = "local-operation-position";

interface LocalAnchorTombstone {
  readonly blockType: BlockType;
  readonly content: EditorRawBlockContent;
}

export const localBlockContentStore: EditorContentStoreSlot = {
  format: LOCAL_CONTENT_FORMAT,
  createRuntime(options) {
    return createLocalBlockContentStoreRuntime(options);
  },
};

export function encodeLocalContentCheckpoint(
  content: RichTextDocumentNodeJson,
): EditorContentCheckpoint {
  return ownCheckpoint(encodeJsonEnvelope("checkpoint", content));
}

export function decodeLocalContentCheckpoint(
  checkpoint: EditorContentCheckpoint,
): RichTextDocumentNodeJson {
  assertLocalEnvelope(checkpoint, "checkpoint");
  const decoded = decodeJsonPayload(checkpoint.payload);
  if (!isRichTextDocument(decoded)) {
    throw new Error("Local content checkpoint payload is not rich text");
  }
  return cloneContent(decoded);
}

export function decodeLocalContentOperationUpdate(
  update: EditorContentOperationUpdate,
): readonly EditorLogicalContentOperation[] {
  assertLocalEnvelope(update, "operation");
  const decoded = decodeJsonPayload(update.payload);
  if (!isRecord(decoded) || !Array.isArray(decoded.operations)) {
    throw new Error("Local content operation payload is invalid");
  }
  return cloneJsonValue(
    decoded.operations,
  ) as unknown as readonly EditorLogicalContentOperation[];
}

function createLocalBlockContentStoreRuntime(
  options: EditorContentStoreRuntimeOptions,
): LocalContentRuntime {
  const source = options.source;
  if (!Array.isArray(source.inlineAtoms)) {
    throw new Error("Local content runtime requires inline atom definitions");
  }
  let graphRevision = source.blockGraphVersion;
  let destroyed = false;
  let nextPreparedId = 1;
  let nextAppliedId = 1;
  const blockDefinitions = source.blockDefinitions;
  const inlineMarks = source.inlineMarks;
  const inlineAtoms = source.inlineAtoms;
  const blockTypeById = new Map<BlockId, BlockType>();
  const contentById = new Map<BlockId, EditorRawBlockContent>();
  const pendingRemovalBlockIds = new Set<BlockId>();
  const contentRevisionById = new Map<BlockId, number>();
  const anchorEpochById = new Map<BlockId, number>();
  const anchorRevisionById = new Map<BlockId, number>();
  const anchorStepsById = new Map<
    BlockId,
    Map<number, readonly EditorLogicalContentOperation[]>
  >();
  const anchorTombstoneById = new Map<BlockId, LocalAnchorTombstone>();
  const liveLeaseCountById = new Map<BlockId, number>();
  let nextAnchorEpoch = 1;
  const blockListeners = new Map<
    BlockId,
    Set<(commit?: AppliedContentCommit) => void>
  >();
  const commitListeners = new Set<(commit: AppliedContentCommit) => void>();
  const validatedStates = new WeakMap<ValidatedContentCommit, ValidatedState>();
  const appliedStates = new WeakMap<AppliedContentCommit, AppliedState>();

  for (const [blockId, blockType] of Object.entries(
    readSourceBlockTypes(source),
  ) as [BlockId, BlockType][]) {
    const sourceContent = readSourceContent(source, blockId);
    const checkpoint = source.opaqueContentCheckpoints[blockId];
    if (!isTextBlockType(blockDefinitions, blockType)) {
      if (sourceContent !== undefined || checkpoint !== undefined) {
        throw new Error(
          `Block ${blockId} (${blockType}) is not text-based and cannot own content`,
        );
      }
      continue;
    }
    if (!checkpoint || sourceContent === undefined) {
      throw new Error(`Text block ${blockId} requires projection and checkpoint`);
    }
    const content = normalizeProjection(
      blockType,
      sourceContent,
      inlineMarks,
      inlineAtoms,
    );
    blockTypeById.set(blockId, blockType);
    contentById.set(blockId, content);
    contentRevisionById.set(blockId, 0);
    anchorEpochById.set(blockId, nextAnchorEpoch++);
    anchorRevisionById.set(blockId, 0);
  }

  const runtime: LocalContentRuntime = {
    format: LOCAL_CONTENT_FORMAT,
    operationVersion: LOCAL_CONTENT_FORMAT_VERSION,
    acquireBlockContent(blockId, blockType, reason) {
      requireCurrentBlock(blockId, blockType);
      liveLeaseCountById.set(blockId, (liveLeaseCountById.get(blockId) ?? 0) + 1);
      let released = false;
      const lease: EditorBlockContentLease = {
        blockId,
        blockType,
        reason,
        release() {
          if (released) return;
          released = true;
          const count = (liveLeaseCountById.get(blockId) ?? 1) - 1;
          if (count === 0) liveLeaseCountById.delete(blockId);
          else liveLeaseCountById.set(blockId, count);
        },
      };
      return lease;
    },
    readOpaqueBlockState(blockId) {
      const blockType = blockTypeById.get(blockId);
      if (!blockType) return null;
      const checkpoint = encodeLocalContentCheckpoint(contentById.get(blockId)!);
      return Object.freeze({
        kind: "checkpoint" as const,
        format: checkpoint.format,
        version: checkpoint.version,
        payloadBase64: encodeBase64(checkpoint.payload.copy()),
      });
    },
    reconcileContentData(data) {
      requireLiveRuntime();
      assertValidBlockGraphVersion(data.blockGraphVersion);
      const liveBlockIds = new Set(data.blockIds);
      const notifications = new Set<BlockId>();
      for (const blockId of [...blockTypeById.keys()]) {
        if (liveBlockIds.has(blockId)) continue;
        blockTypeById.delete(blockId);
        contentById.delete(blockId);
        contentRevisionById.delete(blockId);
        anchorEpochById.delete(blockId);
        anchorRevisionById.delete(blockId);
        anchorStepsById.delete(blockId);
        anchorTombstoneById.delete(blockId);
        notifications.add(blockId);
      }
      for (const blockId of data.blockIds) {
        const blockType = data.blockTypesById[blockId];
        if (!blockType) continue;
        const projection = readReconciliationProjection(data, blockId);
        const checkpoint = data.opaqueContentCheckpoints[blockId];
        if (!isTextBlockType(blockDefinitions, blockType)) {
          if (projection !== undefined || checkpoint !== undefined) {
            throw new Error(
              `Block ${blockId} (${blockType}) is not text-based and cannot own content`,
            );
          }
          blockTypeById.delete(blockId);
          contentById.delete(blockId);
          contentRevisionById.delete(blockId);
          anchorEpochById.delete(blockId);
          anchorRevisionById.delete(blockId);
          anchorStepsById.delete(blockId);
          anchorTombstoneById.delete(blockId);
          continue;
        }
        if (!checkpoint || projection === undefined) {
          throw new Error(`Text block ${blockId} requires projection and checkpoint`);
        }
        const next = normalizeProjection(
          blockType,
          projection,
          inlineMarks,
          inlineAtoms,
        );
        const previous = contentById.get(blockId);
        const previousType = blockTypeById.get(blockId);
        blockTypeById.set(blockId, blockType);
        contentById.set(blockId, next);
        if (previousType === undefined) {
          contentRevisionById.set(blockId, 0);
          anchorEpochById.set(blockId, nextAnchorEpoch++);
          anchorRevisionById.set(blockId, 0);
          anchorStepsById.delete(blockId);
          anchorTombstoneById.delete(blockId);
        } else if (
          previousType !== blockType ||
          !rawContentEqual(previous, next)
        ) {
          contentRevisionById.set(
            blockId,
            (contentRevisionById.get(blockId) ?? 0) + 1,
          );
          anchorEpochById.set(blockId, nextAnchorEpoch++);
          anchorRevisionById.set(blockId, 0);
          anchorStepsById.delete(blockId);
          anchorTombstoneById.delete(blockId);
          notifications.add(blockId);
        }
      }
      graphRevision = data.blockGraphVersion;
      for (const blockId of [...notifications].sort(compareBlockIds)) {
        notifyBlockContent(blockId);
      }
    },
    applyExternalContentUpdate(input) {
      requireLiveRuntime();
      assertValidBlockGraphVersion(input.blockGraphVersion);
      requireCurrentBlock(input.blockId, input.blockType);
      const next = normalizeProjection(
        input.blockType,
        input.readProjection,
        inlineMarks,
        inlineAtoms,
      );
      graphRevision = input.blockGraphVersion;
      const previous = contentById.get(input.blockId)!;
      if (rawContentEqual(previous, next)) return;
      contentById.set(input.blockId, cloneContent(next));
      contentRevisionById.set(
        input.blockId,
        (contentRevisionById.get(input.blockId) ?? 0) + 1,
      );
      anchorEpochById.set(input.blockId, nextAnchorEpoch++);
      anchorRevisionById.set(input.blockId, 0);
      anchorStepsById.delete(input.blockId);
      anchorTombstoneById.delete(input.blockId);
      notifyBlockContent(input.blockId);
    },
    readContentBaseToken(blockId, blockType, requestedGraphRevision) {
      requireLiveRuntime();
      if (requestedGraphRevision !== graphRevision) {
        throw new Error(
          `Cannot read a content base token for stale graph revision ${requestedGraphRevision}; current revision is ${graphRevision}`,
        );
      }
      requireCurrentBlock(blockId, blockType);
      return freezeBaseToken({
        graphRevision,
        blockId,
        blockType,
        contentRevision: contentRevisionById.get(blockId) ?? 0,
      });
    },
    validateContentCommit(input) {
      requireLiveRuntime();
      const inputFailure = validateContentCommitInput(input);
      if (inputFailure) return inputFailure;
      const graphFailure = validateGraphRevision(input.graphRevision);
      if (graphFailure) return graphFailure;
      const working = new Map<BlockId, EditorRawBlockContent>();
      const bases = new Map<BlockId, EditorContentBaseToken>();
      const removedBlocks: ValidatedRemovedBlockState[] = [];
      const removedBlockIds = new Set(input.removedBlockIds ?? []);
      const preparedOperationsByBlock = new Map<
        BlockId,
        Extract<PreparedLogicalContentOperations, { readonly ok: true }>
      >();
      for (const [blockId, blockType] of Object.entries(
        input.introducedBlocks ?? {},
      ) as [BlockId, BlockType][]) {
        if (blockTypeById.has(blockId)) {
          return {
            ok: false,
            reason: "invalid-operation",
            message: `Introduced content block ${blockId} already exists`,
            blockId,
          };
        }
        if (!isTextBlockType(blockDefinitions, blockType)) {
          return {
            ok: false,
            reason: "block-type-mismatch",
            message: `Introduced block ${blockId} (${blockType}) cannot own content`,
            blockId,
          };
        }
      }
      for (const blockId of removedBlockIds) {
        const blockType = blockTypeById.get(blockId);
        const content = contentById.get(blockId);
        if (!blockType || !content) {
          return {
            ok: false,
            reason: "missing-block",
            message: `Removed content block ${blockId} does not exist`,
            blockId,
          };
        }
        const restoredContent = richTextBlockInlineContent(content);
        const inverse: EditorLogicalContentOperation | null =
          restoredContent.length === 0
            ? null
            : {
                kind: "insertInlineContent",
                blockId,
                blockType,
                target: { kind: "text" },
                position: { blockId, offset: 0 },
                content: restoredContent,
              };
        removedBlocks.push({
          blockId,
          blockType,
          content: cloneContent(content),
          contentRevision: contentRevisionById.get(blockId) ?? 0,
          inverseContentOperations: Object.freeze(inverse ? [inverse] : []),
        });
      }
      for (const [index, change] of input.changes.entries()) {
        const blockId = change.baseToken.blockId;
        const introducedType = input.introducedBlocks?.[blockId];
        const introduced =
          !blockTypeById.has(blockId) &&
          introducedType === change.baseToken.blockType &&
          change.baseToken.graphRevision === graphRevision &&
          change.baseToken.contentRevision === 0;
        const tokenFailure = introduced
          ? null
          : validateBaseToken(change.baseToken, index);
        if (tokenFailure) return tokenFailure;
        if (!working.has(blockId)) {
          working.set(
            blockId,
            introduced
              ? defaultContentForBlockType(change.baseToken.blockType)
              : cloneContent(contentById.get(blockId)!),
          );
          bases.set(blockId, freezeBaseToken(change.baseToken));
        }
        const current = working.get(blockId);
        if (!current) {
          return {
            ok: false,
            reason: "missing-block",
            message: `Content block ${blockId} has no working content`,
            changeIndex: index,
            blockId,
          };
        }
        const result = prepareLogicalContentOperations({
          blockType: change.baseToken.blockType,
          content: current,
          operations: change.operations,
          origin: input.origin,
          options: {
            blockDefinitions: requireBlockDefinitions(blockDefinitions),
            inlineMarks,
            validatedCanonicalBase: true,
            validatedOperations: true,
            normalization: { inlineMarks, inlineAtoms },
          },
        });
        if (!result.ok) {
          return {
            ok: false,
            reason: "invalid-operation",
            message: result.message,
            changeIndex: index,
            blockId,
          };
        }
        working.set(blockId, result.content);
        preparedOperationsByBlock.set(blockId, result);
      }
      for (const [blockId, blockType] of Object.entries(
        input.introducedBlocks ?? {},
      ) as [BlockId, BlockType][]) {
        if (working.has(blockId)) continue;
        working.set(blockId, defaultContentForBlockType(blockType));
        bases.set(
          blockId,
          freezeBaseToken({
            graphRevision,
            blockId,
            blockType,
            contentRevision: 0,
          }),
        );
      }
      const blocks: ValidatedBlockState[] = [];
      for (const blockId of working.keys()) {
        const baseToken = bases.get(blockId)!;
        const introduced = !contentById.has(blockId);
        const before =
          contentById.get(blockId) ??
          defaultContentForBlockType(baseToken.blockType);
        const after = working.get(blockId)!;
        if (!introduced && rawContentEqual(before, after)) continue;
        const blockType = blockTypeById.get(blockId) ?? baseToken.blockType;
        const tombstone = anchorTombstoneById.get(blockId);
        const preparedOperations = preparedOperationsByBlock.get(blockId);
        const contentOperations = preparedOperations?.operations ?? [];
        const inverseContentOperations =
          preparedOperations?.inverseOperations ?? [];
        blocks.push({
          blockId,
          blockType,
          baseToken,
          before: cloneContent(before),
          after: cloneContent(after),
          contentOperations: Object.freeze(contentOperations),
          inverseContentOperations: Object.freeze(inverseContentOperations),
          operationUpdate: encodeLocalOperationUpdate(contentOperations),
          introduced,
          restoresAnchorLineage: Boolean(
            introduced &&
              tombstone?.blockType === blockType &&
              rawContentEqual(tombstone.content, after),
          ),
        });
      }
      const validated = Object.freeze({
        kind: "validated-content-commit" as const,
        affectedBlockIds: Object.freeze([
          ...blocks.map((block) => block.blockId),
          ...removedBlocks.map((block) => block.blockId),
        ]),
        blocks: Object.freeze([
          ...blocks
            .filter((block) => !removedBlockIds.has(block.blockId))
            .map((block) =>
              Object.freeze({
                blockId: block.blockId,
                blockType: block.blockType,
                contentOperations: block.contentOperations,
                inverseContentOperations: block.inverseContentOperations,
              }),
            ),
        ]),
        removedBlocks: Object.freeze(
          removedBlocks.map((block) =>
            Object.freeze({
              blockId: block.blockId,
              blockType: block.blockType,
              inverseContentOperations: block.inverseContentOperations,
            }),
          ),
        ),
        id: nextPreparedId++,
      });
      validatedStates.set(validated, {
        status: "validated",
        graphRevision,
        resultingGraphRevision:
          input.resultingGraphRevision ?? input.graphRevision,
        blocks,
        removedBlocks,
        origin: input.origin,
      });
      return validated;
    },
    validateRemoteContentCommit(input) {
      const changes: EditorContentCommitChange[] = [];
      for (const proposal of input.updates) {
        if (proposal.base.graphRevision !== input.graphRevision) {
          return {
            ok: false,
            reason: "stale-graph-revision",
            message: `Remote content base for ${proposal.base.blockId} does not match the transaction graph revision`,
            blockId: proposal.base.blockId,
          };
        }
        let encodedOperations: readonly EditorLogicalContentOperation[];
        try {
          encodedOperations = decodeLocalContentOperationUpdate(
            proposal.update,
          );
        } catch (error) {
          return {
            ok: false,
            reason: "invalid-update",
            message: error instanceof Error ? error.message : String(error),
            blockId: proposal.base.blockId,
          };
        }
        const operations = encodedOperations;
        if (operations.length > 0) {
          changes.push({ baseToken: proposal.base, operations });
        }
      }
      return runtime.validateContentCommit({
        graphRevision: input.graphRevision,
        resultingGraphRevision: input.resultingGraphRevision,
        changes,
        introducedBlocks: input.introducedBlocks,
        removedBlockIds: input.removedBlockIds,
        origin: input.origin,
      });
    },
    validateContentTextPoint(validated, point) {
      const state = validatedStates.get(validated);
      if (!state || state.status !== "validated") {
        return {
          ok: false,
          reason: "invalid",
          message: "Prepared local content is unavailable",
        };
      }
      if (
        !Number.isFinite(point.textOffset) ||
        point.textOffset < 0 ||
        !Number.isInteger(point.textOffset)
      ) {
        return { ok: false, reason: "invalid" };
      }
      if (
        state.removedBlocks.some((block) => block.blockId === point.blockId)
      ) {
        return { ok: false, reason: "missing-text" };
      }
      const changed = state.blocks.find(
        (block) => block.blockId === point.blockId,
      );
      if (changed && changed.blockType !== point.blockType) {
        return { ok: false, reason: "invalid" };
      }
      let content: EditorRawBlockContent;
      if (changed) {
        content = changed.after;
      } else {
        try {
          requireCurrentBlock(point.blockId, point.blockType);
          content = contentById.get(point.blockId)!;
        } catch (error) {
          return {
            ok: false,
            reason: "missing-text",
            message: error instanceof Error ? error.message : String(error),
          };
        }
      }
      return point.textOffset <= richTextDocumentContentSize(content)
        ? { ok: true, textOffset: point.textOffset }
        : { ok: false, reason: "invalid" };
    },
    readValidatedBlockContent(validated, blockId, blockType) {
      if (blockDefinitions[blockType]?.kind !== "text") return null;
      const state = validatedStates.get(validated);
      if (!state || state.status !== "validated") {
        throw new Error("Prepared local content is unavailable");
      }
      if (state.removedBlocks.some((block) => block.blockId === blockId)) {
        return null;
      }
      const changed = state.blocks.find((block) => block.blockId === blockId);
      if (changed) {
        return changed.blockType === blockType
          ? cloneContent(changed.after)
          : null;
      }
      return runtime.readBlockProjection(blockId, blockType);
    },
    commitContent(validated) {
      requireLiveRuntime();
      const state = validatedStates.get(validated);
      if (!state || state.status !== "validated") {
        throw new Error(
          "Prepared content commit is unknown or has already been applied",
        );
      }
      const graphFailure = validateGraphRevision(state.graphRevision);
      if (graphFailure) {
        state.status = "failed";
        throw new Error(
          `Prepared content commit is stale: ${graphFailure.message}`,
        );
      }
      for (const block of state.blocks) {
        const failure = block.introduced
          ? blockTypeById.has(block.blockId)
            ? ({
                ok: false,
                reason: "stale-content-revision",
                message: `Introduced content block ${block.blockId} now exists`,
                blockId: block.blockId,
              } satisfies ContentCommitRejection)
            : null
          : validateBaseToken(block.baseToken);
        if (failure) {
          state.status = "failed";
          throw new Error(
            `Prepared content commit is stale for block ${block.blockId}: ${failure.message}`,
          );
        }
      }
      for (const block of state.removedBlocks) {
        if (
          blockTypeById.get(block.blockId) !== block.blockType ||
          contentRevisionById.get(block.blockId) !== block.contentRevision
        ) {
          state.status = "failed";
          throw new Error(
            `Prepared content removal is stale for block ${block.blockId}`,
          );
        }
      }
      const blocks: AppliedContentBlock[] = [];
      for (const block of state.blocks) {
        const committedRevision = block.baseToken.contentRevision + 1;
        if (block.introduced) {
          if (block.restoresAnchorLineage) {
            anchorTombstoneById.delete(block.blockId);
          } else {
            anchorEpochById.set(block.blockId, nextAnchorEpoch++);
            anchorRevisionById.set(block.blockId, 0);
            anchorStepsById.delete(block.blockId);
            anchorTombstoneById.delete(block.blockId);
          }
        } else {
          if (!anchorEpochById.has(block.blockId)) {
            anchorEpochById.set(block.blockId, nextAnchorEpoch++);
            anchorRevisionById.set(block.blockId, 0);
          }
          const anchorRevision = anchorRevisionById.get(block.blockId) ?? 0;
          const steps =
            anchorStepsById.get(block.blockId) ??
            new Map<number, readonly EditorLogicalContentOperation[]>();
          steps.set(
            anchorRevision,
            Object.freeze([...block.contentOperations]),
          );
          anchorStepsById.set(block.blockId, steps);
          anchorRevisionById.set(block.blockId, anchorRevision + 1);
        }
        if (!anchorEpochById.has(block.blockId)) {
          anchorEpochById.set(block.blockId, nextAnchorEpoch++);
          anchorRevisionById.set(block.blockId, 0);
        }
        blockTypeById.set(block.blockId, block.blockType);
        contentById.set(block.blockId, cloneContent(block.after));
        contentRevisionById.set(block.blockId, committedRevision);
        blocks.push(
          ownAppliedBlock({
            blockId: block.blockId,
            blockType: block.blockType,
            baseToken: block.baseToken,
            committedToken: {
              ...block.baseToken,
              contentRevision: committedRevision,
            },
            operationUpdate: block.operationUpdate,
            contentOperations: block.contentOperations,
            inverseContentOperations: block.inverseContentOperations,
          }),
        );
      }
      for (const block of state.removedBlocks) {
        pendingRemovalBlockIds.add(block.blockId);
      }
      state.status = "applied";
      const applied = Object.freeze({
        kind: "applied-content-commit" as const,
        baseGraphRevision: state.graphRevision,
        graphRevision: state.resultingGraphRevision,
        affectedBlockIds: Object.freeze([
          ...blocks.map((block) => block.blockId),
          ...state.removedBlocks.map((block) => block.blockId),
        ]),
        blocks: Object.freeze(blocks),
        ...(state.origin === undefined ? {} : { origin: state.origin }),
        id: nextAppliedId++,
      });
      appliedStates.set(applied, { status: "applied", validated: state });
      return applied;
    },
    publishContentCommit(applied) {
      requireLiveRuntime();
      const state = appliedStates.get(applied);
      if (!state || state.status !== "applied") {
        throw new Error(
          "Applied content commit is unknown or has already been finalized",
        );
      }
      state.status = "released";
      graphRevision = applied.graphRevision;
      // Removed content has no projection phase. Its mounted view is released
      // by the finalized graph-removal notification exactly once.
      for (const block of [...applied.blocks].sort((left, right) =>
        compareBlockIds(left.blockId, right.blockId),
      )) {
        notifyBlockContent(block.blockId, applied);
      }
      for (const block of state.validated.removedBlocks) {
        anchorTombstoneById.set(block.blockId, {
          blockType: block.blockType,
          content: cloneContent(block.content),
        });
        blockTypeById.delete(block.blockId);
        contentById.delete(block.blockId);
        contentRevisionById.delete(block.blockId);
        pendingRemovalBlockIds.delete(block.blockId);
      }
      for (const listener of [...commitListeners]) {
        notifyProjectionSubscriber(() => listener(applied));
      }
    },
    markInconsistent(message): never {
      destroyed = true;
      throw new Error(`Local content runtime is inconsistent: ${message}`);
    },
    readBlockProjection(blockId, blockType) {
      requireCurrentBlock(blockId, blockType);
      return contentById.get(blockId)!;
    },
    readBlockContentCheckpoint(blockId, blockType) {
      requireCurrentBlock(blockId, blockType);
      return encodeLocalContentCheckpoint(contentById.get(blockId)!);
    },
    readBlockPlainText(blockId, blockType) {
      requireCurrentBlock(blockId, blockType);
      return plainTextForContent(blockType, contentById.get(blockId)!);
    },
    createTextAnchorInContext(lease, input) {
      try {
        requireCurrentBlock(lease.blockId, lease.blockType);
        const content = contentById.get(lease.blockId)!;
        const offset = normalizeAnchorOffset(input.textOffset);
        if (offset > richTextDocumentContentSize(content)) {
          return { ok: false, reason: "invalid" };
        }
        const anchor: LocalOperationTextAnchor = {
          kind: "local-operation-anchor",
          version: 1,
          epoch: anchorEpochById.get(lease.blockId)!,
          revision: anchorRevisionById.get(lease.blockId) ?? 0,
          offset,
          assoc: affinityToAssoc(input.affinity),
        };
        return {
          ok: true,
          codec: LOCAL_OPERATION_TEXT_ANCHOR_CODEC,
          payload: {
            encoded: encodeLocalTextAnchor(anchor),
            assoc: anchor.assoc,
          },
          textOffset: offset,
        };
      } catch (error) {
        return {
          ok: false,
          reason: "missing-text",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    tryCreateTextAnchorInLiveContext(input) {
      try {
        requireCurrentBlock(input.blockId, input.blockType);
        const content = contentById.get(input.blockId)!;
        const offset = normalizeAnchorOffset(input.textOffset);
        if (offset > richTextDocumentContentSize(content)) {
          return { ok: false, reason: "invalid" };
        }
        const anchor: LocalOperationTextAnchor = {
          kind: "local-operation-anchor",
          version: 1,
          epoch: anchorEpochById.get(input.blockId)!,
          revision: anchorRevisionById.get(input.blockId) ?? 0,
          offset,
          assoc: affinityToAssoc(input.affinity),
        };
        return {
          ok: true,
          codec: LOCAL_OPERATION_TEXT_ANCHOR_CODEC,
          payload: { encoded: encodeLocalTextAnchor(anchor), assoc: anchor.assoc },
          textOffset: offset,
        };
      } catch (error) {
        return {
          ok: false,
          reason: "missing-text",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    resolveTextAnchorInContext(lease, input) {
      if (input.codec !== LOCAL_OPERATION_TEXT_ANCHOR_CODEC) {
        return { ok: false, reason: "invalid" };
      }
      try {
        const content = runtime.readBlockProjection(
          lease.blockId,
          lease.blockType,
        );
        if (!content) return { ok: false, reason: "missing-text" };
        const anchor = decodeLocalTextAnchor(input.payload.encoded);
        if (
          !anchor ||
          anchor.epoch !== anchorEpochById.get(lease.blockId) ||
          anchor.revision > (anchorRevisionById.get(lease.blockId) ?? 0)
        ) {
          return { ok: false, reason: "invalid" };
        }
        let offset = anchor.offset;
        const currentRevision = anchorRevisionById.get(lease.blockId) ?? 0;
        const steps = anchorStepsById.get(lease.blockId);
        for (
          let revision = anchor.revision;
          revision < currentRevision;
          revision += 1
        ) {
          const operations = steps?.get(revision);
          if (!operations) return { ok: false, reason: "invalid" };
          offset = rebaseLocalAnchorOffset(offset, anchor.assoc, operations);
        }
        return offset <= richTextDocumentContentSize(content)
          ? { ok: true, textOffset: offset }
          : { ok: false, reason: "invalid" };
      } catch (error) {
        return {
          ok: false,
          reason: "missing-text",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    tryResolveTextAnchorInLiveContext(input) {
      try {
        requireCurrentBlock(input.blockId, input.blockType);
        if (input.codec !== LOCAL_OPERATION_TEXT_ANCHOR_CODEC) {
          return { ok: false, reason: "invalid" };
        }
        const content = contentById.get(input.blockId);
        if (!content) return { ok: false, reason: "missing-text" };
        const anchor = decodeLocalTextAnchor(input.payload.encoded);
        if (
          !anchor ||
          anchor.epoch !== anchorEpochById.get(input.blockId) ||
          anchor.revision > (anchorRevisionById.get(input.blockId) ?? 0)
        ) {
          return { ok: false, reason: "invalid" };
        }
        let offset = anchor.offset;
        const currentRevision = anchorRevisionById.get(input.blockId) ?? 0;
        const steps = anchorStepsById.get(input.blockId);
        for (
          let revision = anchor.revision;
          revision < currentRevision;
          revision += 1
        ) {
          const operations = steps?.get(revision);
          if (!operations) return { ok: false, reason: "invalid" };
          offset = rebaseLocalAnchorOffset(offset, anchor.assoc, operations);
        }
        return offset <= richTextDocumentContentSize(content)
          ? { ok: true, textOffset: offset }
          : { ok: false, reason: "invalid" };
      } catch (error) {
        return {
          ok: false,
          reason: "missing-text",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    subscribeBlockProjection(blockId, listener) {
      requireLiveRuntime();
      const listeners =
        blockListeners.get(blockId) ??
        new Set<(commit?: AppliedContentCommit) => void>();
      listeners.add(listener);
      blockListeners.set(blockId, listeners);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) blockListeners.delete(blockId);
      };
    },
    subscribeContentCommits(listener) {
      requireLiveRuntime();
      commitListeners.add(listener);
      return () => commitListeners.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      blockListeners.clear();
      commitListeners.clear();
      contentById.clear();
      blockTypeById.clear();
      contentRevisionById.clear();
      anchorEpochById.clear();
      anchorRevisionById.clear();
      anchorStepsById.clear();
      anchorTombstoneById.clear();
    },
  };

  function validateGraphRevision(
    requested: number,
  ): ContentCommitRejection | null {
    if (requested === graphRevision) return null;
    return {
      ok: false,
      reason: "stale-graph-revision",
      message: `Content commit graph revision ${requested} does not match current revision ${graphRevision}`,
    };
  }

  function validateBaseToken(
    token: EditorContentBaseToken,
    changeIndex?: number,
  ): ContentCommitRejection | null {
    if (token.graphRevision !== graphRevision) {
      return {
        ok: false,
        reason: "stale-graph-revision",
        message: `Content base token graph revision ${token.graphRevision} does not match current revision ${graphRevision}`,
        ...(changeIndex === undefined ? {} : { changeIndex }),
        blockId: token.blockId,
      };
    }
    const currentType = blockTypeById.get(token.blockId);
    if (!currentType) {
      return {
        ok: false,
        reason: "missing-block",
        message: `Content block ${token.blockId} does not exist`,
        ...(changeIndex === undefined ? {} : { changeIndex }),
        blockId: token.blockId,
      };
    }
    if (currentType !== token.blockType) {
      return {
        ok: false,
        reason: "block-type-mismatch",
        message: `Content block ${token.blockId} has type ${currentType}, not ${token.blockType}`,
        ...(changeIndex === undefined ? {} : { changeIndex }),
        blockId: token.blockId,
      };
    }
    const currentRevision = contentRevisionById.get(token.blockId) ?? 0;
    if (currentRevision !== token.contentRevision) {
      return {
        ok: false,
        reason: "stale-content-revision",
        message: `Content block ${token.blockId} revision ${token.contentRevision} does not match current revision ${currentRevision}`,
        ...(changeIndex === undefined ? {} : { changeIndex }),
        blockId: token.blockId,
      };
    }
    return null;
  }

  function requireCurrentBlock(blockId: BlockId, blockType: BlockType): void {
    requireLiveRuntime();
    if (pendingRemovalBlockIds.has(blockId)) {
      throw new Error(`Content block ${blockId} does not exist`);
    }
    const currentType = blockTypeById.get(blockId);
    if (!currentType)
      throw new Error(`Content block ${blockId} does not exist`);
    if (currentType !== blockType) {
      throw new Error(
        `Content block ${blockId} has type ${currentType}, not ${blockType}`,
      );
    }
  }

  function requireLiveRuntime(): void {
    if (destroyed) throw new Error("Local content runtime is destroyed");
  }

  function notifyBlockContent(
    blockId: BlockId,
    commit?: AppliedContentCommit,
  ): void {
    const listeners = blockListeners.get(blockId);
    if (!listeners) return;
    for (const listener of [...listeners]) {
      notifyProjectionSubscriber(() => listener(commit));
    }
  }

  return runtime;
}

function notifyProjectionSubscriber(listener: () => void): void {
  try {
    listener();
  } catch {
    // Projection subscribers cannot invalidate an already committed runtime.
  }
}

function normalizeProjection(
  blockType: BlockType,
  content: EditorRawBlockContent,
  inlineMarks: EditorContentStoreRuntimeOptions["source"]["inlineMarks"],
  inlineAtoms: EditorContentStoreRuntimeOptions["source"]["inlineAtoms"],
): EditorRawBlockContent {
  if (!isRichTextDocument(content)) {
    throw new Error(`Block ${blockType} requires canonical rich-text content`);
  }
  return normalizeRichTextDocument(blockType, content, {
    inlineMarks,
    inlineAtoms,
  });
}

function encodeLocalOperationUpdate(
  operations: readonly EditorLogicalContentOperation[],
): EditorContentOperationUpdate {
  return ownOperationUpdate(
    encodeJsonEnvelope("operation", { operations: cloneJsonValue(operations) }),
  );
}

function encodeJsonEnvelope(
  kind: "operation",
  value: unknown,
): EditorContentOperationUpdate;
function encodeJsonEnvelope(
  kind: "checkpoint",
  value: unknown,
): EditorContentCheckpoint;
function encodeJsonEnvelope(
  kind: "operation" | "checkpoint",
  value: unknown,
): EditorContentOperationUpdate | EditorContentCheckpoint {
  return {
    kind,
    format: LOCAL_CONTENT_FORMAT,
    version: LOCAL_CONTENT_FORMAT_VERSION,
    payload: EditorImmutableBinary.takeOwnership(
      new TextEncoder().encode(stableStringify(value)),
    ),
  };
}

function assertLocalEnvelope(
  envelope: EditorContentCheckpoint | EditorContentOperationUpdate,
  expectedKind: "checkpoint" | "operation",
): void {
  if (envelope.kind !== expectedKind) {
    throw new Error(
      `Expected local ${expectedKind} content, received ${envelope.kind}`,
    );
  }
  if (envelope.format !== LOCAL_CONTENT_FORMAT) {
    throw new Error(`Unknown local content format: ${envelope.format}`);
  }
  if (envelope.version !== LOCAL_CONTENT_FORMAT_VERSION) {
    throw new Error(`Unknown local content version: ${envelope.version}`);
  }
  if (!(envelope.payload instanceof EditorImmutableBinary)) {
    throw new Error("Local content payload must be immutable binary");
  }
}

function decodeJsonPayload(payload: EditorImmutableBinary): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(payload.copy()));
  } catch (error) {
    throw new Error(
      `Local content payload is invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJsonValue(value[key])]),
  );
}

function freezeBaseToken(
  token: EditorContentBaseToken,
): EditorContentBaseToken {
  return Object.freeze({ ...token });
}

function ownCheckpoint(
  checkpoint: EditorContentCheckpoint,
): EditorContentCheckpoint {
  return Object.freeze({
    ...checkpoint,
    payload: checkpoint.payload,
  });
}

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeBase64(bytes: Uint8Array): string {
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const chunk =
      (first << 16) | ((second ?? 0) << 8) | (third === undefined ? 0 : third);
    result += BASE64_ALPHABET[(chunk >>> 18) & 63];
    result += BASE64_ALPHABET[(chunk >>> 12) & 63];
    result += second === undefined ? "=" : BASE64_ALPHABET[(chunk >>> 6) & 63];
    result += third === undefined ? "=" : BASE64_ALPHABET[chunk & 63];
  }
  return result;
}

function ownOperationUpdate(
  update: EditorContentOperationUpdate,
): EditorContentOperationUpdate {
  return Object.freeze({
    ...update,
    payload: update.payload,
  });
}

function ownAppliedBlock(block: AppliedContentBlock): AppliedContentBlock {
  return Object.freeze({
    ...block,
    baseToken: freezeBaseToken(block.baseToken),
    committedToken: freezeBaseToken(block.committedToken),
    operationUpdate: ownOperationUpdate(block.operationUpdate),
    contentOperations: ownPublishedLogicalContentOperations(
      block.contentOperations,
    ),
    inverseContentOperations: ownPublishedLogicalContentOperations(
      block.inverseContentOperations,
    ),
  });
}

function requireBlockDefinitions(
  definitions: Readonly<Record<BlockType, BlockDefinition>>,
): Readonly<Record<BlockType, BlockDefinition>> {
  return definitions;
}

function isTextBlockType(
  definitions: Readonly<Record<BlockType, BlockDefinition>>,
  blockType: BlockType,
): boolean {
  const definition = definitions[blockType];
  if (!definition) return false;
  return definition.kind === "text";
}

function rawContentEqual(
  left: EditorRawBlockContent | undefined,
  right: EditorRawBlockContent | undefined,
): boolean {
  return left === right || jsonValuesEqual(left ?? null, right ?? null);
}

function compareBlockIds(left: BlockId, right: BlockId): number {
  return String(left).localeCompare(String(right));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function affinityToAssoc(affinity: "forward" | "backward" | null): -1 | 0 | 1 {
  if (affinity === "backward") return -1;
  if (affinity === "forward") return 1;
  return 0;
}

function normalizeAnchorOffset(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function rebaseLocalAnchorOffset(
  initial: number,
  assoc: -1 | 0 | 1,
  operations: readonly EditorLogicalContentOperation[],
): number {
  let offset = initial;
  for (const operation of operations) {
    if (
      operation.kind === "addInlineMark" ||
      operation.kind === "removeInlineMark"
    ) {
      continue;
    }
    if (operation.kind === "insertInlineContent") {
      offset = mapAnchorAcrossReplacement(
        offset,
        assoc,
        operation.position.offset,
        operation.position.offset,
        inlineContentSize(operation.content),
      );
      continue;
    }
    const inserted =
      operation.kind === "deleteInlineRange"
        ? 0
        : operation.kind === "setInlineEntity"
          ? richInlineNodeSize(operation.entity)
          : operation.kind === "replaceInlineRange"
            ? inlineContentSize(operation.content)
            : null;
    if (inserted === null) continue;
    offset = mapAnchorAcrossReplacement(
      offset,
      assoc,
      operation.range.from.offset,
      operation.range.to.offset,
      inserted,
    );
  }
  return offset;
}

function mapAnchorAcrossReplacement(
  offset: number,
  assoc: -1 | 0 | 1,
  from: number,
  to: number,
  insertedSize: number,
): number {
  if (offset < from) return offset;
  if (offset > to) return offset + insertedSize - (to - from);
  if (from === to) return assoc < 0 ? from : from + insertedSize;
  return assoc < 0 ? from : from + insertedSize;
}

function inlineContentSize(
  content: readonly import("@repo/editor-core/content/rich-text").RichTextInlineNodeJson[],
): number {
  return content.reduce((size, node) => size + richInlineNodeSize(node), 0);
}

function encodeLocalTextAnchor(anchor: LocalOperationTextAnchor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(anchor));
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const value = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    encoded += alphabet[(value >>> 18) & 63];
    encoded += alphabet[(value >>> 12) & 63];
    encoded += second === undefined ? "=" : alphabet[(value >>> 6) & 63];
    encoded += third === undefined ? "=" : alphabet[value & 63];
  }
  return encoded;
}

function decodeLocalTextAnchor(
  encoded: string,
): LocalOperationTextAnchor | null {
  try {
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    if (encoded.length === 0 || encoded.length % 4 !== 0) return null;
    const bytes: number[] = [];
    for (let index = 0; index < encoded.length; index += 4) {
      const chunk = encoded.slice(index, index + 4);
      const values = [...chunk].map((character) =>
        character === "=" ? 0 : alphabet.indexOf(character),
      );
      if (values.some((value) => value < 0)) return null;
      const value =
        (values[0]! << 18) |
        (values[1]! << 12) |
        (values[2]! << 6) |
        values[3]!;
      bytes.push((value >>> 16) & 255);
      if (chunk[2] !== "=") bytes.push((value >>> 8) & 255);
      if (chunk[3] !== "=") bytes.push(value & 255);
    }
    const value = JSON.parse(
      new TextDecoder().decode(new Uint8Array(bytes)),
    ) as Partial<LocalOperationTextAnchor>;
    return value.kind === "local-operation-anchor" &&
      value.version === 1 &&
      Number.isSafeInteger(value.epoch) &&
      Number.isSafeInteger(value.revision) &&
      Number.isSafeInteger(value.offset) &&
      (value.assoc === -1 || value.assoc === 0 || value.assoc === 1)
      ? (value as LocalOperationTextAnchor)
      : null;
  } catch {
    return null;
  }
}
