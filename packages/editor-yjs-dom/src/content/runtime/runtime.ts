import {
  Doc,
  applyUpdate,
  encodeStateAsUpdate,
  diffUpdate,
  mergeUpdates,
  encodeStateVectorFromUpdate,
  encodeStateVector,
} from "@repo/editor-yjs";
import type { BlockType } from "@repo/editor-core/document";
import { assertValidBlockGraphVersion } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type {
  EditorBlockContentLease,
  EditorContentRuntimeSource,
  EditorContentStoreSlot,
  EditorRawBlockContent,
} from "@repo/editor-core/content";
import { jsonValuesEqual } from "@repo/editor-core/kernel";
import type { EditorLogicalContentOperation } from "@repo/editor-core/operations";
import {
  createBlockRichTextContentFromPlainText,
  isRichTextDocument,
  normalizeRichTextDocument,
  richTextBlockInlineContent,
  richTextDocumentContentSize,
  extractPlainTextFromRichTextDocument,
  EditorImmutableBinary,
  type EditorContentCheckpoint,
  type EditorContentOperationUpdate,
  type EditorOpaqueContentCheckpoint,
} from "@repo/editor-core/content/rich-text";
import {
  createBlockContentDocContext,
  applyBlockContentUpdate as applyYjsBlockContentUpdate,
  applyPlannedCanonicalYjsContentMutation,
  EDITOR_YJS_CONTENT_FORMAT,
  EDITOR_YJS_CONTENT_FORMAT_VERSION,
  planCanonicalYjsContentMutation,
  type CanonicalYjsContentMutationPlan,
  type BlockContentDocContext,
} from "@repo/editor-yjs";
import type {
  AppliedContentBlock,
  AppliedContentCommit,
  ContentCommitRejection,
  EditorContentBaseToken,
  EditorContentCommitInput,
  ValidatedContentCommit,
} from "@repo/editor-core/operations";
import {
  operationAnchorRequirement,
  prepareLogicalContentOperations,
  ownPublishedLogicalContentOperations,
  validateContentCommitInput,
  type PreparedLogicalContentOperations,
  type PreparedLogicalContentTransition,
  type EditorContentOperationReplayStep,
  type EditorOperationAnchor,
} from "@repo/editor-core/operations";
import { createYjsRelativeTextPointCodec } from "../../text-points/relative-text-point-codec.ts";
import { readYjsBlockContentDocument } from "../projection/block-content-mapping.ts";
import { ensureYjsBlockContent } from "../seed/ensure-yjs-block-content.ts";
import type {
  YjsBlockContentRuntime,
  BlockContentLease,
} from "./runtime-types.ts";

const YJS_RELATIVE_TEXT_ANCHOR_CODEC = "yjs-relative-position";

export {
  EDITOR_YJS_CONTENT_FORMAT,
  EDITOR_YJS_CONTENT_FORMAT_VERSION,
} from "@repo/editor-yjs";

export interface EditorYjsCommitOrigin {
  readonly kind: "local-editor-commit" | "remote-editor-commit" | "recovery";
  readonly scope: object;
}

interface BlockState {
  blockType: BlockType;
  context: BlockContentDocContext;
  contentRevision: number;
  mutationEpoch: number;
  projectionSnapshot: EditorRawBlockContent;
  detachGuard: () => void;
  opaqueCheckpoint: EditorOpaqueContentCheckpoint;
  leaseCount: number;
  peekContext(): BlockContentDocContext | null;
  releaseContext(): void;
  acceptedRevision: number;
}

interface ValidatedBlockState {
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly baseToken: EditorContentBaseToken;
  readonly before: EditorRawBlockContent;
  readonly after: EditorRawBlockContent;
  readonly mutationEpoch: number;
  readonly contentOperations: readonly EditorLogicalContentOperation[];
  readonly inverseContentOperations: readonly EditorLogicalContentOperation[];
  readonly transitions: readonly PreparedLogicalContentTransition[];
  readonly introduced: boolean;
  readonly remoteUpdate?: EditorContentOperationUpdate;
}

interface ValidatedRemovedBlockState {
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly contentRevision: number;
  readonly mutationEpoch: number;
  readonly inverseContentOperations: readonly EditorLogicalContentOperation[];
}

interface ValidatedState {
  status: "validated" | "applying" | "applied" | "failed";
  readonly graphRevision: number;
  readonly resultingGraphRevision: number;
  readonly blocks: readonly ValidatedBlockState[];
  readonly removedBlocks: readonly ValidatedRemovedBlockState[];
  readonly origin: unknown;
  readonly remote: boolean;
}

interface AppliedState {
  status: "applied" | "released";
  readonly validated: ValidatedState;
}

interface ActiveCommit {
  readonly origins: Set<object>;
  readonly updatesByBlockId: Map<BlockId, Uint8Array[]>;
}

interface PreparedCommitBlock {
  readonly validated: ValidatedBlockState;
  readonly live: BlockState;
  readonly mutationPlans: readonly CanonicalYjsContentMutationPlan[];
  readonly introduced: boolean;
  readonly initialUpdates: readonly Uint8Array[];
}

interface DetachedIntroducedBlock {
  readonly state: BlockState;
  readonly initialUpdates: readonly Uint8Array[];
  install(): void;
  destroy(): void;
}

const HYDRATION_ORIGIN = Object.freeze({
  kind: "editor-yjs-hydration",
});

export function createYjsBlockContentRuntime(
  source: EditorContentRuntimeSource,
): YjsBlockContentRuntime {
  if (!Array.isArray(source.inlineAtoms)) {
    throw new Error("Yjs content runtime requires inline atom definitions");
  }
  let graphRevision = source.blockGraphVersion;
  let destroyed = false;
  let inconsistent = false;
  let nextValidatedId = 1;
  let nextAppliedId = 1;
  let activeCommit: ActiveCommit | null = null;
  const liveContexts = new Map<BlockId, BlockContentDocContext>();
  const blockDefinitions = source.blockDefinitions;
  const inlineMarks = source.inlineMarks;
  const inlineAtoms = source.inlineAtoms;
  const normalizeProjection = (
    blockType: BlockType,
    value: unknown,
  ): EditorRawBlockContent => {
    if (
      !isRichTextDocument(value, {
        inlineMarks,
        inlineAtoms,
      })
    ) {
      throw new Error(`Block ${blockType} content is not a rich-text document`);
    }
    return normalizeRichTextDocument(blockType, value, {
      inlineMarks,
      inlineAtoms,
    });
  };
  const blocks = new Map<BlockId, BlockState>();
  const pendingRemovalBlockIds = new Set<BlockId>();
  const blockListeners = new Map<
    BlockId,
    Set<(commit?: AppliedContentCommit) => void>
  >();
  const commitListeners = new Set<(commit: AppliedContentCommit) => void>();
  const anchorInvalidationListeners = new Set<() => void>();
  const validatedStates = new WeakMap<ValidatedContentCommit, ValidatedState>();
  const appliedStates = new WeakMap<AppliedContentCommit, AppliedState>();
  const permittedInternalOrigins = new WeakSet<object>();
  const leaseContexts = new WeakMap<
    EditorBlockContentLease,
    BlockContentDocContext
  >();
  permittedInternalOrigins.add(HYDRATION_ORIGIN);

  for (const [blockId, blockType] of readSourceBlockTypes(source)) {
    const checkpoint = source.opaqueContentCheckpoints[blockId];
    const projection = source.contentById?.[blockId];
    if (!isTextBlock(blockType)) {
      if (checkpoint || projection !== undefined) {
        throw new Error(
          `Block ${blockId} (${blockType}) is not text-based and cannot own content`,
        );
      }
      continue;
    }
    if (!checkpoint || projection === undefined) {
      throw new Error(
        `Text block ${blockId} requires projection and checkpoint`,
      );
    }
    blocks.set(
      blockId,
      createOpaqueBlockState(blockId, blockType, checkpoint, projection),
    );
  }

  const runtime: YjsBlockContentRuntime = {
    format: EDITOR_YJS_CONTENT_FORMAT,
    operationVersion: EDITOR_YJS_CONTENT_FORMAT_VERSION,
    acquireBlockContent(blockId, blockType, reason) {
      const state = requireBlock(blockId, blockType);
      state.leaseCount += 1;
      const context = state.context;
      let released = false;
      const lease: BlockContentLease = Object.freeze({
        blockId,
        blockType,
        reason,
        context,
        release() {
          if (released) return;
          released = true;
          leaseContexts.delete(lease);
          state.leaseCount -= 1;
          if (state.leaseCount === 0) state.releaseContext();
        },
      });
      leaseContexts.set(lease, context);
      return lease;
    },
    readOpaqueBlockState(blockId) {
      const state = blocks.get(blockId);
      return state?.opaqueCheckpoint ?? null;
    },
    getLiveBlockContentCount() {
      let count = 0;
      for (const state of blocks.values()) if (state.peekContext()) count += 1;
      return count;
    },
    reconcileContentData(data) {
      requireEditableContentAccess();
      for (const listener of [...anchorInvalidationListeners]) {
        notifyProjectionSubscriber(listener);
      }
      assertValidBlockGraphVersion(data.blockGraphVersion);
      const liveIds = new Set(data.blockIds);
      const notifications = new Set<BlockId>();
      for (const blockId of [...blocks.keys()]) {
        if (liveIds.has(blockId)) continue;
        disposeBlock(blockId);
        notifications.add(blockId);
      }
      for (const blockId of data.blockIds) {
        const blockType = data.blockTypesById[blockId];
        if (!blockType) continue;
        const checkpoint = data.opaqueContentCheckpoints[blockId];
        const projection = data.contentById?.[blockId];
        if (!isTextBlock(blockType)) {
          if (checkpoint || projection !== undefined) {
            throw new Error(
              `Block ${blockId} (${blockType}) is not text-based and cannot own content`,
            );
          }
          if (blocks.has(blockId)) {
            disposeBlock(blockId);
            notifications.add(blockId);
          }
          continue;
        }
        if (!checkpoint || projection === undefined) {
          throw new Error(
            `Text block ${blockId} requires projection and checkpoint`,
          );
        }
        const nextProjection = projection;
        const current = blocks.get(blockId);
        if (!current) {
          blocks.set(
            blockId,
            createOpaqueBlockState(
              blockId,
              blockType,
              checkpoint,
              nextProjection,
            ),
          );
          continue;
        }
        const before = current.projectionSnapshot;
        if (
          current.blockType === blockType &&
          contentEqual(before, nextProjection)
        ) {
          current.opaqueCheckpoint = checkpoint;
          continue;
        }
        current.releaseContext();
        current.blockType = blockType;
        current.opaqueCheckpoint = checkpoint;
        current.projectionSnapshot = nextProjection;
        current.contentRevision += 1;
        notifications.add(blockId);
      }
      graphRevision = data.blockGraphVersion;
      for (const blockId of sortedBlockIds(notifications)) notifyBlock(blockId);
    },
    applyExternalContentUpdate(input) {
      requireEditableContentAccess();
      assertValidBlockGraphVersion(input.blockGraphVersion);
      const state = requireBlock(input.blockId, input.blockType);
      if (input.revision <= state.acceptedRevision) return;
      const next = normalizeProjection(input.blockType, input.readProjection);
      assertOperationEnvelope(input.update);
      graphRevision = input.blockGraphVersion;
      const before = state.projectionSnapshot;
      const context = state.peekContext();
      const nextCheckpoint = mergeOpaqueBlockUpdate(
        state.opaqueCheckpoint,
        input.update,
      );
      if (context) {
        const origin =
          typeof input.origin === "object" && input.origin
            ? input.origin
            : HYDRATION_ORIGIN;
        permittedInternalOrigins.add(origin);
        applyYjsBlockContentUpdate(
          context,
          input.update.payload.copy(),
          origin,
        );
      }
      state.opaqueCheckpoint = nextCheckpoint;
      state.acceptedRevision = input.revision;
      state.contentRevision += 1;
      if (!contentEqual(before, next)) {
        state.projectionSnapshot = ownProjection(next);
        notifyBlock(input.blockId);
      }
    },
    readContentBaseToken(blockId, blockType, requestedGraphRevision) {
      requireEditableContentAccess();
      if (requestedGraphRevision !== graphRevision) {
        throw new Error(
          `Cannot read a Yjs content base token for stale graph revision ${requestedGraphRevision}; current revision is ${graphRevision}`,
        );
      }
      const state = requireBlock(blockId, blockType);
      return freezeBaseToken({
        graphRevision,
        blockId,
        blockType,
        contentRevision: state.contentRevision,
      });
    },
    validateContentCommit(input) {
      requireEditableContentAccess();
      if (activeCommit) {
        return rejection(
          "invalid-operation",
          "A Yjs content commit is already active",
        );
      }
      const inputFailure = validateContentCommitInput(input);
      if (inputFailure) return inputFailure;
      const graphFailure = validateGraphRevision(input.graphRevision);
      if (graphFailure) return graphFailure;
      if (
        input.changes.length === 1 &&
        input.introducedBlocks === undefined &&
        input.removedBlockIds === undefined
      ) {
        const change = input.changes[0]!;
        const blockId = change.baseToken.blockId;
        const blockType = change.baseToken.blockType;
        const tokenFailure = validateBaseToken(change.baseToken, 0);
        if (tokenFailure) return tokenFailure;
        const live = blocks.get(blockId)!;
        const prepared = prepareLogicalContentOperations({
          blockType,
          content: live.projectionSnapshot,
          operations: change.operations,
          origin: input.origin,
          options: {
            blockDefinitions,
            inlineMarks,
            validatedCanonicalBase: true,
            validatedOperations: true,
            normalization: { inlineMarks, inlineAtoms },
          },
        });
        if (!prepared.ok) {
          return rejection("invalid-operation", prepared.message, blockId, 0);
        }
        if (prepared.content === live.projectionSnapshot) {
          return createValidated(input, [], false);
        }
        return createValidated(
          input,
          [
            {
              blockId,
              blockType,
              baseToken: change.baseToken,
              before: live.projectionSnapshot,
              after: ownProjection(prepared.content),
              mutationEpoch: live.mutationEpoch,
              contentOperations: prepared.operations,
              inverseContentOperations: prepared.inverseOperations,
              transitions: prepared.transitions,
              introduced: false,
            },
          ],
          false,
        );
      }
      const working = new Map<BlockId, EditorRawBlockContent>();
      const bases = new Map<BlockId, EditorContentBaseToken>();
      const preparedOperationsByBlock = new Map<
        BlockId,
        Extract<PreparedLogicalContentOperations, { readonly ok: true }>
      >();
      const removedBlocks: ValidatedRemovedBlockState[] = [];
      const removedBlockIds = new Set(input.removedBlockIds ?? []);
      for (const [blockId, blockType] of Object.entries(
        input.introducedBlocks ?? {},
      ) as [BlockId, BlockType][]) {
        if (blocks.has(blockId)) {
          return rejection(
            "invalid-operation",
            `Introduced Yjs content block ${blockId} already exists`,
            blockId,
          );
        }
        if (!isTextBlock(blockType)) {
          return rejection(
            "block-type-mismatch",
            `Introduced block ${blockId} (${blockType}) cannot own content`,
            blockId,
          );
        }
      }
      for (const blockId of removedBlockIds) {
        const live = blocks.get(blockId);
        if (!live) {
          return rejection(
            "missing-block",
            `Removed Yjs content block ${blockId} does not exist`,
            blockId,
          );
        }
        removedBlocks.push({
          blockId,
          blockType: live.blockType,
          contentRevision: live.contentRevision,
          mutationEpoch: live.mutationEpoch,
          inverseContentOperations: restorationOperations(
            blockId,
            live.blockType,
            live.projectionSnapshot,
          ),
        });
      }
      for (const [index, change] of input.changes.entries()) {
        const blockId = change.baseToken.blockId;
        const blockType = change.baseToken.blockType;
        const introducedType = input.introducedBlocks?.[blockId];
        const introduced =
          !blocks.has(blockId) &&
          introducedType === blockType &&
          change.baseToken.contentRevision === 0 &&
          change.baseToken.graphRevision === graphRevision;
        const tokenFailure = introduced
          ? null
          : validateBaseToken(change.baseToken, index);
        if (tokenFailure) return tokenFailure;
        if (!working.has(blockId)) {
          working.set(
            blockId,
            introduced
              ? defaultProjection(blockType)
              : blocks.get(blockId)!.projectionSnapshot,
          );
          bases.set(blockId, freezeBaseToken(change.baseToken));
        }
        const current = working.get(blockId);
        if (!current) {
          return rejection(
            "missing-block",
            `Yjs content block ${blockId} has no working content`,
            blockId,
            index,
          );
        }
        const result = prepareLogicalContentOperations({
          blockType,
          content: current,
          operations: change.operations,
          origin: input.origin,
          options: {
            blockDefinitions,
            inlineMarks,
            validatedCanonicalBase: true,
            validatedOperations: true,
            normalization: { inlineMarks, inlineAtoms },
          },
        });
        if (!result.ok) {
          return rejection("invalid-operation", result.message, blockId, index);
        }
        working.set(blockId, result.content);
        preparedOperationsByBlock.set(blockId, result);
      }
      for (const [blockId, blockType] of Object.entries(
        input.introducedBlocks ?? {},
      ) as [BlockId, BlockType][]) {
        if (working.has(blockId)) continue;
        working.set(blockId, defaultProjection(blockType));
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
      const validatedBlocks: ValidatedBlockState[] = [];
      for (const blockId of working.keys()) {
        const baseToken = bases.get(blockId)!;
        const live = blocks.get(blockId);
        const introduced = !live;
        const before = live
          ? live.projectionSnapshot
          : defaultProjection(baseToken.blockType);
        const after = ownProjection(working.get(blockId)!);
        if (!introduced && before === after) continue;
        const preparedOperations = preparedOperationsByBlock.get(blockId);
        const contentOperations = preparedOperations?.operations ?? [];
        const inverseContentOperations =
          preparedOperations?.inverseOperations ?? [];
        if (!introduced && contentOperations.length === 0) {
          return rejection(
            "invalid-operation",
            `Yjs content change for ${blockId} is not reversibly representable`,
            blockId,
          );
        }
        validatedBlocks.push({
          blockId,
          blockType: baseToken.blockType,
          baseToken,
          before,
          after,
          mutationEpoch: live?.mutationEpoch ?? 0,
          contentOperations,
          inverseContentOperations,
          transitions: Object.freeze(preparedOperations?.transitions ?? []),
          introduced,
        });
      }
      return createValidated(input, validatedBlocks, false, removedBlocks);
    },
    validateRemoteContentCommit(input) {
      requireEditableContentAccess();
      if (activeCommit) {
        return rejection(
          "invalid-update",
          "Remote Yjs ingress cannot interleave with an active content commit",
        );
      }
      const graphFailure = validateGraphRevision(input.graphRevision);
      if (graphFailure) return graphFailure;
      try {
        assertValidBlockGraphVersion(input.resultingGraphRevision);
      } catch (error) {
        return rejection(
          "stale-graph-revision",
          error instanceof Error ? error.message : String(error),
        );
      }
      const introduced = new Map(
        Object.entries(input.introducedBlocks ?? {}) as [BlockId, BlockType][],
      );
      const removedBlockIds = new Set(input.removedBlockIds ?? []);
      if (removedBlockIds.size !== (input.removedBlockIds?.length ?? 0)) {
        return rejection(
          "invalid-update",
          "Removed remote Yjs block ids must not contain duplicates",
        );
      }
      for (const [blockId, blockType] of introduced) {
        if (removedBlockIds.has(blockId)) {
          return rejection(
            "invalid-update",
            `Remote Yjs block ${blockId} cannot be introduced and removed together`,
            blockId,
          );
        }
        if (blocks.has(blockId)) {
          return rejection(
            "invalid-update",
            `Introduced remote Yjs block ${blockId} already exists`,
            blockId,
          );
        }
        if (!isTextBlock(blockType)) {
          return rejection(
            "block-type-mismatch",
            `Introduced block ${blockId} (${blockType}) cannot own content`,
            blockId,
          );
        }
      }
      const removedBlocks: ValidatedRemovedBlockState[] = [];
      for (const blockId of removedBlockIds) {
        const live = blocks.get(blockId);
        if (!live) {
          return rejection(
            "missing-block",
            `Removed remote Yjs block ${blockId} does not exist`,
            blockId,
          );
        }
        removedBlocks.push({
          blockId,
          blockType: live.blockType,
          contentRevision: live.contentRevision,
          mutationEpoch: live.mutationEpoch,
          inverseContentOperations: restorationOperations(
            blockId,
            live.blockType,
            live.projectionSnapshot,
          ),
        });
      }
      const proposalsByBlock = new Map<
        BlockId,
        (typeof input.updates)[number]
      >();
      for (const proposal of input.updates) {
        const blockId = proposal.base.blockId;
        if (proposalsByBlock.has(blockId)) {
          return rejection(
            "invalid-update",
            `Remote Yjs transaction contains duplicate updates for ${blockId}`,
            blockId,
          );
        }
        if (
          proposal.base.graphRevision !== input.graphRevision ||
          removedBlockIds.has(blockId)
        ) {
          return rejection(
            "invalid-update",
            `Remote Yjs update for ${blockId} has an invalid transaction base`,
            blockId,
          );
        }
        const introducedType = introduced.get(blockId);
        const isIntroduced = introducedType !== undefined;
        if (
          isIntroduced &&
          (introducedType !== proposal.base.blockType ||
            proposal.base.contentRevision !== 0)
        ) {
          return rejection(
            "invalid-update",
            `Remote Yjs update for introduced block ${blockId} has an invalid base`,
            blockId,
          );
        }
        const tokenFailure = isIntroduced
          ? null
          : validateBaseToken(proposal.base);
        if (tokenFailure) return tokenFailure;
        try {
          assertOperationEnvelope(proposal.update);
          const live = blocks.get(blockId);
          const liveContext = live?.peekContext() ?? null;
          const currentUpdate =
            live && !liveContext
              ? decodeOpaqueCheckpoint(live.opaqueCheckpoint)
              : new Uint8Array();
          const missingUpdate = diffUpdate(
            proposal.update.payload.copy(),
            liveContext
              ? encodeStateVector(liveContext.doc)
              : currentUpdate.byteLength > 0
                ? encodeStateVectorFromUpdate(currentUpdate)
                : new Uint8Array([0]),
          );
          if (missingUpdate.byteLength <= 2) {
            return rejection(
              "invalid-update",
              `Remote Yjs update for ${blockId} was already applied`,
              blockId,
            );
          }
        } catch (error) {
          return rejection(
            "invalid-update",
            error instanceof Error ? error.message : String(error),
            blockId,
          );
        }
        proposalsByBlock.set(blockId, proposal);
      }
      const validatedBlocks: ValidatedBlockState[] = [];
      const affectedBlockIds = new Set<BlockId>([
        ...introduced.keys(),
        ...proposalsByBlock.keys(),
      ]);
      for (const blockId of sortedBlockIds(affectedBlockIds)) {
        const proposal = proposalsByBlock.get(blockId);
        const introducedType = introduced.get(blockId);
        const live = blocks.get(blockId);
        const blockType = proposal?.base.blockType ?? introducedType!;
        const baseToken = proposal
          ? freezeBaseToken(proposal.base)
          : freezeBaseToken({
              graphRevision: input.graphRevision,
              blockId,
              blockType,
              contentRevision: 0,
            });
        const before = live
          ? live.projectionSnapshot
          : defaultProjection(blockType);
        let after = before;
        if (proposal) {
          try {
            after = normalizeProjection(blockType, proposal.readProjection);
          } catch (error) {
            return rejection(
              "invalid-update",
              `Remote Yjs change for ${blockId} is invalid: ${error instanceof Error ? error.message : String(error)}`,
              blockId,
            );
          }
        }
        validatedBlocks.push({
          blockId,
          blockType,
          baseToken,
          before,
          after,
          mutationEpoch: live?.mutationEpoch ?? 0,
          contentOperations: Object.freeze([]),
          inverseContentOperations: Object.freeze([]),
          transitions: Object.freeze([]),
          introduced: !live,
          ...(proposal
            ? { remoteUpdate: ownOperationUpdate(proposal.update) }
            : {}),
        });
      }
      return createValidated(
        {
          graphRevision: input.graphRevision,
          resultingGraphRevision: input.resultingGraphRevision,
          origin: input.origin,
        },
        validatedBlocks,
        true,
        removedBlocks,
      );
    },
    validateContentTextPoint(validated, point) {
      const state = validatedStates.get(validated);
      if (!state || state.status !== "validated") {
        return {
          ok: false,
          reason: "invalid",
          message: "Validated Yjs content is unavailable",
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
          content = requireBlock(
            point.blockId,
            point.blockType,
          ).projectionSnapshot;
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
        throw new Error("Validated Yjs content is unavailable");
      }
      if (state.removedBlocks.some((block) => block.blockId === blockId)) {
        return null;
      }
      const changed = state.blocks.find((block) => block.blockId === blockId);
      if (changed) {
        return changed.blockType === blockType ? changed.after : null;
      }
      return runtime.readBlockProjection(blockId, blockType);
    },
    commitContent(validated, replayCapture) {
      requireEditableContentAccess();
      const validatedState = validatedStates.get(validated);
      if (!validatedState || validatedState.status !== "validated") {
        throw new Error(
          "Validated Yjs content commit is unknown or has already been used",
        );
      }
      if (activeCommit) {
        validatedState.status = "failed";
        throw new Error("A Yjs content commit is already active");
      }
      const graphFailure = validateGraphRevision(validatedState.graphRevision);
      if (graphFailure) {
        validatedState.status = "failed";
        throw new Error(graphFailure.message);
      }
      for (const block of validatedState.blocks) {
        if (block.introduced) {
          if (blocks.has(block.blockId)) {
            validatedState.status = "failed";
            throw new Error(`Introduced Yjs block ${block.blockId} now exists`);
          }
          continue;
        }
        const failure = validateBaseToken(block.baseToken);
        if (failure) {
          validatedState.status = "failed";
          throw new Error(failure.message);
        }
        const live = requireBlock(block.blockId, block.blockType);
        if (block.mutationEpoch !== live.mutationEpoch) {
          validatedState.status = "failed";
          throw new Error(
            `Live Yjs state for ${block.blockId} changed after preparation`,
          );
        }
      }
      for (const block of validatedState.removedBlocks) {
        const live = blocks.get(block.blockId);
        if (
          !live ||
          live.blockType !== block.blockType ||
          live.contentRevision !== block.contentRevision ||
          live.mutationEpoch !== block.mutationEpoch
        ) {
          validatedState.status = "failed";
          throw new Error(
            `Validated Yjs content removal is stale for ${block.blockId}`,
          );
        }
      }
      const commitScope = Object.freeze({});
      const origin: EditorYjsCommitOrigin = Object.freeze({
        kind: validatedState.remote
          ? "remote-editor-commit"
          : "local-editor-commit",
        scope: commitScope,
      });
      const acquiredLeases: EditorBlockContentLease[] = [];
      const detachedIntroductions: DetachedIntroducedBlock[] = [];
      const preparedBlocks: PreparedCommitBlock[] = [];
      const removedInverseStepsByBlock: EditorContentOperationReplayStep[][] =
        [];
      const releasePreflightResources = () => {
        for (const lease of acquiredLeases.splice(0).reverse()) {
          lease.release();
        }
        for (const introduced of detachedIntroductions) introduced.destroy();
      };
      try {
        for (const block of validatedState.blocks) {
          if (block.introduced) {
            const introduced = prepareDetachedIntroducedBlock(block, origin);
            detachedIntroductions.push(introduced);
            const mutationPlans = block.remoteUpdate
              ? []
              : planContentMutations(introduced.state, block.transitions);
            if (!mutationPlans) {
              throw new Error(
                `Introduced Yjs content for ${block.blockId} cannot apply its canonical transitions`,
              );
            }
            preparedBlocks.push({
              validated: block,
              live: introduced.state,
              mutationPlans,
              introduced: true,
              initialUpdates: introduced.initialUpdates,
            });
            continue;
          }
          const live = requireBlock(block.blockId, block.blockType);
          if (block.remoteUpdate) {
            preparedBlocks.push({
              validated: block,
              live,
              mutationPlans: [],
              introduced: false,
              initialUpdates: [],
            });
            continue;
          }
          const lease = runtime.acquireBlockContent(
            block.blockId,
            block.blockType,
            "canonical-transaction",
          );
          acquiredLeases.push(lease);
          if (
            block.mutationEpoch !== live.mutationEpoch ||
            block.baseToken.contentRevision !== live.contentRevision
          ) {
            throw new Error(
              `Live Yjs state for ${block.blockId} changed during preflight`,
            );
          }
          const mutationPlans = planContentMutations(live, block.transitions);
          if (!mutationPlans) {
            throw new Error(
              `Live Yjs content for ${block.blockId} cannot apply the canonical operation sequence`,
            );
          }
          preparedBlocks.push({
            validated: block,
            live,
            mutationPlans,
            introduced: false,
            initialUpdates: [],
          });
        }
        for (const block of validatedState.removedBlocks) {
          const live = requireBlock(block.blockId, block.blockType);
          if (
            live.contentRevision !== block.contentRevision ||
            live.mutationEpoch !== block.mutationEpoch
          ) {
            throw new Error(
              `Validated Yjs content removal is stale for ${block.blockId}`,
            );
          }
          if (replayCapture !== "inverse") continue;
          const lease = runtime.acquireBlockContent(
            block.blockId,
            block.blockType,
            "canonical-transaction",
          );
          acquiredLeases.push(lease);
          removedInverseStepsByBlock.push(
            block.inverseContentOperations.map((operation) =>
              createYjsReplayStep(live.context, operation),
            ),
          );
        }
      } catch (error) {
        validatedState.status = "failed";
        releasePreflightResources();
        throw error;
      }

      validatedState.status = "applying";
      activeCommit = {
        origins: new Set([origin]),
        updatesByBlockId: new Map(),
      };
      const appliedBlocks: AppliedContentBlock[] = [];
      const inverseStepsByBlock: EditorContentOperationReplayStep[][] = [];
      try {
        for (const block of validatedState.blocks) {
          activeCommit.updatesByBlockId.set(block.blockId, []);
        }
        for (const introduced of detachedIntroductions) introduced.install();
        for (const prepared of preparedBlocks) {
          const block = prepared.validated;
          const live = prepared.live;
          if (prepared.initialUpdates.length > 0) {
            activeCommit.updatesByBlockId
              .get(block.blockId)!
              .push(...prepared.initialUpdates);
          }
          if (block.remoteUpdate) {
            if (!prepared.introduced) {
              applyYjsBlockContentUpdate(
                live.context,
                block.remoteUpdate.payload.copy(),
                origin,
              );
            }
          } else if (prepared.mutationPlans.length > 0) {
            const capturedInverseSteps: EditorContentOperationReplayStep[] = [];
            live.context.doc.transact(() => {
              for (const [index, plan] of prepared.mutationPlans.entries()) {
                applyPlannedCanonicalYjsContentMutation(plan);
                if (replayCapture === "inverse") {
                  const transition = block.transitions[index];
                  if (!transition) {
                    throw new Error(
                      "Yjs replay capture lost transition ordering",
                    );
                  }
                  capturedInverseSteps.unshift(
                    createYjsReplayStep(
                      live.context,
                      transition.inverseOperation,
                    ),
                  );
                }
              }
            }, origin);
            inverseStepsByBlock.push(capturedInverseSteps);
          }
          const nextProjection = block.remoteUpdate
            ? readAppliedRemoteProjection(live)
            : block.after;
          const captured = mergeCapturedUpdates(block.blockId);
          const operationUpdate = block.remoteUpdate
            ? ownOperationUpdate(block.remoteUpdate)
            : encodeOperationUpdate(captured);
          if (operationUpdate.payload.byteLength === 0) {
            throw new Error(
              `Yjs commit changed ${block.blockId} without an incremental update`,
            );
          }
          const nextCheckpoint = mergeOpaqueBlockUpdate(
            live.opaqueCheckpoint,
            operationUpdate,
          );
          live.contentRevision = block.baseToken.contentRevision + 1;
          live.mutationEpoch += 1;
          live.blockType = block.blockType;
          live.opaqueCheckpoint = nextCheckpoint;
          live.projectionSnapshot = ownProjection(nextProjection);
          appliedBlocks.push(
            ownAppliedBlock({
              blockId: block.blockId,
              blockType: block.blockType,
              baseToken: block.baseToken,
              committedToken: {
                ...block.baseToken,
                contentRevision: live.contentRevision,
              },
              operationUpdate,
              contentOperations: block.contentOperations,
              inverseContentOperations: block.inverseContentOperations,
            }),
          );
          live.releaseContext();
        }
        for (const block of validatedState.removedBlocks) {
          pendingRemovalBlockIds.add(block.blockId);
        }
      } catch (error) {
        activeCommit = null;
        validatedState.status = "failed";
        inconsistent = true;
        releasePreflightResources();
        throw new Error("Fatal Yjs live mutation failure", { cause: error });
      }
      activeCommit = null;
      releasePreflightResources();
      validatedState.status = "applied";
      const applied = Object.freeze({
        kind: "applied-content-commit" as const,
        baseGraphRevision: validatedState.graphRevision,
        graphRevision: validatedState.resultingGraphRevision,
        affectedBlockIds: Object.freeze([
          ...appliedBlocks.map((block) => block.blockId),
          ...validatedState.removedBlocks.map((block) => block.blockId),
        ]),
        blocks: Object.freeze(appliedBlocks),
        replayCapture:
          replayCapture === "inverse"
            ? Object.freeze({
                kind: "inverse" as const,
                steps: Object.freeze([
                  ...inverseStepsByBlock.reverse().flat(),
                  ...removedInverseStepsByBlock.reverse().flat(),
                ]),
              })
            : Object.freeze({ kind: "none" as const }),
        ...(validatedState.origin === undefined
          ? {}
          : { origin: validatedState.origin }),
        id: nextAppliedId++,
      }) as AppliedContentCommit;
      appliedStates.set(applied, {
        status: "applied",
        validated: validatedState,
      });
      return applied;
    },
    publishContentCommit(applied) {
      requireEditableContentAccess();
      const state = appliedStates.get(applied);
      if (!state || state.status !== "applied") {
        throw new Error(
          "Applied Yjs content commit is unknown or already finalized",
        );
      }
      state.status = "released";
      graphRevision = applied.graphRevision;
      // Removed content has no projection phase. Its mounted view is released
      // by the finalized graph-removal notification exactly once.
      for (const block of [...applied.blocks].sort((left, right) =>
        left.blockId < right.blockId
          ? -1
          : left.blockId > right.blockId
            ? 1
            : 0,
      )) {
        notifyBlock(block.blockId, applied);
      }
      for (const block of state.validated.removedBlocks) {
        disposeBlock(block.blockId);
        pendingRemovalBlockIds.delete(block.blockId);
      }
      for (const listener of [...commitListeners]) {
        notifyProjectionSubscriber(() => listener(applied));
      }
      for (const block of state.validated.blocks) {
        const blockState = blocks.get(block.blockId);
        if (!blockState) continue;
        blockState.releaseContext();
      }
    },
    markInconsistent(message): never {
      inconsistent = true;
      throw new Error(`Yjs content runtime is inconsistent: ${message}`);
    },
    readBlockProjection(blockId, blockType) {
      return requireBlock(blockId, blockType).projectionSnapshot;
    },
    readBlockContentCheckpoint(blockId, blockType) {
      const state = requireBlock(blockId, blockType);
      return Object.freeze({
        kind: "checkpoint" as const,
        format: state.opaqueCheckpoint.format,
        version: state.opaqueCheckpoint.version,
        payload: EditorImmutableBinary.takeOwnership(
          decodeOpaqueCheckpoint(state.opaqueCheckpoint),
        ),
      });
    },
    readBlockPlainText(blockId, blockType) {
      return extractPlainTextFromRichTextDocument(
        requireBlock(blockId, blockType).projectionSnapshot,
      );
    },
    createTextAnchorInContext(lease, input) {
      try {
        const context = requireOwnedLeaseContext(lease);
        return createAnchorInContext(context, lease.blockId, input);
      } catch (error) {
        return {
          ok: false,
          reason: "missing-text",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    createOperationAnchorInContext(lease, input) {
      try {
        const context = requireOwnedLeaseContext(lease);
        const anchor = createYjsOperationAnchor(
          context,
          lease.blockId,
          input.textOffset,
          input.association,
        );
        return anchor ? { ok: true, anchor } : { ok: false, reason: "invalid" };
      } catch (error) {
        return {
          ok: false,
          reason: "missing-text",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    tryCreateTextAnchorInLiveContext(input) {
      const state = blocks.get(input.blockId);
      if (!state || state.blockType !== input.blockType) {
        return { ok: false, reason: "missing-text" };
      }
      const context = state.peekContext();
      if (!context || state.leaseCount === 0) {
        return { ok: false, reason: "not-live" };
      }
      return createAnchorInContext(context, input.blockId, input);
    },
    resolveTextAnchorInContext(lease, input) {
      if (input.codec !== YJS_RELATIVE_TEXT_ANCHOR_CODEC) {
        return { ok: false, reason: "invalid" };
      }
      try {
        const context = requireOwnedLeaseContext(lease);
        const decoded = createYjsRelativeTextPointCodec(context).decode({
          blockId: lease.blockId,
          offset: 0,
          relative: input.payload,
        });
        return decoded.ok
          ? { ok: true, textOffset: decoded.point.offset }
          : { ok: false, reason: "invalid" };
      } catch (error) {
        return {
          ok: false,
          reason: "missing-text",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    resolveOperationAnchorInContext(lease, anchor) {
      return runtime.resolveTextAnchorInContext(lease, {
        codec: anchor.codec,
        payload: anchor.payload as unknown as {
          encoded: string;
          assoc?: -1 | 0 | 1;
        },
      });
    },
    tryResolveTextAnchorInLiveContext(input) {
      if (input.codec !== YJS_RELATIVE_TEXT_ANCHOR_CODEC) {
        return { ok: false, reason: "invalid" };
      }
      const state = blocks.get(input.blockId);
      if (!state || state.blockType !== input.blockType) {
        return { ok: false, reason: "missing-text" };
      }
      const context = state.peekContext();
      if (!context || state.leaseCount === 0) {
        return { ok: false, reason: "not-live" };
      }
      const decoded = createYjsRelativeTextPointCodec(context).decode({
        blockId: input.blockId,
        offset: 0,
        relative: input.payload,
      });
      return decoded.ok
        ? { ok: true, textOffset: decoded.point.offset }
        : { ok: false, reason: "invalid" };
    },
    subscribeBlockProjection(blockId, listener) {
      requireLiveRuntime();
      const listeners = blockListeners.get(blockId) ?? new Set<() => void>();
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
    subscribeOperationAnchorInvalidation(listener) {
      requireLiveRuntime();
      anchorInvalidationListeners.add(listener);
      return () => anchorInvalidationListeners.delete(listener);
    },
    getConsistencyState() {
      return inconsistent ? "inconsistent" : "healthy";
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      activeCommit = null;
      blockListeners.clear();
      commitListeners.clear();
      anchorInvalidationListeners.clear();
      for (const state of blocks.values()) state.detachGuard();
      blocks.clear();
      for (const context of liveContexts.values()) context.destroy();
      liveContexts.clear();
    },
  };

  function planContentMutations(
    live: BlockState,
    transitions: readonly PreparedLogicalContentTransition[],
  ): CanonicalYjsContentMutationPlan[] | null {
    const before = transitions[0]?.before ?? live.projectionSnapshot;
    // The projection snapshot and mutation epoch are owned by this runtime.
    // Object identity is therefore the authoritative base check for a local
    // prepared commit; rescanning live Yjs and the complete canonical text here
    // would only re-prove state guarded by the same exclusive commit owner.
    if (
      before !== live.projectionSnapshot &&
      !jsonValuesEqual(before, live.projectionSnapshot)
    ) {
      return null;
    }
    const plans: CanonicalYjsContentMutationPlan[] = [];
    for (const transition of transitions) {
      const plan = planCanonicalYjsContentMutation({
        context: live.context,
        before: transition.before,
        after: transition.after,
        operation: transition.operation,
      });
      if (!plan) return null;
      plans.push(plan);
    }
    return plans;
  }

  function createValidated(
    input: Pick<
      EditorContentCommitInput,
      "graphRevision" | "resultingGraphRevision" | "origin"
    >,
    validatedBlocks: readonly ValidatedBlockState[],
    remote: boolean,
    removedBlocks: readonly ValidatedRemovedBlockState[] = [],
  ): ValidatedContentCommit {
    if (validatedBlocks.length === 1 && removedBlocks.length === 0) {
      const block = validatedBlocks[0]!;
      const publicBlock = Object.freeze({
        blockId: block.blockId,
        blockType: block.blockType,
        contentOperations: block.contentOperations,
        inverseContentOperations: block.inverseContentOperations,
      });
      const validated = Object.freeze({
        kind: "validated-content-commit" as const,
        affectedBlockIds: Object.freeze([block.blockId]),
        blocks: Object.freeze([publicBlock]),
        removedBlocks: Object.freeze([]),
        id: nextValidatedId++,
      });
      validatedStates.set(validated, {
        status: "validated",
        graphRevision: input.graphRevision,
        resultingGraphRevision:
          input.resultingGraphRevision ?? input.graphRevision,
        blocks: Object.freeze([block]),
        removedBlocks: Object.freeze([]),
        origin: input.origin,
        remote,
      });
      return validated;
    }
    const validated = Object.freeze({
      kind: "validated-content-commit" as const,
      affectedBlockIds: Object.freeze([
        ...validatedBlocks.map((block) => block.blockId),
        ...removedBlocks.map((block) => block.blockId),
      ]),
      blocks: Object.freeze([
        ...validatedBlocks
          .filter(
            (block) =>
              !removedBlocks.some(
                (removed) => removed.blockId === block.blockId,
              ),
          )
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
      id: nextValidatedId++,
    });
    validatedStates.set(validated, {
      status: "validated",
      graphRevision: input.graphRevision,
      resultingGraphRevision:
        input.resultingGraphRevision ?? input.graphRevision,
      blocks: Object.freeze([...validatedBlocks]),
      removedBlocks: Object.freeze([...removedBlocks]),
      origin: input.origin,
      remote,
    });
    return validated;
  }

  function createOpaqueBlockState(
    blockId: BlockId,
    blockType: BlockType,
    checkpoint: EditorOpaqueContentCheckpoint,
    projection: EditorRawBlockContent,
    initialContext: BlockContentDocContext | null = null,
  ): BlockState {
    assertOpaqueCheckpointEnvelope(checkpoint);
    let context = initialContext;
    const state: BlockState = {
      blockType,
      get context() {
        if (context) return context;
        const doc = new Doc();
        try {
          const decodedCheckpoint = decodeOpaqueCheckpoint(
            state.opaqueCheckpoint,
          );
          applyUpdate(doc, decodedCheckpoint, HYDRATION_ORIGIN);
          context = createBlockContentDocContext({
            blockId,
            doc,
            destroyDocOnDestroy: true,
          });
          liveContexts.set(blockId, context);
          state.detachGuard = attachMutationGuard(blockId, context);
          return context;
        } catch (error) {
          doc.destroy();
          throw new Error(
            `Cannot hydrate Yjs content for block ${blockId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
      set context(next) {
        context = next;
      },
      contentRevision: 0,
      mutationEpoch: 0,
      // Snapshot projections crossed the editor bootstrap/recovery trust
      // boundary before runtime construction. Preserve that canonical object
      // identity; hydration must not traverse or normalize it again.
      projectionSnapshot: projection,
      detachGuard: () => undefined,
      opaqueCheckpoint: checkpoint,
      leaseCount: 0,
      acceptedRevision: 0,
      peekContext: () => context,
      releaseContext() {
        if (!context || state.leaseCount > 0) return;
        state.detachGuard();
        state.detachGuard = () => undefined;
        deleteLiveContext(blockId);
        context = null;
      },
    };
    if (context) state.detachGuard = attachMutationGuard(blockId, context);
    return state;
  }

  function requireOwnedLeaseContext(
    lease: EditorBlockContentLease,
  ): BlockContentDocContext {
    const context = leaseContexts.get(lease);
    if (!context) {
      throw new Error("Block content lease is not owned by this runtime");
    }
    const state = blocks.get(lease.blockId);
    if (
      !state ||
      state.blockType !== lease.blockType ||
      state.leaseCount < 1 ||
      state.peekContext() !== context
    ) {
      throw new Error(
        `Block content lease for ${lease.blockId} is no longer active`,
      );
    }
    return context;
  }

  function createAnchorInContext(
    context: BlockContentDocContext,
    blockId: BlockId,
    input: {
      readonly textOffset: number;
      readonly affinity: "forward" | "backward" | null;
    },
  ) {
    const encoded = createYjsRelativeTextPointCodec(context).encode(
      { blockId, offset: input.textOffset },
      { assoc: affinityToAssoc(input.affinity) },
    );
    return encoded.ok && encoded.point.relative
      ? {
          ok: true as const,
          codec: YJS_RELATIVE_TEXT_ANCHOR_CODEC,
          payload: encoded.point.relative,
          textOffset: encoded.point.offset,
        }
      : { ok: false as const, reason: "invalid" as const };
  }

  function createYjsOperationAnchor(
    context: BlockContentDocContext,
    blockId: BlockId,
    textOffset: number,
    association: -1 | 1,
  ): EditorOperationAnchor | null {
    const encoded = createYjsRelativeTextPointCodec(context).encode(
      { blockId, offset: textOffset },
      { assoc: association },
    );
    if (!encoded.ok || !encoded.point.relative) return null;
    return Object.freeze({
      codec: YJS_RELATIVE_TEXT_ANCHOR_CODEC,
      payload: Object.freeze({ ...encoded.point.relative }),
      association,
    });
  }

  function createYjsReplayStep(
    context: BlockContentDocContext,
    operation: EditorLogicalContentOperation,
  ): EditorContentOperationReplayStep {
    const requirement = operationAnchorRequirement(operation);
    if (requirement.kind === "position") {
      if (operation.kind !== "insertInlineContent") {
        throw new Error(
          "Position replay requirements require insertion operations",
        );
      }
      const position = createYjsOperationAnchor(
        context,
        operation.blockId,
        requirement.offset,
        requirement.association,
      );
      if (!position)
        throw new Error("Yjs insertion replay anchor capture failed");
      return Object.freeze({
        kind: "content",
        blockId: operation.blockId,
        blockType: operation.blockType,
        operation,
        anchors: Object.freeze({ kind: "position", position }),
      });
    }
    if (operation.kind === "insertInlineContent") {
      throw new Error("Range replay requirements cannot target insertions");
    }
    const start = createYjsOperationAnchor(
      context,
      operation.blockId,
      requirement.startOffset,
      requirement.startAssociation,
    );
    const end = createYjsOperationAnchor(
      context,
      operation.blockId,
      requirement.endOffset,
      requirement.endAssociation,
    );
    if (!start || !end)
      throw new Error("Yjs range replay anchor capture failed");
    return Object.freeze({
      kind: "content",
      blockId: operation.blockId,
      blockType: operation.blockType,
      operation,
      anchors: Object.freeze({ kind: "range", start, end }),
    });
  }

  function readAppliedRemoteProjection(
    live: BlockState,
  ): EditorRawBlockContent {
    // A block may already contain an unaccepted local change in either its
    // live context or its opaque checkpoint. Applying an accepted concurrent
    // peer update therefore legitimately produces a state beyond the server's
    // projection at that accepted revision. Always project the actual merged
    // block-local Y.Doc, including after an inactive context is rehydrated.
    // The Yjs projection mapper is the canonical derivation boundary for a
    // live merged context. The accepted wire projection was already validated
    // above; traversing this result through the normalizer again would perform
    // a second complete rich-text pass for the same accepted update.
    return readContextProjection(live.context);
  }

  function prepareDetachedIntroducedBlock(
    block: ValidatedBlockState,
    origin: EditorYjsCommitOrigin,
  ): DetachedIntroducedBlock {
    const doc = new Doc();
    const initialUpdates: Uint8Array[] = [];
    const collect = (update: Uint8Array) =>
      initialUpdates.push(new Uint8Array(update));
    doc.on("update", collect);
    try {
      const context = createBlockContentDocContext({
        blockId: block.blockId,
        doc,
        destroyDocOnDestroy: true,
      });
      if (block.remoteUpdate) {
        applyUpdate(doc, block.remoteUpdate.payload.copy(), origin);
      } else {
        ensureYjsBlockContent(context, {
          blockType: block.blockType,
          doc: defaultProjection(block.blockType),
          origin,
        });
      }
      const state = createOpaqueBlockState(
        block.blockId,
        block.blockType,
        opaqueCheckpointFromContext(context),
        block.before,
      );
      state.context = context;
      state.contentRevision = block.baseToken.contentRevision;
      let installed = false;
      let destroyed = false;
      return {
        state,
        initialUpdates: Object.freeze(initialUpdates),
        install() {
          if (installed) return;
          if (destroyed) {
            throw new Error(
              `Detached Yjs content for ${block.blockId} was destroyed`,
            );
          }
          if (blocks.has(block.blockId) || liveContexts.has(block.blockId)) {
            throw new Error(`Introduced Yjs block ${block.blockId} now exists`);
          }
          liveContexts.set(block.blockId, context);
          state.detachGuard = attachMutationGuard(block.blockId, context);
          blocks.set(block.blockId, state);
          installed = true;
        },
        destroy() {
          if (installed || destroyed) return;
          destroyed = true;
          context.destroy();
        },
      };
    } catch (error) {
      doc.destroy();
      throw error;
    } finally {
      doc.off("update", collect);
    }
  }

  function attachMutationGuard(
    blockId: BlockId,
    context: BlockContentDocContext,
  ): () => void {
    const isPermittedOrigin = (origin: unknown): boolean => {
      if (
        typeof origin === "object" &&
        origin !== null &&
        permittedInternalOrigins.has(origin)
      ) {
        return true;
      }
      const active = activeCommit;
      return Boolean(
        active &&
        ((typeof origin === "object" &&
          origin !== null &&
          active.origins.has(origin)) ||
          (origin === null && active.updatesByBlockId.has(blockId))),
      );
    };
    const beforeTransaction = (transaction: { readonly origin: unknown }) => {
      if (isPermittedOrigin(transaction.origin)) return;
      throw new Error(
        `Unexpected Yjs mutation for block ${blockId} outside an editor content commit`,
      );
    };
    const observer = (update: Uint8Array, origin: unknown) => {
      if (
        typeof origin === "object" &&
        origin !== null &&
        permittedInternalOrigins.has(origin)
      ) {
        return;
      }
      const active = activeCommit;
      if (
        active &&
        ((typeof origin === "object" &&
          origin !== null &&
          active.origins.has(origin)) ||
          (origin === null && active.updatesByBlockId.has(blockId)))
      ) {
        const updates = active.updatesByBlockId.get(blockId) ?? [];
        updates.push(update);
        active.updatesByBlockId.set(blockId, updates);
        return;
      }
      throw new Error(
        `Unexpected Yjs mutation for block ${blockId} outside an editor content commit`,
      );
    };
    context.doc.on("beforeTransaction", beforeTransaction);
    context.doc.on("update", observer);
    return () => {
      context.doc.off("beforeTransaction", beforeTransaction);
      context.doc.off("update", observer);
    };
  }

  function mergeCapturedUpdates(blockId: BlockId): {
    readonly bytes: Uint8Array;
    readonly ownership: "borrowed" | "owned";
  } {
    const updates = activeCommit?.updatesByBlockId.get(blockId) ?? [];
    if (updates.length === 0) {
      return { bytes: new Uint8Array(), ownership: "owned" };
    }
    return updates.length === 1
      ? { bytes: updates[0]!, ownership: "borrowed" }
      : { bytes: mergeUpdates(updates), ownership: "owned" };
  }

  function requireBlock(blockId: BlockId, blockType: BlockType): BlockState {
    if (pendingRemovalBlockIds.has(blockId)) {
      throw new Error(`Yjs content block ${blockId} does not exist`);
    }
    const state = blocks.get(blockId);
    if (!state) throw new Error(`Yjs content block ${blockId} does not exist`);
    if (state.blockType !== blockType) {
      throw new Error(
        `Yjs content block ${blockId} has type ${state.blockType}, not ${blockType}`,
      );
    }
    return state;
  }

  function isTextBlock(blockType: BlockType): boolean {
    const definition = blockDefinitions[blockType];
    if (!definition)
      throw new Error(`Missing block definition for ${blockType}`);
    return definition.kind === "text";
  }

  function validateGraphRevision(
    requested: number,
  ): ContentCommitRejection | null {
    return requested === graphRevision
      ? null
      : rejection(
          "stale-graph-revision",
          `Yjs graph revision ${requested} does not match ${graphRevision}`,
        );
  }

  function validateBaseToken(
    token: EditorContentBaseToken,
    changeIndex?: number,
  ): ContentCommitRejection | null {
    const graphFailure = validateGraphRevision(token.graphRevision);
    if (graphFailure) return { ...graphFailure, changeIndex };
    const state = blocks.get(token.blockId);
    if (!state) {
      return rejection(
        "missing-block",
        `Yjs content block ${token.blockId} does not exist`,
        token.blockId,
        changeIndex,
      );
    }
    if (state.blockType !== token.blockType) {
      return rejection(
        "block-type-mismatch",
        `Yjs content block ${token.blockId} has type ${state.blockType}, not ${token.blockType}`,
        token.blockId,
        changeIndex,
      );
    }
    if (state.contentRevision !== token.contentRevision) {
      return rejection(
        "stale-content-revision",
        `Yjs content block ${token.blockId} revision ${token.contentRevision} does not match ${state.contentRevision}`,
        token.blockId,
        changeIndex,
      );
    }
    return null;
  }

  function notifyBlock(blockId: BlockId, commit?: AppliedContentCommit): void {
    for (const listener of [...(blockListeners.get(blockId) ?? [])]) {
      notifyProjectionSubscriber(() => listener(commit));
    }
  }

  function disposeBlock(blockId: BlockId): void {
    const state = blocks.get(blockId);
    if (!state) return;
    state.detachGuard();
    blocks.delete(blockId);
    deleteLiveContext(blockId);
  }

  function requireLiveRuntime(): void {
    if (destroyed) throw new Error("Yjs content runtime is destroyed");
  }

  function deleteLiveContext(blockId: BlockId): void {
    const context = liveContexts.get(blockId);
    if (!context) return;
    liveContexts.delete(blockId);
    context.destroy();
  }

  function requireEditableContentAccess(): void {
    requireLiveRuntime();
    if (inconsistent) {
      throw new Error(
        "Yjs content runtime is inconsistent and editing is disabled",
      );
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

export const yjsBlockContentStore: EditorContentStoreSlot<YjsBlockContentRuntime> =
  {
    format: EDITOR_YJS_CONTENT_FORMAT,
    createRuntime({ source }) {
      return createYjsBlockContentRuntime(source);
    },
  };

function readSourceBlockTypes(
  source: EditorContentRuntimeSource,
): readonly [BlockId, BlockType][] {
  return Object.entries(source.blockTypesById) as [BlockId, BlockType][];
}

function defaultProjection(blockType: BlockType): EditorRawBlockContent {
  return createBlockRichTextContentFromPlainText(blockType, "");
}

function readContextProjection(
  context: BlockContentDocContext,
): EditorRawBlockContent {
  const projection = readYjsBlockContentDocument(context);
  if (
    !projection ||
    typeof projection !== "object" ||
    Array.isArray(projection) ||
    projection.type !== "doc"
  ) {
    throw new Error(
      `Yjs block ${context.blockId} has invalid rich-text content`,
    );
  }
  return projection as EditorRawBlockContent;
}

function ownProjection(content: EditorRawBlockContent): EditorRawBlockContent {
  const freeze = (value: unknown): void => {
    if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
      return;
    }
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  };
  freeze(content);
  return content;
}

function contentEqual(
  left: EditorRawBlockContent,
  right: EditorRawBlockContent,
): boolean {
  return jsonValuesEqual(left, right);
}

function sortedBlockIds(values: Iterable<BlockId>): BlockId[] {
  return [...values].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function rejection(
  reason: ContentCommitRejection["reason"],
  message: string,
  blockId?: BlockId,
  changeIndex?: number,
): ContentCommitRejection {
  return {
    ok: false,
    reason,
    message,
    ...(blockId === undefined ? {} : { blockId }),
    ...(changeIndex === undefined ? {} : { changeIndex }),
  };
}

function freezeBaseToken(
  token: EditorContentBaseToken,
): EditorContentBaseToken {
  return Object.freeze({ ...token });
}

function encodeOperationUpdate(payload: {
  readonly bytes: Uint8Array;
  readonly ownership: "borrowed" | "owned";
}): EditorContentOperationUpdate {
  return Object.freeze({
    kind: "operation" as const,
    format: EDITOR_YJS_CONTENT_FORMAT,
    version: EDITOR_YJS_CONTENT_FORMAT_VERSION,
    payload:
      payload.ownership === "owned"
        ? EditorImmutableBinary.takeOwnership(payload.bytes)
        : EditorImmutableBinary.copyOf(payload.bytes),
  });
}

function assertOperationEnvelope(update: EditorContentOperationUpdate): void {
  assertEnvelope(update, "operation");
}

function assertOpaqueCheckpointEnvelope(
  checkpoint: EditorOpaqueContentCheckpoint,
): void {
  if (
    checkpoint.kind !== "checkpoint" ||
    checkpoint.format !== EDITOR_YJS_CONTENT_FORMAT ||
    checkpoint.version !== EDITOR_YJS_CONTENT_FORMAT_VERSION ||
    typeof checkpoint.payloadBase64 !== "string" ||
    checkpoint.payloadBase64.length === 0
  ) {
    throw new Error("Unsupported opaque Yjs block checkpoint envelope");
  }
}

function opaqueCheckpointFromContext(
  context: BlockContentDocContext,
): EditorOpaqueContentCheckpoint {
  return Object.freeze({
    kind: "checkpoint",
    format: EDITOR_YJS_CONTENT_FORMAT,
    version: EDITOR_YJS_CONTENT_FORMAT_VERSION,
    payloadBase64: encodeBase64(encodeStateAsUpdate(context.doc)),
  });
}

function mergeOpaqueBlockUpdate(
  checkpoint: EditorOpaqueContentCheckpoint,
  update: EditorContentOperationUpdate,
): EditorOpaqueContentCheckpoint {
  assertOpaqueCheckpointEnvelope(checkpoint);
  assertOperationEnvelope(update);
  return Object.freeze({
    kind: "checkpoint",
    format: checkpoint.format,
    version: checkpoint.version,
    payloadBase64: encodeBase64(
      mergeUpdates([decodeOpaqueCheckpoint(checkpoint), update.payload.copy()]),
    ),
  });
}

function decodeOpaqueCheckpoint(
  checkpoint: EditorOpaqueContentCheckpoint,
): Uint8Array {
  assertOpaqueCheckpointEnvelope(checkpoint);
  // Snapshot decoding is the trust boundary and has already proved that this
  // is canonical base64. Activation owns binary decoding, not a second full
  // validation and re-encoding pass over the same checkpoint.
  const binary = globalThis.atob(checkpoint.payloadBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
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

function assertEnvelope(
  envelope: EditorContentOperationUpdate | EditorContentCheckpoint,
  kind: "operation" | "checkpoint",
): void {
  if (envelope.kind !== kind) {
    throw new Error(`Expected a Yjs ${kind} envelope`);
  }
  if (envelope.format !== EDITOR_YJS_CONTENT_FORMAT) {
    throw new Error(`Unknown Yjs content format ${envelope.format}`);
  }
  if (envelope.version !== EDITOR_YJS_CONTENT_FORMAT_VERSION) {
    throw new Error(`Unknown Yjs content version ${envelope.version}`);
  }
  if (!(envelope.payload instanceof EditorImmutableBinary)) {
    throw new Error("Yjs encoded content payload must be immutable binary");
  }
}

function ownOperationUpdate(
  update: EditorContentOperationUpdate,
): EditorContentOperationUpdate {
  assertOperationEnvelope(update);
  return Object.freeze({
    kind: "operation" as const,
    format: update.format,
    version: update.version,
    payload: update.payload,
  });
}

function ownAppliedBlock(block: AppliedContentBlock): AppliedContentBlock {
  return Object.freeze({
    ...block,
    baseToken: freezeBaseToken(block.baseToken),
    committedToken: freezeBaseToken(block.committedToken),
    operationUpdate: block.operationUpdate,
    contentOperations: ownPublishedLogicalContentOperations(
      block.contentOperations,
    ),
    inverseContentOperations: ownPublishedLogicalContentOperations(
      block.inverseContentOperations,
    ),
  });
}

function affinityToAssoc(affinity: "forward" | "backward" | null): -1 | 0 | 1 {
  if (affinity === "backward") return -1;
  if (affinity === "forward") return 1;
  return 0;
}

function restorationOperations(
  blockId: BlockId,
  blockType: BlockType,
  content: EditorRawBlockContent,
): readonly EditorLogicalContentOperation[] {
  const restoredContent = richTextBlockInlineContent(content);
  return Object.freeze(
    restoredContent.length === 0
      ? []
      : [
          {
            kind: "insertInlineContent" as const,
            blockId,
            blockType,
            target: { kind: "text" as const },
            position: { blockId, offset: 0 },
            content: restoredContent,
          },
        ],
  );
}
