import type { VersionedBlock } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  contentSelection,
  wholeSelection,
  wrapperSelection,
  type BlockSelectionModel,
} from "@repo/editor-core/selection";
import {
  createEditorSelectionTextAnchor,
  normalizeNewSelection,
  type EditorLogicalSelectionPoint,
  type EditorSelectionGraphReader,
} from "@repo/editor-react/selection";
import { describe, expect, it } from "vitest";
import { firstDraftBlockDefinitions } from "./first-draft-definition.tsx";
import { firstDraftBlockModelDefinitions } from "./server/block-definitions.ts";

const listItemTypes = [
  "bulletListItem",
  "orderedListItem",
  "checklistItem",
] as const;

describe("First Draft definition ownership", () => {
  it("extends one canonical block-model registry with one renderer per type", () => {
    expect(Object.keys(firstDraftBlockDefinitions)).toEqual(
      Object.keys(firstDraftBlockModelDefinitions),
    );
    for (const [type, model] of Object.entries(
      firstDraftBlockModelDefinitions,
    )) {
      const editable =
        firstDraftBlockDefinitions[
          type as keyof typeof firstDraftBlockDefinitions
        ];
      expect(editable.renderer, `${type} renderer`).toBeTypeOf("function");
      for (const [key, value] of Object.entries(model)) {
        expect(
          editable[key as keyof typeof editable],
          `${type}.${key}`,
        ).toEqual(value);
      }
    }
  });

  it.each(listItemTypes)(
    "keeps %s on the ignored wrapper selection contract",
    (type) => {
      const definition = firstDraftBlockDefinitions[type];
      const selection = resolveDefinitionSelection(definition);

      expect(definition.kind).toBe("wrapper");
      expect(definition.selection).toBeUndefined();
      expect(selection).toMatchObject({
        id: "wrapper",
        coverage: { selected: "none" },
        projection: {
          category: "wrapper",
          canStartSelection: false,
          selectable: false,
        },
        fragment: { kind: "wrapper" },
      });
      expect(selection.id).not.toBe("whole");
      expect(selection.fragment).not.toEqual({ kind: "block" });
    },
  );

  it("routes a cross-list text range through item and container wrappers without whole-block paint", () => {
    const graph = createListSelectionGraph();
    const anchor = textPoint(graph, "before", 2);
    const focus = textPoint(graph, "after", 3);
    const normalized = normalizeNewSelection({ anchor, focus }, graph);

    expect(normalized.ok).toBe(true);
    if (!normalized.ok) throw new Error(normalized.reason);

    expect(normalized.range.anchor.blockId).toBe("before");
    expect(normalized.range.focus.blockId).toBe("after");
    expect(
      normalized.range.rangeBlocks
        .filter(
          ({ coverageResult }) => coverageResult.paint?.kind === "content",
        )
        .map(({ blockId }) => blockId),
    ).toEqual(["before", "item-a-text", "item-b-text", "after"]);

    const wrappers = normalized.range.rangeBlocks.filter(
      ({ category }) => category === "wrapper",
    );
    expect(wrappers.map(({ blockId }) => blockId)).toEqual([
      "list",
      "item-a",
      "item-b",
    ]);
    expect(wrappers).toEqual(
      wrappers.map(() =>
        expect.objectContaining({
          selectable: false,
          coverageResult: expect.objectContaining({ modelId: "wrapper" }),
        }),
      ),
    );
    expect(
      wrappers.some(
        ({ coverage, coverageResult }) =>
          coverage === "complete-block" ||
          (coverageResult.paint?.kind === "block-surface" &&
            coverage === "complete-block"),
      ),
    ).toBe(false);
  });
});

function resolveDefinitionSelection(definition: {
  readonly kind: "text" | "atomic" | "wrapper";
  readonly selection?: BlockSelectionModel;
}): BlockSelectionModel {
  return (
    definition.selection ??
    (definition.kind === "text"
      ? contentSelection()
      : definition.kind === "atomic"
        ? wholeSelection()
        : wrapperSelection())
  );
}

function createListSelectionGraph(): EditorSelectionGraphReader {
  const blocks = new Map<BlockId, VersionedBlock>([
    block("before", "paragraph", null),
    block("list", "bulletList", null, false),
    block("item-a", "bulletListItem", "list", false),
    block("item-a-text", "paragraph", "item-a"),
    block("item-b", "bulletListItem", "list", false),
    block("item-b-text", "paragraph", "item-b"),
    block("after", "paragraph", null),
  ]);
  const children = new Map<BlockId, readonly BlockId[]>([
    ["list" as BlockId, ["item-a", "item-b"] as BlockId[]],
    ["item-a" as BlockId, ["item-a-text"] as BlockId[]],
    ["item-b" as BlockId, ["item-b-text"] as BlockId[]],
  ]);
  return {
    getBlock: (blockId) => blocks.get(blockId) ?? null,
    getParentId: (blockId) => blocks.get(blockId)?.parentId ?? null,
    getRootBlockIds: () => ["before", "list", "after"] as readonly BlockId[],
    getChildBlockIds: (blockId) => children.get(blockId) ?? [],
    readBlockSelectionModel: (blockId) => {
      const current = blocks.get(blockId);
      return current
        ? resolveDefinitionSelection(firstDraftBlockDefinitions[current.type]!)
        : null;
    },
  };
}

function block(
  id: string,
  type: VersionedBlock["type"],
  parentId: string | null,
  hasContent = true,
): readonly [BlockId, VersionedBlock] {
  const blockId = id as BlockId;
  return [
    blockId,
    {
      id: blockId,
      type,
      parentId: parentId as BlockId | null,
      metadataVersion: "1",
      contentVersion: hasContent ? "1" : null,
    },
  ];
}

function textPoint(
  graph: EditorSelectionGraphReader,
  blockId: string,
  textOffset: number,
): EditorLogicalSelectionPoint {
  const anchor = createEditorSelectionTextAnchor({
    codec: "first-draft-list-selection-test",
    payload: { encoded: btoa(`${blockId}:${textOffset}`), assoc: 0 },
  });
  if (!anchor.ok) throw new Error(anchor.message);
  const current = graph.getBlock(blockId as BlockId);
  if (!current) throw new Error(`Missing test block ${blockId}`);
  return {
    blockId: current.id,
    blockType: current.type,
    blockCategory: "text",
    textOffset,
    textAnchor: anchor.textAnchor,
    affinity: null,
  };
}
