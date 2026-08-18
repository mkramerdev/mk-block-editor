import { describe, expect, it } from "vitest";
import * as publicApi from "./index.ts";
import { EDITOR_YJS_ORIGINS } from "../origins/origins.ts";

describe("public root API", () => {
  it("exports the intentional runtime-neutral public API", () => {
    expect(publicApi.Doc).toBe(publicApi.YDoc);
    expect(publicApi.applyUpdate).toBeTypeOf("function");
    expect(publicApi.createRelativePositionFromTypeIndex).toBeTypeOf(
      "function",
    );
    expect(publicApi.createBlockContentDocContext).toBeTypeOf("function");
    expect(publicApi.createYjsBlockContentCheckpoint).toBeTypeOf("function");
    expect(publicApi).not.toHaveProperty("createDocumentContentContext");
    expect(publicApi).not.toHaveProperty("createYjsDocumentContentCheckpoint");
    expect(publicApi).not.toHaveProperty("createBlockContentDocRegistry");
    expect(publicApi).not.toHaveProperty("createEditorYjsContext");
    expect(publicApi).not.toHaveProperty("createEditorYjsFragmentContext");
    expect(publicApi).not.toHaveProperty("createEditorYjsChildFragmentContext");
    for (const forbiddenHelper of [
      ["create", "Block", "Content", "Doc", "Id"].join(""),
      ["parse", "Block", "Content", "Doc", "Id"].join(""),
      ["is", "Block", "Content", "Doc", "Id"].join(""),
      ["format", "Block", "Content", "Doc", "Id"].join(""),
    ]) {
      expect(publicApi).not.toHaveProperty(forbiddenHelper);
    }
    expect(publicApi).not.toHaveProperty("validateBlockContentDocContext");
  });

  it("exports stable semantic origin constants", () => {
    expect(Object.isFrozen(EDITOR_YJS_ORIGINS)).toBe(true);
    expect(EDITOR_YJS_ORIGINS).toEqual({
      LOCAL_EDIT: "@repo/editor-yjs/local-edit",
      REMOTE_UPDATE: "@repo/editor-yjs/remote-update",
      CONTENT_BOOTSTRAP: "@repo/editor-yjs/content-bootstrap",
    });
  });
});
