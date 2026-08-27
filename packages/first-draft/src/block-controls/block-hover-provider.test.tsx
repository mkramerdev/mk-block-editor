import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  delegateFirstDraftBlockHover,
  FirstDraftBlockHoverProvider,
  useFirstDraftBlockHoverStore,
  useIsHoveredFirstDraftBlock,
  type FirstDraftBlockHoverStore,
} from "./index.ts";

const blockA = "provider-a" as BlockId;
const blockB = "provider-b" as BlockId;
const blockC = "provider-c" as BlockId;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FirstDraftBlockHoverProvider", () => {
  it("renders one ordinary hover boundary and resolves the nearest nested shell", () => {
    const fixture = renderProvider();
    const boundaries = fixture.container.querySelectorAll(
      ".first-draft-block-hover-boundary",
    );

    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]?.tagName).toBe("DIV");
    expect(
      boundaries[0]?.classList.contains("first-draft-example__document-scroll"),
    ).toBe(false);
    expect(
      boundaries[0]?.hasAttribute("data-first-draft-active-drag-group"),
    ).toBe(false);

    fireEvent.pointerMove(screen.getByTestId("nested-content"));
    expect(fixture.store().getHoveredBlockId()).toBe(blockB);
  });

  it("notifies only the previous and next block subscribers", () => {
    const renders = new Map<BlockId, number>();
    const fixture = renderProvider({ renders });
    expect(renderCounts(renders)).toEqual([1, 1, 1]);

    fireEvent.pointerMove(screen.getByTestId("block-a-content"));
    expect(renderCounts(renders)).toEqual([2, 1, 1]);

    fireEvent.pointerMove(screen.getByTestId("nested-content"));
    expect(renderCounts(renders)).toEqual([3, 2, 1]);
    fixture.unmount();
  });

  it("clears outside shells, on pointer leave, window blur, and unmount", () => {
    const fixture = renderProvider();
    const boundary = fixture.container.querySelector(
      ".first-draft-block-hover-boundary",
    )!;
    fireEvent.pointerMove(screen.getByTestId("block-a-content"));
    fireEvent.pointerMove(screen.getByTestId("outside"));
    expect(fixture.store().getHoveredBlockId()).toBeNull();
    fireEvent.pointerMove(screen.getByTestId("block-a-content"));
    fireEvent.pointerLeave(boundary);
    expect(fixture.store().getHoveredBlockId()).toBeNull();
    fireEvent.pointerMove(screen.getByTestId("block-a-content"));
    fireEvent(window, new Event("blur"));
    expect(fixture.store().getHoveredBlockId()).toBeNull();
    fireEvent.pointerMove(screen.getByTestId("block-a-content"));
    const store = fixture.store();
    fixture.unmount();
    expect(store.getHoveredBlockId()).toBeNull();
  });

  it("clears prior hover and ignores pointer movement while disabled", () => {
    let store: FirstDraftBlockHoverStore | null = null;
    const view = render(
      <Fixture enabled capture={(value) => (store = value)} />,
    );
    fireEvent.pointerMove(screen.getByTestId("block-a-content"));
    expect(store!.getHoveredBlockId()).toBe(blockA);

    view.rerender(<Fixture enabled={false} capture={() => undefined} />);
    act(() => undefined);
    expect(store!.getHoveredBlockId()).toBeNull();
    fireEvent.pointerMove(screen.getByTestId("nested-content"));
    expect(store!.getHoveredBlockId()).toBeNull();
  });

  it("preserves wrapper delegation to its semantic owner", () => {
    let store: FirstDraftBlockHoverStore | null = null;
    render(
      <FirstDraftBlockHoverProvider>
        <StoreCapture capture={(value) => (store = value)} />
        <DelegatingWrapper />
      </FirstDraftBlockHoverProvider>,
    );

    fireEvent.pointerMove(screen.getByTestId("delegated-child"));
    expect(store!.getHoveredBlockId()).toBe(blockA);
  });
});

function renderProvider(
  options: { readonly renders?: Map<BlockId, number> } = {},
) {
  let store: FirstDraftBlockHoverStore | null = null;
  const result = render(
    <Fixture
      enabled
      capture={(value) => (store = value)}
      renders={options.renders}
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
  renders,
}: {
  readonly enabled: boolean;
  readonly capture: (store: FirstDraftBlockHoverStore) => void;
  readonly renders?: Map<BlockId, number>;
}) {
  return (
    <FirstDraftBlockHoverProvider enabled={enabled}>
      <StoreCapture capture={capture} />
      {renders ? (
        <>
          <Subscriber blockId={blockA} renders={renders} />
          <Subscriber blockId={blockB} renders={renders} />
          <Subscriber blockId={blockC} renders={renders} />
        </>
      ) : null}
      <div data-editor-block-shell="true" data-editor-block-id={blockA}>
        <span data-testid="block-a-content">A</span>
        <div data-editor-block-shell="true" data-editor-block-id={blockB}>
          <span data-testid="nested-content">B</span>
        </div>
      </div>
      <span data-testid="outside">outside</span>
    </FirstDraftBlockHoverProvider>
  );
}

function Subscriber({
  blockId,
  renders,
}: {
  readonly blockId: BlockId;
  readonly renders: Map<BlockId, number>;
}) {
  renders.set(blockId, (renders.get(blockId) ?? 0) + 1);
  return (
    <output>{useIsHoveredFirstDraftBlock(blockId) ? "hovered" : "idle"}</output>
  );
}

function DelegatingWrapper() {
  const store = useFirstDraftBlockHoverStore();
  return (
    <div
      data-editor-block-shell="true"
      data-editor-block-id={blockA}
      onPointerMove={(event) =>
        delegateFirstDraftBlockHover(
          event,
          new Set([blockB]),
          blockA,
          store.setHoveredBlockId,
        )
      }
    >
      <div data-editor-block-shell="true" data-editor-block-id={blockB}>
        <span data-testid="delegated-child">child</span>
      </div>
    </div>
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

function renderCounts(renders: ReadonlyMap<BlockId, number>): number[] {
  return [blockA, blockB, blockC].map((blockId) => renders.get(blockId) ?? 0);
}
