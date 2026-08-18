import { describe, expect, it } from "vitest";
import {
  boldMarkDefinition,
  codeMarkDefinition,
  italicMarkDefinition,
  linkMarkDefinition,
  strikethroughMarkDefinition,
  underlineMarkDefinition,
} from "@repo/editor-core/content/marks";
import { createBlockLocalProseMirrorState } from "../block-editor/state/create-block-local-state.ts";
import { createInlineMarkCommandDefinitions } from "./inline/command-definitions.ts";
import { executeInlineMarkCommand } from "./inline/command-execution.ts";
import { readInlineMarkCommandState } from "./inline/command-state.ts";
import { parseBlockLocalProseMirrorDocument } from "../schema/block-local/document-parsing.ts";
import {
  blockLocalProseMirrorSchema,
  createBlockLocalProseMirrorSchema,
} from "../schema/block-local/schema.ts";
import {
  canonicalRichTextToProseMirrorJson,
  proseMirrorRichTextToCanonicalJson,
} from "../schema/inline/atom-json.ts";
import {
  testBlockId,
  textStart,
  withCaret,
} from "../testing/block-editor-test-support.ts";

const testInlineMarks = [
  boldMarkDefinition,
  italicMarkDefinition,
  linkMarkDefinition,
  codeMarkDefinition,
  underlineMarkDefinition,
  strikethroughMarkDefinition,
] as const;
const testInlineMarkSchema = createBlockLocalProseMirrorSchema({
  inlineMarks: testInlineMarks,
});
const testInlineAtoms = [{ type: "mention" }, { type: "emoji" }] as const;

describe("inline command registry", () => {
  it("derives ProseMirror marks and atoms from model contracts", () => {
    expect(Object.keys(blockLocalProseMirrorSchema.marks)).toStrictEqual([]);
    expect(Object.keys(testInlineMarkSchema.marks).sort()).toStrictEqual(
      testInlineMarks.map((definition) => definition.name).sort(),
    );
    const inlineAtomSchema = createBlockLocalProseMirrorSchema({
      inlineAtoms: testInlineAtoms,
    });
    for (const atom of testInlineAtoms) {
      const nodeType = inlineAtomSchema.nodes[atom.type];
      expect(nodeType).toBeDefined();
      expect(nodeType?.spec.attrs).toStrictEqual({ metadata: {} });
    }

    for (const definition of createInlineMarkCommandDefinitions(
      testInlineMarks,
    )) {
      expect(definition).not.toHaveProperty("keybindings");
    }
  });

  it("keeps mark command definitions free of keyboard policy", () => {
    expect(
      createInlineMarkCommandDefinitions(testInlineMarks)
        .filter((definition) => definition.kind === "set-mark-value")
        .map((definition) => definition.id),
    ).toStrictEqual(["inline.mark.link.set"]);
  });

  it("maps only the generic canonical metadata field into ProseMirror attrs", () => {
    const canonical = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "mention", metadata: { id: "user-123" } }],
        },
      ],
    } as const;
    expect(canonicalRichTextToProseMirrorJson(canonical)).toStrictEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "mention",
              attrs: { metadata: { id: "user-123" } },
            },
          ],
        },
      ],
    });

    const doc = parseBlockLocalProseMirrorDocument(
      canonical,
      "paragraph",
      createBlockLocalProseMirrorSchema({
        inlineAtoms: testInlineAtoms,
      }),
    );
    expect(proseMirrorRichTextToCanonicalJson(doc.toJSON())).toStrictEqual(
      canonical,
    );
  });

  it("reports caret inline mark command state", () => {
    const active = withCaret(
      createBlockLocalProseMirrorState({
        blockId: testBlockId,
        blockType: "paragraph",
        schema: testInlineMarkSchema,
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "abc", marks: [{ type: "strong" }] },
              ],
            },
          ],
        },
      }),
      textStart() + 1,
    );
    expect(
      readInlineMarkCommandState(active, boldMarkDefinition),
    ).toMatchObject({ canExecute: true, active: true, mixed: false });

    const inactive = withCaret(
      createBlockLocalProseMirrorState({
        blockId: testBlockId,
        blockType: "paragraph",
        schema: testInlineMarkSchema,
        doc: "abc",
      }),
      textStart(),
    );
    expect(
      readInlineMarkCommandState(inactive, boldMarkDefinition),
    ).toMatchObject({ canExecute: true, active: false, mixed: false });

    const neutralTextBlock = withCaret(
      createBlockLocalProseMirrorState({
        blockId: testBlockId,
        blockType: "paragraph",
        schema: testInlineMarkSchema,
        doc: "abc",
      }),
      textStart(),
    );
    expect(
      readInlineMarkCommandState(neutralTextBlock, boldMarkDefinition),
    ).toMatchObject({ canExecute: true, active: false, mixed: false });
  });

  it("toggles stored marks at the caret", () => {
    let state = withCaret(
      createBlockLocalProseMirrorState({
        blockId: testBlockId,
        blockType: "paragraph",
        schema: testInlineMarkSchema,
        doc: "abc",
      }),
      textStart(),
    );

    expect(
      executeInlineMarkCommand(
        state,
        (transaction) => {
          state = state.apply(transaction);
        },
        boldMarkDefinition,
        { action: "toggle" },
      ),
    ).toBe(true);
    const strong = state.schema.marks.strong;
    expect(strong).toBeDefined();
    expect(strong!.isInSet(state.storedMarks ?? [])).toBeTruthy();

    expect(
      executeInlineMarkCommand(
        state,
        (transaction) => {
          state = state.apply(transaction);
        },
        boldMarkDefinition,
        { action: "toggle" },
      ),
    ).toBe(true);
    expect(strong!.isInSet(state.storedMarks ?? [])).toBeFalsy();
  });

  it("uses registry-owned value sanitization for link commands at the caret", () => {
    let state = withCaret(
      createBlockLocalProseMirrorState({
        blockId: testBlockId,
        blockType: "paragraph",
        schema: testInlineMarkSchema,
        doc: "abc",
      }),
      textStart(),
    );

    expect(
      readInlineMarkCommandState(state, linkMarkDefinition, {
        href: "javascript:alert(1)",
      }),
    ).toMatchObject({
      canExecute: false,
      reason: "invalid-attrs",
    });
    expect(
      executeInlineMarkCommand(
        state,
        (transaction) => {
          state = state.apply(transaction);
        },
        linkMarkDefinition,
        { action: "add", attrs: { href: "example.test", title: "Example" } },
      ),
    ).toBe(true);
    expect(readInlineMarkCommandState(state, linkMarkDefinition)).toMatchObject(
      {
        active: true,
        value: { href: "https://example.test", title: "Example" },
      },
    );
    expect(
      executeInlineMarkCommand(
        state,
        (transaction) => {
          state = state.apply(transaction);
        },
        linkMarkDefinition,
        { action: "remove" },
      ),
    ).toBe(true);
    expect(readInlineMarkCommandState(state, linkMarkDefinition)).toMatchObject(
      {
        active: false,
        value: null,
      },
    );
  });

  it("derives command definitions only for supplied inline marks", () => {
    expect(
      createInlineMarkCommandDefinitions([boldMarkDefinition]).map(
        (definition) => definition.markName,
      ),
    ).toStrictEqual(["strong"]);
  });
});
