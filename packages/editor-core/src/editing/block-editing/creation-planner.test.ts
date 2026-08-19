import { describe, expect, it } from "vitest";
import type { BlockId } from "../../kernel/identity/ids.ts";
import type { BlockDefinition } from "../../definitions/block-definition.ts";
import type { BlockType } from "../../document/model/block.ts";
import {
  wholeSelection,
  wrapperSelection,
} from "../../selection/block-selection.ts";
import { planBlockTreeCreation } from "./creation-planner.ts";

const renderer = () => null;

describe("canonical block-tree creation planner", () => {
  it.each([
    ["quote", ["quote", "paragraph"]],
    ["checklistItem", ["checklistItem", "paragraph"]],
    ["callout", ["callout", "paragraph"]],
    [
      "toggleHeading",
      ["toggleHeading", "heading", "toggleHeadingBody", "placeholder"],
    ],
    [
      "toggleListItem",
      ["toggleListItem", "paragraph", "toggleListItemBody", "placeholder"],
    ],
    ["columns", ["columns", "column", "paragraph"]],
    ["tabs", ["tabs", "tabPane", "placeholder"]],
    ["placeholder", ["placeholder"]],
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
          node.type === "paragraph" ||
          node.type === "heading" ||
          node.type === "placeholder",
      )?.id ?? null,
    );
  });

  it("applies requested metadata only to the requested root", () => {
    const plan = planBlockTreeCreation({
      blockDefinitions: createTestBlockDefinitions(),
      type: "checklistItem",
      metadata: { checked: true },
      createBlockId: idSequence(),
    });
    expect(plan.nodes[0]?.metadata).toStrictEqual({ checked: true });
    expect(plan.nodes[1]).not.toHaveProperty("metadata");
  });

  it("materializes definition metadata defaults and lets explicit metadata replace them", () => {
    const implicit = planBlockTreeCreation({
      blockDefinitions: createTestBlockDefinitions(),
      type: "column",
      createBlockId: idSequence(),
    });
    expect(implicit.nodes[0]?.metadata).toStrictEqual({
      layoutWeight: 1_000_000,
    });

    const explicit = planBlockTreeCreation({
      blockDefinitions: createTestBlockDefinitions(),
      type: "column",
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
      type: "columns",
      defaultContentCount: 5,
      createBlockId: idSequence(),
    });
    const columns = plan.nodes.filter((node) => node.type === "column");
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
    expect(plan.nodes.filter((node) => node.type === "paragraph")).toHaveLength(
      5,
    );
  });

  it("rejects invalid or definition-incompatible default content counts", () => {
    for (const defaultContentCount of [-1, 0, 1.5]) {
      expect(() =>
        planBlockTreeCreation({
          blockDefinitions: createTestBlockDefinitions(),
          type: "columns",
          defaultContentCount,
          createBlockId: idSequence(),
        }),
      ).toThrow();
    }
    expect(() =>
      planBlockTreeCreation({
        blockDefinitions: createTestBlockDefinitions(),
        type: "quote",
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
        type: "quote",
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
        type: "quote",
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
        rootLayout: "normal" as const,
        renderer,
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
        rootLayout: "normal" as const,
        renderer,
        selection: wholeSelection(),
        content: { required: ["paragraph"] },
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
      plan.nodes.find(({ type }) => type === "paragraph")?.id,
    );
  });

  it("keeps a wrapper without a selectable block endpoint untargeted", () => {
    const definitions = {
      ...createTestBlockDefinitions(),
      passiveWrapper: {
        kind: "wrapper" as const,
        type: "passiveWrapper",
        rootLayout: "normal" as const,
        renderer,
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
    paragraph: {
      kind: "text",
      rootLayout: "normal",
      type: "paragraph",
      renderer,
    },
    heading: { kind: "text", rootLayout: "normal", type: "heading", renderer },
    placeholder: {
      kind: "atomic",
      rootLayout: "normal",
      type: "placeholder",
      renderer,
    },
    quote: {
      kind: "wrapper",
      rootLayout: "normal",
      type: "quote",
      renderer,
      content: { required: ["paragraph"] },
      contentBoundary: false,
    },
    checklistItem: {
      kind: "wrapper",
      rootLayout: "normal",
      type: "checklistItem",
      renderer,
      content: { required: ["paragraph"] },
      contentBoundary: false,
    },
    callout: {
      kind: "wrapper",
      rootLayout: "normal",
      type: "callout",
      renderer,
      content: { required: ["block"], additional: "block" },
      contentBoundary: false,
      defaultContent: "paragraph",
    },
    toggleHeading: {
      kind: "wrapper",
      rootLayout: "normal",
      type: "toggleHeading",
      renderer,
      content: { required: ["heading", "toggleHeadingBody"] },
      contentBoundary: false,
    },
    toggleHeadingBody: {
      kind: "wrapper",
      rootLayout: "normal",
      type: "toggleHeadingBody",
      renderer,
      content: { required: ["block"], additional: "block" },
      contentBoundary: false,
      defaultContent: "placeholder",
    },
    toggleListItem: {
      kind: "wrapper",
      rootLayout: "normal",
      type: "toggleListItem",
      renderer,
      content: { required: ["paragraph", "toggleListItemBody"] },
      contentBoundary: false,
    },
    toggleListItemBody: {
      kind: "wrapper",
      rootLayout: "normal",
      type: "toggleListItemBody",
      renderer,
      content: { required: ["block"], additional: "block" },
      contentBoundary: false,
      defaultContent: "placeholder",
    },
    columns: {
      kind: "wrapper",
      rootLayout: "normal",
      type: "columns",
      renderer,
      content: { required: ["column"], additional: "column" },
      contentBoundary: false,
      defaultContent: "column",
    },
    column: {
      kind: "wrapper",
      rootLayout: "normal",
      type: "column",
      renderer,
      content: { required: ["block"], additional: "block" },
      contentBoundary: true,
      defaultContent: "paragraph",
      defaultMetadata: { layoutWeight: 1_000_000 },
    },
    tabs: {
      kind: "wrapper",
      rootLayout: "normal",
      type: "tabs",
      renderer,
      content: { required: ["tabPane"], additional: "tabPane" },
      contentBoundary: false,
      defaultContent: "tabPane",
    },
    tabPane: {
      kind: "wrapper",
      rootLayout: "normal",
      type: "tabPane",
      renderer,
      content: { required: ["block"], additional: "block" },
      contentBoundary: false,
      defaultContent: "placeholder",
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
