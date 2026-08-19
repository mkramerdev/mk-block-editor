import type { CSSProperties } from "react";
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import { FirstDraftBlockControlHoverZone } from "./block-control-hover-zone.tsx";
import type { EditorBlockOperationResult } from "@repo/editor-web/block-operations";
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
  it("defines a typed inset for every normalized heading level", () => {
    expect(Object.keys(FIRST_DRAFT_BLOCK_CONTROL_OFFSETS.heading)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
    ]);
  });

  it("renders the accessible insertion control and inert visible grip", () => {
    const insertBlock = vi.fn(successfulInsertion);
    const { container, getByRole } = render(
      <FirstDraftBlockControls blockId={blockId} editor={{ insertBlock }} />,
    );

    expect(getByRole("button", { name: "Add block below" })).toBeTruthy();
    const grip = container.querySelector<HTMLElement>(
      ".first-draft-block-drag-handle",
    );
    expect(grip?.tagName).toBe("SPAN");
    expect(grip?.getAttribute("aria-hidden")).toBe("true");
    expect(grip?.getAttribute("draggable")).toBe("false");
    expect(grip?.hasAttribute("role")).toBe(false);
    expect(grip?.hasAttribute("tabindex")).toBe(false);
    expect(grip?.hasAttribute("aria-label")).toBe(false);
    expect(grip?.hasAttribute("data-editor-drag-and-drop-handle")).toBe(false);
    expect(
      grip
        ? grip.getAttributeNames().filter((name) => name.startsWith("data-"))
        : [],
    ).toEqual([]);
  });

  it("prevents mousedown focus theft and inserts exactly once on click", () => {
    const insertBlock = vi.fn(successfulInsertion);
    const { getByRole } = render(
      <FirstDraftBlockControls blockId={blockId} editor={{ insertBlock }} />,
    );
    const button = getByRole("button", { name: "Add block below" });
    const mouseDown = createEvent.mouseDown(button);
    fireEvent(button, mouseDown);
    expect(mouseDown.defaultPrevented).toBe(true);

    fireEvent.click(button);
    expect(insertBlock).toHaveBeenCalledOnce();
    expect(insertBlock).toHaveBeenCalledWith({
      blockId,
      blockType: "paragraph",
      selection: true,
    });
  });

  it("stops click only when insertion reports handled", () => {
    const insertBlock = vi.fn(
      () =>
        ({
          ok: false,
          handled: false,
          reason: "invalid-input",
        }) satisfies EditorBlockOperationResult,
    );
    const { getByRole } = render(
      <FirstDraftBlockControls blockId={blockId} editor={{ insertBlock }} />,
    );
    const click = createEvent.click(
      getByRole("button", { name: "Add block below" }),
    );
    fireEvent(getByRole("button", { name: "Add block below" }), click);
    expect(click.defaultPrevented).toBe(false);
  });

  it("exposes the typed block-start custom property", () => {
    const insertBlock = vi.fn(successfulInsertion);
    const offset: CSSProperties["insetBlockStart"] = "0.75rem";
    const { container } = render(
      <FirstDraftBlockControls
        blockId={blockId}
        editor={{ insertBlock }}
        blockStartOffset={offset}
      />,
    );
    const controls = container.querySelector<HTMLElement>(
      "[data-first-draft-block-controls='true']",
    );
    expect(controls?.style.getPropertyValue(offsetProperty)).toBe(offset);
  });

  it("keeps every grip event inert", () => {
    const insertBlock = vi.fn(successfulInsertion);
    const { container } = render(
      <FirstDraftBlockControls blockId={blockId} editor={{ insertBlock }} />,
    );
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
    expect(insertBlock).not.toHaveBeenCalled();
  });
});

function successfulInsertion(): EditorBlockOperationResult {
  return {
    ok: true,
    handled: true,
    transaction: {
      ok: true,
      changed: true,
      transaction: {
        blocks: {},
        rootBlockIds: [],
        childIdsByParentId: {},
        contentOperations: [],
        stagedContent: {},
        selection: { kind: "none" },
        affectedBlockIds: [],
        splitOutputs: {},
      },
      operationResult: { ok: true },
    },
  };
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
