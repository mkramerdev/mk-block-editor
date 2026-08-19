"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
} from "react";
import type {
  EditorSelectionInlineMarkFormatName,
  EditorSelectionInlineMarkFormatState,
} from "@repo/editor-react/selection";
import type { EditableEditor } from "@repo/editor-web/editor";
import type { ReadEditor } from "@repo/editor-web/read-runtime";
import { FirstDraftIcon } from "../ui/icon.tsx";
import { linkIcon } from "../ui/icons.ts";
import {
  FirstDraftSelectionLinkForm,
  type FirstDraftSelectionLinkDraft,
} from "./first-draft-selection-link-form.tsx";
import {
  createFirstDraftSelectionMenuStore,
  type FirstDraftSelectionMenuSnapshot,
} from "./selection-menu-store.ts";
import {
  deriveFirstDraftSelectionMenuPreferredPlacement,
  placeFirstDraftSelectionMenu,
  type FirstDraftSelectionMenuPosition,
} from "./selection-menu-position.ts";

export interface FirstDraftSelectionMenuProps {
  readonly editor: EditableEditor | ReadEditor;
}

const actions = Object.freeze([
  { markName: "strong", label: "Bold", glyph: <strong>B</strong> },
  { markName: "em", label: "Italic", glyph: <em>I</em> },
  { markName: "underline", label: "Underline", glyph: <u>U</u> },
  { markName: "strikethrough", label: "Strikethrough", glyph: <s>S</s> },
  { markName: "code", label: "Code", glyph: <code>&lt;/&gt;</code> },
] satisfies readonly {
  readonly markName: EditorSelectionInlineMarkFormatName;
  readonly label: string;
  readonly glyph: React.ReactNode;
}[]);

export function FirstDraftSelectionMenu({
  editor,
}: FirstDraftSelectionMenuProps) {
  return editor.editable ? (
    <EditableFirstDraftSelectionMenu editor={editor} />
  ) : null;
}

function EditableFirstDraftSelectionMenu({
  editor,
}: {
  readonly editor: EditableEditor;
}) {
  const store = useMemo(
    () => createFirstDraftSelectionMenuStore(editor),
    [editor],
  );
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const menuRef = useRef<HTMLDivElement>(null);
  const linkButtonRef = useRef<HTMLButtonElement>(null);
  const [measured, setMeasured] = useState<{
    readonly key: string;
    readonly position: FirstDraftSelectionMenuPosition | null;
  } | null>(null);
  const frameRef = useRef<number | null>(null);
  const activeLink = snapshot.linkSession;
  const presentedSelection = activeLink?.selection ?? snapshot.selection;
  const presentedStates = activeLink?.states ?? snapshot.states;
  const menuApplicable = activeLink !== null || snapshot.applicable;
  const geometryRevision = useSyncExternalStore(
    menuApplicable ? editor.geometry.subscribe : subscribeNever,
    menuApplicable ? editor.geometry.getRevision : readZero,
    readZero,
  );
  const measurementKey = selectionMeasurementKey(presentedSelection);

  const measure = useCallback(() => {
    frameRef.current = null;
    const element = menuRef.current;
    const anchor = presentedSelection?.endpoints.anchor;
    const head = presentedSelection?.endpoints.head;
    if (!element || !menuApplicable || !head || !head.textAnchor) {
      setMeasured({ key: measurementKey, position: null });
      return;
    }
    const headCaret = editor.geometry.readViewportTextCaretRect(
      head.blockId,
      head.textOffset,
      head.affinity ?? undefined,
    );
    if (!headCaret) {
      setMeasured({ key: measurementKey, position: null });
      return;
    }
    const anchorCaret =
      anchor && anchor.textAnchor
        ? editor.geometry.readViewportTextCaretRect(
            anchor.blockId,
            anchor.textOffset,
            anchor.affinity ?? undefined,
          )
        : null;
    const preferredPlacement = anchorCaret
      ? deriveFirstDraftSelectionMenuPreferredPlacement(anchorCaret, headCaret)
      : "above";
    const rect = element.getBoundingClientRect();
    const visual = window.visualViewport;
    setMeasured({
      key: measurementKey,
      position: placeFirstDraftSelectionMenu(
        headCaret,
        { width: rect.width, height: rect.height },
        visual
          ? {
              left: visual.offsetLeft,
              top: visual.offsetTop,
              width: visual.width,
              height: visual.height,
            }
          : {
              left: 0,
              top: 0,
              width: window.innerWidth,
              height: window.innerHeight,
            },
        preferredPlacement,
      ),
    });
  }, [editor, measurementKey, menuApplicable, presentedSelection]);

  const scheduleMeasure = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(measure);
  }, [measure]);

  useLayoutEffect(() => {
    if (!menuApplicable) return;
    scheduleMeasure();
  }, [
    scheduleMeasure,
    menuApplicable,
    snapshot.states,
    activeLink,
    geometryRevision,
  ]);

  useEffect(() => {
    if (!menuApplicable) return;
    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(scheduleMeasure)
        : null;
    if (menuRef.current) observer?.observe(menuRef.current);
    return () => {
      observer?.disconnect();
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [menuApplicable, scheduleMeasure]);

  if (!menuApplicable || !presentedSelection) return null;
  const position = measured?.key === measurementKey ? measured.position : null;
  const style: CSSProperties = position
    ? { left: position.left, top: position.top, visibility: "visible" }
    : { visibility: "hidden" };
  const preventPointerSelection = (
    event: PointerEvent<HTMLButtonElement> | MouseEvent<HTMLButtonElement>,
  ): void => {
    event.preventDefault();
    event.stopPropagation();
  };
  const closeLink = (): void => {
    linkButtonRef.current?.focus({ preventScroll: true });
    store.closeLinkSession();
  };
  const linkState = presentedStates.link;

  return (
    <div
      ref={menuRef}
      className="first-draft-selection-menu"
      role="toolbar"
      aria-label="Text formatting"
      data-editor-ui="true"
      data-editor-preserve-selection="true"
      data-first-draft-selection-menu="true"
      data-placement={position?.placement}
      style={style}
    >
      <div className="first-draft-selection-menu__actions">
        {actions.map((action) => (
          <FormatToggleButton
            key={action.markName}
            editor={editor}
            selection={presentedSelection}
            markName={action.markName}
            label={action.label}
            state={presentedStates[action.markName]}
            onPointerDown={preventPointerSelection}
            onMouseDown={preventPointerSelection}
          >
            {action.glyph}
          </FormatToggleButton>
        ))}
        <button
          ref={linkButtonRef}
          type="button"
          className="first-draft-selection-menu__button"
          aria-label="Link"
          aria-pressed={ariaPressed(linkState)}
          disabled={!linkState?.canExecute}
          onPointerDown={preventPointerSelection}
          onMouseDown={preventPointerSelection}
          onClick={() =>
            snapshot.selection
              ? store.openLinkSession({
                  selection: snapshot.selection,
                  states: snapshot.states,
                  draft: linkDraft(linkState),
                  canRemove: Boolean(linkState?.active || linkState?.mixed),
                })
              : undefined
          }
        >
          <FirstDraftIcon aria-hidden="true" icon={linkIcon} />
        </button>
      </div>
      {activeLink ? (
        <FirstDraftSelectionLinkForm
          editor={editor}
          selection={activeLink.selection}
          initialDraft={activeLink.draft}
          canRemove={activeLink.canRemove}
          onClose={closeLink}
        />
      ) : null}
    </div>
  );
}

function FormatToggleButton({
  editor,
  selection,
  markName,
  label,
  state,
  children,
  onPointerDown,
  onMouseDown,
}: {
  readonly editor: EditableEditor;
  readonly selection: NonNullable<FirstDraftSelectionMenuSnapshot["selection"]>;
  readonly markName: EditorSelectionInlineMarkFormatName;
  readonly label: string;
  readonly state?: EditorSelectionInlineMarkFormatState;
  readonly children: React.ReactNode;
  readonly onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  readonly onMouseDown: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className="first-draft-selection-menu__button"
      aria-label={label}
      aria-pressed={ariaPressed(state)}
      disabled={!state?.canExecute}
      onPointerDown={onPointerDown}
      onMouseDown={onMouseDown}
      onClick={() => {
        editor.formatSelectionInlineMark({ selection, markName });
      }}
    >
      {children}
    </button>
  );
}

function ariaPressed(
  state: EditorSelectionInlineMarkFormatState | undefined,
): boolean | "mixed" {
  return state?.mixed ? "mixed" : state?.active === true;
}

function linkDraft(
  state: EditorSelectionInlineMarkFormatState | undefined,
): FirstDraftSelectionLinkDraft {
  if (!state?.active || state.mixed || !state.value) {
    return { href: "", title: "", target: "", mixed: state?.mixed === true };
  }
  return {
    href: typeof state.value.href === "string" ? state.value.href : "",
    title: typeof state.value.title === "string" ? state.value.title : "",
    target: state.value.target === "_blank" ? "_blank" : "",
    mixed: false,
  };
}

const subscribeNever = () => () => undefined;
const readZero = () => 0;

function selectionMeasurementKey(
  selection: FirstDraftSelectionMenuSnapshot["selection"],
): string {
  const anchor = selection?.endpoints.anchor;
  const head = selection?.endpoints.head;
  return `${endpointMeasurementKey(anchor)}|${endpointMeasurementKey(head)}`;
}

function endpointMeasurementKey(
  endpoint:
    | {
        readonly blockId: string;
        readonly textOffset: number;
        readonly affinity?: string | null;
      }
    | null
    | undefined,
): string {
  if (!endpoint) return "none";
  return `${endpoint.blockId}:${endpoint.textOffset}:${endpoint.affinity ?? ""}`;
}
