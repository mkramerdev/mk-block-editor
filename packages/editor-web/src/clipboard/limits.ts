import type { EditorClipboardImportLimits } from "./codec-contracts.ts";

export const DEFAULT_EDITOR_CLIPBOARD_IMPORT_LIMITS: EditorClipboardImportLimits =
  Object.freeze({
    maxCanonicalPayloadBytes: 1_048_576,
    maxHtmlBytes: 2_097_152,
    maxPlainTextBytes: 1_048_576,
    maxFragmentBlocks: 5_000,
    maxNestingDepth: 64,
    maxMetadataBytes: 65_536,
    maxRichTextBytes: 262_144,
    maxChildrenPerNode: 1_000,
  });

export function resolveEditorClipboardImportLimits(
  limits?: Partial<EditorClipboardImportLimits>,
): EditorClipboardImportLimits {
  const resolved = { ...DEFAULT_EDITOR_CLIPBOARD_IMPORT_LIMITS, ...limits };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(
        `Clipboard import limit ${name} must be a positive integer.`,
      );
    }
  }
  return resolved;
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function hasInvalidClipboardText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d)
      return true;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}
