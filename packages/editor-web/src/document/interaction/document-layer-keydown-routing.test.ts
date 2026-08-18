import { describe, expect, it, vi } from "vitest";
import { routeEditorDocumentKeydown } from "./document-layer-keydown-routing.ts";

describe("document-layer keydown routing", () => {
  it("runs the layer before ordinary input and canonical navigation", () => {
    const calls: string[] = [];
    const event = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    routeEditorDocumentKeydown(
      event,
      {
        dispatchKeydown: () => {
          calls.push("layer");
          return "unhandled";
        },
      },
      { keydown: () => calls.push("input"), beforeinput: vi.fn() },
      () => calls.push("canonical"),
    );

    expect(calls).toEqual(["layer", "input", "canonical"]);
    expect(event.defaultPrevented).toBe(false);
  });

  it("owns browser cancellation and skips every ordinary editor route when handled", () => {
    const input = vi.fn();
    const canonicalSelection = { blockId: "first", offset: 3 };
    const canonical = vi.fn(() => {
      canonicalSelection.blockId = "second";
    });
    const event = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    const stopPropagation = vi.spyOn(event, "stopPropagation");

    routeEditorDocumentKeydown(
      event,
      { dispatchKeydown: () => "handled" },
      { keydown: input, beforeinput: vi.fn() },
      canonical,
    );

    expect(event.defaultPrevented).toBe(true);
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(input).not.toHaveBeenCalled();
    expect(canonical).not.toHaveBeenCalled();
    expect(canonicalSelection).toEqual({ blockId: "first", offset: 3 });
  });
});
