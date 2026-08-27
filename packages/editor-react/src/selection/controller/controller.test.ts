import { describe, expect, it, vi } from "vitest";
import type { VersionedBlock } from "@repo/editor-core/document";
import {
  asContentVersion,
  type BlockId,
  type JsonValue,
} from "@repo/editor-core/kernel";
import {
  contentSelection,
  wholeSelection,
  type BlockSelectionCoverageResult,
  type BlockSelectionModel,
} from "@repo/editor-core/selection";
import { createEditorSelectionTextAnchor } from "../anchors/text-anchor.ts";
import {
  readEditorBlockSelectionTarget,
  type EditorSelectionGraphReader,
} from "../graph/reader.ts";
import { registerInternalSelectionSubsystem } from "../model/committed-selection-snapshot.ts";
import {
  projectCanonicalSelectionToStable,
  projectCanonicalSelectionToTransaction,
} from "../model/stable-selection.ts";
import type {
  EditorLogicalSelectionPoint,
  EditorSelectionTextAnchorResolver,
  SelectionSettlementContext,
} from "../model/types.ts";
import { createEditorLogicalSelectionPoint } from "../normalization/normalize-point.ts";
import { createSelectionController } from "./controller.ts";

const standaloneKeyboard = {
  publication: { kind: "standalone-local" },
  cause: "keyboard",
} as const satisfies SelectionSettlementContext;
const standalonePointer = {
  publication: { kind: "standalone-local" },
  cause: "pointer",
} as const satisfies SelectionSettlementContext;
const silentRebase = {
  publication: { kind: "silent" },
  cause: "canonical-rebase",
} as const satisfies SelectionSettlementContext;
const transactionSettlement = {
  publication: { kind: "transaction", transactionId: "transaction-1" },
  cause: "programmatic-edit",
} as const satisfies SelectionSettlementContext;
const internalSubsystem = registerInternalSelectionSubsystem("test.gridWrapper")!;

describe("selection controller settlement ownership", () => {
  it.each([null, "backward", "forward"] as const)(
    "keeps a collapsed local text caret native with %s affinity",
    (affinity) => {
      const controller = createSelectionController();
      const graph = createGraph(["text"], contentSelection());
      const point = textPoint(graph, "text", 2, affinity ?? "forward");
      const canonicalPoint = affinity === null ? { ...point, affinity } : point;

      expect(
        controller.commitCanonicalSelection(
          {
            direction: "forward",
            anchor: canonicalPoint,
            focus: canonicalPoint,
          },
          graph,
          1,
          standalonePointer,
          anchorResolver(),
        ),
      ).toMatchObject({ kind: "changed" });
      expect(
        controller.getPresentationSnapshot().nativeSelectionPaintMode,
      ).toBe("visible");
    },
  );

  it("publishes text-pointer presentation without changing a collapsed canonical caret or paint", () => {
    const controller = createSelectionController();
    const graph = createGraph(["text"], contentSelection());
    const point = textPoint(graph, "text", 2, "forward");
    controller.commitCanonicalSelection(
      { direction: "forward", anchor: point, focus: point },
      graph,
      1,
      standalonePointer,
      anchorResolver(),
    );
    const before = controller.getCanonicalSnapshot();
    const modes: string[] = [];
    controller.presentation.subscribe(() => {
      modes.push(controller.getPresentationSnapshot().nativeSelectionPaintMode);
    });

    const claim = controller.claimTextPointerGesturePresentation();

    expect(controller.getCanonicalSnapshot()).toBe(before);
    expect(controller.localPaint.getSnapshot()).toEqual({ kind: "none" });
    expect(controller.getPresentationSnapshot().nativeSelectionPaintMode).toBe(
      "hidden-for-global-selection",
    );
    expect(modes).toEqual(["hidden-for-global-selection"]);
    expect(() => controller.claimTextPointerGesturePresentation()).toThrow(
      "Text pointer presentation already has an owner",
    );

    claim.release();

    expect(controller.getCanonicalSnapshot()).toBe(before);
    expect(controller.getPresentationSnapshot().nativeSelectionPaintMode).toBe(
      "visible",
    );
    expect(modes).toEqual(["hidden-for-global-selection", "visible"]);
    claim.release();
    expect(modes).toEqual(["hidden-for-global-selection", "visible"]);
  });

  it("hands pointer presentation directly to settled noncollapsed presentation", () => {
    const controller = createSelectionController();
    const graph = createGraph(["text"], contentSelection());
    const anchor = textPoint(graph, "text", 1, "forward");
    const focus = textPoint(graph, "text", 4, "forward");
    controller.commitCanonicalSelection(
      { direction: "forward", anchor, focus: anchor },
      graph,
      1,
      standalonePointer,
      anchorResolver(),
    );
    const modes: string[] = [];
    controller.presentation.subscribe(() => {
      modes.push(controller.getPresentationSnapshot().nativeSelectionPaintMode);
    });
    const claim = controller.claimTextPointerGesturePresentation();

    controller.commitCanonicalSelection(
      { direction: "forward", anchor, focus },
      graph,
      1,
      standalonePointer,
      anchorResolver(),
    );
    expect(controller.getPresentationSnapshot().nativeSelectionPaintMode).toBe(
      "hidden-for-global-selection",
    );

    claim.release();

    expect(controller.getPresentationSnapshot().nativeSelectionPaintMode).toBe(
      "hidden-for-global-selection",
    );
    expect(controller.localPaint.getSnapshot()).toMatchObject({
      kind: "range",
    });
    expect(modes).toEqual([
      "hidden-for-global-selection",
      "hidden-for-global-selection",
    ]);
  });

  it("keeps composition presentation above pointer ownership", () => {
    const controller = createSelectionController();
    const graph = createGraph(["text"], contentSelection());
    const point = textPoint(graph, "text", 2, "forward");
    controller.commitCanonicalSelection(
      { direction: "forward", anchor: point, focus: point },
      graph,
      1,
      standalonePointer,
      anchorResolver(),
    );
    const frozenSelection = controller.getCommittedSnapshot();
    if (!frozenSelection) throw new Error("Missing frozen caret selection");
    const modes: string[] = [];
    controller.presentation.subscribe(() => {
      modes.push(controller.getPresentationSnapshot().nativeSelectionPaintMode);
    });

    const claim = controller.claimTextPointerGesturePresentation();
    const composition = controller.beginCompositionSession({
      frozenSelection,
      graphRevision: 1,
      baseTokens: [],
      hostBlockId: "text" as BlockId,
    });
    expect(composition).not.toBeNull();
    claim.release();
    controller.completeCompositionSession(composition!.revision);

    expect(modes).toEqual([
      "hidden-for-global-selection",
      "composition-owned",
      "visible",
    ]);
  });

  it("publishes a truthful local range paint model independently of canonical caret revisions", () => {
    const controller = createSelectionController();
    const graph = createGraph(["text"], contentSelection());
    const paintListener = vi.fn();
    const canonicalListener = vi.fn();
    controller.localPaint.subscribe(paintListener);
    controller.canonical.subscribe(canonicalListener);
    const point = (offset: number) =>
      textPoint(graph, "text", offset, "forward");

    controller.commitCanonicalSelection(
      { direction: "forward", anchor: point(1), focus: point(1) },
      graph,
      1,
      standalonePointer,
      anchorResolver(),
    );
    const none = controller.localPaint.getSnapshot();
    expect(none).toEqual({ kind: "none" });

    controller.commitCanonicalSelection(
      { direction: "forward", anchor: point(2), focus: point(2) },
      graph,
      1,
      standalonePointer,
      anchorResolver(),
    );
    expect(controller.getCanonicalSnapshot().revision).toBe(2);
    expect(controller.localPaint.getSnapshot()).toBe(none);
    expect(paintListener).not.toHaveBeenCalled();
    expect(canonicalListener).toHaveBeenCalledTimes(2);

    controller.commitCanonicalSelection(
      { direction: "forward", anchor: point(1), focus: point(3) },
      graph,
      1,
      standaloneKeyboard,
      anchorResolver(),
    );
    const range = controller.localPaint.getSnapshot();
    expect(range).toMatchObject({ kind: "range", sourceRevision: 3 });
    expect(range.kind === "range" ? range.snapshot.revision : null).toBe(3);
    expect(paintListener).toHaveBeenCalledOnce();

    controller.commitCanonicalSelection(
      { direction: "forward", anchor: point(4), focus: point(4) },
      graph,
      1,
      standalonePointer,
      anchorResolver(),
    );
    expect(controller.getCanonicalSnapshot().revision).toBe(4);
    expect(controller.localPaint.getSnapshot()).toBe(none);
    expect(paintListener).toHaveBeenCalledTimes(2);

    controller.clearSelection(standalonePointer);
    expect(controller.getCanonicalSnapshot()).toMatchObject({
      kind: "none",
      revision: 5,
    });
    expect(controller.localPaint.getSnapshot()).toBe(none);
    expect(paintListener).toHaveBeenCalledTimes(2);
    expect(canonicalListener).toHaveBeenCalledTimes(5);
  });

  it("starts with an explicit canonical none state", () => {
    const controller = createSelectionController();

    expect(controller.getCanonicalSnapshot()).toEqual({
      kind: "none",
      revision: 0,
    });
    expect(
      projectCanonicalSelectionToTransaction(controller.getCanonicalSnapshot()),
    ).toEqual({
      kind: "none",
    });
  });

  it("settles keyboard document selection as standalone local", () => {
    const controller = createSelectionController();
    const graph = createGraph(["first", "second"], wholeSelection());
    const listener = vi.fn();
    controller.canonical.subscribe(listener);

    expect(
      controller.extendSelection(
        blockPoint(graph, "first"),
        blockPoint(graph, "second"),
        graph,
        1,
        standaloneKeyboard,
      ),
    ).not.toBeNull();

    expect(listener).toHaveBeenCalledOnce();
    expect(controller.getPresentationSnapshot().settlement).toMatchObject({
      sequence: 1,
      publication: { kind: "standalone-local" },
      cause: "keyboard",
    });
  });

  it("rejects unanchored content points at every public settlement entry", () => {
    const controller = createSelectionController();
    const graph = createGraph(["text"], contentSelection());
    const transient = {
      ...textPoint(graph, "text", 2, "forward"),
      textAnchor: null,
    };

    expect(
      controller.commitCanonicalSelection(
        { direction: "forward", anchor: transient, focus: transient },
        graph,
        1,
        standalonePointer,
      ),
    ).toMatchObject({ kind: "rejected" });
    expect(controller.getCanonicalSnapshot()).toEqual({
      kind: "none",
      revision: 0,
    });

    expect(
      controller.commitSelectionPoint(transient, graph, 1, standalonePointer),
    ).toMatchObject({ kind: "rejected" });
    expect(
      controller.extendSelection(
        transient,
        transient,
        graph,
        1,
        standalonePointer,
      ),
    ).toMatchObject({ kind: "rejected" });
    expect(controller.getCanonicalSnapshot()).toEqual({
      kind: "none",
      revision: 0,
    });
  });

  it("tags transaction-owned settlement without creating standalone ownership", () => {
    const controller = createSelectionController();
    const graph = createGraph(["text"], contentSelection());
    const point = textPoint(graph, "text", 2, "forward");

    expect(
      controller.commitCanonicalSelection(
        { direction: "forward", anchor: point, focus: point },
        graph,
        1,
        transactionSettlement,
        anchorResolver(),
      ),
    ).toMatchObject({ kind: "changed" });
    expect(controller.getPresentationSnapshot().settlement).toMatchObject({
      publication: {
        kind: "transaction",
        transactionId: "transaction-1",
      },
      cause: "programmatic-edit",
    });
  });

  it("treats a newly encoded projection acknowledgement of the same logical selection as unchanged", () => {
    const controller = createSelectionController();
    const graph = createGraph(["text"], contentSelection());
    const authoritative = textPoint(graph, "text", 2, "forward");
    const installed = controller.commitCanonicalSelection(
      {
        direction: "forward",
        anchor: authoritative,
        focus: authoritative,
      },
      graph,
      1,
      transactionSettlement,
      anchorResolver(),
    );
    expect(installed).toMatchObject({ kind: "changed" });
    const retained = controller.getCanonicalSnapshot();
    const settlement = controller.getPresentationSnapshot().settlement;
    const listener = vi.fn();
    controller.canonical.subscribe(listener);
    const acknowledgement = textPointWithEncoding(
      graph,
      "text",
      2,
      "forward",
      "Ag==",
    );

    expect(
      controller.commitCanonicalSelection(
        {
          direction: "forward",
          anchor: acknowledgement,
          focus: acknowledgement,
        },
        graph,
        1,
        standaloneKeyboard,
        anchorResolver(),
      ),
    ).toEqual({ kind: "unchanged", retainedSelection: retained });
    expect(controller.getCanonicalSnapshot()).toBe(retained);
    expect(controller.getPresentationSnapshot().settlement).toBe(settlement);
    expect(listener).not.toHaveBeenCalled();
  });

  it("installs a transaction-owned anchor at an unchanged visible offset before ignoring its equal standalone projection", () => {
    const controller = createSelectionController();
    const graph = createGraph(["text"], contentSelection());
    const initial = textPoint(graph, "text", 2, "forward");
    controller.commitCanonicalSelection(
      { direction: "forward", anchor: initial, focus: initial },
      graph,
      1,
      standaloneKeyboard,
      anchorResolver(),
    );
    const beforeTransaction = controller.getCanonicalSnapshot();
    const prepared = textPointWithEncoding(
      graph,
      "text",
      2,
      "backward",
      "Ag==",
    );

    expect(
      controller.commitCanonicalSelection(
        { direction: "forward", anchor: prepared, focus: prepared },
        graph,
        1,
        transactionSettlement,
        anchorResolver(),
      ),
    ).toMatchObject({ kind: "changed" });
    const authoritative = controller.getCanonicalSnapshot();
    expect(authoritative).not.toBe(beforeTransaction);
    expect(authoritative.revision).toBe(beforeTransaction.revision + 1);

    const acknowledgement = textPointWithEncoding(
      graph,
      "text",
      2,
      "forward",
      "Aw==",
    );
    expect(
      controller.commitCanonicalSelection(
        {
          direction: "forward",
          anchor: acknowledgement,
          focus: acknowledgement,
        },
        graph,
        1,
        standaloneKeyboard,
        anchorResolver(),
      ),
    ).toEqual({ kind: "unchanged", retainedSelection: authoritative });
    expect(controller.getCanonicalSnapshot()).toBe(authoritative);

    const changed = textPointWithEncoding(graph, "text", 3, "forward", "BA==");
    expect(
      controller.commitCanonicalSelection(
        { direction: "forward", anchor: changed, focus: changed },
        graph,
        1,
        standaloneKeyboard,
        anchorResolver(),
      ),
    ).toMatchObject({ kind: "changed" });
    expect(controller.getCanonicalSnapshot().revision).toBe(
      authoritative.revision + 1,
    );
  });

  it("keeps a same-block noncollapsed text range in canonical paint", () => {
    const controller = createSelectionController();
    const graph = createGraph(["text"], contentSelection());
    const anchor = textPoint(graph, "text", 0, "backward");
    const focus = textPoint(graph, "text", 5, "forward");

    expect(
      controller.commitCanonicalSelection(
        { direction: "forward", anchor, focus },
        graph,
        1,
        standaloneKeyboard,
        anchorResolver(),
      ),
    ).toMatchObject({ kind: "changed" });
    expect(controller.getPresentationSnapshot().nativeSelectionPaintMode).toBe(
      "hidden-for-global-selection",
    );
  });

  it("keeps cross-block text ranges in the global presentation", () => {
    const controller = createSelectionController();
    const graph = createGraph(["first", "second"], contentSelection());
    const anchor = textPoint(graph, "first", 0, "backward");
    const focus = textPoint(graph, "second", 2, "forward");

    expect(
      controller.commitCanonicalSelection(
        { direction: "forward", anchor, focus },
        graph,
        1,
        standaloneKeyboard,
        anchorResolver(),
      ),
    ).toMatchObject({ kind: "changed" });
    expect(controller.getPresentationSnapshot().nativeSelectionPaintMode).toBe(
      "hidden-for-global-selection",
    );
  });

  it("keeps a global keyboard extension hidden even within one text block", () => {
    const controller = createSelectionController();
    const graph = createGraph(["text"], contentSelection());
    const anchor = textPoint(graph, "text", 0, "backward");
    const focus = textPoint(graph, "text", 5, "forward");
    controller.setKeyboardNavigation({
      preferredX: null,
    });

    expect(
      controller.extendSelection(anchor, focus, graph, 1, standaloneKeyboard),
    ).toMatchObject({ kind: "changed" });
    expect(controller.getPresentationSnapshot().nativeSelectionPaintMode).toBe(
      "hidden-for-global-selection",
    );
  });

  it("rebases stable text anchors silently against the current graph", () => {
    const controller = createSelectionController();
    const graph = createGraph(["text"], contentSelection());
    const point = textPoint(graph, "text", 2, "forward");
    controller.commitCanonicalSelection(
      { direction: "forward", anchor: point, focus: point },
      graph,
      1,
      standaloneKeyboard,
      anchorResolver(),
    );

    const rebased = controller.reconcileCommittedGraphChange(
      graph,
      2,
      silentRebase,
      anchorResolver(3),
    );

    expect(rebased?.focus?.textOffset).toBe(5);
    expect(controller.getPresentationSnapshot().settlement).toMatchObject({
      publication: { kind: "silent" },
      cause: "canonical-rebase",
    });
  });

  it("returns a rejected result with the canonical selection actually retained", () => {
    const controller = createSelectionController();
    const graph = createGraph(["text"], contentSelection());
    const acceptedPoint = textPoint(graph, "text", 1, "backward");
    controller.commitCanonicalSelection(
      {
        direction: "forward",
        anchor: acceptedPoint,
        focus: acceptedPoint,
      },
      graph,
      1,
      standaloneKeyboard,
      anchorResolver(),
    );
    const retained = controller.getCanonicalSnapshot();
    const missingPoint = {
      ...acceptedPoint,
      blockId: id("missing"),
    };

    const rejected = controller.commitCanonicalSelection(
      {
        direction: "forward",
        anchor: missingPoint,
        focus: missingPoint,
      },
      graph,
      1,
      transactionSettlement,
      anchorResolver(),
    );

    expect(rejected).toEqual({
      kind: "rejected",
      retainedSelection: retained,
    });
    expect(controller.getCanonicalSnapshot()).toBe(retained);
    expect(projectCanonicalSelectionToTransaction(retained)).toMatchObject({
      kind: "selection",
      selection: {
        kind: "document",
        anchor: { blockId: id("text") },
      },
    });
  });

  it("publishes stable text anchors with projection fallback offsets", () => {
    const controller = createSelectionController();
    const graph = createGraph(["text"], contentSelection());
    const anchor = textPoint(graph, "text", 1, "forward");
    const focus = textPoint(graph, "text", 3, "backward");
    controller.commitCanonicalSelection(
      { direction: "forward", anchor, focus },
      graph,
      1,
      standaloneKeyboard,
      anchorResolver(),
    );

    const stable = projectCanonicalSelectionToStable(
      controller.getCanonicalSnapshot(),
    );
    expect(stable).toEqual({
      kind: "selection",
      selection: {
        kind: "document",
        direction: "forward",
        anchor: {
          kind: "text",
          blockId: id("text"),
          textOffset: 1,
          textAnchor: anchor.textAnchor,
          affinity: "forward",
        },
        focus: {
          kind: "text",
          blockId: id("text"),
          textOffset: 3,
          textAnchor: focus.textAnchor,
          affinity: "backward",
        },
      },
    });
  });

  it("treats clearing an already empty canonical selection as unchanged", () => {
    const controller = createSelectionController();

    expect(controller.clearSelection(standalonePointer)).toMatchObject({
      kind: "unchanged",
    });

    expect(controller.getCanonicalSnapshot()).toEqual({
      kind: "none",
      revision: 0,
    });
    expect(controller.getPresentationSnapshot().settlement).toBeNull();
  });

  it("projects a direct transport-safe block-internal payload", () => {
    const controller = createSelectionController();
    const graph = createGraph(["gridWrapper"], wholeSelection());
    const target = readEditorBlockSelectionTarget(graph, id("gridWrapper"));
    if (!target) throw new Error("Expected table selection target");
    const payload = {
      kind: "multi-cell",
      anchorCellId: "cell-a",
      headCellId: "cell-b",
    } as const;
    const coverage: BlockSelectionCoverageResult = {
      blockId: target.block.id,
      blockType: target.block.type,
      modelId: target.selection.id,
      coverage: "partial",
      internal: payload,
      stableSelectionPayload: payload,
    };

    expect(
      controller.commitBlockSelection(
        target,
        coverage,
        internalSubsystem,
        standalonePointer,
        1,
      ),
    ).not.toBeNull();

    expect(
      projectCanonicalSelectionToTransaction(controller.getCanonicalSnapshot()),
    ).toEqual({
      kind: "selection",
      selection: {
        kind: "block-internal",
        blockId: id("gridWrapper"),
        subsystem: "test.gridWrapper",
        payload,
      },
    });
    expect(controller.getPresentationSnapshot().nativeSelectionPaintMode).toBe(
      "hidden-for-global-selection",
    );
  });

  it("treats reordered internal JSON descriptors as the same selection", () => {
    const controller = createSelectionController();
    const graph = createGraph(["gridWrapper"], wholeSelection());
    const target = readEditorBlockSelectionTarget(graph, id("gridWrapper"));
    if (!target) throw new Error("Expected table selection target");
    const coverage = (internal: JsonValue) =>
      ({
        blockId: target.block.id,
        blockType: target.block.type,
        modelId: target.selection.id,
        coverage: "partial",
        internal,
        stableSelectionPayload: internal,
      }) satisfies BlockSelectionCoverageResult;

    expect(
      controller.commitBlockSelection(
        target,
        coverage({ a: 1, nested: { x: true, y: false }, order: [1, 2] }),
        internalSubsystem,
        standalonePointer,
        1,
      ),
    ).toMatchObject({ kind: "changed" });
    const revision = controller.getCanonicalSnapshot().revision;

    expect(
      controller.commitBlockSelection(
        target,
        coverage({ order: [1, 2], nested: { y: false, x: true }, a: 1 }),
        internalSubsystem,
        standalonePointer,
        1,
      ),
    ).toMatchObject({ kind: "unchanged" });
    expect(controller.getCanonicalSnapshot().revision).toBe(revision);

    expect(
      controller.commitBlockSelection(
        target,
        coverage({ order: [2, 1], nested: { y: false, x: true }, a: 1 }),
        internalSubsystem,
        standalonePointer,
        1,
      ),
    ).toMatchObject({ kind: "changed" });
    expect(controller.getCanonicalSnapshot().revision).toBe(revision + 1);
  });
});

function blockPoint(
  graph: EditorSelectionGraphReader,
  blockId: string,
): EditorLogicalSelectionPoint {
  const point = createEditorLogicalSelectionPoint({
    blockId: id(blockId),
    textOffset: 0,
    graph,
  });
  if (!point) throw new Error(`Missing selection point for ${blockId}`);
  return point;
}

function textPoint(
  graph: EditorSelectionGraphReader,
  blockId: string,
  offset: number,
  affinity: "forward" | "backward",
): EditorLogicalSelectionPoint {
  return textPointWithEncoding(graph, blockId, offset, affinity, "AQ==");
}

function textPointWithEncoding(
  graph: EditorSelectionGraphReader,
  blockId: string,
  offset: number,
  affinity: "forward" | "backward",
  encoded: string,
): EditorLogicalSelectionPoint {
  const created = createEditorSelectionTextAnchor({
    codec: "test-runtime-anchor",
    payload: {
      encoded,
      assoc: affinity === "backward" ? -1 : 1,
    },
  });
  if (!created.ok) throw new Error(created.message);
  const point = createEditorLogicalSelectionPoint({
    blockId: id(blockId),
    textOffset: offset,
    textAnchor: created.textAnchor,
    affinity,
    graph,
  });
  if (!point) throw new Error(`Missing text point for ${blockId}`);
  return point;
}

function anchorResolver(delta = 0): EditorSelectionTextAnchorResolver {
  return {
    resolveTextAnchor(point) {
      const offset = point.textOffset + delta;
      return Number.isSafeInteger(offset) && offset >= 0
        ? {
            ok: true,
            blockId: point.blockId,
            textAnchor: point.textAnchor!,
            textOffset: offset,
            affinity: point.affinity,
          }
        : { ok: false, reason: "invalid", blockId: point.blockId };
    },
  };
}

function createGraph(
  blockIds: readonly string[],
  model: BlockSelectionModel,
): EditorSelectionGraphReader {
  const blocks = new Map<BlockId, VersionedBlock>(
    blockIds.map((blockId) => [
      id(blockId),
      {
        id: id(blockId),
        type:
          model.projection.endpoint.kind === "content"
            ? "paragraph"
            : "containerWrapper",
        parentId: null,
        tombstone: null,
        metadataVersion: "1",
        contentVersion:
          model.projection.endpoint.kind === "content"
            ? asContentVersion("1")
            : null,
      },
    ]),
  );
  return {
    getBlock: (blockId) => blocks.get(blockId) ?? null,
    getParentId: () => null,
    getRootBlockIds: () => blockIds.map(id),
    getChildBlockIds: () => [],
    readBlockSelectionModel: () => model,
  };
}

function id(value: string): BlockId {
  return value as BlockId;
}
