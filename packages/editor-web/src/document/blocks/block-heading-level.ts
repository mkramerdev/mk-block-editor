import {
  normalizeHeadingLevel,
  type VersionedBlock,
} from "@repo/editor-core/document";

export { normalizeHeadingLevel } from "@repo/editor-core/document";

export function blockHeadingLevel(
  block: Pick<VersionedBlock, "type" | "metadata"> | null | undefined,
): string | undefined {
  if (!block || block.type !== "heading") return undefined;
  return String(normalizeHeadingLevel(block.metadata?.level));
}
