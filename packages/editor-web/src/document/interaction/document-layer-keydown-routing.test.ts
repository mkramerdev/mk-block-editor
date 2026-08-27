import { describe, expect, it, vi } from "vitest";
import { routeEditorDocumentKeydown } from "./document-layer-keydown-routing.ts";
import type { BlockId } from "@repo/editor-core/kernel";

describe("document-layer keydown routing", () => {
  it("runs the layer before ordinary input and canonical navigation", () => {
    const calls: string[] = [];
    const event = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    const nativeFocus = {
      kind: "text" as const,
      blockId: "block" as BlockId,
      registeredTarget: document.createElement("div"),
    };
    const resolve = vi.fn(() => nativeFocus);
    const input = vi.fn();
    const canonical = vi.fn();
    routeEditorDocumentKeydown(
      event,
      {
        dispatchKeydown: () => {
          calls.push("layer");
          return "unhandled";
        },
      },
      {
        keydown: (routedEvent, routedFocus) => {
          input(routedEvent, routedFocus);
          calls.push("input");
        },
        beforeinput: vi.fn(),
      },
      resolve,
      (routedEvent, routedFocus) => {
        canonical(routedEvent, routedFocus);
        calls.push("canonical");
      },
    );

    expect(calls).toEqual(["layer", "input", "canonical"]);
    expect(event.defaultPrevented).toBe(false);
    expect(resolve).toHaveBeenCalledOnce();
    expect(input).toHaveBeenCalledWith(event, nativeFocus);
    expect(canonical).toHaveBeenCalledWith(event, nativeFocus);
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
    const resolveNativeFocusTarget = vi.fn(() => null);

    routeEditorDocumentKeydown(
      event,
      { dispatchKeydown: () => "handled" },
      { keydown: input, beforeinput: vi.fn() },
      resolveNativeFocusTarget,
      canonical,
    );

    expect(event.defaultPrevented).toBe(true);
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(input).not.toHaveBeenCalled();
    expect(canonical).not.toHaveBeenCalled();
    expect(resolveNativeFocusTarget).not.toHaveBeenCalled();
    expect(canonicalSelection).toEqual({ blockId: "first", offset: 3 });
  });
});
