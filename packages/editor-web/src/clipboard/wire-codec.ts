import type { RichTextDocumentNodeJson } from "@repo/editor-core/content/rich-text";
import type { BlockType } from "@repo/editor-core/document";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import {
  assertValidCanonicalBlockFragment,
  createCanonicalBlockFragment,
  createCanonicalBlockRecord,
  type CanonicalBlockFragment,
  type CanonicalBlockRecord,
} from "@repo/editor-core/editing";
import {
  validateJsonObject,
  type BlockId,
  type JsonObject,
} from "@repo/editor-core/kernel";
import type { EditorClipboardImportLimits } from "./codec-contracts.ts";
import {
  resolveEditorClipboardImportLimits,
  utf8ByteLength,
} from "./limits.ts";

function hasInvalidClipboardText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d)
      return true;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

export interface CanonicalBlockFragmentWirePayload {
  readonly kind: "repo.editor.blocks";
  readonly version: 1;
  readonly roots: readonly CanonicalBlockWireNode[];
  readonly start: CanonicalFragmentWireBoundary;
  readonly end: CanonicalFragmentWireBoundary;
}

export interface CanonicalBlockWireNode {
  readonly type: string;
  readonly metadata?: JsonObject;
  readonly content?: RichTextDocumentNodeJson;
  readonly plainText?: string;
  readonly children?: readonly CanonicalBlockWireNode[];
}

export type CanonicalFragmentWireBoundary =
  | { readonly kind: "block"; readonly path: readonly number[] }
  | { readonly kind: "text"; readonly path: readonly number[] };

export interface CanonicalBlockWireCodecOptions {
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  readonly limits?: Partial<EditorClipboardImportLimits>;
}

export function serializeCanonicalBlockFragmentWirePayload(
  fragment: CanonicalBlockFragment,
  options: CanonicalBlockWireCodecOptions,
): string {
  assertValidCanonicalBlockFragment(fragment, options);
  const limits = resolveEditorClipboardImportLimits(options.limits);
  if (fragment.blocks.length > limits.maxFragmentBlocks) {
    throw new Error("Canonical fragment exceeds the clipboard block limit.");
  }
  const blockById = new Map(fragment.blocks.map((block) => [block.id, block]));
  const childrenByParentId = new Map<BlockId, CanonicalBlockRecord[]>();
  for (const block of fragment.blocks) {
    if (block.parentId === null) continue;
    const children = childrenByParentId.get(block.parentId) ?? [];
    children.push(block);
    childrenByParentId.set(block.parentId, children);
  }
  const pathByBlockId = new Map<BlockId, readonly number[]>();
  const encodeNode = (
    block: CanonicalBlockRecord,
    path: readonly number[],
    nestingLevel: number,
  ): CanonicalBlockWireNode => {
    if (nestingLevel > limits.maxNestingDepth) {
      throw new Error("Canonical fragment exceeds the clipboard depth limit.");
    }
    pathByBlockId.set(block.id, path);
    const children = childrenByParentId.get(block.id) ?? [];
    if (children.length > limits.maxChildrenPerNode) {
      throw new Error("Canonical fragment exceeds the child-count limit.");
    }
    assertRecordResourceSizes(block, limits);
    return Object.freeze({
      type: block.type,
      ...(block.metadata === undefined ? {} : { metadata: block.metadata }),
      ...(block.content === undefined ? {} : { content: block.content }),
      ...(block.plainText === undefined ? {} : { plainText: block.plainText }),
      ...(children.length === 0
        ? {}
        : {
            children: Object.freeze(
              children.map((child, index) =>
                encodeNode(child, [...path, index], nestingLevel + 1),
              ),
            ),
          }),
    });
  };
  const roots = fragment.rootBlockIds.map((id, index) => {
    const block = blockById.get(id);
    if (!block) throw new Error(`Canonical fragment root ${id} is missing.`);
    return encodeNode(block, [index], 1);
  });
  const payload: CanonicalBlockFragmentWirePayload = Object.freeze({
    kind: "repo.editor.blocks",
    version: 1,
    roots: Object.freeze(roots),
    start: wireBoundary(fragment.start, pathByBlockId),
    end: wireBoundary(fragment.end, pathByBlockId),
  });
  const serialized = JSON.stringify(payload);
  if (utf8ByteLength(serialized) > limits.maxCanonicalPayloadBytes) {
    throw new Error("Canonical fragment exceeds the payload size limit.");
  }
  return serialized;
}

export function parseCanonicalBlockFragmentWirePayload(
  serialized: string,
  options: CanonicalBlockWireCodecOptions,
): CanonicalBlockFragment | null {
  try {
    const limits = resolveEditorClipboardImportLimits(options.limits);
    if (
      serialized.length === 0 ||
      utf8ByteLength(serialized) > limits.maxCanonicalPayloadBytes
    )
      return null;
    if (containsDuplicateJsonObjectKey(serialized)) return null;
    const parsed: unknown = JSON.parse(serialized);
    if (containsInvalidClipboardValue(parsed)) return null;
    if (!isStrictRecord(parsed, ["kind", "version", "roots", "start", "end"]))
      return null;
    if (
      parsed.kind !== "repo.editor.blocks" ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.roots) ||
      parsed.roots.length === 0
    )
      return null;
    if (!isWireBoundary(parsed.start) || !isWireBoundary(parsed.end))
      return null;

    const state = { count: 0 };
    if (
      !parsed.roots.every((node) =>
        validateWireNode(node, 1, state, options.blockDefinitions, limits),
      )
    )
      return null;
    const pathToId = new Map<string, BlockId>();
    const blocks: CanonicalBlockRecord[] = [];
    const materializeNode = (
      node: CanonicalBlockWireNode,
      parentId: BlockId | null,
      path: readonly number[],
    ): BlockId => {
      const record = createCanonicalBlockRecord({
        type: node.type as BlockType,
        parentId,
        ...(node.metadata === undefined ? {} : { metadata: node.metadata }),
        ...(node.content === undefined ? {} : { content: node.content }),
        ...(node.plainText === undefined ? {} : { plainText: node.plainText }),
      });
      blocks.push(record);
      pathToId.set(pathKey(path), record.id);
      for (const [index, child] of (node.children ?? []).entries()) {
        materializeNode(child, record.id, [...path, index]);
      }
      return record.id;
    };
    const roots = parsed.roots as CanonicalBlockWireNode[];
    const rootBlockIds = roots.map((node, index) =>
      materializeNode(node, null, [index]),
    );
    const startId = pathToId.get(pathKey(parsed.start.path));
    const endId = pathToId.get(pathKey(parsed.end.path));
    if (!startId || !endId) return null;
    return createCanonicalBlockFragment({
      blocks,
      rootBlockIds,
      start: { kind: parsed.start.kind, blockId: startId },
      end: { kind: parsed.end.kind, blockId: endId },
      blockDefinitions: options.blockDefinitions,
    });
  } catch {
    return null;
  }
}

function validateWireNode(
  value: unknown,
  nestingLevel: number,
  state: { count: number },
  definitions: Readonly<Record<BlockType, BlockDefinition>>,
  limits: EditorClipboardImportLimits,
): value is CanonicalBlockWireNode {
  if (
    nestingLevel > limits.maxNestingDepth ||
    !isStrictRecord(value, [
      "type",
      "metadata",
      "content",
      "plainText",
      "children",
    ]) ||
    typeof value.type !== "string" ||
    value.type.length === 0 ||
    !definitions[value.type as BlockType]
  )
    return false;
  state.count += 1;
  if (state.count > limits.maxFragmentBlocks) return false;
  if (value.metadata !== undefined) {
    if (
      validateJsonObject(value.metadata, "wire metadata").length > 0 ||
      utf8ByteLength(JSON.stringify(value.metadata)) > limits.maxMetadataBytes
    )
      return false;
  }
  if (
    value.content !== undefined &&
    (!isRecord(value.content) ||
      utf8ByteLength(JSON.stringify(value.content)) > limits.maxRichTextBytes)
  )
    return false;
  if (value.plainText !== undefined && typeof value.plainText !== "string")
    return false;
  if (value.children !== undefined) {
    if (
      !Array.isArray(value.children) ||
      value.children.length > limits.maxChildrenPerNode
    )
      return false;
    if (
      !value.children.every((child) =>
        validateWireNode(child, nestingLevel + 1, state, definitions, limits),
      )
    )
      return false;
  }
  return true;
}

function wireBoundary(
  boundary: CanonicalBlockFragment["start"],
  paths: ReadonlyMap<BlockId, readonly number[]>,
): CanonicalFragmentWireBoundary {
  const path = paths.get(boundary.blockId);
  if (!path) throw new Error("Canonical fragment boundary target is missing.");
  return Object.freeze({ kind: boundary.kind, path: Object.freeze([...path]) });
}

function isWireBoundary(
  value: unknown,
): value is CanonicalFragmentWireBoundary {
  return (
    isStrictRecord(value, ["kind", "path"]) &&
    (value.kind === "block" || value.kind === "text") &&
    Array.isArray(value.path) &&
    value.path.length > 0 &&
    value.path.every(
      (entry) => Number.isSafeInteger(entry) && Number(entry) >= 0,
    )
  );
}

function assertRecordResourceSizes(
  block: CanonicalBlockRecord,
  limits: EditorClipboardImportLimits,
): void {
  if (
    block.metadata !== undefined &&
    utf8ByteLength(JSON.stringify(block.metadata)) > limits.maxMetadataBytes
  )
    throw new Error("Canonical block metadata exceeds the clipboard limit.");
  if (
    block.content !== undefined &&
    utf8ByteLength(JSON.stringify(block.content)) > limits.maxRichTextBytes
  )
    throw new Error("Canonical rich-text content exceeds the clipboard limit.");
}

function pathKey(path: readonly number[]): string {
  return path.join("/");
}

function isStrictRecord(
  value: unknown,
  allowedFields: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const allowed = new Set(allowedFields);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function containsInvalidClipboardValue(value: unknown): boolean {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "string") {
      if (hasInvalidClipboardText(current)) return true;
      continue;
    }
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    if (!isRecord(current)) continue;
    for (const [key, child] of Object.entries(current)) {
      if (
        key === "__proto__" ||
        key === "constructor" ||
        key === "prototype" ||
        hasInvalidClipboardText(key)
      )
        return true;
      pending.push(child);
    }
  }
  return false;
}

function containsDuplicateJsonObjectKey(source: string): boolean {
  let position = 0;
  let duplicate = false;

  const skipWhitespace = () => {
    while (
      position < source.length &&
      (source[position] === " " ||
        source[position] === "\n" ||
        source[position] === "\r" ||
        source[position] === "\t")
    ) {
      position += 1;
    }
  };

  const parseString = (): string | null => {
    if (source[position] !== '"') return null;
    const start = position;
    position += 1;
    while (position < source.length) {
      const character = source[position]!;
      if (character === "\\") {
        position += 2;
        continue;
      }
      position += 1;
      if (character === '"') {
        try {
          const value: unknown = JSON.parse(source.slice(start, position));
          return typeof value === "string" ? value : null;
        } catch {
          return null;
        }
      }
    }
    return null;
  };

  const parseScalar = (): boolean => {
    const start = position;
    while (
      position < source.length &&
      source[position] !== "," &&
      source[position] !== "]" &&
      source[position] !== "}" &&
      source[position] !== " " &&
      source[position] !== "\n" &&
      source[position] !== "\r" &&
      source[position] !== "\t"
    ) {
      position += 1;
    }
    if (position === start) return false;
    try {
      JSON.parse(source.slice(start, position));
      return true;
    } catch {
      return false;
    }
  };

  const parseValue = (): boolean => {
    skipWhitespace();
    if (source[position] === "{") return parseObject();
    if (source[position] === "[") return parseArray();
    if (source[position] === '"') return parseString() !== null;
    return parseScalar();
  };

  const parseObject = (): boolean => {
    position += 1;
    skipWhitespace();
    if (source[position] === "}") {
      position += 1;
      return true;
    }
    const keys = new Set<string>();
    while (position < source.length) {
      skipWhitespace();
      const key = parseString();
      if (key === null) return false;
      if (keys.has(key)) duplicate = true;
      keys.add(key);
      skipWhitespace();
      if (source[position] !== ":") return false;
      position += 1;
      if (!parseValue()) return false;
      skipWhitespace();
      if (source[position] === "}") {
        position += 1;
        return true;
      }
      if (source[position] !== ",") return false;
      position += 1;
    }
    return false;
  };

  const parseArray = (): boolean => {
    position += 1;
    skipWhitespace();
    if (source[position] === "]") {
      position += 1;
      return true;
    }
    while (position < source.length) {
      if (!parseValue()) return false;
      skipWhitespace();
      if (source[position] === "]") {
        position += 1;
        return true;
      }
      if (source[position] !== ",") return false;
      position += 1;
    }
    return false;
  };

  const valid = parseValue();
  skipWhitespace();
  return valid && position === source.length && duplicate;
}
