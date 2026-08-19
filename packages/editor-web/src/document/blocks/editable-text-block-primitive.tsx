"use client";

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type HTMLAttributes,
} from "react";
import type { VersionedBlock } from "@repo/editor-core/document";
import type { TextPlaceholder } from "@repo/editor-dom/block-editor";
import type { EditableEditor } from "../../runtime/document/contracts.ts";
import type { EditableEditorRuntimePort } from "../../runtime/document/render-port.ts";
import { resolveEditorRuntimePort } from "../../runtime/document/runtime-port-registry.ts";
import {
  CanonicalRichTextChildren,
  useCanonicalTextProjection,
} from "./canonical-text-projection.tsx";

export interface EditableTextBlockPrimitiveProps {
  readonly block: VersionedBlock;
  readonly editor: EditableEditor;
  readonly placeholder?: TextPlaceholder;
  readonly rootAttributes?: Omit<HTMLAttributes<HTMLDivElement>, "children"> &
    Partial<Record<`data-${string}`, string | undefined>>;
}

/** React owns the permanent projection and the empty slot used by the shared view. */
export function EditableTextBlockPrimitive({
  block,
  editor,
  placeholder,
  rootAttributes,
}: EditableTextBlockPrimitiveProps) {
  const runtime = resolveEditorRuntimePort(editor) as EditableEditorRuntimePort;
  const canonical = useCanonicalTextProjection({ block, editor: runtime });
  const placeholderText = placeholder?.text;
  const placeholderVisibility = placeholder?.visibility;
  const stablePlaceholder = useMemo(
    () =>
      placeholderText !== undefined && placeholderVisibility !== undefined
        ? { text: placeholderText, visibility: placeholderVisibility }
        : undefined,
    [placeholderText, placeholderVisibility],
  );
  const className = mergeClassNames(
    "editor-web-text",
    rootAttributes?.className,
  );
  const placeholderRef = useRef(stablePlaceholder);
  const classNameRef = useRef(className);
  const registrationRef = useRef<ReturnType<
    EditableEditorRuntimePort["registerTextEditingHost"]
  > | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const registerHost = useCallback(
    (shell: HTMLDivElement | null) => {
      if (!shell) return;
      shellRef.current = shell;
      const projection = shell.querySelector<HTMLElement>(
        ":scope > [data-editor-text-projection='true']",
      );
      const slot = shell.querySelector<HTMLElement>(
        ":scope > [data-editor-text-slot='true']",
      );
      if (!projection || !slot) {
        throw new Error(
          `Text host ${block.id} is missing its projection or slot.`,
        );
      }
      const registration = runtime.registerTextEditingHost({
        blockId: block.id,
        shell,
        projection,
        slot,
        className,
        placeholder: placeholderRef.current,
      });
      registrationRef.current = registration;
      return () => {
        if (shellRef.current === shell) shellRef.current = null;
        if (registrationRef.current === registration) {
          registrationRef.current = null;
        }
        registration.dispose();
      };
    },
    [block.id, className, runtime],
  );
  useLayoutEffect(() => {
    placeholderRef.current = stablePlaceholder;
    classNameRef.current = className;
    registrationRef.current?.update({ placeholder: stablePlaceholder });
  }, [className, stablePlaceholder]);
  return (
    <div
      {...rootAttributes}
      ref={registerHost}
      className="editor-web-text-shell"
      data-editor-text-shell="true"
      tabIndex={-1}
    >
      <div
        className={className}
        data-editor-text-projection="true"
        data-editor-text-root="true"
      >
        <CanonicalRichTextChildren
          block={block}
          text={canonical.text}
          leaves={canonical.leaves}
          placeholder={stablePlaceholder}
        />
      </div>
      <div data-editor-text-slot="true" />
    </div>
  );
}

function mergeClassNames(
  ...values: readonly (string | null | undefined)[]
): string {
  return values.filter(Boolean).join(" ");
}
