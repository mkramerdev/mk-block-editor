import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { asContentVersion, type BlockId } from "@repo/editor-core/kernel";
import type { VersionedBlock } from "@repo/editor-core/document";
import { contentSelection, wholeSelection } from "@repo/editor-core/selection";
import {
  createCommittedSelectionSnapshot,
  type CanonicalLocalSelection,
  type CommittedSelectionSnapshot,
  type EditorLogicalSelectionPoint,
  type EditorSelectionSnapshot,
} from "@repo/editor-react/selection";
import type { AdditionalSelectionRecord } from "../../../runtime/collaboration/contracts.ts";
import type {
  EditorDocumentGeometryReader,
  EditorDocumentRect,
} from "../../geometry/editor-document-geometry.ts";
import {
  SelectionPaintLayer,
  type SelectionPaintEditor,
} from "./selection-paint-layer.tsx";
import { toCollaborationSubjectKey } from "../../../runtime/collaboration/subject.ts";

const blockId = "block-a" as BlockId;

describe("SelectionPaintLayer", () => {
  it("keeps canonical caret revisions current while the truthful paint model remains none", () => {
    let selection = rangeSelection(1, 1, null, 1);
    let invalidate: () => void = () => undefined;
    const noPaint = { kind: "none" as const };
    const editor = {
      editable: false,
      selection: {
        getSnapshot: () => selection,
        subscribe: (listener: () => void) => {
          invalidate = listener;
          return () => undefined;
        },
      },
      selectionPaint: {
        getSnapshot: () => noPaint,
        subscribe: () => () => undefined,
      },
      geometry: geometryReader(),
    } satisfies SelectionPaintEditor;
    const view = render(<SelectionPaintLayer editor={editor} />);

    selection = rangeSelection(2, 2, null, 2);
    act(() => invalidate());

    expect(editor.selection.getSnapshot().revision).toBe(2);
    expect(editor.selectionPaint.getSnapshot()).toBe(noPaint);
    expect(
      view.container.querySelector("[data-editor-selection-paint]"),
    ).toBeNull();
  });

  it("mounts one built-in layer and paints a local canonical range", () => {
    const readTextRangeRects = vi.fn(() => [
      rect(10, 20, 30, 16),
      rect(10, 36, 18, 16),
    ]);
    const view = render(
      <SelectionPaintLayer
        editor={readEditor(rangeSelection(1, 4), {
          readTextRangeRects,
        })}
      />,
    );

    expect(readTextRangeRects).toHaveBeenCalledWith(blockId, {
      from: 1,
      to: 4,
    });
    expect(
      view.container.querySelectorAll("[data-editor-selection-paint-layer]"),
    ).toHaveLength(1);
    expect(
      view.container.querySelectorAll(
        '[data-editor-selection-paint="text-fragment"][data-editor-selection-paint-subject-kind="local"]',
      ),
    ).toHaveLength(2);
    expect(
      view.container.querySelector(
        '[data-editor-selection-paint-band="underlay"] [data-editor-selection-paint-subject-kind="local"]',
      ),
    ).not.toBeNull();
  });

  it("paints an additional caret from logically resolved editor state", () => {
    const readTextCaretRect = vi.fn(() => rect(5, 8, 0, 14));
    const view = render(
      <SelectionPaintLayer
        editor={editableEditor(noneSelection(), [additionalSelection(4, 4)], {
          readTextCaretRect,
        })}
      />,
    );

    expect(readTextCaretRect).toHaveBeenCalledWith(blockId, 4);
    expect(
      view.container.querySelector(
        '[data-editor-selection-paint-band="overlay"] [data-editor-selection-paint="caret"][data-editor-selection-paint-subject-kind="additional"]',
      ),
    ).not.toBeNull();
  });

  it("uses additional caret affinity at a shared soft-wrap offset", () => {
    const readTextCaretRect = vi.fn(() => rect(5, 28, 0, 14));
    render(
      <SelectionPaintLayer
        editor={editableEditor(
          noneSelection(),
          [additionalSelection(4, 4, "backward")],
          { readTextCaretRect },
        )}
      />,
    );

    expect(readTextCaretRect).toHaveBeenCalledWith(blockId, 4, "backward");
  });

  it("updates color-only changes immediately without remounting paint", () => {
    let additional: AdditionalSelectionRecord[] = [
      { ...additionalSelection(1, 4), color: null },
    ];
    let notify: () => void = () => undefined;
    const editor = editableEditor(noneSelection(), additional, {
      readTextRangeRects: () => [rect(10, 20, 30, 16)],
    });
    editor.additionalSelections.subscribe = (listener) => {
      notify = listener;
      return () => undefined;
    };
    editor.additionalSelections.getSnapshot = () => additional;
    const view = render(<SelectionPaintLayer editor={editor} />);
    const readPaint = () =>
      view.container.querySelector<HTMLElement>(
        '[data-editor-selection-paint="text-fragment"][data-editor-selection-paint-subject-kind="additional"]',
      );
    const original = readPaint();
    expect(original?.dataset.editorSelectionPaintColor).toBeUndefined();
    expect(
      original?.style.getPropertyValue("--editor-selection-paint-color"),
    ).toBe("var(--editor-additional-selection-color, Highlight)");

    additional = [{ ...additional[0]!, color: "#123456" }];
    act(() => notify());
    expect(readPaint()).toBe(original);
    expect(readPaint()?.dataset.editorSelectionPaintColor).toBe("#123456");
    expect(
      readPaint()?.style.getPropertyValue("--editor-selection-paint-color"),
    ).toBe("#123456");

    additional = [{ ...additional[0]!, color: "#abcdef" }];
    act(() => notify());
    expect(readPaint()).toBe(original);
    expect(readPaint()?.dataset.editorSelectionPaintColor).toBe("#abcdef");
  });

  it("paints each additional selection with its own participant color", () => {
    const first = {
      ...additionalSelection(2, 2),
      subject: subjectKey("a", "c", "s"),
      color: "#ef4444",
    };
    const second = {
      ...additionalSelection(5, 5),
      subject: subjectKey("b", "d", "t"),
      color: "#22c55e",
    };
    const view = render(
      <SelectionPaintLayer
        editor={editableEditor(noneSelection(), [first, second], {
          readTextCaretRect: (_blockId, offset) => rect(offset, 8, 0, 14),
        })}
      />,
    );

    const carets = [
      ...view.container.querySelectorAll<HTMLElement>(
        '[data-editor-selection-paint="caret"][data-editor-selection-paint-subject-kind="additional"]',
      ),
    ];
    expect(
      carets.map((caret) => caret.dataset.editorSelectionPaintColor),
    ).toEqual(["#ef4444", "#22c55e"]);
    expect(
      carets.map((caret) =>
        caret.style.getPropertyValue("--editor-selection-paint-color"),
      ),
    ).toEqual(["#ef4444", "#22c55e"]);
  });

  it("paints a completely covered empty text block from its editable root box", () => {
    const readTextRootRect = vi.fn(() => rect(4, 8, 90, 22));
    const readTextRangeRects = vi.fn(() => []);
    const view = render(
      <SelectionPaintLayer
        editor={readEditor(completeEmptySelection(), {
          readTextCanonicalLength: () => 0,
          readTextRootRect,
          readTextRangeRects,
        })}
      />,
    );
    expect(readTextRootRect).toHaveBeenCalledWith(blockId);
    expect(readTextRangeRects).not.toHaveBeenCalled();
    expect(
      view.container.querySelector(
        '[data-editor-selection-paint="text-fragment"]',
      ),
    ).not.toBeNull();
  });

  it("paints a collapsed additional block surface as a generic primitive", () => {
    const readBlockSelectionRect = vi.fn(() => rect(6, 9, 40, 20));
    const point = {
      blockId,
      blockType: "divider",
      blockCategory: "object" as const,
      textOffset: 0,
      textAnchor: null,
      affinity: null,
    };
    const record: AdditionalSelectionRecord = {
      subject: subjectKey("a", "c", "s"),
      watermark: 8,
      color: "#123abc",
      active: true,
      stableSelection: null,
      resolution: "resolved",
      resolvedSelection: {
        kind: "document",
        direction: "forward",
        anchor: point,
        focus: point,
        blockIds: [blockId],
        focusTarget: { kind: "block", blockId, target: "surface" },
      },
    };
    const view = render(
      <SelectionPaintLayer
        editor={editableEditor(noneSelection(), [record], {
          readBlockSelectionRect,
        })}
      />,
    );
    expect(readBlockSelectionRect).toHaveBeenCalledWith(blockId, null);
    expect(
      view.container.querySelector(
        '[data-editor-selection-paint-band="overlay"] [data-editor-selection-paint="atomic-surface"][data-editor-selection-paint-subject-kind="additional"]',
      ),
    ).not.toBeNull();
  });

  it("partitions local and additional ranges below foreground primitives", () => {
    const view = render(
      <SelectionPaintLayer
        editor={editableEditor(
          rangeSelection(0, 2),
          [additionalSelection(1, 3)],
          {
            readTextRangeRects: () => [rect(1, 2, 8, 10)],
          },
        )}
      />,
    );
    const underlay = view.container.querySelector(
      '[data-editor-selection-paint-band="underlay"]',
    );
    const overlay = view.container.querySelector(
      '[data-editor-selection-paint-band="overlay"]',
    );
    expect(
      underlay?.querySelectorAll(
        '[data-editor-selection-paint="text-fragment"]',
      ),
    ).toHaveLength(2);
    expect(
      overlay?.querySelector('[data-editor-selection-paint="text-fragment"]'),
    ).toBeNull();
    expect((underlay as HTMLElement).style.pointerEvents).toBe("");
    expect((overlay as HTMLElement).style.pointerEvents).toBe("");
  });

  it("does not paint unresolved or cleared additional selections", () => {
    const records = [
      {
        ...additionalSelection(1, 3),
        resolution: "unresolved",
        resolvedSelection: null,
      },
      {
        ...additionalSelection(1, 3),
        resolution: "cleared",
        resolvedSelection: null,
      },
    ] as readonly AdditionalSelectionRecord[];
    const view = render(
      <SelectionPaintLayer editor={editableEditor(noneSelection(), records)} />,
    );
    expect(
      view.container.querySelector("[data-editor-selection-paint]"),
    ).toBeNull();
  });

  it("remeasures through editor-owned geometry invalidation", () => {
    let invalidate: () => void = () => undefined;
    const unsubscribe = vi.fn();
    const readTextRangeRects = vi.fn(() => [rect(1, 2, 8, 10)]);
    const editor = readEditor(rangeSelection(0, 2), {
      readTextRangeRects,
      subscribe(listener) {
        invalidate = listener;
        return unsubscribe;
      },
    });
    const view = render(<SelectionPaintLayer editor={editor} />);
    expect(readTextRangeRects).toHaveBeenCalledOnce();
    act(() => invalidate());
    expect(readTextRangeRects).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("does not paint a duplicate collapsed local native caret", () => {
    const subscribe = vi.fn(() => () => undefined);
    const readTextCaretRect = vi.fn(() => rect(1, 2, 1, 12));
    const readTextRangeRects = vi.fn(() => [rect(1, 2, 1, 12)]);
    const view = render(
      <SelectionPaintLayer
        editor={readEditor(rangeSelection(3, 3), {
          readTextCaretRect,
          readTextRangeRects,
          subscribe,
        })}
      />,
    );
    expect(readTextCaretRect).not.toHaveBeenCalled();
    expect(readTextRangeRects).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(
      view.container.querySelector("[data-editor-selection-paint]"),
    ).toBeNull();
  });

  it("does not rerender document paint when only the native caret moves", () => {
    let selection = rangeSelection(1, 1);
    let invalidate: () => void = () => undefined;
    const reader = {
      getSnapshot: () => selection,
      subscribe: (listener: () => void) => {
        invalidate = listener;
        return () => undefined;
      },
    };
    const noPaint = { kind: "none" as const };
    const editor = {
      editable: false,
      selection: reader,
      selectionPaint: {
        getSnapshot: () => noPaint,
        subscribe: () => () => undefined,
      },
      geometry: geometryReader(),
    } satisfies SelectionPaintEditor;
    const view = render(<SelectionPaintLayer editor={editor} />);
    const layer = view.container.querySelector(
      "[data-editor-selection-paint-layer]",
    );
    expect(layer).not.toBeNull();

    selection = rangeSelection(2, 2);
    act(() => invalidate());

    expect(
      view.container.querySelector("[data-editor-selection-paint-layer]"),
    ).toBe(layer);
    expect(
      view.container.querySelector("[data-editor-selection-paint]"),
    ).toBeNull();
  });

  it.each(["backward", "forward"] as const)(
    "does not paint a collapsed local caret with %s affinity",
    (affinity) => {
      const readTextCaretRect = vi.fn(() => rect(7, 11, 1, 14));
      const view = render(
        <SelectionPaintLayer
          editor={readEditor(rangeSelection(3, 3, affinity), {
            readTextCaretRect,
          })}
        />,
      );

      expect(readTextCaretRect).not.toHaveBeenCalled();
      expect(
        view.container.querySelector("[data-editor-selection-paint]"),
      ).toBeNull();
    },
  );

  it("never requests or subscribes to additional state in read mode", () => {
    const editor = readEditor(noneSelection());
    Object.defineProperty(editor, "additionalSelections", {
      get() {
        throw new Error("read mode requested additional selections");
      },
    });
    expect(() => render(<SelectionPaintLayer editor={editor} />)).not.toThrow();
  });
});

function readEditor(
  selection: CanonicalLocalSelection,
  geometryOverrides: Partial<EditorDocumentGeometryReader> = {},
): Extract<SelectionPaintEditor, { readonly editable: false }> {
  return {
    editable: false,
    selection: selectionReader(selection),
    selectionPaint: selectionPaintReader(selection),
    geometry: geometryReader(geometryOverrides),
  } satisfies SelectionPaintEditor;
}

function editableEditor(
  selection: CanonicalLocalSelection,
  additional: readonly AdditionalSelectionRecord[],
  geometryOverrides: Partial<EditorDocumentGeometryReader> = {},
): Extract<SelectionPaintEditor, { readonly editable: true }> {
  const resolvedDocumentSelection = additional.find(
    (record) => record.resolvedSelection?.kind === "document",
  )?.resolvedSelection;
  const blockType =
    resolvedDocumentSelection?.kind === "document"
      ? resolvedDocumentSelection.anchor.blockType
      : "paragraph";
  return {
    editable: true,
    selection: selectionReader(selection),
    selectionPaint: selectionPaintReader(selection),
    geometry: geometryReader(geometryOverrides),
    getBlock: (candidate: BlockId) => {
      if (candidate !== blockId) return null;
      return {
        id: blockId,
        type: blockType,
        parentId: null,
        tombstone: null,
        metadataVersion: "selection-paint-metadata",
        contentVersion: asContentVersion("selection-paint-content"),
      } satisfies VersionedBlock;
    },
    getParentId: () => null,
    getRootBlockIds: () => [blockId],
    getChildBlockIds: () => [],
    readBlockSelectionModel: () =>
      blockType === "divider" ? wholeSelection() : contentSelection(),
    additionalSelections: {
      getSnapshot: () => additional,
      subscribe: () => () => undefined,
      getBlockSnapshot: () => additional,
      subscribeBlock: () => () => undefined,
      getBlockInternalSnapshot: () => additional,
      subscribeBlockInternal: () => () => undefined,
    },
  } satisfies SelectionPaintEditor;
}

function selectionReader(selection: CanonicalLocalSelection) {
  return {
    getSnapshot: () => selection,
    subscribe: () => () => undefined,
  };
}

function selectionPaintReader(selection: CanonicalLocalSelection) {
  const endpoints =
    selection.kind === "none" ? null : selection.snapshot.endpoints;
  const isCaret = Boolean(
    endpoints?.anchor?.textAnchor &&
    endpoints.head?.textAnchor &&
    endpoints.anchor.blockId === endpoints.head.blockId &&
    endpoints.anchor.textOffset === endpoints.head.textOffset,
  );
  const snapshot =
    selection.kind === "none" || isCaret
      ? { kind: "none" as const }
      : {
          kind: "range" as const,
          sourceRevision: selection.revision,
          snapshot: selection.snapshot,
        };
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
  };
}

function noneSelection(): CanonicalLocalSelection {
  return { kind: "none", revision: 0 };
}

function rangeSelection(
  from: number,
  to: number,
  affinity: EditorLogicalSelectionPoint["affinity"] = null,
  revision = 1,
): CanonicalLocalSelection {
  const owner = { kind: "document" as const };
  const rangeBlock = textRangeBlock(from, to, owner);
  const documentSelection = {
    phase: "committed",
    selectionRevision: revision,
    graphRevision: 1,
    lastInvalidationReason: null,
    direction: "forward",
    anchor: point(from, affinity),
    focus: point(to, affinity),
    normalizedStart: point(from, affinity),
    normalizedEnd: point(to, affinity),
    rangeBlocks: [rangeBlock],
  } satisfies EditorSelectionSnapshot;
  const committed = createCommittedSelectionSnapshot({
    kind: "document",
    revision,
    documentSelection,
  });
  if (!committed.ok) {
    throw new Error(`invalid range selection fixture: ${committed.reason}`);
  }
  return { kind: "document", revision, snapshot: committed.snapshot };
}

function completeEmptySelection(): CanonicalLocalSelection {
  const owner = { kind: "document" as const };
  const rangeBlock = {
    ...textRangeBlock(0, 0, owner),
    coverage: "complete-content" as const,
    coverageResult: {
      blockId,
      blockType: "paragraph",
      modelId: "content",
      coverage: "complete-content" as const,
      paint: { kind: "content" as const },
    },
  };
  const base = rangeSelection(0, 1);
  if (base.kind === "none") return base;
  return {
    ...base,
    snapshot: {
      ...base.snapshot,
      owner,
      blocks: [rangeBlock],
    } as CommittedSelectionSnapshot,
  };
}

function additionalSelection(
  from: number,
  to: number,
  affinity: EditorLogicalSelectionPoint["affinity"] = null,
): AdditionalSelectionRecord {
  return {
    subject: subjectKey("a", "c", "s"),
    watermark: 7,
    color: "#123abc",
    active: true,
    stableSelection: null,
    resolution: "resolved",
    resolvedSelection: {
      kind: "document",
      direction: "forward",
      anchor: point(from, affinity),
      focus: point(to, affinity),
      blockIds: [blockId],
      focusTarget: { kind: "text", blockId, point: point(to, affinity) },
    },
  };
}

function subjectKey(actorId: string, clientId: string, sessionId: string) {
  const key = toCollaborationSubjectKey({ actorId, clientId, sessionId });
  if (!key) throw new Error("Expected a valid collaboration subject");
  return key;
}

function textRangeBlock(
  from: number,
  to: number,
  owner?: { readonly kind: "document" },
) {
  const coverage = from === to ? ("none" as const) : ("partial" as const);
  return {
    blockId,
    blockType: "paragraph",
    category: "text" as const,
    coverage,
    coverageResult: {
      blockId,
      blockType: "paragraph",
      modelId: "content",
      coverage,
      ...(coverage === "none" ? {} : { paint: { kind: "content" as const } }),
    },
    selectable: true,
    startOffset: from,
    endOffset: to,
    ...(owner ? { owner } : {}),
  };
}

function point(
  offset: number,
  affinity: EditorLogicalSelectionPoint["affinity"] = null,
): EditorLogicalSelectionPoint {
  return {
    blockId,
    blockType: "paragraph",
    blockCategory: "text",
    textOffset: offset,
    textAnchor: {
      kind: "block-relative-text",
      codec: "test",
      version: 1,
      payload: { encoded: "AA==" },
    },
    affinity,
  };
}

function geometryReader(
  overrides: Partial<EditorDocumentGeometryReader> = {},
): EditorDocumentGeometryReader {
  return {
    getRevision: () => 0,
    readBlockShellRect: () => null,
    readBlockSelectionRect: () => null,
    readViewportBlockSelectionRect: () => null,
    readTextCaretRect: () => null,
    readTextRootRect: () => null,
    readViewportTextCaretRect: () => null,
    readTextRangeRects: () => [],
    readTextCanonicalLength: () => 5,
    readTextVisualRowBoundary: () => null,
    moveTextVertically: () => ({ kind: "unavailable", reason: "unavailable" }),
    mapTextToVisualRow: () => ({ kind: "unavailable", reason: "unavailable" }),
    subscribe: () => () => undefined,
    ...overrides,
  };
}

function rect(
  left: number,
  top: number,
  width: number,
  height: number,
): EditorDocumentRect {
  return { left, top, width, height };
}
