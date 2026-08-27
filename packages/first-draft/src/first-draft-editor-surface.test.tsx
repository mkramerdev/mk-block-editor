/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFirstDraftSnapshot } from "./first-draft-fixture.ts";
import {
  createFirstDraftBootstrapFromSnapshot,
  serializeFirstDraftBootstrap,
} from "./bootstrap/bootstrap.ts";
import { encodeFirstDraftMessage } from "./transport/message-protocol.ts";

const probes = vi.hoisted(() => ({
  editors: [] as Array<Record<string, any>>,
  initializeOptions: [] as Array<Record<string, any>>,
  editorDocumentProps: null as Record<string, any> | null,
  remoteOptions: [] as Array<Record<string, any>>,
  presenceAttachments: [] as Array<{
    publishSelection: ReturnType<typeof vi.fn>;
    publishCurrentSelection: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }>,
  outboundPublishers: [] as Array<{
    attachGeneration: ReturnType<typeof vi.fn>;
    generationCaughtUp: ReturnType<typeof vi.fn>;
    markGenerationUnusable: ReturnType<typeof vi.fn>;
    detachGeneration: ReturnType<typeof vi.fn>;
    submitFinalized: ReturnType<typeof vi.fn>;
    flush: ReturnType<typeof vi.fn>;
    beginAtomicOperation: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }>,
  viewStateStores: [] as Array<Record<string, any>>,
  blockActionMenuStores: [] as Array<Record<string, any>>,
  authoritativePaneAvailable: true,
  selectionAnchorResolves: true,
  events: [] as string[],
}));

vi.mock("./blocks/view-state.tsx", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("./blocks/view-state.tsx")
  >();
  return {
    ...actual,
    createFirstDraftViewStateStore: () => {
      const store = actual.createFirstDraftViewStateStore();
      probes.viewStateStores.push(store);
      return store;
    },
  };
});

vi.mock("@repo/editor-web/document-runtime", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    EditorDocument: (props: Record<string, any>) => {
      useSyncExternalStore(
        (listener) =>
          props.editor.contentRuntime.subscribeBlockProjection(
            "canonical-text",
            listener,
          ),
        () =>
          props.editor.contentRuntime.readBlockProjection("canonical-text"),
        () =>
          props.editor.contentRuntime.readBlockProjection("canonical-text"),
      );
      probes.editorDocumentProps = props;
      const documentLayers = props.renderDocumentLayers?.({
        editor: props.editor,
        interactions: {},
      });
      return (
        <div
          className="editor-web-document"
          data-testid="editor-document"
          data-editor-id={props.editor.testId}
        >
          {props.children}
          <div className="editor-web-block-list">
            <div data-testid="tabs-shell">
              <div data-testid="tab-pane-active">
                <span data-testid="canonical-text">Canonical text</span>
              </div>
            </div>
            <div data-editor-document-layer-host="true">
              {documentLayers}
            </div>
          </div>
          {props.trailingContent}
        </div>
      );
    },
    toCollaborationSubjectKey: () => null,
  };
});
vi.mock("@repo/editor-web/editor-definition", () => ({
  compileCanonicalEditorDefinition: () => ({}),
}));
vi.mock("@repo/editor-web/editor", () => ({
  initializeEditableEditor: (options: Record<string, any>) => {
    probes.initializeOptions.push(options);
    const point = {
      blockId: "selection-block",
      blockType: "paragraph",
      blockCategory: "content",
      textOffset: 2,
      textAnchor: {
        kind: "block-relative-text",
        codec: "test",
        version: 1,
        payload: { blockId: "selection-block", offset: 2 },
      },
      affinity: null,
    };
    const selection = {
      kind: "document",
      revision: 3,
      snapshot: {
        revision: 3,
        kind: "document",
        direction: "forward",
        endpoints: {
          anchor: point,
          head: point,
          normalizedStart: point,
          normalizedEnd: point,
        },
        blocks: [],
        documentSelection: {},
        documentProjection: null,
        internal: null,
      },
    };
    const authoritativePaneAvailable = probes.authoritativePaneAvailable;
    const projection = Object.freeze({ text: "Canonical text" });
    const rootBlockIds = Object.freeze(["selection-block"]);
    const selectionBlock = Object.freeze({
      id: "selection-block",
      type: "paragraph",
      parentId: null,
      tombstone: false,
    });
    const tabsBlock = Object.freeze({
      id: "tabs-block",
      type: "tabs",
      parentId: null,
      tombstone: false,
    });
    const paneBlock = Object.freeze({
      id: "pane-two",
      type: "tabPane",
      parentId: "tabs-block",
      tombstone: false,
    });
    const editor = {
      testId: `editor-${probes.editors.length + 1}`,
      rejectedLocal: false,
      destroyed: false,
      editable: true,
      contentRuntime: {
        subscribeBlockProjection: vi.fn(() => {
          if (editor.destroyed)
            throw new Error("Yjs content runtime is destroyed");
          return () => undefined;
        }),
        readBlockProjection: vi.fn(() => {
          if (editor.destroyed)
            throw new Error("Yjs content runtime is destroyed");
          return projection;
        }),
      },
      selection: {
        getSnapshot: vi.fn(() => selection),
        subscribe: vi.fn(() => () => undefined),
      },
      blurEditor: vi.fn(),
      focusText: vi.fn(() => ({ status: "focused" })),
      resolveSelectionTextAnchor: vi.fn(() => ({
        ok: probes.selectionAnchorResolves,
      })),
      transaction: vi.fn((callback: () => void) => {
        callback();
        return { ok: true, changed: false };
      }),
      setTransactionSelection: vi.fn(),
      getBlock: vi.fn((blockId: string) => {
        if (blockId === "selection-block") return selectionBlock;
        if (blockId === "tabs-block") return tabsBlock;
        if (blockId === "pane-two" && authoritativePaneAvailable)
          return paneBlock;
        return null;
      }),
      getRootBlockIds: vi.fn(() => rootBlockIds),
      subscribeRootBlockIds: vi.fn(() => () => undefined),
      subscribeBlock: vi.fn(() => () => undefined),
      readBlockContent: vi.fn(() => null),
      insertBlockAt: vi.fn(() => ({ ok: false })),
      getChildBlockIds: vi.fn((blockId: string) =>
        blockId === "tabs-block" && authoritativePaneAvailable
          ? ["pane-two"]
          : [],
      ),
      undo: vi.fn(),
      redo: vi.fn(),
      dispose: vi.fn(() => {
        editor.destroyed = true;
        probes.events.push(`dispose:${editor.testId}`);
      }),
    };
    probes.editors.push(editor);
    return editor;
  },
}));
vi.mock("@repo/editor-web/block-operations", () => ({
  addEditorBlockOperations: (editor: unknown) => editor,
}));
vi.mock("./first-draft-definition.tsx", () => ({
  createFirstDraftEditorDefinition: () => ({}),
}));
vi.mock("./transport/outbound-publisher.ts", () => ({
  createFirstDraftOutboundPublisher: () => {
    let generation: Record<string, any> | null = null;
    const publisher = {
      attachGeneration: vi.fn((input: Record<string, any>) => {
        generation = input;
      }),
      generationCaughtUp: vi.fn(() => generation?.onRetainedPublished?.(null)),
      markGenerationUnusable: vi.fn(),
      detachGeneration: vi.fn(() => {
        probes.events.push("publisher:detach");
        generation = null;
      }),
      submitFinalized: vi.fn((change: Record<string, any>) => {
        if (!generation) throw new Error("No attached generation");
        generation.socket.send(new ArrayBuffer(0));
        generation.onPublished?.(change.transactionId);
        generation.publishSelection(
          change.selectionAfter ?? { kind: "none" },
          change.transactionId,
        );
      }),
      flush: vi.fn(),
      beginAtomicOperation: vi.fn(() => vi.fn()),
      beforeStandaloneSelectionPublication: vi.fn(),
      acceptLocal: vi.fn(),
      classifyReplay: vi.fn(() => "remote-new"),
      persistenceFailed: vi.fn(),
      remoteApplied: vi.fn(),
      assertResynchronizationSafe: vi.fn(),
      hasUnresolved: vi.fn(() => false),
      getSnapshot: vi.fn(() => ({
        disposed: false,
        attachedGeneration: generation?.generationId ?? null,
        generationCaughtUp: true,
        pendingEntries: 0,
        pendingBytes: 0,
        pendingSourceTransactionIds: [],
        outstanding: [],
        acceptedLocalTransactionIds: [],
        appliedRemoteTransactionIds: [],
        duplicateReplayTransactionIds: [],
        pendingFailure: null,
      })),
      dispose: vi.fn(() => probes.events.push("publisher:dispose")),
    };
    probes.outboundPublishers.push(publisher);
    return publisher;
  },
}));
vi.mock("./transport/remote-transaction-client.ts", () => ({
  attachFirstDraftRemoteTransactions: (
    _dispatcher: unknown,
    _editor: unknown,
    options: Record<string, any>,
  ) => {
    probes.remoteOptions.push(options);
    return () => probes.events.push("remote:dispose");
  },
}));
vi.mock("./transport/presence-client.ts", () => ({
  attachFirstDraftPresence: () => {
    const attachment = {
      publishSelection: vi.fn(),
      publishCurrentSelection: vi.fn(),
      dispose: vi.fn(() => probes.events.push("presence:dispose")),
    };
    probes.presenceAttachments.push(attachment);
    return attachment;
  },
}));
vi.mock("./block-drag-and-drop/index.ts", async () => {
  const { createContext } = await import("react");
  return {
  createFirstDraftBlockPlacementRegistry: () => ({}),
  FirstDraftRootDropTargetRefContext: createContext(() => undefined),
  };
});
vi.mock("./table-drag-and-drop/index.ts", () => ({
  createFirstDraftAutoScrollSessionOwner: () => ({
    startDocumentSelection: vi.fn(),
    updateDocumentSelection: vi.fn(),
    stopDocumentSelection: vi.fn(),
    startDocumentBlock: vi.fn(),
    updateDocumentBlock: vi.fn(),
    stopDocumentBlock: vi.fn(),
    startTableDrag: vi.fn(),
    updateTableDrag: vi.fn(),
    stopTableDrag: vi.fn(),
    stopAll: vi.fn(),
  }),
  createFirstDraftTableDragStore: () => ({
    childOrderProjection: {
      subscribe: () => () => undefined,
      getProjectedChildIds: (_id: string, ids: readonly string[]) => ids,
    },
    getSnapshot: () => ({ session: null }),
    getTableScrollElement: () => null,
    invalidateActiveDrag: vi.fn(),
  }),
}));
vi.mock("./table-action-menu/index.ts", () => ({
  createFirstDraftTableActionMenuStore: () => ({ close: vi.fn() }),
  FirstDraftTableActionMenuProvider: ({ children }: { children: ReactNode }) =>
    children,
  FirstDraftTableActionMenuLayer: () => (
    <div data-testid="table-action-menu-layer" />
  ),
}));
vi.mock("./block-action-menu/index.ts", () => ({
  createFirstDraftBlockActionMenuStore: () => {
    const store = {
      close: vi.fn(),
      closeForDocumentDrag: vi.fn(),
    };
    probes.blockActionMenuStores.push(store);
    return store;
  },
  FirstDraftBlockActionMenuLayer: () => (
    <div data-testid="block-action-menu-layer" />
  ),
}));
vi.mock("./tabs-action-menu/index.ts", () => ({
  createFirstDraftTabsActionUiStore: () => ({
    cancelRename: vi.fn(),
    closeMenu: vi.fn(),
  }),
  FirstDraftTabsActionUiProvider: ({ children }: { children: ReactNode }) =>
    children,
  FirstDraftTabsActionMenuLayer: () => (
    <div data-testid="tabs-action-menu-layer" />
  ),
}));
vi.mock("./block-controls/index.ts", () => ({
  FirstDraftBlockHoverProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="hover-boundary">{children}</div>
  ),
  useFirstDraftEditingControlsEnabled: () =>
    probes.editorDocumentProps?.interactionEnabled ?? false,
}));
vi.mock("./first-draft-selection-badge-layer.tsx", () => ({
  FirstDraftSelectionBadgeLayer: () => null,
}));
vi.mock("./selection-menu/index.ts", () => ({
  FirstDraftSelectionMenu: () => <div data-testid="selection-menu-layer" />,
}));
vi.mock("./slash-menu/index.ts", () => ({
  FirstDraftSlashMenu: () => <div data-testid="slash-menu-layer" />,
}));
vi.mock("./mention-menu/index.ts", () => ({
  FirstDraftMentionMenu: () => <div data-testid="mention-menu-layer" />,
}));
vi.mock("./link-popover/index.ts", () => ({
  FirstDraftLinkPopover: () => <div data-testid="link-popover-layer" />,
}));
vi.mock("./reset-first-draft-document.ts", () => ({
  resetFirstDraftDocument: vi.fn(() => ({
    ok: true,
    previousBlockIds: [],
    fragment: { blocks: [], rootBlockIds: [] },
  })),
}));

import {
  FirstDraftEditorSurface,
  type FirstDraftCollaborationOptions,
} from "./first-draft-editor-surface.tsx";

type Listener = (event: Event | MessageEvent<unknown>) => void;

class TestWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: TestWebSocket[] = [];
  readonly listeners = new Map<string, Set<Listener>>();
  readonly sent: ArrayBuffer[] = [];
  binaryType: BinaryType = "blob";
  readyState = TestWebSocket.CONNECTING;

  constructor(readonly url: string) {
    TestWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  send(frame: ArrayBuffer) {
    this.sent.push(frame);
  }

  close() {
    this.readyState = TestWebSocket.CLOSED;
  }

  open() {
    this.readyState = TestWebSocket.OPEN;
    this.emit("open", new Event("open"));
  }

  receive(frame: ArrayBuffer) {
    this.emit("message", new MessageEvent("message", { data: frame }));
  }

  disconnect() {
    this.readyState = TestWebSocket.CLOSED;
    this.emit("close", new Event("close"));
  }

  private emit(type: string, event: Event | MessageEvent<unknown>) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

const collaboration: FirstDraftCollaborationOptions = {
  webSocketUrl: "ws://example.test/editor",
  documentId: "surface-document",
  actorId: "actor",
  clientId: "client",
};
const bootstrap = serializeFirstDraftBootstrap(
  createFirstDraftBootstrapFromSnapshot({
    documentId: collaboration.documentId,
    revision: 7,
    snapshot: createFirstDraftSnapshot(),
  }),
);

describe("FirstDraftEditorSurface single renderer lifecycle", () => {
  beforeEach(() => {
    probes.editors.length = 0;
    probes.initializeOptions.length = 0;
    probes.editorDocumentProps = null;
    probes.remoteOptions.length = 0;
    probes.presenceAttachments.length = 0;
    probes.outboundPublishers.length = 0;
    probes.viewStateStores.length = 0;
    probes.blockActionMenuStores.length = 0;
    probes.authoritativePaneAvailable = true;
    probes.selectionAnchorResolves = true;
    probes.events.length = 0;
    TestWebSocket.instances = [];
    vi.stubGlobal("WebSocket", TestWebSocket);
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000001",
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the initial content runtime live through Strict Mode effect replay", async () => {
    const view = render(
      <StrictMode>
        <FirstDraftEditorSurface
          collaboration={collaboration}
          initialBootstrap={bootstrap}
        />
      </StrictMode>,
    );
    const retainedEditorId = view.getByTestId("editor-document").dataset
      .editorId;
    const retainedEditor = probes.editors.find(
      (editor) => editor.testId === retainedEditorId,
    )!;

    await act(async () => Promise.resolve());
    expect(retainedEditor.destroyed).toBe(false);
    expect(retainedEditor.dispose).not.toHaveBeenCalled();

    view.unmount();
    await act(async () => Promise.resolve());
    expect(retainedEditor.destroyed).toBe(true);
    expect(retainedEditor.dispose).toHaveBeenCalledTimes(1);
  });

  it("mounts every product menu in its own editor's document-layer host", () => {
    const view = render(
      <>
        <FirstDraftEditorSurface
          collaboration={collaboration}
          initialBootstrap={bootstrap}
        />
        <FirstDraftEditorSurface
          collaboration={collaboration}
          initialBootstrap={bootstrap}
        />
      </>,
    );
    for (const socket of TestWebSocket.instances) {
      confirmSession(socket);
      catchUp(socket, 7);
    }

    const sections = [
      ...view.container.querySelectorAll<HTMLElement>(
        "section.first-draft-example",
      ),
    ];
    expect(sections).toHaveLength(2);
    const layerTestIds = [
      "selection-menu-layer",
      "link-popover-layer",
      "slash-menu-layer",
      "mention-menu-layer",
      "table-action-menu-layer",
      "block-action-menu-layer",
      "tabs-action-menu-layer",
    ];

    for (const section of sections) {
      const hosts = section.querySelectorAll<HTMLElement>(
        '[data-editor-document-layer-host="true"]',
      );
      expect(hosts).toHaveLength(1);
      const host = hosts[0]!;
      expect(host.closest(".first-draft-example")).toBe(section);
      for (const testId of layerTestIds) {
        expect(host.querySelectorAll(`[data-testid="${testId}"]`)).toHaveLength(
          1,
        );
      }
    }
  });

  it("retains one document tree from server-rendered through connecting, catching-up, and live", () => {
    const view = render(
      <FirstDraftEditorSurface
        collaboration={null}
        initialBootstrap={bootstrap}
      />,
    );
    const section = view.container.querySelector("section.first-draft-example")!;
    const scroll = view.container.querySelector(
      ".first-draft-example__document-scroll",
    )!;
    const documentNode = view.getByTestId("editor-document");
    const tabs = view.getByTestId("tabs-shell");
    const pane = view.getByTestId("tab-pane-active");
    const text = view.getByTestId("canonical-text");
    const endSurface = view.getByRole("button", {
      name: "Add paragraph at end of document",
    }) as HTMLButtonElement;
    expect(documentNode.lastElementChild).toBe(endSurface);
    expect(endSurface.disabled).toBe(true);
    expect(section.hasAttribute("inert")).toBe(true);
    expect(probes.editorDocumentProps?.interactionEnabled).toBe(false);
    expect(
      (view.getByRole("button", { name: "Undo" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    view.rerender(
      <FirstDraftEditorSurface
        collaboration={collaboration}
        initialBootstrap={bootstrap}
      />,
    );
    expectStableNodes(view, { section, scroll, documentNode, tabs, pane, text });
    expect(view.container.textContent).toContain("Collaboration: connecting");
    expect(
      view.container
        .querySelector('[data-first-draft-collaboration-status="connecting"]')
        ?.closest('[role="toolbar"]'),
    ).not.toBeNull();
    expect(
      view.container.querySelector("[data-first-draft-last-diagnostic]"),
    ).toBeNull();

    const socket = TestWebSocket.instances[0]!;
    confirmSession(socket);
    expect(view.container.textContent).toContain("Collaboration: catching-up");
    expectStableNodes(view, { section, scroll, documentNode, tabs, pane, text });

    act(() => {
      socket.receive(
        encodeFirstDraftMessage({
          type: "first-draft-document-caught-up",
          documentId: collaboration.documentId,
          requestedRevision: 7,
          revision: 7,
        }),
      );
    });
    expect(view.container.textContent).toContain("Collaboration: live");
    expect(
      view.container
        .querySelector('[data-first-draft-collaboration-status="live"]')
        ?.closest('[role="toolbar"]'),
    ).not.toBeNull();
    expect(section.hasAttribute("inert")).toBe(false);
    expect(probes.editorDocumentProps?.interactionEnabled).toBe(true);
    expect(
      (view.getByRole("button", { name: "Undo" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(endSurface.disabled).toBe(false);
    expectStableNodes(view, { section, scroll, documentNode, tabs, pane, text });
  });

  it("observes and submits each finalized source change exactly once", () => {
    const observations = vi.fn();
    render(
      <FirstDraftEditorSurface
        collaboration={collaboration}
        initialBootstrap={bootstrap}
        onLifecycleObservation={observations}
      />,
    );
    const socket = TestWebSocket.instances[0]!;
    confirmSession(socket);
    catchUp(socket, 7);
    const change = {
      transactionId: "source-transaction",
      selectionAfter: { kind: "none" },
    };

    probes.initializeOptions[0]!.onChange(change);

    expect(probes.outboundPublishers).toHaveLength(1);
    expect(probes.outboundPublishers[0]!.submitFinalized).toHaveBeenCalledOnce();
    expect(probes.outboundPublishers[0]!.submitFinalized).toHaveBeenCalledWith(
      change,
    );
    expect(observations).toHaveBeenCalledWith({
      kind: "canonical-accepted",
      transactionId: "source-transaction",
    });
    expect(observations).toHaveBeenCalledWith({
      kind: "transaction-published",
      transactionId: "source-transaction",
    });
    expect(
      probes.presenceAttachments[0]!.publishSelection,
    ).toHaveBeenCalledOnce();
  });

  it("keeps the editor, scroll, pane visibility, and selection on fatal error", () => {
    const view = render(
      <FirstDraftEditorSurface
        collaboration={collaboration}
        initialBootstrap={bootstrap}
      />,
    );
    const socket = TestWebSocket.instances[0]!;
    confirmSession(socket);
    catchUp(socket, 7);
    const editor = probes.editors[0]!;
    const documentNode = view.getByTestId("editor-document");
    const pane = view.getByTestId("tab-pane-active");
    const scroll = view.container.querySelector<HTMLDivElement>(
      ".first-draft-example__document-scroll",
    )!;
    scroll.scrollTop = 83;
    view.getByRole("button", { name: "Undo" }).focus();
    const selection = editor.selection.getSnapshot();

    act(() => {
      socket.receive(
        encodeFirstDraftMessage({
          type: "first-draft-protocol-error",
          code: "rate-limited",
          message: "rejected mutation",
          fatal: true,
        }),
      );
    });

    expect(view.getByTestId("editor-document")).toBe(documentNode);
    expect(view.getByTestId("tab-pane-active")).toBe(pane);
    expect(view.queryAllByTestId("tab-pane-active")).toHaveLength(1);
    expect(scroll.scrollTop).toBe(83);
    expect(editor.selection.getSnapshot()).toBe(selection);
    expect(editor.blurEditor).toHaveBeenCalled();
    expect(probes.editorDocumentProps?.interactionEnabled).toBe(false);
    expect(
      (view.getByRole("button", { name: "Undo" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (view.getByRole("button", {
        name: "Retry collaboration",
      }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(probes.presenceAttachments[0]!.dispose).toHaveBeenCalled();

    probes.initializeOptions[0]!.onChange({ transactionId: "late-local" });
    expect(
      probes.presenceAttachments[0]!.publishSelection,
    ).not.toHaveBeenCalled();
  });

  it("retries from authoritative state, restores scroll and resolvable selection, and drops the rejected runtime", async () => {
    const view = render(
      <FirstDraftEditorSurface
        collaboration={collaboration}
        initialBootstrap={bootstrap}
      />,
    );
    const firstSocket = TestWebSocket.instances[0]!;
    confirmSession(firstSocket);
    catchUp(firstSocket, 7);
    const firstEditor = probes.editors[0]!;
    probes.viewStateStores[0]!.selectTab("tabs-block", "pane-two");
    firstEditor.rejectedLocal = true;
    const section = view.container.querySelector("section.first-draft-example")!;
    const scroll = view.container.querySelector<HTMLDivElement>(
      ".first-draft-example__document-scroll",
    )!;
    scroll.scrollTop = 137;
    view.getByRole("button", { name: "Undo" }).focus();
    fail(firstSocket);

    fireEvent.click(view.getByRole("button", { name: "Retry collaboration" }));
    expect(TestWebSocket.instances).toHaveLength(2);
    expect(view.container.querySelector("section.first-draft-example")).toBe(section);
    expect(view.container.querySelector(".first-draft-example__document-scroll")).toBe(scroll);
    expect(scroll.scrollTop).toBe(137);
    const retrySocket = TestWebSocket.instances[1]!;
    confirmSession(retrySocket);
    act(() => {
      retrySocket.receive(
        encodeFirstDraftMessage({
          type: "first-draft-document-loaded",
          documentId: collaboration.documentId,
          revision: 7,
          bootstrap: createFirstDraftBootstrapFromSnapshot({
            documentId: collaboration.documentId,
            revision: 7,
            snapshot: createFirstDraftSnapshot(),
          }),
        }),
      );
    });
    expect(probes.editors).toHaveLength(2);
    expect(view.getByTestId("editor-document").dataset.editorId).toBe("editor-2");
    expect(probes.editors[1]!.rejectedLocal).toBe(false);
    expect(scroll.scrollTop).toBe(137);
    expect(probes.editors[1]!.setTransactionSelection).toHaveBeenCalled();
    expect(
      probes.viewStateStores[0]!.getSnapshot().selectedTabs["tabs-block"],
    ).toBe("pane-two");
    catchUp(retrySocket, 7);
    expect(probes.editors[1]!.focusText).toHaveBeenCalledWith(
      "selection-block",
      { offset: 2, preventScroll: true },
    );
    await act(async () => Promise.resolve());
    expect(scroll.scrollTop).toBe(137);
    expect(firstEditor.dispose).toHaveBeenCalled();
    expect(view.container.textContent).toContain("Collaboration: live");
  });

  it("drops selected-tab presentation when authoritative pane identity no longer exists", () => {
    const view = render(
      <FirstDraftEditorSurface
        collaboration={collaboration}
        initialBootstrap={bootstrap}
      />,
    );
    const firstSocket = TestWebSocket.instances[0]!;
    confirmSession(firstSocket);
    catchUp(firstSocket, 7);
    probes.viewStateStores[0]!.selectTab("tabs-block", "pane-two");
    fail(firstSocket);
    fireEvent.click(view.getByRole("button", { name: "Retry collaboration" }));
    probes.authoritativePaneAvailable = false;
    probes.selectionAnchorResolves = false;
    const retrySocket = TestWebSocket.instances[1]!;
    confirmSession(retrySocket);
    act(() => {
      retrySocket.receive(
        encodeFirstDraftMessage({
          type: "first-draft-document-loaded",
          documentId: collaboration.documentId,
          revision: 7,
          bootstrap: createFirstDraftBootstrapFromSnapshot({
            documentId: collaboration.documentId,
            revision: 7,
            snapshot: createFirstDraftSnapshot(),
          }),
        }),
      );
    });
    expect(
      probes.viewStateStores[0]!.getSnapshot().selectedTabs["tabs-block"],
    ).toBeUndefined();
    expect(probes.editors[1]!.setTransactionSelection).not.toHaveBeenCalled();
  });

  it("marks paste and cut as one-shot First Draft atomic operations", async () => {
    const view = render(
      <FirstDraftEditorSurface
        collaboration={collaboration}
        initialBootstrap={bootstrap}
      />,
    );
    const socket = TestWebSocket.instances[0]!;
    confirmSession(socket);
    catchUp(socket, 7);
    const section = view.container.querySelector("section.first-draft-example")!;
    const publisher = probes.outboundPublishers[0]!;

    fireEvent.paste(section);
    fireEvent.cut(section);
    expect(publisher.beginAtomicOperation).toHaveBeenCalledTimes(2);
    const pasteClear = publisher.beginAtomicOperation.mock.results[0]!.value;
    const cutClear = publisher.beginAtomicOperation.mock.results[1]!.value;
    expect(pasteClear).not.toHaveBeenCalled();
    expect(cutClear).not.toHaveBeenCalled();
    await act(async () => Promise.resolve());
    expect(pasteClear).toHaveBeenCalledOnce();
    expect(cutClear).toHaveBeenCalledOnce();
  });

  it("marks composition, dictation, and replacement commits atomic without marking ordinary typing", async () => {
    const view = render(
      <FirstDraftEditorSurface
        collaboration={collaboration}
        initialBootstrap={bootstrap}
      />,
    );
    const socket = TestWebSocket.instances[0]!;
    confirmSession(socket);
    catchUp(socket, 7);
    const section = view.container.querySelector("section.first-draft-example")!;
    const publisher = probes.outboundPublishers[0]!;

    fireEvent.compositionEnd(section, { data: "x" });
    fireEvent.compositionEnd(section, { data: "multiple" });
    section.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        data: "x",
        inputType: "insertFromDictation",
      }),
    );
    section.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        data: "replacement",
        inputType: "insertReplacementText",
      }),
    );
    section.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        data: "ordinary",
        inputType: "insertText",
      }),
    );

    expect(publisher.beginAtomicOperation).toHaveBeenCalledTimes(4);
    const clearMarkers = publisher.beginAtomicOperation.mock.results.map(
      ({ value }) => value,
    );
    await act(async () => Promise.resolve());
    for (const clear of clearMarkers) expect(clear).toHaveBeenCalledOnce();
  });

  it("flushes on hidden-page and pagehide lifecycle boundaries", () => {
    render(
      <FirstDraftEditorSurface
        collaboration={collaboration}
        initialBootstrap={bootstrap}
      />,
    );
    const socket = TestWebSocket.instances[0]!;
    confirmSession(socket);
    catchUp(socket, 7);
    const publisher = probes.outboundPublishers[0]!;
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");

    act(() => document.dispatchEvent(new Event("visibilitychange")));
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(publisher.flush).toHaveBeenCalledWith("visibility-hidden");
    expect(publisher.flush).toHaveBeenCalledWith("pagehide");
  });

  it("detaches and flushes publication before presence, remote ingress, and socket close", async () => {
    const view = render(
      <FirstDraftEditorSurface
        collaboration={collaboration}
        initialBootstrap={bootstrap}
      />,
    );
    const socket = TestWebSocket.instances[0]!;
    confirmSession(socket);
    catchUp(socket, 7);
    const publisher = probes.outboundPublishers[0]!;
    probes.events.length = 0;

    view.unmount();
    expect(publisher.detachGeneration).toHaveBeenCalledWith({
      attemptSend: true,
    });
    expect(probes.events.slice(0, 3)).toEqual([
      "publisher:detach",
      "presence:dispose",
      "remote:dispose",
    ]);
    expect(socket.readyState).toBe(TestWebSocket.CLOSED);
    const flushCalls = publisher.flush.mock.calls.length;
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pagehide"));
    expect(publisher.flush).toHaveBeenCalledTimes(flushCalls);
    await act(async () => Promise.resolve());
    expect(publisher.dispose).toHaveBeenCalledOnce();
  });

  it("retains one document outbox across socket replacement and waits for the new generation", () => {
    const view = render(
      <FirstDraftEditorSurface
        collaboration={collaboration}
        initialBootstrap={bootstrap}
      />,
    );
    const firstSocket = TestWebSocket.instances[0]!;
    confirmSession(firstSocket);
    catchUp(firstSocket, 7);
    const publisher = probes.outboundPublishers[0]!;

    view.rerender(
      <FirstDraftEditorSurface
        collaboration={{ ...collaboration, webSocketUrl: "ws://replacement.test/editor" }}
        initialBootstrap={bootstrap}
      />,
    );
    expect(probes.outboundPublishers).toHaveLength(1);
    expect(publisher.attachGeneration).toHaveBeenCalledTimes(2);
    expect(publisher.detachGeneration).toHaveBeenCalledWith({
      attemptSend: true,
    });
    expect(firstSocket.readyState).toBe(TestWebSocket.CLOSED);
    expect(TestWebSocket.instances[1]!.url).toBe("ws://replacement.test/editor");
    expect(publisher.generationCaughtUp).toHaveBeenCalledTimes(1);
  });

  it("turns a disconnect into an inert stable document with an explicit retry", () => {
    const view = render(
      <FirstDraftEditorSurface
        collaboration={collaboration}
        initialBootstrap={bootstrap}
      />,
    );
    const socket = TestWebSocket.instances[0]!;
    confirmSession(socket);
    catchUp(socket, 7);
    const documentNode = view.getByTestId("editor-document");
    act(() => socket.disconnect());
    expect(view.getByTestId("editor-document")).toBe(documentNode);
    expect(view.container.textContent).toContain("Collaboration: disconnected");
    expect(
      (view.getByRole("button", {
        name: "Retry collaboration",
      }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(probes.editorDocumentProps?.interactionEnabled).toBe(false);
    expect(probes.outboundPublishers[0]!.markGenerationUnusable).toHaveBeenCalled();
    expect(probes.outboundPublishers[0]!.detachGeneration).toHaveBeenCalledWith({
      attemptSend: false,
    });
  });
});

function confirmSession(socket: TestWebSocket): void {
  act(() => socket.open());
  act(() => {
    socket.receive(
      encodeFirstDraftMessage({
        type: "first-draft-session-connected",
        actorId: collaboration.actorId,
        clientId: collaboration.clientId,
        sessionId: "00000000-0000-4000-8000-000000000001",
        documentId: collaboration.documentId,
      }),
    );
  });
}

function catchUp(socket: TestWebSocket, revision: number): void {
  act(() => {
    socket.receive(
      encodeFirstDraftMessage({
        type: "first-draft-document-caught-up",
        documentId: collaboration.documentId,
        requestedRevision: revision,
        revision,
      }),
    );
  });
}

function fail(socket: TestWebSocket): void {
  act(() => {
    socket.receive(
      encodeFirstDraftMessage({
        type: "first-draft-protocol-error",
        code: "rate-limited",
        message: "rejected mutation",
        fatal: true,
      }),
    );
  });
}

function expectStableNodes(
  view: ReturnType<typeof render>,
  expected: Record<string, Element>,
): void {
  expect(view.container.querySelector("section.first-draft-example")).toBe(
    expected.section,
  );
  expect(
    view.container.querySelector(".first-draft-example__document-scroll"),
  ).toBe(expected.scroll);
  expect(view.getByTestId("editor-document")).toBe(expected.documentNode);
  expect(view.getByTestId("tabs-shell")).toBe(expected.tabs);
  expect(view.getByTestId("tab-pane-active")).toBe(expected.pane);
  expect(view.getByTestId("canonical-text")).toBe(expected.text);
}
