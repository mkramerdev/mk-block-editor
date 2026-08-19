import type { BlockId } from "@repo/editor-core/kernel";
import { describe, expect, it } from "vitest";
import { XmlElement } from "yjs";
import { createBlockContentDocContext } from "../block-content/doc/context.ts";
import { EDITOR_YJS_ORIGINS } from "../origins/origins.ts";
import { applyBlockContentUpdate } from "./apply-update.ts";
import { encodeBlockContentUpdate } from "./encode-update.ts";

const BLOCK_A = "01890f07-1c00-7000-8000-000000001101" as BlockId;

describe("block content update application", () => {
  it("applies bytes to the context selected by the validated operation envelope", () => {
    const source = createBlockContentDocContext({
      blockId: BLOCK_A,
    });
    const target = createBlockContentDocContext({
      blockId: BLOCK_A,
    });

    insertBlock(source, "local-a", EDITOR_YJS_ORIGINS.LOCAL_EDIT);
    applyBlockContentUpdate(target, encodeBlockContentUpdate(source));

    expect(blockIds(target)).toEqual(["local-a"]);
  });

  it("rejects corrupt updates without mutating the target document", () => {
    const target = createBlockContentDocContext({
      blockId: BLOCK_A,
    });

    expect(() => applyBlockContentUpdate(target, new Uint8Array())).toThrow(
      /Unexpected end of array/,
    );
    expect(blockIds(target)).toEqual([]);
  });
});

function insertBlock(
  context: ReturnType<typeof createBlockContentDocContext>,
  id: string,
  origin: unknown,
): void {
  context.doc.transact(() => {
    context.fragment.insert(context.fragment.length, [createBlock(id)]);
  }, origin);
}

function createBlock(id: string): XmlElement {
  const block = new XmlElement("block");
  block.setAttribute("id", id);
  return block;
}

function blockIds(context: { fragment: { toArray(): unknown[] } }): string[] {
  return context.fragment
    .toArray()
    .filter((node): node is XmlElement => node instanceof XmlElement)
    .map((node) => node.getAttribute("id") as string);
}
