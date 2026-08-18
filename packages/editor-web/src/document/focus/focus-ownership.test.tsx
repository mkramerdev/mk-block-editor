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
    const textTarget = target();
    const atomicTarget = target();
    value.registerTextTarget(textId, textTarget);
    value.registerAtomicTarget(atomicId, atomicTarget);
    const nativeChild = document.createElement("button");
    atomicTarget.append(nativeChild);
    expect(value.ownsTarget(nativeChild)).toBe(false);

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
    const first = target();
    const replacement = target();
    const staleCleanup = value.registerTextTarget(textId, first);
    value.registerTextTarget(textId, replacement);

    staleCleanup();
    expect(value.request(request(textId, "text", 0))).toEqual({
      status: "focused",
    });
    expect(document.activeElement).toBe(replacement);
  });

  it("rejects disconnected, wrong-document, and wrong-kind targets", () => {
    const { value } = coordinator();
    const disconnected = target();
    value.registerTextTarget(textId, disconnected);
    disconnected.remove();
    expect(value.request(request(textId, "text", 0))).toEqual({
      status: "rejected",
      reason: "disconnected",
    });

    const otherDocument = document.implementation.createHTMLDocument("other");
    const foreign = otherDocument.createElement("button");
    otherDocument.body.append(foreign);
    value.registerTextTarget(textId, foreign);
    expect(value.ownsTarget(foreign)).toBe(false);

    const wrongKind = target();
    value.registerAtomicTarget(textId, wrongKind);
    expect(value.ownsTarget(wrongKind)).toBe(false);
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

    const mounted = target();
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

    const mounted = target();
    value.registerTextTarget(textId, mounted);
    value.request(request(textId, "text", 1));
    value.request(request(atomicId, "atomic"));
    expect(value.readPendingRequest()).not.toBeNull();
    value.dispose();
    expect(value.readPendingRequest()).toBeNull();
    expect(value.ownsTarget(mounted)).toBe(false);
    expect(value.request(request(textId, "text", 1))).toEqual({
      status: "rejected",
      reason: "disposed",
    });
  });

  it("uses ownerDocument.activeElement and reports native focus failure", () => {
    const { value } = coordinator();
    const mounted = target();
    vi.spyOn(mounted, "focus").mockImplementation(() => undefined);
    value.registerTextTarget(textId, mounted);

    expect(value.request(request(textId, "text", 0))).toEqual({
      status: "rejected",
      reason: "native-focus-failed",
    });
    expect(value.ownsActiveElement(document)).toBe(false);
  });
});
