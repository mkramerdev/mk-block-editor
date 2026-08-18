import { describe, expect, it, vi } from "vitest";
import type { CanonicalBlockFragment } from "@repo/editor-core/editing";
import type {
  CommittedSelectionSnapshot,
  EditorSelectionSnapshot,
} from "@repo/editor-react/selection";
import { createEditorClipboardEventHandlers } from "./clipboard-event-coordinator.ts";
import type {
  CapturedStructuralSelection,
} from "./browser-selection-types.ts";

const selection = {} as CommittedSelectionSnapshot;
const snapshot = {} as EditorSelectionSnapshot;
const fragment = {} as CanonicalBlockFragment;

describe("browser clipboard event coordination", () => {
  it("copies read-only and claims the event only after writing succeeds", () => {
    const fixture = coordinator();
    const event = clipboardEvent("copy");
    fixture.handlers.copy(event);

    expect(fixture.options.boundary.writeSelection).toHaveBeenCalledOnce();
    expect(fixture.options.executeCut).not.toHaveBeenCalled();
    expect(fixture.options.executePaste).not.toHaveBeenCalled();
    expect(fixture.options.captureSelection).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("copies from a materializable snapshot without resolving a structural edit range", () => {
    const fixture = coordinator({
      captureSelection: vi.fn(() => null),
    });
    const event = clipboardEvent("copy");

    fixture.handlers.copy(event);

    expect(fixture.options.captureSelectionSnapshot).toHaveBeenCalledOnce();
    expect(fixture.options.captureSelection).not.toHaveBeenCalled();
    expect(fixture.options.boundary.writeSelection).toHaveBeenCalledWith(
      event.clipboardData,
      snapshot,
    );
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves failed copy and cut writes completely unclaimed", () => {
    const fixture = coordinator({
      writeSelection: vi.fn(() => false),
    });
    const copy = clipboardEvent("copy");
    const cut = clipboardEvent("cut");
    fixture.handlers.copy(copy);
    fixture.handlers.cut(cut);

    expect(copy.defaultPrevented).toBe(false);
    expect(cut.defaultPrevented).toBe(false);
    expect(fixture.options.executeCut).not.toHaveBeenCalled();
  });

  it("writes cut data before one mutation and retains its transaction-owned selection", () => {
    const order: string[] = [];
    const fixture = coordinator({
      writeSelection: vi.fn(() => {
        order.push("write");
        return true;
      }),
      executeCut: vi.fn(() => {
        order.push("transaction");
        return { ok: true, changed: true };
      }),
    });
    const event = clipboardEvent("cut");
    const preventDefault = event.preventDefault.bind(event);
    vi.spyOn(event, "preventDefault").mockImplementation(() => {
      order.push("claim");
      preventDefault();
    });
    fixture.handlers.cut(event);

    expect(order).toEqual(["write", "claim", "transaction"]);
    expect(event.defaultPrevented).toBe(true);
    expect(fixture.options.executeCut).toHaveBeenCalledOnce();
  });

  it("leaves a stale cut unclaimed and performs no deletion", () => {
    const fixture = coordinator({ selectionIsCurrent: false });
    const event = clipboardEvent("cut");
    fixture.handlers.cut(event);

    expect(event.defaultPrevented).toBe(false);
    expect(fixture.options.executeCut).not.toHaveBeenCalled();
  });

  it("writes and claims before invoking one definition-owned internal cut", () => {
    const order: string[] = [];
    const cut = vi.fn(() => {
      order.push("cut");
      return { ok: true, changed: true };
    });
    const fixture = coordinator({
      writeSelection: vi.fn(() => {
        order.push("write");
        return true;
      }),
      captureCutSelection: vi.fn(() => ({
        kind: "internal" as const,
        snapshot,
        isCurrent: () => true,
        cut,
      })),
    });
    const event = clipboardEvent("cut");

    fixture.handlers.cut(event);

    expect(order).toStrictEqual(["write", "cut"]);
    expect(cut).toHaveBeenCalledOnce();
    expect(fixture.options.executeCut).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("captures a paste target before decoding and sends only the fragment onward", () => {
    const order: string[] = [];
    const fixture = coordinator({
      captureSelection: vi.fn(() => {
        order.push("capture");
        return {
          captured: selection,
          snapshot,
          range: "range" as CapturedStructuralSelection["range"],
          graphRevision: 1,
          isCurrent: () => true,
        };
      }),
      readClipboardBlocks: vi.fn(() => {
        order.push("decode");
        return fragment;
      }),
      executePaste: vi.fn((target, value) => {
        order.push("transaction");
        expect(target).toMatchObject({ kind: "selection" });
        expect(value).toBe(fragment);
        return { ok: true, changed: true };
      }),
    });
    const event = clipboardEvent("paste");
    const preventDefault = event.preventDefault.bind(event);
    vi.spyOn(event, "preventDefault").mockImplementation(() => {
      order.push("claim");
      preventDefault();
    });
    fixture.handlers.paste(event);

    expect(order).toEqual(["capture", "decode", "claim", "transaction"]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("claims accepted canonical input even when structural editing fails", () => {
    const fixture = coordinator({
      executePaste: vi.fn(() => ({ ok: false, changed: false })),
    });
    const event = clipboardEvent("paste");
    fixture.handlers.paste(event);

    expect(event.defaultPrevented).toBe(true);
    expect(fixture.options.executePaste).toHaveBeenCalledOnce();
  });

  it("leaves canonical paste unclaimed when the captured target becomes stale", () => {
    const fixture = coordinator({ selectionIsCurrent: false });
    const event = clipboardEvent("paste");
    fixture.handlers.paste(event);

    expect(event.defaultPrevented).toBe(false);
    expect(fixture.options.boundary.readClipboardBlocks).toHaveBeenCalledOnce();
    expect(fixture.options.executePaste).not.toHaveBeenCalled();
  });

  it("does not claim unreadable or unowned paste events", () => {
    const unreadable = coordinator({
      readClipboardBlocks: vi.fn(() => null),
    });
    const unowned = coordinator({ ownership: { kind: "none" } });
    const first = clipboardEvent("paste");
    const second = clipboardEvent("paste");
    unreadable.handlers.paste(first);
    unowned.handlers.paste(second);

    expect(first.defaultPrevented).toBe(false);
    expect(second.defaultPrevented).toBe(false);
    expect(unreadable.options.executePaste).not.toHaveBeenCalled();
    expect(unowned.options.boundary.readClipboardBlocks).not.toHaveBeenCalled();
  });

});

function coordinator(
  overrides: {
    readonly ownership?:
      | { readonly kind: "none" }
      | {
          readonly kind: "selection";
          readonly selection: CommittedSelectionSnapshot;
        };
    readonly selectionIsCurrent?: boolean;
    readonly writeSelection?: ReturnType<typeof vi.fn>;
    readonly readClipboardBlocks?: ReturnType<typeof vi.fn>;
    readonly captureSelectionSnapshot?: ReturnType<typeof vi.fn>;
    readonly captureSelection?: ReturnType<typeof vi.fn>;
    readonly captureCutSelection?: ReturnType<typeof vi.fn>;
    readonly executeCut?: ReturnType<typeof vi.fn>;
    readonly executePaste?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const boundary = {
    writeSelection: overrides.writeSelection ?? vi.fn(() => true),
    readClipboardBlocks: overrides.readClipboardBlocks ?? vi.fn(() => fragment),
  };
  const resolveOwnership = vi.fn(
    () =>
      overrides.ownership ?? {
        kind: "selection" as const,
        selection,
      },
  );
  const captureSelectionSnapshot =
    overrides.captureSelectionSnapshot ?? vi.fn(() => snapshot);
  const captureSelection =
    overrides.captureSelection ??
    vi.fn(
      (): CapturedStructuralSelection => ({
        captured: selection,
        snapshot,
        range: "range" as CapturedStructuralSelection["range"],
        graphRevision: 1,
        isCurrent: () => overrides.selectionIsCurrent ?? true,
      }),
    );
  const captureCutSelection =
    overrides.captureCutSelection ??
    vi.fn(() => {
      const captured = captureSelection();
      return captured ? { kind: "structural" as const, ...captured } : null;
    });
  const executeCut =
    overrides.executeCut ?? vi.fn(() => ({ ok: true, changed: true }));
  const executePaste =
    overrides.executePaste ?? vi.fn(() => ({ ok: true, changed: true }));
  const context = {
    editorIdentity: {},
    boundary: {
      ...boundary,
    },
    ownership: {
      resolve: resolveOwnership,
      captureSelectionSnapshot,
      captureSelection,
      captureCutSelection,
    },
    commands: {
      cut: executeCut,
      paste: executePaste,
    },
  };
  return {
    options: {
      boundary,
      resolveOwnership,
      captureSelectionSnapshot,
      captureSelection,
      captureCutSelection,
      executeCut,
      executePaste,
    },
    handlers: createEditorClipboardEventHandlers(context),
  };
}

function clipboardEvent(type: "copy" | "cut" | "paste"): ClipboardEvent {
  const event = new Event(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  Object.defineProperty(event, "clipboardData", { value: { types: [] } });
  return event as ClipboardEvent;
}
