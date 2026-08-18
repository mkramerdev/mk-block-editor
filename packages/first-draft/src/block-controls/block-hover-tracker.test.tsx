import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PointerEventHandler } from "react";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  FirstDraftBlockChrome,
  FirstDraftBlockHoverProvider,
  FirstDraftBlockHoverTracker,
  useFirstDraftBlockHoverStore,
  type FirstDraftBlockHoverStore,
} from "./index.ts";

const blockA = "tracker-a" as BlockId;
const blockB = "tracker-b" as BlockId;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FirstDraftBlockHoverTracker", () => {
  it("resolves the nearest nested shell", () => {
    const fixture = renderTracker();
    fireEvent.pointerMove(screen.getByTestId("nested-content"));
    expect(fixture.store().getHoveredBlockId()).toBe(blockB);
    expect(controlsFor(fixture.container, blockB)).not.toBeNull();
  });

  it("resolves permanent zones and keeps ownership on mounted controls", () => {
    const fixture = renderTracker();
    const zoneA = zoneFor(fixture.container, blockA);
    fireEvent.pointerMove(zoneA);
    const controlsA = controlsFor(fixture.container, blockA);
    expect(controlsA).not.toBeNull();
    fireEvent.pointerMove(controlsA!);
    expect(fixture.store().getHoveredBlockId()).toBe(blockA);
    expect(
      fixture.container.querySelectorAll(
        "[data-first-draft-block-controls='true']",
      ),
    ).toHaveLength(1);
  });

  it("keeps permanent zone identities while switching the single controls root", () => {
    const fixture = renderTracker();
    const zoneA = zoneFor(fixture.container, blockA);
    const zoneB = zoneFor(fixture.container, blockB);
    fireEvent.pointerMove(zoneA);
    fireEvent.pointerMove(zoneB);
    expect(zoneFor(fixture.container, blockA)).toBe(zoneA);
    expect(zoneFor(fixture.container, blockB)).toBe(zoneB);
    expect(
      fixture.container.querySelectorAll(
        "[data-first-draft-block-controls='true']",
      ),
    ).toHaveLength(1);
    expect(controlsFor(fixture.container, blockB)).not.toBeNull();
  });

  it("clears outside shells, on pointer leave, and on window blur", () => {
    const fixture = renderTracker();
    fireEvent.pointerMove(screen.getByTestId("block-a-content"));
    fireEvent.pointerMove(screen.getByTestId("outside"));
    expect(fixture.store().getHoveredBlockId()).toBeNull();
    fireEvent.pointerMove(screen.getByTestId("block-a-content"));
    fireEvent.pointerLeave(screen.getByTestId("tracker-root"));
    expect(fixture.store().getHoveredBlockId()).toBeNull();
    fireEvent.pointerMove(screen.getByTestId("block-a-content"));
    fireEvent(window, new Event("blur"));
    expect(fixture.store().getHoveredBlockId()).toBeNull();
  });

  it("clears on unmount and preserves consumer pointer handlers", () => {
    const onPointerMove = vi.fn();
    const onPointerLeave = vi.fn();
    const fixture = renderTracker({ onPointerMove, onPointerLeave });
    fireEvent.pointerMove(screen.getByTestId("block-a-content"));
    fireEvent.pointerLeave(screen.getByTestId("tracker-root"));
    expect(onPointerMove).toHaveBeenCalledOnce();
    expect(onPointerLeave).toHaveBeenCalledOnce();
    fireEvent.pointerMove(screen.getByTestId("block-a-content"));
    const store = fixture.store();
    fixture.unmount();
    expect(store.getHoveredBlockId()).toBeNull();
  });

  it("renders no zones or controls while disabled and clears prior hover", () => {
    let store: FirstDraftBlockHoverStore | null = null;
    const view = render(
      <Fixture enabled={true} capture={(value) => (store = value)} />,
    );
    fireEvent.pointerMove(screen.getByTestId("block-a-content"));
    expect(store!.getHoveredBlockId()).toBe(blockA);
    view.rerender(<Fixture enabled={false} capture={() => undefined} />);
    act(() => undefined);
    expect(store!.getHoveredBlockId()).toBeNull();
    expect(
      view.container.querySelector("[data-first-draft-block-hover-zone-for]"),
    ).toBeNull();
    expect(
      view.container.querySelector("[data-first-draft-block-controls]"),
    ).toBeNull();
  });
});

function renderTracker(
  options: {
    readonly onPointerMove?: PointerEventHandler<HTMLDivElement>;
    readonly onPointerLeave?: PointerEventHandler<HTMLDivElement>;
  } = {},
) {
  let store: FirstDraftBlockHoverStore | null = null;
  const result = render(
    <Fixture
      enabled={true}
      capture={(value) => (store = value)}
      {...options}
    />,
  );
  return {
    ...result,
    store: () => {
      if (!store) throw new Error("Hover store was not captured");
      return store;
    },
  };
}

function Fixture({
  enabled,
  capture,
  onPointerMove,
  onPointerLeave,
}: {
  readonly enabled: boolean;
  readonly capture: (store: FirstDraftBlockHoverStore) => void;
  readonly onPointerMove?: PointerEventHandler<HTMLDivElement>;
  readonly onPointerLeave?: PointerEventHandler<HTMLDivElement>;
}) {
  return (
    <FirstDraftBlockHoverProvider enabled={enabled}>
      <StoreCapture capture={capture} />
      <FirstDraftBlockHoverTracker
        data-testid="tracker-root"
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
      >
        <div
          className="editor-web-block"
          data-editor-block-shell="true"
          data-editor-block-id={blockA}
        >
          <Owner blockId={blockA} editable={enabled} />
          <span data-testid="block-a-content">A</span>
          <div
            className="editor-web-block"
            data-editor-block-shell="true"
            data-editor-block-id={blockB}
          >
            <Owner blockId={blockB} editable={enabled} />
            <span data-testid="nested-content">B</span>
          </div>
        </div>
        <span data-testid="outside">outside</span>
      </FirstDraftBlockHoverTracker>
    </FirstDraftBlockHoverProvider>
  );
}

function Owner({
  blockId,
  editable,
}: {
  readonly blockId: BlockId;
  readonly editable: boolean;
}) {
  return (
    <FirstDraftBlockChrome
      blockId={blockId}
      editor={{
        editable,
        insertBlock: vi.fn(() => ({ ok: true, handled: true }) as never),
      }}
    />
  );
}

function StoreCapture({
  capture,
}: {
  readonly capture: (store: FirstDraftBlockHoverStore) => void;
}) {
  capture(useFirstDraftBlockHoverStore());
  return null;
}

function zoneFor(container: ParentNode, blockId: BlockId): HTMLElement {
  const zone = container.querySelector<HTMLElement>(
    `[data-first-draft-block-hover-zone-for="${blockId}"]`,
  );
  if (!zone) throw new Error(`Missing hover zone for ${blockId}`);
  return zone;
}

function controlsFor(
  container: ParentNode,
  blockId: BlockId,
): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    `[data-first-draft-block-controls-for="${blockId}"]`,
  );
}
