import { describe, expect, it } from "vitest";
import { asBlockId } from "@repo/editor-core/kernel";
import type { EditorLogicalContentOperation } from "@repo/editor-core/operations";
import { cloneAndFreezeHistoryEntry } from "./history.ts";

const blockId = asBlockId("01890f07-1c00-7000-8000-000000000701");

describe("history replay ownership", () => {
  it("owns exactly one state-valid replay plan and deeply freezes anchor payloads", () => {
    const semanticForward: EditorLogicalContentOperation = {
      kind: "insertInlineContent",
      blockId,
      blockType: "paragraph",
      target: { kind: "text" },
      position: { blockId, offset: 0 },
      content: [{ type: "text", text: "x" }],
    };
    const semanticInverse: EditorLogicalContentOperation = {
      kind: "deleteInlineRange",
      blockId,
      blockType: "paragraph",
      target: { kind: "text" },
      range: {
        from: { blockId, offset: 0 },
        to: { blockId, offset: 1 },
      },
      deletedContent: [{ type: "text", text: "x" }],
    };
    const mutablePayload = { encoded: "opaque", nested: { value: 1 } };
    const frozen = cloneAndFreezeHistoryEntry({
      semanticForward,
      semanticInverse,
      selectionBefore: { kind: "none" },
      selectionAfter: { kind: "none" },
      state: "applied",
      nextUndo: {
        steps: [
          {
            kind: "content",
            blockId,
            blockType: "paragraph",
            operation: semanticInverse,
            anchors: {
              kind: "range",
              start: {
                codec: "test",
                payload: mutablePayload,
                association: 1,
              },
              end: {
                codec: "test",
                payload: { encoded: "opaque-end" },
                association: -1,
              },
            },
          },
        ],
      },
    });

    mutablePayload.nested.value = 9;
    expect(frozen.state).toBe("applied");
    expect(frozen).not.toHaveProperty("nextRedo");
    if (frozen.state !== "applied") throw new Error("expected applied entry");
    const step = frozen.nextUndo.steps[0]!;
    if (step.kind !== "content" || step.anchors.kind !== "range") {
      throw new Error("expected anchored range");
    }
    if (!("codec" in step.anchors.start)) {
      throw new Error("expected opaque operation anchor");
    }
    expect(step.anchors.start.payload).toEqual({
      encoded: "opaque",
      nested: { value: 1 },
    });
    expect(Object.isFrozen(frozen.nextUndo.steps)).toBe(true);
    expect(Object.isFrozen(step.anchors.start.payload)).toBe(true);
    expect(
      Object.isFrozen(
        (step.anchors.start.payload as { nested: object }).nested,
      ),
    ).toBe(true);
  });
});
