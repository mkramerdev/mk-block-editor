import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditableEditorRuntimePort } from "../../../runtime/document/render-port.ts";
import type { EditorBlockDomRegistryReader } from "../../blocks/block-dom-registry.ts";
import { createEditorCaretVisibilityController } from "./caret-visibility.ts";
import { scrollKeyboardSelectionFocusIntoView } from "./keyboard-scroll.ts";

const id = (value: string) => value as BlockId;

describe("editor caret visibility", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("reveals input asynchronously and reacts when wrapping moves the same caret", () => {
    const fixture = createFixture();
    fixture.caretRect = rect(20, 40, 1, 16);

    fixture.activeRoot.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(fixture.geometry.readViewportTextCaretRect).not.toHaveBeenCalled();
    expect(fixture.frames.size).toBe(1);
    fixture.frames.flush();
    expect(fixture.scrollRoot.scrollTop).toBe(0);

    fixture.caretRect = rect(20, 112, 1, 16);
    fixture.activeRoot.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(fixture.selection.blockId).toBe(fixture.initialBlockId);
    fixture.frames.flush();

    expect(fixture.geometry.readViewportTextCaretRect).toHaveBeenLastCalledWith(
      fixture.initialBlockId,
      3,
      undefined,
    );
    expect(fixture.scrollRoot.scrollTop).toBe(56);
    fixture.dispose();
  });

  it.each([
    ["slash-menu creation", "slash", false],
    ["root append-surface creation", "root-append", true],
    ["column append-surface creation", "column-append", false],
    ["block-control insertion", "block-control", false],
  ] as const)("reveals %s from one delegated click", (_, name, outsideList) => {
    const fixture = createFixture();
    fixture.caretRect = rect(20, 118, 1, 14);
    const controlOwner = fixture.documentRoot.ownerDocument.createElement("div");
    controlOwner.dataset.editorUi = "true";
    const control = fixture.documentRoot.ownerDocument.createElement("button");
    control.dataset.testid = name;
    controlOwner.append(control);
    (outsideList ? fixture.documentRoot : fixture.list).append(controlOwner);
    control.addEventListener("click", () => fixture.activateNewParagraph());

    control.click();
    expect(fixture.geometry.readViewportTextCaretRect).not.toHaveBeenCalled();
    fixture.frames.flush();

    expect(fixture.selection.blockId).toBe(fixture.createdBlockId);
    expect(fixture.geometry.readViewportTextCaretRect).toHaveBeenCalledWith(
      fixture.createdBlockId,
      0,
      undefined,
    );
    expect(fixture.scrollRoot.scrollTop).toBe(60);
    fixture.dispose();
  });

  it("reveals an Enter-created paragraph after the key handler completes", () => {
    const fixture = createFixture();
    fixture.caretRect = rect(20, 118, 1, 14);
    fixture.activeRoot.addEventListener("keydown", (event) => {
      if (event.key === "Enter") fixture.activateNewParagraph();
    });

    fixture.activeRoot.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
    );
    expect(fixture.geometry.readViewportTextCaretRect).not.toHaveBeenCalled();
    fixture.frames.flush();

    expect(fixture.geometry.readViewportTextCaretRect).toHaveBeenCalledWith(
      fixture.createdBlockId,
      0,
      undefined,
    );
    expect(fixture.scrollRoot.scrollTop).toBe(60);
    fixture.dispose();
  });

  it("preserves horizontal scrolling, uses the nearest root, and clamps vertically", () => {
    const fixture = createFixture();
    fixture.scrollRoot.scrollTop = 390;
    fixture.scrollRoot.scrollLeft = 37;
    fixture.caretRect = rect(900, 118, 1, 14);
    const windowScroll = vi.spyOn(window, "scrollTo");

    fixture.activeRoot.dispatchEvent(new InputEvent("input", { bubbles: true }));
    fixture.frames.flush();

    expect(fixture.scrollRoot.scrollTop).toBe(400);
    expect(fixture.scrollRoot.scrollLeft).toBe(37);
    expect(windowScroll).not.toHaveBeenCalled();
    fixture.dispose();
  });

  it("uses the page scrolling root when there is no overflow ancestor", () => {
    const fixture = createFixture({ nearestScrollRoot: false });
    const pageRoot = document.documentElement;
    const restore = installElementMetrics(pageRoot, {
      clientHeight: 100,
      clientWidth: 200,
      scrollHeight: 500,
      scrollWidth: 200,
    });
    const previousHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 100,
    });
    pageRoot.scrollTop = 0;
    fixture.caretRect = rect(20, 118, 1, 14);

    fixture.activeRoot.dispatchEvent(new InputEvent("input", { bubbles: true }));
    fixture.frames.flush();

    expect(pageRoot.scrollTop).toBe(60);
    fixture.dispose();
    restore();
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: previousHeight,
    });
  });

  it("coalesces input, performs no synchronous measurement, and skips visible carets", () => {
    const fixture = createFixture();
    fixture.caretRect = rect(20, 40, 1, 16);

    for (let index = 0; index < 3; index += 1) {
      fixture.activeRoot.dispatchEvent(
        new InputEvent("input", { bubbles: true }),
      );
    }

    expect(fixture.frames.requests).toBe(1);
    expect(fixture.geometry.readViewportTextCaretRect).not.toHaveBeenCalled();
    fixture.frames.flush();
    expect(fixture.geometry.readViewportTextCaretRect).toHaveBeenCalledOnce();
    expect(fixture.scrollRoot.scrollTop).toBe(0);
    fixture.dispose();
  });

  it("retries caret geometry once and uses a bounded empty-block fallback", () => {
    const fixture = createFixture();
    fixture.caretRect = null;
    fixture.shellRect = rect(20, 120, 180, 80);
    fixture.plainText = "";

    fixture.activeRoot.dispatchEvent(new InputEvent("input", { bubbles: true }));
    fixture.frames.flushOne();
    expect(fixture.frames.size).toBe(1);
    expect(fixture.geometry.readViewportBlockShellRect).not.toHaveBeenCalled();
    fixture.frames.flushOne();

    expect(fixture.geometry.readViewportTextCaretRect).toHaveBeenCalledTimes(2);
    expect(fixture.geometry.readViewportBlockShellRect).toHaveBeenCalledWith(
      fixture.initialBlockId,
    );
    expect(fixture.scrollRoot.scrollTop).toBe(80);
    expect(fixture.frames.size).toBe(0);
    fixture.dispose();
  });

  it("ignores noncollapsed, non-text, inactive-owner, and unrelated-control activity", () => {
    const fixture = createFixture();
    fixture.selection.endOffset = 5;
    fixture.activeRoot.dispatchEvent(new InputEvent("input", { bubbles: true }));
    fixture.frames.flush();
    expect(fixture.geometry.readViewportTextCaretRect).not.toHaveBeenCalled();

    fixture.selection.endOffset = fixture.selection.offset;
    fixture.selection.kind = "block-internal";
    fixture.activeRoot.dispatchEvent(new InputEvent("input", { bubbles: true }));
    fixture.frames.flush();
    expect(fixture.geometry.readViewportTextCaretRect).not.toHaveBeenCalled();

    fixture.selection.kind = "document";
    delete fixture.activeRoot.dataset.editorInputOwner;
    fixture.activeRoot.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(fixture.frames.size).toBe(0);
    fixture.activeRoot.dataset.editorInputOwner = "true";

    const menu = document.createElement("div");
    menu.dataset.editorUi = "true";
    const search = document.createElement("input");
    const unrelated = document.createElement("button");
    menu.append(search, unrelated);
    fixture.documentRoot.append(menu);
    search.dispatchEvent(new InputEvent("input", { bubbles: true }));
    unrelated.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    fixture.frames.flush();
    expect(fixture.geometry.readViewportTextCaretRect).not.toHaveBeenCalled();
    fixture.dispose();
  });

  it("does not schedule for programmatic focus or remote changes", () => {
    const fixture = createFixture();
    fixture.activeRoot.focus({ preventScroll: true });
    fixture.selection.offset = 7;
    fixture.selection.endOffset = 7;

    expect(fixture.frames.size).toBe(0);
    expect(fixture.geometry.readViewportTextCaretRect).not.toHaveBeenCalled();
    expect(fixture.scrollRoot.scrollTop).toBe(0);
    fixture.dispose();
  });

  it("cancels pending frames on unmount or interaction disable", () => {
    const fixture = createFixture();
    fixture.activeRoot.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(fixture.frames.size).toBe(1);

    fixture.dispose();
    fixture.frames.flush();

    expect(fixture.frames.size).toBe(0);
    expect(fixture.geometry.readViewportTextCaretRect).not.toHaveBeenCalled();
  });

  it("retains global keyboard-selection scrolling through the shared viewport math", () => {
    const fixture = createFixture();
    const shell = fixture.activeRoot.parentElement!;
    shell.getBoundingClientRect = () => domRect(20, 300, 120, 20);

    scrollKeyboardSelectionFocusIntoView(
      {
        getBlockShell: () => shell,
      } as unknown as EditorBlockDomRegistryReader,
      fixture.list,
      {
        blockId: fixture.initialBlockId,
        blockType: "paragraph",
        blockCategory: "text",
        textOffset: 3,
        textAnchor: null,
        affinity: null,
      },
      "ArrowDown",
    );

    expect(fixture.scrollRoot.scrollTop).toBeGreaterThan(0);
    fixture.dispose();
  });
});

function createFixture(
  options: { readonly nearestScrollRoot?: boolean } = {},
) {
  const initialBlockId = id("paragraph-one");
  const createdBlockId = id("paragraph-created");
  const selection = {
    kind: "document" as "document" | "block-internal",
    blockId: initialBlockId,
    offset: 3,
    endOffset: 3,
  };
  const scrollRoot = document.createElement("div");
  if (options.nearestScrollRoot !== false) scrollRoot.style.overflowY = "auto";
  const documentRoot = document.createElement("div");
  documentRoot.dataset.editorWeb = "document";
  const list = document.createElement("div");
  list.dataset.editorBlockListRoot = "true";
  documentRoot.append(list);
  scrollRoot.append(documentRoot);
  document.body.append(scrollRoot);
  installElementMetrics(scrollRoot, {
    clientHeight: 100,
    clientWidth: 200,
    scrollHeight: 500,
    scrollWidth: 1000,
  });
  scrollRoot.getBoundingClientRect = () => domRect(0, 0, 200, 100);
  let caretRect: ReturnType<typeof rect> | null = rect(20, 40, 1, 16);
  let shellRect: ReturnType<typeof rect> | null = rect(20, 40, 180, 20);
  let plainText = "abc";
  const geometry = {
    readViewportTextCaretRect: vi.fn(() => caretRect),
    readViewportBlockShellRect: vi.fn(() => shellRect),
  };
  const blocks = new Map<BlockId, { id: BlockId; type: string; tombstone: false }>([
    [initialBlockId, { id: initialBlockId, type: "paragraph", tombstone: false }],
  ]);
  const editor = {
    definition: { blocks: { paragraph: { kind: "text" } } },
    geometry,
    getBlock: (blockId: BlockId) => blocks.get(blockId) ?? null,
    readBlockPlainText: () => plainText,
    selectionController: {
      getCanonicalSnapshot: () => canonicalSnapshot(selection),
    },
  } as unknown as EditableEditorRuntimePort;
  const frames = createFrameScheduler();

  const mountTextRoot = (blockId: BlockId) => {
    const shell = document.createElement("div");
    shell.dataset.editorBlockShell = "true";
    shell.dataset.editorBlockId = blockId;
    const root = document.createElement("div");
    root.dataset.editorTextRoot = "true";
    root.dataset.editorInputOwner = "true";
    root.contentEditable = "true";
    root.tabIndex = 0;
    shell.append(root);
    list.append(shell);
    return root;
  };
  const activeRoot = mountTextRoot(initialBlockId);
  activeRoot.focus();
  const controller = createEditorCaretVisibilityController({
    editor,
    list,
    frameScheduler: frames,
  });
  const fixture = {
    initialBlockId,
    createdBlockId,
    selection,
    scrollRoot,
    documentRoot,
    list,
    activeRoot,
    geometry,
    frames,
    dispose: () => controller.dispose(),
    activateNewParagraph() {
      blocks.set(createdBlockId, {
        id: createdBlockId,
        type: "paragraph",
        tombstone: false,
      });
      selection.blockId = createdBlockId;
      selection.offset = 0;
      selection.endOffset = 0;
      mountTextRoot(createdBlockId).focus({ preventScroll: true });
    },
    get caretRect() {
      return caretRect;
    },
    set caretRect(value) {
      caretRect = value;
    },
    set shellRect(value: ReturnType<typeof rect> | null) {
      shellRect = value;
    },
    set plainText(value: string) {
      plainText = value;
    },
  };
  return fixture;
}

function canonicalSnapshot(selection: {
  readonly kind: "document" | "block-internal";
  readonly blockId: BlockId;
  readonly offset: number;
  readonly endOffset: number;
}) {
  const anchor = {
    blockId: selection.blockId,
    blockType: "paragraph",
    blockCategory: "text",
    textOffset: selection.offset,
    textAnchor: null,
    affinity: null,
  };
  const focus = { ...anchor, textOffset: selection.endOffset };
  return {
    kind: selection.kind,
    snapshot: {
      documentSelection: { anchor, focus },
    },
  };
}

function createFrameScheduler() {
  let nextId = 1;
  let requests = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  return {
    request(callback: FrameRequestCallback) {
      requests += 1;
      const handle = nextId++;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel(handle: number) {
      callbacks.delete(handle);
    },
    flushOne() {
      const entry = callbacks.entries().next().value as
        | [number, FrameRequestCallback]
        | undefined;
      if (!entry) return;
      callbacks.delete(entry[0]);
      entry[1](0);
    },
    flush() {
      while (callbacks.size > 0) this.flushOne();
    },
    get size() {
      return callbacks.size;
    },
    get requests() {
      return requests;
    },
  };
}

function installElementMetrics(
  element: HTMLElement,
  values: {
    readonly clientHeight: number;
    readonly clientWidth: number;
    readonly scrollHeight: number;
    readonly scrollWidth: number;
  },
): () => void {
  const descriptors = Object.fromEntries(
    Object.keys(values).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(element, key),
    ]),
  );
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(element, key, { configurable: true, value });
  }
  return () => {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(element, key, descriptor);
      else delete (element as unknown as Record<string, unknown>)[key];
    }
  };
}

function rect(left: number, top: number, width: number, height: number) {
  return { left, top, width, height };
}

function domRect(left: number, top: number, width: number, height: number): DOMRect {
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
  };
}
