import type { BlockId } from "@repo/editor-core/kernel";
import { describe, expect, it } from "vitest";
import { Doc } from "yjs";
import {
  EDITOR_YJS_BLOCK_CONTENT_DOCUMENT_KIND,
  EDITOR_YJS_BLOCK_CONTENT_FRAGMENT_NAME,
  EDITOR_YJS_BLOCK_CONTENT_METADATA_KEYS,
  EDITOR_YJS_BLOCK_CONTENT_METADATA_MAP_NAME,
} from "../metadata/constants.ts";
import { createBlockContentDocContext } from "./context.ts";

const BLOCK_A = "01890f07-1c00-7000-8000-000000001101" as BlockId;
const BLOCK_B = "01890f07-1c00-7000-8000-000000001102" as BlockId;
const BLOCK_C = "01890f07-1c00-7000-8000-000000001103" as BlockId;

describe("block content document context", () => {
  it("creates one block-local Y.Doc context with canonical metadata", () => {
    const context = createBlockContentDocContext({
      blockId: BLOCK_A,
    });

    expect(context.blockId).toBe(BLOCK_A);
    expect(context.documentKind).toBe(EDITOR_YJS_BLOCK_CONTENT_DOCUMENT_KIND);
    expect(context.fragment).toBe(
      context.doc.getXmlFragment(EDITOR_YJS_BLOCK_CONTENT_FRAGMENT_NAME),
    );
    expect(context.getFragment()).toBe(context.fragment);
    expect(context.metadata).toBe(
      context.doc.getMap(EDITOR_YJS_BLOCK_CONTENT_METADATA_MAP_NAME),
    );
    expect(context.getMetadataMap()).toBe(context.metadata);
    expect(
      context.getMetadata(EDITOR_YJS_BLOCK_CONTENT_METADATA_KEYS.blockId),
    ).toBe(BLOCK_A);
    expect([...context.metadata.keys()].sort()).toStrictEqual([
      "blockId",
      "documentKind",
    ]);
    expect(context.getDocumentKind()).toBe("block-content");
    expect(context.validateMetadata()).toMatchObject({
      ok: true,
      metadata: {
        blockId: BLOCK_A,
        documentKind: "block-content",
      },
    });
  });

  it("preserves external doc ownership", () => {
    const doc = new Doc();
    const context = createBlockContentDocContext({
      blockId: BLOCK_A,
      doc,
    });

    expect(context.doc).toBe(doc);
    expect(context.destroyDocOnDestroy).toBe(false);

    context.destroy();
    expect(doc.isDestroyed).toBe(false);
  });

  it("destroys owned docs and only destroys provided docs when requested", () => {
    const owned = createBlockContentDocContext({
      blockId: BLOCK_A,
    });
    owned.destroy();
    expect(owned.doc.isDestroyed).toBe(true);

    const retainedDoc = new Doc();
    const retained = createBlockContentDocContext({
      blockId: BLOCK_B,
      doc: retainedDoc,
    });
    retained.destroy();
    expect(retainedDoc.isDestroyed).toBe(false);

    const forcedDoc = new Doc();
    const forced = createBlockContentDocContext({
      blockId: BLOCK_C,
      doc: forcedDoc,
      destroyDocOnDestroy: true,
    });
    forced.destroy();
    expect(forcedDoc.isDestroyed).toBe(true);
  });

  it("rejects conflicting metadata on provided docs", () => {
    const doc = new Doc();
    doc
      .getMap(EDITOR_YJS_BLOCK_CONTENT_METADATA_MAP_NAME)
      .set(
        EDITOR_YJS_BLOCK_CONTENT_METADATA_KEYS.documentKind,
        "wrong-document-kind",
      );

    expect(() =>
      createBlockContentDocContext({
        blockId: BLOCK_A,
        doc,
      }),
    ).toThrow(/metadata|blockId|documentKind/);
  });
});
