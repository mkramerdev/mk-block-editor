import { describe, expect, it } from "vitest";
import type { BlockId } from "../../kernel/identity/ids.ts";
import type { BlockDefinition } from "../../definitions/block-definition.ts";
import type { BlockType } from "../../document/model/block.ts";
import {
  wholeSelection,
  wrapperSelection,
} from "../../selection/block-selection.ts";
import { planBlockTreeCreation } from "./creation-planner.ts";

describe("canonical block-tree creation planner", () => {
  it.each([
    ["wrapperBlock", ["wrapperBlock", "textBlock"]],
    ["fixedWrapper", ["fixedWrapper", "textBlock"]],
    ["containerWrapper", ["containerWrapper", "textBlock"]],
    [
      "expandableTitleWrapper",
      ["expandableTitleWrapper", "alternateTextBlock", "childWrapper", "defaultAtomicBlock"],
    ],
    [
      "expandableItemWrapper",
      ["expandableItemWrapper", "textBlock", "alternateChildWrapper", "defaultAtomicBlock"],
    ],
    ["parallelWrapper", ["parallelWrapper", "laneWrapper", "textBlock"]],
    ["switchWrapper", ["switchWrapper", "branchWrapper", "defaultAtomicBlock"]],
    ["defaultAtomicBlock", ["defaultAtomicBlock"]],
  ])("creates the complete %s subtree", (type, expectedTypes) => {
    const ids = idSequence();
    const plan = planBlockTreeCreation({
      blockDefinitions: createTestBlockDefinitions(),
      type,
      selection: true,
      createBlockId: ids,
    });
    expect(plan.nodes.map((node) => node.type)).toStrictEqual(expectedTypes);
    expect(plan.nodes[0]?.parentId).toBeNull();
    for (const node of plan.nodes.slice(1)) {
      const parent = plan.nodes.find(
        (candidate) => candidate.id === node.parentId,
      );
      expect(parent, `${node.type} parent`).toBeTruthy();
    }
    expect(new Set(plan.nodes.map((node) => node.id)).size).toBe(
      plan.nodes.length,
    );
    expect(plan.selectionBlockId).toBe(
      plan.nodes.find(
        (node) =>
          node.type === "textBlock" ||
          node.type === "alternateTextBlock" ||
          node.type === "defaultAtomicBlock",
      )?.id ?? null,
    );
  });

  it("applies requested metadata only to the requested root", () => {
    const plan = planBlockTreeCreation({
      blockDefinitions: createTestBlockDefinitions(),
      type: "fixedWrapper",
      metadata: { checked: true },
      createBlockId: idSequence(),
    });
    expect(plan.nodes[0]?.metadata).toStrictEqual({ checked: true });
    expect(plan.nodes[1]).not.toHaveProperty("metadata");
  });

  it("materializes definition metadata defaults and lets explicit metadata replace them", () => {
    const implicit = planBlockTreeCreation({
      blockDefinitions: createTestBlockDefinitions(),
      type: "laneWrapper",
      createBlockId: idSequence(),
    });
    expect(implicit.nodes[0]?.metadata).toStrictEqual({
      layoutWeight: 1_000_000,
    });

    const explicit = planBlockTreeCreation({
      blockDefinitions: createTestBlockDefinitions(),
      type: "laneWrapper",
      metadata: { layoutWeight: 250_000, unrelated: true },
      createBlockId: idSequence(),
    });
    expect(explicit.nodes[0]?.metadata).toStrictEqual({
      layoutWeight: 250_000,
      unrelated: true,
    });
  });

  it("repeats only definition-owned default content to an exact requested count", () => {
    const plan = planBlockTreeCreation({
      blockDefinitions: createTestBlockDefinitions(),
      type: "parallelWrapper",
      defaultContentCount: 5,
      createBlockId: idSequence(),
    });
    const columns = plan.nodes.filter((node) => node.type === "laneWrapper");
    expect(columns).toHaveLength(5);
    expect(
      columns.map((column) => ({
        parentId: column.parentId,
        metadata: column.metadata,
      })),
    ).toStrictEqual(
      Array.from({ length: 5 }, () => ({
        parentId: plan.rootBlockId,
        metadata: { layoutWeight: 1_000_000 },
      })),
    );
    expect(plan.nodes.filter((node) => node.type === "textBlock")).toHaveLength(
      5,
    );
  });

  it("rejects invalid or definition-incompatible default content counts", () => {
    for (const defaultContentCount of [-1, 0, 1.5]) {
      expect(() =>
        planBlockTreeCreation({
          blockDefinitions: createTestBlockDefinitions(),
          type: "parallelWrapper",
          defaultContentCount,
          createBlockId: idSequence(),
        }),
      ).toThrow();
    }
    expect(() =>
      planBlockTreeCreation({
        blockDefinitions: createTestBlockDefinitions(),
        type: "wrapperBlock",
        defaultContentCount: 2,
        createBlockId: idSequence(),
      }),
    ).toThrow("does not declare defaultContent");
  });

  it("allocates every id before application and rejects reserved collisions", () => {
    const collision = id(1);
    expect(() =>
      planBlockTreeCreation({
        blockDefinitions: createTestBlockDefinitions(),
        type: "wrapperBlock",
        createBlockId: () => collision,
        reservedBlockIds: new Set([collision]),
      }),
    ).toThrow("unable to allocate unique ids");
  });

  it("checks existing ids directly without copying the document blockDefinitions", () => {
    const collision = id(1);
    const next = idSequence();
    expect(() =>
      planBlockTreeCreation({
        blockDefinitions: createTestBlockDefinitions(),
        type: "wrapperBlock",
        createBlockId: next,
        isBlockIdReserved: (blockId) => blockId === collision,
      }),
    ).not.toThrow();
  });

  it("selects an explicitly selectable empty wrapper", () => {
    const definitions = {
      ...createTestBlockDefinitions(),
      selectableWrapper: {
        kind: "wrapper" as const,
        type: "selectableWrapper",
        selection: wholeSelection(),
        content: { required: [] },
        contentBoundary: false,
      },
    };
    const plan = planBlockTreeCreation({
      blockDefinitions: definitions,
      type: "selectableWrapper",
      selection: true,
      createBlockId: idSequence(),
    });

    expect(plan.nodes).toHaveLength(1);
    expect(plan.selectionBlockId).toBe(plan.rootBlockId);
  });

  it("keeps an eligible text descendant ahead of its selectable wrapper", () => {
    const definitions = {
      ...createTestBlockDefinitions(),
      selectableWrapper: {
        kind: "wrapper" as const,
        type: "selectableWrapper",
        selection: wholeSelection(),
        content: { required: ["textBlock"] },
        contentBoundary: false,
      },
    };
    const plan = planBlockTreeCreation({
      blockDefinitions: definitions,
      type: "selectableWrapper",
      selection: true,
      createBlockId: idSequence(),
    });

    expect(plan.nodes[0]?.type).toBe("selectableWrapper");
    expect(plan.selectionBlockId).toBe(
      plan.nodes.find(({ type }) => type === "textBlock")?.id,
    );
  });

  it("keeps a wrapper without a selectable block endpoint untargeted", () => {
    const definitions = {
      ...createTestBlockDefinitions(),
      passiveWrapper: {
        kind: "wrapper" as const,
        type: "passiveWrapper",
        selection: wrapperSelection(),
        content: { required: [] },
        contentBoundary: false,
      },
    };
    const plan = planBlockTreeCreation({
      blockDefinitions: definitions,
      type: "passiveWrapper",
      selection: true,
      createBlockId: idSequence(),
    });

    expect(plan.selectionBlockId).toBeNull();
  });
});

function createTestBlockDefinitions(): Readonly<
  Record<BlockType, BlockDefinition>
> {
  return {
    textBlock: {
      kind: "text",
      type: "textBlock",
    },
    alternateTextBlock: { kind: "text", type: "alternateTextBlock" },
    defaultAtomicBlock: {
      kind: "atomic",
      type: "defaultAtomicBlock",
    },
    wrapperBlock: {
      kind: "wrapper",
      type: "wrapperBlock",
      content: { required: ["textBlock"] },
      contentBoundary: false,
    },
    fixedWrapper: {
      kind: "wrapper",
      type: "fixedWrapper",
      content: { required: ["textBlock"] },
      contentBoundary: false,
    },
    containerWrapper: {
      kind: "wrapper",
      type: "containerWrapper",
      content: { required: ["block"], additional: "block" },
      contentBoundary: false,
      defaultContent: "textBlock",
    },
    expandableTitleWrapper: {
      kind: "wrapper",
      type: "expandableTitleWrapper",
      content: { required: ["alternateTextBlock", "childWrapper"] },
      contentBoundary: false,
    },
    childWrapper: {
      kind: "wrapper",
      type: "childWrapper",
      content: { required: ["block"], additional: "block" },
      contentBoundary: false,
      defaultContent: "defaultAtomicBlock",
    },
    expandableItemWrapper: {
      kind: "wrapper",
      type: "expandableItemWrapper",
      content: { required: ["textBlock", "alternateChildWrapper"] },
      contentBoundary: false,
    },
    alternateChildWrapper: {
      kind: "wrapper",
      type: "alternateChildWrapper",
      content: { required: ["block"], additional: "block" },
      contentBoundary: false,
      defaultContent: "defaultAtomicBlock",
    },
    parallelWrapper: {
      kind: "wrapper",
      type: "parallelWrapper",
      content: { required: ["laneWrapper"], additional: "laneWrapper" },
      contentBoundary: false,
      defaultContent: "laneWrapper",
    },
    laneWrapper: {
      kind: "wrapper",
      type: "laneWrapper",
      content: { required: ["block"], additional: "block" },
      contentBoundary: true,
      defaultContent: "textBlock",
      defaultMetadata: { layoutWeight: 1_000_000 },
    },
    switchWrapper: {
      kind: "wrapper",
      type: "switchWrapper",
      content: { required: ["branchWrapper"], additional: "branchWrapper" },
      contentBoundary: false,
      defaultContent: "branchWrapper",
    },
    branchWrapper: {
      kind: "wrapper",
      type: "branchWrapper",
      content: { required: ["block"], additional: "block" },
      contentBoundary: false,
      defaultContent: "defaultAtomicBlock",
    },
  };
}

function idSequence(): () => BlockId {
  let next = 1;
  return () => id(next++);
}

function id(value: number): BlockId {
  return `01890f07-1c00-7000-8000-${String(value).padStart(12, "0")}` as BlockId;
}
