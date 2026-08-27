import { act, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFirstDraftSnapshot } from "./first-draft-fixture.ts";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  createFirstDraftBootstrapFromSnapshot,
  serializeFirstDraftBootstrap,
} from "./bootstrap/bootstrap.ts";
import {
  decodeFirstDraftMessage,
  encodeFirstDraftMessage,
} from "./transport/message-protocol.ts";

const probes = vi.hoisted(() => ({ yjsRuntimeCreations: 0 }));

vi.mock("@repo/editor-yjs-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/editor-yjs-dom")>();
  return {
    ...actual,
    createYjsBlockContentRuntime: (
      source: Parameters<typeof actual.createYjsBlockContentRuntime>[0],
    ) => {
      probes.yjsRuntimeCreations += 1;
      return actual.createYjsBlockContentRuntime(source);
    },
  };
});

import {
  FirstDraftEditorSurface,
  type FirstDraftCollaborationOptions,
} from "./first-draft-editor-surface.tsx";

type WebSocketListener = (event: Event | MessageEvent<unknown>) => void;

class HydrationWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: HydrationWebSocket[] = [];
  readonly listeners = new Map<string, Set<WebSocketListener>>();
  readonly sent: ArrayBuffer[] = [];
  binaryType: BinaryType = "blob";
  readyState = HydrationWebSocket.CONNECTING;

  constructor(readonly url: string) {
    HydrationWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: WebSocketListener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: WebSocketListener) {
    this.listeners.get(type)?.delete(listener);
  }

  send(frame: ArrayBuffer) {
    this.sent.push(frame);
  }

  close() {
    this.readyState = HydrationWebSocket.CLOSED;
  }

  open() {
    this.readyState = HydrationWebSocket.OPEN;
    this.emit("open", new Event("open"));
  }

  receive(frame: ArrayBuffer) {
    this.emit("message", new MessageEvent("message", { data: frame }));
  }

  private emit(type: string, event: Event | MessageEvent<unknown>) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

const hydrationCollaboration: FirstDraftCollaborationOptions = {
  webSocketUrl: "ws://example.test/hydration",
  documentId: "first-draft-heading-levels-ssr",
  actorId: "hydration-actor",
  clientId: "hydration-client",
};

const bootstrap = serializeFirstDraftBootstrap(
  createFirstDraftBootstrapFromSnapshot({
    documentId: "first-draft-ssr-document",
    revision: 11,
    snapshot: createFirstDraftSnapshot(),
  }),
);

describe("FirstDraftEditorSurface editable SSR", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
    probes.yjsRuntimeCreations = 0;
    HydrationWebSocket.instances = [];
  });

  it("renders the actual editable First Draft block tree without Yjs, ProseMirror, or contenteditable", () => {
    const browserWindow = window;
    const browserDocument = document;
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("document", undefined);

    const html = renderToString(
      <FirstDraftEditorSurface
        collaboration={null}
        initialBootstrap={bootstrap}
      />,
    );

    vi.stubGlobal("window", browserWindow);
    vi.stubGlobal("document", browserDocument);
    expect(probes.yjsRuntimeCreations).toBe(0);
    expect(html).toContain('aria-label="First Draft editor"');
    expect(html).toContain('data-first-draft-interaction-enabled="false"');
    expect(html).toContain('data-editor-block-type="tabs"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="grid"');
    expect(html).toContain('data-editor-text-projection="true"');
    expect(html).toContain("Welcome to my Block Editor");
    expect(html).not.toContain("data-first-draft-read-only");
    expect(html).not.toContain("contenteditable");
    expect(html).not.toContain("ProseMirror");
    expect(
      html.match(/aria-label="Add paragraph at end of document"/gu),
    ).toHaveLength(1);
    expect(html.match(/aria-label="Add paragraph at end of column"/gu)).toHaveLength(
      2,
    );
    const parsed = browserDocument.createElement("div");
    parsed.innerHTML = html;
    const serverEndSurface = parsed.querySelector(
      '.first-draft-append-paragraph-surface[data-scope="root"][disabled][data-editor-ui="true"]',
    );
    const serverBlockList = parsed.querySelector('[role="list"]');
    const serverRootStartTarget = serverBlockList?.querySelector(
      ':scope > .first-draft-block-drop-target',
    );
    const serverFirstRoot = serverBlockList?.querySelector(
      ':scope > [data-editor-block-shell="true"]',
    );
    expect(serverEndSurface?.parentElement).toBe(
      parsed.querySelector(".editor-web-document"),
    );
    expect(serverBlockList?.contains(serverEndSurface ?? null)).toBe(false);
    expect(serverBlockList?.nextElementSibling).toBe(serverEndSurface);
    expect(serverRootStartTarget).not.toBeNull();
    expect(serverFirstRoot).not.toBeNull();
    expect(
      serverRootStartTarget!.compareDocumentPosition(serverFirstRoot!),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    const columnsGrid = parsed.querySelector<HTMLElement>(
      ".columns-block__grid",
    )!;
    const columnsTracks = columnsGrid.style.getPropertyValue(
      "--columns-block-tracks",
    );
    const directColumnShells = columnsGrid.querySelectorAll(
      ':scope > [data-editor-block-shell="true"][data-editor-block-type="column"]',
    );
    expect(directColumnShells).toHaveLength(2);
    expect(columnsTracks).toBe(
      "minmax(0, 1000000fr) minmax(0, 1000000fr)",
    );
    expect(columnsTracks).not.toBe("none");
    expect(
      columnsGrid.querySelectorAll(
        ":scope > .columns-block__resize-overlay > .columns-block__boundary",
      ),
    ).toHaveLength(1);
    expect(
      columnsGrid.querySelectorAll(
        ":scope > .columns-block__resize-overlay > .columns-block__boundary > .columns-block__divider",
      ),
    ).toHaveLength(1);
    expect(
      parsed.querySelector(
        '[data-editor-block-id="fd-heading-1"] h1[data-block-node="paragraph"]',
      ),
    ).not.toBeNull();
    expect(
      parsed.querySelector(
        '[data-editor-block-id="fd-heading-2"] h2[data-block-node="paragraph"]',
      ),
    ).not.toBeNull();
    expect(
      columnsGrid.querySelector<HTMLElement>(
        ":scope > .columns-block__resize-overlay",
      )?.style.getPropertyValue("--columns-block-tracks"),
    ).toBe(columnsTracks);
    expect(
      [...parsed.querySelectorAll<HTMLElement>(".tabs-block__pane")].map(
        (pane) => pane.hidden,
      ),
    ).toEqual([false, true, true]);
    expect(html.match(/class="first-draft-block-drop-target"/gu)).toHaveLength(
      expectedDropTargetCount(),
    );
  });

  it("server-renders native h1 through h3 text nodes from First Draft metadata", () => {
    const browserWindow = window;
    const browserDocument = document;
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("document", undefined);
    const headingBootstrap = bootstrapWithAllHeadingLevels();

    const html = renderToString(
      <FirstDraftEditorSurface
        collaboration={null}
        initialBootstrap={headingBootstrap}
      />,
    );

    vi.stubGlobal("window", browserWindow);
    vi.stubGlobal("document", browserDocument);
    const parsed = browserDocument.createElement("div");
    parsed.innerHTML = html;
    for (const [blockId, level] of headingLevelFixtures) {
      const shell = parsed.querySelector<HTMLElement>(
        `[data-editor-block-id="${blockId}"]`,
      )!;
      expect(
        shell.querySelector(
          `h${level}[data-block-node="paragraph"][data-editor-heading-level="${level}"]`,
        ),
      ).not.toBeNull();
      expect(shell.querySelector("p[data-block-node]")).toBeNull();
      expect(shell.querySelector(".heading-block__heading")?.getAttribute("role"))
        .toBeNull();
      expect(
        shell.querySelector(".heading-block__heading")?.getAttribute("aria-level"),
      ).toBeNull();
    }
  });

  it("hydrates the identical editable block structure in Strict Mode and preserves server DOM ownership", async () => {
    const browserWindow = window;
    const browserDocument = document;
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("document", undefined);
    const headingBootstrap = bootstrapWithAllHeadingLevels();
    const html = renderToString(
      <FirstDraftEditorSurface
        collaboration={hydrationCollaboration}
        initialBootstrap={headingBootstrap}
      />,
    );
    expect(probes.yjsRuntimeCreations).toBe(0);
    vi.stubGlobal("window", browserWindow);
    vi.stubGlobal("document", browserDocument);
    vi.stubGlobal("WebSocket", HydrationWebSocket);

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    const section = container.querySelector("section.first-draft-example");
    const scroll = container.querySelector(
      ".first-draft-example__document-scroll",
    );
    const tabs = container.querySelector('[data-editor-block-type="tabs"]');
    const pane = container.querySelector('[data-editor-block-type="tabPane"]');
    const projection = container.querySelector(
      '[data-editor-text-projection="true"]',
    );
    const semanticHeadingNodes = [
      ...container.querySelectorAll(
        ".heading-block__heading > [data-editor-text-shell] > [data-editor-text-projection] > :is(h1, h2, h3)",
      ),
    ];
    const headingShells = headingLevelFixtures.map(([blockId]) =>
      container.querySelector<HTMLElement>(
        `[data-editor-block-shell="true"][data-editor-block-id="${blockId}"]`,
      ),
    );
    const headingTextShells = headingShells.map((shell) =>
      shell?.querySelector<HTMLElement>("[data-editor-text-shell='true']"),
    );
    const dropTargets = [
      ...container.querySelectorAll(".first-draft-block-drop-target"),
    ];
    const serverEndSurface = container.querySelector(
      '.first-draft-append-paragraph-surface[data-scope="root"]',
    );
    const columnsGrid = container.querySelector<HTMLElement>(
      ".columns-block__grid",
    )!;
    const columnShells = [
      ...columnsGrid.querySelectorAll<HTMLElement>(
        ':scope > [data-editor-block-shell="true"][data-editor-block-type="column"]',
      ),
    ];
    const serverColumnTracks = columnsGrid.style.getPropertyValue(
      "--columns-block-tracks",
    );
    const tabPanes = [
      ...container.querySelectorAll<HTMLElement>(".tabs-block__pane"),
    ];
    expect(tabPanes.map((candidate) => candidate.hidden)).toEqual([
      false,
      true,
      true,
    ]);
    const serverStructure = blockStructure(container);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let root: ReturnType<typeof hydrateRoot> | null = null;

    await act(async () => {
      root = hydrateRoot(
        container,
        <StrictMode>
          <FirstDraftEditorSurface
            collaboration={hydrationCollaboration}
            initialBootstrap={structuredClone(headingBootstrap)}
          />
        </StrictMode>,
      );
    });

    expect(probes.yjsRuntimeCreations).toBe(2);
    const socket = HydrationWebSocket.instances.at(-1);
    if (!socket) throw new Error("Missing hydration collaboration socket");
    await act(async () => {
      socket.open();
      const decodedConnection = decodeFirstDraftMessage(socket.sent[0]!);
      if (
        !decodedConnection.ok ||
        decodedConnection.message.type !== "connect-first-draft-session"
      ) {
        throw new Error("Hydration socket did not send a connection identity");
      }
      const connection = decodedConnection.message;
      socket.receive(
        encodeFirstDraftMessage({
          type: "first-draft-session-connected",
          actorId: connection.actorId,
          clientId: connection.clientId,
          sessionId: connection.sessionId,
          documentId: connection.documentId,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      socket.receive(
        encodeFirstDraftMessage({
          type: "first-draft-document-caught-up",
          documentId: hydrationCollaboration.documentId,
          requestedRevision: 1,
          revision: 1,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const interactionState = container
      .querySelector("section.first-draft-example")
      ?.getAttribute("data-first-draft-interaction-enabled");
    if (interactionState !== "true") {
      const status = container.querySelector<HTMLElement>(
        "[data-first-draft-collaboration-status]",
      )?.dataset.firstDraftCollaborationStatus;
      throw new Error(
        `Hydrated surface stayed noninteractive (${status ?? "missing"}); sockets=${HydrationWebSocket.instances.length}; sent=${socket.sent.length}; alert=${container.querySelector("[role='alert']")?.textContent ?? "none"}`,
      );
    }
    expect(container.querySelector("section.first-draft-example")).toBe(section);
    expect(
      container.querySelector(".first-draft-example__document-scroll"),
    ).toBe(scroll);
    expect(container.querySelector('[data-editor-block-type="tabs"]')).toBe(
      tabs,
    );
    expect(container.querySelector('[data-editor-block-type="tabPane"]')).toBe(
      pane,
    );
    expect(container.querySelector(".columns-block__grid")).toBe(columnsGrid);
    expect([
      ...columnsGrid.querySelectorAll(
        ':scope > [data-editor-block-shell="true"][data-editor-block-type="column"]',
      ),
    ]).toEqual(columnShells);
    expect(columnsGrid.style.getPropertyValue("--columns-block-tracks")).toBe(
      serverColumnTracks,
    );
    expect(
      container.querySelector('[data-editor-text-projection="true"]'),
    ).toBe(projection);
    expect([
      ...container.querySelectorAll(
        ".heading-block__heading > [data-editor-text-shell] > [data-editor-text-projection] > :is(h1, h2, h3)",
      ),
    ]).toEqual(semanticHeadingNodes);
    expect(
      headingLevelFixtures.map(([blockId]) =>
        container.querySelector(
          `[data-editor-block-shell="true"][data-editor-block-id="${blockId}"]`,
        ),
      ),
    ).toEqual(headingShells);
    expect(
      headingLevelFixtures.map(([blockId]) =>
        container.querySelector(
          `[data-editor-block-id="${blockId}"] [data-editor-text-shell="true"]`,
        ),
      ),
    ).toEqual(headingTextShells);
    expect(
      container.querySelectorAll(
        ".heading-block__heading [data-editor-text-projection] > p[data-block-node]",
      ),
    ).toHaveLength(0);
    expect(blockStructure(container)).toEqual(serverStructure);
    expect(
      container.querySelectorAll(".first-draft-block-drop-target"),
    ).toHaveLength(expectedDropTargetCount());
    expect(
      [...container.querySelectorAll(".first-draft-block-drop-target")],
    ).toEqual(dropTargets);
    expect(
      container.querySelectorAll(
        '.first-draft-append-paragraph-surface[data-scope="root"]',
      ),
    ).toHaveLength(1);
    expect(
      container.querySelector(
        '.first-draft-append-paragraph-surface[data-scope="root"]',
      ),
    ).toBe(serverEndSurface);
    expect(
      container.querySelectorAll(
        '.first-draft-append-paragraph-surface[data-scope="column"]',
      ),
    ).toHaveLength(2);
    expect([
      ...container.querySelectorAll<HTMLElement>(".tabs-block__pane"),
    ]).toEqual(tabPanes);
    expect(tabPanes.map((candidate) => candidate.hidden)).toEqual([
      false,
      true,
      true,
    ]);
    expect(container.querySelector("[contenteditable='true']")).toBeNull();
    expect(container.querySelector(".ProseMirror")).toBeNull();
    expect(
      consoleError.mock.calls.some((call) =>
        call.some((value) =>
          /hydration|did not match|server rendered/iu.test(String(value)),
        ),
      ),
    ).toBe(false);

    const targetId = "fd-heading-2" as BlockId;
    const targetShell = container.querySelector<HTMLElement>(
      `[data-editor-block-id="${targetId}"]`,
    )!;
    const targetTextShell = targetShell.querySelector<HTMLElement>(
      "[data-editor-text-shell='true']",
    )!;
    const targetProjection = targetTextShell.querySelector<HTMLElement>(
      ":scope > [data-editor-text-projection='true']",
    )!;
    const serverH2 = targetProjection.querySelector<HTMLElement>(
      ":scope > h2[data-block-node='paragraph'][data-editor-heading-level='2']",
    )!;
    installPointerCapture(container);
    dispatchHydratedTextClick(container, targetId, 81);
    await act(async () => Promise.resolve());

    const sharedView = targetTextShell.querySelector<HTMLElement>(
      ":scope > [data-editor-text-slot='true'] > .ProseMirror",
    )!;
    expect(sharedView).not.toBeNull();
    expect(targetProjection.hidden).toBe(true);
    expect(targetProjection.getAttribute("aria-hidden")).toBe("true");
    expect(targetProjection.hasAttribute("data-editor-text-root")).toBe(false);
    expect(
      sharedView.querySelector(
        ":scope > h2[data-block-node='paragraph'][data-editor-heading-level='2']",
      ),
    ).not.toBeNull();
    expect(sharedView.querySelector(":scope > p[data-block-node]")).toBeNull();
    expect(container.querySelectorAll(".ProseMirror")).toHaveLength(1);
    expect(container.querySelectorAll("[contenteditable='true']")).toHaveLength(1);
    expect(targetShell).toBe(headingShells[1]);
    expect(targetTextShell).toBe(headingTextShells[1]);

    dispatchHydratedTextClick(
      container,
      "fd-paragraph-byline" as BlockId,
      82,
    );
    await act(async () => Promise.resolve());
    expect(targetProjection.hidden).toBe(false);
    expect(targetProjection.getAttribute("aria-hidden")).toBeNull();
    expect(targetProjection.dataset.editorTextRoot).toBe("true");
    expect(targetProjection.querySelector(":scope > h2")).toBe(serverH2);
    expect(targetTextShell.querySelector(".ProseMirror")).toBeNull();
    expect(container.querySelectorAll(".ProseMirror")).toHaveLength(1);
    expect(container.querySelectorAll("[data-editor-text-shell='true'] .ProseMirror"))
      .toHaveLength(1);
    expect(container.querySelectorAll(
      `[data-editor-block-id="${targetId}"]`,
    )).toHaveLength(1);
    expect(container.querySelectorAll(
      `[data-editor-block-id="${targetId}"] [data-editor-text-shell="true"]`,
    )).toHaveLength(1);
    expect(
      consoleError.mock.calls.some((call) =>
        call.some((value) =>
          /hydration|did not match|server rendered/iu.test(String(value)),
        ),
      ),
    ).toBe(false);

    await act(async () => root?.unmount());
  });
});

function blockStructure(container: Element): readonly string[] {
  return [...container.querySelectorAll<HTMLElement>("[data-editor-block-shell]")].map(
    (element) =>
      `${element.dataset.editorBlockId ?? ""}:${element.dataset.editorBlockType ?? ""}`,
  );
}

function expectedDropTargetCount(): number {
  const snapshot = createFirstDraftSnapshot();
  const childStartTypes = new Set([
    "callout",
    "toggleHeadingBody",
    "toggleListItemBody",
    "column",
    "tabPane",
  ]);
  const variableContentParents = new Set([
    ...childStartTypes,
    "bulletListItem",
    "orderedListItem",
    "checklistItem",
  ]);
  let count = 1;
  for (const block of Object.values(snapshot.blocks)) {
    if (childStartTypes.has(block.type)) count += 1;
    if (block.parentId === null) {
      count += 1;
      continue;
    }
    const parent = snapshot.blocks[block.parentId as BlockId];
    if (parent && variableContentParents.has(parent.type)) count += 1;
  }
  return count;
}

function installPointerCapture(container: HTMLElement): void {
  const list = container.querySelector<HTMLElement>(
    '[data-editor-block-list-root="true"]',
  );
  if (!list) throw new Error("Missing hydrated editor block list");
  Object.defineProperties(list, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  });
}

function dispatchHydratedTextClick(
  container: HTMLElement,
  blockId: BlockId,
  pointerId: number,
): void {
  const shell = container.querySelector<HTMLElement>(
    `[data-editor-block-shell="true"][data-editor-block-id="${blockId}"]`,
  );
  if (!shell) throw new Error(`Missing hydrated block shell ${blockId}`);
  const target = shell.querySelector<HTMLElement>(
    '[data-editor-text-root="true"]',
  );
  if (!target) throw new Error(`Missing hydrated text root ${blockId}`);
  target.getBoundingClientRect = () => ({
    x: 0,
    y: 10,
    top: 10,
    right: 100,
    bottom: 30,
    left: 0,
    width: 100,
    height: 20,
    toJSON: () => ({}),
  });
  const event = (type: "pointerdown" | "pointerup") => {
    const pointer = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    Object.defineProperty(pointer, "pointerId", { value: pointerId });
    return pointer;
  };
  act(() => target.dispatchEvent(event("pointerdown")));
  act(() => target.dispatchEvent(event("pointerup")));
}

const headingLevelFixtures = [
  ["fd-heading-1", 1],
  ["fd-heading-2", 2],
  ["fd-heading-tables", 3],
] as const;

function bootstrapWithAllHeadingLevels() {
  const snapshot = createFirstDraftSnapshot();
  const mutableBlocks = snapshot.blocks as Record<
    BlockId,
    { metadata?: Record<string, unknown> }
  >;
  for (const [blockId, level] of headingLevelFixtures) {
    const block = mutableBlocks[blockId as BlockId];
    if (!block) throw new Error(`Missing SSR heading fixture ${blockId}`);
    block.metadata = { ...block.metadata, level };
  }
  return serializeFirstDraftBootstrap(
    createFirstDraftBootstrapFromSnapshot({
      documentId: "first-draft-heading-levels-ssr",
      revision: 1,
      snapshot,
    }),
  );
}
