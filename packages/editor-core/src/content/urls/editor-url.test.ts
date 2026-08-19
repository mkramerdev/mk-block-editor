import { describe, expect, it } from "vitest";
import { sanitizeEditorLinkUrl } from "./editor-url.ts";

describe("editor link URL schema", () => {
  it("rejects unsafe inline link URLs", () => {
    expect(sanitizeEditorLinkUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeEditorLinkUrl("data:text/html,boom")).toBeNull();
    expect(sanitizeEditorLinkUrl("data:image/png;base64,abc")).toBeNull();
    expect(sanitizeEditorLinkUrl("not a host/path")).toBeNull();
    expect(sanitizeEditorLinkUrl("blob:https://example.test/id")).toBeNull();
  });

  it("allows explicit inline link protocols", () => {
    expect(sanitizeEditorLinkUrl("http://example.test/article")).toBe(
      "http://example.test/article",
    );
    expect(sanitizeEditorLinkUrl("https://example.test/article")).toBe(
      "https://example.test/article",
    );
    expect(sanitizeEditorLinkUrl("mailto:ada@example.test")).toBe(
      "mailto:ada@example.test",
    );
  });

  it("allows explicit relative inline links", () => {
    expect(sanitizeEditorLinkUrl("#heading")).toBe("#heading");
    expect(sanitizeEditorLinkUrl("/docs")).toBe("/docs");
    expect(sanitizeEditorLinkUrl("./docs")).toBe("./docs");
    expect(sanitizeEditorLinkUrl("../docs")).toBe("../docs");
  });

  it("normalizes host-like inline links to https", () => {
    expect(sanitizeEditorLinkUrl("example.test/article")).toBe(
      "https://example.test/article",
    );
    expect(sanitizeEditorLinkUrl("localhost:3000/docs")).toBe(
      "https://localhost:3000/docs",
    );
    expect(sanitizeEditorLinkUrl("//example.test/path")).toBe(
      "https://example.test/path",
    );
  });
});
