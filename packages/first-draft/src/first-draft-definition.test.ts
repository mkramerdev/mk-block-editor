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
import {
  createFirstDraftEditorDefinition,
  firstDraftBlockDefinitions,
} from "./first-draft-definition.tsx";
import { createFirstDraftViewStateStore } from "./blocks/view-state.tsx";
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

  it("declares wrapper fragment exceptions without making wrappers selection endpoints", () => {
    expect(firstDraftBlockDefinitions.columns.selection?.fragment).toEqual({
      kind: "wrapper",
      inclusion: "multiple-selected-children",
    });
    expect(firstDraftBlockDefinitions.column.selection?.fragment).toEqual({
      kind: "wrapper",
      inclusion: "never",
    });
    expect(firstDraftBlockDefinitions.tabs.selection?.fragment).toEqual({
      kind: "wrapper",
      contentScope: "visible",
      preservedChildren: "all",
    });
    expect(
      firstDraftBlockDefinitions.toggleHeadingBody.selection?.fragment,
    ).toEqual({
      kind: "wrapper",
      inclusion: "never",
    });
    for (const type of [
      "columns",
      "column",
      "tabs",
      "tabPane",
      "toggleHeading",
      "toggleHeadingBody",
      "toggleListItem",
      "toggleListItemBody",
    ] as const) {
      expect(
        firstDraftBlockDefinitions[type].selection?.projection,
      ).toMatchObject({
        category: "wrapper",
        endpoint: { kind: "block" },
        canStartSelection: false,
        selectable: false,
      });
    }
  });

  it("scopes fragment completeness to the active tab and collapsed toggle summary", () => {
    const tabs = "tabs" as BlockId;
    const firstPane = "first-pane" as BlockId;
    const secondPane = "second-pane" as BlockId;
    const toggle = "toggle" as BlockId;
    const summary = "summary" as BlockId;
    const body = "body" as BlockId;
    const viewState = createFirstDraftViewStateStore({
      selectedTabs: { [tabs]: secondPane },
      collapsedBlockIds: [toggle],
    });
    const policy =
      createFirstDraftEditorDefinition(viewState).selectionFragment!;

    expect(
      policy.resolveVisibleChildBlockIds({
        blockId: tabs,
        blockType: "tabs",
        childBlockIds: [firstPane, secondPane],
      }),
    ).toEqual([secondPane]);
    expect(
      policy.resolveVisibleChildBlockIds({
        blockId: toggle,
        blockType: "toggleHeading",
        childBlockIds: [summary, body],
      }),
    ).toEqual([summary]);

    viewState.setBlockCollapsed(toggle, false);
    expect(
      policy.resolveVisibleChildBlockIds({
        blockId: toggle,
        blockType: "toggleHeading",
        childBlockIds: [summary, body],
      }),
    ).toEqual([summary, body]);

    viewState.selectTab(tabs, "missing-pane" as BlockId);
    expect(
      policy.resolveVisibleChildBlockIds({
        blockId: tabs,
        blockType: "tabs",
        childBlockIds: [firstPane, secondPane],
      }),
    ).toEqual([firstPane]);
  });

  it("declares wrapper-owned open-boundary range deletion policies", () => {
    for (const type of ["callout", "quote", "code"] as const) {
      expect(firstDraftBlockDefinitions[type].rangeDeletion).toEqual({
        kind: "unwrap-boundary-contents",
      });
    }
    expect(firstDraftBlockDefinitions.columns.rangeDeletion).toEqual({
      kind: "unwrap-boundary-child",
    });
    expect(firstDraftBlockDefinitions.tabs.rangeDeletion).toEqual({
      kind: "unwrap-visible-boundary-child",
    });
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
