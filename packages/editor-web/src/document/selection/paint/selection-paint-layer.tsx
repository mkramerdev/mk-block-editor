"use client";

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  normalizeNewSelection,
  type EditorSelectionGraphReader,
  type LocalSelectionPaintModel,
} from "@repo/editor-react/selection";
import type {
  AdditionalSelectionRecord,
  CollaborationSubjectKey,
} from "../../../runtime/collaboration/contracts.ts";
import type { EditableEditor } from "../../../runtime/document/contracts.ts";
import type {
  EditorDocumentGeometryReader,
  EditorDocumentRect,
} from "../../geometry/editor-document-geometry.ts";
import {
  deriveDocumentSelectionPaintPrimitives,
  deriveLocalSelectionPaintPlan,
  resolveAtomicSurfacePaintBounds,
  type DocumentSelectionPaintPrimitive,
  type LocalSelectionPaintPlan,
} from "./selection-paint-plan.ts";

export interface SelectionPaintLayerProps {
  readonly editor: SelectionPaintEditor;
  readonly transientPointerPaint?: TransientPointerSelectionPaint | null;
}

export type SelectionPaintEditor = Pick<
  EditableEditor,
  "selection" | "selectionPaint" | "geometry" | "additionalSelections"
> &
  EditorSelectionGraphReader;

/** Web-local derivative paint; it contains no logical or stable selection. */
export interface TransientPointerSelectionPaint {
  readonly revision: number;
  readonly primitives: readonly DocumentSelectionPaintPrimitive[];
}

interface SelectionPaintSubject {
  readonly id: "local-selection" | CollaborationSubjectKey;
  readonly kind: "local" | "additional";
  readonly color: string | null;
  readonly sourceRevision: number;
  readonly primitives: readonly DocumentSelectionPaintPrimitive[];
  readonly caret: {
    readonly blockId: BlockId;
    readonly offset: number;
    readonly affinity: "backward" | "forward" | null;
  } | null;
}

interface RenderedSelectionPaint {
  readonly key: string;
  readonly subjectId: SelectionPaintSubject["id"];
  readonly subjectKind: SelectionPaintSubject["kind"];
  readonly color: string | null;
  readonly sourceRevision: number;
  readonly blockId: BlockId;
  readonly paintKind: "text-fragment" | "atomic-surface" | "caret";
  readonly target: string | null;
  readonly rect: EditorDocumentRect;
}

const emptyAdditionalSelections = Object.freeze(
  [],
) as readonly AdditionalSelectionRecord[];
const emptyPaintSubjects = Object.freeze(
  [],
) as readonly SelectionPaintSubject[];
const emptyRenderedPaint = Object.freeze(
  [],
) as readonly RenderedSelectionPaint[];

export function SelectionPaintLayer({
  editor,
  transientPointerPaint = null,
}: SelectionPaintLayerProps) {
  const localPaint = useSyncExternalStore(
    editor.selectionPaint.subscribe,
    editor.selectionPaint.getSnapshot,
    editor.selectionPaint.getSnapshot,
  );
  const additionalReader = editor.additionalSelections;
  const subscribeAdditional = useCallback(
    (listener: () => void) => additionalReader.subscribe(listener),
    [additionalReader],
  );
  const readAdditional = useCallback(
    () => additionalReader.getSnapshot(),
    [additionalReader],
  );
  const additionalSelections = useSyncExternalStore(
    subscribeAdditional,
    readAdditional,
    () => emptyAdditionalSelections,
  );
  const model = useMemo(
    () =>
      createSelectionPaintModel(
        localPaint,
        additionalSelections,
        editor,
        transientPointerPaint,
      ),
    [localPaint, additionalSelections, editor, transientPointerPaint],
  );
  const subjectsRef = useRef(model.subjects);
  const renderedRef =
    useRef<readonly RenderedSelectionPaint[]>(emptyRenderedPaint);
  const lastMeasuredSubjectsRef = useRef<
    readonly SelectionPaintSubject[] | null
  >(null);
  const measureRef = useRef<(() => void) | null>(null);
  const [rendered, setRendered] =
    useState<readonly RenderedSelectionPaint[]>(emptyRenderedPaint);

  useLayoutEffect(() => {
    subjectsRef.current = model.subjects;
  });

  useLayoutEffect(() => {
    if (model.subjects.length === 0) {
      subjectsRef.current = emptyPaintSubjects;
      lastMeasuredSubjectsRef.current = emptyPaintSubjects;
      commitRenderedSelectionPaint(
        emptyRenderedPaint,
        renderedRef,
        setRendered,
      );
      return;
    }
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      const subjects = subjectsRef.current;
      const next = measureSelectionPaintSubjects(editor.geometry, subjects);
      lastMeasuredSubjectsRef.current = subjects;
      commitRenderedSelectionPaint(next, renderedRef, setRendered);
    };
    measureRef.current = measure;
    const unsubscribe = editor.geometry.subscribe(measure);
    measure();
    return () => {
      disposed = true;
      unsubscribe();
      if (measureRef.current === measure) measureRef.current = null;
    };
  }, [editor.geometry, model.subjects.length]);

  useLayoutEffect(() => {
    if (lastMeasuredSubjectsRef.current === model.subjects) return;
    measureRef.current?.();
  }, [model.subjects]);

  return (
    <div
      className="editor-web-selection-paint-layer"
      data-editor-selection-paint-layer="true"
      data-editor-selection-paint-layer-count="1"
      data-editor-local-paint-plan-result={model.localPlanResult}
      data-editor-local-paint-source-revision={
        model.localPlan?.sourceSelectionRevision
      }
      data-editor-selection-additional-subject-count={
        additionalSelections.length
      }
      data-editor-selection-additional-resolved-subject-count={
        additionalSelections.filter(
          (selection) => selection.resolution === "resolved",
        ).length
      }
      data-editor-selection-additional-unresolved-subject-count={
        additionalSelections.filter(
          (selection) => selection.resolution === "unresolved",
        ).length
      }
      data-editor-selection-additional-invalid-subject-count={
        additionalSelections.filter(
          (selection) => selection.resolution === "invalid",
        ).length
      }
      data-editor-selection-rendered-primitive-count={rendered.length}
      aria-hidden="true"
    >
      <SelectionPaintBand
        band="underlay"
        items={rendered.filter((item) => item.paintKind === "text-fragment")}
      />
      <SelectionPaintBand
        band="overlay"
        items={rendered.filter((item) => item.paintKind !== "text-fragment")}
      />
    </div>
  );
}

function SelectionPaintBand({
  band,
  items,
}: {
  readonly band: "underlay" | "overlay";
  readonly items: readonly RenderedSelectionPaint[];
}) {
  return (
    <div
      className={`editor-web-selection-paint-band editor-web-selection-paint-band--${band}`}
      data-editor-selection-paint-band={band}
    >
      {items.map((item) => (
        <span
          key={item.key}
          className={
            item.paintKind === "caret"
              ? "editor-web-selection-paint-caret"
              : "editor-web-selection-paint-rect"
          }
          data-editor-selection-paint={item.paintKind}
          data-editor-selection-paint-subject-id={item.subjectId}
          data-editor-selection-paint-subject-kind={item.subjectKind}
          data-editor-selection-paint-color={item.color ?? undefined}
          data-editor-selection-source-revision={item.sourceRevision}
          data-editor-selection-paint-block-id={item.blockId}
          data-editor-selection-paint-target={item.target ?? undefined}
          style={paintStyle(item)}
        />
      ))}
    </div>
  );
}

function createSelectionPaintModel(
  localPaint: LocalSelectionPaintModel,
  additionalSelections: readonly AdditionalSelectionRecord[],
  editor: SelectionPaintEditor,
  transientPointerPaint: TransientPointerSelectionPaint | null,
): {
  readonly subjects: readonly SelectionPaintSubject[];
  readonly localPlan: LocalSelectionPaintPlan | null;
  readonly localPlanResult: string | undefined;
} {
  const committed = localPaint.kind === "range" ? localPaint.snapshot : null;
  const derived = committed ? deriveLocalSelectionPaintPlan(committed) : null;
  const localPlan = derived?.ok ? derived.plan : null;
  const subjects: SelectionPaintSubject[] = [];
  if (transientPointerPaint) {
    subjects.push({
      id: "local-selection",
      kind: "local",
      color: null,
      sourceRevision: transientPointerPaint.revision,
      primitives: transientPointerPaint.primitives,
      caret: null,
    });
  } else if (localPlan?.kind === "document") {
    subjects.push({
      id: "local-selection",
      kind: "local",
      color: null,
      sourceRevision: localPlan.sourceSelectionRevision,
      primitives: localPlan.primitives,
      caret: null,
    });
  }
  for (const record of additionalSelections) {
    if (!record.active || record.resolution !== "resolved") continue;
    const selection = record.resolvedSelection;
    if (!selection || selection.kind !== "document") continue;
    const normalized = normalizeNewSelection(
      { anchor: selection.anchor, focus: selection.focus },
      editor,
    );
    if (!normalized.ok) continue;
    const primitives = deriveDocumentSelectionPaintPrimitives(
      normalized.range.rangeBlocks,
    );
    if (!primitives.ok) continue;
    const collapsedText =
      selection.focusTarget.kind === "text" &&
      selection.anchor.blockId === selection.focus.blockId &&
      selection.anchor.textOffset === selection.focus.textOffset;
    subjects.push({
      id: record.subject,
      kind: "additional",
      color: record.color,
      sourceRevision: record.watermark,
      primitives: collapsedText ? emptyPrimitives : primitives.primitives,
      caret:
        collapsedText && selection.focusTarget.kind === "text"
          ? {
              blockId: selection.focusTarget.blockId,
              offset: selection.focusTarget.point.textOffset,
              affinity: selection.focusTarget.point.affinity,
            }
          : null,
    });
  }
  return {
    subjects: subjects.length === 0 ? emptyPaintSubjects : subjects,
    localPlan,
    localPlanResult:
      derived === null ? undefined : derived.ok ? "ok" : derived.reason,
  };
}

function measureSelectionPaintSubjects(
  geometry: EditorDocumentGeometryReader,
  subjects: readonly SelectionPaintSubject[],
): readonly RenderedSelectionPaint[] {
  const rendered: RenderedSelectionPaint[] = [];
  for (const subject of subjects) {
    if (subject.caret) {
      const rect = subject.caret.affinity
        ? geometry.readTextCaretRect(
            subject.caret.blockId,
            subject.caret.offset,
            subject.caret.affinity,
          )
        : geometry.readTextCaretRect(
            subject.caret.blockId,
            subject.caret.offset,
          );
      if (rect) {
        rendered.push(
          paintItem(subject, subject.caret.blockId, "caret", null, rect, 0),
        );
      }
    }
    for (const primitive of subject.primitives) {
      rendered.push(...measurePrimitive(geometry, subject, primitive));
    }
  }
  return rendered.length === 0 ? emptyRenderedPaint : rendered;
}

function measurePrimitive(
  geometry: EditorDocumentGeometryReader,
  subject: SelectionPaintSubject,
  primitive: DocumentSelectionPaintPrimitive,
): readonly RenderedSelectionPaint[] {
  if (primitive.kind === "text-fragment") {
    const textLength = geometry.readTextCanonicalLength(primitive.blockId);
    if (textLength === null) return emptyRenderedPaint;
    if (textLength === 0 && primitive.bounds.coverage === "complete-content") {
      const rect = geometry.readTextRootRect(primitive.blockId);
      return rect
        ? [
            paintItem(
              subject,
              primitive.blockId,
              "text-fragment",
              null,
              rect,
              0,
            ),
          ]
        : emptyRenderedPaint;
    }
    const range = textFragmentRange(primitive, textLength);
    if (!range) return emptyRenderedPaint;
    return geometry
      .readTextRangeRects(primitive.blockId, range)
      .map((rect, index) =>
        paintItem(
          subject,
          primitive.blockId,
          "text-fragment",
          null,
          rect,
          index,
        ),
      );
  }
  const bounds = resolveAtomicSurfacePaintBounds(primitive, (blockId, target) =>
    geometry.readBlockSelectionRect(blockId, target),
  );
  return bounds.ok
    ? [
        paintItem(
          subject,
          primitive.blockId,
          "atomic-surface",
          primitive.target,
          bounds.target,
          0,
        ),
      ]
    : emptyRenderedPaint;
}

function textFragmentRange(
  primitive: Extract<
    DocumentSelectionPaintPrimitive,
    { kind: "text-fragment" }
  >,
  textLength: number,
): { readonly from: number; readonly to: number } | null {
  const from =
    primitive.bounds.coverage === "complete-content"
      ? 0
      : clampOffset(primitive.bounds.startOffset ?? 0, textLength);
  const to =
    primitive.bounds.coverage === "complete-content"
      ? textLength
      : clampOffset(primitive.bounds.endOffset ?? textLength, textLength);
  return from === to
    ? null
    : { from: Math.min(from, to), to: Math.max(from, to) };
}

function paintItem(
  subject: SelectionPaintSubject,
  blockId: BlockId,
  paintKind: RenderedSelectionPaint["paintKind"],
  target: string | null,
  rect: EditorDocumentRect,
  index: number,
): RenderedSelectionPaint {
  return {
    key: [subject.id, blockId, paintKind, target ?? "", index].join("|"),
    subjectId: subject.id,
    subjectKind: subject.kind,
    color: subject.color,
    sourceRevision: subject.sourceRevision,
    blockId,
    paintKind,
    target,
    rect,
  };
}

function paintStyle(item: RenderedSelectionPaint): CSSProperties {
  return {
    left: `${item.rect.left}px`,
    top: `${item.rect.top}px`,
    width: `${item.paintKind === "caret" ? Math.max(2, item.rect.width) : item.rect.width}px`,
    height: `${item.rect.height}px`,
    "--editor-selection-paint-color":
      item.subjectKind === "local"
        ? "Highlight"
        : (item.color ?? "var(--editor-additional-selection-color, Highlight)"),
  } as CSSProperties;
}

function commitRenderedSelectionPaint(
  next: readonly RenderedSelectionPaint[],
  renderedRef: { current: readonly RenderedSelectionPaint[] },
  setRendered: (next: readonly RenderedSelectionPaint[]) => void,
): void {
  if (renderedPaintEqual(next, renderedRef.current)) return;
  renderedRef.current = next;
  setRendered(next.length === 0 ? emptyRenderedPaint : next);
}

function renderedPaintEqual(
  left: readonly RenderedSelectionPaint[],
  right: readonly RenderedSelectionPaint[],
): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => {
      const other = right[index];
      return Boolean(
        other &&
        item.key === other.key &&
        item.color === other.color &&
        item.sourceRevision === other.sourceRevision &&
        item.rect.left === other.rect.left &&
        item.rect.top === other.rect.top &&
        item.rect.width === other.rect.width &&
        item.rect.height === other.rect.height,
      );
    })
  );
}

function clampOffset(offset: number, textLength: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.min(Math.max(0, Math.trunc(offset)), textLength);
}

const emptyPrimitives = Object.freeze(
  [],
) as readonly DocumentSelectionPaintPrimitive[];
