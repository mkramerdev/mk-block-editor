import type { CSSProperties } from "react";
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DragProvider } from "@mk-drag-and-drop/react";
import type { BlockId } from "@repo/editor-core/kernel";
import type { FirstDraftEditor } from "../first-draft-editor-contracts.ts";
import {
  createFirstDraftBlockActionMenuStore,
  FirstDraftBlockActionMenuProvider,
} from "../block-action-menu/index.ts";
import { FirstDraftBlockControlHoverZone } from "./block-control-hover-zone.tsx";
import {
  FIRST_DRAFT_BLOCK_CONTROL_OFFSETS,
  FirstDraftBlockControls,
} from "./block-controls.tsx";

const blockId = "controls-owner" as BlockId;
const offsetProperty = "--first-draft-block-controls-inset-block-start";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FirstDraftBlockControls", () => {
  it("defines typed heading and toggle-heading insets for every supported level", () => {
    const levels = ["1", "2", "3"];
    expect(Object.keys(FIRST_DRAFT_BLOCK_CONTROL_OFFSETS.heading)).toEqual(levels);
    expect(Object.keys(FIRST_DRAFT_BLOCK_CONTROL_OFFSETS.toggleHeading)).toEqual(
      levels,
    );
  });

  it("renders accessible insertion and draggable handle buttons", () => {
    const { container, getByRole } = renderControls();

    expect(getByRole("button", { name: "Add block below" })).toBeTruthy();
    const grip = container.querySelector<HTMLElement>(
      ".first-draft-block-drag-handle",
    );
    expect(grip?.tagName).toBe("BUTTON");
    expect(grip?.getAttribute("aria-label")).toBe(
      "Drag block or open block actions",
    );
    expect(grip?.getAttribute("aria-haspopup")).toBe("menu");
    expect(grip?.getAttribute("aria-expanded")).toBe("false");
    expect(grip?.hasAttribute("aria-controls")).toBe(false);
    expect(grip?.getAttribute("draggable")).toBe("false");
    expect(grip?.getAttribute("tabindex")).toBe("0");
    expect(grip?.getAttribute("data-first-draft-draggable-block-id")).toBe(
      blockId,
    );
  });

  it("prevents the add button from stealing focus on mousedown", () => {
    const { getByRole } = renderControls();
    const button = getByRole("button", { name: "Add block below" });
    const mouseDown = createEvent.mouseDown(button);
    fireEvent(button, mouseDown);
    expect(mouseDown.defaultPrevented).toBe(true);

  });

  it("toggles the block action session on an ordinary handle click", () => {
    const { container, menuStore } = renderControls();
    const grip = container.querySelector<HTMLButtonElement>(
      ".first-draft-block-drag-handle",
    );
    expect(grip).not.toBeNull();

    fireEvent.click(grip!);
    expect(menuStore.getSnapshot()).toMatchObject({ kind: "open", blockId });
    expect(grip?.getAttribute("aria-expanded")).toBe("true");
    expect(grip?.getAttribute("aria-controls")).toBe(menuStore.menuId);

    fireEvent.click(grip!);
    expect(menuStore.getSnapshot()).toEqual({ kind: "closed" });
  });

  it("exposes the typed block-start custom property", () => {
    const offset: CSSProperties["insetBlockStart"] = "0.75rem";
    const { container } = renderControls(offset);
    const controls = container.querySelector<HTMLElement>(
      "[data-first-draft-block-controls='true']",
    );
    expect(controls?.style.getPropertyValue(offsetProperty)).toBe(offset);
  });

  it("lets only the drag package claim handle pointer activation", () => {
    const { container } = renderControls();
    const grip = container.querySelector<HTMLElement>(
      ".first-draft-block-drag-handle",
    )!;
    const pointerDown = createEvent.pointerDown(grip);
    const mouseDown = createEvent.mouseDown(grip);
    fireEvent(grip, pointerDown);
    fireEvent(grip, mouseDown);
    fireEvent.dragStart(grip);
    fireEvent.click(grip);
    fireEvent.keyDown(grip, { key: "Enter" });
    expect(pointerDown.defaultPrevented).toBe(false);
    expect(mouseDown.defaultPrevented).toBe(false);
  });
});

function renderControls(
  blockStartOffset?: CSSProperties["insetBlockStart"],
) {
  const menuStore = createFirstDraftBlockActionMenuStore();
  return Object.assign(
    render(
      <FirstDraftBlockActionMenuProvider store={menuStore}>
        <DragProvider>
          <FirstDraftBlockControls
            blockId={blockId}
            editor={{} as FirstDraftEditor}
            blockStartOffset={blockStartOffset}
          />
        </DragProvider>
      </FirstDraftBlockActionMenuProvider>,
    ),
    { menuStore },
  );
}

describe("FirstDraftBlockControlHoverZone", () => {
  it("is permanent, empty, non-focusable product UI only while editable", () => {
    const { container, rerender } = render(
      <FirstDraftBlockControlHoverZone blockId={blockId} editable={true} />,
    );
    const zone = container.querySelector<HTMLElement>(
      "[data-first-draft-block-hover-zone-for]",
    );
    expect(zone?.getAttribute("data-first-draft-block-hover-zone-for")).toBe(
      blockId,
    );
    expect(zone?.getAttribute("data-editor-ui")).toBe("true");
    expect(zone?.getAttribute("aria-hidden")).toBe("true");
    expect(zone?.hasAttribute("tabindex")).toBe(false);
    expect(zone?.childNodes).toHaveLength(0);

    rerender(
      <FirstDraftBlockControlHoverZone blockId={blockId} editable={false} />,
    );
    expect(container.childNodes).toHaveLength(0);
  });
});
