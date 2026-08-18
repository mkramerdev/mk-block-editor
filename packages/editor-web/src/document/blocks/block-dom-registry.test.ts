import { describe, expect, it, vi } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import { createEditorBlockDomRegistry } from "./block-dom-registry.ts";

const blockId = "block-a" as BlockId;

describe("createEditorBlockDomRegistry", () => {
  it("exposes only the block-to-shell reader and registrar capabilities", () => {
    const registry = createEditorBlockDomRegistry();

    expect(Object.keys(registry.reader)).toStrictEqual(["getBlockShell"]);
    expect(Object.keys(registry.registrar)).toStrictEqual([
      "registerBlockShell",
    ]);
    expect(registry.reader).not.toBe(registry.registrar);
  });

  it("registers one shell synchronously and cleans it up idempotently", () => {
    const registry = createEditorBlockDomRegistry();
    const shell = document.createElement("div");
    const release = registry.registrar.registerBlockShell(blockId, shell);

    expect(registry.reader.getBlockShell(blockId)).toBe(shell);
    expect(registry.registeredElements()).toStrictEqual([shell]);

    release();
    release();
    expect(registry.reader.getBlockShell(blockId)).toBeNull();
    expect(registry.registeredElements()).toStrictEqual([]);
  });

  it("keeps a replacement authoritative when stale cleanup runs", () => {
    const registry = createEditorBlockDomRegistry();
    const first = document.createElement("div");
    const replacement = document.createElement("div");
    const releaseFirst = registry.registrar.registerBlockShell(blockId, first);
    const releaseReplacement = registry.registrar.registerBlockShell(
      blockId,
      replacement,
    );

    releaseFirst();
    expect(registry.reader.getBlockShell(blockId)).toBe(replacement);

    releaseReplacement();
    expect(registry.reader.getBlockShell(blockId)).toBeNull();
  });

  it("publishes shell registration, replacement, and cleanup changes", () => {
    const registry = createEditorBlockDomRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);
    const first = document.createElement("div");
    const second = document.createElement("div");
    const releaseFirst = registry.registrar.registerBlockShell(blockId, first);
    const releaseSecond = registry.registrar.registerBlockShell(
      blockId,
      second,
    );

    expect(listener).toHaveBeenNthCalledWith(1, {
      blockId,
      previous: null,
      current: first,
    });
    expect(listener).toHaveBeenNthCalledWith(2, {
      blockId,
      previous: first,
      current: second,
    });

    releaseFirst();
    expect(listener).toHaveBeenCalledTimes(2);
    releaseSecond();
    expect(listener).toHaveBeenNthCalledWith(3, {
      blockId,
      previous: second,
      current: null,
    });
  });

  it("isolates identical ids between document instances and clears disposal state", () => {
    const firstRegistry = createEditorBlockDomRegistry();
    const secondRegistry = createEditorBlockDomRegistry();
    const first = document.createElement("div");
    const second = document.createElement("div");
    firstRegistry.registrar.registerBlockShell(blockId, first);
    secondRegistry.registrar.registerBlockShell(blockId, second);

    expect(firstRegistry.reader.getBlockShell(blockId)).toBe(first);
    expect(secondRegistry.reader.getBlockShell(blockId)).toBe(second);

    firstRegistry.clear();
    expect(firstRegistry.reader.getBlockShell(blockId)).toBeNull();
    expect(secondRegistry.reader.getBlockShell(blockId)).toBe(second);
  });
});
