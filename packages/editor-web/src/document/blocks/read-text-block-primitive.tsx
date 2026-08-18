"use client";

import {
  useCallback,
  useLayoutEffect,
  useState,
  type HTMLAttributes,
  type Ref,
} from "react";
import type { VersionedBlock } from "@repo/editor-core/document";
import type { TextPlaceholder } from "@repo/editor-dom/block-editor";
import type { EditorReadRuntime } from "../../runtime/document/contracts.ts";
import type { AnyEditorRuntimePort } from "../../runtime/document/render-port.ts";
import { resolveEditorRuntimePort } from "../../runtime/document/runtime-port-registry.ts";
import { useOptionalEditorDocumentGeometryRegistration } from "../geometry/editor-document-geometry-context.tsx";
import {
  CanonicalRichTextChildren,
  useCanonicalTextProjection,
} from "./canonical-text-projection.tsx";

export interface ReadTextBlockPrimitiveProps {
  readonly block: VersionedBlock;
  readonly editor: EditorReadRuntime;
  readonly rootAttributes?: TextRootAttributes;
  readonly placeholder?: TextPlaceholder;
}

/** PM-free canonical rich-text projection used by read and inactive edit views. */
export function ReadTextBlockPrimitive({
  block,
  editor,
  rootAttributes,
  placeholder,
}: ReadTextBlockPrimitiveProps) {
  const [inactiveEmpty, setInactiveEmpty] = useState(true);
  const geometryRegistration = useOptionalEditorDocumentGeometryRegistration();
  const className = mergeClassNames(
    "editor-web-text",
    rootAttributes?.className,
  );
  const { ref: providedRootRef, ...resolvedRootAttributes } =
    rootAttributes ?? {};
  const registerRoot = useCallback(
    (root: HTMLDivElement | null) => {
      if (!root) {
        clearRef(providedRootRef);
        return;
      }
      const releaseProvidedRef = attachRef(providedRootRef, root);
      const releaseGeometry = geometryRegistration?.registerMountedTextRoot(
        block.id,
        root,
      );
      return () => {
        releaseGeometry?.();
        releaseProvidedRef?.();
      };
    },
    [block.id, geometryRegistration, providedRootRef],
  );
  return (
    <div
      {...resolvedRootAttributes}
      ref={registerRoot}
      className={className}
      data-editor-text-root="true"
      data-editor-read-row="true"
      data-empty={String(inactiveEmpty)}
    >
      <InactiveCanonicalTextProjection
        block={block}
        editor={editor}
        placeholder={placeholder}
        onEmptyChange={setInactiveEmpty}
      />
    </div>
  );
}

function InactiveCanonicalTextProjection({
  block,
  editor,
  placeholder,
  onEmptyChange,
}: {
  readonly block: VersionedBlock;
  readonly editor: EditorReadRuntime;
  readonly placeholder?: TextPlaceholder;
  readonly onEmptyChange: (empty: boolean) => void;
}) {
  const canonical = useCanonicalTextProjection({
    block,
    editor: resolveEditorRuntimePort(editor) as AnyEditorRuntimePort,
  });
  const empty = canonical.text.length === 0;
  useLayoutEffect(() => onEmptyChange(empty), [empty, onEmptyChange]);
  return (
    <CanonicalRichTextChildren
      block={block}
      text={canonical.text}
      leaves={canonical.leaves}
      placeholder={placeholder}
    />
  );
}

type TextRootAttributes = Omit<HTMLAttributes<HTMLDivElement>, "children"> &
  Partial<Record<`data-${string}`, string | undefined>> & {
    readonly ref?: Ref<HTMLDivElement>;
  };

function attachRef<T>(ref: Ref<T> | undefined, value: T): () => void {
  if (!ref) return noop;
  if (typeof ref === "function") {
    const release = ref(value);
    return typeof release === "function" ? release : () => ref(null);
  }
  ref.current = value;
  return () => {
    if (ref.current === value) ref.current = null;
  };
}

function clearRef<T>(ref: Ref<T> | undefined): void {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(null);
    return;
  }
  ref.current = null;
}

function noop(): void {}

function mergeClassNames(
  ...values: readonly (string | null | undefined)[]
): string {
  return values.filter(Boolean).join(" ");
}
