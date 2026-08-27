"use client";

import { createElement, useSyncExternalStore, type ReactNode } from "react";
import type { JsonObject } from "@repo/editor-core/kernel";
import { validateAndCloneInlineAtomMetadata } from "@repo/editor-core/content/inline-atoms";
import {
  findInlineMarkDefinition,
  sanitizeInlineMarkAttrs,
  type InlineMarkDefinition,
} from "@repo/editor-core/content/marks";
import type { VersionedBlock } from "@repo/editor-core/document";
import type { TextPlaceholder } from "@repo/editor-dom/block-editor";
import type { RichTextDocumentNodeJson } from "@repo/editor-core/content/rich-text";
import type { EditableEditorRuntimePort } from "../../runtime/document/render-port.ts";
import type { EditorContentRuntime } from "@repo/editor-core/content";
import type { InlineAtomDefinition } from "../../runtime/definition/contracts.ts";
import {
  defaultTextDomPresentation,
  type ResolvedTextDomPresentation,
} from "./text-dom-presentation.ts";

interface CanonicalTextProjectionOptions {
  block: VersionedBlock;
  editor: EditableEditorRuntimePort;
}

export interface CanonicalRichTextPresentationProps {
  readonly block: VersionedBlock;
  readonly content: RichTextDocumentNodeJson | null;
  readonly inlineAtoms: readonly InlineAtomDefinition[];
  readonly inlineMarks: readonly InlineMarkDefinition[];
  readonly placeholder?: TextPlaceholder;
  readonly textDomPresentation?: ResolvedTextDomPresentation;
}

export function useCanonicalTextProjection({
  block,
  editor,
}: CanonicalTextProjectionOptions): CanonicalTextModel {
  const contentRuntime = editor.contentRuntime;
  const inlineAtoms = editor.compiledDefinition.inlineAtomRegistry.definitions;
  const inlineMarks = editor.definition.inlineMarks;
  const readProjection = useSyncExternalStore(
    (listener) => contentRuntime.subscribeBlockProjection(block.id, listener),
    () => contentRuntime.readBlockProjection(block.id, block.type),
    () => contentRuntime.readBlockProjection(block.id, block.type),
  );
  const readText = readTextModelFromProjection(
    readProjection,
    inlineAtoms,
    inlineMarks,
  );
  return readText;
}

export function CanonicalRichTextChildren({
  text,
  leaves,
  placeholder,
  textDomPresentation = defaultTextDomPresentation,
}: {
  block: VersionedBlock;
  text: string;
  leaves: readonly ReadTextLeaf[];
  placeholder?: TextPlaceholder;
  textDomPresentation?: ResolvedTextDomPresentation;
}) {
  const content = renderReadTextLeaves(leaves);
  const trailingBreak =
    text.length === 0 || text.endsWith("\n") ? (
      <br data-editor-canonical-trailing-break="true" aria-hidden="true" />
    ) : null;
  return createElement(
    textDomPresentation.element,
    {
      ...textDomPresentation.attributes,
      ...readPlaceholderAttributes(text, placeholder),
      "data-block-node": "paragraph",
    },
    content,
    trailingBreak,
  );
}

/**
 * Stateless canonical rich-text presentation for an already captured block.
 * It owns no editor runtime, subscription, registration, or editable host.
 */
export function CanonicalRichTextPresentation({
  block,
  content,
  inlineAtoms,
  inlineMarks,
  placeholder,
  textDomPresentation = defaultTextDomPresentation,
}: CanonicalRichTextPresentationProps) {
  const canonical = readTextModelFromProjection(
    block.tombstone === null ? content : null,
    new Map(inlineAtoms.map((definition) => [definition.type, definition])),
    inlineMarks,
  );
  return (
    <CanonicalRichTextChildren
      block={block}
      text={canonical.text}
      leaves={canonical.leaves}
      placeholder={placeholder}
      textDomPresentation={textDomPresentation}
    />
  );
}

function readPlaceholderAttributes(
  text: string,
  placeholder: TextPlaceholder | undefined,
): { readonly "data-editor-placeholder"?: string } {
  if (
    text.length > 0 ||
    placeholder?.visibility !== "always" ||
    !placeholder.text
  )
    return {};
  return {
    "data-editor-placeholder": placeholder.text,
  };
}

interface CanonicalTextModel {
  text: string;
  leaves: readonly ReadTextLeaf[];
}

interface ReadTextLeafBase {
  text: string;
  strong: boolean;
  em: boolean;
  code: boolean;
  underline: boolean;
  strikethrough: boolean;
  link: {
    readonly href: string;
    readonly title?: string;
    readonly target?: string;
  } | null;
}

interface ReadPlainTextLeaf extends ReadTextLeafBase {
  kind: "text";
}

interface ReadHardBreakLeaf extends ReadTextLeafBase {
  kind: "hardBreak";
}

interface ReadInlineAtomLeaf extends ReadTextLeafBase {
  kind: "inlineAtom";
  atom: {
    metadata: JsonObject;
    definition: InlineAtomDefinition;
  };
}

type ReadTextLeaf = ReadPlainTextLeaf | ReadHardBreakLeaf | ReadInlineAtomLeaf;

function readTextModelFromProjection(
  content: ReturnType<EditorContentRuntime["readBlockProjection"]> | null,
  inlineAtoms: ReadonlyMap<string, InlineAtomDefinition>,
  inlineMarks: readonly InlineMarkDefinition[],
): CanonicalTextModel {
  if (!content || !isTrustedReadRichTextDocument(content))
    return readTextModelFromLeaves([]);
  return readTextModelFromLeaves(
    readRichTextLeaves(content, "", inlineAtoms, inlineMarks),
  );
}

function readTextModelFromLeaves(
  leaves: readonly ReadTextLeaf[],
): CanonicalTextModel {
  return {
    text: leaves.map((leaf) => leaf.text).join(""),
    leaves,
  };
}

function readRichTextLeaves(
  content: RichTextDocumentNodeJson,
  fallbackText: string,
  inlineAtoms: ReadonlyMap<string, InlineAtomDefinition>,
  inlineMarks: readonly InlineMarkDefinition[],
): readonly ReadTextLeaf[] {
  if (!isTrustedReadRichTextDocument(content)) {
    return fallbackText ? [plainTextLeaf(fallbackText)] : [];
  }
  const leaves: ReadTextLeaf[] = [];
  collectTextLeaves(
    firstRichTextBlockNode(content),
    leaves,
    inlineAtoms,
    inlineMarks,
  );
  return leaves.length > 0 || !fallbackText
    ? leaves
    : [plainTextLeaf(fallbackText)];
}

function isTrustedReadRichTextDocument(
  content: unknown,
): content is Record<string, unknown> {
  return Boolean(
    content &&
    typeof content === "object" &&
    !Array.isArray(content) &&
    (content as { readonly type?: unknown }).type === "doc" &&
    Array.isArray((content as { readonly content?: unknown }).content),
  );
}

function firstRichTextBlockNode(
  document: Record<string, unknown>,
): Record<string, unknown> | null {
  const content = document.content;
  const first = Array.isArray(content) ? content[0] : null;
  return first && typeof first === "object"
    ? (first as Record<string, unknown>)
    : null;
}

function collectTextLeaves(
  node: Record<string, unknown> | null,
  leaves: ReadTextLeaf[],
  inlineAtoms: ReadonlyMap<string, InlineAtomDefinition>,
  inlineMarks: readonly InlineMarkDefinition[],
): void {
  if (!node) return;
  if (node.type === "text" && typeof node.text === "string") {
    leaves.push({
      kind: "text",
      text: node.text,
      strong: nodeHasMark(node, "strong"),
      em: nodeHasMark(node, "em"),
      code: nodeHasMark(node, "code"),
      underline: nodeHasMark(node, "underline"),
      strikethrough: nodeHasMark(node, "strikethrough"),
      link: readLinkMark(node, inlineMarks),
    });
    return;
  }
  if (node.type === "hard_break") {
    leaves.push({ ...plainTextLeaf("\n"), kind: "hardBreak" });
    return;
  }
  if (typeof node.type === "string") {
    const definition = inlineAtoms.get(node.type);
    if (definition) {
      const metadata = validateAndCloneInlineAtomMetadata(
        node.metadata,
        definition.metadata,
        `read inline atom ${node.type}.metadata`,
      );
      if (!metadata.valid) throw new Error(metadata.errors.join("; "));
      leaves.push({
        kind: "inlineAtom",
        text: "\uFFFC",
        strong: nodeHasMark(node, "strong"),
        em: nodeHasMark(node, "em"),
        code: nodeHasMark(node, "code"),
        underline: nodeHasMark(node, "underline"),
        strikethrough: nodeHasMark(node, "strikethrough"),
        link: readLinkMark(node, inlineMarks),
        atom: {
          metadata: metadata.value,
          definition,
        },
      });
      return;
    }
  }
  const content = node.content;
  if (!Array.isArray(content)) return;
  for (const child of content) {
    if (child && typeof child === "object")
      collectTextLeaves(
        child as Record<string, unknown>,
        leaves,
        inlineAtoms,
        inlineMarks,
      );
  }
}

function plainTextLeaf(text: string): ReadPlainTextLeaf {
  return {
    kind: "text",
    text,
    strong: false,
    em: false,
    code: false,
    underline: false,
    strikethrough: false,
    link: null,
  };
}

function readLinkMark(
  node: Record<string, unknown>,
  inlineMarks: readonly InlineMarkDefinition[],
): ReadTextLeafBase["link"] {
  const definition = findInlineMarkDefinition(inlineMarks, "link");
  if (!definition || !Array.isArray(node.marks)) return null;
  const mark = node.marks.find(
    (candidate) =>
      candidate !== null &&
      typeof candidate === "object" &&
      "type" in candidate &&
      candidate.type === "link",
  );
  if (!mark || typeof mark !== "object") return null;
  const attrs = sanitizeInlineMarkAttrs(
    definition,
    "attrs" in mark &&
      mark.attrs !== null &&
      typeof mark.attrs === "object" &&
      !Array.isArray(mark.attrs)
      ? (mark.attrs as Record<string, unknown>)
      : undefined,
  );
  if (!attrs) return null;
  const href = attrs.href;
  if (typeof href !== "string" || href.length === 0) return null;
  return {
    href,
    ...(typeof attrs.title === "string" ? { title: attrs.title } : {}),
    ...(typeof attrs.target === "string" ? { target: attrs.target } : {}),
  };
}

function nodeHasMark(
  node: Record<string, unknown>,
  markName: "strong" | "em" | "code" | "underline" | "strikethrough",
): boolean {
  return (
    Array.isArray(node.marks) &&
    node.marks.some((mark) =>
      Boolean(
        mark &&
        typeof mark === "object" &&
        "type" in mark &&
        mark.type === markName,
      ),
    )
  );
}

function renderReadTextLeaves(leaves: readonly ReadTextLeaf[]) {
  if (leaves.length === 0) return "";
  return leaves.map((leaf, leafIndex) =>
    wrapReadTextLeaf(leaf.text, leaf, String(leafIndex)),
  );
}

function wrapReadTextLeaf(
  text: string,
  leaf: ReadTextLeaf,
  key: string,
): ReactNode {
  if (leaf.kind === "hardBreak") return <br key={key} />;
  let node: ReactNode = text;
  if (leaf.kind === "inlineAtom") node = renderReadInlineAtomLeaf(leaf);
  if (leaf.link) {
    node = (
      <a
        href={leaf.link.href}
        title={leaf.link.title}
        target={leaf.link.target}
      >
        {node}
      </a>
    );
  }
  if (leaf.em) node = <em>{node}</em>;
  if (leaf.strong) node = <strong>{node}</strong>;
  if (leaf.code) node = <code>{node}</code>;
  if (leaf.underline) node = <u>{node}</u>;
  if (leaf.strikethrough) node = <s>{node}</s>;
  return typeof node === "string" ? node : <span key={key}>{node}</span>;
}

function renderReadInlineAtomLeaf(leaf: ReadInlineAtomLeaf): ReactNode {
  return (
    <span
      data-editor-inline-atom="true"
      data-inline-atom-type={leaf.atom.definition.type}
    >
      {leaf.atom.definition.render(leaf.atom.metadata)}
    </span>
  );
}
