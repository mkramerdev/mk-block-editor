import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import { editorSelectionBoundsDataAttributes } from "../selection/bounds/selection-bounds.ts";
import {
  createEditorDocumentGeometryOwner as createUntrackedGeometryOwner,
  type EditorDocumentGeometryOwner,
} from "./editor-document-geometry.ts";

const blockId = "geometry-block" as BlockId;
const secondBlockId = "geometry-block-2" as BlockId;

describe("editor document geometry owner", () => {
  let rangeRects: DOMRect[];
  let owners: EditorDocumentGeometryOwner[];

  beforeEach(() => {
    owners = [];
    rangeRects = [rect(130, 240, 1, 18)];
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: vi.fn(() => rangeRects),
    });
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: vi.fn(() => rangeRects[0] ?? rect(0, 0, 0, 0)),
    });
  });

  afterEach(() => {
    for (const owner of owners) owner.dispose();
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function createEditorDocumentGeometryOwner(): EditorDocumentGeometryOwner {
    const owner = createUntrackedGeometryOwner();
    owners.push(owner);
    return owner;
  }

  it("projects shell and declared selection bounds into document coordinates", () => {
    const owner = createEditorDocumentGeometryOwner();
    const host = connectedElement("div");
    const shell = connectedElement("div", host);
    const surface = connectedElement("div", shell);
    const target = connectedElement("div", surface);
    Object.assign(shell.dataset, {
      editorBlockShell: "true",
      editorBlockId: blockId,
    });
    applyAttributes(shell, editorSelectionBoundsDataAttributes(blockId));
    applyAttributes(
      target,
      editorSelectionBoundsDataAttributes(blockId, { target: "content" }),
    );
    mockRect(host, rect(100, 200, 500, 400));
    mockRect(shell, rect(125, 235, 300, 40));
    mockRect(surface, rect(128, 238, 290, 35));
    mockRect(target, rect(140, 250, 80, 20));
    Object.defineProperty(host, "clientLeft", { configurable: true, value: 2 });
    Object.defineProperty(host, "clientTop", { configurable: true, value: 3 });
    host.scrollLeft = 7;
    host.scrollTop = 11;

    owner.registration.attachDocumentHost(host);
    owner.registration.blockDomRegistrar.registerBlockShell(blockId, shell);

    expect(owner.reader.readBlockShellRect(blockId)).toEqual({
      left: 30,
      top: 43,
      width: 300,
      height: 40,
    });
    expect(owner.reader.readBlockSelectionRect(blockId, "content")).toEqual({
      left: 45,
      top: 58,
      width: 80,
      height: 20,
    });
    expect(
      owner.reader.readViewportBlockSelectionRect(blockId, "content"),
    ).toEqual({ left: 140, top: 250, width: 80, height: 20 });
    expect(owner.reader.readBlockSelectionRect(blockId, "missing")).toBeNull();
  });

  it("measures zero, final, marked, hard-break, atom, and empty caret offsets", () => {
    const cases: Array<{
      html: string;
      length: number;
      offsets: readonly number[];
      expectedLefts: readonly number[];
    }> = [
      {
        html: "<strong>marked</strong>",
        length: 6,
        offsets: [0, 6],
        expectedLefts: [30, 31],
      },
      {
        html: "a<br>b",
        length: 3,
        offsets: [1, 2, 3],
        expectedLefts: [31, 30, 31],
      },
      {
        html: 'a<span data-editor-inline-atom="true"><span>Rendered label</span></span>b',
        length: 3,
        offsets: [1, 2, 3],
        expectedLefts: [30, 30, 31],
      },
    ];
    for (const [index, testCase] of cases.entries()) {
      const owner = createEditorDocumentGeometryOwner();
      const mounted = mountTextGeometry(
        owner,
        `${blockId}-${index}` as BlockId,
        testCase.html,
      );
      expect(
        owner.reader.readTextCanonicalLength(`${blockId}-${index}` as BlockId),
      ).toBe(testCase.length);
      for (const [offsetIndex, offset] of testCase.offsets.entries()) {
        expect(
          owner.reader.readTextCaretRect(
            `${blockId}-${index}` as BlockId,
            offset,
          ),
        ).toEqual({
          left: testCase.expectedLefts[offsetIndex],
          top: 40,
          width: 1,
          height: 18,
        });
      }
      mounted.host.remove();
      owner.dispose();
    }

    const emptyOwner = createEditorDocumentGeometryOwner();
    const { textRoot } = mountTextGeometry(emptyOwner, blockId, "");
    mockRect(textRoot, rect(120, 230, 100, 20));
    rangeRects = [];
    expect(emptyOwner.reader.readTextCanonicalLength(blockId)).toBe(0);
    expect(emptyOwner.reader.readTextCaretRect(blockId, 0)).toEqual({
      left: 20,
      top: 30,
      width: 1,
      height: 20,
    });
    textRoot.innerHTML =
      '<p><br class="ProseMirror-trailingBreak" data-editor-read-trailing-break="true"></p>';
    expect(emptyOwner.reader.readTextCanonicalLength(blockId)).toBe(0);
  });

  it("uses canonical Unicode code-point offsets across combining characters", () => {
    const owner = createEditorDocumentGeometryOwner();
    mountTextGeometry(owner, blockId, "A😀e\u0301Z");

    expect(owner.reader.readTextCanonicalLength(blockId)).toBe(5);
    for (const offset of [0, 1, 2, 3, 4, 5]) {
      expect(owner.reader.readTextCaretRect(blockId, offset)).not.toBeNull();
    }
  });

  it("uses the registered text root without scanning the block shell", () => {
    const owner = createEditorDocumentGeometryOwner();
    const { shell } = mountTextGeometry(owner, blockId, "cached");
    const query = vi.spyOn(shell, "querySelectorAll");

    expect(owner.reader.readTextCanonicalLength(blockId)).toBe(6);
    expect(owner.reader.readTextCanonicalLength(blockId)).toBe(6);

    expect(query).not.toHaveBeenCalled();
  });

  it("returns every text range client rectangle in DOM order", () => {
    const owner = createEditorDocumentGeometryOwner();
    const { host } = mountTextGeometry(owner, blockId, "multi line");
    rangeRects = [
      rect(120, 220, 40, 16),
      rect(110, 240, 60, 16),
      rect(110, 260, 15, 16),
    ];

    const hostRect = vi.spyOn(host, "getBoundingClientRect");
    const measured = owner.reader.readTextRangeRects(blockId, {
      from: 0,
      to: 10,
    });
    expect(measured).toEqual([
      { left: 20, top: 20, width: 40, height: 16 },
      { left: 10, top: 40, width: 60, height: 16 },
      { left: 10, top: 60, width: 15, height: 16 },
    ]);
    expect(hostRect).toHaveBeenCalledTimes(1);
    (measured as { left: number }[])[0]!.left = 999;
    expect(
      owner.reader.readTextRangeRects(blockId, { from: 0, to: 10 })[0]?.left,
    ).toBe(20);
    expect(hostRect).toHaveBeenCalledTimes(2);
  });

  it("synthesizes visible geometry when a selected hard break has no browser rectangles", () => {
    const owner = createEditorDocumentGeometryOwner();
    const { textRoot } = mountTextGeometry(owner, blockId, "a<br>b");
    textRoot.style.lineHeight = "18px";
    mockTextUnitRangeRects(rect(110, 210, 8, 18));

    expect(
      owner.reader.readTextRangeRects(blockId, { from: 1, to: 2 }),
    ).toEqual([{ left: 18, top: 10, width: 1, height: 18 }]);
  });

  it("widens a zero-width browser hard-break rectangle", () => {
    const owner = createEditorDocumentGeometryOwner();
    mountTextGeometry(owner, blockId, "a<br>b");
    vi.mocked(Range.prototype.getClientRects).mockImplementation(
      () => [rect(118, 210, 0, 18)] as unknown as DOMRectList,
    );

    expect(
      owner.reader.readTextRangeRects(blockId, { from: 1, to: 2 }),
    ).toEqual([{ left: 18, top: 10, width: 1, height: 18 }]);
  });

  it("paints consecutive hard breaks on distinct measured line-height rows", () => {
    const owner = createEditorDocumentGeometryOwner();
    const { textRoot } = mountTextGeometry(owner, blockId, "a<br><br>b");
    textRoot.style.lineHeight = "18px";
    mockTextUnitRangeRects(rect(110, 210, 8, 18));

    expect(
      owner.reader.readTextRangeRects(blockId, { from: 1, to: 3 }),
    ).toEqual([
      { left: 18, top: 10, width: 1, height: 18 },
      { left: 10, top: 28, width: 1, height: 18 },
    ]);
  });

  it("paints a trailing semantic break but not its layout sentinel", () => {
    const owner = createEditorDocumentGeometryOwner();
    const { textRoot } = mountTextGeometry(
      owner,
      blockId,
      'a<br><br class="ProseMirror-trailingBreak" data-editor-read-trailing-break="true">',
    );
    textRoot.style.lineHeight = "18px";
    mockTextUnitRangeRects(rect(110, 210, 8, 18));

    expect(owner.reader.readTextCanonicalLength(blockId)).toBe(2);
    expect(
      owner.reader.readTextRangeRects(blockId, { from: 1, to: 2 }),
    ).toEqual([{ left: 18, top: 10, width: 1, height: 18 }]);
  });

  it("distinguishes vertical movement, visual boundaries, mappings, and unavailable roots", () => {
    const owner = createEditorDocumentGeometryOwner();
    mountTextGeometry(owner, blockId, "abcde");
    vi.mocked(Range.prototype.getClientRects).mockImplementation(function (
      this: Range,
    ) {
      const offset = this.startOffset;
      return [
        rect(100 + offset * 10, offset < 3 ? 200 : 220, 1, 18),
      ] as unknown as DOMRectList;
    });

    expect(owner.reader.moveTextVertically(blockId, 1, "down", null)).toEqual({
      kind: "moved",
      offset: 3,
      preferredX: 110,
    });
    expect(owner.reader.moveTextVertically(blockId, 1, "up", null)).toEqual({
      kind: "boundary",
      preferredX: 110,
    });
    expect(owner.reader.mapTextToVisualRow(blockId, "last", 141)).toEqual({
      kind: "mapped",
      offset: 5,
    });
    expect(
      owner.reader.moveTextVertically(secondBlockId, 0, "down", null),
    ).toEqual({ kind: "unavailable", reason: "text-root-unmounted" });
    expect(owner.reader.mapTextToVisualRow(secondBlockId, "first", 20)).toEqual(
      { kind: "unavailable", reason: "text-root-unmounted" },
    );
  });

  it("reads current text-node boundaries after a synchronous projection change", () => {
    const owner = createEditorDocumentGeometryOwner();
    const { textRoot } = mountTextGeometry(
      owner,
      blockId,
      "<span>aa</span><span>bb</span>",
    );
    mockTextUnitRangeRects(rect(110, 210, 8, 18));

    expect(owner.reader.readTextCaretRect(blockId, 1)).not.toBeNull();
    const first = textRoot.querySelector("span")?.firstChild;
    const second = textRoot.querySelectorAll("span")[1]?.firstChild;
    if (!first || !second) throw new Error("missing text-node fixture");
    first.textContent = "a";
    second.textContent = "bbb";

    expect(() => owner.reader.readTextCaretRect(blockId, 1)).not.toThrow();
    expect(owner.reader.readTextCaretRect(blockId, 1)).not.toBeNull();
  });

  it("follows the current mounted text projection and rejects an unmounted one", () => {
    const owner = createEditorDocumentGeometryOwner();
    const first = mountTextGeometry(owner, blockId, "abcdef");
    vi.mocked(Range.prototype.getClientRects).mockImplementation(function (
      this: Range,
    ) {
      return [
        rect(100 + this.startOffset * 8, 200, 1, 18),
      ] as unknown as DOMRectList;
    });
    expect(owner.reader.mapTextToVisualRow(blockId, "first", 108)).toEqual({
      kind: "mapped",
      offset: 1,
    });

    const replacement = connectedElement("div", first.surface);
    replacement.dataset.editorTextRoot = "true";
    replacement.textContent = "uvwxyz";
    owner.registration.registerMountedTextRoot(blockId, replacement);
    expect(owner.reader.mapTextToVisualRow(blockId, "first", 108)).toEqual({
      kind: "mapped",
      offset: 1,
    });
    replacement.remove();
    expect(owner.reader.mapTextToVisualRow(blockId, "first", 110)).toEqual({
      kind: "unavailable",
      reason: "text-root-unmounted",
    });
  });

  it("updates a text root within its existing shell without replacing its registration", () => {
    const owner = createEditorDocumentGeometryOwner();
    const first = mountTextGeometry(owner, blockId, "first");
    const replacement = connectedElement("div", first.surface);
    replacement.dataset.editorTextRoot = "true";
    replacement.textContent = "replacement";

    expect(owner.registration.updateMountedTextRoot(blockId, replacement)).toBe(
      true,
    );
    expect(owner.reader.readTextCanonicalLength(blockId)).toBe(11);

    const foreignShell = connectedElement("div", first.surface.parentElement!);
    foreignShell.dataset.editorBlockShell = "true";
    foreignShell.dataset.editorBlockId = secondBlockId;
    const foreignRoot = connectedElement("div", foreignShell);
    foreignRoot.dataset.editorTextRoot = "true";
    expect(owner.registration.updateMountedTextRoot(blockId, foreignRoot)).toBe(
      false,
    );
    expect(owner.reader.readTextCanonicalLength(blockId)).toBe(11);
  });

  it("rejects invalid offsets, ranges, unknown blocks, and unmounted blocks", () => {
    const owner = createEditorDocumentGeometryOwner();
    const { surface } = mountTextGeometry(owner, blockId, "abc");

    for (const offset of [-1, 1.5, 4, Number.NaN]) {
      expect(owner.reader.readTextCaretRect(blockId, offset)).toBeNull();
    }
    for (const range of [
      { from: -1, to: 1 },
      { from: 2, to: 1 },
      { from: 0.5, to: 1 },
      { from: 0, to: 4 },
    ]) {
      expect(owner.reader.readTextRangeRects(blockId, range)).toEqual([]);
    }
    expect(
      owner.reader.readTextRangeRects(blockId, { from: 1, to: 1 }),
    ).toEqual([]);
    expect(owner.reader.readBlockShellRect(secondBlockId)).toBeNull();
    expect(owner.reader.readTextCaretRect(secondBlockId, 0)).toBeNull();

    surface.remove();
    expect(owner.reader.readTextCaretRect(blockId, 0)).toBeNull();
    expect(
      owner.reader.readTextRangeRects(blockId, { from: 0, to: 1 }),
    ).toEqual([]);
  });

  it("rejects concurrent hosts and supports sequential detach and reattach", () => {
    const owner = createEditorDocumentGeometryOwner();
    const firstHost = connectedElement("div");
    const secondHost = connectedElement("div");
    const firstSurface = connectedElement("div", firstHost);
    const secondSurface = connectedElement("div", secondHost);
    const firstTextRoot = connectedElement("div", firstSurface);
    const secondTextRoot = connectedElement("div", secondSurface);
    Object.assign(firstSurface.dataset, {
      editorBlockShell: "true",
      editorBlockId: blockId,
    });
    Object.assign(secondSurface.dataset, {
      editorBlockShell: "true",
      editorBlockId: blockId,
    });
    applyAttributes(firstSurface, editorSelectionBoundsDataAttributes(blockId));
    applyAttributes(
      secondSurface,
      editorSelectionBoundsDataAttributes(blockId),
    );
    firstTextRoot.dataset.editorTextRoot = "true";
    secondTextRoot.dataset.editorTextRoot = "true";
    firstTextRoot.textContent = "first";
    secondTextRoot.textContent = "second";
    mockRect(firstHost, rect(10, 20, 100, 100));
    mockRect(secondHost, rect(200, 300, 100, 100));
    mockRect(secondSurface, rect(220, 330, 50, 20));

    const releaseFirstHost = owner.registration.attachDocumentHost(firstHost);
    owner.registration.blockDomRegistrar.registerBlockShell(
      blockId,
      firstSurface,
    );
    expect(() => owner.registration.attachDocumentHost(secondHost)).toThrow(
      /second document host/u,
    );
    releaseFirstHost();
    const releaseSecondHost = owner.registration.attachDocumentHost(secondHost);
    owner.registration.blockDomRegistrar.registerBlockShell(
      blockId,
      secondSurface,
    );
    owner.registration.registerMountedTextRoot(blockId, secondTextRoot);
    releaseFirstHost();
    expect(owner.reader.readBlockSelectionRect(blockId)).toEqual({
      left: 20,
      top: 30,
      width: 50,
      height: 20,
    });

    expect(owner.reader.readTextCanonicalLength(blockId)).toBe(6);

    releaseSecondHost();
    expect(owner.reader.readBlockSelectionRect(blockId)).toBeNull();
  });

  it("never reads registered elements outside its owning document host", () => {
    const owner = createEditorDocumentGeometryOwner();
    const host = connectedElement("div");
    const foreignHost = connectedElement("div");
    const foreignShell = connectedElement("div", foreignHost);
    const foreignSurface = connectedElement("div", foreignShell);
    const foreignTextRoot = connectedElement("div", foreignSurface);
    Object.assign(foreignShell.dataset, {
      editorBlockShell: "true",
      editorBlockId: secondBlockId,
    });
    foreignTextRoot.dataset.editorTextRoot = "true";
    foreignTextRoot.textContent = "foreign";
    mockRect(host, rect(10, 20, 100, 100));
    mockRect(foreignShell, rect(30, 40, 50, 20));
    owner.registration.attachDocumentHost(host);
    owner.registration.blockDomRegistrar.registerBlockShell(
      blockId,
      foreignShell,
    );
    owner.registration.registerMountedTextRoot(blockId, foreignTextRoot);

    expect(owner.reader.readBlockShellRect(blockId)).toBeNull();
    expect(owner.reader.readTextCanonicalLength(blockId)).toBeNull();
    expect(owner.reader.readTextCaretRect(blockId, 0)).toBeNull();
  });

  it("requires a mounted host and rejects invalid browser rectangles", () => {
    const owner = createEditorDocumentGeometryOwner();
    const host = connectedElement("div");
    const shell = connectedElement("div", host);
    Object.assign(shell.dataset, {
      editorBlockShell: "true",
      editorBlockId: blockId,
    });
    owner.registration.blockDomRegistrar.registerBlockShell(blockId, shell);
    const shellRect = vi
      .spyOn(shell, "getBoundingClientRect")
      .mockReturnValue(rect(20, 30, 40, 50));

    expect(owner.reader.readBlockShellRect(blockId)).toBeNull();

    owner.registration.attachDocumentHost(host);
    mockRect(host, rect(10, 10, 200, 100));
    shellRect.mockReturnValue(rect(Number.NaN, 30, 40, 50));
    expect(owner.reader.readBlockShellRect(blockId)).toBeNull();

    shellRect.mockReturnValue(rect(20, 30, -1, 50));
    expect(owner.reader.readBlockShellRect(blockId)).toBeNull();
  });

  it("keeps two mounted editors independent", () => {
    const first = createEditorDocumentGeometryOwner();
    const second = createEditorDocumentGeometryOwner();
    const firstMount = mountTextGeometry(first, blockId, "first");
    const secondMount = mountTextGeometry(second, blockId, "second");
    mockRect(firstMount.host, rect(10, 20, 200, 100));
    mockRect(secondMount.host, rect(300, 400, 200, 100));
    mockRect(firstMount.shell, rect(30, 50, 80, 20));
    mockRect(secondMount.shell, rect(340, 460, 90, 30));

    expect(first.reader.readBlockSelectionRect(blockId)).toEqual({
      left: 20,
      top: 30,
      width: 80,
      height: 20,
    });
    expect(second.reader.readBlockSelectionRect(blockId)).toEqual({
      left: 40,
      top: 60,
      width: 90,
      height: 30,
    });
    firstMount.shell.remove();
    expect(first.reader.readBlockSelectionRect(blockId)).toBeNull();
    expect(second.reader.readBlockSelectionRect(blockId)).not.toBeNull();
  });

  it("coalesces registration and platform invalidations into one frame", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const frame = nextFrame++;
      frames.set(frame, callback);
      return frame;
    });
    const owner = createEditorDocumentGeometryOwner();
    const host = connectedElement("div");
    owner.registration.attachDocumentHost(host);
    flushFrames(frames);
    const listener = vi.fn();
    owner.reader.subscribe(listener);
    const shell = connectedElement("div", host);
    const unregisterShell =
      owner.registration.blockDomRegistrar.registerBlockShell(blockId, shell);
    window.dispatchEvent(new Event("resize"));
    document.dispatchEvent(new Event("scroll"));
    expect(frames.size).toBe(1);
    flushFrames(frames);
    expect(listener).toHaveBeenCalledTimes(1);

    unregisterShell();
    expect(owner.reader.readBlockShellRect(blockId)).toBeNull();
    expect(frames.size).toBe(1);
    flushFrames(frames);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("invalidates directly from a non-bubbling clipping-ancestor scroll", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const frame = nextFrame++;
      frames.set(frame, callback);
      return frame;
    });
    const owner = createEditorDocumentGeometryOwner();
    const host = connectedElement("div");
    const shell = connectedElement("div", host);
    const scroller = connectedElement("div", shell);
    const textRoot = connectedElement("div", scroller);
    Object.assign(shell.dataset, {
      editorBlockShell: "true",
      editorBlockId: blockId,
    });
    scroller.style.overflow = "auto";
    textRoot.dataset.editorTextRoot = "true";
    textRoot.textContent = "scrolling text";
    owner.registration.attachDocumentHost(host);
    owner.registration.blockDomRegistrar.registerBlockShell(blockId, shell);
    owner.registration.registerMountedTextRoot(blockId, textRoot);
    flushFrames(frames);
    const listener = vi.fn();
    owner.reader.subscribe(listener);

    scroller.dispatchEvent(new Event("scroll"));

    expect(frames.size).toBe(1);
    flushFrames(frames);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("creates one observer lifecycle regardless of subscriber count and ignores presentation mutations", () => {
    const frames = new Map<number, FrameRequestCallback>();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.set(1, callback);
      return 1;
    });
    const resizeObservers: TestResizeObserver[] = [];
    const mutationObservers: TestMutationObserver[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class extends TestResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          super(callback);
          resizeObservers.push(this);
        }
      },
    );
    vi.stubGlobal(
      "MutationObserver",
      class extends TestMutationObserver {
        constructor(callback: MutationCallback) {
          super(callback);
          mutationObservers.push(this);
        }
      },
    );
    const owner = createEditorDocumentGeometryOwner();
    const host = connectedElement("div");
    const documentLayer = connectedElement("div", host);
    documentLayer.dataset.editorDocumentLayerHost = "true";
    const presentationChild = connectedElement("div", documentLayer);
    owner.registration.attachDocumentHost(host);
    flushFrames(frames);

    const removeFirst = owner.reader.subscribe(vi.fn());
    const removeSecond = owner.reader.subscribe(vi.fn());
    expect(resizeObservers).toHaveLength(1);
    expect(mutationObservers).toHaveLength(1);

    const mutationObserver = mutationObservers[0]!;
    mutationObserver.callback(
      [
        {
          type: "attributes",
          target: presentationChild,
          addedNodes: [] as unknown as NodeList,
          removedNodes: [] as unknown as NodeList,
        } as MutationRecord,
      ],
      mutationObserver as unknown as MutationObserver,
    );
    expect(frames.size).toBe(0);

    removeFirst();
    removeSecond();
    expect(resizeObservers[0]?.disconnected).toBe(false);
    expect(mutationObservers[0]?.disconnected).toBe(false);
  });

  it("continues notifying a snapshot when subscribers remove themselves or fail", () => {
    const frames = new Map<number, FrameRequestCallback>();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.set(1, callback);
      return 1;
    });
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const owner = createEditorDocumentGeometryOwner();
    const host = connectedElement("div");
    owner.registration.attachDocumentHost(host);
    flushFrames(frames);
    const second = vi.fn();
    let removeFirst = () => undefined;
    removeFirst = owner.reader.subscribe(() => {
      removeFirst();
      throw new Error("subscriber failure");
    });
    owner.reader.subscribe(second);

    window.dispatchEvent(new Event("resize"));
    flushFrames(frames);

    expect(second).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("resize"));
    flushFrames(frames);
    expect(second).toHaveBeenCalledTimes(2);
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("disposes observers, listeners, registrations, sources, frames, and subscribers", () => {
    const frames = new Map<number, FrameRequestCallback>();
    const cancelAnimationFrame = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation((frame) => {
        frames.delete(frame);
      });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.set(1, callback);
      return 1;
    });
    const resizeObservers: TestResizeObserver[] = [];
    const mutationObservers: TestMutationObserver[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class extends TestResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          super(callback);
          resizeObservers.push(this);
        }
      },
    );
    vi.stubGlobal(
      "MutationObserver",
      class extends TestMutationObserver {
        constructor(callback: MutationCallback) {
          super(callback);
          mutationObservers.push(this);
        }
      },
    );
    const removeDocumentListener = vi.spyOn(document, "removeEventListener");
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    const owner = createEditorDocumentGeometryOwner();
    const { host } = mountTextGeometry(owner, blockId, "dispose");
    const listener = vi.fn();
    owner.reader.subscribe(listener);
    expect(frames.size).toBe(1);

    owner.dispose();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(frames.size).toBe(0);
    expect(resizeObservers.every((observer) => observer.disconnected)).toBe(
      true,
    );
    expect(mutationObservers.every((observer) => observer.disconnected)).toBe(
      true,
    );
    expect(removeDocumentListener).toHaveBeenCalledWith(
      "scroll",
      expect.any(Function),
      true,
    );
    expect(removeWindowListener).toHaveBeenCalledWith(
      "resize",
      expect.any(Function),
    );
    expect(owner.reader.readTextCanonicalLength(blockId)).toBeNull();
    expect(owner.registration.blockDomReader.getBlockShell(blockId)).toBeNull();

    window.dispatchEvent(new Event("resize"));
    owner.registration.attachDocumentHost(host);
    owner.registration.blockDomRegistrar.registerBlockShell(blockId, host);
    expect(frames.size).toBe(0);
    expect(listener).not.toHaveBeenCalled();
    expect(owner.registration.blockDomReader.getBlockShell(blockId)).toBeNull();
    resizeObservers[0]?.callback(
      [],
      resizeObservers[0] as unknown as ResizeObserver,
    );
    mutationObservers[0]?.callback(
      [],
      mutationObservers[0] as unknown as MutationObserver,
    );
    expect(frames.size).toBe(0);
  });
});

function mountTextGeometry(
  owner: EditorDocumentGeometryOwner,
  id: BlockId,
  html: string,
): {
  readonly host: HTMLElement;
  readonly shell: HTMLElement;
  readonly surface: HTMLElement;
  readonly textRoot: HTMLElement;
} {
  const host = connectedElement("div");
  const shell = connectedElement("div", host);
  const surface = connectedElement("div", shell);
  const textRoot = connectedElement("div", surface);
  Object.assign(shell.dataset, {
    editorBlockShell: "true",
    editorBlockId: id,
  });
  applyAttributes(shell, editorSelectionBoundsDataAttributes(id));
  textRoot.dataset.editorTextRoot = "true";
  textRoot.innerHTML = html;
  mockRect(host, rect(100, 200, 500, 400));
  mockRect(shell, rect(110, 210, 300, 40));
  mockRect(surface, rect(110, 210, 300, 40));
  mockRect(textRoot, rect(110, 210, 300, 40));
  owner.registration.attachDocumentHost(host);
  owner.registration.blockDomRegistrar.registerBlockShell(id, shell);
  owner.registration.registerMountedTextRoot(id, textRoot);
  return { host, shell, surface, textRoot };
}

function connectedElement(
  tag: string,
  parent: HTMLElement = document.body,
): HTMLElement {
  const element = document.createElement(tag);
  parent.appendChild(element);
  return element;
}

function applyAttributes(
  element: HTMLElement,
  attributes: Readonly<Record<string, string>>,
): void {
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
}

function mockRect(element: HTMLElement, value: DOMRect): void {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(value);
}

function mockTextUnitRangeRects(value: DOMRect): void {
  vi.mocked(Range.prototype.getClientRects).mockImplementation(function (
    this: Range,
  ) {
    return (this.startContainer === this.endContainer &&
    this.startContainer.nodeType === Node.TEXT_NODE &&
    this.startOffset !== this.endOffset
      ? [value]
      : []) as unknown as DOMRectList;
  });
  vi.mocked(Range.prototype.getBoundingClientRect).mockReturnValue(
    rect(0, 0, 0, 0),
  );
}

function rect(
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

function flushFrames(frames: Map<number, FrameRequestCallback>): void {
  const callbacks = [...frames.values()];
  frames.clear();
  for (const callback of callbacks) callback(0);
}

class TestResizeObserver {
  disconnected = false;

  constructor(readonly callback: ResizeObserverCallback) {}

  observe(): void {}

  unobserve(): void {}

  disconnect(): void {
    this.disconnected = true;
  }
}

class TestMutationObserver {
  disconnected = false;

  constructor(readonly callback: MutationCallback) {}

  observe(): void {}

  takeRecords(): MutationRecord[] {
    return [];
  }

  disconnect(): void {
    this.disconnected = true;
  }
}
