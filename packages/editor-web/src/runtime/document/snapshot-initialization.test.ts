import { describe, expect, it } from "vitest";
import { cloneJsonValue, type BlockId } from "@repo/editor-core/kernel";
import { validateEditorInstanceSnapshotAtBoundary } from "@repo/editor-core/codecs";
import { createTestEditorSnapshot } from "../../tests/editor-snapshot-fixtures.ts";
import { testEditableEditorDefinition } from "../../tests/test-editor-definition.ts";
import { assertValidEditorSnapshotForStartupOrRecovery } from "./snapshot-initialization.ts";
import { compileCanonicalEditorDefinition } from "../definition/compiled-editor-definition.ts";
import { initializeTestEditableEditor } from "../../tests/test-editor-initializers.ts";

describe("definition-aware snapshot ingress", () => {
  it("initializes from validated ownership after the source is mutated", () => {
    const blockId = "snapshot-owned-paragraph" as BlockId;
    const fixture = createTestEditorSnapshot([
      { id: blockId, type: "paragraph", text: "before" },
    ]);
    const content = cloneJsonValue(fixture.content[blockId]!);
    const rootBlockIds = [...fixture.rootBlockIds];
    const source = {
      ...fixture,
      rootBlockIds,
      content: { [blockId]: content },
    };
    const validated = validateEditorInstanceSnapshotAtBoundary(source, {
      blockDefinitions: testEditableEditorDefinition.blocks,
      inlineMarks: testEditableEditorDefinition.inlineMarks,
      inlineAtoms: testEditableEditorDefinition.inlineAtoms,
    });

    rootBlockIds.length = 0;
    const text = content.content[0]?.content?.[0];
    if (text?.type === "text") text.text = "after";
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: source,
      validatedSnapshot: validated,
    });

    expect(editor.getRootBlockIds()).toStrictEqual([blockId]);
    expect(editor.readBlockContent(blockId, "paragraph")).toMatchObject({
      content: [{ content: [{ text: "before" }] }],
    });
    editor.dispose();
  });

  it("accepts a valid semantic snapshot", () => {
    expect(() =>
      assertValidEditorSnapshotForStartupOrRecovery(
        createTestEditorSnapshot([
          {
            id: "snapshot-valid-paragraph" as BlockId,
            type: "paragraph",
            text: "valid",
          },
        ]),
        compileCanonicalEditorDefinition(testEditableEditorDefinition),
      ),
    ).not.toThrow();
  });

  it("accepts canonical atom metadata and rejects retired mention attrs", () => {
    const blockId = "snapshot-valid-mention" as BlockId;
    const definition = {
      ...testEditableEditorDefinition,
      inlineAtoms: [
        {
          type: "mention",
          metadata: { id: { type: "string", required: true } },
          render: () => null,
        },
      ],
    };
    const canonical = createTestEditorSnapshot([
      {
        id: blockId,
        type: "paragraph",
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "mention", metadata: { id: "user-123" } }],
            },
          ],
        },
      },
    ]);

    expect(() =>
      assertValidEditorSnapshotForStartupOrRecovery(
        canonical,
        compileCanonicalEditorDefinition(definition),
      ),
    ).not.toThrow();
    const retired = {
      ...canonical,
      content: {
        [blockId]: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "mention",
                  attrs: { id: "user-123", label: "Ada" },
                },
              ],
            },
          ],
        },
      },
    };
    expect(() =>
      assertValidEditorSnapshotForStartupOrRecovery(
        retired as never,
        compileCanonicalEditorDefinition(definition),
      ),
    ).toThrow(/attrs|metadata/i);
  });

  it("rejects children installed beneath a leaf definition", () => {
    const parentId = "snapshot-leaf-parent" as BlockId;
    const childId = "snapshot-leaf-child" as BlockId;
    const flat = createTestEditorSnapshot([
      { id: parentId, type: "paragraph", text: "parent" },
      { id: childId, type: "paragraph", text: "child" },
    ]);
    const invalid = {
      ...flat,
      blocks: {
        ...flat.blocks,
        [childId]: { ...flat.blocks[childId]!, parentId },
      },
      rootBlockIds: [parentId],
      childIdsByParentId: { [parentId]: [childId] },
    };

    expect(() =>
      assertValidEditorSnapshotForStartupOrRecovery(
        invalid,
        compileCanonicalEditorDefinition(testEditableEditorDefinition),
      ),
    ).toThrow(/violate the direct paragraph content definition/u);
  });

  it("rejects a forbidden child type at the same public gate", () => {
    const parentId = "snapshot-wrapper-parent" as BlockId;
    const childId = "snapshot-wrapper-child" as BlockId;
    const flat = createTestEditorSnapshot([
      { id: parentId, type: "quote" },
      { id: childId, type: "heading", text: "heading" },
    ]);
    const invalid = {
      ...flat,
      blocks: {
        ...flat.blocks,
        [childId]: { ...flat.blocks[childId]!, parentId },
      },
      rootBlockIds: [parentId],
      childIdsByParentId: { [parentId]: [childId] },
    };

    expect(() =>
      assertValidEditorSnapshotForStartupOrRecovery(
        invalid,
        compileCanonicalEditorDefinition(testEditableEditorDefinition),
      ),
    ).toThrow(/violate the direct quote content definition/u);
  });
});
