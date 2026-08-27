import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import { createSemanticDomTextLayout } from "../geometry/semantic-dom-coordinates.ts";
import { projectNativeCaret } from "./native-caret-projection.ts";

vi.mock("../geometry/semantic-dom-coordinates", () => ({
  createSemanticDomTextLayout: vi.fn(),
}));

describe("native caret projection", () => {
  let root: HTMLElement;
  let text: Text;
  let modify: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    root = document.createElement("div");
    root.contentEditable = "true";
    text = document.createTextNode("abcdef");
    root.append(text);
    document.body.append(root);
    root.focus();
    vi.mocked(createSemanticDomTextLayout).mockReturnValue({
      length: 6,
      canonicalRangeForNode: vi.fn(),
      pointFromCanonicalOffset: (offset) => ({ node: text, offset }),
      canonicalOffsetFromPoint: (_node, offset) => offset,
      hitTest: vi.fn(),
      caretRect: (_offset, affinity) =>
        affinity === "backward"
          ? { left: 60, top: 10, width: 1, height: 20 }
          : { left: 0, top: 30, width: 1, height: 20 },
      rangeRects: vi.fn(),
      visualRowBoundary: vi.fn(),
      moveVertically: vi.fn(),
      mapToVisualRow: vi.fn(),
    });
    modify = vi.fn((_alter, direction) => {
      const selection = document.getSelection();
      selection?.setBaseAndExtent(text, 2, text, 2);
      expect(direction === "forward" || direction === "backward").toBe(true);
    });
    Object.defineProperty(Selection.prototype, "modify", {
      configurable: true,
      value: modify,
    });
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it.each([
    ["backward", 1, "forward"],
    ["forward", 3, "backward"],
  ] as const)(
    "retains %s wrap affinity through native selection without mutating DOM",
    (affinity, startingOffset, direction) => {
      const children = [...root.childNodes];
      const html = root.innerHTML;
      const setBaseAndExtent = vi.spyOn(
        document.getSelection()!,
        "setBaseAndExtent",
      );

      const result = projectNativeCaret({
        root,
        blockId: "block" as BlockId,
        canonicalSelectionRevision: 4,
        canonicalTextOffset: 2,
        affinity,
        activationIdentity: Symbol("activation"),
        focusMode: "adopt",
      });

      expect(result).toEqual({
        status: "projected",
        nativePoint: { node: text, offset: 2 },
      });
      expect(setBaseAndExtent).toHaveBeenNthCalledWith(
        1,
        text,
        startingOffset,
        text,
        startingOffset,
      );
      expect(modify).toHaveBeenCalledOnce();
      expect(modify).toHaveBeenCalledWith("move", direction, "lineboundary");
      expect(root.innerHTML).toBe(html);
      expect([...root.childNodes]).toEqual(children);
      expect(root.querySelector("[contenteditable='false']")).toBeNull();
    },
  );

  it("collapses directly when the canonical point has only one visual side", () => {
    const layout = createSemanticDomTextLayout(root);
    vi.mocked(createSemanticDomTextLayout).mockReturnValue({
      ...layout,
      caretRect: () => ({ left: 20, top: 10, width: 1, height: 20 }),
    });

    expect(
      projectNativeCaret({
        root,
        blockId: "block" as BlockId,
        canonicalSelectionRevision: 4,
        canonicalTextOffset: 2,
        affinity: null,
        activationIdentity: Symbol("activation"),
        focusMode: "acquire",
      }).status,
    ).toBe("projected");
    expect(modify).not.toHaveBeenCalled();
    expect(document.getSelection()?.anchorOffset).toBe(2);
  });

  it("restores the exact canonical point when a line-boundary affinity probe overshoots", () => {
    modify.mockImplementation(() => {
      document.getSelection()?.setBaseAndExtent(text, 5, text, 5);
    });

    expect(
      projectNativeCaret({
        root,
        blockId: "block" as BlockId,
        canonicalSelectionRevision: 4,
        canonicalTextOffset: 2,
        affinity: "backward",
        activationIdentity: Symbol("activation"),
        focusMode: "adopt",
      }),
    ).toEqual({
      status: "projected",
      nativePoint: { node: text, offset: 2 },
    });
    expect(document.getSelection()?.anchorNode).toBe(text);
    expect(document.getSelection()?.anchorOffset).toBe(2);
  });
});
