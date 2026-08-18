import { act, render } from "@testing-library/react";
import type { BlockId } from "@repo/editor-core/kernel";
import { toCollaborationSubjectKey, type EditorDocumentRect } from "@repo/editor-web/document-runtime";
import { type AdditionalSelectionRecord, type CollaborationSubject } from "@repo/editor-web/editor";
import { type EditableEditor } from "@repo/editor-web/editor";
import { initializeTestEditableEditor as initializeEditableEditor } from "./test-editor.ts";
import { describe, expect, it, vi } from "vitest";
import { createFirstDraftViewStateStore } from "./blocks/view-state.tsx";
import { createFirstDraftEditorDefinition } from "./first-draft-definition.tsx";
import { createFirstDraftSnapshot } from "./first-draft-fixture.ts";
import { FirstDraftSelectionBadgeLayer } from "./first-draft-selection-badge-layer.tsx";
import type { FirstDraftParticipantPresence } from "./transport/message-protocol.ts";

const firstBlockId = "first-block" as BlockId;
const secondBlockId = "second-block" as BlockId;
const remoteSubject = subject("actor-a", "client-a", "session-a");

describe("FirstDraftSelectionBadgeLayer", () => {
  it("renders a named, exactly colored collapsed-selection badge with stable identity markers", () => {
    const readTextCaretRect = vi.fn(() => rect(20, 30, 1, 16));
    const remoteParticipant = participant(remoteSubject, "Ada", "#123aBc");
    const remoteSelection = {
      ...textRecord(remoteSubject, 4),
      color: remoteParticipant.metadata.color,
    };
    const editor = badgeEditor([remoteSelection], {
      readTextCaretRect,
    });
    const view = render(
      <FirstDraftSelectionBadgeLayer
        editor={editor}
        participants={[remoteParticipant]}
      />,
    );

    expect(readTextCaretRect).toHaveBeenCalledWith(firstBlockId, 4);
    const badge = readBadge(view.container);
    expect(badge.textContent).toBe("Ada");
    expect(badge.style.left).toBe("20px");
    expect(badge.style.top).toBe("30px");
    expect(
      badge.style.getPropertyValue("--first-draft-participant-color"),
    ).toBe("#123aBc");
    expect(badge.dataset.firstDraftSelectionBadge).toBe("Ada");
    expect(badge.dataset.firstDraftSelectionBadgeActor).toBe("actor-a");
    expect(badge.dataset.firstDraftSelectionBadgeClient).toBe("client-a");
    expect(badge.dataset.firstDraftSelectionBadgeSession).toBe("session-a");
    expect(badge.dataset.firstDraftSelectionBadgeBlockId).toBe(firstBlockId);
    expect(badge.dataset.firstDraftSelectionBadgeTargetKind).toBe("text");
    expect(badge.dataset.firstDraftSelectionBadgeColor).toBe("#123aBc");
    expect(badge.dataset.firstDraftSelectionBadgeColor).toBe(
      remoteParticipant.metadata.color,
    );
    expect(badge.dataset.firstDraftSelectionBadgeColor).toBe(
      remoteSelection.color,
    );
  });

  it("measures a remote badge from the remote caret affinity", () => {
    const readTextCaretRect = vi.fn(() => rect(20, 30, 1, 16));
    const editor = badgeEditor(
      [textRecord(remoteSubject, 4, "forward", 4, firstBlockId, "backward")],
      { readTextCaretRect },
    );
    render(
      <FirstDraftSelectionBadgeLayer
        editor={editor}
        participants={[participant(remoteSubject)]}
      />,
    );

    expect(readTextCaretRect).toHaveBeenCalledWith(firstBlockId, 4, "backward");
  });

  it("keeps forward and backward ranges at the endpoint where selection began", () => {
    const readTextCaretRect = vi.fn((_blockId: BlockId, offset: number) =>
      rect(offset, 10, 1, 12),
    );
    const store = selectionStore([textRecord(remoteSubject, 9, "forward", 2)]);
    const editor = badgeEditor(store, { readTextCaretRect });
    const view = render(
      <FirstDraftSelectionBadgeLayer
        editor={editor}
        participants={[participant(remoteSubject)]}
      />,
    );
    expect(readTextCaretRect).toHaveBeenLastCalledWith(firstBlockId, 2);
    expect(readBadge(view.container).style.left).toBe("2px");

    act(() => store.set([textRecord(remoteSubject, 2, "backward", 9)]));
    expect(readTextCaretRect).toHaveBeenLastCalledWith(firstBlockId, 9);
    expect(readBadge(view.container).style.left).toBe("9px");
  });

  it("uses the block-internal decoration target without changing its focus target", () => {
    const readBlockSelectionRect = vi.fn(() => rect(7, 11, 40, 20));
    const editor = badgeEditor([blockRecord(remoteSubject)], {
      readBlockSelectionRect,
    });
    const view = render(
      <FirstDraftSelectionBadgeLayer
        editor={editor}
        participants={[participant(remoteSubject)]}
      />,
    );

    expect(readBlockSelectionRect).toHaveBeenCalledWith(secondBlockId, null);
    expect(
      readBadge(view.container).dataset.firstDraftSelectionBadgeTargetKind,
    ).toBe("block");
  });

  it("remeasures on geometry invalidation and reacts independently to metadata changes", () => {
    let left = 4;
    const geometry = geometryStore(() => rect(left, 8, 1, 14));
    const editor = badgeEditor([textRecord(remoteSubject, 3)], geometry);
    const view = render(
      <FirstDraftSelectionBadgeLayer
        editor={editor}
        participants={[participant(remoteSubject, "Ada", "#123456")]}
      />,
    );
    expect(readBadge(view.container).style.left).toBe("4px");

    left = 44;
    act(() => geometry.invalidate());
    expect(readBadge(view.container).style.left).toBe("44px");

    view.rerender(
      <FirstDraftSelectionBadgeLayer
        editor={editor}
        participants={[participant(remoteSubject, "Grace", "#abcdef")]}
      />,
    );
    const badge = readBadge(view.container);
    expect(badge.textContent).toBe("Grace");
    expect(badge.dataset.firstDraftSelectionBadgeColor).toBe("#abcdef");
    expect(editor.additionalSelections.getSnapshot()).toHaveLength(1);
  });

  it("does not subscribe to geometry without a renderable remote badge", () => {
    const geometry = geometryStore(() => rect(4, 8, 1, 14));
    const editor = badgeEditor([], geometry);

    render(
      <FirstDraftSelectionBadgeLayer editor={editor} participants={[]} />,
    );

    expect(geometry.listenerCount()).toBe(0);
  });

  it("uses actor identity as the defensive missing-name fallback", () => {
    const missingName = participant(remoteSubject) as unknown as {
      subject: CollaborationSubject;
      presenceRevision: number;
      active: boolean;
      metadata: { displayName?: string; color: string };
    };
    delete missingName.metadata.displayName;
    const view = render(
      <FirstDraftSelectionBadgeLayer
        editor={badgeEditor([textRecord(remoteSubject, 0)])}
        participants={[missingName as unknown as FirstDraftParticipantPresence]}
      />,
    );
    expect(readBadge(view.container).textContent).toBe("actor-a");
  });

  it("omits unresolved, cleared, inactive, local, and temporarily unmeasurable selections", () => {
    const store = selectionStore([
      { ...textRecord(remoteSubject, 1), resolution: "unresolved" },
    ]);
    const editor = badgeEditor(store);
    const localSubject = subject("local", "local-client", "local-session");
    const view = render(
      <FirstDraftSelectionBadgeLayer
        editor={editor}
        participants={[participant(remoteSubject)]}
        localSubject={localSubject}
      />,
    );
    expect(
      view.container.querySelectorAll("[data-first-draft-selection-badge]"),
    ).toHaveLength(0);

    act(() =>
      store.set([
        {
          ...textRecord(remoteSubject, 1),
          resolution: "cleared",
          resolvedSelection: null,
        },
      ]),
    );
    expect(
      view.container.querySelectorAll("[data-first-draft-selection-badge]"),
    ).toHaveLength(0);

    act(() => store.set([textRecord(remoteSubject, 1)]));
    const missingGeometry = badgeEditor(store, {
      readTextCaretRect: () => null,
    });
    expect(() =>
      view.rerender(
        <FirstDraftSelectionBadgeLayer
          editor={missingGeometry}
          participants={[participant(remoteSubject)]}
          localSubject={localSubject}
        />,
      ),
    ).not.toThrow();
    expect(
      view.container.querySelectorAll("[data-first-draft-selection-badge]"),
    ).toHaveLength(0);

    view.rerender(
      <FirstDraftSelectionBadgeLayer
        editor={editor}
        participants={[{ ...participant(remoteSubject), active: false }]}
        localSubject={localSubject}
      />,
    );
    expect(
      view.container.querySelectorAll("[data-first-draft-selection-badge]"),
    ).toHaveLength(0);

    act(() => store.set([textRecord(localSubject, 2)]));
    view.rerender(
      <FirstDraftSelectionBadgeLayer
        editor={editor}
        participants={[participant(localSubject)]}
        localSubject={localSubject}
      />,
    );
    expect(
      view.container.querySelectorAll("[data-first-draft-selection-badge]"),
    ).toHaveLength(0);
  });

  it("keeps two sessions for one actor independent and removes only the disconnected session", () => {
    const secondSession = subject("actor-a", "client-b", "session-b");
    const store = selectionStore([
      textRecord(remoteSubject, 1),
      textRecord(secondSession, 2, "forward", 2, secondBlockId),
    ]);
    const editor = badgeEditor(store);
    const participants = [
      participant(remoteSubject, "Ada A", "#123456"),
      participant(secondSession, "Ada B", "#654321"),
    ];
    const view = render(
      <FirstDraftSelectionBadgeLayer
        editor={editor}
        participants={participants}
      />,
    );
    expect(
      view.container.querySelectorAll("[data-first-draft-selection-badge]"),
    ).toHaveLength(2);

    act(() =>
      store.set([textRecord(secondSession, 2, "forward", 2, secondBlockId)]),
    );
    view.rerender(
      <FirstDraftSelectionBadgeLayer
        editor={editor}
        participants={[participants[1]!]}
      />,
    );
    expect(
      view.container.querySelectorAll("[data-first-draft-selection-badge]"),
    ).toHaveLength(1);
    expect(
      readBadge(view.container).dataset.firstDraftSelectionBadgeSession,
    ).toBe("session-b");
  });

  it("does not edit content, publish onChange, or create undo history while rendering and updating", () => {
    const onChange = vi.fn();
    const actualEditor = initializeEditableEditor({
      definition: createFirstDraftEditorDefinition(
        createFirstDraftViewStateStore(),
      ),
      snapshot: createFirstDraftSnapshot(),
      onChange,
    });
    const blockId = "fd-divider" as BlockId;
    const selection = {
      kind: "selection" as const,
      selection: {
        kind: "document" as const,
        direction: "forward" as const,
        anchor: { kind: "block" as const, blockId, surface: "block" as const },
        focus: { kind: "block" as const, blockId, surface: "block" as const },
      },
    };
    actualEditor.setSelections({
      entries: [
        {
          subject: remoteSubject,
          selectionRevision: 1,
          selection,
          color: "#123456",
        },
      ],
    });
    const editor = badgeEditor(actualEditor.additionalSelections, {
      readBlockSelectionRect: () => rect(1, 2, 30, 12),
    });
    const view = render(
      <FirstDraftSelectionBadgeLayer
        editor={editor}
        participants={[participant(remoteSubject)]}
      />,
    );
    act(() =>
      actualEditor.setSelections({
        entries: [
          {
            subject: remoteSubject,
            selectionRevision: 2,
            selection,
            color: "#123456",
          },
        ],
      }),
    );
    expect(readBadge(view.container).style.left).toBe("1px");
    expect(onChange).not.toHaveBeenCalled();
    expect(actualEditor.canUndo).toBe(false);
    expect(actualEditor.undo()).toEqual({ status: "history-empty" });
    actualEditor.dispose();
  });

  it("resolves a backward table range badge to its visual top-left cell without feedback", () => {
    const onChange = vi.fn();
    const actualEditor = initializeEditableEditor({
      definition: createFirstDraftEditorDefinition(
        createFirstDraftViewStateStore(),
      ),
      snapshot: createFirstDraftSnapshot(),
      onChange,
    });
    actualEditor.setSelections({
      entries: [
        {
          subject: remoteSubject,
          selectionRevision: 1,
          color: "#123456",
          selection: {
            kind: "selection",
            selection: {
              kind: "block-internal",
              blockId: "fd-table" as BlockId,
              subsystem: "table.cell-range",
              payload: {
                kind: "cell-range",
                anchorCellId: "fd-table-cell-2-2",
                headCellId: "fd-table-cell-1-1",
              },
            },
          },
        },
      ],
    });
    const resolved =
      actualEditor.additionalSelections.getSnapshot()[0]?.resolvedSelection;
    expect(resolved).toMatchObject({
      kind: "block-internal",
      focusTarget: {
        kind: "block",
        blockId: "fd-table",
        target: "table-grid",
      },
      decorationTarget: {
        kind: "block",
        blockId: "fd-table-cell-1-1",
        target: null,
      },
    });
    const readBlockSelectionRect = vi.fn(() => rect(12, 34, 100, 20));
    const editor = badgeEditor(actualEditor.additionalSelections, {
      readBlockSelectionRect,
    });
    const view = render(
      <FirstDraftSelectionBadgeLayer
        editor={editor}
        participants={[participant(remoteSubject)]}
      />,
    );
    expect(readBlockSelectionRect).toHaveBeenCalledWith(
      "fd-table-cell-1-1",
      null,
    );
    expect(
      readBadge(view.container).dataset.firstDraftSelectionBadgeBlockId,
    ).toBe("fd-table-cell-1-1");
    expect(onChange).not.toHaveBeenCalled();
    expect(actualEditor.canUndo).toBe(false);
    actualEditor.dispose();
  });
});

function badgeEditor(
  records:
    | readonly AdditionalSelectionRecord[]
    | Pick<EditableEditor["additionalSelections"], "getSnapshot" | "subscribe">,
  geometryOverrides: Record<string, unknown> = {},
): EditableEditor {
  const store = Array.isArray(records) ? selectionStore(records) : records;
  return {
    editable: true,
    additionalSelections: store,
    geometry: {
      getRevision: () => 0,
      subscribe: () => () => undefined,
      readTextCaretRect: () => rect(1, 2, 1, 12),
      readBlockSelectionRect: () => null,
      ...geometryOverrides,
    },
  } as unknown as EditableEditor;
}

function selectionStore(initial: readonly AdditionalSelectionRecord[]) {
  let snapshot = Object.freeze([
    ...initial,
  ]) as readonly AdditionalSelectionRecord[];
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next: readonly AdditionalSelectionRecord[]) {
      snapshot = Object.freeze([...next]);
      for (const listener of listeners) listener();
    },
  };
}

function geometryStore(readTextCaretRect: () => EditorDocumentRect | null) {
  let revision = 0;
  const listeners = new Set<() => void>();
  return {
    getRevision: () => revision,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    readTextCaretRect,
    invalidate() {
      revision += 1;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
}

function textRecord(
  value: CollaborationSubject,
  focusOffset: number,
  direction: "forward" | "backward" = "forward",
  anchorOffset = focusOffset,
  blockId = firstBlockId,
  affinity: "backward" | "forward" | null = null,
): AdditionalSelectionRecord {
  const anchor = point(blockId, anchorOffset, affinity);
  const focus = point(blockId, focusOffset, affinity);
  return {
    subject: subjectKey(value),
    watermark: 1,
    color: "#123456",
    active: true,
    stableSelection: null,
    resolution: "resolved",
    resolvedSelection: {
      kind: "document",
      direction,
      anchor,
      focus,
      blockIds: [blockId],
      focusTarget: { kind: "text", blockId, point: focus },
    },
  };
}

function blockRecord(value: CollaborationSubject): AdditionalSelectionRecord {
  return {
    subject: subjectKey(value),
    watermark: 1,
    color: "#123456",
    active: true,
    stableSelection: null,
    resolution: "resolved",
    resolvedSelection: {
      kind: "block-internal",
      blockId: firstBlockId,
      subsystem: "table",
      payload: {},
      focusTarget: {
        kind: "block",
        blockId: firstBlockId,
        target: "table-grid",
      },
      decorationTarget: {
        kind: "block",
        blockId: secondBlockId,
        target: null,
      },
    },
  };
}

function point(
  blockId: BlockId,
  textOffset: number,
  affinity: "backward" | "forward" | null = null,
) {
  return {
    blockId,
    blockType: "paragraph",
    blockCategory: "text" as const,
    textOffset,
    textAnchor: { codec: "test", payload: {} },
    affinity,
  };
}

function participant(
  value: CollaborationSubject,
  displayName = "Ada",
  color = "#123456",
): FirstDraftParticipantPresence {
  return {
    subject: value,
    presenceRevision: 1,
    active: true,
    metadata: { displayName, color },
  };
}

function subject(
  actorId: string,
  clientId: string,
  sessionId: string,
): CollaborationSubject {
  return { actorId, clientId, sessionId };
}

function subjectKey(value: CollaborationSubject) {
  const key = toCollaborationSubjectKey(value);
  if (!key) throw new Error("Invalid test subject");
  return key;
}

function rect(
  left: number,
  top: number,
  width: number,
  height: number,
): EditorDocumentRect {
  return { left, top, width, height };
}

function readBadge(container: HTMLElement): HTMLElement {
  const badge = container.querySelector<HTMLElement>(
    "[data-first-draft-selection-badge]",
  );
  if (!badge) throw new Error("Expected a First Draft selection badge");
  return badge;
}
