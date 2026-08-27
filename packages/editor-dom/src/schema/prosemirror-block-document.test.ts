import { describe, expect, it } from "vitest";
import {
  boldMarkDefinition,
  linkMarkDefinition,
} from "@repo/editor-core/content/marks";
import { createBlockLocalProseMirrorState } from "../block-editor/state/create-block-local-state.ts";
import {
  createEmptyBlockLocalProseMirrorDocument,
  createTextBlockLocalProseMirrorDocument,
} from "./block-local/document-materialization.ts";
import {
  materializeCanonicalBlockLocalProseMirrorDocument,
  parseBlockLocalProseMirrorDocument,
} from "./block-local/document-parsing.ts";
import {
  blockLocalProseMirrorSchema,
  createBlockLocalProseMirrorSchema,
} from "./block-local/schema.ts";
import { testBlockId } from "../testing/block-editor-test-support.ts";

describe("neutral block-local state and schema", () => {
  it("uses one paragraph-shaped rich-text node for every opaque text type", () => {
    for (const blockType of ["textBlock", "alternateTextBlock"]) {
      const state = createBlockLocalProseMirrorState({
        blockId: testBlockId,
        blockType,
        doc: "Roadmap",
      });
      expect(state.doc.firstChild?.type.name).toBe("paragraph");
      expect(state.doc.textContent).toBe("Roadmap");
    }
  });

  it("parses canonical JSON and falls back to an empty neutral document", () => {
    const text = createTextBlockLocalProseMirrorDocument(
      "textBlock",
      "const x = 1;",
    );
    expect(
      parseBlockLocalProseMirrorDocument(text.toJSON(), "alternateTextBlock")
        .textContent,
    ).toBe("const x = 1;");
    expect(
      parseBlockLocalProseMirrorDocument(
        { type: "unknown" },
        "alternateTextBlock",
      ).firstChild?.type.name,
    ).toBe("paragraph");
    expect(
      createEmptyBlockLocalProseMirrorDocument("textBlock").firstChild?.type
        .name,
    ).toBe("paragraph");
  });

  it("materializes canonical text without type-sensitive attrs", () => {
    const canonical = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Neutral text" }],
        },
      ],
    } as const;
    const doc = materializeCanonicalBlockLocalProseMirrorDocument(
      canonical,
      "alternateTextBlock",
    );
    expect(doc.firstChild?.type.name).toBe("paragraph");
    expect(doc.firstChild?.attrs).toEqual({});
    expect(doc.textContent).toBe("Neutral text");
  });

  it("keeps optional inline marks and atoms definition-driven", () => {
    expect(blockLocalProseMirrorSchema.marks.strong).toBeUndefined();
    const markSchema = createBlockLocalProseMirrorSchema({
      inlineMarks: [boldMarkDefinition, linkMarkDefinition],
    });
    expect(markSchema.marks.strong).toBeDefined();
    expect(markSchema.marks.link).toBeDefined();
    const atomSchema = createBlockLocalProseMirrorSchema({
      inlineAtoms: [{ type: "inlineAtom" }],
    });
    expect(atomSchema.nodes.inlineAtom).toBeDefined();
  });
});
