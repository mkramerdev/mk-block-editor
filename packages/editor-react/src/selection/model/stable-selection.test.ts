import { asBlockId, type JsonValue } from "@repo/editor-core/kernel";
import { describe, expect, it } from "vitest";
import { editorStableSelectionsEqual } from "./stable-selection.ts";
import type {
  EditorSelectionDirection,
  EditorStableSelection,
  StableDocumentSelectionPoint,
} from "./types.ts";

const blockA = asBlockId("block-a");
const blockB = asBlockId("block-b");

describe("editorStableSelectionsEqual", () => {
  it("compares none only with none", () => {
    expect(
      editorStableSelectionsEqual({ kind: "none" }, { kind: "none" }),
    ).toBe(true);
    expect(
      editorStableSelectionsEqual(
        { kind: "none" },
        documentSelection(blockPoint(blockA), blockPoint(blockA)),
      ),
    ).toBe(false);
  });

  it("compares every document selection field across separate objects", () => {
    const left = documentSelection(textPoint(blockA), blockPoint(blockB));
    const equal = documentSelection(textPoint(blockA), blockPoint(blockB));
    expect(editorStableSelectionsEqual(left, equal)).toBe(true);
    expect(
      editorStableSelectionsEqual(
        left,
        documentSelection(textPoint(blockA), blockPoint(blockB), "backward"),
      ),
    ).toBe(false);
    expect(
      editorStableSelectionsEqual(
        left,
        documentSelection(textPoint(blockB), blockPoint(blockB)),
      ),
    ).toBe(false);
    expect(
      editorStableSelectionsEqual(
        left,
        documentSelection(textPoint(blockA), blockPoint(blockA)),
      ),
    ).toBe(false);
  });

  it("compares complete text point offsets, affinities, and anchors", () => {
    const base = documentSelection(textPoint(blockA), textPoint(blockB));
    expect(
      editorStableSelectionsEqual(
        base,
        documentSelection(
          textPoint(blockA, { textOffset: 4 }),
          textPoint(blockB),
        ),
      ),
    ).toBe(false);
    expect(
      editorStableSelectionsEqual(
        base,
        documentSelection(
          textPoint(blockA, { affinity: "backward" }),
          textPoint(blockB),
        ),
      ),
    ).toBe(false);
    expect(
      editorStableSelectionsEqual(
        base,
        documentSelection(
          textPoint(blockA, {
            textAnchor: textAnchor({ encoded: "different", assoc: 1 }),
          }),
          textPoint(blockB),
        ),
      ),
    ).toBe(false);
  });

  it("uses JSON semantics for nested block-internal payload objects", () => {
    const left = blockInternalSelection(blockA, "table", {
      outer: { first: 1, second: { value: true, label: "cell" } },
      rows: [1, 2],
    });
    const reordered = blockInternalSelection(blockA, "table", {
      rows: [1, 2],
      outer: { second: { label: "cell", value: true }, first: 1 },
    });
    expect(editorStableSelectionsEqual(left, reordered)).toBe(true);
    expect(
      editorStableSelectionsEqual(
        left,
        blockInternalSelection(blockA, "table", {
          outer: { first: 1, second: { value: true, label: "cell" } },
          rows: [2, 1],
        }),
      ),
    ).toBe(false);
  });

  it("compares block-internal ownership and payload values", () => {
    const base = blockInternalSelection(blockA, "table", { value: 1 });
    expect(
      editorStableSelectionsEqual(
        base,
        blockInternalSelection(blockB, "table", { value: 1 }),
      ),
    ).toBe(false);
    expect(
      editorStableSelectionsEqual(
        base,
        blockInternalSelection(blockA, "diagram", { value: 1 }),
      ),
    ).toBe(false);
    expect(
      editorStableSelectionsEqual(
        base,
        blockInternalSelection(blockA, "table", { value: 2 }),
      ),
    ).toBe(false);
  });
});

function documentSelection(
  anchor: StableDocumentSelectionPoint,
  focus: StableDocumentSelectionPoint,
  direction: EditorSelectionDirection = "forward",
): EditorStableSelection {
  return {
    kind: "selection",
    selection: { kind: "document", direction, anchor, focus },
  };
}

function blockPoint(blockId: typeof blockA): StableDocumentSelectionPoint {
  return { kind: "block", blockId, surface: "block" };
}

function textPoint(
  blockId: typeof blockA,
  overrides: Partial<
    Extract<StableDocumentSelectionPoint, { readonly kind: "text" }>
  > = {},
): StableDocumentSelectionPoint {
  return {
    kind: "text",
    blockId,
    textOffset: 3,
    textAnchor: textAnchor({ encoded: "anchor", assoc: 1 }),
    affinity: "forward",
    ...overrides,
  };
}

function textAnchor(payload: { readonly encoded: string; readonly assoc: 1 }) {
  return {
    kind: "block-relative-text" as const,
    codec: "test",
    version: 1 as const,
    payload,
  };
}

function blockInternalSelection(
  blockId: typeof blockA,
  subsystem: string,
  payload: JsonValue,
): EditorStableSelection {
  return {
    kind: "selection",
    selection: { kind: "block-internal", blockId, subsystem, payload },
  };
}
