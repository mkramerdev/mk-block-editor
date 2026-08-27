import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  NativeFocusCoordinator,
  type PendingNativeFocusRequest,
} from "../../runtime/document/native-focus-coordinator.ts";

const textId = "native-text" as BlockId;
const atomicId = "native-atomic" as BlockId;

function request(
  blockId: BlockId,
  targetKind: "text" | "atomic",
  offset?: number,
): PendingNativeFocusRequest {
  return {
    token: Symbol("request"),
    blockId,
    targetKind,
    graphRevision: 1,
    preventScroll: true,
    ...(offset === undefined ? {} : { offset }),
  };
}

function target(): HTMLButtonElement {
  const element = document.createElement("button");
  document.body.append(element);
  return element;
}

function textHost(blockId: BlockId = textId) {
  const shell = document.createElement("div");
  shell.dataset.editorBlockShell = "true";
  shell.dataset.editorBlockId = blockId;
  const textShell = document.createElement("div");
  textShell.dataset.editorTextShell = "true";
  textShell.tabIndex = -1;
  const sharedView = document.createElement("div");
  sharedView.dataset.editorSharedTextView = "true";
  const descendant = document.createElement("span");
  sharedView.append(descendant);
  textShell.append(sharedView);
  shell.append(textShell);
  document.body.append(shell);
  return { shell, textShell, sharedView, descendant };
}

function coordinator() {
  const consumePending = vi.fn();
  const consumePresentation = vi.fn();
  const value = new NativeFocusCoordinator({
    ownerDocument: document,
    validateTarget: (blockId, kind) =>
      (blockId === textId && kind === "text") ||
      (blockId === atomicId && kind === "atomic"),
    consumePending,
    consumePresentation,
  });
  return { value, consumePending, consumePresentation };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("exact native focus ownership", () => {
  it("registers and focuses exact text and atomic targets", () => {
    const { value } = coordinator();
    const { textShell: textTarget } = textHost();
    const atomicTarget = target();
    value.registerTextTarget(textId, textTarget);
    value.registerAtomicTarget(atomicId, atomicTarget);
    const nativeChild = document.createElement("button");
    atomicTarget.append(nativeChild);
    expect(value.resolveTarget(nativeChild)).toBeNull();
    expect(value.resolveTarget(textTarget)).toEqual({
      kind: "text",
      blockId: textId,
      registeredTarget: textTarget,
    });

    expect(value.request(request(textId, "text", 2))).toEqual({
      status: "focused",
    });
    expect(document.activeElement).toBe(textTarget);
    expect(value.request(request(atomicId, "atomic"))).toEqual({
      status: "focused",
    });
    expect(document.activeElement).toBe(atomicTarget);
  });

  it("keeps a replacement when stale cleanup runs", () => {
    const { value } = coordinator();
    const { textShell: first } = textHost();
    const { textShell: replacement } = textHost();
    const staleCleanup = value.registerTextTarget(textId, first);
    value.registerTextTarget(textId, replacement);

    staleCleanup();
    expect(value.resolveTarget(first)).toBeNull();
    expect(value.resolveTarget(replacement)?.registeredTarget).toBe(
      replacement,
    );
    expect(value.request(request(textId, "text", 0))).toEqual({
      status: "focused",
    });
    expect(document.activeElement).toBe(replacement);
  });

  it("rejects disconnected, wrong-document, and wrong-kind targets", () => {
    const { value } = coordinator();
    const { textShell: disconnected } = textHost();
    value.registerTextTarget(textId, disconnected);
    disconnected.remove();
    expect(value.resolveTarget(disconnected)).toBeNull();
    expect(value.request(request(textId, "text", 0))).toEqual({
      status: "rejected",
      reason: "disconnected",
    });

    const otherDocument = document.implementation.createHTMLDocument("other");
    const foreign = otherDocument.createElement("button");
    otherDocument.body.append(foreign);
    value.registerTextTarget(textId, foreign);
    expect(value.resolveTarget(foreign)).toBeNull();

    const wrongKind = target();
    value.registerAtomicTarget(textId, wrongKind);
    expect(value.resolveTarget(wrongKind)).toBeNull();
    expect(value.request(request(textId, "atomic"))).toEqual({
      status: "rejected",
      reason: "wrong-kind",
    });
  });

  it("queues one request, supersedes it, and consumes the newest once", () => {
    const { value, consumePending } = coordinator();
    const older = request(textId, "text", 1);
    const newer = request(textId, "text", 2);
    expect(value.request(older)).toEqual({ status: "pending" });
    expect(value.request(newer)).toEqual({ status: "pending" });
    expect(value.readPendingRequest()).toBe(newer);

    const { textShell: mounted } = textHost();
    value.registerTextTarget(textId, mounted);
    expect(consumePending).toHaveBeenCalledOnce();
    expect(consumePending).toHaveBeenCalledWith(newer);
    expect(value.readPendingRequest()).toBeNull();
    value.registerTextTarget(textId, target());
    expect(consumePending).toHaveBeenCalledOnce();
  });

  it("cancels pending requests on explicit blur and disposal", () => {
    const { value } = coordinator();
    value.request(request(textId, "text", 1));
    expect(value.blurEditor()).toBe(false);
    expect(value.readPendingRequest()).toBeNull();

    const { textShell: mounted } = textHost();
    value.registerTextTarget(textId, mounted);
    value.request(request(textId, "text", 1));
    value.request(request(atomicId, "atomic"));
    expect(value.readPendingRequest()).not.toBeNull();
    value.dispose();
    expect(value.readPendingRequest()).toBeNull();
    expect(value.resolveTarget(mounted)).toBeNull();
    expect(value.request(request(textId, "text", 1))).toEqual({
      status: "rejected",
      reason: "disposed",
    });
  });

  it("uses ownerDocument.activeElement and reports native focus failure", () => {
    const { value } = coordinator();
    const { textShell: mounted } = textHost();
    vi.spyOn(mounted, "focus").mockImplementation(() => undefined);
    value.registerTextTarget(textId, mounted);

    expect(value.request(request(textId, "text", 0))).toEqual({
      status: "rejected",
      reason: "native-focus-failed",
    });
    expect(value.resolveTarget(document.activeElement)).toBeNull();
  });

  it("resolves a shared text descendant and exact atomic target only", () => {
    const { value } = coordinator();
    const { textShell, descendant } = textHost();
    const atomic = target();
    const atomicChild = document.createElement("span");
    atomic.append(atomicChild);
    value.registerTextTarget(textId, textShell);
    value.registerAtomicTarget(atomicId, atomic);

    expect(value.resolveTarget(descendant)).toEqual({
      kind: "text",
      blockId: textId,
      registeredTarget: textShell,
    });
    expect(value.resolveTarget(atomic)).toEqual({
      kind: "atomic",
      blockId: atomicId,
      registeredTarget: atomic,
    });
    expect(value.resolveTarget(atomicChild)).toBeNull();
  });

  it("isolates nested editors and two editors in one document", () => {
    const first = coordinator().value;
    const second = coordinator().value;
    const outer = textHost();
    const inner = textHost();
    const outerScope = document.createElement("div");
    outerScope.dataset.editorInteractionScope = "true";
    const outerList = document.createElement("div");
    outerList.dataset.editorBlockListRoot = "true";
    outerScope.append(outerList);
    outerList.append(outer.shell);
    document.body.append(outerScope);
    const innerScope = document.createElement("div");
    innerScope.dataset.editorInteractionScope = "true";
    const innerList = document.createElement("div");
    innerList.dataset.editorBlockListRoot = "true";
    innerScope.append(innerList);
    innerList.append(inner.shell);
    outer.descendant.append(innerScope);
    first.registerTextTarget(textId, outer.textShell);
    second.registerTextTarget(textId, inner.textShell);

    expect(first.resolveTarget(outer.descendant)?.registeredTarget).toBe(
      outer.textShell,
    );
    expect(first.resolveTarget(inner.descendant)).toBeNull();
    expect(second.resolveTarget(inner.descendant)?.registeredTarget).toBe(
      inner.textShell,
    );
    expect(second.resolveTarget(outer.descendant)).toBeNull();
  });

  it("rejects a block simultaneously registered under the wrong kind", () => {
    const value = new NativeFocusCoordinator({
      ownerDocument: document,
      validateTarget: () => true,
      consumePending: vi.fn(),
      consumePresentation: vi.fn(),
    });
    const sharedId = "shared-kind" as BlockId;
    const text = textHost(sharedId);
    const atomic = target();
    value.registerTextTarget(sharedId, text.textShell);
    value.registerAtomicTarget(sharedId, atomic);

    expect(value.resolveTarget(text.descendant)).toBeNull();
    expect(value.resolveTarget(atomic)).toBeNull();
  });

  it.each([10, 100, 1_000])(
    "resolves the final text host without registration-wide contains calls (%i hosts)",
    (count) => {
      const value = new NativeFocusCoordinator({
        ownerDocument: document,
        validateTarget: () => true,
        consumePending: vi.fn(),
        consumePresentation: vi.fn(),
      });
      let final: ReturnType<typeof textHost> | null = null;
      const containsSpies: ReturnType<typeof vi.spyOn>[] = [];
      for (let index = 0; index < count; index += 1) {
        const blockId = `native-text-${index}` as BlockId;
        const host = textHost(blockId);
        final = host;
        containsSpies.push(vi.spyOn(host.textShell, "contains"));
        value.registerTextTarget(blockId, host.textShell);
      }
      expect(value.resolveTarget(final!.descendant)?.blockId).toBe(
        `native-text-${count - 1}`,
      );
      expect(
        containsSpies.reduce((total, spy) => total + spy.mock.calls.length, 0),
      ).toBe(0);
    },
  );
});
