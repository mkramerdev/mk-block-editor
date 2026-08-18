import { describe, expect, it, vi } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditableEditor } from "@repo/editor-web/editor";
import { createFirstDraftSelectionMenuStore } from "./selection-menu-store.ts";

describe("createFirstDraftSelectionMenuStore", () => {
  it("subscribes only to selected blocks and releases blocks that leave", () => {
    const first = "selection-menu-first" as BlockId;
    const second = "selection-menu-second" as BlockId;
    const releases = new Map<BlockId, ReturnType<typeof vi.fn>>();
    let selectionListener = () => undefined;
    let blockIds: readonly BlockId[] = [first];
    const editor = {
      editable: true,
      selection: {
        getSnapshot: () => ({ kind: "document", snapshot: selection() }),
        subscribe: (listener: () => void) => {
          selectionListener = listener;
          return vi.fn();
        },
      },
      readCurrentSelectionInlineMarkFormatStates: vi.fn(() => ({
        ok: true,
        snapshot: {},
        blockIds,
        states: { strong: state() },
      })),
      subscribeBlock: vi.fn((blockId: BlockId) => {
        const release = vi.fn();
        releases.set(blockId, release);
        return release;
      }),
    } as unknown as EditableEditor;
    const store = createFirstDraftSelectionMenuStore(editor);
    const unsubscribe = store.subscribe(() => undefined);
    expect(editor.subscribeBlock).toHaveBeenCalledTimes(1);
    expect(editor.subscribeBlock).toHaveBeenCalledWith(first, expect.any(Function));

    blockIds = [second];
    selectionListener();
    expect(releases.get(first)).toHaveBeenCalledOnce();
    expect(editor.subscribeBlock).toHaveBeenCalledWith(second, expect.any(Function));
    unsubscribe();
    expect(releases.get(second)).toHaveBeenCalledOnce();
  });

  it("does not publish a semantically identical formatting snapshot", () => {
    const blockId = "selection-menu-stable" as BlockId;
    const committed = selection();
    let selectionListener = () => undefined;
    const editor = {
      editable: true,
      selection: {
        getSnapshot: () => ({ kind: "document", snapshot: committed }),
        subscribe: (listener: () => void) => {
          selectionListener = listener;
          return vi.fn();
        },
      },
      readCurrentSelectionInlineMarkFormatStates: vi.fn(() => ({
        ok: true,
        snapshot: {},
        blockIds: [blockId],
        states: { strong: state() },
      })),
      subscribeBlock: vi.fn(() => vi.fn()),
    } as unknown as EditableEditor;
    const listener = vi.fn();
    const store = createFirstDraftSelectionMenuStore(editor);
    const unsubscribe = store.subscribe(listener);
    listener.mockClear();
    selectionListener();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("publishes semantic mark, range, and value changes without serializing anchors", () => {
    const blockId = "selection-menu-semantic" as BlockId;
    const committed = selection();
    let selectionListener = () => undefined;
    let currentState = state({ ranges: [range(blockId)] });
    const editor = {
      editable: true,
      selection: {
        getSnapshot: () => ({ kind: "document", snapshot: committed }),
        subscribe: (listener: () => void) => {
          selectionListener = listener;
          return vi.fn();
        },
      },
      readCurrentSelectionInlineMarkFormatStates: vi.fn(() => ({
        ok: true,
        snapshot: {},
        blockIds: [blockId],
        states: { strong: currentState },
      })),
      subscribeBlock: vi.fn(() => vi.fn()),
    } as unknown as EditableEditor;
    const listener = vi.fn();
    const store = createFirstDraftSelectionMenuStore(editor);
    const unsubscribe = store.subscribe(listener);
    listener.mockClear();
    const stringify = vi.spyOn(JSON, "stringify");

    selectionListener();
    expect(listener).not.toHaveBeenCalled();

    currentState = state({ active: true, action: "remove", ranges: [range(blockId)] });
    selectionListener();
    expect(listener).toHaveBeenCalledTimes(1);

    currentState = state({
      active: true,
      action: "remove",
      ranges: [range(blockId, { to: 7 })],
    });
    selectionListener();
    expect(listener).toHaveBeenCalledTimes(2);

    currentState = state({
      active: true,
      action: "remove",
      value: { href: "https://first-draft.test" },
      ranges: [
        range(blockId, {
          to: 7,
          value: { href: "https://first-draft.test" },
        }),
      ],
    });
    selectionListener();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(stringify).not.toHaveBeenCalled();

    stringify.mockRestore();
    unsubscribe();
  });

  it("destroys a captured link session when canonical authority changes", () => {
    const blockId = "selection-menu-link-session" as BlockId;
    let committed = selection();
    let selectionListener = () => undefined;
    const editor = {
      editable: true,
      selection: {
        getSnapshot: () => ({ kind: "document", snapshot: committed }),
        subscribe: (listener: () => void) => {
          selectionListener = listener;
          return vi.fn();
        },
      },
      readCurrentSelectionInlineMarkFormatStates: vi.fn(() => ({
        ok: true,
        snapshot: {},
        blockIds: [blockId],
        states: { link: state() },
      })),
      subscribeBlock: vi.fn(() => vi.fn()),
    } as unknown as EditableEditor;
    const store = createFirstDraftSelectionMenuStore(editor);
    const unsubscribe = store.subscribe(() => undefined);
    store.openLinkSession({
      selection: committed as never,
      states: { link: state() },
      draft: {
        href: "https://obsolete.example",
        title: "Obsolete",
        target: "",
        mixed: false,
      },
      canRemove: false,
    });
    expect(store.getSnapshot().linkSession?.draft.href).toBe(
      "https://obsolete.example",
    );

    committed = { ...committed, revision: 2 };
    selectionListener();
    expect(store.getSnapshot().linkSession).toBeNull();

    unsubscribe();
  });
});

function selection() {
  return { kind: "document", revision: 1, owner: { kind: "document" } };
}

function state(
  overrides: Partial<ReturnType<typeof baseState>> = {},
) {
  return { ...baseState(), ...overrides };
}

function baseState() {
  return {
    active: false,
    mixed: false,
    value: null,
    canExecute: true,
    action: "add",
    ranges: [],
  };
}

function range(
  blockId: BlockId,
  overrides: Record<string, unknown> = {},
) {
  return {
    blockId,
    blockType: "paragraph",
    from: 1,
    to: 4,
    coverage: "partial",
    hasMark: false,
    hasUnmarkedText: true,
    value: null,
    startTextAnchor: {
      kind: "block-relative-text",
      codec: "large-test-anchor",
      version: 1,
      payload: { encoded: "x".repeat(100_000), assoc: -1 },
    },
    endTextAnchor: {
      kind: "block-relative-text",
      codec: "large-test-anchor",
      version: 1,
      payload: { encoded: "y".repeat(100_000), assoc: 1 },
    },
    ...overrides,
  };
}
