import { describe, expect, it } from "vitest";
import type { BlockId } from "../../kernel/identity/ids.ts";
import type { BlockType } from "../../document/model/block.ts";
import type { EditorLogicalContentOperation } from "../language/logical-operations.ts";
import { operationAnchorRequirement } from "./operation-replay.ts";

const blockId = "00000000-0000-4000-8000-000000000001" as BlockId;
const blockType = "textBlock" as BlockType;
const base = { blockId, blockType, target: { kind: "text" as const } };

describe("operation anchor policy", () => {
  it("uses left association for insertion positions, including zero and end offsets", () => {
    for (const offset of [0, 7]) {
      expect(
        operationAnchorRequirement({
          ...base,
          kind: "insertInlineContent",
          position: { blockId, offset },
          content: [{ type: "text", text: "x" }],
        }),
      ).toEqual({ kind: "position", offset, association: -1 });
    }
  });

  it.each([
    "deleteInlineRange",
    "replaceInlineRange",
    "setInlineEntity",
    "addInlineMark",
    "removeInlineMark",
  ] as const)("uses outside-edge associations for %s", (kind) => {
    const range = {
      from: { blockId, offset: 2 },
      to: { blockId, offset: 2 },
    };
    const operation = {
      ...base,
      kind,
      range,
      ...(kind === "replaceInlineRange"
        ? { content: [{ type: "text", text: "x" }] }
        : kind === "setInlineEntity"
          ? { entity: { type: "emoji", attrs: {} } }
          : kind === "addInlineMark" || kind === "removeInlineMark"
            ? { markName: "bold" }
            : {}),
    } as unknown as EditorLogicalContentOperation;
    expect(operationAnchorRequirement(operation)).toEqual({
      kind: "range",
      startOffset: 2,
      startAssociation: 1,
      endOffset: 2,
      endAssociation: -1,
    });
  });
});
