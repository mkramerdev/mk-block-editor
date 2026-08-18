import { describe, expect, it } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import { createTestEditorSnapshot } from "../../tests/editor-snapshot-fixtures.ts";
import { testEditableEditorDefinition } from "../../tests/test-editor-definition.ts";
import { assertValidEditorSnapshotForStartupOrRecovery } from "./snapshot-initialization.ts";
import { compileCanonicalEditorDefinition } from "../definition/compiled-editor-definition.ts";

describe("definition-aware snapshot ingress", () => {
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
