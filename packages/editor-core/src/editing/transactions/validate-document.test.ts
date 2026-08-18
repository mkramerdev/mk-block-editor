import { describe, expect, it } from "vitest";
import type {
  BlockType,
  OrderedBlockGraph,
  VersionedBlock,
} from "../../document/model/block.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";
import { asBlockId } from "../../kernel/identity/uuid.ts";
import { createVersionedBlockRecord } from "../../metadata/block-record.ts";
import { testBlockDefinitions } from "../../testing/test-block-definitions.ts";
import { createBlockRichTextContentFromPlainText } from "../../content/rich-text/rich-inline-content.ts";
import { validateStructuralDocument } from "./validate-document.ts";
import type { BlockDefinition } from "../../definitions/block-definition.ts";

const id = (suffix: number): BlockId =>
  asBlockId(`01890f07-1c00-7000-8000-${String(suffix).padStart(12, "0")}`);
const block = (
  blockId: BlockId,
  type: BlockType,
  parentId: BlockId | null = null,
): VersionedBlock =>
  createVersionedBlockRecord({
    id: blockId,
    type,
    parentId,
    version: { metadataVersion: "1", contentVersion: null },
  });
const validate = (graph: OrderedBlockGraph<VersionedBlock>) =>
  validateStructuralDocument({
    ...graph,
    blockDefinitions: testBlockDefinitions,
  });

describe("ordered structural document validation", () => {
  it("rejects a document without a live root", () => {
    const result = validate({
      blocks: {},
      rootBlockIds: [],
      childIdsByParentId: {},
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.map((issue) => issue.kind)).toContain(
        "missing-root",
      );
    }
  });

  it("accepts a coherent ordered tree", () => {
    const wrapper = block(id(1), "callout");
    const first = block(id(2), "paragraph", wrapper.id);
    const second = block(id(3), "divider", wrapper.id);
    expect(
      validate({
        blocks: {
          [wrapper.id]: wrapper,
          [first.id]: first,
          [second.id]: second,
        },
        rootBlockIds: [wrapper.id],
        childIdsByParentId: { [wrapper.id]: [first.id, second.id] },
      }),
    ).toEqual({ valid: true, issues: [] });
  });

  it("rejects children under leaf blocks", () => {
    const parent = block(id(1), "paragraph");
    const child = block(id(2), "paragraph", parent.id);
    const result = validate({
      blocks: { [parent.id]: parent, [child.id]: child },
      rootBlockIds: [parent.id],
      childIdsByParentId: { [parent.id]: [child.id] },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.map((issue) => issue.kind)).toContain(
        "invalid-child-sequence",
      );
    }
  });

  it("rejects a constrained item at root and beneath a mismatched container", () => {
    const definitions: Readonly<Record<BlockType, BlockDefinition>> = {
      paragraph: {
        kind: "text",
        type: "paragraph",
        rootLayout: "normal",
        split: { default: "paragraph" },
      },
      item: {
        kind: "wrapper",
        type: "item",
        rootLayout: "normal",
        content: { required: ["paragraph"] },
        contentBoundary: false,
        parents: { allowed: ["list"] },
      },
      list: {
        kind: "wrapper",
        type: "list",
        rootLayout: "normal",
        content: { required: ["item"], additional: "item" },
        contentBoundary: false,
      },
      otherList: {
        kind: "wrapper",
        type: "otherList",
        rootLayout: "normal",
        content: { required: ["block"], additional: "block" },
        defaultContent: "paragraph",
        contentBoundary: false,
      },
    };
    const item = block(id(20), "item");
    const paragraph = block(id(21), "paragraph", item.id);
    const rootResult = validateStructuralDocument({
      blocks: { [item.id]: item, [paragraph.id]: paragraph },
      rootBlockIds: [item.id],
      childIdsByParentId: { [item.id]: [paragraph.id] },
      blockDefinitions: definitions,
    });
    expect(rootResult.valid).toBe(false);
    if (!rootResult.valid)
      expect(rootResult.issues.map((issue) => issue.kind)).toContain(
        "invalid-parent",
      );

    const otherList = block(id(22), "otherList");
    const nestedItem = { ...item, parentId: otherList.id };
    const mismatch = validateStructuralDocument({
      blocks: {
        [otherList.id]: otherList,
        [nestedItem.id]: nestedItem,
        [paragraph.id]: paragraph,
      },
      rootBlockIds: [otherList.id],
      childIdsByParentId: {
        [otherList.id]: [nestedItem.id],
        [nestedItem.id]: [paragraph.id],
      },
      blockDefinitions: definitions,
    });
    expect(mismatch.valid).toBe(false);
    if (!mismatch.valid)
      expect(mismatch.issues.map((issue) => issue.kind)).toContain(
        "invalid-parent",
      );
  });

  it("rejects forbidden parent and child type combinations", () => {
    const quote = block(id(1), "quote");
    const divider = block(id(2), "divider", quote.id);
    const result = validate({
      blocks: { [quote.id]: quote, [divider.id]: divider },
      rootBlockIds: [quote.id],
      childIdsByParentId: { [quote.id]: [divider.id] },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.map((issue) => issue.kind)).toContain(
        "invalid-child-sequence",
      );
    }
  });

  it("rejects a hydrated restorative-default wrapper with mixed children", () => {
    const body = block(id(1), "toggleHeadingBody");
    const placeholder = block(id(2), "placeholder", body.id);
    const paragraph = block(id(3), "paragraph", body.id);
    const result = validateStructuralDocument({
      blocks: {
        [body.id]: body,
        [placeholder.id]: placeholder,
        [paragraph.id]: paragraph,
      },
      rootBlockIds: [body.id],
      childIdsByParentId: { [body.id]: [placeholder.id, paragraph.id] },
      blockDefinitions: {
        ...testBlockDefinitions,
        placeholder: {
          ...testBlockDefinitions.placeholder!,
          replaceWith: "paragraph",
        },
      },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          kind: "invalid-child-sequence",
          blockId: body.id,
          actualChildTypes: ["placeholder", "paragraph"],
        }),
      );
    }
  });

  it("rejects unknown containment references", () => {
    const root = block(id(1), "paragraph");
    const result = validate({
      blocks: { [root.id]: root },
      rootBlockIds: [id(2)],
      childIdsByParentId: {},
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues[0]?.kind).toBe("unknown-containment");
    }
  });

  it("rejects parent disagreement", () => {
    const parent = block(id(1), "callout");
    const child = block(id(2), "paragraph");
    const result = validate({
      blocks: { [parent.id]: parent, [child.id]: child },
      rootBlockIds: [parent.id],
      childIdsByParentId: { [parent.id]: [child.id] },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues[0]?.kind).toBe("parent-disagreement");
    }
  });

  it("rejects unreachable live blocks", () => {
    const root = block(id(1), "paragraph");
    const detached = block(id(2), "paragraph");
    const result = validate({
      blocks: { [root.id]: root, [detached.id]: detached },
      rootBlockIds: [root.id],
      childIdsByParentId: {},
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues[0]?.kind).toBe("unreachable-block");
    }
  });

  it("rejects tombstones in live containment", () => {
    const root = {
      ...block(id(1), "paragraph"),
      tombstone: { deletedAt: 1, reason: "user-delete" as const },
    };
    const result = validate({
      blocks: { [root.id]: root },
      rootBlockIds: [root.id],
      childIdsByParentId: {},
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues[0]?.kind).toBe("tombstone-in-containment");
    }
  });

  it("rejects unsupported persistence fields", () => {
    const root = {
      ...block(id(1), "paragraph"),
      persistentRank: "a0",
    } as VersionedBlock;
    const result = validate({
      blocks: { [root.id]: root },
      rootBlockIds: [root.id],
      childIdsByParentId: {},
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.map((issue) => issue.kind)).toContain(
        "unsupported-block-field",
      );
    }
  });

  it("reads each text content value once during complete final validation", () => {
    const roots = Array.from({ length: 100 }, (_, index) =>
      block(id(index + 1), "paragraph"),
    );
    const readCounts = new Map<BlockId, number>();
    const result = validateStructuralDocument({
      blocks: Object.fromEntries(roots.map((entry) => [entry.id, entry])),
      rootBlockIds: roots.map((entry) => entry.id),
      childIdsByParentId: {},
      blockDefinitions: testBlockDefinitions,
      readContent: (blockId, blockType) => {
        readCounts.set(blockId, (readCounts.get(blockId) ?? 0) + 1);
        return {
          content: createBlockRichTextContentFromPlainText(blockType, "text"),
          plainText: "text",
          version: "1",
        };
      },
      validateContent: () => true,
      focus: { kind: "text-offset", blockId: roots[0]!.id, offset: 2 },
    });

    expect(result).toEqual({ valid: true, issues: [] });
    expect(readCounts.size).toBe(roots.length);
    expect([...readCounts.values()]).toEqual(
      Array.from({ length: roots.length }, () => 1),
    );
  });

  it("validates final selection offsets against staged text content", () => {
    const root = block(id(1), "paragraph");
    const content = createBlockRichTextContentFromPlainText("paragraph", "abc");
    const result = validateStructuralDocument({
      blocks: { [root.id]: root },
      rootBlockIds: [root.id],
      childIdsByParentId: {},
      blockDefinitions: testBlockDefinitions,
      readContent: () => ({
        content,
        plainText: "abc",
        version: "1",
      }),
      selection: {
        anchor: { blockId: root.id, offset: 0 },
        focus: { blockId: root.id, offset: 4 },
      },
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.map((issue) => issue.kind)).toContain(
        "invalid-selection",
      );
    }
  });
});
