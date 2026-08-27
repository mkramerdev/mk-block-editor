import type { HTMLAttributes } from "react";
import type { RichTextDocumentNodeJson } from "@repo/editor-core/content/rich-text";
import type { VersionedBlock } from "@repo/editor-core/document";
import { CanonicalRichTextPresentation } from "@repo/editor-web/editable-block-renderer";
import { firstDraftInlineAtoms, firstDraftInlineMarks } from "../inline/definitions.ts";

type PreviewCellRootAttributes = Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "className"
> &
  Partial<Record<`data-${string}`, string | undefined>>;

export function FirstDraftCapturedTableCellPresentation({
  block,
  content,
  rootAttributes,
}: {
  readonly block: VersionedBlock;
  readonly content: RichTextDocumentNodeJson;
  readonly rootAttributes?: PreviewCellRootAttributes;
}) {
  return (
    <div {...rootAttributes} className="table-block__cell" role="gridcell">
      <div className="editor-web-text">
        <CanonicalRichTextPresentation
          block={block}
          content={content}
          inlineAtoms={firstDraftInlineAtoms}
          inlineMarks={firstDraftInlineMarks}
          textDomPresentation={{ element: "p", attributes: {} }}
        />
      </div>
    </div>
  );
}
