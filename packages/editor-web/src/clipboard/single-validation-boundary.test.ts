import { describe, expect, it, vi } from "vitest";
import { createBlockRichTextContentFromPlainText } from "@repo/editor-core/content/rich-text";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import {
  createCanonicalBlockFragmentCandidate,
  createCanonicalBlockRecord,
  type StructuralEditRange,
} from "@repo/editor-core/editing";
import { asBlockId } from "@repo/editor-core/kernel";
import type {
  CommittedSelectionSnapshot,
  EditorSelectionSnapshot,
} from "@repo/editor-react/selection";
import { createEditorClipboardBoundary } from "./boundary.ts";
import { exportCanonicalFragmentPlainText } from "./canonical-plain-text.ts";
import { serializeCanonicalFragmentHtml } from "./canonical-html-export.ts";
import { serializeCanonicalBlockFragmentWirePayload } from "./wire-codec.ts";
import { validateClipboardFragmentCandidate } from "./validated-fragment.ts";
import { createEditorClipboardEventHandlers } from "../document/selection/controller/clipboard-event-coordinator.ts";

const validationProbe = vi.hoisted(() => ({ calls: 0 }));
const representationProbe = vi.hoisted(() => ({
  plainText: 0,
  html: 0,
  wire: 0,
}));

vi.mock("@repo/editor-core/editing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/editor-core/editing")>();
  return {
    ...actual,
    assertValidCanonicalBlockFragment: (...args: Parameters<
      typeof actual.assertValidCanonicalBlockFragment
    >) => {
      validationProbe.calls += 1;
      return actual.assertValidCanonicalBlockFragment(...args);
    },
  };
});

vi.mock("./canonical-plain-text.ts", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("./canonical-plain-text.ts")
  >();
  return {
    ...actual,
    exportValidatedCanonicalFragmentPlainText: (...args: Parameters<
      typeof actual.exportValidatedCanonicalFragmentPlainText
    >) => {
      representationProbe.plainText += 1;
      return actual.exportValidatedCanonicalFragmentPlainText(...args);
    },
  };
});

vi.mock("./canonical-html-export.ts", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("./canonical-html-export.ts")
  >();
  return {
    ...actual,
    serializeValidatedCanonicalFragmentHtml: (...args: Parameters<
      typeof actual.serializeValidatedCanonicalFragmentHtml
    >) => {
      representationProbe.html += 1;
      return actual.serializeValidatedCanonicalFragmentHtml(...args);
    },
  };
});

vi.mock("./wire-codec.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./wire-codec.ts")>();
  return {
    ...actual,
    serializeValidatedCanonicalBlockFragmentWirePayload: (...args: Parameters<
      typeof actual.serializeValidatedCanonicalBlockFragmentWirePayload
    >) => {
      representationProbe.wire += 1;
      return actual.serializeValidatedCanonicalBlockFragmentWirePayload(
        ...args,
      );
    },
  };
});

const blockId = asBlockId("01890f07-1c00-7000-8000-000000000940");
const definitions: Readonly<Record<string, BlockDefinition>> = {
  textBlock: { kind: "text", type: "textBlock" },
};
const snapshot = {} as EditorSelectionSnapshot;
const committed = {} as CommittedSelectionSnapshot;
const range: StructuralEditRange = {
  graphRevision: 1,
  selectionRevision: 1,
  blocks: [],
  start: { kind: "block", blockId },
  end: { kind: "block", blockId },
};

describe("single outgoing clipboard validation boundary", () => {
  it.each(["copy", "cut"] as const)(
    "validates one candidate exactly once for native %s",
    (kind) => {
      validationProbe.calls = 0;
      resetRepresentationProbe();
      const materialize = vi.fn(candidate);
      const plainTextExport = vi.fn(() => undefined);
      const htmlExport = vi.fn(() => undefined);
      const boundary = createEditorClipboardBoundary({
        blockDefinitions: definitions,
        plainTextImportBlockType: "textBlock",
        materializeSelection: materialize,
        plainTextExportHandlers: [
          { id: "probe.plain", exportBlock: plainTextExport },
        ],
        htmlExportHandlers: [{ id: "probe.html", export: htmlExport }],
      });
      const cut = vi.fn(() => ({ ok: true, changed: true }));
      const handlers = createEditorClipboardEventHandlers({
        editorIdentity: {},
        boundary,
        ownership: {
          resolve: () => ({ kind: "selection", selection: committed }),
          captureSelectionSnapshot: () => snapshot,
          captureSelection: () => null,
          captureCutSelection: () => ({
            kind: "structural",
            captured: committed,
            snapshot,
            range,
            graphRevision: 1,
            isCurrent: () => true,
          }),
        },
        commands: {
          cut,
          paste: () => ({ ok: false, changed: false }),
        },
      });
      const clipboard = new MemoryDataTransfer();
      const event = clipboardEvent(kind, clipboard);

      expect(handlers[kind](event)).toBe(true);
      expect(validationProbe.calls).toBe(1);
      expect(materialize).toHaveBeenCalledOnce();
      expect(plainTextExport).toHaveBeenCalledOnce();
      expect(htmlExport).toHaveBeenCalledOnce();
      expect(representationProbe).toEqual({
        plainText: 1,
        html: 1,
        wire: 1,
      });
      expect(clipboard.writes).toEqual(["text/plain", "text/html"]);
      expect(cut).toHaveBeenCalledTimes(kind === "cut" ? 1 : 0);
    },
  );

  it("rejects an invalid candidate before the first clipboard write", () => {
    validationProbe.calls = 0;
    resetRepresentationProbe();
    const invalid = createCanonicalBlockFragmentCandidate({
      blocks: [],
      rootBlockIds: [],
      start: { kind: "block", blockId },
      end: { kind: "block", blockId },
    });
    const clipboard = new MemoryDataTransfer();
    const boundary = createEditorClipboardBoundary({
      blockDefinitions: definitions,
      plainTextImportBlockType: "textBlock",
      materializeSelection: () => invalid,
    });

    expect(boundary.writeSelection(clipboard.asDataTransfer(), snapshot)).toBe(
      false,
    );
    expect(validationProbe.calls).toBe(1);
    expect(representationProbe).toEqual({
      plainText: 0,
      html: 0,
      wire: 0,
    });
    expect(clipboard.writes).toEqual([]);
  });

  it("leaves the event unclaimed when representation construction throws", () => {
    validationProbe.calls = 0;
    resetRepresentationProbe();
    const boundary = createEditorClipboardBoundary({
      blockDefinitions: definitions,
      plainTextImportBlockType: "textBlock",
      materializeSelection: candidate,
      htmlExportHandlers: [
        {
          id: "probe.failure",
          export: () => {
            throw new Error("serialization failed");
          },
        },
      ],
    });
    const handlers = createEditorClipboardEventHandlers({
      editorIdentity: {},
      boundary,
      ownership: {
        resolve: () => ({ kind: "selection", selection: committed }),
        captureSelectionSnapshot: () => snapshot,
        captureSelection: () => null,
        captureCutSelection: () => null,
      },
      commands: {
        cut: () => ({ ok: false, changed: false }),
        paste: () => ({ ok: false, changed: false }),
      },
    });
    const clipboard = new MemoryDataTransfer();
    const event = clipboardEvent("copy", clipboard);

    expect(handlers.copy(event)).toBe(false);
    expect(validationProbe.calls).toBe(1);
    expect(representationProbe).toEqual({
      plainText: 1,
      html: 1,
      wire: 0,
    });
    expect(clipboard.writes).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it("keeps public serializers independently validating arbitrary fragments", () => {
    validationProbe.calls = 0;
    const outgoing = candidate();
    const fragment = {
      blocks: outgoing.blocks,
      rootBlockIds: outgoing.rootBlockIds,
      start: outgoing.start,
      end: outgoing.end,
    };

    exportCanonicalFragmentPlainText(fragment, {
      blockDefinitions: definitions,
      defaultTextBlockType: "textBlock",
    });
    serializeCanonicalFragmentHtml(fragment, {
      blockDefinitions: definitions,
      inlineMarks: [],
    });
    serializeCanonicalBlockFragmentWirePayload(fragment, {
      blockDefinitions: definitions,
    });

    expect(validationProbe.calls).toBe(3);
  });

  it("creates a non-serializable operation-local validation capability", () => {
    validationProbe.calls = 0;
    const validated = validateClipboardFragmentCandidate(
      candidate(),
      definitions,
    );

    expect(validationProbe.calls).toBe(1);
    expect(JSON.stringify(validated)).toBe("{}");
  });
});

function candidate() {
  const content = createBlockRichTextContentFromPlainText("textBlock", "copy");
  const block = createCanonicalBlockRecord({
    id: blockId,
    type: "textBlock",
    content,
    plainText: "copy",
  });
  return createCanonicalBlockFragmentCandidate({
    blocks: [block],
    rootBlockIds: [block.id],
    start: { kind: "text", blockId: block.id },
    end: { kind: "text", blockId: block.id },
  });
}

function clipboardEvent(
  type: "copy" | "cut",
  clipboard: MemoryDataTransfer,
): ClipboardEvent {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: clipboard.asDataTransfer(),
  });
  return event as ClipboardEvent;
}

class MemoryDataTransfer {
  readonly values = new Map<string, string>();
  readonly writes: string[] = [];

  setData(format: string, value: string): void {
    this.writes.push(format);
    this.values.set(format, value);
  }

  getData(format: string): string {
    return this.values.get(format) ?? "";
  }

  get types(): readonly string[] {
    return [...this.values.keys()];
  }

  asDataTransfer(): DataTransfer {
    return this as unknown as DataTransfer;
  }
}

function resetRepresentationProbe(): void {
  representationProbe.plainText = 0;
  representationProbe.html = 0;
  representationProbe.wire = 0;
}
