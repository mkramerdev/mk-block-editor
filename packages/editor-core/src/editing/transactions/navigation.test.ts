import { describe, expect, it } from "vitest";
import type { BlockDefinition } from "../../definitions/block-definition.ts";
import type { BlockType, VersionedBlock } from "../../document/model/block.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";
import { asBlockId } from "../../kernel/identity/uuid.ts";
import { findAdjacentValidInsertionPlacement } from "./navigation.ts";

const renderer = () => null;
const definitions: Readonly<Record<BlockType, BlockDefinition>> = {
  textLeaf: { kind: "text", type: "textLeaf", renderer },
  atomLeaf: { kind: "atomic", type: "atomLeaf", renderer },
  flowShell: {
    kind: "wrapper",
    type: "flowShell",
    renderer,
    content: { required: ["block"], additional: "block" },
    contentBoundary: false,
    defaultContent: "textLeaf",
  },
  singleShell: {
    kind: "wrapper",
    type: "singleShell",
    renderer,
    content: { required: ["textLeaf"] },
    contentBoundary: false,
  },
  bodyShell: {
    kind: "wrapper",
    type: "bodyShell",
    renderer,
    content: { required: ["block"], additional: "block" },
    contentBoundary: false,
    defaultContent: "atomLeaf",
  },
  compoundShell: {
    kind: "wrapper",
    type: "compoundShell",
    renderer,
    content: { required: ["textLeaf", "bodyShell"] },
    contentBoundary: false,
  },
  innerShell: {
    kind: "wrapper",
    type: "innerShell",
    renderer,
    content: { required: ["textLeaf"] },
    contentBoundary: false,
  },
  outerShell: {
    kind: "wrapper",
    type: "outerShell",
    renderer,
    content: { required: ["innerShell"] },
    contentBoundary: false,
  },
  boundaryShell: {
    kind: "wrapper",
    type: "boundaryShell",
    renderer,
    content: { required: ["innerShell"] },
    contentBoundary: true,
  },
  boundaryFlow: {
    kind: "wrapper",
    type: "boundaryFlow",
    renderer,
    content: { required: ["block"], additional: "block" },
    contentBoundary: true,
    defaultContent: "textLeaf",
  },
};

describe("adjacent valid insertion navigation", () => {
  it("returns the adjacent boundary in the same repeated wrapper", () => {
    const shell = block(1, "flowShell", "a0");
    const source = block(2, "textLeaf", "a1", shell.id);
    const next = block(3, "atomLeaf", "a2", shell.id);
    const result = navigate([shell, source, next], source.id, "textLeaf");
    expect(result).toMatchObject({
      ok: true,
      placement: {
        parentId: shell.id,
        childIndex: 1,
      },
      remainsInsideDirectParent: true,
      crossedAncestorIds: [],
    });
  });

  it("exits an exact-one wrapper at the immediately adjacent root boundary", () => {
    const shell = block(1, "singleShell", "a0");
    const source = block(2, "textLeaf", "a1", shell.id);
    const after = block(3, "atomLeaf", "a2");
    const result = navigate([shell, source, after], source.id, "textLeaf");
    expect(result).toMatchObject({
      ok: true,
      placement: {
        parentId: null,
        childIndex: 1,
      },
      remainsInsideDirectParent: false,
      crossedAncestorIds: [shell.id],
    });
  });

  it("descends into the immediately following canonical container", () => {
    const shell = block(1, "compoundShell", "a0");
    const source = block(2, "textLeaf", "a1", shell.id);
    const body = block(3, "bodyShell", "a2", shell.id);
    const existing = block(4, "atomLeaf", "a3", body.id);
    const result = navigate(
      [shell, source, body, existing],
      source.id,
      "textLeaf",
    );
    expect(result).toMatchObject({
      ok: true,
      placement: {
        parentId: body.id,
        childIndex: 0,
      },
      remainsInsideDirectParent: true,
    });
  });

  it("descends into canonical content regardless of presentation state", () => {
    const shell = block(1, "compoundShell", "a0");
    const source = block(2, "textLeaf", "a1", shell.id);
    const body = block(3, "bodyShell", "a2", shell.id);
    const existing = block(4, "atomLeaf", "a3", body.id);
    const after = block(5, "atomLeaf", "a4");
    const result = navigate(
      [shell, source, body, existing, after],
      source.id,
      "textLeaf",
    );
    expect(result).toMatchObject({
      ok: true,
      placement: {
        parentId: body.id,
        childIndex: 0,
      },
      crossedAncestorIds: [],
    });
  });

  it("ascends through multiple exact ancestors", () => {
    const outer = block(1, "outerShell", "a0");
    const inner = block(2, "innerShell", "a1", outer.id);
    const source = block(3, "textLeaf", "a2", inner.id);
    const result = navigate([outer, inner, source], source.id, "textLeaf");
    expect(result).toMatchObject({
      ok: true,
      placement: {
        parentId: null,
        childIndex: 1,
      },
      crossedAncestorIds: [inner.id, outer.id],
    });
  });

  it("stops before ascending above a direct content boundary", () => {
    const boundary = block(1, "boundaryShell", "a0");
    const inner = block(2, "innerShell", "a1", boundary.id);
    const source = block(3, "textLeaf", "a2", inner.id);
    const result = navigate([boundary, inner, source], source.id, "textLeaf");
    expect(result).toStrictEqual({
      ok: false,
      reason: "content-boundary",
      boundaryBlockingWrapperId: boundary.id,
      crossedAncestorIds: [inner.id],
    });
  });

  it("returns a valid destination reached inside a content boundary", () => {
    const boundary = block(1, "boundaryFlow", "a0");
    const inner = block(2, "innerShell", "a1", boundary.id);
    const source = block(3, "textLeaf", "a2", inner.id);
    const after = block(4, "atomLeaf", "a3", boundary.id);
    const result = navigate(
      [boundary, inner, source, after],
      source.id,
      "textLeaf",
    );
    expect(result).toMatchObject({
      ok: true,
      placement: {
        parentId: boundary.id,
        childIndex: 1,
      },
      crossedAncestorIds: [inner.id],
    });
  });

  it("keeps canonical container descent available inside a boundary", () => {
    const boundary = block(1, "boundaryFlow", "a0");
    const shell = block(2, "compoundShell", "a1", boundary.id);
    const source = block(3, "textLeaf", "a2", shell.id);
    const body = block(4, "bodyShell", "a3", shell.id);
    const existing = block(5, "atomLeaf", "a4", body.id);
    const result = navigate(
      [boundary, shell, source, body, existing],
      source.id,
      "textLeaf",
    );
    expect(result).toMatchObject({
      ok: true,
      placement: { parentId: body.id, childIndex: 0 },
    });
  });

  it("reports missing sources without treating them as boundary containment", () => {
    expect(navigate([], id(999), "textLeaf")).toStrictEqual({
      ok: false,
      reason: "missing-source",
    });
  });

  it("returns root insertion and a clear failure when no type is registered", () => {
    const source = block(1, "textLeaf", "a0");
    expect(navigate([source], source.id, "atomLeaf")).toMatchObject({
      ok: true,
      placement: {
        parentId: null,
        childIndex: 1,
      },
    });
    expect(navigate([source], source.id, "unknownLeaf")).toStrictEqual({
      ok: false,
      reason: "no-valid-placement",
    });
  });

  it("never skips an unrelated following sibling to enter a later container", () => {
    const shell = block(1, "singleShell", "a0");
    const source = block(2, "textLeaf", "a1", shell.id);
    const unrelated = block(3, "atomLeaf", "a2");
    const later = block(4, "flowShell", "a3");
    const laterChild = block(5, "textLeaf", "a4", later.id);
    const result = navigate(
      [shell, source, unrelated, later, laterChild],
      source.id,
      "textLeaf",
    );
    expect(result).toMatchObject({
      ok: true,
      placement: { parentId: null, childIndex: 1 },
    });
  });

  it("uses the immutable canonical graph deterministically", () => {
    const shell = block(1, "compoundShell", "a0");
    const source = block(2, "textLeaf", "a1", shell.id);
    const body = block(3, "bodyShell", "a2", shell.id);
    const child = block(4, "atomLeaf", "a3", body.id);
    const input = {
      originBlockId: source.id,
      proposedType: "textLeaf",
      ...records([shell, source, body, child]),
      blockDefinitions: definitions,
    };
    expect(findAdjacentValidInsertionPlacement(input)).toStrictEqual(
      findAdjacentValidInsertionPlacement(input),
    );
  });
});

function navigate(
  blocks: readonly VersionedBlock[],
  originBlockId: BlockId,
  proposedType: BlockType,
) {
  return findAdjacentValidInsertionPlacement({
    originBlockId,
    proposedType,
    ...records(blocks),
    blockDefinitions: definitions,
  });
}

function records(blocks: readonly VersionedBlock[]) {
  const records = Object.fromEntries(
    blocks.map((value) => [value.id, value]),
  ) as Record<BlockId, VersionedBlock>;
  const rootBlockIds = blocks
    .filter((value) => value.parentId === null)
    .map((value) => value.id);
  const childIdsByParentId = {} as Partial<Record<BlockId, BlockId[]>>;
  for (const value of blocks) {
    if (value.parentId === null) continue;
    (childIdsByParentId[value.parentId] ??= []).push(value.id);
  }
  return { blocks: records, rootBlockIds, childIdsByParentId };
}

function block(
  number: number,
  type: BlockType,
  sequenceLabel: string,
  parentId: BlockId | null = null,
): VersionedBlock {
  void sequenceLabel;
  return {
    id: id(number),
    type,
    parentId,
    tombstone: null,
    metadataVersion: "1",
    contentVersion: null,
  };
}

function id(number: number): BlockId {
  return asBlockId(
    `01890f07-1c00-7000-8000-${number.toString().padStart(12, "0")}`,
  );
}
