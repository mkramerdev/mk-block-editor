import type { BlockId } from "@repo/editor-core/kernel";
import { describe, expect, it } from "vitest";
import { EDITOR_YJS_BLOCK_CONTENT_METADATA_KEYS } from "./constants.ts";
import {
  assertBlockContentDocContext,
  validateBlockContentDocContext,
} from "./validate.ts";
import { createBlockContentDocContext } from "../doc/context.ts";

const BLOCK_A = "01890f07-1c00-7000-8000-000000001101" as BlockId;
const BLOCK_B = "01890f07-1c00-7000-8000-000000001102" as BlockId;

describe("block content metadata validation", () => {
  it("detects metadata drift and assertion failures", () => {
    const context = createBlockContentDocContext({
      blockId: BLOCK_A,
    });
    context.metadata.set(
      EDITOR_YJS_BLOCK_CONTENT_METADATA_KEYS.blockId,
      BLOCK_B,
    );

    expect(validateBlockContentDocContext(context)).toMatchObject({
      ok: false,
      reason: "metadata-mismatch",
    });
    expect(() => assertBlockContentDocContext(context)).toThrow(/blockId/);
  });

  it("reports exact validation failures for context and metadata drift", () => {
    const invalidContextId = createBlockContentDocContext({
      blockId: BLOCK_A,
    });
    expect(
      validateBlockContentDocContext({
        ...invalidContextId,
        blockId: "" as BlockId,
      }),
    ).toMatchObject({
      ok: false,
      reason: "invalid-context-id",
      message:
        "block content context blockId must be a non-empty structural key",
    });

    const wrongKind = createBlockContentDocContext({
      blockId: BLOCK_A,
    });
    wrongKind.metadata.set(
      EDITOR_YJS_BLOCK_CONTENT_METADATA_KEYS.documentKind,
      "wrong-document-kind",
    );
    expect(validateBlockContentDocContext(wrongKind)).toMatchObject({
      ok: false,
      reason: "invalid-document-kind",
      message: "block content metadata documentKind must be block-content",
    });
  });
});
