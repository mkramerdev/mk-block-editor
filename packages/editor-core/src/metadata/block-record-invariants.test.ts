import { describe, expect, it } from "vitest";
import type { BlockId } from "../kernel/identity/ids.ts";
import { createBlockRecord } from "./block-record.ts";

describe("block record invariants", () => {
  it("creates canonical block records without unsupported ordering or version fields", () => {
    const block = createBlockRecord({
      id: "01890f07-1c00-7000-8000-000000002001" as BlockId,
      type: "textBlock",
    });

    expect(block).toMatchObject({
      id: "01890f07-1c00-7000-8000-000000002001",
      type: "textBlock",
      parentId: null,
    });
    expect(Object.prototype.hasOwnProperty.call(block, "depth")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(block, "metadataVersion")).toBe(
      false,
    );
    expect(Object.prototype.hasOwnProperty.call(block, "contentVersion")).toBe(
      false,
    );
    expect(JSON.stringify(block)).not.toContain('"depth"');
    expect(JSON.stringify(block)).not.toContain('"metadataVersion"');
    expect(JSON.stringify(block)).not.toContain('"contentVersion"');
  });
});
