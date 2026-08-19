import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asBlockId, type BlockId } from "@repo/editor-core/kernel";
import { createBlockRecord } from "@repo/editor-core/metadata";
import {
  createCommittedSelectionSnapshot,
  type CommittedSelectionSnapshot,
  type EditorLogicalSelectionPoint,
  type EditorSelectionRangeBlock,
  type EditorSelectionSnapshot,
  type SelectionInlineMarkFormatStates,
} from "@repo/editor-react/selection";
import type { EditableEditor } from "@repo/editor-web/editor";
import {
  compileReadEditorDefinition,
  initializeReadEditor,
  type ReadEditorDefinition,
} from "@repo/editor-web/read-runtime";
import { FirstDraftSelectionMenu } from "./first-draft-selection-menu.tsx";

describe("FirstDraftSelectionMenu", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("derives placement from both endpoints and remeasures when only the anchor changes", () => {
    const anchorBlockId = "selection-menu-anchor" as BlockId;
    const headBlockId = "selection-menu-head" as BlockId;
    const initial = selectionFixture(
      selectionPoint(anchorBlockId, 1, "backward"),
      selectionPoint(headBlockId, 4, "forward"),
      7,
    );
    const readCaret = vi.fn(
      (blockId: BlockId, offset: number, affinity: string | undefined) => {
        if (blockId === headBlockId && offset === 4 && affinity === "forward") {
          return { left: 200, top: 100, width: 1, height: 18 };
        }
        if (
          blockId === anchorBlockId &&
          offset === 1 &&
          affinity === "backward"
        ) {
          return { left: 80, top: 40, width: 1, height: 18 };
        }
        if (
          blockId === anchorBlockId &&
          offset === 2 &&
          affinity === "backward"
        ) {
          return { left: 80, top: 160, width: 1, height: 18 };
        }
        return null;
      },
    );
    const editor = editorFixture({
      selection: initial,
      readCaretRect: readCaret,
    });
    const frames = frameQueue();
    render(<FirstDraftSelectionMenu editor={editor} />);
    const menu = screen.getByLabelText("Text formatting");
    const menuRect = vi
      .spyOn(menu, "getBoundingClientRect")
      .mockReturnValue(domRect(120, 40));

    frames.flush();
    expect(readCaret.mock.calls).toEqual([
      [headBlockId, 4, "forward"],
      [anchorBlockId, 1, "backward"],
    ]);
    expect(menu.getAttribute("data-placement")).toBe("below");
    expect(editor.formatSelectionInlineMark).not.toHaveBeenCalled();

    const changedAnchor = selectionFixture(
      selectionPoint(anchorBlockId, 2, "backward"),
      selectionPoint(headBlockId, 4, "forward"),
      8,
    );
    editor.selection.getSnapshot.mockReturnValue({
      kind: "document",
      revision: 8,
      snapshot: changedAnchor,
    });
    readCaret.mockClear();
    const selectionListener = editor.selection.subscribe.mock.calls[0]?.[0];
    if (!selectionListener)
      throw new Error("selection listener was not installed");
    act(() => selectionListener());
    frames.flush();
    expect(readCaret.mock.calls).toEqual([
      [headBlockId, 4, "forward"],
      [anchorBlockId, 2, "backward"],
    ]);
    expect(menu.getAttribute("data-placement")).toBe("above");

    fireEvent.click(screen.getByLabelText("Link"));
    const linkInput = screen.getByLabelText("URL");
    menuRect.mockReturnValue(domRect(240, 60));
    readCaret.mockClear();
    frames.flush();
    expect(readCaret.mock.calls).toEqual([
      [headBlockId, 4, "forward"],
      [anchorBlockId, 2, "backward"],
    ]);
    expect(menu.getAttribute("data-placement")).toBe("above");
    expect(screen.getByLabelText("URL")).toBe(linkInput);
    expect(editor.formatSelectionInlineMark).not.toHaveBeenCalled();
  });

  it("reports the final collision-resolved placement", () => {
    const blockId = "selection-menu-collision" as BlockId;
    const selection = selectionFixture(
      selectionPoint(blockId, 8, "backward"),
      selectionPoint(blockId, 1, "forward"),
      7,
    );
    const readCaret = vi.fn((_blockId: BlockId, offset: number) =>
      offset === 8
        ? { left: 100, top: 100, width: 1, height: 18 }
        : { left: 100, top: 10, width: 1, height: 18 },
    );
    const editor = editorFixture({ selection, readCaretRect: readCaret });
    const frames = frameQueue();
    render(<FirstDraftSelectionMenu editor={editor} />);
    const menu = screen.getByLabelText("Text formatting");
    vi.spyOn(menu, "getBoundingClientRect").mockReturnValue(domRect(120, 40));

    frames.flush();
    expect(menu.getAttribute("data-placement")).toBe("below");
    expect(editor.formatSelectionInlineMark).not.toHaveBeenCalled();
  });

  it("remains live through Strict Mode replay and releases each subscription lifetime", async () => {
    const fixture = lifecycleEditorFixture();
    const view = render(
      <StrictMode>
        <FirstDraftSelectionMenu editor={fixture.editor} />
      </StrictMode>,
    );
    expect(screen.queryByLabelText("Text formatting")).toBeNull();
    expect(fixture.selectionSubscriptions).toHaveLength(2);
    expect(fixture.selectionSubscriptions[0]!.release).toHaveBeenCalledOnce();
    expect(fixture.activeSelectionListenerCount()).toBe(1);

    fixture.select("selection-menu-strict-a" as BlockId, 1, false);
    const menu = screen.getByLabelText("Text formatting");
    expect(screen.getByLabelText("Bold").getAttribute("aria-pressed")).toBe(
      "false",
    );

    fixture.select("selection-menu-strict-b" as BlockId, 2, true);
    await waitFor(() =>
      expect(screen.getByLabelText("Bold").getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );
    expect(screen.getByLabelText("Text formatting")).toBe(menu);

    view.unmount();
    expect(fixture.selectionSubscriptions).toHaveLength(2);
    for (const subscription of fixture.selectionSubscriptions) {
      expect(subscription.release).toHaveBeenCalledOnce();
    }
    expect(fixture.blockSubscriptions).toHaveLength(2);
    for (const subscription of fixture.blockSubscriptions) {
      expect(subscription.release).toHaveBeenCalledOnce();
    }
    expect(fixture.activeSelectionListenerCount()).toBe(0);
    expect(fixture.activeBlockListenerCount()).toBe(0);
  });

  it("uses one subscription lifetime without Strict Mode", async () => {
    const fixture = lifecycleEditorFixture();
    const view = render(<FirstDraftSelectionMenu editor={fixture.editor} />);
    expect(fixture.selectionSubscriptions).toHaveLength(1);

    fixture.select("selection-menu-ordinary" as BlockId, 1, false);
    expect(screen.getByLabelText("Text formatting")).toBeTruthy();
    expect(fixture.blockSubscriptions).toHaveLength(1);

    view.unmount();
    expect(fixture.selectionSubscriptions[0]!.release).toHaveBeenCalledOnce();
    expect(fixture.blockSubscriptions[0]!.release).toHaveBeenCalledOnce();
    expect(fixture.activeSelectionListenerCount()).toBe(0);
    expect(fixture.activeBlockListenerCount()).toBe(0);
  });

  it("renders accessible mark controls and invokes one canonical command", () => {
    const editor = editorFixture();
    render(<FirstDraftSelectionMenu editor={editor} />);
    expect(
      screen
        .getByLabelText("Text formatting")
        .getAttribute("data-first-draft-selection-menu"),
    ).toBe("true");
    expect(
      screen
        .getByLabelText("Text formatting")
        .getAttribute("data-editor-preserve-selection"),
    ).toBe("true");
    expect(screen.getByLabelText("Bold").getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(screen.getByLabelText("Italic").getAttribute("aria-pressed")).toBe(
      "mixed",
    );
    const bold = screen.getByLabelText("Bold");
    expect(fireEvent.pointerDown(bold)).toBe(false);
    expect(fireEvent.mouseDown(bold)).toBe(false);
    fireEvent.click(bold);
    expect(editor.formatSelectionInlineMark).toHaveBeenCalledOnce();
    expect(editor.formatSelectionInlineMark).toHaveBeenCalledWith({
      selection: expect.any(Object),
      markName: "strong",
    });
  });

  it("captures the committed selection for link apply and restores Link focus", () => {
    const editor = editorFixture();
    render(<FirstDraftSelectionMenu editor={editor} />);
    const link = screen.getByLabelText("Link");
    fireEvent.click(link);
    const url = screen.getByLabelText("URL");
    expect(document.activeElement).toBe(url);
    fireEvent.change(url, { target: { value: " https://example.test/path " } });
    fireEvent.change(screen.getByLabelText("Title (optional)"), {
      target: { value: " Example " },
    });
    fireEvent.change(screen.getByLabelText("Target"), {
      target: { value: "_blank" },
    });
    fireEvent.click(screen.getByText("Apply"));
    expect(editor.formatSelectionInlineMark).toHaveBeenLastCalledWith({
      selection: expect.objectContaining({ revision: 7 }),
      markName: "link",
      action: "add",
      attrs: {
        href: "https://example.test/path",
        title: "Example",
        target: "_blank",
      },
    });
    expect(document.activeElement).toBe(link);
  });

  it("initializes, removes, cancels, and rejects stale captured links without mutation", () => {
    const editor = editorFixture({
      linkState: {
        active: true,
        mixed: false,
        value: {
          href: "https://existing.example/path",
          title: "Existing",
          target: "_blank",
        },
      },
    });
    render(<FirstDraftSelectionMenu editor={editor} />);
    const link = screen.getByLabelText("Link");
    fireEvent.click(link);
    expect((screen.getByLabelText("URL") as HTMLInputElement).value).toBe(
      "https://existing.example/path",
    );
    expect(
      (screen.getByLabelText("Title (optional)") as HTMLInputElement).value,
    ).toBe("Existing");
    expect((screen.getByLabelText("Target") as HTMLSelectElement).value).toBe(
      "_blank",
    );
    fireEvent.click(screen.getByText("Remove"));
    expect(editor.formatSelectionInlineMark).toHaveBeenLastCalledWith({
      selection: expect.objectContaining({ revision: 7 }),
      markName: "link",
      action: "remove",
    });
    expect(document.activeElement).toBe(link);

    fireEvent.click(link);
    expect(
      screen
        .getByLabelText("Edit link")
        .getAttribute("data-editor-preserve-selection"),
    ).toBe("true");
    fireEvent.keyDown(screen.getByLabelText("URL"), { key: "Escape" });
    expect(screen.queryByRole("form", { name: "Edit link" })).toBeNull();
    expect(document.activeElement).toBe(link);

    fireEvent.click(link);
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByRole("form", { name: "Edit link" })).toBeNull();
    expect(editor.formatSelectionInlineMark).toHaveBeenCalledTimes(1);
  });

  it("represents mixed links and keeps a stale captured selection non-mutating", () => {
    const editor = editorFixture({
      linkState: { active: false, mixed: true, value: null },
      formatResult: { ok: false, reason: "stale-selection" },
    });
    render(<FirstDraftSelectionMenu editor={editor} />);
    fireEvent.click(screen.getByLabelText("Link"));
    expect(
      screen.getByText(
        "The selection contains different links. Applying replaces them.",
      ),
    ).toBeTruthy();
    expect((screen.getByLabelText("URL") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://replacement.example" },
    });
    fireEvent.click(screen.getByText("Apply"));
    expect(
      screen.getByText("The original text selection is no longer available.")
        .textContent,
    ).toBe("The original text selection is no longer available.");
    expect(screen.getByLabelText("Edit link")).toBeTruthy();
  });

  it("keeps the link input mounted against its capture when current eligibility changes", () => {
    const options: { eligible: boolean } = { eligible: true };
    const editor = editorFixture(options);
    render(<FirstDraftSelectionMenu editor={editor} />);
    fireEvent.click(screen.getByLabelText("Link"));
    const input = screen.getByLabelText("URL") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "https://captured.example" } });
    options.eligible = false;
    const selectionListener = editor.selection.subscribe.mock.calls[0]?.[0];
    if (!selectionListener)
      throw new Error("selection listener was not installed");
    act(() => selectionListener());
    expect(screen.getByLabelText("URL")).toBe(input);
    expect(input.value).toBe("https://captured.example");
  });

  it("closes a link session when canonical selection authority changes", () => {
    const editor = editorFixture();
    render(<FirstDraftSelectionMenu editor={editor} />);
    fireEvent.click(screen.getByLabelText("Link"));
    expect(screen.getByLabelText("Edit link")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://obsolete.example" },
    });
    const unrelated = document.createElement("button");
    document.body.append(unrelated);
    unrelated.focus();
    const current = editor.selection.getSnapshot();
    if (current.kind !== "document")
      throw new Error("expected document selection");
    editor.selection.getSnapshot.mockReturnValue({
      kind: "document",
      revision: 8,
      snapshot: { ...current.snapshot, revision: 8 },
    });
    const selectionListener = editor.selection.subscribe.mock.calls[0]?.[0];
    if (!selectionListener)
      throw new Error("selection listener was not installed");
    act(() => selectionListener());
    expect(screen.queryByRole("form", { name: "Edit link" })).toBeNull();
    expect(document.activeElement).toBe(unrelated);
    expect(editor.formatSelectionInlineMark).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Link"));
    expect((screen.getByLabelText("URL") as HTMLInputElement).value).toBe("");
    unrelated.remove();
  });

  it("does not render for an ineligible or block-internal selection", () => {
    const editor = editorFixture({ eligible: false });
    const view = render(<FirstDraftSelectionMenu editor={editor} />);
    expect(
      screen.queryByRole("toolbar", { name: "Text formatting" }),
    ).toBeNull();
    view.unmount();
    expect(editor.selection.subscribe).toHaveBeenCalledOnce();
  });

  it("renders no menu for a read-only editor", () => {
    const blockId = asBlockId("01890f07-1c00-7000-8000-000000000906");
    const definition = {
      blocks: {
        paragraph: {
          kind: "text",
          rootLayout: "normal",
          type: "paragraph",
          split: { default: "paragraph" },
          renderer: () => null,
        },
        divider: {
          kind: "atomic",
          rootLayout: "normal",
          type: "divider",
          renderer: () => null,
        },
      },
      defaultRoot: "paragraph",
      inlineMarks: [],
      inlineAtoms: [],
    } satisfies ReadEditorDefinition;
    const editor = initializeReadEditor({
      compiledDefinition: compileReadEditorDefinition(definition),
      snapshot: {
        blockGraphVersion: 1,
        blocks: {
          [blockId]: createBlockRecord({
            id: blockId,
            type: "divider",
          }),
        },
        rootBlockIds: [blockId],
        childIdsByParentId: {},
        content: {},
        opaqueContentCheckpoints: {},
      },
    });
    render(<FirstDraftSelectionMenu editor={editor} />);
    expect(screen.queryByLabelText("Text formatting")).toBeNull();
    editor.dispose();
  });
});

function editorFixture(
  options: {
    eligible?: boolean;
    readonly selection?: CommittedSelectionSnapshot;
    readonly readCaretRect?: ReturnType<typeof vi.fn>;
    readonly linkState?: {
      readonly active: boolean;
      readonly mixed: boolean;
      readonly value: Readonly<Record<string, unknown>> | null;
    };
    readonly formatResult?: Readonly<Record<string, unknown>>;
  } = {},
) {
  const blockId = "selection-menu-block" as BlockId;
  const defaultPoint = selectionPoint(blockId, 4, "forward");
  const selection =
    options.selection ?? selectionFixture(defaultPoint, defaultPoint, 7);
  const states: SelectionInlineMarkFormatStates = Object.fromEntries(
    ["strong", "em", "underline", "strikethrough", "code", "link"].map(
      (markName) => [
        markName,
        {
          markName,
          commandId: `test:${markName}`,
          active: false,
          mixed: markName === "em",
          value: null,
          canExecute: true,
          action: "add",
          ranges: [{ blockId, from: 0, to: 4 }],
        },
      ],
    ),
  );
  const resolvedStates: SelectionInlineMarkFormatStates = options.linkState
    ? {
        ...states,
        link: {
          ...states.link!,
          ...options.linkState,
        },
      }
    : states;
  return {
    editable: true,
    selection: {
      getSnapshot: vi.fn(() => ({
        kind: "document",
        revision: 7,
        snapshot: selection,
      })),
      subscribe: vi.fn(() => vi.fn()),
    },
    readCurrentSelectionInlineMarkFormatStates: vi.fn(() =>
      options.eligible === false
        ? { ok: false, reason: "empty-range" }
        : {
            ok: true,
            snapshot: {},
            states: resolvedStates,
            blockIds: [blockId],
          },
    ),
    subscribeBlock: vi.fn(() => vi.fn()),
    formatSelectionInlineMark: vi.fn(
      () => options.formatResult ?? { ok: true, changed: true },
    ),
    geometry: {
      subscribe: vi.fn(() => vi.fn()),
      getRevision: vi.fn(() => 1),
      readViewportTextCaretRect:
        options.readCaretRect ??
        vi.fn(() => ({ left: 100, top: 100, width: 1, height: 18 })),
    },
  } as unknown as EditableEditor & {
    formatSelectionInlineMark: ReturnType<typeof vi.fn>;
    selection: {
      subscribe: ReturnType<typeof vi.fn>;
      getSnapshot: ReturnType<typeof vi.fn>;
    };
    geometry: {
      readViewportTextCaretRect: ReturnType<typeof vi.fn>;
    };
  };
}

function selectionFixture(
  anchor: EditorLogicalSelectionPoint,
  head: EditorLogicalSelectionPoint,
  revision: number,
): CommittedSelectionSnapshot {
  const rangeBlocks = [
    selectionRangeBlock(anchor, head),
    ...(anchor.blockId === head.blockId
      ? []
      : [selectionRangeBlock(head, head)]),
  ];
  const documentSelection = {
    phase: "committed",
    selectionRevision: revision,
    graphRevision: 1,
    lastInvalidationReason: null,
    direction: "forward",
    anchor,
    focus: head,
    normalizedStart: anchor,
    normalizedEnd: head,
    rangeBlocks,
  } satisfies EditorSelectionSnapshot;
  const result = createCommittedSelectionSnapshot({
    kind: "document",
    revision,
    documentSelection,
  });
  if (!result.ok) {
    throw new Error(`invalid selection-menu fixture: ${result.reason}`);
  }
  return result.snapshot;
}

function selectionPoint(
  blockId: BlockId,
  textOffset: number,
  affinity: "forward" | "backward",
): EditorLogicalSelectionPoint {
  return {
    blockId,
    blockType: "paragraph",
    blockCategory: "text",
    textOffset,
    textAnchor: {
      kind: "block-relative-text",
      codec: "test",
      version: 1,
      payload: { encoded: `${blockId}:${textOffset}`, assoc: 0 },
    },
    affinity,
  };
}

function selectionRangeBlock(
  start: EditorLogicalSelectionPoint,
  end: EditorLogicalSelectionPoint,
): EditorSelectionRangeBlock {
  const coverage =
    start.blockId === end.blockId && start.textOffset === end.textOffset
      ? ("none" as const)
      : ("partial" as const);
  return {
    blockId: start.blockId,
    blockType: start.blockType,
    category: "text",
    coverage,
    coverageResult: {
      blockId: start.blockId,
      blockType: start.blockType,
      modelId: "content",
      coverage,
      ...(coverage === "none" ? {} : { paint: { kind: "content" as const } }),
    },
    selectable: true,
    startOffset: start.textOffset,
    endOffset: end.textOffset,
  };
}

function frameQueue() {
  const callbacks: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  return {
    flush() {
      const callback = callbacks.shift();
      if (!callback) throw new Error("Expected a scheduled menu measurement");
      act(() => callback(performance.now()));
    },
  };
}

function domRect(width: number, height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  };
}

function lifecycleEditorFixture() {
  const selectionListeners = new Set<() => void>();
  const blockListeners = new Set<() => void>();
  const selectionSubscriptions: Array<{
    readonly release: ReturnType<typeof vi.fn>;
  }> = [];
  const blockSubscriptions: Array<{
    readonly blockId: BlockId;
    readonly release: ReturnType<typeof vi.fn>;
  }> = [];
  let current: Readonly<Record<string, unknown>> = {
    kind: "none",
    revision: 0,
  };
  let currentBlockId: BlockId | null = null;
  let strongActive = false;
  const markState = (markName: string) => ({
    active: markName === "strong" && strongActive,
    mixed: false,
    value: null,
    canExecute: true,
    action: markName === "strong" && strongActive ? "remove" : "add",
    ranges: currentBlockId ? [{ blockId: currentBlockId, from: 1, to: 4 }] : [],
  });
  const editor = {
    editable: true,
    selection: {
      getSnapshot: vi.fn(() => current),
      subscribe: vi.fn((listener: () => void) => {
        selectionListeners.add(listener);
        const release = vi.fn(() => selectionListeners.delete(listener));
        selectionSubscriptions.push({ release });
        return release;
      }),
    },
    readCurrentSelectionInlineMarkFormatStates: vi.fn(() => ({
      ok: true,
      snapshot: current,
      states: Object.fromEntries(
        ["strong", "em", "underline", "strikethrough", "code", "link"].map(
          (markName) => [markName, markState(markName)],
        ),
      ),
      blockIds: currentBlockId ? [currentBlockId] : [],
    })),
    subscribeBlock: vi.fn((blockId: BlockId, listener: () => void) => {
      blockListeners.add(listener);
      const release = vi.fn(() => blockListeners.delete(listener));
      blockSubscriptions.push({ blockId, release });
      return release;
    }),
    formatSelectionInlineMark: vi.fn(() => ({ ok: true, changed: true })),
    geometry: {
      subscribe: vi.fn(() => vi.fn()),
      getRevision: vi.fn(() => 1),
      readViewportTextCaretRect: vi.fn(() => ({
        left: 100,
        top: 100,
        width: 1,
        height: 18,
      })),
    },
  } as unknown as EditableEditor;

  return {
    editor,
    selectionSubscriptions,
    blockSubscriptions,
    select(blockId: BlockId, revision: number, active: boolean) {
      currentBlockId = blockId;
      strongActive = active;
      current = {
        kind: "document",
        revision,
        snapshot: {
          revision,
          kind: "document",
          owner: { kind: "document" },
          endpoints: {
            head: {
              blockId,
              blockType: "paragraph",
              category: "content",
              textOffset: 4,
              textAnchor: {
                codec: "test",
                payload: { encoded: `${blockId}:4`, assoc: 0 },
              },
              affinity: "forward",
            },
          },
        },
      };
      act(() => {
        for (const listener of [...selectionListeners]) listener();
      });
    },
    activeSelectionListenerCount: () => selectionListeners.size,
    activeBlockListenerCount: () => blockListeners.size,
  };
}
