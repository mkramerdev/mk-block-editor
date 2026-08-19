import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import type { BlockType, VersionedBlock } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import { asBlockId } from "@repo/editor-core/kernel";
import {
  applyLogicalContentOperationToRichTextDocument,
  createBlockRichTextContentFromPlainText,
  createInverseLogicalContentOperation,
  extractPlainTextFromRichTextDocument,
  isRichTextDocument,
  richInlineContentSize,
  richTextDocumentContentSize,
  type RichTextDocumentNodeJson,
} from "@repo/editor-core/content/rich-text";
import {
  createCanonicalBlockFragment,
  type StructuralEditRange,
} from "@repo/editor-core/editing";
import { createVersionedBlockRecord } from "@repo/editor-core/metadata";
import type {
  ContentOperationProposalAcceptanceContext,
  EditorContentCommitInput,
  EditorContentCommitPort,
  ValidatedContentCommit,
} from "../operations/content-commit.ts";
import type { EditorLogicalContentOperation } from "@repo/editor-core/operations";
import type {
  EditorSelection,
  EditorLogicalSelectionPoint,
  EditorSelectionTextAffinity,
  EditorSelectionTextAnchor,
} from "../../../selection/model/types.ts";
import type {
  CanonicalEditorCommit,
  InitializeEditorImplementationOptions,
} from "../api/contracts.ts";
import type { EditorHistoryEntry } from "../history.ts";
import { createEditorExternalStore } from "../../../store/external-store.ts";
import { createInitialEditorSessionState } from "../../../store/session-state.ts";
import { createEditorSelectionTextAnchor } from "../../../selection/anchors/text-anchor.ts";
import { registerInternalSelectionSubsystem } from "../../../selection/model/committed-selection-snapshot.ts";
import { projectCanonicalSelectionToTransaction } from "../../../selection/model/stable-selection.ts";
import { executeStructuralEditComposition } from "../operations/structural-composition.ts";
import { createInitialEditorManifestState } from "../state/command-state.ts";
import { EditorImplementation } from "./editor-implementation.ts";

const renderer = () => null;
const definitions: Readonly<Record<BlockType, BlockDefinition>> = {
  paragraph: {
    kind: "text",
    type: "paragraph",
    rootLayout: "normal",
    renderer,
    split: { default: "paragraph" },
  },
  divider: {
    kind: "atomic",
    type: "divider",
    rootLayout: "normal",
    renderer,
  },
  placeholder: {
    kind: "atomic",
    type: "placeholder",
    rootLayout: "normal",
    renderer,
    replaceWith: "paragraph",
  },
  restorativeBody: {
    kind: "wrapper",
    type: "restorativeBody",
    rootLayout: "normal",
    renderer,
    contentBoundary: false,
    content: { required: ["block"], additional: "block" },
    defaultContent: "placeholder",
  },
  callout: {
    kind: "wrapper",
    type: "callout",
    rootLayout: "normal",
    renderer,
    contentBoundary: false,
    content: { required: ["block"], additional: "block" },
    defaultContent: "paragraph",
    rangeDeletion: { kind: "unwrap-boundary-contents" },
  },
  quote: {
    kind: "wrapper",
    type: "quote",
    rootLayout: "normal",
    renderer,
    contentBoundary: false,
    content: { required: ["paragraph"] },
    rangeDeletion: { kind: "unwrap-boundary-contents" },
  },
};

const id = (suffix: number): BlockId =>
  asBlockId(`01890f07-1c00-7000-8000-${String(suffix).padStart(12, "0")}`);
const internalSelectionSubsystem = registerInternalSelectionSubsystem(
  "test.programmatic-block-selection",
)!;

function text(value: string): RichTextDocumentNodeJson {
  return createBlockRichTextContentFromPlainText("paragraph", value);
}

function markedTextWithInlineAtoms(): RichTextDocumentNodeJson {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "lead " },
          { type: "mention", metadata: { id: "ada" } },
          { type: "text", text: " and " },
          { type: "mention", metadata: { id: "grace" } },
          {
            type: "text",
            text: "tail.",
            marks: [{ type: "strong" }],
          },
        ],
      },
    ],
  };
}

function block(
  suffix: number,
  type: BlockType,
  parentId: BlockId | null = null,
): VersionedBlock {
  return createVersionedBlockRecord({
    id: id(suffix),
    type,
    parentId,
    version: {
      metadataVersion: "1",
      contentVersion: definitions[type]?.kind === "text" ? "1" : null,
    },
  });
}

function resolvedBlockRange(
  target: VersionedBlock,
  graphRevision = 1,
): StructuralEditRange {
  return {
    graphRevision,
    selectionRevision: 1,
    blocks: [
      {
        kind: "block",
        blockId: target.id,
        blockType: target.type,
        parentId: target.parentId,
      },
    ],
    start: { kind: "block", blockId: target.id },
    end: { kind: "block", blockId: target.id },
  };
}

function paragraphFragment(...suffixes: readonly number[]) {
  const records = suffixes.map((suffix) => ({
    id: id(suffix),
    type: "paragraph",
    parentId: null,
    content: text(`paragraph ${suffix}`),
    plainText: `paragraph ${suffix}`,
  }));
  return createCanonicalBlockFragment({
    blocks: records,
    rootBlockIds: records.map((record) => record.id),
    start: { kind: "block", blockId: records[0]!.id },
    end: { kind: "block", blockId: records.at(-1)!.id },
    blockDefinitions: definitions,
  });
}

function createTestEditor(
  options: {
    readonly blocks?: readonly VersionedBlock[];
    readonly content?: ReadonlyMap<BlockId, RichTextDocumentNodeJson>;
    readonly rejectContentOperations?: boolean;
    readonly failContentApplication?: boolean;
    readonly preparedNoChangeCount?: number;
    readonly materializeAppliedBlocks?: boolean;
    readonly onCanonicalCommit?: (
      commit: CanonicalEditorCommit,
      editor: EditorImplementation,
    ) => void;
    readonly selectionAnchorRuntime?: AssociationAwareTestAnchorRuntime;
    readonly selectionAnchorRequiresContentAccess?: boolean;
    readonly documentValidators?: InitializeEditorImplementationOptions["documentValidators"];
  } = {},
) {
  const blocks = options.blocks ?? [block(1, "paragraph")];
  const content = new Map(options.content ?? [[blocks[0]!.id, text("one")]]);
  const roots = blocks
    .filter((entry) => entry.parentId === null)
    .map((entry) => entry.id);
  const children = {} as Partial<Record<BlockId, BlockId[]>>;
  for (const entry of blocks) {
    if (entry.parentId !== null) {
      (children[entry.parentId] ??= []).push(entry.id);
    }
  }
  const onCanonicalCommit = vi.fn((commit: CanonicalEditorCommit) =>
    options.onCanonicalCommit?.(commit, editorRef.current!),
  );
  const preparedState = new WeakMap<
    ValidatedContentCommit,
    {
      readonly input: EditorContentCommitInput;
      readonly before: Map<BlockId, RichTextDocumentNodeJson | undefined>;
    }
  >();
  let preparedCommitCount = 0;
  const validateContentCommit = vi.fn((input: EditorContentCommitInput) => {
    if (options.rejectContentOperations) {
      return {
        ok: false as const,
        reason: "invalid-operation" as const,
        message: "test content preparation rejected",
      };
    }
    preparedCommitCount += 1;
    const prepared = {
      kind: "validated-content-commit" as const,
      affectedBlockIds:
        preparedCommitCount <= (options.preparedNoChangeCount ?? 0)
          ? []
          : [
              ...new Set(
                input.changes.map((change) => change.baseToken.blockId),
              ),
            ],
      blocks: input.changes.map((change) => ({
        blockId: change.baseToken.blockId,
        blockType: change.baseToken.blockType,
        contentOperations: change.operations,
        inverseContentOperations: change.operations
          .map((operation) => createInverseLogicalContentOperation(operation))
          .filter(
            (operation): operation is EditorLogicalContentOperation =>
              operation !== null,
          )
          .reverse(),
      })),
      removedBlocks: [],
    };
    preparedState.set(prepared, {
      input,
      before: new Map(
        input.changes.map((change) => [
          change.baseToken.blockId,
          input.introducedBlocks?.[change.baseToken.blockId]
            ? undefined
            : content.get(change.baseToken.blockId),
        ]),
      ),
    });
    return prepared;
  });
  const commitContent = vi.fn((prepared: ValidatedContentCommit) => {
    if (options.failContentApplication) {
      throw new Error("test content application failed");
    }
    const state = preparedState.get(prepared);
    if (!state) throw new Error("unknown prepared test commit");
    for (const change of state.input.changes) {
      let next = state.input.introducedBlocks?.[change.baseToken.blockId]
        ? createBlockRichTextContentFromPlainText(
            change.baseToken.blockType,
            "",
          )
        : content.get(change.baseToken.blockId);
      for (const operation of change.operations) {
        next =
          applyLogicalContentOperationToRichTextDocument(
            operation.blockType,
            next,
            operation,
            {
              blockDefinitions: definitions,
              inlineMarks: [],
            },
          ) ?? undefined;
        if (!next) {
          throw new Error("test logical content operation failed");
        }
        options.selectionAnchorRuntime?.apply(operation);
      }
      if (next) content.set(change.baseToken.blockId, next);
    }
    const applied = {
      kind: "applied-content-commit" as const,
      baseGraphRevision: state.input.graphRevision,
      graphRevision:
        state.input.resultingGraphRevision ?? state.input.graphRevision,
      affectedBlockIds: prepared.affectedBlockIds,
      blocks: options.materializeAppliedBlocks
        ? state.input.changes.map((change) => {
            return {
              blockId: change.baseToken.blockId,
              blockType: change.baseToken.blockType,
              baseToken: change.baseToken,
              committedToken: {
                ...change.baseToken,
                contentRevision: change.baseToken.contentRevision + 1,
              },
              operationUpdate: {} as never,
              contentOperations: change.operations,
              inverseContentOperations: [...change.operations]
                .reverse()
                .map((operation) => {
                  const inverse =
                    createInverseLogicalContentOperation(operation);
                  if (!inverse) {
                    throw new Error(
                      "test content preparation accepted a non-reversible operation",
                    );
                  }
                  return inverse;
                }),
            };
          })
        : [],
      origin: state.input.origin,
    };
    return applied;
  });
  const publishContentCommit = vi.fn();
  const markInconsistent = vi.fn((message: string): never => {
    throw new Error(`test content runtime inconsistent: ${message}`);
  });
  const contentCommit: EditorContentCommitPort = {
    readContentBaseToken(blockId, blockType, graphRevision) {
      return { blockId, blockType, graphRevision, contentRevision: 0 };
    },
    validateContentCommit,
    validateContentTextPoint(prepared, point) {
      const state = preparedState.get(prepared);
      if (!state) return { ok: false, reason: "invalid" };
      const change = state.input.changes.find(
        (candidate) => candidate.baseToken.blockId === point.blockId,
      );
      let next = change
        ? state.before.get(point.blockId)
        : content.get(point.blockId);
      if (change) {
        for (const operation of change.operations) {
          next = next
            ? (applyLogicalContentOperationToRichTextDocument(
                operation.blockType,
                next,
                operation,
                { blockDefinitions: definitions, inlineMarks: [] },
              ) ?? undefined)
            : undefined;
        }
      }
      return next &&
        Number.isInteger(point.textOffset) &&
        point.textOffset >= 0 &&
        point.textOffset <= richTextDocumentContentSize(next)
        ? { ok: true, textOffset: point.textOffset }
        : { ok: false, reason: "invalid" };
    },
    readValidatedBlockContent(prepared, blockId) {
      const state = preparedState.get(prepared);
      if (!state || state.input.removedBlockIds?.includes(blockId)) return null;
      const change = state.input.changes.find(
        (candidate) => candidate.baseToken.blockId === blockId,
      );
      let next = change ? state.before.get(blockId) : content.get(blockId);
      for (const operation of change?.operations ?? []) {
        next = next
          ? (applyLogicalContentOperationToRichTextDocument(
              operation.blockType,
              next,
              operation,
              { blockDefinitions: definitions, inlineMarks: [] },
            ) ?? undefined)
          : undefined;
      }
      return next ?? null;
    },
    commitContent,
    publishContentCommit,
    markInconsistent,
  };
  const requestNativeFocus = vi.fn(() => ({ status: "focused" as const }));
  const releaseNativeFocus = vi.fn();
  const presentTextProjection = vi.fn(() => ({ status: "focused" as const }));
  const blurEditor = vi.fn();
  const contentAccessCounts = new Map<BlockId, number>();
  const acquireTextContentAccess = vi.fn((blockId: BlockId) => {
    contentAccessCounts.set(
      blockId,
      (contentAccessCounts.get(blockId) ?? 0) + 1,
    );
    return () => {
      const next = (contentAccessCounts.get(blockId) ?? 1) - 1;
      if (next === 0) contentAccessCounts.delete(blockId);
      else contentAccessCounts.set(blockId, next);
    };
  });
  const editorRef: { current: EditorImplementation | null } = {
    current: null,
  };
  const editor = new EditorImplementation({
    store: createEditorExternalStore(createInitialEditorSessionState({})),
    manifest: createInitialEditorManifestState({
      blocks: Object.fromEntries(blocks.map((entry) => [entry.id, entry])),
      rootBlockIds: roots,
      childIdsByParentId: children,
    }),
    blockDefinitions: definitions,
    defaultRootBlockType: "paragraph",
    inlineMarks: [],
    documentValidators: options.documentValidators,
    onCanonicalCommit,
    readBlockContent: (blockId) => content.get(blockId) ?? null,
    readBlockPlainText: (blockId) => {
      const value = content.get(blockId);
      return value ? extractPlainTextFromRichTextDocument(value) : "";
    },
    resolveSelectionTextAnchor: (point) =>
      options.selectionAnchorRequiresContentAccess &&
      !contentAccessCounts.has(point.blockId)
        ? { ok: false, reason: "missing-text", blockId: point.blockId }
        : (options.selectionAnchorRuntime?.resolve(point) ?? {
            ok: true,
            blockId: point.blockId,
            textAnchor: point.textAnchor!,
            textOffset: point.textOffset,
            affinity: point.affinity,
          }),
    createSelectionTextAnchor: (input) => {
      if (
        options.selectionAnchorRequiresContentAccess &&
        !contentAccessCounts.has(input.blockId)
      ) {
        return { ok: false as const };
      }
      if (options.selectionAnchorRuntime) {
        return options.selectionAnchorRuntime.create(input);
      }
      const anchor = createEditorSelectionTextAnchor({
        codec: "test-runtime-anchor",
        payload: {
          encoded: "AQ==",
          assoc:
            input.affinity === "backward"
              ? -1
              : input.affinity === "forward"
                ? 1
                : 0,
        },
      });
      return anchor.ok
        ? {
            ok: true as const,
            textAnchor: anchor.textAnchor,
            textOffset: input.textOffset,
          }
        : { ok: false as const };
    },
    validateBlockContent: (_blockType, value) => isRichTextDocument(value),
    contentCommit,
    acquireTextContentAccess,
    requestNativeFocus,
    releaseNativeFocus,
    presentTextProjection,
    blurEditor,
  });
  editorRef.current = editor;
  const publications = vi.fn();
  const unsubscribe = editor.subscribeManifest(publications);
  return {
    editor,
    content,
    onCanonicalCommit,
    validateContentCommit,
    commitContent,
    publishContentCommit,
    markInconsistent,
    acquireTextContentAccess,
    readTextContentAccessCount: (blockId: BlockId) =>
      contentAccessCounts.get(blockId) ?? 0,
    requestNativeFocus,
    releaseNativeFocus,
    presentTextProjection,
    blurEditor,
    publications,
    dispose: () => {
      unsubscribe();
      editor.dispose();
    },
  };
}

describe("EditorImplementation active transaction", () => {
  it("does not reproject a native selection already established by the accepted ProseMirror state", () => {
    const fixture = createTestEditor({
      content: new Map([[id(1), text("hello")]]),
      materializeAppliedBlocks: true,
    });

    expect(
      fixture.editor.acceptContentOperationProposal(
        contentInsertionProposal(fixture.editor, 5, "!", 6, 6),
        {
          origin: "prosemirror-proposal",
          selectionPresentation: "native-already-established",
          provenance: null,
        },
      ),
    ).toMatchObject({ ok: true });

    expect(fixture.presentTextProjection).not.toHaveBeenCalled();
    expect(readContentText(fixture, id(1))).toBe("hello!");
    expect(readCanonicalSelection(fixture.editor)).toEqual({
      direction: "forward",
      anchor: 6,
      focus: 6,
    });
    fixture.dispose();
  });

  it("validates text focus actions in canonical rich-text coordinates", () => {
    const content = markedTextWithInlineAtoms();
    const fixture = createTestEditor({ content: new Map([[id(1), content]]) });
    const canonicalSize = richTextDocumentContentSize(content);
    const plainTextSize = richInlineContentSize([
      { type: "text", text: extractPlainTextFromRichTextDocument(content) },
    ]);
    const afterFirstAtom = richInlineContentSize([
      { type: "text", text: "lead " },
      { type: "mention", metadata: { id: "ada" } },
    ]);

    expect(richInlineContentSize([{ type: "mention", metadata: {} }])).toBe(1);
    expect(canonicalSize).toBe(plainTextSize + 2);
    expect(fixture.editor.focusText(id(1), { offset: afterFirstAtom })).toEqual(
      {
        status: "focused",
      },
    );
    expect(readCanonicalSelection(fixture.editor)).toMatchObject({
      anchor: afterFirstAtom,
      focus: afterFirstAtom,
    });
    expect(fixture.editor.focusText(id(1), { offset: canonicalSize })).toEqual({
      status: "focused",
    });
    expect(readCanonicalSelection(fixture.editor)).toMatchObject({
      anchor: canonicalSize,
      focus: canonicalSize,
    });
    fixture.dispose();
  });

  it("rejects invalid public focus requests before touching native focus", () => {
    const fixture = createTestEditor();

    expect(fixture.editor.focusBlock(id(1))).toEqual({
      status: "rejected",
      reason: "wrong-block-kind",
    });
    expect(fixture.editor.focusText(id(99), { offset: 0 })).toEqual({
      status: "rejected",
      reason: "missing-block",
    });
    expect(fixture.editor.focusText(id(1), { offset: 999 })).toEqual({
      status: "rejected",
      reason: "invalid-offset",
    });
    expect(fixture.requestNativeFocus).not.toHaveBeenCalled();
    expect(fixture.editor.selection.getSnapshot()).toEqual({
      kind: "none",
      revision: 0,
    });
    fixture.dispose();
  });

  it("publishes one changed public focus settlement and no unchanged duplicate", () => {
    const fixture = createTestEditor();
    const settlements = vi.fn();
    const unsubscribe =
      fixture.editor.selectionController.subscribeStandaloneSettlements(
        settlements,
      );

    expect(fixture.editor.focusText(id(1), { offset: 1 })).toEqual({
      status: "focused",
    });
    expect(fixture.editor.focusText(id(1), { offset: 1 })).toEqual({
      status: "focused",
    });
    expect(settlements).toHaveBeenCalledOnce();
    expect(readCanonicalSelection(fixture.editor)).toMatchObject({
      anchor: 1,
      focus: 1,
    });

    unsubscribe();
    fixture.dispose();
  });

  it("settles selection before rejecting failed or stale text activation", () => {
    const fixture = createTestEditor();
    expect(fixture.editor.focusText(id(1), { offset: 1 })).toEqual({
      status: "focused",
    });

    fixture.presentTextProjection.mockReturnValueOnce({
      status: "rejected",
      reason: "native-focus-failed",
    });
    expect(fixture.editor.focusText(id(1), { offset: 2 })).toEqual({
      status: "rejected",
      reason: "native-focus-failed",
    });
    expect(readCanonicalSelection(fixture.editor)).toMatchObject({
      anchor: 2,
      focus: 2,
    });

    fixture.presentTextProjection.mockImplementationOnce(() => {
      expect(
        fixture.editor.updateBlockMetadata([
          { blockId: id(1), values: { reentrant: true } },
        ]),
      ).toBe(true);
      return { status: "rejected", reason: "stale-selection" };
    });
    expect(fixture.editor.focusText(id(1), { offset: 2 })).toEqual({
      status: "rejected",
      reason: "native-focus-failed",
    });
    expect(fixture.releaseNativeFocus).not.toHaveBeenCalled();
    expect(readCanonicalSelection(fixture.editor)).toMatchObject({
      anchor: 2,
      focus: 2,
    });
    fixture.dispose();
  });

  it("derives outside-edge replay associations for inserted content and restored ranges", () => {
    const deletionAnchors = createAssociationAwareTestAnchorRuntime();
    const deletionFixture = createTestEditor({
      content: new Map([[id(1), text("hello world")]]),
      materializeAppliedBlocks: true,
      selectionAnchorRuntime: deletionAnchors,
    });
    const left = deletionAnchors.selection(id(1), 5, "backward");
    const right = deletionAnchors.selection(id(1), 11, "forward");
    deletionFixture.editor.selectionController.commitCanonicalSelection(
      {
        direction: "forward",
        anchor: left.anchor,
        focus: right.focus,
      },
      deletionFixture.editor,
      1,
      { publication: { kind: "standalone-local" }, cause: "keyboard" },
      { resolveTextAnchor: deletionAnchors.resolve },
    );
    const base = {
      blockId: id(1),
      blockType: "paragraph" as const,
      graphRevision: 1,
      contentRevision: 0,
    };
    expect(
      deletionFixture.editor.acceptContentOperationProposal(
        {
          base,
          operations: [
            {
              kind: "deleteInlineRange",
              blockId: id(1),
              blockType: "paragraph",
              target: { kind: "text" },
              range: {
                from: { blockId: id(1), offset: 5 },
                to: { blockId: id(1), offset: 11 },
              },
              deletedContent: [{ type: "text", text: " world" }],
            },
          ],
          selectionAfter: {
            direction: "forward",
            anchor: {
              blockId: id(1),
              blockType: "paragraph",
              textOffset: 5,
              affinity: "backward",
            },
            focus: {
              blockId: id(1),
              blockType: "paragraph",
              textOffset: 5,
              affinity: "backward",
            },
          },
        },
        {
          origin: "prosemirror-proposal",
          selectionPresentation: "native-already-established",
          provenance: null,
        },
      ).ok,
    ).toBe(true);
    const deletionHistory = (
      deletionFixture.editor as unknown as {
        readonly history: readonly EditorHistoryEntry[];
      }
    ).history[0];
    if (deletionHistory?.selectionBefore.kind !== "document") {
      throw new Error("Expected document selection history");
    }
    expect(
      deletionHistory.selectionBefore.selection.anchor.textAnchor?.payload
        .assoc,
    ).toBe(-1);
    expect(
      deletionHistory.selectionBefore.selection.focus.textAnchor?.payload.assoc,
    ).toBe(1);
    if (deletionHistory.selectionAfter.kind !== "document") {
      throw new Error("Expected document selection history");
    }
    expect(
      deletionHistory.selectionAfter.selection.focus.textAnchor?.payload.assoc,
    ).toBe(1);
    expect(deletionFixture.editor.undo()).toEqual({ status: "applied" });
    expect(readContentText(deletionFixture, id(1))).toBe("hello world");
    expect(readCanonicalSelection(deletionFixture.editor)).toEqual({
      direction: "forward",
      anchor: 5,
      focus: 11,
    });
    expect(deletionFixture.editor.redo()).toEqual({ status: "applied" });
    expect(readContentText(deletionFixture, id(1))).toBe("hello");
    expect(readCanonicalSelection(deletionFixture.editor)).toEqual({
      direction: "forward",
      anchor: 5,
      focus: 5,
    });
    expect(deletionFixture.editor.undo()).toEqual({ status: "applied" });
    expect(readCanonicalSelection(deletionFixture.editor)).toEqual({
      direction: "forward",
      anchor: 5,
      focus: 11,
    });
    deletionFixture.dispose();

    const insertionAnchors = createAssociationAwareTestAnchorRuntime();
    const insertionFixture = createTestEditor({
      content: new Map([[id(1), text("hello")]]),
      materializeAppliedBlocks: true,
      selectionAnchorRuntime: insertionAnchors,
    });
    insertionFixture.editor.selectionController.commitCanonicalSelection(
      insertionAnchors.selection(id(1), 5, "backward"),
      insertionFixture.editor,
      1,
      { publication: { kind: "standalone-local" }, cause: "keyboard" },
      { resolveTextAnchor: insertionAnchors.resolve },
    );
    expect(
      insertionFixture.editor.acceptContentOperationProposal(
        contentInsertionProposal(insertionFixture.editor, 5, " world", 11, 11),
        {
          origin: "prosemirror-proposal",
          selectionPresentation: "native-already-established",
          provenance: null,
        },
      ).ok,
    ).toBe(true);
    const insertionHistory = (
      insertionFixture.editor as unknown as {
        readonly history: readonly EditorHistoryEntry[];
      }
    ).history[0];
    if (insertionHistory?.selectionAfter.kind !== "document") {
      throw new Error("Expected document selection history");
    }
    expect(
      insertionHistory.selectionAfter.selection.focus.textAnchor?.payload.assoc,
    ).toBe(1);
    insertionFixture.dispose();

    const unaffectedAnchors = createAssociationAwareTestAnchorRuntime();
    const unaffectedFixture = createTestEditor({
      content: new Map([[id(1), text("hello")]]),
      materializeAppliedBlocks: true,
      selectionAnchorRuntime: unaffectedAnchors,
    });
    unaffectedFixture.editor.selectionController.commitCanonicalSelection(
      unaffectedAnchors.selection(id(1), 2, "backward"),
      unaffectedFixture.editor,
      1,
      { publication: { kind: "standalone-local" }, cause: "keyboard" },
      { resolveTextAnchor: unaffectedAnchors.resolve },
    );
    expect(
      unaffectedFixture.editor.acceptContentOperationProposal(
        contentInsertionProposal(unaffectedFixture.editor, 5, "!", 6, 6),
        {
          origin: "prosemirror-proposal",
          selectionPresentation: "native-already-established",
          provenance: null,
        },
      ).ok,
    ).toBe(true);
    const unaffectedHistory = (
      unaffectedFixture.editor as unknown as {
        readonly history: readonly EditorHistoryEntry[];
      }
    ).history[0];
    if (unaffectedHistory?.selectionBefore.kind !== "document") {
      throw new Error("Expected document selection history");
    }
    expect(
      unaffectedHistory.selectionBefore.selection.focus.textAnchor?.payload
        .assoc,
    ).toBe(-1);
    unaffectedFixture.dispose();
  });

  it("records one native typing history entry from the prepared selection anchors", () => {
    const anchorRuntime = createAssociationAwareTestAnchorRuntime();
    const createAnchor = vi.fn(anchorRuntime.create);
    const fixture = createTestEditor({
      content: new Map([[id(1), text("hello")]]),
      materializeAppliedBlocks: true,
      selectionAnchorRuntime: { ...anchorRuntime, create: createAnchor },
    });
    fixture.editor.selectionController.commitCanonicalSelection(
      anchorRuntime.selection(id(1), 5, "backward"),
      fixture.editor,
      1,
      { publication: { kind: "standalone-local" }, cause: "keyboard" },
      { resolveTextAnchor: anchorRuntime.resolve },
    );
    createAnchor.mockClear();

    expect(
      fixture.editor.acceptContentOperationProposal(
        contentInsertionProposal(fixture.editor, 5, "!", 6, 6),
        {
          origin: "prosemirror-proposal",
          selectionPresentation: "native-already-established",
          provenance: null,
        },
      ).ok,
    ).toBe(true);

    expect(createAnchor).toHaveBeenCalledTimes(2);
    expect(
      (
        fixture.editor as unknown as {
          readonly history: readonly EditorHistoryEntry[];
        }
      ).history,
    ).toHaveLength(1);
    fixture.dispose();
  });

  it.each(["resolve", "create"] as const)(
    "rejects a command atomically when required history anchor %s fails",
    (failure) => {
      const baseRuntime = createAssociationAwareTestAnchorRuntime();
      let failHistoryAnchor = false;
      const selectionAnchorRuntime: AssociationAwareTestAnchorRuntime = {
        ...baseRuntime,
        resolve: (point) =>
          failHistoryAnchor && failure === "resolve"
            ? { ok: false, reason: "missing-text", blockId: point.blockId }
            : baseRuntime.resolve(point),
        create: (input) =>
          failHistoryAnchor && failure === "create"
            ? { ok: false }
            : baseRuntime.create(input),
      };
      const fixture = createTestEditor({
        content: new Map([[id(1), text("hello world")]]),
        materializeAppliedBlocks: true,
        selectionAnchorRuntime,
      });
      const initial = baseRuntime.selection(id(1), 5, "forward");
      expect(
        fixture.editor.selectionController.commitCanonicalSelection(
          initial,
          fixture.editor,
          fixture.editor.getSelectionGraphRevision(),
          {
            publication: { kind: "standalone-local" },
            cause: "keyboard",
          },
          { resolveTextAnchor: baseRuntime.resolve },
        ),
      ).toMatchObject({ kind: "changed" });
      const canonicalBefore =
        fixture.editor.selectionController.getCanonicalSnapshot();
      const revisionBefore = fixture.editor.getEditorInfo().documentRevision;
      failHistoryAnchor = true;

      const result = fixture.editor.acceptContentOperationProposal(
        {
          base: {
            blockId: id(1),
            blockType: "paragraph",
            graphRevision: 1,
            contentRevision: 0,
          },
          operations: [
            {
              kind: "deleteInlineRange",
              blockId: id(1),
              blockType: "paragraph",
              target: { kind: "text" },
              range: {
                from: { blockId: id(1), offset: 5 },
                to: { blockId: id(1), offset: 11 },
              },
              deletedContent: [{ type: "text", text: " world" }],
            },
          ],
          selectionAfter: {
            direction: "forward",
            anchor: {
              blockId: id(1),
              blockType: "paragraph",
              textOffset: 5,
              affinity: "backward",
            },
            focus: {
              blockId: id(1),
              blockType: "paragraph",
              textOffset: 5,
              affinity: "backward",
            },
          },
        },
        {
          origin: "prosemirror-proposal",
          selectionPresentation: "native-already-established",
          provenance: null,
        },
      );

      expect(result).toMatchObject({ ok: false, reason: "application-failed" });
      expect(readContentText(fixture, id(1))).toBe("hello world");
      expect(fixture.editor.selectionController.getCanonicalSnapshot()).toBe(
        canonicalBefore,
      );
      expect(fixture.editor.getEditorInfo().documentRevision).toBe(
        revisionBefore,
      );
      expect(fixture.commitContent).not.toHaveBeenCalled();
      expect(fixture.markInconsistent).not.toHaveBeenCalled();
      expect(fixture.onCanonicalCommit).not.toHaveBeenCalled();
      expect(fixture.publishContentCommit).not.toHaveBeenCalled();
      expect(
        (fixture.editor as unknown as { readonly history: readonly unknown[] })
          .history,
      ).toHaveLength(0);
      fixture.dispose();
    },
  );

  it.each(["resolve", "create"] as const)(
    "rejects a structural command atomically when required history anchor %s fails",
    (failure) => {
      const baseRuntime = createAssociationAwareTestAnchorRuntime();
      let failHistoryAnchor = false;
      const selectionAnchorRuntime: AssociationAwareTestAnchorRuntime = {
        ...baseRuntime,
        resolve: (point) =>
          failHistoryAnchor && failure === "resolve"
            ? { ok: false, reason: "missing-text", blockId: point.blockId }
            : baseRuntime.resolve(point),
        create: (input) =>
          failHistoryAnchor && failure === "create"
            ? { ok: false }
            : baseRuntime.create(input),
      };
      const fixture = createTestEditor({
        content: new Map([[id(1), text("hello world")]]),
        materializeAppliedBlocks: true,
        selectionAnchorRuntime,
      });
      const initial = baseRuntime.selection(id(1), 5, "forward");
      expect(
        fixture.editor.selectionController.commitCanonicalSelection(
          initial,
          fixture.editor,
          fixture.editor.getSelectionGraphRevision(),
          {
            publication: { kind: "standalone-local" },
            cause: "keyboard",
          },
          { resolveTextAnchor: baseRuntime.resolve },
        ),
      ).toMatchObject({ kind: "changed" });
      const canonicalBefore =
        fixture.editor.selectionController.getCanonicalSnapshot();
      const revisionBefore = fixture.editor.getEditorInfo().documentRevision;
      const graphRevisionBefore = fixture.editor.getSelectionGraphRevision();
      failHistoryAnchor = true;

      expect(
        fixture.editor.executeCoreBlockKeyBehavior({
          key: "enter",
          blockId: id(1),
          blockType: "paragraph",
          cursorOffset: 5,
        }),
      ).toBe(false);

      expect(fixture.editor.getRootBlockIds()).toEqual([id(1)]);
      expect(readContentText(fixture, id(1))).toBe("hello world");
      expect(fixture.editor.selectionController.getCanonicalSnapshot()).toBe(
        canonicalBefore,
      );
      expect(fixture.editor.getEditorInfo().documentRevision).toBe(
        revisionBefore,
      );
      expect(fixture.editor.getSelectionGraphRevision()).toBe(
        graphRevisionBefore,
      );
      expect(fixture.commitContent).not.toHaveBeenCalled();
      expect(fixture.markInconsistent).not.toHaveBeenCalled();
      expect(fixture.onCanonicalCommit).not.toHaveBeenCalled();
      expect(fixture.publishContentCommit).not.toHaveBeenCalled();
      expect(
        (fixture.editor as unknown as { readonly history: readonly unknown[] })
          .history,
      ).toHaveLength(0);
      fixture.dispose();
    },
  );

  it("commits structural content without per-edit checkpoint preflight", () => {
    const baseRuntime = createAssociationAwareTestAnchorRuntime();
    const fixture = createTestEditor({
      content: new Map([[id(1), text("hello world")]]),
      materializeAppliedBlocks: true,
      selectionAnchorRuntime: baseRuntime,
    });
    expect(
      fixture.editor.selectionController.commitCanonicalSelection(
        baseRuntime.selection(id(1), 5, "forward"),
        fixture.editor,
        fixture.editor.getSelectionGraphRevision(),
        { publication: { kind: "standalone-local" }, cause: "keyboard" },
        { resolveTextAnchor: baseRuntime.resolve },
      ),
    ).toMatchObject({ kind: "changed" });

    expect(
      fixture.editor.executeCoreBlockKeyBehavior({
        key: "enter",
        blockId: id(1),
        blockType: "paragraph",
        cursorOffset: 5,
      }),
    ).toBe(true);
    expect(fixture.commitContent).toHaveBeenCalledOnce();
    expect(fixture.markInconsistent).not.toHaveBeenCalled();
    expect(fixture.publishContentCommit).toHaveBeenCalledOnce();
    expect(fixture.onCanonicalCommit).toHaveBeenCalledOnce();
    expect(fixture.editor.canUndo).toBe(true);
    fixture.dispose();
  });

  it.each([
    {
      splitOffset: 0,
      expectedSourceText: "",
      expectedGeneratedText: "hello world",
      expectedHistoryAssoc: -1,
    },
    {
      splitOffset: 5,
      expectedSourceText: "hello",
      expectedGeneratedText: " world",
      expectedHistoryAssoc: -1,
    },
    {
      splitOffset: 11,
      expectedSourceText: "hello world",
      expectedGeneratedText: "",
      expectedHistoryAssoc: 1,
    },
  ])(
    "restores replay-aware structural history selection at split offset $splitOffset",
    ({
      splitOffset,
      expectedSourceText,
      expectedGeneratedText,
      expectedHistoryAssoc,
    }) => {
      const anchorRuntime = createAssociationAwareTestAnchorRuntime();
      const commits: CanonicalEditorCommit[] = [];
      const publishedSelections: ReturnType<
        typeof transactionSelectionOffsets
      >[] = [];
      const fixture = createTestEditor({
        content: new Map([[id(1), text("hello world")]]),
        selectionAnchorRuntime: anchorRuntime,
        onCanonicalCommit: (commit) => {
          commits.push(commit);
          publishedSelections.push(transactionSelectionOffsets(commit));
        },
      });
      const sourceId = id(1);
      const initial = anchorRuntime.selection(sourceId, splitOffset, "forward");
      expect(
        fixture.editor.selectionController.commitCanonicalSelection(
          initial,
          fixture.editor,
          fixture.editor.getSelectionGraphRevision(),
          {
            publication: { kind: "standalone-local" },
            cause: "pointer",
          },
          { resolveTextAnchor: anchorRuntime.resolve },
        ),
      ).toMatchObject({ kind: "changed" });

      expect(
        fixture.editor.executeCoreBlockKeyBehavior({
          key: "enter",
          blockId: sourceId,
          blockType: "paragraph",
          cursorOffset: splitOffset,
        }),
      ).toBe(true);
      const generatedId = fixture.editor
        .getRootBlockIds()
        .find((blockId) => blockId !== sourceId);
      expect(generatedId).toBeDefined();
      expect(readContentText(fixture, sourceId)).toBe(expectedSourceText);
      expect(readContentText(fixture, generatedId!)).toBe(
        expectedGeneratedText,
      );
      expect(publishedSelections[0]).toEqual({
        before: { blockId: sourceId, offset: splitOffset },
        after: { blockId: generatedId, offset: 0 },
      });
      const recorded = (
        fixture.editor as unknown as {
          readonly history: readonly EditorHistoryEntry[];
        }
      ).history[0];
      expect(recorded?.selectionBefore.kind).toBe("document");
      if (recorded?.selectionBefore.kind !== "document") {
        throw new Error("Expected a recorded document history selection");
      }
      expect(
        recorded.selectionBefore.selection.focus.textAnchor?.payload.assoc,
      ).toBe(expectedHistoryAssoc);

      expect(fixture.editor.undo()).toEqual({ status: "applied" });
      expect(publishedSelections[1]).toEqual({
        before: { blockId: generatedId, offset: 0 },
        after: { blockId: sourceId, offset: splitOffset },
      });
      expect(readCanonicalSelection(fixture.editor)).toEqual({
        direction: "forward",
        anchor: splitOffset,
        focus: splitOffset,
      });

      expect(fixture.editor.redo()).toEqual({ status: "applied" });
      expect(publishedSelections[2]).toEqual({
        before: { blockId: sourceId, offset: splitOffset },
        after: { blockId: generatedId, offset: 0 },
      });
      expect(fixture.editor.undo()).toEqual({ status: "applied" });
      expect(publishedSelections[3]).toEqual({
        before: { blockId: generatedId, offset: 0 },
        after: { blockId: sourceId, offset: splitOffset },
      });
      expect(fixture.editor.redo()).toEqual({ status: "applied" });
      expect(publishedSelections[4]).toEqual({
        before: { blockId: sourceId, offset: splitOffset },
        after: { blockId: generatedId, offset: 0 },
      });
      expect(commits.map((commit) => commit.historyAction)).toEqual([
        "command",
        "undo",
        "redo",
        "undo",
        "redo",
      ]);
      expect(
        commits.map((commit) => [
          commit.baseDocumentRevision,
          commit.documentRevision,
        ]),
      ).toEqual([
        [1, 2],
        [2, 3],
        [3, 4],
        [4, 5],
        [5, 6],
      ]);
      expect(new Set(commits.map((commit) => commit.transactionId)).size).toBe(
        5,
      );
      fixture.dispose();
    },
  );

  it("advances content graph authority when replaying accepted metadata", () => {
    const fixture = createTestEditor();

    fixture.editor.replayLogicalBlockMetadataOperation({
      kind: "updateBlockMetadata",
      updates: [{ blockId: id(1), values: { remote: true } }],
    });

    expect(fixture.validateContentCommit).toHaveBeenCalledWith({
      graphRevision: 1,
      resultingGraphRevision: 2,
      changes: [],
      introducedBlocks: {},
      removedBlockIds: [],
      origin: "accepted-change",
    });
    expect(fixture.commitContent).toHaveBeenCalledTimes(1);
    expect(fixture.publishContentCommit).toHaveBeenCalledTimes(1);
    expect(fixture.editor.getEditorInfo().blockGraphVersion).toBe(2);
    expect(
      fixture.editor.updateBlockMetadata([
        { blockId: id(1), values: { local: true } },
      ]),
    ).toBe(true);
    fixture.dispose();
  });

  it("rejects mutations outside a transaction", () => {
    const fixture = createTestEditor();
    const target = fixture.editor.getBlock(id(1))!;
    expect(() =>
      fixture.editor.deleteRange(resolvedBlockRange(target)),
    ).toThrow("active editor.transaction");
    expect(() =>
      fixture.editor.insertBlocks(
        { parentId: null, childIndex: 0 },
        createCanonicalBlockFragment({
          blocks: [{ id: id(10), type: "divider", parentId: null }],
          rootBlockIds: [id(10)],
          start: { kind: "block", blockId: id(10) },
          end: { kind: "block", blockId: id(10) },
          blockDefinitions: definitions,
        }),
      ),
    ).toThrow("active editor.transaction");
    expect(() => fixture.editor.joinTextBlocks(id(1), id(2))).toThrow(
      "active editor.transaction",
    );
    fixture.dispose();
  });

  it("rejects a hydrated mixed restorative-default graph", () => {
    const body = block(1, "restorativeBody");
    const placeholder = block(2, "placeholder", body.id);
    const paragraph = block(3, "paragraph", body.id);
    expect(() =>
      createTestEditor({
        blocks: [body, placeholder, paragraph],
        content: new Map([[paragraph.id, text("invalid")]]),
      }),
    ).toThrow(/violate the direct restorativeBody content definition/u);
  });

  it("rejects a malformed remote mixed graph atomically", () => {
    const body = block(1, "restorativeBody");
    const placeholder = block(2, "placeholder", body.id);
    const inserted = block(10, "divider", body.id);
    const fixture = createTestEditor({
      blocks: [body, placeholder],
      content: new Map(),
    });

    expect(() =>
      fixture.editor.applyEditorBlockGraphPatch({
        origin: "remote-materialized-patch",
        blockGraphVersion: 2,
        patch: {
          affectedBlockIds: [body.id, inserted.id],
          upsertedBlocks: [inserted],
          rootBlockIds: [body.id],
          childIdsByParentId: {
            [body.id]: [placeholder.id, inserted.id],
          },
        },
      }),
    ).toThrow(/violate the direct restorativeBody content definition/u);
    expect(fixture.editor.getChildBlockIds(body.id)).toEqual([placeholder.id]);
    expect(fixture.editor.getBlock(inserted.id)).toBeNull();
    fixture.dispose();
  });

  it.each([[[10]], [[10, 11]]] as const)(
    "atomically replaces a restorative default when inserting %s block(s)",
    (suffixes) => {
      const body = block(1, "restorativeBody");
      const placeholder = block(2, "placeholder", body.id);
      const fixture = createTestEditor({
        blocks: [body, placeholder],
        content: new Map(),
      });
      const fragment = paragraphFragment(...suffixes);
      const result = fixture.editor.transaction(() => {
        fixture.editor.insertBlocks(
          { parentId: body.id, childIndex: 1 },
          fragment,
        );
      });

      expect(result).toMatchObject({ ok: true, changed: true });
      expect(fixture.editor.getChildBlockIds(body.id)).toEqual(
        fragment.rootBlockIds,
      );
      expect(fixture.editor.getBlock(placeholder.id)).toBeNull();
      if (result.ok && result.changed) {
        expect(result.transaction.selection).toMatchObject({
          blockId: fragment.rootBlockIds.at(-1),
        });
        expect(result.transaction.selection).not.toMatchObject({
          blockId: placeholder.id,
        });
      }
      fixture.dispose();
    },
  );

  it.each([[[10]], [[10, 11]]] as const)(
    "atomically replaces a restorative default when pasting %s block(s)",
    (suffixes) => {
      const body = block(1, "restorativeBody");
      const placeholder = block(2, "placeholder", body.id);
      const fixture = createTestEditor({
        blocks: [body, placeholder],
        content: new Map(),
      });
      const fragment = paragraphFragment(...suffixes);

      expect(
        executeStructuralEditComposition(
          fixture.editor,
          {
            insertions: [
              {
                placement: { parentId: body.id, childIndex: 1 },
                fragment,
              },
            ],
          },
          { provenance: null },
        ),
      ).toMatchObject({ ok: true, changed: true });
      expect(fixture.editor.getChildBlockIds(body.id)).toEqual(
        fragment.rootBlockIds,
      );
      expect(fixture.editor.getBlock(placeholder.id)).toBeNull();
      fixture.dispose();
    },
  );

  it("restores the source default when moving its final real child out", () => {
    const body = block(1, "restorativeBody");
    const paragraph = block(2, "paragraph", body.id);
    const fixture = createTestEditor({
      blocks: [body, paragraph],
      content: new Map([[paragraph.id, text("move")]]),
    });

    expect(
      fixture.editor.moveBlocks({
        blockIds: [paragraph.id],
        destination: { parentId: null, childIndex: 1 },
      }),
    ).toMatchObject({ ok: true, changed: true });
    const restored = fixture.editor.getChildBlockIds(body.id);
    expect(restored).toHaveLength(1);
    expect(fixture.editor.getBlock(restored[0]!)?.type).toBe("placeholder");
    expect(fixture.editor.getRootBlockIds()).toEqual([body.id, paragraph.id]);
    fixture.dispose();
  });

  it.each([[[10]], [[10, 11]]] as const)(
    "atomically replaces a restorative default when moving %s block(s)",
    (suffixes) => {
      const external = suffixes.map((suffix) => block(suffix, "paragraph"));
      const body = block(1, "restorativeBody");
      const placeholder = block(2, "placeholder", body.id);
      const fixture = createTestEditor({
        blocks: [...external, body, placeholder],
        content: new Map(
          external.map((entry) => [entry.id, text(String(entry.id))]),
        ),
      });

      const result = fixture.editor.moveBlocks({
        blockIds: external.map((entry) => entry.id),
        destination: { parentId: body.id, childIndex: 1 },
      });

      expect(result).toMatchObject({ ok: true, changed: true });
      expect(fixture.editor.getChildBlockIds(body.id)).toEqual(
        external.map((entry) => entry.id),
      );
      expect(fixture.editor.getBlock(placeholder.id)).toBeNull();
      fixture.dispose();
    },
  );

  it("restores exactly one default only after the final real child is deleted", () => {
    const body = block(1, "restorativeBody");
    const first = block(2, "paragraph", body.id);
    const second = block(3, "paragraph", body.id);
    const fixture = createTestEditor({
      blocks: [body, first, second],
      content: new Map([
        [first.id, text("first")],
        [second.id, text("second")],
      ]),
    });

    expect(
      fixture.editor.transaction(() => {
        fixture.editor.deleteBlocks({
          blockIds: [first.id],
          includeDescendants: true,
        });
      }),
    ).toMatchObject({ ok: true, changed: true });
    expect(fixture.editor.getChildBlockIds(body.id)).toEqual([second.id]);

    expect(
      fixture.editor.transaction(() => {
        fixture.editor.deleteBlocks({
          blockIds: [second.id],
          includeDescendants: true,
        });
      }),
    ).toMatchObject({ ok: true, changed: true });
    const restored = fixture.editor.getChildBlockIds(body.id);
    expect(restored).toHaveLength(1);
    expect(fixture.editor.getBlock(restored[0]!)?.type).toBe("placeholder");
    fixture.dispose();
  });

  it("undoes and redoes the placeholder-only/content-only transition", () => {
    const body = block(1, "restorativeBody");
    const placeholder = block(2, "placeholder", body.id);
    const fixture = createTestEditor({
      blocks: [body, placeholder],
      content: new Map(),
    });
    const fragment = paragraphFragment(10);

    expect(
      fixture.editor.transaction(() => {
        fixture.editor.insertBlocks(
          { parentId: body.id, childIndex: 0 },
          fragment,
        );
      }),
    ).toMatchObject({ ok: true, changed: true });
    expect(fixture.editor.getChildBlockIds(body.id)).toEqual([id(10)]);
    expect(fixture.editor.undo()).toEqual({ status: "applied" });
    expect(fixture.editor.getChildBlockIds(body.id)).toEqual([placeholder.id]);
    expect(fixture.editor.redo()).toEqual({ status: "applied" });
    expect(fixture.editor.getChildBlockIds(body.id)).toEqual([id(10)]);
    fixture.dispose();
  });

  it("atomically replaces a deleted last root with the definition-owned default", () => {
    const onlyRoot = block(1, "divider");
    const fixture = createTestEditor({
      blocks: [onlyRoot],
      content: new Map(),
      materializeAppliedBlocks: true,
    });
    const original = fixture.editor.getBlock(id(1))!;

    expect(
      fixture.editor.transaction(() => {
        fixture.editor.deleteRange(resolvedBlockRange(original));
      }),
    ).toMatchObject({ ok: true, changed: true });

    const [defaultRootId] = fixture.editor.getRootBlockIds();
    expect(defaultRootId).toBeDefined();
    expect(defaultRootId).not.toBe(original.id);
    expect(fixture.editor.getRootBlockIds()).toEqual([defaultRootId]);
    expect(fixture.editor.getBlock(defaultRootId!)?.type).toBe("paragraph");
    expect(readContentText(fixture, defaultRootId!)).toBe("");
    expect(
      fixture.editor.selectionController.canonical.getSnapshot(),
    ).toMatchObject({
      kind: "document",
      snapshot: {
        documentSelection: {
          anchor: { blockId: defaultRootId, textOffset: 0 },
          focus: { blockId: defaultRootId, textOffset: 0 },
        },
      },
    });
    expect(fixture.onCanonicalCommit).toHaveBeenCalledTimes(1);
    expect(fixture.publications).toHaveBeenCalledTimes(1);

    expect(fixture.editor.undo()).toEqual({ status: "applied" });
    expect(fixture.editor.getRootBlockIds()).toEqual([original.id]);
    expect(fixture.editor.getBlock(original.id)?.type).toBe("divider");
    expect(fixture.editor.getBlock(defaultRootId!)).toBeNull();

    expect(fixture.editor.redo()).toEqual({ status: "applied" });
    expect(fixture.editor.getRootBlockIds()).toEqual([defaultRootId]);
    expect(readContentText(fixture, defaultRootId!)).toBe("");
    expect(
      fixture.onCanonicalCommit.mock.calls.map(
        ([commit]) => commit.historyAction,
      ),
    ).toEqual(["command", "undo", "redo"]);
    fixture.dispose();
  });

  it("rejects nesting and aborts the outer transaction even if ignored", () => {
    const divider = block(2, "divider");
    const fixture = createTestEditor({
      blocks: [block(1, "paragraph"), divider],
      content: new Map([[id(1), text("one")]]),
    });
    const result = fixture.editor.transaction(() => {
      fixture.editor.deleteRange(resolvedBlockRange(divider));
      expect(fixture.editor.transaction(() => undefined)).toMatchObject({
        ok: false,
        phase: "nested",
      });
    });

    expect(result).toMatchObject({ ok: false, phase: "nested" });
    expect(fixture.editor.getBlock(divider.id)).not.toBeNull();
    expect(fixture.onCanonicalCommit).not.toHaveBeenCalled();
    fixture.dispose();
  });

  it("rejects async callbacks and clears active state after every failure", () => {
    const fixture = createTestEditor();
    const asyncResult = fixture.editor.transaction(async () => undefined);
    expect(asyncResult).toMatchObject({
      ok: false,
      phase: "async-callback",
    });
    const exceptionResult = fixture.editor.transaction(() => {
      throw new Error("callback exploded");
    });
    expect(exceptionResult).toMatchObject({
      ok: false,
      phase: "callback",
      message: "callback exploded",
    });
    expect(fixture.editor.transaction(() => undefined)).toEqual({
      ok: true,
      changed: false,
    });
    fixture.dispose();
  });

  it("publishes nothing for a no-op transaction", () => {
    const fixture = createTestEditor();
    const before = fixture.editor.getCommandState();
    const result = fixture.editor.transaction(() => undefined);

    expect(result).toEqual({ ok: true, changed: false });
    expect(fixture.editor.getCommandState().blockGraphVersion).toBe(
      before.blockGraphVersion,
    );
    expect(fixture.onCanonicalCommit).not.toHaveBeenCalled();
    expect(fixture.publications).not.toHaveBeenCalled();
    expect(fixture.validateContentCommit).not.toHaveBeenCalled();
    fixture.dispose();
  });

  it("aborts successful earlier mutations when a later mutation fails", () => {
    const divider = block(2, "divider");
    const fixture = createTestEditor({
      blocks: [block(1, "paragraph"), divider],
      content: new Map([[id(1), text("one")]]),
    });
    const before = fixture.editor.getCommandState();
    const result = fixture.editor.transaction(() => {
      fixture.editor.deleteRange(resolvedBlockRange(divider));
      fixture.editor.joinTextBlocks(id(1), divider.id);
    });

    expect(result).toMatchObject({ ok: false, phase: "mutation" });
    expect(fixture.editor.getCommandState().blockGraphVersion).toBe(
      before.blockGraphVersion,
    );
    expect(fixture.editor.getBlock(divider.id)).not.toBeNull();
    expect(fixture.onCanonicalCommit).not.toHaveBeenCalled();
    expect(fixture.publications).not.toHaveBeenCalled();
    fixture.dispose();
  });

  it("rejects a complete draft that fails final wrapper validation", () => {
    const wrapper = block(1, "quote");
    const paragraph = block(2, "paragraph", wrapper.id);
    const fixture = createTestEditor({
      blocks: [wrapper, paragraph],
      content: new Map([[paragraph.id, text("inside")]]),
    });
    const insertedId = id(10);
    const result = fixture.editor.transaction(() => {
      fixture.editor.insertBlocks(
        { parentId: wrapper.id, childIndex: 1 },
        createCanonicalBlockFragment({
          blocks: [{ id: insertedId, type: "divider", parentId: null }],
          rootBlockIds: [insertedId],
          start: { kind: "block", blockId: insertedId },
          end: { kind: "block", blockId: insertedId },
          blockDefinitions: definitions,
        }),
      );
    });

    expect(result).toMatchObject({ ok: false, phase: "validation" });
    expect(fixture.editor.getBlock(insertedId)).toBeNull();
    expect(fixture.editor.getChildBlockIds(wrapper.id)).toEqual([paragraph.id]);
    expect(fixture.onCanonicalCommit).not.toHaveBeenCalled();
    expect(fixture.publications).not.toHaveBeenCalled();
    fixture.dispose();
  });

  it("commits multiple canonical insertions as one transition", () => {
    const fixture = createTestEditor();
    const firstId = id(10);
    const secondId = id(11);
    const fragment = (blockId: BlockId) =>
      createCanonicalBlockFragment({
        blocks: [{ id: blockId, type: "divider", parentId: null }],
        rootBlockIds: [blockId],
        start: { kind: "block", blockId },
        end: { kind: "block", blockId },
        blockDefinitions: definitions,
      });

    const result = fixture.editor.transaction(() => {
      fixture.editor.insertBlocks(
        { parentId: null, childIndex: 1 },
        fragment(firstId),
      );
      fixture.editor.insertBlocks(
        { parentId: null, childIndex: 2 },
        fragment(secondId),
      );
    });

    expect(result).toMatchObject({ ok: true, changed: true });
    expect(fixture.editor.getRootBlockIds()).toEqual([
      id(1),
      firstId,
      secondId,
    ]);
    expect(fixture.onCanonicalCommit).toHaveBeenCalledTimes(1);
    expect(fixture.publications).toHaveBeenCalledTimes(1);
    expect(fixture.editor.undo()).toEqual({ status: "applied" });
    expect(fixture.editor.getRootBlockIds()).toEqual([id(1)]);
    expect(fixture.editor.redo()).toEqual({ status: "applied" });
    expect(fixture.editor.getRootBlockIds()).toEqual([
      id(1),
      firstId,
      secondId,
    ]);
    fixture.dispose();
  });

  it("composes typed subtree deletion with insertion", () => {
    const wrapper = block(1, "callout");
    const child = block(2, "paragraph", wrapper.id);
    const survivor = block(3, "divider");
    const insertedId = id(10);
    const fixture = createTestEditor({
      blocks: [wrapper, child, survivor],
      content: new Map([[child.id, text("inside")]]),
    });

    const result = fixture.editor.transaction(() => {
      expect(
        fixture.editor.deleteBlocks({
          blockIds: [wrapper.id],
          includeDescendants: true,
          expectedParents: { [wrapper.id]: null },
        }),
      ).toEqual({ deletedBlockIds: [wrapper.id, child.id] });
      fixture.editor.insertBlocks(
        { parentId: null, childIndex: 0 },
        createCanonicalBlockFragment({
          blocks: [{ id: insertedId, type: "divider", parentId: null }],
          rootBlockIds: [insertedId],
          start: { kind: "block", blockId: insertedId },
          end: { kind: "block", blockId: insertedId },
          blockDefinitions: definitions,
        }),
      );
    });

    expect(result).toMatchObject({ ok: true, changed: true });
    expect(fixture.editor.getRootBlockIds()).toEqual([insertedId, survivor.id]);
    expect(fixture.editor.getBlock(wrapper.id)).toBeNull();
    expect(fixture.editor.getBlock(child.id)).toBeNull();
    expect(fixture.onCanonicalCommit).toHaveBeenCalledTimes(1);
    expect(fixture.publications).toHaveBeenCalledTimes(1);
    expect(fixture.editor.undo()).toEqual({ status: "applied" });
    expect(fixture.editor.getRootBlockIds()).toEqual([wrapper.id, survivor.id]);
    expect(fixture.editor.getChildBlockIds(wrapper.id)).toEqual([child.id]);
    expect(fixture.editor.redo()).toEqual({ status: "applied" });
    expect(fixture.editor.getRootBlockIds()).toEqual([insertedId, survivor.id]);
    fixture.dispose();
  });

  it("rejects overlapping subtree deletion requests atomically", () => {
    const wrapper = block(1, "callout");
    const child = block(2, "paragraph", wrapper.id);
    const fixture = createTestEditor({
      blocks: [wrapper, child],
      content: new Map([[child.id, text("inside")]]),
    });

    const result = fixture.editor.transaction(() => {
      fixture.editor.deleteBlocks({
        blockIds: [wrapper.id, child.id],
        includeDescendants: true,
      });
    });

    expect(result).toMatchObject({ ok: false, phase: "mutation" });
    expect(fixture.editor.getRootBlockIds()).toEqual([wrapper.id]);
    expect(fixture.editor.getChildBlockIds(wrapper.id)).toEqual([child.id]);
    expect(fixture.onCanonicalCommit).not.toHaveBeenCalled();
    expect(fixture.publications).not.toHaveBeenCalled();
    fixture.dispose();
  });

  it("commits graph and composed metadata changes as one history unit", () => {
    const paragraph = block(1, "paragraph");
    const removed = block(2, "divider");
    const fixture = createTestEditor({
      blocks: [paragraph, removed],
      content: new Map([[paragraph.id, text("one")]]),
    });

    const result = fixture.editor.transaction(() => {
      expect(
        fixture.editor.updateBlockMetadata([
          { blockId: paragraph.id, values: { first: true } },
        ]),
      ).toBe(true);
      expect(
        fixture.editor.updateBlockMetadata([
          { blockId: paragraph.id, values: { second: "value" } },
        ]),
      ).toBe(true);
      fixture.editor.deleteBlocks({
        blockIds: [removed.id],
        includeDescendants: true,
        expectedParents: { [removed.id]: null },
      });
    });

    expect(result).toMatchObject({ ok: true, changed: true });
    expect(fixture.editor.getBlock(paragraph.id)?.metadata).toEqual({
      first: true,
      second: "value",
    });
    expect(fixture.editor.getBlock(removed.id)).toBeNull();
    expect(fixture.onCanonicalCommit).toHaveBeenCalledTimes(1);
    expect(fixture.publications).toHaveBeenCalledTimes(1);
    expect(fixture.editor.undo()).toEqual({ status: "applied" });
    expect(fixture.editor.getBlock(paragraph.id)?.metadata).toBeUndefined();
    expect(fixture.editor.getBlock(removed.id)?.id).toBe(removed.id);
    expect(fixture.editor.undo()).toEqual({ status: "history-empty" });
    expect(fixture.editor.redo()).toEqual({ status: "applied" });
    expect(fixture.editor.getBlock(paragraph.id)?.metadata).toEqual({
      first: true,
      second: "value",
    });
    expect(fixture.editor.getBlock(removed.id)).toBeNull();
    fixture.dispose();
  });

  it("rolls metadata back when the complete final graph is invalid", () => {
    const wrapper = block(1, "quote");
    const paragraph = block(2, "paragraph", wrapper.id);
    const insertedId = id(10);
    const fixture = createTestEditor({
      blocks: [wrapper, paragraph],
      content: new Map([[paragraph.id, text("inside")]]),
    });

    const result = fixture.editor.transaction(() => {
      fixture.editor.updateBlockMetadata([
        { blockId: paragraph.id, values: { staged: true } },
      ]);
      fixture.editor.insertBlocks(
        { parentId: wrapper.id, childIndex: 1 },
        createCanonicalBlockFragment({
          blocks: [{ id: insertedId, type: "divider", parentId: null }],
          rootBlockIds: [insertedId],
          start: { kind: "block", blockId: insertedId },
          end: { kind: "block", blockId: insertedId },
          blockDefinitions: definitions,
        }),
      );
    });

    expect(result).toMatchObject({ ok: false, phase: "validation" });
    expect(fixture.editor.getBlock(paragraph.id)?.metadata).toBeUndefined();
    expect(fixture.editor.getBlock(insertedId)).toBeNull();
    expect(fixture.onCanonicalCommit).not.toHaveBeenCalled();
    expect(fixture.publications).not.toHaveBeenCalled();
    fixture.dispose();
  });

  it("rejects the staged transaction when its base graph becomes stale", () => {
    const divider = block(2, "divider");
    const fixture = createTestEditor({
      blocks: [block(1, "paragraph"), divider],
      content: new Map([[id(1), text("one")]]),
    });

    const result = fixture.editor.transaction(() => {
      fixture.editor.deleteBlocks({
        blockIds: [divider.id],
        includeDescendants: true,
      });
      fixture.editor.replayLogicalBlockMetadataOperation({
        kind: "updateBlockMetadata",
        updates: [{ blockId: id(1), values: { remote: true } }],
      });
    });

    expect(result).toMatchObject({ ok: false, phase: "commit" });
    expect(fixture.editor.getBlock(divider.id)?.id).toBe(divider.id);
    expect(fixture.editor.getBlock(id(1))?.metadata).toEqual({ remote: true });
    fixture.dispose();
  });

  it("settles explicit transaction selection only after success", async () => {
    const fixture = createTestEditor();
    const insertedId = id(10);
    const accepted = fixture.editor.transaction(() => {
      fixture.editor.insertBlocks(
        { parentId: null, childIndex: 1 },
        createCanonicalBlockFragment({
          blocks: [
            {
              id: insertedId,
              type: "paragraph",
              parentId: null,
              content: text("next"),
              plainText: "next",
            },
          ],
          rootBlockIds: [insertedId],
          start: { kind: "text", blockId: insertedId },
          end: { kind: "text", blockId: insertedId },
          blockDefinitions: definitions,
        }),
      );
      fixture.editor.setTransactionSelection({
        kind: "text",
        blockId: insertedId,
        offset: 2,
      });
    });
    expect(accepted).toMatchObject({ ok: true, changed: true });
    expect(fixture.requestNativeFocus).not.toHaveBeenCalled();
    expect(readCanonicalSelection(fixture.editor)).toMatchObject({
      anchor: 2,
      focus: 2,
    });

    const rejected = fixture.editor.transaction(() => {
      fixture.editor.updateBlockMetadata([
        { blockId: id(1), values: { rejected: true } },
      ]);
      fixture.editor.setTransactionSelection({
        kind: "text",
        blockId: id(99),
        offset: 0,
      });
    });
    expect(rejected).toMatchObject({ ok: false, phase: "mutation" });
    expect(fixture.requestNativeFocus).not.toHaveBeenCalled();
    expect(fixture.editor.getBlock(id(1))?.metadata).toBeUndefined();

    const cleared = fixture.editor.transaction(() => {
      fixture.editor.updateBlockMetadata([
        { blockId: id(1), values: { accepted: true } },
      ]);
      fixture.editor.setTransactionSelection({ kind: "clear" });
    });
    expect(cleared).toMatchObject({ ok: true, changed: true });
    expect(fixture.blurEditor).not.toHaveBeenCalled();
    expect(
      fixture.editor.selectionController.canonical.getSnapshot(),
    ).toMatchObject({ kind: "none" });
    fixture.dispose();
  });

  it("rejects a non-selectable wrapper as a transaction selection target", () => {
    const fixture = createTestEditor();
    const wrapperId = id(10);
    const childId = id(11);
    const result = fixture.editor.transaction(() => {
      fixture.editor.insertBlocks(
        { parentId: null, childIndex: 1 },
        createCanonicalBlockFragment({
          blocks: [
            {
              id: wrapperId,
              type: "quote",
              parentId: null,
            },
            {
              id: childId,
              type: "paragraph",
              parentId: wrapperId,
              content: text("inside"),
              plainText: "inside",
            },
          ],
          rootBlockIds: [wrapperId],
          start: { kind: "block", blockId: wrapperId },
          end: { kind: "block", blockId: wrapperId },
          blockDefinitions: definitions,
        }),
      );
      fixture.editor.setTransactionSelection({
        kind: "block",
        blockId: wrapperId,
      });
    });

    expect(result).toMatchObject({ ok: false, phase: "mutation" });
    expect(fixture.requestNativeFocus).not.toHaveBeenCalled();
    expect(fixture.onCanonicalCommit).not.toHaveBeenCalled();
    fixture.dispose();
  });

  it("executes delete, insert, and joins as one published document change", () => {
    const left = block(1, "paragraph");
    const divider = block(2, "divider");
    const right = block(3, "paragraph");
    const fixture = createTestEditor({
      blocks: [left, divider, right],
      content: new Map([
        [left.id, text("L")],
        [right.id, text("R")],
      ]),
    });
    const insertedId = id(10);
    const fragment = createCanonicalBlockFragment({
      blocks: [
        {
          id: insertedId,
          type: "paragraph",
          parentId: null,
          content: text("I"),
          plainText: "I",
        },
      ],
      rootBlockIds: [insertedId],
      start: { kind: "text", blockId: insertedId },
      end: { kind: "text", blockId: insertedId },
      blockDefinitions: definitions,
    });
    const before = fixture.editor.getCommandState();
    const result = executeStructuralEditComposition(
      fixture.editor,
      {
        deletion: resolvedBlockRange(divider),
        insertions: [
          {
            placement: { parentId: null, childIndex: 1 },
            fragment,
          },
        ],
        joins: [
          { leftBlockId: left.id, rightBlockId: insertedId },
          { leftBlockId: left.id, rightBlockId: right.id },
        ],
      },
      {
        provenance: {
          kind: "typing",
          text: "I",
          inputType: "replacement",
          finalSelection: {
            blockId: left.id,
            blockType: "paragraph",
            offset: 2,
          },
        },
      },
    );

    expect(result).toMatchObject({ ok: true, changed: true });
    expect(fixture.editor.getRootBlockIds()).toEqual([left.id]);
    expect(fixture.editor.getBlock(insertedId)).toBeNull();
    expect(fixture.editor.getBlock(right.id)).toBeNull();
    expect(
      extractPlainTextFromRichTextDocument(fixture.content.get(left.id)!),
    ).toBe("LIR");
    expect(fixture.editor.getCommandState().blockGraphVersion).toBe(
      before.blockGraphVersion + 1,
    );
    expect(fixture.onCanonicalCommit).toHaveBeenCalledTimes(1);
    expect(fixture.onCanonicalCommit.mock.calls[0]![0].provenance).toEqual({
      kind: "typing",
      text: "I",
      inputType: "replacement",
      finalSelection: {
        blockId: left.id,
        blockType: "paragraph",
        offset: 2,
      },
    });
    expect(fixture.publications).toHaveBeenCalledTimes(1);
    expect(fixture.validateContentCommit).toHaveBeenCalledTimes(1);
    expect(fixture.commitContent).toHaveBeenCalledTimes(1);
    expect(fixture.publishContentCommit).toHaveBeenCalledTimes(1);
    expect(
      result.ok && result.changed ? result.transaction.selection : null,
    ).toEqual({
      kind: "text-offset",
      blockId: left.id,
      offset: 2,
    });
    fixture.dispose();
  });

  it("commits open-boundary range deletion once and undoes the join atomically", () => {
    const start = block(1, "paragraph");
    const middle = block(2, "paragraph");
    const end = block(3, "paragraph");
    const fixture = createTestEditor({
      blocks: [start, middle, end],
      content: new Map([
        [start.id, text("abcDEF")],
        [middle.id, text("middle")],
        [end.id, text("GHIjkl")],
      ]),
    });
    const range: StructuralEditRange = {
      graphRevision: 1,
      selectionRevision: 3,
      blocks: [
        {
          kind: "text",
          blockId: start.id,
          blockType: start.type,
          parentId: null,
          from: 3,
          to: 6,
          expectedContentVersion: "1",
        },
        {
          kind: "block",
          blockId: middle.id,
          blockType: middle.type,
          parentId: null,
        },
        {
          kind: "text",
          blockId: end.id,
          blockType: end.type,
          parentId: null,
          from: 0,
          to: 3,
          expectedContentVersion: "1",
        },
      ],
      start: { kind: "text", blockId: start.id, offset: 3 },
      end: { kind: "text", blockId: end.id, offset: 3 },
    };

    const result = fixture.editor.executeStructuralRangeDeletion(range, {
      intent: "cut",
      provenance: null,
    });

    expect(result).toMatchObject({ ok: true });
    expect(fixture.editor.getRootBlockIds()).toEqual([start.id]);
    expect(fixture.editor.getBlock(start.id)).toMatchObject({
      id: start.id,
      type: "paragraph",
    });
    expect(
      extractPlainTextFromRichTextDocument(fixture.content.get(start.id)!),
    ).toBe("abcjkl");
    expect(fixture.editor.getBlock(end.id)).toBeNull();
    expect(fixture.onCanonicalCommit).toHaveBeenCalledTimes(1);
    expect(fixture.publications).toHaveBeenCalledTimes(1);
    expect(result.ok ? result.transaction.selection : null).toEqual({
      kind: "text-offset",
      blockId: start.id,
      offset: 3,
    });

    expect(fixture.editor.undo()).toEqual({ status: "applied" });
    expect(fixture.editor.getRootBlockIds()).toEqual([
      start.id,
      middle.id,
      end.id,
    ]);
    expect(
      extractPlainTextFromRichTextDocument(fixture.content.get(start.id)!),
    ).toBe("abcDEF");
    expect(
      extractPlainTextFromRichTextDocument(fixture.content.get(end.id)!),
    ).toBe("GHIjkl");
    expect(fixture.editor.redo()).toEqual({ status: "applied" });
    expect(fixture.editor.getRootBlockIds()).toEqual([start.id]);
    expect(
      extractPlainTextFromRichTextDocument(fixture.content.get(start.id)!),
    ).toBe("abcjkl");
    fixture.dispose();
  });

  it("derives the final caret from an inserted fragment boundary", () => {
    const fixture = createTestEditor();
    const insertedId = id(10);
    const result = fixture.editor.transaction(() => {
      fixture.editor.insertBlocks(
        { parentId: null, childIndex: 1 },
        createCanonicalBlockFragment({
          blocks: [
            {
              id: insertedId,
              type: "paragraph",
              parentId: null,
              content: text("new"),
              plainText: "new",
            },
          ],
          rootBlockIds: [insertedId],
          start: { kind: "text", blockId: insertedId },
          end: { kind: "text", blockId: insertedId },
          blockDefinitions: definitions,
        }),
      );
    });

    expect(result).toMatchObject({ ok: true, changed: true });
    expect(
      result.ok && result.changed ? result.transaction.selection : null,
    ).toEqual({
      kind: "text-offset",
      blockId: insertedId,
      offset: 3,
    });
    expect(fixture.editor.canUndo).toBe(true);
    expect(fixture.editor.undo()).toEqual({ status: "applied" });
    expect(fixture.editor.getBlock(insertedId)).toBeNull();
    expect(fixture.editor.getRootBlockIds()).toEqual([id(1)]);
    expect(fixture.editor.redo()).toEqual({ status: "applied" });
    expect(fixture.editor.getBlock(insertedId)?.id).toBe(insertedId);
    expect(fixture.editor.getRootBlockIds()).toEqual([id(1), insertedId]);
    expect(
      extractPlainTextFromRichTextDocument(fixture.content.get(insertedId)!),
    ).toBe("new");
    fixture.dispose();
  });

  it("records a mixed structural composition once and restores content atomically", () => {
    const left = block(1, "paragraph");
    const right = block(2, "paragraph");
    const fixture = createTestEditor({
      blocks: [left, right],
      content: new Map([
        [left.id, text("left")],
        [right.id, text("right")],
      ]),
    });

    const result = fixture.editor.transaction(() => {
      fixture.editor.joinTextBlocks(left.id, right.id);
    });

    expect(result).toMatchObject({ ok: true, changed: true });
    expect(fixture.editor.canUndo).toBe(true);
    expect(fixture.editor.undo()).toEqual({ status: "applied" });
    expect(fixture.editor.getRootBlockIds()).toEqual([left.id, right.id]);
    expect(fixture.editor.getBlock(right.id)?.id).toBe(right.id);
    expect(
      extractPlainTextFromRichTextDocument(fixture.content.get(left.id)!),
    ).toBe("left");
    expect(
      extractPlainTextFromRichTextDocument(fixture.content.get(right.id)!),
    ).toBe("right");
    expect(fixture.editor.undo()).toEqual({ status: "history-empty" });

    expect(fixture.editor.redo()).toEqual({ status: "applied" });
    expect(fixture.editor.getRootBlockIds()).toEqual([left.id]);
    expect(
      extractPlainTextFromRichTextDocument(fixture.content.get(left.id)!),
    ).toBe("leftright");
    fixture.dispose();
  });

  it.each([
    { status: "focused" as const },
    { status: "pending" as const },
    { status: "rejected" as const, reason: "native-focus-failed" as const },
  ])(
    "settles and presents an existing previous text target when pre-removal presentation is $status",
    (preRemovalResult) => {
      const previous = block(1, "paragraph");
      const empty = block(2, "paragraph");
      const anchorRuntime = createAssociationAwareTestAnchorRuntime();
      const commits: CanonicalEditorCommit[] = [];
      const fixture = createTestEditor({
        blocks: [previous, empty],
        content: new Map([
          [previous.id, text("Alpha")],
          [empty.id, text("")],
        ]),
        materializeAppliedBlocks: true,
        selectionAnchorRuntime: anchorRuntime,
        selectionAnchorRequiresContentAccess: true,
        onCanonicalCommit: (commit) => commits.push(commit),
      });
      expect(
        fixture.editor.selectionController.commitCanonicalSelection(
          anchorRuntime.selection(empty.id, 0, "backward"),
          fixture.editor,
          fixture.editor.getSelectionGraphRevision(),
          { publication: { kind: "standalone-local" }, cause: "keyboard" },
          { resolveTextAnchor: anchorRuntime.resolve },
        ),
      ).toMatchObject({ kind: "changed" });
      const canonicalBefore =
        fixture.editor.selectionController.getCanonicalSnapshot();
      expect(canonicalBefore.kind).toBe("document");
      if (canonicalBefore.kind !== "document") return;
      expect(canonicalBefore.snapshot.documentSelection.focus).toMatchObject({
        blockId: empty.id,
        textOffset: 0,
      });
      expect(
        canonicalBefore.snapshot.documentSelection.focus?.textAnchor,
      ).not.toBeNull();
      fixture.presentTextProjection.mockReturnValueOnce(preRemovalResult);

      expect(
        fixture.editor.executeCoreBlockKeyBehavior({
          key: "backspace",
          blockId: empty.id,
          blockType: empty.type,
          cursorOffset: 0,
        }),
      ).toBe(true);

      expect(fixture.editor.getRootBlockIds()).toEqual([previous.id]);
      expect(fixture.editor.getBlock(empty.id)).toBeNull();
      expect(transactionSelectionOffsets(commits[0]!)).toEqual({
        before: { blockId: empty.id, offset: 0 },
        after: { blockId: previous.id, offset: 5 },
      });
      const canonicalAfter =
        fixture.editor.selectionController.getCanonicalSnapshot();
      expect(canonicalAfter.kind).toBe("document");
      if (canonicalAfter.kind !== "document") return;
      expect(canonicalAfter.snapshot.documentSelection.focus).toMatchObject({
        blockId: previous.id,
        textOffset: 5,
      });
      expect(
        canonicalAfter.snapshot.documentSelection.focus?.textAnchor,
      ).not.toBeNull();
      expect(fixture.presentTextProjection).toHaveBeenCalledTimes(2);
      expect(fixture.presentTextProjection).toHaveBeenNthCalledWith(
        1,
        previous.id,
        expect.objectContaining({
          offset: 5,
          canonicalSelectionRevision: canonicalAfter.revision,
        }),
      );
      expect(fixture.presentTextProjection).toHaveBeenNthCalledWith(
        2,
        previous.id,
        expect.objectContaining({
          offset: 5,
          canonicalSelectionRevision: canonicalAfter.revision,
        }),
      );
      expect(fixture.acquireTextContentAccess).toHaveBeenCalledWith(
        previous.id,
      );
      expect(fixture.readTextContentAccessCount(previous.id)).toBe(0);
      fixture.dispose();
    },
  );

  it("joins a selected right block through core Backspace and replays its anchors without drift", () => {
    const left = block(1, "paragraph");
    const right = block(2, "paragraph");
    const anchorRuntime = createAssociationAwareTestAnchorRuntime();
    const commits: CanonicalEditorCommit[] = [];
    const fixture = createTestEditor({
      blocks: [left, right],
      content: new Map([
        [left.id, text("Alpha")],
        [right.id, text("Bravo")],
      ]),
      materializeAppliedBlocks: true,
      selectionAnchorRuntime: anchorRuntime,
      selectionAnchorRequiresContentAccess: true,
      onCanonicalCommit: (commit) => commits.push(commit),
    });
    const standaloneSelections: unknown[] = [];
    fixture.editor.selectionController.presentation.subscribe(() => {
      const settlement =
        fixture.editor.selectionController.getPresentationSnapshot().settlement;
      if (settlement?.publication.kind === "standalone-local") {
        standaloneSelections.push(settlement);
      }
    });
    expect(
      fixture.editor.selectionController.commitCanonicalSelection(
        anchorRuntime.selection(right.id, 0, null),
        fixture.editor,
        fixture.editor.getSelectionGraphRevision(),
        { publication: { kind: "standalone-local" }, cause: "keyboard" },
        { resolveTextAnchor: anchorRuntime.resolve },
      ),
    ).toMatchObject({ kind: "changed" });

    expect(
      fixture.editor.executeCoreBlockKeyBehavior({
        key: "backspace",
        blockId: right.id,
        blockType: right.type,
        cursorOffset: 0,
      }),
    ).toBe(true);
    expect(fixture.editor.getRootBlockIds()).toEqual([left.id]);
    expect(readContentText(fixture, left.id)).toBe("AlphaBravo");
    expect(fixture.editor.getBlock(right.id)).toBeNull();
    expect(fixture.acquireTextContentAccess).toHaveBeenCalledWith(right.id);
    expect(
      fixture.acquireTextContentAccess.mock.calls.filter(
        ([blockId]) => blockId === right.id,
      ),
    ).toHaveLength(1);
    expect(fixture.readTextContentAccessCount(right.id)).toBe(0);
    expect(transactionSelectionOffsets(commits[0]!)).toEqual({
      before: { blockId: right.id, offset: 0 },
      after: { blockId: left.id, offset: 5 },
    });
    expect(fixture.editor.canUndo).toBe(true);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      kind: "block-graph",
      graphChanges: [{ kind: "delete", blockId: right.id }],
      contentCommit: {
        blocks: [
          {
            blockId: left.id,
            contentOperations: [
              {
                kind: "insertInlineContent",
                position: { offset: 5 },
              },
            ],
          },
        ],
      },
    });
    expect(commits[0]).not.toHaveProperty("previousState");
    expect(commits[0]).not.toHaveProperty("optimisticState");
    expect(commits[0]).not.toHaveProperty("blockSlice");
    expect(standaloneSelections).toHaveLength(1);
    expect(fixture.readTextContentAccessCount(right.id)).toBe(0);
    const recorded = (
      fixture.editor as unknown as {
        readonly history: readonly EditorHistoryEntry[];
      }
    ).history[0];
    expect(recorded?.selectionBefore.kind).toBe("document");
    if (recorded?.selectionBefore.kind !== "document") {
      throw new Error("Expected selected donor history anchor");
    }
    expect(
      recorded.selectionBefore.selection.focus.textAnchor?.payload.assoc,
    ).toBe(-1);
    expect(recorded.inverse).toMatchObject({
      kind: "structuralTransaction",
      contentOperations: [
        {
          kind: "insertInlineContent",
          blockId: right.id,
          position: { offset: 0 },
          content: [{ type: "text", text: "Bravo" }],
        },
        {
          kind: "deleteInlineRange",
          blockId: left.id,
          range: { from: { offset: 5 }, to: { offset: 10 } },
        },
      ],
    });
    expect(recorded.forward).not.toHaveProperty("payload.rootBlockIds");
    expect(recorded.inverse).not.toHaveProperty("payload.childIdsByParentId");

    for (let cycle = 0; cycle < 2; cycle += 1) {
      expect(fixture.editor.undo()).toEqual({ status: "applied" });
      expect(fixture.editor.getRootBlockIds()).toEqual([left.id, right.id]);
      expect(readContentText(fixture, left.id)).toBe("Alpha");
      expect(readContentText(fixture, right.id)).toBe("Bravo");
      expect(readCanonicalSelection(fixture.editor)).toEqual({
        direction: "forward",
        anchor: 0,
        focus: 0,
      });
      expect(fixture.editor.redo()).toEqual({ status: "applied" });
      expect(fixture.editor.getRootBlockIds()).toEqual([left.id]);
      expect(readContentText(fixture, left.id)).toBe("AlphaBravo");
      expect(readCanonicalSelection(fixture.editor)).toEqual({
        direction: "forward",
        anchor: 5,
        focus: 5,
      });
    }
    expect(commits.map((commit) => commit.historyAction)).toEqual([
      "command",
      "undo",
      "redo",
      "undo",
      "redo",
    ]);
    expect(standaloneSelections).toHaveLength(1);
    expect(
      (
        fixture.editor as unknown as {
          readonly history: readonly EditorHistoryEntry[];
        }
      ).history,
    ).toHaveLength(1);
    fixture.dispose();
  });

  it("validates the exact prepared join candidate before committing it", () => {
    const left = block(1, "paragraph");
    const right = block(2, "paragraph");
    const observed: string[] = [];
    type DocumentValidator = NonNullable<
      InitializeEditorImplementationOptions["documentValidators"]
    >[number];
    const validator = vi.fn((candidate: Parameters<DocumentValidator>[0]) => {
      const leftContent = candidate.readContent(left.id, left.type);
      observed.push(
        leftContent
          ? extractPlainTextFromRichTextDocument(leftContent.content)
          : "missing-left",
      );
      observed.push(
        candidate.readContent(right.id, right.type) === null
          ? "removed-right"
          : "present-right",
      );
      return [];
    });
    const fixture = createTestEditor({
      blocks: [left, right],
      content: new Map([
        [left.id, text("Alpha")],
        [right.id, text("Bravo")],
      ]),
      materializeAppliedBlocks: true,
      documentValidators: [validator],
    });

    expect(
      fixture.editor.executeCoreBlockKeyBehavior({
        key: "backspace",
        blockId: right.id,
        blockType: right.type,
        cursorOffset: 0,
      }),
    ).toBe(true);
    expect(observed).toEqual(["AlphaBravo", "removed-right"]);
    expect(validator).toHaveBeenCalledOnce();
    expect(
      fixture.validateContentCommit.mock.invocationCallOrder[0],
    ).toBeLessThan(validator.mock.invocationCallOrder[0]!);
    expect(validator.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.commitContent.mock.invocationCallOrder[0]!,
    );
    fixture.dispose();
  });

  it("undoes and redoes moves without replacing block identities", () => {
    const first = block(1, "paragraph");
    const second = block(2, "paragraph");
    const fixture = createTestEditor({
      blocks: [first, second],
      content: new Map([
        [first.id, text("first")],
        [second.id, text("second")],
      ]),
    });

    const moved = fixture.editor.moveBlocks({
      blockIds: [second.id],
      destination: { parentId: null, childIndex: 0 },
    });

    expect(moved).toMatchObject({ ok: true, changed: true });
    expect(fixture.editor.getRootBlockIds()).toEqual([second.id, first.id]);
    expect(fixture.editor.undo()).toEqual({ status: "applied" });
    expect(fixture.editor.getRootBlockIds()).toEqual([first.id, second.id]);
    expect(fixture.editor.getBlock(second.id)?.id).toBe(second.id);
    expect(fixture.editor.redo()).toEqual({ status: "applied" });
    expect(fixture.editor.getRootBlockIds()).toEqual([second.id, first.id]);
    expect(fixture.editor.getBlock(second.id)?.id).toBe(second.id);
    fixture.dispose();
  });

  it("does not publish or record history for a no-op public move", () => {
    const first = block(1, "paragraph");
    const second = block(2, "paragraph");
    const fixture = createTestEditor({ blocks: [first, second] });

    const moved = fixture.editor.moveBlocks({
      blockIds: [first.id],
      destination: { parentId: null, childIndex: 0 },
    });

    expect(moved).toEqual({ ok: true, changed: false });
    expect(fixture.editor.getRootBlockIds()).toEqual([first.id, second.id]);
    expect(fixture.editor.canUndo).toBe(false);
    expect(fixture.onCanonicalCommit).not.toHaveBeenCalled();
    expect(fixture.publications).not.toHaveBeenCalled();
    fixture.dispose();
  });

  it("focuses the last editable descendant of an inserted closed wrapper", () => {
    const fixture = createTestEditor();
    const wrapperId = id(10);
    const childId = id(11);
    const result = fixture.editor.transaction(() => {
      fixture.editor.insertBlocks(
        { parentId: null, childIndex: 1 },
        createCanonicalBlockFragment({
          blocks: [
            { id: wrapperId, type: "callout", parentId: null },
            {
              id: childId,
              type: "paragraph",
              parentId: wrapperId,
              content: text("inside"),
              plainText: "inside",
            },
          ],
          rootBlockIds: [wrapperId],
          start: { kind: "block", blockId: wrapperId },
          end: { kind: "block", blockId: wrapperId },
          blockDefinitions: definitions,
        }),
      );
    });

    expect(result).toMatchObject({ ok: true, changed: true });
    expect(
      result.ok && result.changed ? result.transaction.selection : null,
    ).toEqual({
      kind: "block-end",
      blockId: childId,
    });
    fixture.dispose();
  });

  it("publishes no graph or history when content preparation fails", () => {
    const paragraph = block(1, "paragraph");
    const fixture = createTestEditor({
      blocks: [paragraph],
      content: new Map([[paragraph.id, text("abcdef")]]),
      rejectContentOperations: true,
    });
    const before = fixture.editor.getCommandState();
    const result = fixture.editor.transaction(() => {
      fixture.editor.deleteRange({
        graphRevision: before.blockGraphVersion,
        selectionRevision: 1,
        blocks: [
          {
            kind: "text",
            blockId: paragraph.id,
            blockType: paragraph.type,
            parentId: null,
            from: 2,
            to: 4,
            expectedContentVersion: "1",
          },
        ],
        start: { kind: "text", blockId: paragraph.id, offset: 2 },
        end: { kind: "text", blockId: paragraph.id, offset: 4 },
      });
    });

    expect(result).toMatchObject({ ok: false, phase: "commit" });
    expect(fixture.editor.getCommandState().blockGraphVersion).toBe(
      before.blockGraphVersion,
    );
    expect(
      extractPlainTextFromRichTextDocument(fixture.content.get(paragraph.id)!),
    ).toBe("abcdef");
    expect(fixture.onCanonicalCommit).not.toHaveBeenCalled();
    expect(fixture.publications).not.toHaveBeenCalled();
    expect(fixture.validateContentCommit).toHaveBeenCalledTimes(1);
    expect(fixture.commitContent).not.toHaveBeenCalled();
    expect(fixture.publishContentCommit).not.toHaveBeenCalled();
    expect(fixture.markInconsistent).not.toHaveBeenCalled();
    fixture.dispose();
  });

  it("publishes no graph, semantic change, or history when content application fails", () => {
    const paragraph = block(1, "paragraph");
    const fixture = createTestEditor({
      blocks: [paragraph],
      content: new Map([[paragraph.id, text("abcdef")]]),
      failContentApplication: true,
    });
    const before = fixture.editor.getCommandState();
    const result = fixture.editor.transaction(() => {
      fixture.editor.deleteRange({
        graphRevision: before.blockGraphVersion,
        selectionRevision: 1,
        blocks: [
          {
            kind: "text",
            blockId: paragraph.id,
            blockType: paragraph.type,
            parentId: null,
            from: 2,
            to: 4,
            expectedContentVersion: "1",
          },
        ],
        start: { kind: "text", blockId: paragraph.id, offset: 2 },
        end: { kind: "text", blockId: paragraph.id, offset: 4 },
      });
    });

    expect(result).toMatchObject({ ok: false, phase: "commit" });
    expect(fixture.editor.getCommandState().blockGraphVersion).toBe(
      before.blockGraphVersion,
    );
    expect(
      extractPlainTextFromRichTextDocument(fixture.content.get(paragraph.id)!),
    ).toBe("abcdef");
    expect(fixture.editor.canUndo).toBe(false);
    expect(fixture.onCanonicalCommit).not.toHaveBeenCalled();
    expect(fixture.publications).not.toHaveBeenCalled();
    expect(fixture.validateContentCommit).toHaveBeenCalledTimes(1);
    expect(fixture.commitContent).toHaveBeenCalledTimes(1);
    expect(fixture.publishContentCommit).not.toHaveBeenCalled();
    expect(fixture.markInconsistent).not.toHaveBeenCalled();
    fixture.dispose();
  });
});

describe("EditorImplementation content selection presentation", () => {
  it("requires explicit proposal origin and selection presentation context", () => {
    expectTypeOf<
      Parameters<EditorImplementation["acceptContentOperationProposal"]>[1]
    >().toEqualTypeOf<ContentOperationProposalAcceptanceContext>();
    expectTypeOf<
      Parameters<
        EditorImplementation["acceptContentOperationProposal"]
      >["length"]
    >().toEqualTypeOf<2>();
  });

  it("settles native-established content into canonical selection only", () => {
    const fixture = createTestEditor({ materializeAppliedBlocks: true });

    const result = fixture.editor.acceptContentOperationProposal(
      contentInsertionProposal(fixture.editor, 0, "x", 1, 1),
      {
        origin: "prosemirror-proposal",
        selectionPresentation: "native-already-established",
        provenance: { kind: "typing", text: "x", inputType: "text" },
      },
    );

    expect(result.ok).toBe(true);
    expect(fixture.validateContentCommit).toHaveBeenCalledWith(
      expect.objectContaining({ origin: "prosemirror-proposal" }),
    );
    expect(readContentText(fixture, id(1))).toBe("xone");
    expect(readCanonicalSelection(fixture.editor)).toEqual({
      direction: "forward",
      anchor: 1,
      focus: 1,
    });
    expect(fixture.onCanonicalCommit).toHaveBeenCalledOnce();
    const commit = fixture.onCanonicalCommit.mock.calls[0]![0];
    expect(Object.hasOwn(commit, "selectionBefore")).toBe(true);
    expect(Object.hasOwn(commit, "selectionAfter")).toBe(true);
    expect(commit.selectionBefore).toEqual({ kind: "none" });
    expect(commit.selectionBefore).not.toEqual({});
    expect(commit.selectionAfter).toMatchObject({
      kind: "selection",
      selection: {
        kind: "document",
        direction: "forward",
        anchor: { kind: "text", blockId: id(1) },
        focus: { kind: "text", blockId: id(1) },
      },
    });
    expect(commit.baseDocumentRevision).toBe(1);
    expect(commit.documentRevision).toBe(2);
    expect(commit.provenance).toEqual({
      kind: "typing",
      text: "x",
      inputType: "text",
    });
    expect(fixture.requestNativeFocus).not.toHaveBeenCalled();
    expect(fixture.editor.canUndo).toBe(true);
    fixture.dispose();
  });

  it("rejects prepared no-change before apply, identity, revision, history, or publication", () => {
    const fixture = createTestEditor({
      materializeAppliedBlocks: true,
      preparedNoChangeCount: 1,
    });

    const result = fixture.editor.acceptContentOperationProposal(
      contentInsertionProposal(fixture.editor, 0, "x", 1, 1),
      {
        origin: "prosemirror-proposal",
        selectionPresentation: "native-already-established",
        provenance: null,
      },
    );

    expect(result).toMatchObject({ ok: false, reason: "no-change" });
    expect(fixture.validateContentCommit).toHaveBeenCalledOnce();
    expect(fixture.commitContent).not.toHaveBeenCalled();
    expect(fixture.publishContentCommit).not.toHaveBeenCalled();
    expect(fixture.markInconsistent).not.toHaveBeenCalled();
    expect(fixture.editor.getEditorInfo().documentRevision).toBe(1);
    expect(fixture.editor.canUndo).toBe(false);
    expect(fixture.onCanonicalCommit).not.toHaveBeenCalled();

    const accepted = fixture.editor.acceptContentOperationProposal(
      contentInsertionProposal(fixture.editor, 0, "x", 1, 1),
      {
        origin: "prosemirror-proposal",
        selectionPresentation: "native-already-established",
        provenance: null,
      },
    );
    expect(accepted.ok).toBe(true);
    expect(fixture.onCanonicalCommit.mock.calls[0]?.[0].transactionId).toBe(
      "1:1",
    );
    fixture.dispose();
  });

  it("does not leave transaction ID gaps after rejected proposals", () => {
    const fixture = createTestEditor({ materializeAppliedBlocks: true });
    const settleSelection = vi.spyOn(
      fixture.editor.selectionController,
      "commitCanonicalSelection",
    );

    const rejected = fixture.editor.acceptContentOperationProposal(
      contentInsertionProposal(fixture.editor, 0, "x", 100, 100),
      {
        origin: "prosemirror-proposal",
        selectionPresentation: "native-already-established",
        provenance: null,
      },
    );
    const accepted = fixture.editor.acceptContentOperationProposal(
      contentInsertionProposal(fixture.editor, 0, "x", 1, 1),
      {
        origin: "prosemirror-proposal",
        selectionPresentation: "native-already-established",
        provenance: null,
      },
    );

    expect(rejected).toMatchObject({ ok: false, reason: "invalid-operation" });
    expect(accepted.ok).toBe(true);
    expect(fixture.onCanonicalCommit).toHaveBeenCalledOnce();
    expect(fixture.onCanonicalCommit.mock.calls[0]?.[0].transactionId).toBe(
      "1:1",
    );
    expect(settleSelection.mock.calls.at(-1)?.[3]).toMatchObject({
      publication: { kind: "transaction", transactionId: "1:1" },
    });
    fixture.dispose();
  });

  it("preserves a native-established backward range without native restoration", () => {
    const fixture = createTestEditor({ materializeAppliedBlocks: true });

    const result = fixture.editor.acceptContentOperationProposal(
      contentInsertionProposal(fixture.editor, 0, "x", 3, 1, "backward"),
      {
        origin: "prosemirror-proposal",
        selectionPresentation: "native-already-established",
        provenance: null,
      },
    );

    expect(result.ok).toBe(true);
    expect(readCanonicalSelection(fixture.editor)).toEqual({
      direction: "backward",
      anchor: 3,
      focus: 1,
    });
    expect(fixture.requestNativeFocus).not.toHaveBeenCalled();
    fixture.dispose();
  });

  it("restores collapsed and range canonical selections without native focus", () => {
    const collapsed = createTestEditor({ materializeAppliedBlocks: true });
    expect(
      collapsed.editor.acceptContentOperationProposal(
        contentInsertionProposal(collapsed.editor, 0, "x", 1, 1),
        {
          origin: "prosemirror-proposal",
          selectionPresentation: "restore-native",
          provenance: null,
        },
      ).ok,
    ).toBe(true);
    expect(readCanonicalSelection(collapsed.editor)).toMatchObject({
      anchor: 1,
      focus: 1,
    });
    expect(collapsed.requestNativeFocus).not.toHaveBeenCalled();
    collapsed.dispose();

    const range = createTestEditor({ materializeAppliedBlocks: true });
    expect(
      range.editor.acceptContentOperationProposal(
        contentInsertionProposal(range.editor, 0, "x", 3, 1, "backward"),
        {
          origin: "prosemirror-proposal",
          selectionPresentation: "restore-native",
          provenance: null,
        },
      ).ok,
    ).toBe(true);
    expect(readCanonicalSelection(range.editor)).toMatchObject({
      direction: "backward",
      anchor: 3,
      focus: 1,
    });
    expect(range.requestNativeFocus).not.toHaveBeenCalled();
    range.dispose();
  });

  it("replays content undo and redo selection without requesting native focus", () => {
    const selectionAnchorRuntime = createAssociationAwareTestAnchorRuntime();
    const fixture = createTestEditor({
      materializeAppliedBlocks: true,
      selectionAnchorRuntime,
    });
    expect(
      fixture.editor.selectionController.commitCanonicalSelection(
        selectionAnchorRuntime.selection(id(1), 0, "forward"),
        fixture.editor,
        fixture.editor.getSelectionGraphRevision(),
        {
          publication: { kind: "standalone-local" },
          cause: "focus",
        },
        {
          resolveTextAnchor: (point) => ({
            ok: true,
            blockId: point.blockId,
            textAnchor: point.textAnchor!,
            textOffset: point.textOffset,
            affinity: point.affinity,
          }),
        },
      ),
    ).toMatchObject({ kind: "changed" });
    expect(
      fixture.editor.acceptContentOperationProposal(
        contentInsertionProposal(fixture.editor, 0, "x", 1, 1),
        {
          origin: "prosemirror-proposal",
          selectionPresentation: "native-already-established",
          provenance: null,
        },
      ).ok,
    ).toBe(true);
    fixture.requestNativeFocus.mockClear();

    expect(fixture.editor.undo()).toEqual({ status: "applied" });
    expect(readContentText(fixture, id(1))).toBe("one");
    expect(readCanonicalSelection(fixture.editor)).toMatchObject({
      anchor: 0,
      focus: 0,
    });
    expect(fixture.requestNativeFocus).not.toHaveBeenCalled();

    expect(fixture.editor.redo()).toEqual({ status: "applied" });
    expect(readContentText(fixture, id(1))).toBe("xone");
    expect(readCanonicalSelection(fixture.editor)).toMatchObject({
      anchor: 1,
      focus: 1,
    });
    expect(fixture.requestNativeFocus).not.toHaveBeenCalled();
    fixture.dispose();
  });

  it("keeps public semantic content mutation canonical and focus-neutral", () => {
    const fixture = createTestEditor({ materializeAppliedBlocks: true });
    expect(
      fixture.editor.selectionController.commitCanonicalSelection(
        editorSelection(1, 1, "forward"),
        fixture.editor,
        fixture.editor.getSelectionGraphRevision(),
        {
          publication: { kind: "standalone-local" },
          cause: "focus",
        },
        {
          resolveTextAnchor: (point) => ({
            ok: true,
            blockId: point.blockId,
            textAnchor: point.textAnchor!,
            textOffset: point.textOffset,
            affinity: point.affinity,
          }),
        },
      ),
    ).toMatchObject({ kind: "changed" });

    expect(
      fixture.editor.insertText({ blockId: id(1), offset: 1, text: "x" }),
    ).toBe(true);

    expect(fixture.requestNativeFocus).not.toHaveBeenCalled();
    expect(fixture.validateContentCommit).toHaveBeenCalledWith(
      expect.objectContaining({ origin: "public-semantic-mutation" }),
    );
    fixture.dispose();
  });

  it("publishes the retained canonical selection when a programmatic proposal is rejected", () => {
    const fixture = createTestEditor({ materializeAppliedBlocks: true });
    const accepted = editorSelection(1, 1, "forward");
    expect(
      fixture.editor.selectionController.commitCanonicalSelection(
        accepted,
        fixture.editor,
        fixture.editor.getSelectionGraphRevision(),
        {
          publication: { kind: "standalone-local" },
          cause: "focus",
        },
        {
          resolveTextAnchor: (point) => ({
            ok: true,
            blockId: point.blockId,
            textAnchor: point.textAnchor!,
            textOffset: point.textOffset,
            affinity: point.affinity,
          }),
        },
      ),
    ).toMatchObject({ kind: "changed" });
    const retained = projectCanonicalSelectionToTransaction(
      fixture.editor.selectionController.getCanonicalSnapshot(),
    );
    const invalidPoint = {
      ...accepted.anchor,
      blockId: id(99),
    };
    fixture.onCanonicalCommit.mockClear();

    expect(
      fixture.editor.insertText(
        { blockId: id(1), offset: 1, text: "x" },
        {
          selectionEffect: {
            kind: "selection",
            selection: {
              direction: "forward",
              anchor: invalidPoint,
              focus: invalidPoint,
            },
          },
        },
      ),
    ).toBe(true);

    expect(fixture.onCanonicalCommit).toHaveBeenCalledOnce();
    expect(fixture.onCanonicalCommit.mock.calls[0]![0].selectionAfter).toEqual(
      retained,
    );
    expect(
      fixture.onCanonicalCommit.mock.calls[0]![0].selectionAfter,
    ).not.toMatchObject({
      selection: { anchor: { blockId: id(99) } },
    });
    fixture.dispose();
  });

  it("settles a block-owned internal programmatic effect before publication", () => {
    const divider = block(2, "divider");
    const fixture = createTestEditor({
      blocks: [block(1, "paragraph"), divider],
      content: new Map([[id(1), text("one")]]),
    });
    const model = fixture.editor.readBlockSelectionModel(divider.id);
    if (!model) throw new Error("Expected divider selection model");
    const payload = {
      kind: "cell-range",
      anchorCellId: "cell-a",
      focusCellId: "cell-b",
    } as const;

    expect(
      fixture.editor.updateBlockMetadata(
        [{ blockId: divider.id, values: { selected: true } }],
        {
          selectionEffect: {
            kind: "block-internal",
            blockId: divider.id,
            subsystem: internalSelectionSubsystem,
            coverageResult: {
              blockId: divider.id,
              blockType: divider.type,
              modelId: model.id,
              coverage: "partial",
              internal: payload,
              stableSelectionPayload: payload,
            },
          },
        },
      ),
    ).toBe(true);

    expect(fixture.onCanonicalCommit).toHaveBeenCalledOnce();
    expect(fixture.onCanonicalCommit.mock.calls[0]![0].selectionAfter).toEqual({
      kind: "selection",
      selection: {
        kind: "block-internal",
        blockId: divider.id,
        subsystem: "test.programmatic-block-selection",
        payload,
      },
    });

    fixture.onCanonicalCommit.mockClear();
    expect(fixture.editor.undo()).toEqual({ status: "applied" });
    expect(fixture.onCanonicalCommit).toHaveBeenCalledOnce();
    expect(fixture.onCanonicalCommit.mock.calls[0]![0]).toMatchObject({
      historyAction: "undo",
      selectionAfter: { kind: "none" },
    });

    fixture.onCanonicalCommit.mockClear();
    expect(fixture.editor.redo()).toEqual({ status: "applied" });
    expect(fixture.onCanonicalCommit).toHaveBeenCalledOnce();
    expect(fixture.onCanonicalCommit.mock.calls[0]![0].selectionAfter).toEqual({
      kind: "selection",
      selection: {
        kind: "block-internal",
        blockId: divider.id,
        subsystem: "test.programmatic-block-selection",
        payload,
      },
    });
    fixture.dispose();
  });

  it("settles selection, records history, then publishes without extra operations", () => {
    const order: string[] = [];
    let historyVisibleAtPublication = false;
    const fixture = createTestEditor({
      materializeAppliedBlocks: true,
      onCanonicalCommit: (_commit, editor) => {
        historyVisibleAtPublication = editor.canUndo;
        order.push("publication");
      },
    });
    fixture.editor.selectionController.canonical.subscribe(() =>
      order.push("selection"),
    );

    expect(
      fixture.editor.acceptContentOperationProposal(
        contentInsertionProposal(fixture.editor, 0, "x", 1, 1),
        {
          origin: "prosemirror-proposal",
          selectionPresentation: "native-already-established",
          provenance: null,
        },
      ).ok,
    ).toBe(true);

    expect(order).toEqual(["selection", "publication"]);
    expect(historyVisibleAtPublication).toBe(true);
    expect(fixture.commitContent).toHaveBeenCalledTimes(1);
    expect(fixture.editor.canUndo).toBe(true);
    fixture.dispose();
  });

  it("keeps committed canonical state when the receipt consumer throws", () => {
    const fixture = createTestEditor({
      materializeAppliedBlocks: true,
      onCanonicalCommit: () => {
        throw new Error("consumer failed");
      },
    });

    const result = fixture.editor.acceptContentOperationProposal(
      contentInsertionProposal(fixture.editor, 0, "x", 1, 1),
      {
        origin: "prosemirror-proposal",
        selectionPresentation: "native-already-established",
        provenance: null,
      },
    );

    expect(result.ok).toBe(true);
    expect(readContentText(fixture, id(1))).toBe("xone");
    expect(fixture.editor.getEditorInfo().documentRevision).toBe(2);
    expect(fixture.editor.canUndo).toBe(true);
    expect(fixture.publishContentCommit).toHaveBeenCalledOnce();
    fixture.dispose();
  });
});

function contentInsertionProposal(
  editor: EditorImplementation,
  offset: number,
  insertedText: string,
  anchorOffset: number,
  focusOffset: number,
  direction: "forward" | "backward" = "forward",
) {
  const target = id(1);
  const content = [{ type: "text" as const, text: insertedText }];
  return {
    base: {
      blockId: target,
      blockType: "paragraph" as const,
      graphRevision: editor.getSelectionGraphRevision(),
      contentRevision: 0,
    },
    operations: [
      {
        kind: "insertInlineContent" as const,
        blockId: target,
        blockType: "paragraph" as const,
        target: { kind: "text" as const },
        position: { blockId: target, offset, contentVersion: "1" },
        content,
      },
    ],
    selectionAfter: {
      direction,
      anchor: {
        blockId: target,
        blockType: "paragraph" as const,
        textOffset: anchorOffset,
        affinity:
          anchorOffset < focusOffset
            ? ("backward" as const)
            : ("forward" as const),
      },
      focus: {
        blockId: target,
        blockType: "paragraph" as const,
        textOffset: focusOffset,
        affinity:
          focusOffset < anchorOffset
            ? ("backward" as const)
            : ("forward" as const),
      },
    },
  };
}

function editorSelection(
  anchorOffset: number,
  focusOffset: number,
  direction: "forward" | "backward",
) {
  const point = (offset: number) => {
    const anchor = createEditorSelectionTextAnchor({
      codec: "test-runtime-anchor",
      payload: { encoded: "AQ==", assoc: 1 },
    });
    if (!anchor.ok) throw new Error(anchor.message);
    return {
      blockId: id(1),
      blockType: "paragraph" as const,
      blockCategory: "text" as const,
      textOffset: offset,
      textAnchor: anchor.textAnchor,
      affinity: null,
    };
  };
  return {
    direction,
    anchor: point(anchorOffset),
    focus: point(focusOffset),
  };
}

function readCanonicalSelection(editor: EditorImplementation) {
  const canonical = editor.selectionController.canonical.getSnapshot();
  const selection =
    canonical.kind === "document" ? canonical.snapshot.documentSelection : null;
  return selection
    ? {
        direction: selection.direction,
        anchor: selection.anchor?.textOffset,
        focus: selection.focus?.textOffset,
      }
    : null;
}

function readContentText(
  fixture: ReturnType<typeof createTestEditor>,
  blockId: BlockId,
): string {
  const content = fixture.content.get(blockId);
  return content ? extractPlainTextFromRichTextDocument(content) : "";
}

interface AssociationAwareTestAnchorRuntime {
  readonly create: (input: {
    readonly blockId: BlockId;
    readonly blockType: BlockType;
    readonly textOffset: number;
    readonly affinity: EditorSelectionTextAffinity | null;
  }) =>
    | {
        readonly ok: true;
        readonly textAnchor: EditorSelectionTextAnchor;
        readonly textOffset: number;
      }
    | { readonly ok: false };
  readonly resolve: NonNullable<
    import("../api/contracts.ts").InitializeEditorImplementationOptions["resolveSelectionTextAnchor"]
  >;
  readonly apply: (operation: EditorLogicalContentOperation) => void;
  readonly selection: (
    blockId: BlockId,
    offset: number,
    affinity: EditorSelectionTextAffinity,
  ) => EditorSelection;
  readonly offset: (anchor: EditorSelectionTextAnchor) => number | null;
}

function createAssociationAwareTestAnchorRuntime(): AssociationAwareTestAnchorRuntime {
  interface StoredAnchor {
    readonly blockId: BlockId;
    readonly assoc: -1 | 0 | 1;
    offset: number;
  }
  const anchors = new Map<string, StoredAnchor>();
  let sequence = 0;
  const create: AssociationAwareTestAnchorRuntime["create"] = (input) => {
    sequence += 1;
    const encoded = btoa(`association-aware-anchor:${sequence}`);
    const assoc =
      input.affinity === "backward" ? -1 : input.affinity === "forward" ? 1 : 0;
    const created = createEditorSelectionTextAnchor({
      codec: "association-aware-test-runtime",
      payload: { encoded, assoc },
    });
    if (!created.ok) return { ok: false };
    anchors.set(encoded, {
      blockId: input.blockId,
      assoc,
      offset: input.textOffset,
    });
    return {
      ok: true,
      textAnchor: created.textAnchor,
      textOffset: input.textOffset,
    };
  };
  const resolve: AssociationAwareTestAnchorRuntime["resolve"] = (point) => {
    const encoded = point.textAnchor?.payload.encoded;
    const stored = encoded ? anchors.get(encoded) : undefined;
    return stored && stored.blockId === point.blockId
      ? {
          ok: true,
          blockId: stored.blockId,
          textAnchor: point.textAnchor!,
          textOffset: stored.offset,
          affinity:
            stored.assoc < 0
              ? ("backward" as const)
              : stored.assoc > 0
                ? ("forward" as const)
                : null,
        }
      : { ok: false, reason: "missing-text", blockId: point.blockId };
  };
  const apply = (operation: EditorLogicalContentOperation): void => {
    if (
      operation.kind === "addInlineMark" ||
      operation.kind === "removeInlineMark"
    ) {
      return;
    }
    const from =
      operation.kind === "insertInlineContent"
        ? operation.position.offset
        : operation.range.from.offset;
    const to =
      operation.kind === "insertInlineContent"
        ? operation.position.offset
        : operation.range.to.offset;
    const insertedSize =
      operation.kind === "deleteInlineRange"
        ? 0
        : operation.kind === "insertInlineContent" ||
            operation.kind === "replaceInlineRange"
          ? richInlineContentSize(operation.content)
          : 1;
    for (const anchor of anchors.values()) {
      if (anchor.blockId !== operation.blockId) continue;
      if (anchor.offset < from) continue;
      if (anchor.offset > to) {
        anchor.offset += insertedSize - (to - from);
      } else {
        anchor.offset = anchor.assoc < 0 ? from : from + insertedSize;
      }
    }
  };
  const selection: AssociationAwareTestAnchorRuntime["selection"] = (
    blockId,
    offset,
    affinity,
  ) => {
    const created = create({
      blockId,
      blockType: "paragraph",
      textOffset: offset,
      affinity,
    });
    if (!created.ok) throw new Error("Failed to create test selection anchor");
    const point: EditorLogicalSelectionPoint = {
      blockId,
      blockType: "paragraph",
      blockCategory: "text",
      textOffset: offset,
      textAnchor: created.textAnchor,
      affinity,
    };
    return {
      direction: "forward",
      anchor: point,
      focus: { ...point },
    };
  };
  return {
    create,
    resolve,
    apply,
    selection,
    offset: (anchor) => anchors.get(anchor.payload.encoded)?.offset ?? null,
  };
}

function transactionSelectionOffsets(commit: CanonicalEditorCommit): {
  readonly before: { readonly blockId: BlockId; readonly offset: number };
  readonly after: { readonly blockId: BlockId; readonly offset: number };
} {
  const point = (selection: CanonicalEditorCommit["selectionBefore"]) => {
    if (
      selection.kind !== "selection" ||
      selection.selection.kind !== "document" ||
      selection.selection.focus.kind !== "text"
    ) {
      throw new Error("Expected a text transaction selection");
    }
    return {
      blockId: selection.selection.focus.blockId,
      offset: selection.selection.focus.textOffset,
    };
  };
  return {
    before: point(commit.selectionBefore),
    after: point(commit.selectionAfter),
  };
}
