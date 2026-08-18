import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectSemanticVisualRows,
  createSemanticDomTextLayout,
  semanticDomCanonicalOffsetForPoint,
  semanticDomOffsetCanCarrySoftWrapAffinity,
  type SemanticDomRect,
} from "./semantic-dom-coordinates.ts";

describe("semantic DOM coordinates", () => {
  beforeEach(() => {
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: vi.fn(() => []),
    });
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: vi.fn(() => domRect(0, 0, 0, 0)),
    });
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("represents both affinities at a single-node soft wrap and moves to the row-start offset", () => {
    const root = textRoot("abcdef");
    const geometry = mockCanonicalUnitRects(
      root,
      new Map([
        [0, [domRect(100, 200, 10, 18)]],
        [1, [domRect(110, 200, 10, 18)]],
        [2, [domRect(120, 200, 4, 18), domRect(124, 200, 6, 18)]],
        [3, [domRect(100, 220, 4, 18), domRect(104, 220, 6, 18)]],
        [4, [domRect(110, 220, 10, 18)]],
        [5, [domRect(120, 220, 10, 18)]],
      ]),
    );
    const layout = createSemanticDomTextLayout(root);

    expect(layout.hitTest(190, 209)).toEqual({
      offset: 3,
      affinity: "backward",
    });
    expect(layout.hitTest(101, 229)).toEqual({
      offset: 3,
      affinity: "forward",
    });
    expect(layout.caretRect(3, "backward")).toEqual(caret(130, 200));
    expect(layout.caretRect(3, "forward")).toEqual(caret(100, 220));
    expect(semanticDomOffsetCanCarrySoftWrapAffinity(root, 3)).toBe(true);
    expect(layout.visualRowBoundary(3, "start", "backward")).toBe(0);
    expect(layout.visualRowBoundary(3, "start", "forward")).toBe(3);
    expect(layout.moveVertically(0, "down", null, "forward")).toEqual({
      kind: "moved",
      offset: 3,
      preferredX: 100,
    });
    expect(layout.moveVertically(3, "up", null, "forward")).toEqual({
      kind: "moved",
      offset: 0,
      preferredX: 100,
    });
    expect(layout.mapToVisualRow("first", 100)).toEqual({
      kind: "mapped",
      offset: 0,
    });
    expect(layout.mapToVisualRow("last", 100)).toEqual({
      kind: "mapped",
      offset: 3,
    });
    expect(geometry.collapsedReads()).toBe(0);
  });

  it("retains affinity points only when their visual positions differ", () => {
    const dual = collectSemanticVisualRows(0, (_offset, affinity) =>
      affinity === "backward" ? semanticRect(130, 200) : semanticRect(100, 220),
    );
    expect(dual).toHaveLength(2);
    expect(dual.flatMap((row) => row.points)).toEqual([
      expect.objectContaining({ offset: 0, affinity: "backward" }),
      expect.objectContaining({ offset: 0, affinity: "forward" }),
    ]);

    const shared = collectSemanticVisualRows(0, () => semanticRect(100, 200));
    expect(shared).toHaveLength(1);
    expect(shared[0]!.points).toHaveLength(1);
  });

  it("distinguishes both sides of an interior soft-wrap boundary", () => {
    const root = textRoot("abcdefghi");
    mockCanonicalUnitRects(
      root,
      new Map(
        Array.from({ length: 9 }, (_, offset) => [
          offset,
          [
            domRect(
              100 + (offset % 3) * 10,
              200 + Math.floor(offset / 3) * 20,
              10,
              18,
            ),
          ],
        ]),
      ),
    );
    const layout = createSemanticDomTextLayout(root);

    expect(layout.hitTest(190, 229)).toEqual({
      offset: 6,
      affinity: "backward",
    });
    expect(layout.hitTest(101, 249)).toEqual({
      offset: 6,
      affinity: "forward",
    });
    expect(layout.caretRect(6, "backward")).toEqual(caret(130, 220));
    expect(layout.caretRect(6, "forward")).toEqual(caret(100, 240));
  });

  it("handles text start, text end, and empty text without collapsed unit ambiguity", () => {
    const root = textRoot("ab");
    const geometry = mockCanonicalUnitRects(
      root,
      new Map([
        [0, [domRect(100, 200, 10, 18)]],
        [1, [domRect(110, 200, 10, 18)]],
      ]),
    );
    const layout = createSemanticDomTextLayout(root);
    for (const affinity of ["backward", "forward"] as const) {
      expect(layout.caretRect(0, affinity)).toEqual(caret(100, 200));
      expect(layout.caretRect(2, affinity)).toEqual(caret(120, 200));
    }
    expect(geometry.collapsedReads()).toBe(0);

    const empty = textRoot("");
    vi.spyOn(empty, "getBoundingClientRect").mockReturnValue(
      domRect(50, 70, 80, 18),
    );
    expect(createSemanticDomTextLayout(empty).caretRect(0, "forward")).toEqual(
      caret(50, 70),
    );
  });

  it("places hard breaks and consecutive hard breaks on explicit following rows", () => {
    const root = textRoot("a<br><br>b");
    root.style.lineHeight = "20px";
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue(
      domRect(100, 200, 200, 60),
    );
    mockCanonicalUnitRects(
      root,
      new Map([
        [0, [domRect(100, 200, 10, 18)]],
        [3, [domRect(100, 240, 10, 18)]],
      ]),
    );
    const layout = createSemanticDomTextLayout(root);

    expect(layout.caretRect(1, "forward")).toEqual(caret(110, 200));
    expect(layout.caretRect(2, "forward")).toEqual(caret(100, 220));
    expect(layout.caretRect(2, "backward")).toEqual(caret(100, 220));
    expect(layout.caretRect(3, "forward")).toEqual(caret(100, 240));
    expect(layout.caretRect(3, "backward")).toEqual(caret(100, 240));
    expect(semanticDomOffsetCanCarrySoftWrapAffinity(root, 1)).toBe(false);
    expect(semanticDomOffsetCanCarrySoftWrapAffinity(root, 2)).toBe(false);
    expect(semanticDomOffsetCanCarrySoftWrapAffinity(root, 3)).toBe(false);
  });

  it("uses a collapsed fallback only after a terminal hard break lacks an adjacent unit", () => {
    const root = textRoot("a<br>");
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue(
      domRect(100, 200, 200, 40),
    );
    const geometry = mockCanonicalUnitRects(
      root,
      new Map([[0, [domRect(100, 200, 10, 18)]]]),
      domRect(100, 220, 0, 18),
    );

    expect(createSemanticDomTextLayout(root).caretRect(2, "forward")).toEqual(
      caret(100, 220),
    );
    expect(geometry.collapsedReads()).toBe(1);
  });

  it("measures inline atoms from their noncollapsed unit edges", () => {
    const root = textRoot(
      'a<span data-editor-inline-atom="true"><span>label</span></span>b',
    );
    const geometry = mockCanonicalUnitRects(
      root,
      new Map([
        [0, [domRect(100, 200, 10, 18)]],
        [1, [domRect(110, 200, 20, 18)]],
        [2, [domRect(130, 200, 10, 18)]],
      ]),
    );
    const layout = createSemanticDomTextLayout(root);

    expect(layout.length).toBe(3);
    expect(layout.caretRect(1, "forward")).toEqual(caret(110, 200));
    expect(layout.caretRect(2, "backward")).toEqual(caret(130, 200));
    expect(geometry.collapsedReads()).toBe(0);
  });

  it("preserves soft-wrap affinity across semantic DOM segment boundaries", () => {
    const root = textRoot("<span>abc</span><strong>def</strong>");
    mockCanonicalUnitRects(root, wrappedUnitRects());
    const layout = createSemanticDomTextLayout(root);

    expect(layout.caretRect(3, "backward")).toEqual(caret(130, 200));
    expect(layout.caretRect(3, "forward")).toEqual(caret(100, 220));
    expect(layout.moveVertically(0, "down", null)).toEqual({
      kind: "moved",
      offset: 3,
      preferredX: 100,
    });
  });

  it("keeps active and inactive projection structures geometrically equivalent", () => {
    const active = textRoot("<p><span>abc</span><strong>def</strong></p>");
    mockCanonicalUnitRects(active, wrappedUnitRects());
    const activeLayout = createSemanticDomTextLayout(active);
    const activeResult = {
      backward: activeLayout.caretRect(3, "backward"),
      forward: activeLayout.caretRect(3, "forward"),
      movement: activeLayout.moveVertically(0, "down", null),
    };

    const inactive = textRoot("<span>ab</span><span>c</span><span>def</span>");
    mockCanonicalUnitRects(inactive, wrappedUnitRects());
    const inactiveLayout = createSemanticDomTextLayout(inactive);
    expect({
      backward: inactiveLayout.caretRect(3, "backward"),
      forward: inactiveLayout.caretRect(3, "forward"),
      movement: inactiveLayout.moveVertically(0, "down", null),
    }).toEqual(activeResult);
  });

  it("uses logical RTL edges and rejects unsupported vertical writing", () => {
    const rtl = textRoot("ab");
    rtl.style.direction = "rtl";
    mockCanonicalUnitRects(
      rtl,
      new Map([
        [0, [domRect(120, 200, 10, 18)]],
        [1, [domRect(100, 200, 10, 18)]],
      ]),
    );
    const rtlLayout = createSemanticDomTextLayout(rtl);
    expect(rtlLayout.caretRect(1, "forward")).toEqual(caret(110, 200));
    expect(rtlLayout.caretRect(1, "backward")).toEqual(caret(120, 200));

    const vertical = textRoot("ab");
    vertical.style.writingMode = "vertical-rl";
    mockCanonicalUnitRects(
      vertical,
      new Map([
        [0, [domRect(100, 200, 18, 10)]],
        [1, [domRect(100, 210, 18, 10)]],
      ]),
    );
    expect(
      createSemanticDomTextLayout(vertical).caretRect(1, "forward"),
    ).toBeNull();
  });
});

function wrappedUnitRects(): ReadonlyMap<number, readonly DOMRect[]> {
  return new Map([
    [0, [domRect(100, 200, 10, 18)]],
    [1, [domRect(110, 200, 10, 18)]],
    [2, [domRect(120, 200, 10, 18)]],
    [3, [domRect(100, 220, 10, 18)]],
    [4, [domRect(110, 220, 10, 18)]],
    [5, [domRect(120, 220, 10, 18)]],
  ]);
}

function mockCanonicalUnitRects(
  root: HTMLElement,
  units: ReadonlyMap<number, readonly DOMRect[]>,
  collapsedRect?: DOMRect,
): { readonly collapsedReads: () => number } {
  let collapsedReads = 0;
  vi.mocked(Range.prototype.getClientRects).mockImplementation(function (
    this: Range,
  ) {
    const from = semanticDomCanonicalOffsetForPoint(
      root,
      this.startContainer,
      this.startOffset,
    );
    const to = semanticDomCanonicalOffsetForPoint(
      root,
      this.endContainer,
      this.endOffset,
      "backward",
    );
    if (from === null || to === null) return [] as unknown as DOMRectList;
    if (this.collapsed) {
      collapsedReads += 1;
      return (collapsedRect
        ? [collapsedRect]
        : [domRect(900, 900, 0, 18)]) as unknown as DOMRectList;
    }
    return (to === from + 1
      ? (units.get(from) ?? [])
      : []) as unknown as DOMRectList;
  });
  return { collapsedReads: () => collapsedReads };
}

function textRoot(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  root.style.direction = "ltr";
  document.body.appendChild(root);
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(
    domRect(100, 200, 200, 40),
  );
  return root;
}

function semanticRect(left: number, top: number): SemanticDomRect {
  return { left, top, width: 1, height: 18 };
}

function caret(left: number, top: number): SemanticDomRect {
  return { left, top, width: 1, height: 18 };
}

function domRect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}
