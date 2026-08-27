import { createElement, type CSSProperties, type ReactNode } from "react";
import { CanonicalRichTextPresentation } from "@repo/editor-web/editable-block-renderer";
import { resolveFirstDraftCalloutIcon } from "../callout-icons.ts";
import { firstDraftInlineAtoms, firstDraftInlineMarks } from "../inline/definitions.ts";
import {
  CalloutPresentation,
  ColumnBoundaryPresentation,
  ColumnsBoundaryOverlay,
  ColumnsPresentation,
  HeadingPresentation,
  ParagraphPresentation,
  TableGridPresentation,
} from "../blocks/presentations.tsx";
import type {
  FirstDraftBlockDragPreviewNode,
  FirstDraftBlockType,
} from "./document-drag-overlay-contracts.ts";
import { FirstDraftCapturedTableCellPresentation } from "../table-drag-and-drop/preview-cell.tsx";
import type { TextDomPresentationElement } from "@repo/editor-web/editable-block-renderer";

interface PreviewRendererProps {
  readonly node: FirstDraftBlockDragPreviewNode;
  readonly topLevel: boolean;
}

type PreviewRenderer = (props: PreviewRendererProps) => ReactNode;

function PreviewText({
  node,
  element = "p",
  placeholder,
}: {
  readonly node: FirstDraftBlockDragPreviewNode;
  readonly element?: Extract<TextDomPresentationElement, "p" | `h${number}`>;
  readonly placeholder?: string;
}) {
  return (
    <div className="editor-web-text">
      <CanonicalRichTextPresentation
        block={node.block}
        content={node.content}
        inlineAtoms={firstDraftInlineAtoms}
        inlineMarks={firstDraftInlineMarks}
        placeholder={
          placeholder
            ? { text: placeholder, visibility: "always" }
            : undefined
        }
        textDomPresentation={{
          element,
          attributes:
            element === "p"
              ? {}
              : { "data-editor-heading-level": element.slice(1) },
        }}
      />
    </div>
  );
}

function PreviewChildren({
  node,
}: {
  readonly node: FirstDraftBlockDragPreviewNode;
  readonly topLevel?: false;
}) {
  return <>{node.children.map((child) => renderFirstDraftDocumentBlockDragPreviewNode(child))}</>;
}

function ParagraphPreview({ node }: PreviewRendererProps) {
  return (
    <div className="first-draft-document-block-drag-overlay__block" data-first-draft-preview-block-type="paragraph">
      <ParagraphPresentation>
        <PreviewText node={node} />
      </ParagraphPresentation>
    </div>
  );
}

function HeadingPreview({ node, topLevel }: PreviewRendererProps) {
  const level = node.presentation.headingLevel ?? 1;
  return (
    <div className="first-draft-document-block-drag-overlay__block" data-first-draft-preview-block-type="heading">
      <HeadingPresentation
        level={level}
        rootAttributes={previewVisualRootAttributes(topLevel)}
      >
        <PreviewText node={node} element={`h${level}`} placeholder="Heading" />
      </HeadingPresentation>
    </div>
  );
};

function listContainerPreview(
  type: "bulletList" | "orderedList" | "checklist",
): PreviewRenderer {
  return function ListContainerPreview({ node }: PreviewRendererProps) {
    const props = {
      className: "first-draft-document-block-drag-overlay__list",
      "data-first-draft-preview-block-type": type,
    };
    return type === "orderedList" ? (
      <ol {...props}><PreviewChildren node={node} /></ol>
    ) : (
      <ul {...props}><PreviewChildren node={node} /></ul>
    );
  };
}

function listItemPreview(
  type: "bulletListItem" | "orderedListItem",
): PreviewRenderer {
  return function ListItemPreview({ node }: PreviewRendererProps) {
    const ordered = type === "orderedListItem";
    return (
      <li className="first-draft-document-block-drag-overlay__list-item" data-first-draft-preview-block-type={type}>
        <div className="list-item-block__item" data-list-kind={ordered ? "ordered" : "bullet"}>
          <span className="list-item-block__marker" aria-hidden="true">
            {ordered && node.presentation.orderedListOrdinal !== null
              ? `${node.presentation.orderedListOrdinal}.`
              : null}
          </span>
          <PreviewChildren node={node} />
        </div>
      </li>
    );
  };
}

function ChecklistItemPreview({ node }: PreviewRendererProps) {
  const checked = node.presentation.checked === true;
  return (
    <li className="first-draft-document-block-drag-overlay__list-item" data-first-draft-preview-block-type="checklistItem">
      <div className="checklist-block__item" data-checked={String(checked)}>
        <span className="checklist-block__checkbox" data-checked={String(checked)} aria-hidden="true" />
        <PreviewChildren node={node} />
      </div>
    </li>
  );
};

function QuotePreview({ node, topLevel }: PreviewRendererProps) {
  return (
    <div className="first-draft-document-block-drag-overlay__block" data-first-draft-preview-block-type="quote">
      <blockquote
        className="quote-block__quote"
        {...previewVisualRootAttributes(topLevel)}
      ><PreviewChildren node={node} topLevel={false} /></blockquote>
    </div>
  );
}

function CodePreview({ node, topLevel }: PreviewRendererProps) {
  return (
    <div className="first-draft-document-block-drag-overlay__block" data-first-draft-preview-block-type="code">
      <div
        className="code-block__presentation"
        {...previewVisualRootAttributes(topLevel)}
      ><PreviewChildren node={node} topLevel={false} /></div>
    </div>
  );
}

function CalloutPreview({ node, topLevel }: PreviewRendererProps) {
  const icon = resolveFirstDraftCalloutIcon(node.block.metadata?.icon);
  return (
    <div className="first-draft-document-block-drag-overlay__block" data-first-draft-preview-block-type="callout">
      <CalloutPresentation
        icon={
          <div className="callout-block__icon-wrap">
            <span className="callout-block__icon" aria-hidden="true">{icon.glyph}</span>
          </div>
        }
        rootAttributes={{
          ...previewVisualRootAttributes(topLevel),
          role: "group",
          "aria-label": "Callout block",
          "data-callout-icon": icon.id,
        }}
      >
        <PreviewChildren node={node} topLevel={false} />
      </CalloutPresentation>
    </div>
  );
};

function togglePreview(
  type: "toggleHeading" | "toggleListItem",
): PreviewRenderer {
  return function TogglePreview({ node, topLevel }: PreviewRendererProps) {
    const expanded = node.presentation.collapsed !== true;
    const prefix = type === "toggleHeading" ? "toggle-heading-block" : "toggle-list-item-block";
    const [summary, body] = node.children;
    return (
      <div className="first-draft-document-block-drag-overlay__block" data-first-draft-preview-block-type={type}>
        <div
          className={`${prefix}__toggle`}
          role="group"
          {...previewVisualRootAttributes(topLevel)}
        >
          <span className={`${prefix}__chevron`} aria-expanded={expanded}>
            <svg aria-hidden="true" viewBox="0 0 16 16" data-expanded={String(expanded)}>
              <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          {summary ? renderFirstDraftDocumentBlockDragPreviewNode(summary) : null}
          {expanded && body ? renderFirstDraftDocumentBlockDragPreviewNode(body) : null}
        </div>
      </div>
    );
  };
}

function toggleBodyPreview(type: "toggleHeadingBody" | "toggleListItemBody"): PreviewRenderer {
  return function ToggleBodyPreview({ node }: PreviewRendererProps) {
    return (
      <div className="first-draft-document-block-drag-overlay__toggle-body" data-first-draft-preview-block-type={type}>
        <PreviewChildren node={node} />
      </div>
    );
  };
}

function DividerPreview({ topLevel }: PreviewRendererProps) {
  return (
    <hr className="divider-block__rule first-draft-document-block-drag-overlay__block" data-first-draft-preview-block-type="divider" aria-label="Divider" {...previewVisualRootAttributes(topLevel)} />
  );
}

function ColumnsPreview({ node, topLevel }: PreviewRendererProps) {
  const tracks = node.presentation.columns?.tracks ?? "minmax(0, 1fr)";
  const columns = node.children.filter(
    (child) => child.block.type === "column",
  );
  return (
    <div className="first-draft-document-block-drag-overlay__block" data-first-draft-preview-block-type="columns">
      <ColumnsPresentation
        tracks={tracks}
        rootAttributes={previewVisualRootAttributes(topLevel)}
      >
        <PreviewChildren node={node} topLevel={false} />
        {columns.length > 1 ? (
          <ColumnsBoundaryOverlay tracks={tracks}>
            {columns.slice(0, -1).map((left, index) => (
              <ColumnBoundaryPresentation
                key={`${left.block.id}|${columns[index + 1]!.block.id}`}
              />
            ))}
          </ColumnsBoundaryOverlay>
        ) : null}
      </ColumnsPresentation>
    </div>
  );
}

function ColumnPreview({ node }: PreviewRendererProps) {
  return (
    <section className="columns-block__lane first-draft-document-block-drag-overlay__column" aria-label="Column" data-first-draft-preview-block-type="column">
      <PreviewChildren node={node} />
    </section>
  );
}

function TabsPreview({ node, topLevel }: PreviewRendererProps) {
  const selected = node.presentation.selectedTabPaneId;
  const selectedPane = node.children.find((child) => child.block.id === selected);
  return (
    <div className="first-draft-document-block-drag-overlay__block" data-first-draft-preview-block-type="tabs">
      <div
        className="tabs-block__tabs"
        role="group"
        aria-label="Tabs"
        {...previewVisualRootAttributes(topLevel)}
      >
        <div className="tabs-block__header">
          <div className="tabs-block__tablist" role="tablist" aria-label="Tabs">
            {node.children.map((pane, index) => (
              <span className="tabs-block__tab-slot" key={pane.block.id}>
                <span className="tabs-block__tab" role="tab" aria-selected={pane.block.id === selected}>
                  {typeof pane.block.metadata?.title === "string" && pane.block.metadata.title
                    ? pane.block.metadata.title
                    : `Tab ${index + 1}`}
                </span>
              </span>
            ))}
          </div>
        </div>
        <div className="tabs-block__panel" role="tabpanel">
          {selectedPane ? renderFirstDraftDocumentBlockDragPreviewNode(selectedPane) : null}
        </div>
      </div>
    </div>
  );
};

function TabPanePreview({ node }: PreviewRendererProps) {
  return (
    <div className="tabs-block__pane" data-first-draft-preview-block-type="tabPane">
      <div className="tabs-block__pane-contents"><PreviewChildren node={node} /></div>
    </div>
  );
}

function TablePreview({ node, topLevel }: PreviewRendererProps) {
  const table = node.presentation.table;
  if (!table) throw new Error("First Draft table preview is missing captured table presentation");
  return (
    <div className="first-draft-document-block-drag-overlay__block" data-first-draft-preview-block-type="table">
      <TableGridPresentation
        tracks={table.tracks}
        rowCount={table.rowCount}
        columnCount={table.columnCount}
        rootAttributes={previewVisualRootAttributes(topLevel)}
      >
        <PreviewChildren node={node} topLevel={false} />
      </TableGridPresentation>
    </div>
  );
};

function TableRowPreview({ node }: PreviewRendererProps) {
  const tracks =
    node.presentation.table?.tracks ??
    `repeat(${node.children.length}, minmax(176px, 1fr))`;
  return (
    <div
      className="table-block__row"
      role="row"
      data-first-draft-preview-block-type="tableRow"
      style={{
        gridTemplateColumns: `var(--first-draft-table-tracks, ${tracks})`,
      } as CSSProperties}
    >
      <PreviewChildren node={node} />
    </div>
  );
}

function TableCellPreview({ node }: PreviewRendererProps) {
  return (
    <FirstDraftCapturedTableCellPresentation
      block={node.block}
      content={node.content!}
      rootAttributes={{
        "data-first-draft-preview-block-type": "tableCell",
      }}
    />
  );
}

export const firstDraftDocumentBlockDragPreviewRenderers = {
  paragraph: ParagraphPreview,
  heading: HeadingPreview,
  bulletList: listContainerPreview("bulletList"),
  orderedList: listContainerPreview("orderedList"),
  checklist: listContainerPreview("checklist"),
  bulletListItem: listItemPreview("bulletListItem"),
  orderedListItem: listItemPreview("orderedListItem"),
  checklistItem: ChecklistItemPreview,
  quote: QuotePreview,
  code: CodePreview,
  callout: CalloutPreview,
  toggleHeading: togglePreview("toggleHeading"),
  toggleHeadingBody: toggleBodyPreview("toggleHeadingBody"),
  toggleListItem: togglePreview("toggleListItem"),
  toggleListItemBody: toggleBodyPreview("toggleListItemBody"),
  divider: DividerPreview,
  columns: ColumnsPreview,
  column: ColumnPreview,
  tabs: TabsPreview,
  tabPane: TabPanePreview,
  table: TablePreview,
  tableRow: TableRowPreview,
  tableCell: TableCellPreview,
} satisfies Readonly<Record<FirstDraftBlockType, PreviewRenderer>>;

export const firstDraftDocumentBlockDragPreviewTypes = Object.freeze(
  Object.keys(firstDraftDocumentBlockDragPreviewRenderers) as FirstDraftBlockType[],
);

export function renderFirstDraftDocumentBlockDragPreviewNode(
  node: FirstDraftBlockDragPreviewNode,
  topLevel = false,
): ReactNode {
  const renderer = (
    firstDraftDocumentBlockDragPreviewRenderers as Readonly<Record<string, PreviewRenderer | undefined>>
  )[node.block.type];
  if (!renderer) {
    throw new Error(`No First Draft document drag preview renderer for ${node.block.type}`);
  }
  return createElement(renderer, { key: node.block.id, node, topLevel });
}

function previewVisualRootAttributes(topLevel: boolean) {
  return topLevel
    ? ({
        "data-first-draft-preview-visual-root": "true",
        style: { margin: 0 },
      } as const)
    : undefined;
}
