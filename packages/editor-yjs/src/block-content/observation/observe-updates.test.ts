import type { BlockId } from "@repo/editor-core/kernel";
import { describe, expect, it } from "vitest";
import { XmlElement } from "yjs";
import { createBlockContentDocContext } from "../doc/context.ts";
import { EDITOR_YJS_ORIGINS } from "../../origins/origins.ts";
import { observeBlockContentUpdates } from "./observe-updates.ts";

const BLOCK_A = "01890f07-1c00-7000-8000-000000001101" as BlockId;

describe("block content update observation", () => {
  it("emits block content update payloads and stops cleanly", () => {
    const context = createBlockContentDocContext({
      blockId: BLOCK_A,
    });
    const observed: Array<{
      blockId: BlockId;
      update: Uint8Array;
      origin: unknown;
    }> = [];
    const metrics: Array<{
      name: string;
      value?: number;
      tags?: Record<string, string | number | boolean>;
    }> = [];
    const stop = observeBlockContentUpdates(
      context,
      (event) => {
        expect("documentId" in event).toBe(false);
        observed.push({
          blockId: event.blockId,
          update: event.update,
          origin: event.origin,
        });
      },
      {
        onMetric(event) {
          metrics.push(event);
        },
      },
    );

    insertBlock(context, "local-a", EDITOR_YJS_ORIGINS.LOCAL_EDIT);
    stop();
    insertBlock(context, "local-b", EDITOR_YJS_ORIGINS.LOCAL_EDIT);

    expect(observed).toHaveLength(1);
    expect(observed[0]?.blockId).toBe(BLOCK_A);
    expect(observed[0]?.update.byteLength).toBeGreaterThan(0);
    expect(observed[0]?.origin).toBe(EDITOR_YJS_ORIGINS.LOCAL_EDIT);
    expect(metrics).toEqual([
      {
        name: "editor_yjs_block_content_update_bytes",
        value: observed[0]?.update.byteLength,
        tags: {
          blockId: BLOCK_A,
        },
      },
    ]);
  });

  it("observes updates without observability hooks", () => {
    const context = createBlockContentDocContext({
      blockId: BLOCK_A,
    });
    let callbackCount = 0;
    const stop = observeBlockContentUpdates(context, () => {
      callbackCount += 1;
    });

    insertBlock(context, "local-a", EDITOR_YJS_ORIGINS.LOCAL_EDIT);
    stop();
    insertBlock(context, "local-b", EDITOR_YJS_ORIGINS.LOCAL_EDIT);

    expect(callbackCount).toBe(1);
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
