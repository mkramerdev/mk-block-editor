import { afterEach, describe, expect, it, vi } from "vitest";
import {
  textDomPointForOffset,
  textOffsetFromDomPoint,
  textOffsetFromPoint,
  textPointFromPoint,
} from "./text-hit-testing.ts";

describe("canonical DOM text hit-testing offsets", () => {
  afterEach(() => {
    Reflect.deleteProperty(document, "caretPositionFromPoint");
    Reflect.deleteProperty(Range.prototype, "getClientRects");
    vi.restoreAllMocks();
  });
  it.each([
    { label: "ASCII", text: "abc", offsets: [0, 1, 2, 3] },
    { label: "a simple emoji", text: "a🙂b", offsets: [0, 1, 2, 3] },
    {
      label: "a ZWJ emoji sequence",
      text: "a👨‍👩‍👧‍👦b",
      offsets: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    },
    {
      label: "decomposed Unicode text",
      text: "ae\u0301b",
      offsets: [0, 1, 2, 3, 4],
    },
  ])("round-trips canonical offsets through $label", ({ text, offsets }) => {
    const root = document.createElement("div");
    root.textContent = text;
    const textLength = Array.from(text).length;

    for (const canonicalOffset of offsets) {
      const point = textDomPointForOffset(root, canonicalOffset, textLength);
      expect(point).not.toBeNull();
      expect(textOffsetFromDomPoint(root, point!.node, point!.offset)).toBe(
        canonicalOffset,
      );
    }
  });

  it("accounts across text nodes in canonical code points", () => {
    const root = document.createElement("div");
    const first = document.createTextNode("a🙂");
    const marked = document.createElement("strong");
    const second = document.createTextNode("e\u0301👨‍👩‍👧‍👦");
    marked.append(second);
    root.append(first, marked);
    const textLength = Array.from(root.textContent ?? "").length;

    for (let offset = 0; offset <= textLength; offset += 1) {
      const point = textDomPointForOffset(root, offset, textLength);
      expect(point).not.toBeNull();
      expect(textOffsetFromDomPoint(root, point!.node, point!.offset)).toBe(
        offset,
      );
    }
  });

  it("maps immediately before and after a surrogate-pair emoji", () => {
    const root = document.createElement("div");
    const text = document.createTextNode("a🙂b");
    root.append(text);

    expect(textOffsetFromDomPoint(root, text, 1)).toBe(1);
    expect(textOffsetFromDomPoint(root, text, 3)).toBe(2);
    expect(textDomPointForOffset(root, 1, 3)).toEqual({
      node: text,
      offset: 1,
    });
    expect(textDomPointForOffset(root, 2, 3)).toEqual({
      node: text,
      offset: 3,
    });
  });

  it.each([
    { html: "a<br>b", length: 3 },
    { html: "a<br><br>b", length: 4 },
    { html: "a<br><br><br>b", length: 5 },
  ])("round-trips every semantic offset in $html", ({ html, length }) => {
    const root = document.createElement("div");
    root.innerHTML = html;
    for (let offset = 0; offset <= length; offset += 1) {
      const point = textDomPointForOffset(root, offset, length);
      expect(point).not.toBeNull();
      expect(textOffsetFromDomPoint(root, point!.node, point!.offset)).toBe(
        offset,
      );
    }
  });

  it.each([1, 2, 3])(
    "preserves the exact pointer offset after %s preceding hard breaks",
    (breakCount) => {
      const root = document.createElement("div");
      root.innerHTML = `a${"<br>".repeat(breakCount)}b`;
      const caretRange = document.createRange();
      caretRange.setStart(root, breakCount + 1);
      caretRange.collapse(true);
      Object.defineProperty(document, "caretRangeFromPoint", {
        configurable: true,
        value: () => caretRange,
      });

      expect(textOffsetFromPoint(root, 10, 10, breakCount + 2)).toBe(
        breakCount + 1,
      );

      Reflect.deleteProperty(document, "caretRangeFromPoint");
    },
  );

  it("keeps the mounted projection root as the hit-test coordinate authority", () => {
    const root = document.createElement("div");
    root.innerHTML = '<p data-block-node="true">hello world</p>';
    const caretRange = document.createRange();
    caretRange.setStart(root, 0);
    caretRange.collapse(true);
    Object.defineProperty(document, "caretRangeFromPoint", {
      configurable: true,
      value: () => caretRange,
    });

    expect(textOffsetFromPoint(root, 10, 10, 11)).toBe(0);

    Reflect.deleteProperty(document, "caretRangeFromPoint");
  });

  it("maps ancestor child boundaries independently before and after hard breaks", () => {
    const root = document.createElement("div");
    root.innerHTML = "<span>a</span><br><strong>b</strong>";
    expect(textOffsetFromDomPoint(root, root, 1)).toBe(1);
    expect(textOffsetFromDomPoint(root, root, 2)).toBe(2);
  });

  it("ignores nested marks while preserving code-point and hard-break units", () => {
    const root = document.createElement("div");
    root.innerHTML =
      "<strong>a<em>\ud83d\ude42</em></strong><br>\u200d\u200d\u200d";
    const length = 6;
    for (let offset = 0; offset <= length; offset += 1) {
      const point = textDomPointForOffset(root, offset, length);
      expect(point).not.toBeNull();
      expect(textOffsetFromDomPoint(root, point!.node, point!.offset)).toBe(
        offset,
      );
    }
  });

  it("counts an inline atom once regardless of its rendered label", () => {
    const root = document.createElement("div");
    root.innerHTML =
      'a<span data-editor-inline-atom="true">many rendered characters</span>b';
    for (let offset = 0; offset <= 3; offset += 1) {
      const point = textDomPointForOffset(root, offset, 3);
      expect(point).not.toBeNull();
      expect(textOffsetFromDomPoint(root, point!.node, point!.offset)).toBe(
        offset,
      );
    }
  });

  it("counts a terminal hard break but not its trailing layout sentinel", () => {
    const root = document.createElement("div");
    root.innerHTML =
      'a<br><br class="ProseMirror-trailingBreak" data-editor-canonical-trailing-break="true">';
    expect(textDomPointForOffset(root, 2, 2)).toEqual(
      textDomPointForOffset(root, 3, 2),
    );
    expect(textOffsetFromDomPoint(root, root, 2)).toBe(2);
    expect(textOffsetFromDomPoint(root, root, 3)).toBe(2);
  });

  it("preserves soft-wrap affinity when native caret APIs return one shared boundary", () => {
    const root = document.createElement("div");
    const text = document.createTextNode("abcdef");
    root.append(text);
    mockWrappedUnitRects();
    Object.defineProperty(document, "caretPositionFromPoint", {
      configurable: true,
      value: () => ({ offsetNode: text, offset: 3 }),
    });

    expect(textPointFromPoint(root, 190, 209, 6)).toEqual({
      offset: 3,
      affinity: "backward",
    });
    expect(textPointFromPoint(root, 101, 229, 6)).toEqual({
      offset: 3,
      affinity: "forward",
    });

    Reflect.deleteProperty(document, "caretPositionFromPoint");
    vi.restoreAllMocks();
  });

  it("uses semantic affinity when native caret APIs miss the mounted root", () => {
    const root = document.createElement("div");
    root.textContent = "abcdef";
    const outside = document.createTextNode("outside");
    mockWrappedUnitRects();
    Object.defineProperty(document, "caretPositionFromPoint", {
      configurable: true,
      value: () => ({ offsetNode: outside, offset: 0 }),
    });

    expect(textPointFromPoint(root, 190, 209, 6)).toEqual({
      offset: 3,
      affinity: "backward",
    });

    Reflect.deleteProperty(document, "caretPositionFromPoint");
    vi.restoreAllMocks();
  });
});

function mockWrappedUnitRects(): void {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: vi.fn(function (this: Range) {
      const offset = this.startOffset;
      const row = offset < 3 ? 0 : 1;
      const column = offset % 3;
      return [
        rectangle(100 + column * 10, 200 + row * 20, 10, 18),
      ] as unknown as DOMRectList;
    }),
  });
}

function rectangle(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}
