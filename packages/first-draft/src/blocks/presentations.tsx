import type {
  CSSProperties,
  HTMLAttributes,
  ReactNode,
  Ref,
} from "react";
import type { FirstDraftHeadingLevel } from "../heading-level.ts";

type PresentationDivAttributes = HTMLAttributes<HTMLDivElement> &
  Partial<Record<`data-${string}`, string | undefined>>;

type PresentationRootAttributes = Omit<
  PresentationDivAttributes,
  "children" | "className"
>;

export function ParagraphPresentation({ children }: { readonly children: ReactNode }) {
  return <div className="paragraph-block__paragraph">{children}</div>;
}

export function HeadingPresentation({
  level,
  children,
  rootAttributes,
}: {
  readonly level: FirstDraftHeadingLevel;
  readonly children: ReactNode;
  readonly rootAttributes?: PresentationRootAttributes;
}) {
  return (
    <div
      {...rootAttributes}
      className="heading-block__heading"
      data-editor-heading-level={String(level)}
    >
      {children}
    </div>
  );
}

export function CalloutPresentation({
  icon,
  children,
  rootAttributes,
  bodyAttributes,
}: {
  readonly icon: ReactNode;
  readonly children: ReactNode;
  readonly rootAttributes?: PresentationRootAttributes;
  readonly bodyAttributes?: PresentationRootAttributes;
}) {
  return (
    <div {...rootAttributes} className="callout-block__callout">
      {icon}
      <div {...bodyAttributes} className="callout-block__body">
        {children}
      </div>
    </div>
  );
}

export function ColumnsPresentation({
  tracks,
  children,
  rootRef,
  rootAttributes,
}: {
  readonly tracks: string;
  readonly children: ReactNode;
  readonly rootRef?: Ref<HTMLDivElement>;
  readonly rootAttributes?: PresentationRootAttributes;
}) {
  return (
    <div
      {...rootAttributes}
      className="columns-block__grid"
      ref={rootRef}
      role="group"
      aria-label="Columns layout"
      style={{
        ...rootAttributes?.style,
        "--columns-block-tracks": tracks,
      } as CSSProperties}
    >
      {children}
    </div>
  );
}

export function ColumnsBoundaryOverlay({
  tracks,
  children,
  rootRef,
}: {
  readonly tracks: string;
  readonly children: ReactNode;
  readonly rootRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div
      className="columns-block__resize-overlay"
      ref={rootRef}
      style={{ "--columns-block-tracks": tracks } as CSSProperties}
    >
      {children}
    </div>
  );
}

export function ColumnBoundaryPresentation({
  children,
}: {
  readonly children?: ReactNode;
}) {
  return (
    <div className="columns-block__boundary">
      <span className="columns-block__divider" aria-hidden="true" />
      {children}
    </div>
  );
}

type TableGridRootAttributes = Omit<
  PresentationRootAttributes,
  "aria-colcount" | "aria-label" | "aria-rowcount" | "role"
>;

export function TableGridPresentation({
  tracks,
  rowCount,
  columnCount,
  children,
  rootRef,
  rootAttributes,
}: {
  readonly tracks?: string;
  readonly rowCount: number;
  readonly columnCount: number;
  readonly children: ReactNode;
  readonly rootRef?: Ref<HTMLDivElement>;
  readonly rootAttributes?: TableGridRootAttributes;
}) {
  return (
    <div
      {...rootAttributes}
      ref={rootRef}
      className="table-block__grid"
      role="grid"
      aria-label="Table"
      aria-rowcount={rowCount}
      aria-colcount={columnCount}
      style={
        tracks
          ? ({
              ...rootAttributes?.style,
              "--first-draft-table-tracks": tracks,
              maxInlineSize: "none",
              minInlineSize: "100%",
              inlineSize: "100%",
            } as CSSProperties)
          : rootAttributes?.style
      }
    >
      {children}
    </div>
  );
}
