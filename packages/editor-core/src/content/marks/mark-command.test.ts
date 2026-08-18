import { describe, expect, it } from "vitest";
import {
  combineInlineMarkCommandStates,
  createInlineMarkCommandStateFromRange,
  createInlineMarkCursorCommandState,
  distinctInlineMarkValues,
  inactiveInlineMarkCommandState,
  inlineMarkValuesEqual,
  planInlineMarkCommand,
  resolveInlineMarkCommandAction,
  resolveInlineMarkCommandAttrs,
  validateInlineMarkCommandAttrs,
  type InlineMarkCommandRangeSegment,
} from "./mark-command.ts";
import { boldMarkDefinition, linkMarkDefinition } from "./schema.ts";

describe("inline mark command semantics", () => {
  it("creates inactive, active, and mixed states from command range segments", () => {
    expect(
      createInlineMarkCommandStateFromRange(boldMarkDefinition, []),
    ).toStrictEqual(
      inactiveInlineMarkCommandState(boldMarkDefinition, "empty-range"),
    );

    expect(
      createInlineMarkCommandStateFromRange(linkMarkDefinition, [
        textSegment(0, 1, "a", { href: "/a" }),
        textSegment(1, 2, "b", { href: "/a" }),
      ]),
    ).toStrictEqual({
      markName: "link",
      commandId: "inline.mark.link.set",
      canExecute: true,
      active: true,
      mixed: false,
      value: { href: "/a" },
    });

    expect(
      createInlineMarkCommandStateFromRange(linkMarkDefinition, [
        textSegment(0, 1, "a", { href: "/a" }),
        textSegment(1, 2, "b", { href: "/b" }),
        textSegment(2, 3, "c", null),
      ]),
    ).toStrictEqual({
      markName: "link",
      commandId: "inline.mark.link.set",
      canExecute: true,
      active: false,
      mixed: true,
      value: null,
    });
  });

  it("resolves cursor state, toggle actions, and mark attrs exactly", () => {
    expect(
      createInlineMarkCursorCommandState(boldMarkDefinition, {}),
    ).toStrictEqual({
      markName: "strong",
      commandId: "inline.mark.strong.toggle",
      canExecute: true,
      active: true,
      mixed: false,
      value: {},
    });
    expect(
      resolveInlineMarkCommandAction({ active: true, mixed: false }, undefined),
    ).toBe("remove");
    expect(
      resolveInlineMarkCommandAction({ active: true, mixed: true }, "toggle"),
    ).toBe("add");
    expect(
      resolveInlineMarkCommandAction({ active: false, mixed: false }, "remove"),
    ).toBe("remove");
    expect(
      resolveInlineMarkCommandAttrs(boldMarkDefinition, "add", undefined),
    ).toStrictEqual({});
    expect(
      resolveInlineMarkCommandAttrs(linkMarkDefinition, "add", {
        href: "https://example.test",
        title: 7,
      }),
    ).toStrictEqual({
      href: "https://example.test",
      title: "7",
      target: null,
    });
    expect(
      resolveInlineMarkCommandAttrs(linkMarkDefinition, "add", {
        href: "javascript:alert(1)",
      }),
    ).toBeNull();
    expect(
      resolveInlineMarkCommandAttrs(linkMarkDefinition, "remove", {
        href: "javascript:alert(1)",
      }),
    ).toStrictEqual({});
    expect(
      validateInlineMarkCommandAttrs(linkMarkDefinition, {
        href: "https://example.test",
      }),
    ).toBe(true);
    expect(
      validateInlineMarkCommandAttrs(linkMarkDefinition, {
        href: "javascript:alert(1)",
      }),
    ).toBe(false);
  });

  it("plans canonical markable ranges for text content only", () => {
    const cases: readonly {
      name: string;
      segments: readonly InlineMarkCommandRangeSegment[];
      canExecute: boolean;
      ranges: readonly { from: number; to: number }[];
    }[] = [
      { name: "empty range", segments: [], canExecute: false, ranges: [] },
      {
        name: "whitespace-only range",
        segments: [textSegment(0, 3, " \t ")],
        canExecute: false,
        ranges: [],
      },
      {
        name: "text range",
        segments: [textSegment(0, 4, "text")],
        canExecute: true,
        ranges: [{ from: 0, to: 4 }],
      },
      {
        name: "hard break range",
        segments: [{ from: 0, to: 1, kind: "hard-break" }],
        canExecute: false,
        ranges: [],
      },
      {
        name: "inline atom-only range",
        segments: [{ from: 0, to: 1, kind: "inline-atom" }],
        canExecute: false,
        ranges: [],
      },
      {
        name: "mixed text plus atom range",
        segments: [
          textSegment(0, 2, "hi"),
          { from: 2, to: 3, kind: "inline-atom" },
        ],
        canExecute: true,
        ranges: [{ from: 0, to: 2 }],
      },
    ];

    for (const testCase of cases) {
      const state = createInlineMarkCommandStateFromRange(
        boldMarkDefinition,
        testCase.segments,
      );
      expect({
        name: testCase.name,
        canExecute: state.canExecute,
      }).toStrictEqual({
        name: testCase.name,
        canExecute: testCase.canExecute,
      });
      expect(
        planInlineMarkCommand({
          definition: boldMarkDefinition,
          segments: testCase.segments,
          action: "add",
        })?.ranges ?? [],
      ).toStrictEqual(testCase.ranges);
    }
  });

  it("combines range states without adapter-owned mixed or value logic", () => {
    expect(
      combineInlineMarkCommandStates(boldMarkDefinition, [
        createInlineMarkCommandStateFromRange(boldMarkDefinition, [
          textSegment(0, 1, "a", {}),
        ]),
        createInlineMarkCommandStateFromRange(boldMarkDefinition, [
          textSegment(0, 1, "b"),
        ]),
      ]),
    ).toMatchObject({
      canExecute: true,
      active: false,
      mixed: true,
      value: null,
    });
  });

  it("compares and deduplicates mark values without mutating inputs", () => {
    const value = { href: "/a", title: "A" };
    const distinct = distinctInlineMarkValues([
      value,
      { title: "A", href: "/a" },
      { href: "/b" },
    ]);

    expect(
      inlineMarkValuesEqual(
        { href: "/a", title: "A" },
        { title: "A", href: "/a" },
      ),
    ).toBe(true);
    expect(
      inlineMarkValuesEqual({ href: "/a" }, { href: "/a", title: "A" }),
    ).toBe(false);
    expect(inlineMarkValuesEqual(null, null)).toBe(true);
    expect(inlineMarkValuesEqual(null, {})).toBe(false);
    expect(distinct).toStrictEqual([
      { href: "/a", title: "A" },
      { href: "/b" },
    ]);
    expect(distinct[0]).not.toBe(value);
  });
});

function textSegment(
  from: number,
  to: number,
  text: string,
  markAttrs: Readonly<Record<string, unknown>> | null = null,
): InlineMarkCommandRangeSegment {
  return {
    from,
    to,
    kind: "text",
    text,
    markAttrs,
  };
}
