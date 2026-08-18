import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFirstDraftSnapshot } from "./first-draft-fixture.ts";
import { createFirstDraftBootstrapFromSnapshot } from "./read-model/bootstrap.ts";
import { encodeFirstDraftMessage } from "./transport/message-protocol.ts";

const probes = vi.hoisted(() => ({
  decode: vi.fn(),
  initialize: vi.fn(),
  events: [] as string[],
  socketSequence: 0,
  remoteOptions: null as null | {
    onAccepted?: (message: Record<string, unknown>) => void;
    onPersistenceFailed?: (message: Record<string, unknown>) => void;
  },
  remoteOptionsHistory: [] as Array<{
    onAccepted?: (message: Record<string, unknown>) => void;
    onPersistenceFailed?: (message: Record<string, unknown>) => void;
  }>,
  presenceOptions: null as null | {
    onParticipants?: (participants: readonly Record<string, unknown>[]) => void;
  },
  presenceOptionsHistory: [] as Array<{
    onParticipants?: (participants: readonly Record<string, unknown>[]) => void;
  }>,
}));

vi.mock("./transport/message-protocol.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./transport/message-protocol.ts")>();
  probes.decode.mockImplementation(actual.decodeFirstDraftMessage);
  return { ...actual, decodeFirstDraftMessage: probes.decode };
});

vi.mock("@repo/editor-web/document-runtime", () => ({
  EditorDocument: ({ editor }: { editor: { testId: string } }) => (
    <div data-testid="editor-document" data-editor-test-id={editor.testId} />
  ),
  toCollaborationSubjectKey: () => null,
}));
vi.mock("@repo/editor-web/editor-definition", () => ({
  compileCanonicalEditorDefinition: () => Object.freeze({}),
}));
vi.mock("@repo/editor-web/editor", () => ({
  initializeEditableEditor: probes.initialize,
}));
vi.mock("@repo/editor-web/block-operations", () => ({
  addEditorBlockOperations: (editor: unknown) => editor,
}));
vi.mock("@repo/editor-web/typing-triggers", () => ({
  useEditorTypingTriggerSession: () => null,
}));
vi.mock("./first-draft-definition.tsx", () => ({
  createFirstDraftEditorDefinition: () => Object.freeze({}),
}));
vi.mock("./blocks/view-state.tsx", () => ({
  createFirstDraftViewStateStore: () => Object.freeze({}),
  FirstDraftViewStateProvider: ({ children }: { children: ReactNode }) =>
    children,
}));
vi.mock("./transport/handle-transaction.ts", () => ({
  handleTransaction: () => vi.fn(),
}));
vi.mock("./transport/finalized-commit-observer.ts", () => ({
  createFirstDraftFinalizedCommitObserver: () => vi.fn(),
}));
vi.mock("./transport/remote-transaction-client.ts", () => ({
  attachFirstDraftRemoteTransactions: (
    _dispatcher: unknown,
    _editor: unknown,
    options: typeof probes.remoteOptions,
  ) => {
    probes.remoteOptions = options;
    if (options) probes.remoteOptionsHistory.push(options);
    return () => probes.events.push("remote:dispose");
  },
}));
vi.mock("./transport/presence-client.ts", () => ({
  attachFirstDraftPresence: (
    _dispatcher: unknown,
    _editor: unknown,
    _session: unknown,
    options: typeof probes.presenceOptions,
  ) => {
    probes.presenceOptions = options;
    if (options) probes.presenceOptionsHistory.push(options);
    return {
      publishCommittedTransactionSelection: vi.fn(),
      dispose: () => probes.events.push("presence:dispose"),
    };
  },
}));
vi.mock("./first-draft-selection-badge-layer.tsx", () => ({
  FirstDraftSelectionBadgeLayer: () => null,
}));
vi.mock("./block-controls/index.ts", () => ({
  FirstDraftBlockHoverProvider: ({ children }: { children: ReactNode }) =>
    children,
  FirstDraftBlockHoverTracker: ({ children }: { children: ReactNode }) =>
    children,
}));

import {
  FirstDraftEditorSurface,
  type FirstDraftCollaborationOptions,
} from "./first-draft-editor-surface.tsx";

type Listener = (event: Event | MessageEvent<unknown>) => void;

class TestWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: TestWebSocket[] = [];

  readonly id = ++probes.socketSequence;
  readonly sent: ArrayBuffer[] = [];
  readonly listeners = new Map<string, Set<Listener>>();
  readonly removedListeners = new Map<string, Set<Listener>>();
  binaryType: BinaryType = "blob";
  readyState = TestWebSocket.CONNECTING;

  constructor(readonly url: string) {
    TestWebSocket.instances.push(this);
    probes.events.push(`socket:${this.id}:construct`);
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
    const removed = this.removedListeners.get(type) ?? new Set();
    removed.add(listener);
    this.removedListeners.set(type, removed);
    if (type === "message")
      probes.events.push(`socket:${this.id}:dispatcher-dispose`);
  }

  send(frame: ArrayBuffer): void {
    this.sent.push(frame);
  }

  close(): void {
    this.readyState = TestWebSocket.CLOSED;
    probes.events.push(`socket:${this.id}:close`);
  }

  open(): void {
    this.readyState = TestWebSocket.OPEN;
    this.emit("open", new Event("open"));
  }

  receive(frame: ArrayBuffer): void {
    this.emit("message", new MessageEvent("message", { data: frame }));
  }

  fail(): void {
    this.emit("error", new Event("error"));
  }

  emitRemoved(type: string, event: Event | MessageEvent<unknown>): void {
    for (const listener of [...(this.removedListeners.get(type) ?? [])])
      listener(event);
  }

  private emit(type: string, event: Event | MessageEvent<unknown>): void {
    for (const listener of [...(this.listeners.get(type) ?? [])])
      listener(event);
  }
}

const first: FirstDraftCollaborationOptions = Object.freeze({
  webSocketUrl: "ws://example.test/first",
  documentId: "document-first",
  actorId: "actor",
  clientId: "client",
  authenticationToken: "token",
});
const second: FirstDraftCollaborationOptions = Object.freeze({
  ...first,
  webSocketUrl: "ws://example.test/second",
  documentId: "document-second",
});

describe("FirstDraftEditorSurface canonical lifecycle", () => {
  afterEach(cleanup);

  beforeEach(() => {
    probes.decode.mockClear();
    probes.initialize.mockReset();
    probes.events.length = 0;
    probes.socketSequence = 0;
    probes.remoteOptions = null;
    probes.remoteOptionsHistory.length = 0;
    probes.presenceOptions = null;
    probes.presenceOptionsHistory.length = 0;
    TestWebSocket.instances = [];
    vi.stubGlobal("WebSocket", TestWebSocket);
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000001",
    );
    probes.initialize.mockImplementation(() => ({
      testId: `editor-${probes.initialize.mock.calls.length}`,
      editable: true,
      undo: vi.fn(),
      redo: vi.fn(),
      replaceTypingTriggerWithInlineContent: vi.fn(),
      dismissTypingTriggerSession: vi.fn(),
      dispose: () => probes.events.push("editor:dispose"),
    }));
  });

  it("constructs one socket, one decoder owner, and tears everything down before refresh", () => {
    const view = render(<FirstDraftEditorSurface collaboration={first} />);
    const socket = TestWebSocket.instances[0]!;
    expect(TestWebSocket.instances).toHaveLength(1);
    expect(socket.listeners.get("message")?.size).toBe(1);

    act(() => socket.open());
    expect(socket.sent).toHaveLength(1);
    act(() => {
      socket.receive(
        encodeFirstDraftMessage({
          type: "first-draft-session-connected",
          actorId: first.actorId,
          clientId: first.clientId,
          sessionId: "00000000-0000-4000-8000-000000000001",
          documentId: first.documentId,
        }),
      );
      socket.receive(
        encodeFirstDraftMessage({
          type: "first-draft-document-loaded",
          documentId: first.documentId,
          revision: 0,
          bootstrap: createFirstDraftBootstrapFromSnapshot({
            documentId: first.documentId,
            revision: 0,
            snapshot: createFirstDraftSnapshot(),
          }),
        }),
      );
      socket.receive(
        encodeFirstDraftMessage({
          type: "first-draft-document-caught-up",
          documentId: first.documentId,
          requestedRevision: 0,
          revision: 0,
        }),
      );
      socket.receive(
        encodeFirstDraftMessage({
          type: "first-draft-participant-snapshot",
          documentId: first.documentId,
          participants: [],
        }),
      );
      socket.receive(
        encodeFirstDraftMessage({
          type: "first-draft-selection-snapshot",
          documentId: first.documentId,
          selections: [],
        }),
      );
    });
    expect(probes.decode).toHaveBeenCalledTimes(5);
    expect(probes.initialize).toHaveBeenCalledOnce();

    view.rerender(<FirstDraftEditorSurface collaboration={second} />);
    expect(TestWebSocket.instances).toHaveLength(2);
    const constructedSecond = probes.events.indexOf("socket:2:construct");
    for (const disposed of [
      "presence:dispose",
      "remote:dispose",
      "editor:dispose",
      "socket:1:dispatcher-dispose",
      "socket:1:close",
    ]) {
      expect(probes.events.indexOf(disposed)).toBeLessThan(constructedSecond);
    }
    expect(socket.listeners.get("message")?.size).toBe(0);
    expect(TestWebSocket.instances[1]!.listeners.get("message")?.size).toBe(1);
    view.unmount();
  });

  it("constructs no editor when realtime decoding fails", () => {
    const view = render(<FirstDraftEditorSurface collaboration={first} />);
    const socket = TestWebSocket.instances[0]!;
    act(() => socket.receive(new ArrayBuffer(3)));
    expect(probes.decode).toHaveBeenCalledOnce();
    expect(probes.initialize).not.toHaveBeenCalled();
    expect(view.queryByTestId("editor-document")).toBeNull();
    view.unmount();
  });

  it("emits one DOM mount observation per real editor mount across ordinary rerenders", () => {
    const observations = vi.fn();
    const view = render(
      <FirstDraftEditorSurface
        collaboration={first}
        onLifecycleObservation={observations}
      />,
    );
    const socket = TestWebSocket.instances[0]!;
    deliverDocument(socket, first);
    expect(mountObservationCount(observations)).toBe(1);

    act(() => {
      socket.receive(
        encodeFirstDraftMessage({
          type: "first-draft-document-caught-up",
          documentId: first.documentId,
          requestedRevision: 0,
          revision: 0,
        }),
      );
    });
    expect(mountObservationCount(observations)).toBe(1);

    act(() => {
      probes.presenceOptions?.onParticipants?.([
        participantFor(first.documentId),
      ]);
    });
    expect(mountObservationCount(observations)).toBe(1);

    act(() => {
      probes.remoteOptions?.onAccepted?.({
        transactionId: "accepted-a",
        baseRevision: 0,
        revision: 1,
      });
    });
    expect(mountObservationCount(observations)).toBe(1);

    view.rerender(
      <FirstDraftEditorSurface
        collaboration={second}
        onLifecycleObservation={observations}
      />,
    );
    deliverDocument(TestWebSocket.instances[1]!, second);
    expect(mountObservationCount(observations)).toBe(2);
    view.unmount();
  });

  it("resets all connection UI state for A to B and rejects late A events", () => {
    const view = render(<FirstDraftEditorSurface collaboration={first} />);
    const socketA = TestWebSocket.instances[0]!;
    deliverDocument(socketA, first);
    act(() => {
      socketA.receive(
        encodeFirstDraftMessage({
          type: "first-draft-document-caught-up",
          documentId: first.documentId,
          requestedRevision: 0,
          revision: 0,
        }),
      );
      probes.presenceOptions?.onParticipants?.([
        participantFor(first.documentId),
      ]);
      probes.remoteOptions?.onAccepted?.({
        transactionId: "accepted-a",
        baseRevision: 0,
        revision: 1,
      });
      socketA.fail();
    });
    expect(view.getByTestId("editor-document").dataset.editorTestId).toBe(
      "editor-1",
    );
    expect(view.container.textContent).toContain("accepted-a");
    expect(view.container.textContent).toContain("participant-document-first");
    expect(view.container.textContent).toContain("reported an error");

    const lateMessageListeners = [
      ...(socketA.listeners.get("message") ?? []),
    ];
    view.rerender(<FirstDraftEditorSurface collaboration={second} />);
    expect(view.queryByTestId("editor-document")).toBeNull();
    expect(view.container.textContent).toContain("Collaboration: connecting");
    expect(view.container.textContent).toContain("Remote peers: 0");
    expect(view.container.textContent).not.toContain("accepted-a");
    expect(view.container.textContent).not.toContain(
      "participant-document-first",
    );
    expect(view.container.textContent).not.toContain("reported an error");

    const constructedB = probes.events.indexOf("socket:2:construct");
    for (const disposed of [
      "presence:dispose",
      "remote:dispose",
      "editor:dispose",
      "socket:1:dispatcher-dispose",
      "socket:1:close",
    ]) {
      expect(probes.events.indexOf(disposed)).toBeLessThan(constructedB);
    }

    const lateFrame = new MessageEvent("message", {
      data: encodeFirstDraftMessage({
        type: "first-draft-document-loaded",
        documentId: first.documentId,
        revision: 2,
        bootstrap: createFirstDraftBootstrapFromSnapshot({
          documentId: first.documentId,
          revision: 2,
          snapshot: createFirstDraftSnapshot(),
        }),
      }),
    });
    act(() => {
      for (const listener of lateMessageListeners) listener(lateFrame);
      socketA.emitRemoved("close", new Event("close"));
      socketA.emitRemoved("error", new Event("error"));
    });
    expect(view.queryByTestId("editor-document")).toBeNull();
    expect(view.container.textContent).toContain("Collaboration: connecting");

    deliverDocument(TestWebSocket.instances[1]!, second);
    expect(view.getByTestId("editor-document").dataset.editorTestId).toBe(
      "editor-2",
    );
    expect(view.container.textContent).not.toContain("document-first");
    view.unmount();
  });

  it("owns clean A to null and null to B transitions", () => {
    const view = render(<FirstDraftEditorSurface collaboration={first} />);
    deliverDocument(TestWebSocket.instances[0]!, first);
    act(() => {
      probes.presenceOptions?.onParticipants?.([
        participantFor(first.documentId),
      ]);
    });

    view.rerender(<FirstDraftEditorSurface collaboration={null} />);
    expect(view.queryByTestId("editor-document")).toBeNull();
    expect(view.container.textContent).toContain("Collaboration: closed");
    expect(view.container.textContent).toContain("Remote peers: 0");
    expect(view.container.textContent).not.toContain(
      "participant-document-first",
    );
    expect(TestWebSocket.instances).toHaveLength(1);

    view.rerender(<FirstDraftEditorSurface collaboration={second} />);
    expect(TestWebSocket.instances).toHaveLength(2);
    expect(view.container.textContent).toContain("Collaboration: connecting");
    expect(view.queryByTestId("editor-document")).toBeNull();
    deliverDocument(TestWebSocket.instances[1]!, second);
    expect(view.getByTestId("editor-document").dataset.editorTestId).toBe(
      "editor-2",
    );
    view.unmount();
  });

  it("does not reconnect for an equivalent collaboration options object", () => {
    const observations = vi.fn();
    const view = render(
      <FirstDraftEditorSurface
        collaboration={first}
        onLifecycleObservation={observations}
      />,
    );
    deliverDocument(TestWebSocket.instances[0]!, first);
    const editor = view.getByTestId("editor-document");

    view.rerender(
      <FirstDraftEditorSurface
        collaboration={{ ...first }}
        onLifecycleObservation={observations}
      />,
    );

    expect(TestWebSocket.instances).toHaveLength(1);
    expect(probes.initialize).toHaveBeenCalledOnce();
    expect(view.getByTestId("editor-document")).toBe(editor);
    expect(mountObservationCount(observations)).toBe(1);
    view.unmount();
  });

  it("rejects every late A1 source after A1 to B to equivalent A2", () => {
    const view = render(<FirstDraftEditorSurface collaboration={first} />);
    const socketA1 = TestWebSocket.instances[0]!;
    deliverDocument(socketA1, first);
    const a1MessageListeners = [...(socketA1.listeners.get("message") ?? [])];
    const a1Presence = probes.presenceOptionsHistory[0]!;
    const a1Remote = probes.remoteOptionsHistory[0]!;

    view.rerender(<FirstDraftEditorSurface collaboration={second} />);
    deliverDocument(TestWebSocket.instances[1]!, second);
    view.rerender(
      <FirstDraftEditorSurface collaboration={{ ...first }} />,
    );
    const socketA2 = TestWebSocket.instances[2]!;
    expect(socketA2).not.toBe(socketA1);
    expect(view.queryByTestId("editor-document")).toBeNull();
    expect(view.container.textContent).toContain("Collaboration: connecting");

    act(() => {
      a1Presence.onParticipants?.([participantFor(first.documentId)]);
      a1Remote.onAccepted?.({
        transactionId: "late-a1-accepted",
        baseRevision: 4,
        revision: 5,
      });
      a1Remote.onPersistenceFailed?.({
        transactionId: "late-a1-persistence",
        reason: "database",
        message: "late persistence failure",
      });
      for (const listener of a1MessageListeners) {
        listener(
          new MessageEvent("message", {
            data: encodeFirstDraftMessage({
              type: "first-draft-document-caught-up",
              documentId: first.documentId,
              requestedRevision: 0,
              revision: 9,
            }),
          }),
        );
      }
      socketA1.emitRemoved("close", new Event("close"));
      socketA1.emitRemoved("error", new Event("error"));
    });
    expect(view.container.textContent).toContain("Collaboration: connecting");
    expect(view.container.textContent).toContain("Remote peers: 0");
    expect(view.container.textContent).not.toContain("late-a1");
    expect(view.container.textContent).not.toContain("participant-document-first");

    deliverDocument(socketA2, first);
    expect(view.getByTestId("editor-document").dataset.editorTestId).toBe(
      "editor-3",
    );
    act(() => {
      a1Presence.onParticipants?.([participantFor(first.documentId)]);
      a1Remote.onAccepted?.({
        transactionId: "late-a1-after-a2",
        baseRevision: 9,
        revision: 10,
      });
      socketA1.emitRemoved("close", new Event("close"));
      socketA1.emitRemoved("error", new Event("error"));
    });
    expect(view.getByTestId("editor-document").dataset.editorTestId).toBe(
      "editor-3",
    );
    expect(view.container.textContent).not.toContain("late-a1");
    expect(view.container.textContent).toContain("Remote peers: 0");
    view.unmount();
  });
});

function deliverDocument(
  socket: TestWebSocket,
  collaboration: FirstDraftCollaborationOptions,
): void {
  act(() => {
    socket.receive(
      encodeFirstDraftMessage({
        type: "first-draft-document-loaded",
        documentId: collaboration.documentId,
        revision: 0,
        bootstrap: createFirstDraftBootstrapFromSnapshot({
          documentId: collaboration.documentId,
          revision: 0,
          snapshot: createFirstDraftSnapshot(),
        }),
      }),
    );
  });
}

function mountObservationCount(observations: ReturnType<typeof vi.fn>): number {
  return observations.mock.calls.filter(
    ([observation]) => observation.kind === "editor-dom-mounted",
  ).length;
}

function participantFor(documentId: string) {
  return {
    documentId,
    subject: {
      actorId: "participant",
      clientId: "participant-client",
      sessionId: "participant-session",
    },
    presenceRevision: 1,
    active: true,
    metadata: {
      displayName: `participant-${documentId}`,
      color: "#123456",
    },
  };
}
