import { describe, expect, it, vi } from "vitest";
import { asBlockId, type BlockId } from "@repo/editor-core/kernel";
import {
  createEditorSelectionTextAnchor,
  type CommittedSelectionSnapshot,
  type EditorSelectionInlineMarkFormatRange,
  type EditorSelectionInlineMarkFormatState,
  type ReadSelectionInlineMarkFormatStatesResult,
} from "@repo/editor-react/selection";
import { createFirstDraftSelectionMenuStore } from "./selection-menu-store.ts";

describe("createFirstDraftSelectionMenuStore", () => {
  it("subscribes only to selected blocks and releases blocks that leave", () => {
    const first = asBlockId("selection-menu-first");
    const second = asBlockId("selection-menu-second");
    const releases = new Map<BlockId, ReturnType<typeof vi.fn>>();
    let selectionListener: () => void = () => undefined;
    let blockIds: readonly BlockId[] = [first];
    const editor = {
      editable: true,
      selection: {
        getSnapshot: () => canonicalSelection(selection()),
        subscribe: (listener: () => void) => {
          selectionListener = listener;
          return vi.fn();
        },
      },
      readCurrentSelectionInlineMarkFormatStates: vi.fn(() =>
        formatResult(blockIds, { strong: state() }),
      ),
      subscribeBlock: vi.fn((blockId: BlockId) => {
        const release = vi.fn();
        releases.set(blockId, release);
        return release;
      }),
    } satisfies Parameters<typeof createFirstDraftSelectionMenuStore>[0];
    const store = createFirstDraftSelectionMenuStore(editor);
    const unsubscribe = store.subscribe(() => undefined);
    expect(editor.subscribeBlock).toHaveBeenCalledTimes(1);
    expect(editor.subscribeBlock).toHaveBeenCalledWith(
      first,
      expect.any(Function),
    );

    blockIds = [second];
    selectionListener();
    expect(releases.get(first)).toHaveBeenCalledOnce();
    expect(editor.subscribeBlock).toHaveBeenCalledWith(
      second,
      expect.any(Function),
    );
    unsubscribe();
    expect(releases.get(second)).toHaveBeenCalledOnce();
  });

  it("does not publish a semantically identical formatting snapshot", () => {
    const blockId = asBlockId("selection-menu-stable");
    const committed = selection();
    let selectionListener: () => void = () => undefined;
    const editor = {
      editable: true,
      selection: {
        getSnapshot: () => canonicalSelection(committed),
        subscribe: (listener: () => void) => {
          selectionListener = listener;
          return vi.fn();
        },
      },
      readCurrentSelectionInlineMarkFormatStates: vi.fn(() =>
        formatResult([blockId], { strong: state() }),
      ),
      subscribeBlock: vi.fn(() => vi.fn()),
    } satisfies Parameters<typeof createFirstDraftSelectionMenuStore>[0];
    const listener = vi.fn();
    const store = createFirstDraftSelectionMenuStore(editor);
    const unsubscribe = store.subscribe(listener);
    listener.mockClear();
    selectionListener();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("publishes semantic mark, range, and value changes without serializing anchors", () => {
    const blockId = asBlockId("selection-menu-semantic");
    const committed = selection();
    let selectionListener: () => void = () => undefined;
    let currentState = state({ ranges: [range(blockId)] });
    const editor = {
      editable: true,
      selection: {
        getSnapshot: () => canonicalSelection(committed),
        subscribe: (listener: () => void) => {
          selectionListener = listener;
          return vi.fn();
        },
      },
      readCurrentSelectionInlineMarkFormatStates: vi.fn(() =>
        formatResult([blockId], { strong: currentState }),
      ),
      subscribeBlock: vi.fn(() => vi.fn()),
    } satisfies Parameters<typeof createFirstDraftSelectionMenuStore>[0];
    const listener = vi.fn();
    const store = createFirstDraftSelectionMenuStore(editor);
    const unsubscribe = store.subscribe(listener);
    listener.mockClear();
    const stringify = vi.spyOn(JSON, "stringify");

    selectionListener();
    expect(listener).not.toHaveBeenCalled();

    currentState = state({
      active: true,
      action: "remove",
      ranges: [range(blockId)],
    });
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
    const blockId = asBlockId("selection-menu-link-session");
    let committed = selection();
    let selectionListener: () => void = () => undefined;
    const editor = {
      editable: true,
      selection: {
        getSnapshot: () => canonicalSelection(committed),
        subscribe: (listener: () => void) => {
          selectionListener = listener;
          return vi.fn();
        },
      },
      readCurrentSelectionInlineMarkFormatStates: vi.fn(() =>
        formatResult([blockId], { link: state({ markName: "link" }) }),
      ),
      subscribeBlock: vi.fn(() => vi.fn()),
    } satisfies Parameters<typeof createFirstDraftSelectionMenuStore>[0];
    const store = createFirstDraftSelectionMenuStore(editor);
    const unsubscribe = store.subscribe(() => undefined);
    store.openLinkSession({
      selection: committed,
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

function selection(revision = 1): CommittedSelectionSnapshot {
  const owner = { kind: "document" as const };
  const derivation = {
    kind: "deferred-runtime-derivation" as const,
    sourceSelectionRevision: revision,
    owner,
  };
  return {
    revision,
    kind: "document",
    owner,
    direction: null,
    endpoints: {
      anchor: null,
      head: null,
      normalizedStart: null,
      normalizedEnd: null,
    },
    blocks: [],
    materialization: derivation,
    edit: derivation,
    focus: { ...derivation, target: null },
    documentSelection: {
      phase: "committed",
      selectionRevision: revision,
      graphRevision: 1,
      lastInvalidationReason: null,
      direction: null,
      anchor: null,
      focus: null,
      normalizedStart: null,
      normalizedEnd: null,
      rangeBlocks: [],
    },
    documentProjection: null,
    internal: null,
  };
}

function state(
  overrides: Partial<EditorSelectionInlineMarkFormatState> = {},
): EditorSelectionInlineMarkFormatState {
  return { ...baseState(), ...overrides };
}

function baseState(): EditorSelectionInlineMarkFormatState {
  return {
    markName: "strong",
    commandId: "test:strong",
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
  overrides: Partial<EditorSelectionInlineMarkFormatRange> = {},
): EditorSelectionInlineMarkFormatRange {
  const startTextAnchor = textAnchor("x".repeat(100_000), -1);
  const endTextAnchor = textAnchor("y".repeat(100_000), 1);
  return {
    blockId,
    blockType: "paragraph",
    from: 1,
    to: 4,
    coverage: "partial",
    hasMark: false,
    hasUnmarkedText: true,
    value: null,
    startTextAnchor,
    endTextAnchor,
    ...overrides,
  };
}

function textAnchor(encoded: string, assoc: -1 | 0 | 1) {
  const result = createEditorSelectionTextAnchor({
    codec: "large-test-anchor",
    payload: { encoded, assoc },
  });
  if (!result.ok) throw new Error(result.message);
  return result.textAnchor;
}

function canonicalSelection(snapshot: CommittedSelectionSnapshot) {
  return {
    kind: "document" as const,
    revision: snapshot.revision,
    snapshot,
  };
}

function formatResult(
  blockIds: readonly BlockId[],
  states: Readonly<Record<string, EditorSelectionInlineMarkFormatState>>,
): ReadSelectionInlineMarkFormatStatesResult {
  return {
    ok: true,
    snapshot: { ...selection().documentSelection, phase: "committed" },
    blockIds,
    states,
  };
}
