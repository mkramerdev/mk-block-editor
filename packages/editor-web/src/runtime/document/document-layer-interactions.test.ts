import { describe, expect, it, vi } from "vitest";
import { createEditorDocumentLayerInteractionController } from "./document-layer-interactions.ts";
import type { EditorDocumentLayerKeydownHandler } from "./contracts.ts";

describe("EditorDocument layer interactions", () => {
  it("normalizes keydown input and gives the topmost handler LIFO precedence", () => {
    const controller = createEditorDocumentLayerInteractionController();
    const lower = vi.fn<EditorDocumentLayerKeydownHandler>(() => "unhandled");
    const upper = vi.fn<EditorDocumentLayerKeydownHandler>(() => "handled");
    controller.port.registerKeydownHandler(lower);
    controller.port.registerKeydownHandler(upper);

    expect(
      controller.keyboard.dispatchKeydown(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          code: "ArrowDown",
          shiftKey: true,
          repeat: true,
        }),
      ),
    ).toBe("handled");
    expect(upper).toHaveBeenCalledOnce();
    expect(lower).not.toHaveBeenCalled();
    expect(upper.mock.calls[0]?.[0]).toEqual({
      key: "ArrowDown",
      code: "ArrowDown",
      shiftKey: true,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      repeat: true,
      isComposing: false,
    });
    expect(Object.isFrozen(upper.mock.calls[0]?.[0])).toBe(true);
  });

  it("dispatches over a stable snapshot when a handler unregisters", () => {
    const controller = createEditorDocumentLayerInteractionController();
    const lower = vi.fn(() => "unhandled" as const);
    const unregisterLower = controller.port.registerKeydownHandler(lower);
    controller.port.registerKeydownHandler(() => {
      unregisterLower();
      return "unhandled";
    });

    expect(
      controller.keyboard.dispatchKeydown(
        new KeyboardEvent("keydown", { key: "ArrowUp" }),
      ),
    ).toBe("unhandled");
    expect(lower).toHaveBeenCalledOnce();
    controller.keyboard.dispatchKeydown(
      new KeyboardEvent("keydown", { key: "ArrowUp" }),
    );
    expect(lower).toHaveBeenCalledOnce();
  });

  it("isolates registrations and removes them on unsubscribe or disposal", () => {
    const first = createEditorDocumentLayerInteractionController();
    const second = createEditorDocumentLayerInteractionController();
    const firstHandler = vi.fn(() => "handled" as const);
    const secondHandler = vi.fn(() => "handled" as const);
    const unregisterFirst = first.port.registerKeydownHandler(firstHandler);
    second.port.registerKeydownHandler(secondHandler);
    const event = new KeyboardEvent("keydown", { key: "Enter" });

    expect(first.keyboard.dispatchKeydown(event)).toBe("handled");
    expect(firstHandler).toHaveBeenCalledOnce();
    expect(secondHandler).not.toHaveBeenCalled();
    unregisterFirst();
    expect(first.keyboard.dispatchKeydown(event)).toBe("unhandled");
    first.port.registerKeydownHandler(firstHandler);
    first.dispose();
    expect(first.keyboard.dispatchKeydown(event)).toBe("unhandled");
    expect(second.keyboard.dispatchKeydown(event)).toBe("handled");
  });
});
