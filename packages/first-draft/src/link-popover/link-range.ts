import {
  findInlineMarkDefinition,
  inlineMarkValuesEqual,
  sanitizeInlineMarkAttrs,
  type InlineMarkDefinition,
} from "@repo/editor-core/content/marks";
import {
  richInlineNodeSize,
  richTextBlockInlineContent,
  type RichTextInlineNodeJson,
} from "@repo/editor-core/content/rich-text";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditableEditor } from "@repo/editor-web/editor";

export interface FirstDraftLinkAttributes {
  readonly [key: string]: string | null;
  readonly href: string;
  readonly title: string | null;
  readonly target: string | null;
}

export interface FirstDraftResolvedLink {
  readonly blockId: BlockId;
  readonly range: { readonly from: number; readonly to: number };
  readonly attrs: FirstDraftLinkAttributes;
}

interface CanonicalLinkSegment {
  readonly node: RichTextInlineNodeJson;
  readonly from: number;
  readonly to: number;
  readonly attrs: FirstDraftLinkAttributes | null;
}

export function resolveFirstDraftLinkAtRange(
  editor: Pick<EditableEditor, "definition" | "getBlock" | "readBlockContent">,
  blockId: BlockId,
  candidate: { readonly from: number; readonly to: number },
): FirstDraftResolvedLink | null {
  if (
    !Number.isSafeInteger(candidate.from) ||
    !Number.isSafeInteger(candidate.to) ||
    candidate.from < 0 ||
    candidate.to <= candidate.from
  ) {
    return null;
  }
  const block = editor.getBlock(blockId);
  if (!block || block.tombstone) return null;
  const content = editor.readBlockContent(blockId, block.type);
  const definition = findInlineMarkDefinition(
    editor.definition.inlineMarks,
    "link",
  );
  if (!content || !definition) return null;

  const segments = linkSegments(
    richTextBlockInlineContent(content),
    definition,
  );
  const canonicalLength = segments.at(-1)?.to ?? 0;
  if (candidate.to > canonicalLength) return null;
  const overlapping = segments.filter(
    ({ from, to }) => to > candidate.from && from < candidate.to,
  );
  const seed = overlapping[0];
  if (!seed?.attrs) return null;
  if (
    overlapping.some(
      (segment) =>
        segment.node.type === "hard_break" ||
        !segment.attrs ||
        !inlineMarkValuesEqual(segment.attrs, seed.attrs),
    )
  ) {
    return null;
  }

  const seedIndex = segments.indexOf(seed);
  let first = seedIndex;
  let last = segments.indexOf(overlapping.at(-1)!);
  while (first > 0 && continuesLink(segments[first - 1], seed.attrs)) {
    first -= 1;
  }
  while (
    last + 1 < segments.length &&
    continuesLink(segments[last + 1], seed.attrs)
  ) {
    last += 1;
  }
  const from = segments[first]?.from;
  const to = segments[last]?.to;
  if (from === undefined || to === undefined || from >= to) return null;
  return Object.freeze({
    blockId,
    range: Object.freeze({ from, to }),
    attrs: Object.freeze({ ...seed.attrs }),
  });
}

export function sanitizeFirstDraftLinkAttributes(
  definition: InlineMarkDefinition,
  attrs: Readonly<Record<string, unknown>>,
): FirstDraftLinkAttributes | null {
  const sanitized = sanitizeInlineMarkAttrs(definition, attrs);
  if (!sanitized || typeof sanitized.href !== "string") return null;
  return {
    href: sanitized.href,
    title: typeof sanitized.title === "string" ? sanitized.title : null,
    target: typeof sanitized.target === "string" ? sanitized.target : null,
  };
}

function linkSegments(
  content: readonly RichTextInlineNodeJson[],
  definition: InlineMarkDefinition,
): CanonicalLinkSegment[] {
  const segments: CanonicalLinkSegment[] = [];
  let offset = 0;
  for (const node of content) {
    const size = richInlineNodeSize(node);
    const from = offset;
    const to = from + size;
    offset = to;
    const mark = node.marks?.find((candidate) => candidate.type === "link");
    const attrs = mark
      ? sanitizeFirstDraftLinkAttributes(definition, mark.attrs ?? {})
      : null;
    segments.push({ node, from, to, attrs });
  }
  return segments;
}

function continuesLink(
  segment: CanonicalLinkSegment | undefined,
  attrs: FirstDraftLinkAttributes,
): boolean {
  return Boolean(
    segment &&
    segment.node.type !== "hard_break" &&
    segment.attrs &&
    inlineMarkValuesEqual(segment.attrs, attrs),
  );
}
