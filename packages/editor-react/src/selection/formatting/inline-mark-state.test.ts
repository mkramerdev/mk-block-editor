import { describe, expect, it, vi } from "vitest";
import {
  primitiveInlineMarkDefinitions,
} from "@repo/editor-core/content/marks";
import { createBlockRichTextContentFromPlainText } from "@repo/editor-core/content/rich-text";
import type { BlockId } from "@repo/editor-core/kernel";
import type { CommittedSelectionSnapshot } from "../model/committed-selection-snapshot.ts";
import type { EditorSelectionGraphReader } from "../graph/reader.ts";
import { readCurrentSelectionInlineMarkFormatStates } from "./inline-mark-state.ts";

describe("current selection inline mark state", () => {
  it("reports missing text when the canonical projection is legitimately absent", () => {
    const selected = ["selected-a", "selected-b"] as const;

    const result = readCurrentSelectionInlineMarkFormatStates({
      selection: committedSelection(selected[0], selected[1]),
      marks: ["strong"],
      graph: selectionGraph(selected),
      graphRevision: 4,
      inlineMarks: primitiveInlineMarkDefinitions,
      blockDefinitions: {
        paragraph: { kind: "text", type: "paragraph", rootLayout: "normal" },
      },
      readCanonicalTextProjection: () => null,
    });

    expect(result).toEqual({
      ok: false,
      reason: "missing-text",
      blockId: selected[0],
    });
  });

  it("propagates canonical projection provider invariant failures", () => {
    const selected = ["selected-a", "selected-b"] as const;
    const providerFailure = new Error("canonical projection invariant failed");

    let thrown: unknown;
    try {
      readCurrentSelectionInlineMarkFormatStates({
        selection: committedSelection(selected[0], selected[1]),
        marks: ["strong"],
        graph: selectionGraph(selected),
        graphRevision: 4,
        inlineMarks: primitiveInlineMarkDefinitions,
        blockDefinitions: {
          paragraph: {
            kind: "text",
            type: "paragraph",
            rootLayout: "normal",
          },
        },
        readCanonicalTextProjection: () => {
          throw providerFailure;
        },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(providerFailure);
  });

  it("reads each selected canonical projection once and ignores 100 unrelated blocks", () => {
    const selected = ["selected-a", "selected-b"] as const;
    const unrelated = Array.from({ length: 100 }, (_, index) =>
      `unrelated-${index}`,
    );
    const blockIds = [...selected, ...unrelated] as BlockId[];
    const graph = selectionGraph(blockIds);
    const readCanonicalTextProjection = vi.fn((blockId: BlockId) =>
      createBlockRichTextContentFromPlainText(
        "paragraph",
        blockId === selected[0] ? "first" : "second",
      ),
    );

    const result = readCurrentSelectionInlineMarkFormatStates({
      selection: committedSelection(selected[0], selected[1]),
      marks: ["strong", "em", "underline", "strikethrough", "code", "link"],
      graph,
      graphRevision: 4,
      inlineMarks: primitiveInlineMarkDefinitions,
      blockDefinitions: {
        paragraph: { kind: "text", type: "paragraph", rootLayout: "normal" },
      },
      readCanonicalTextProjection,
    });

    expect(result).toMatchObject({ ok: true, blockIds: selected });
    expect(
      readCanonicalTextProjection.mock.calls.map(([blockId]) => blockId),
    ).toEqual(selected);
    expect(
      readCanonicalTextProjection.mock.calls.some(([blockId]) =>
        unrelated.includes(blockId),
      ),
    ).toBe(false);
  });
});

function selectionGraph(blockIds: readonly string[]): EditorSelectionGraphReader {
  return {
    getBlock: (blockId: BlockId) =>
      blockIds.includes(blockId)
        ? { id: blockId, type: "paragraph", tombstone: false }
        : null,
    readBlockSelectionModel: () => null,
    getRootBlockIds: () => blockIds as readonly BlockId[],
    getParentId: () => null,
    getChildBlockIds: () => [],
  } as EditorSelectionGraphReader;
}

function committedSelection(
  first: string,
  second: string,
): CommittedSelectionSnapshot {
  const anchor = point(first, 1);
  const head = point(second, 4);
  const rangeBlocks = [
    range(first, 1, 5),
    range(second, 0, 4),
  ];
  const documentSelection = {
    phase: "committed",
    selectionRevision: 9,
    graphRevision: 4,
    lastInvalidationReason: null,
    direction: "forward",
    anchor,
    focus: head,
    normalizedStart: anchor,
    normalizedEnd: head,
    rangeBlocks,
  } as const;
  return {
    revision: 9,
    kind: "document",
    owner: { kind: "document" },
    direction: "forward",
    endpoints: {
      anchor,
      head,
      normalizedStart: anchor,
      normalizedEnd: head,
    },
    blocks: rangeBlocks.map((block) => ({
      ...block,
      owner: { kind: "document" as const },
    })),
    materialization: {
      kind: "deferred-runtime-derivation",
      sourceSelectionRevision: 9,
      owner: { kind: "document" },
    },
    edit: {
      kind: "deferred-runtime-derivation",
      sourceSelectionRevision: 9,
      owner: { kind: "document" },
    },
    focus: {
      kind: "deferred-runtime-derivation",
      sourceSelectionRevision: 9,
      owner: { kind: "document" },
      target: head,
    },
    documentSelection,
    documentProjection: null,
    internal: null,
  } as CommittedSelectionSnapshot;
}

function point(blockId: string, textOffset: number) {
  return {
    blockId: blockId as BlockId,
    blockType: "paragraph",
    blockCategory: "text",
    textOffset,
    textAnchor: {
      kind: "block-relative-text",
      codec: "test",
      version: 1,
      payload: { encoded: `${blockId}:${textOffset}`, assoc: 0 },
    },
    affinity: "forward",
  } as const;
}

function range(blockId: string, startOffset: number, endOffset: number) {
  return {
    blockId: blockId as BlockId,
    blockType: "paragraph",
    category: "text",
    coverage: "partial",
    coverageResult: {
      selected: "partial",
      paint: { kind: "content" },
      fragment: { kind: "content" },
      edit: { kind: "content" },
      delete: { kind: "content" },
      cut: { kind: "content" },
    },
    selectable: true,
    startOffset,
    endOffset,
  } as const;
}
