import {
  assertValidEditorInstanceSnapshot,
  type EditorInstanceSnapshot,
  type ValidatedEditorInstanceSnapshot,
} from "@repo/editor-core/codecs";
import {
  blocksHaveEqualCanonicalState,
  getCanonicalBlockOrder,
  type Block,
  type BlockType,
  type VersionedBlock,
} from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import { validateStructuralDocument } from "@repo/editor-core/editing";
import type { EditorContentRuntimeSource } from "@repo/editor-core/content";
import { validateEditorInlineAtomOccurrence } from "../definition/inline-atoms.ts";
import type { EditableEditorDefinition } from "../definition/contracts.ts";
import type { CompiledCanonicalEditorDefinition } from "../definition/compiled-editor-definition.ts";

export function createEditorContentStartup(
  snapshot: EditorInstanceSnapshot,
  definition: EditableEditorDefinition,
  validatedSnapshot?: ValidatedEditorInstanceSnapshot,
): EditorContentRuntimeSource {
  if (validatedSnapshot && validatedSnapshot.snapshot !== snapshot) {
    throw new Error(
      "Validated editor snapshot evidence does not match its snapshot",
    );
  }
  return {
    blockDefinitions: definition.blocks,
    inlineMarks: definition.inlineMarks,
    inlineAtoms: definition.inlineAtoms,
    blockGraphVersion: snapshot.blockGraphVersion,
    blockTypesById: blockTypesForSnapshot(snapshot),
    opaqueContentCheckpoints: snapshot.opaqueContentCheckpoints,
    contentById: validatedSnapshot
      ? validatedSnapshot.canonicalContent
      : { ...snapshot.content },
  };
}

export function materializeVersionedEditorBlocks(
  blocks: Readonly<Record<BlockId, Block>>,
  blockGraphVersion: number,
  blockDefinitions: EditableEditorDefinition["blocks"],
  previousBlocks: Readonly<Record<BlockId, VersionedBlock>> = {},
): Record<BlockId, VersionedBlock> {
  const metadataVersion = `v${blockGraphVersion}`;
  const contentVersion = metadataVersion as VersionedBlock["contentVersion"];
  return Object.fromEntries(
    Object.entries(blocks).map(([blockId, block]) => {
      const previous = previousBlocks[blockId as BlockId];
      const unchanged =
        previous !== undefined &&
        blocksHaveEqualCanonicalState(previous, block);
      return [
        blockId,
        {
          ...block,
          metadataVersion: unchanged
            ? previous.metadataVersion
            : metadataVersion,
          contentVersion:
            blockDefinitions[block.type]?.kind === "text"
              ? unchanged
                ? previous.contentVersion
                : contentVersion
              : null,
        } satisfies VersionedBlock,
      ];
    }),
  ) as Record<BlockId, VersionedBlock>;
}

export function assertValidEditorSnapshotForStartupOrRecovery(
  snapshot: EditorInstanceSnapshot,
  compiledDefinition: CompiledCanonicalEditorDefinition,
): void {
  const definition = compiledDefinition.definition;
  assertValidEditorInstanceSnapshot(snapshot, {
    blockDefinitions: definition.blocks,
    inlineMarks: definition.inlineMarks,
    inlineAtoms: definition.inlineAtoms,
  });
  const structuralValidation = validateStructuralDocument({
    blocks: snapshot.blocks,
    rootBlockIds: snapshot.rootBlockIds,
    childIdsByParentId: snapshot.childIdsByParentId,
    blockDefinitions: definition.blocks,
    validators: definition.documentValidators,
    readContent: (blockId) => {
      const content = snapshot.content[blockId];
      if (content === undefined) return null;
      return {
        content,
        plainText: "",
        version: null,
      };
    },
  });
  if (!structuralValidation.valid) {
    throw new Error(
      `Editor snapshot is structurally invalid: ${structuralValidation.issues
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }
  assertSnapshotInlineAtomsSupported(snapshot, compiledDefinition);
  assertSnapshotInlineMarksSupported(snapshot, definition);
}

function blockTypesForSnapshot(
  snapshot: EditorInstanceSnapshot,
): Record<BlockId, BlockType> {
  const blockTypesById = {} as Record<BlockId, BlockType>;
  for (const blockId of getCanonicalBlockOrder(snapshot)) {
    const block = snapshot.blocks[blockId];
    if (block) blockTypesById[blockId] = block.type;
  }
  return blockTypesById;
}

function assertSnapshotInlineMarksSupported(
  snapshot: EditorInstanceSnapshot,
  definition: EditableEditorDefinition,
): void {
  const supportedInlineMarks = new Set(
    definition.inlineMarks.map((mark) => mark.name),
  );
  const unsupported = new Set<string>();
  for (const blockId of getCanonicalBlockOrder(snapshot)) {
    collectUnsupportedInlineMarks(
      snapshot.content[blockId],
      supportedInlineMarks,
      unsupported,
    );
  }
  if (unsupported.size > 0) {
    throw new Error(
      `Editor definition does not support inline marks: ${[...unsupported].sort().join(", ")}.`,
    );
  }
}

function assertSnapshotInlineAtomsSupported(
  snapshot: EditorInstanceSnapshot,
  compiledDefinition: CompiledCanonicalEditorDefinition,
): void {
  for (const blockId of getCanonicalBlockOrder(snapshot)) {
    validateSnapshotInlineAtoms(
      snapshot.content[blockId],
      compiledDefinition,
      `snapshot.content.${blockId}`,
    );
  }
}

function validateSnapshotInlineAtoms(
  value: unknown,
  compiledDefinition: CompiledCanonicalEditorDefinition,
  label: string,
): void {
  if (!isRecord(value)) return;
  if (Array.isArray(value.content)) {
    value.content.forEach((entry, index) => {
      if (!isRecord(entry)) return;
      const childLabel = `${label}.content[${index}]`;
      if (
        typeof entry.type === "string" &&
        entry.type !== "paragraph" &&
        entry.type !== "text" &&
        entry.type !== "hard_break"
      ) {
        validateEditorInlineAtomOccurrence(
          compiledDefinition,
          entry,
          childLabel,
        );
      }
      validateSnapshotInlineAtoms(entry, compiledDefinition, childLabel);
    });
  }
}

function collectUnsupportedInlineMarks(
  value: unknown,
  supportedInlineMarks: ReadonlySet<string>,
  unsupported: Set<string>,
): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectUnsupportedInlineMarks(entry, supportedInlineMarks, unsupported);
    }
    return;
  }
  if (!isRecord(value)) return;
  if (Array.isArray(value.marks)) {
    for (const mark of value.marks) {
      if (!isRecord(mark) || typeof mark.type !== "string") continue;
      if (!supportedInlineMarks.has(mark.type)) unsupported.add(mark.type);
    }
  }
  for (const entry of Object.values(value)) {
    collectUnsupportedInlineMarks(entry, supportedInlineMarks, unsupported);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
