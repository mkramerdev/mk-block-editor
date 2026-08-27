import { describe, expect, it } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  editorSelectionBoundsDataAttributes,
  resolveEditorSelectionBoundsElement,
  resolveEditorSelectionBoundsElementResult,
} from "./selection-bounds.ts";

describe("editor selection bounds", () => {
  it("prefers a targetless inner bounds element for the same block over the shell", () => {
    const surface = blockShell("panel-a");
    const scroller = document.createElement("div");
    scroller.className = "product-panel-scroll-shell";
    const inner = document.createElement("div");
    inner.className = "product-panel-content";
    applyDataAttributes(
      inner,
      editorSelectionBoundsDataAttributes("panel-a" as BlockId),
    );
    scroller.append(inner);
    surface.append(scroller);

    expect(
      resolveEditorSelectionBoundsElement(surface, "panel-a" as BlockId),
    ).toBe(inner);
  });

  it("uses the matching named bounds target when one is requested", () => {
    const surface = blockShell("custom-a");
    const preview = document.createElement("div");
    applyDataAttributes(
      preview,
      editorSelectionBoundsDataAttributes("custom-a" as BlockId, {
        target: "preview",
      }),
    );
    const grid = document.createElement("div");
    applyDataAttributes(
      grid,
      editorSelectionBoundsDataAttributes("custom-a" as BlockId, {
        target: "grid",
      }),
    );
    surface.append(preview, grid);

    expect(
      resolveEditorSelectionBoundsElement(surface, "custom-a" as BlockId, {
        target: "grid",
      }),
    ).toBe(grid);
  });

  it("does not fall back to the shell when a requested named bounds target is missing", () => {
    const surface = blockShell("panel-a");
    const preview = document.createElement("div");
    applyDataAttributes(
      preview,
      editorSelectionBoundsDataAttributes("panel-a" as BlockId, {
        target: "preview",
      }),
    );
    surface.append(preview);

    expect(
      resolveEditorSelectionBoundsElement(surface, "panel-a" as BlockId, {
        target: "content",
      }),
    ).toBeNull();
    expect(
      resolveEditorSelectionBoundsElementResult(surface, "panel-a" as BlockId, {
        target: "content",
      }),
    ).toStrictEqual({
      ok: false,
      reason: "missing-target",
      registrationCount: 0,
    });
  });

  it("rejects duplicate named bounds targets instead of choosing one", () => {
    const surface = blockShell("panel-a");
    for (let index = 0; index < 2; index += 1) {
      const grid = document.createElement("div");
      applyDataAttributes(
        grid,
        editorSelectionBoundsDataAttributes("panel-a" as BlockId, {
          target: "preview",
        }),
      );
      surface.append(grid);
    }

    expect(
      resolveEditorSelectionBoundsElementResult(surface, "panel-a" as BlockId, {
        target: "preview",
      }),
    ).toStrictEqual({
      ok: false,
      reason: "duplicate-target",
      registrationCount: 2,
    });
    expect(
      resolveEditorSelectionBoundsElement(surface, "panel-a" as BlockId, {
        target: "preview",
      }),
    ).toBeNull();
  });

  it("does not choose named inner bounds for targetless paint", () => {
    const surface = blockShell("panel-a");
    const preview = document.createElement("div");
    applyDataAttributes(
      preview,
      editorSelectionBoundsDataAttributes("panel-a" as BlockId, {
        target: "preview",
      }),
    );
    surface.append(preview);

    expect(
      resolveEditorSelectionBoundsElement(surface, "panel-a" as BlockId),
    ).toBe(surface);
  });

  it("falls back to the shell when no inner bounds target exists", () => {
    const surface = blockShell("text-a");

    expect(
      resolveEditorSelectionBoundsElement(surface, "text-a" as BlockId),
    ).toBe(surface);
  });

  it("ignores nested child block bounds while resolving a parent block", () => {
    const parent = blockShell("container-a");
    const child = blockShell("panel-a");
    const inner = document.createElement("div");
    applyDataAttributes(
      inner,
      editorSelectionBoundsDataAttributes("panel-a" as BlockId),
    );
    child.append(inner);
    parent.append(child);

    expect(
      resolveEditorSelectionBoundsElement(parent, "container-a" as BlockId),
    ).toBe(parent);
  });
});

function blockShell(blockId: string): HTMLElement {
  const surface = document.createElement("div");
  surface.className = "editor-web-block";
  surface.dataset.editorBlockId = blockId;
  surface.dataset.editorBlockShell = "true";
  applyDataAttributes(
    surface,
    editorSelectionBoundsDataAttributes(blockId as BlockId),
  );
  return surface;
}

function applyDataAttributes(
  element: HTMLElement,
  attributes: Readonly<Record<string, string | undefined>>,
): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined) continue;
    element.setAttribute(name, value);
  }
}
