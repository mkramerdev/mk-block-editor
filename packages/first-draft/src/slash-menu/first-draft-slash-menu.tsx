"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { EditableEditor } from "@repo/editor-web/editor";
import type { EditorDocumentLayerInteractionPort } from "@repo/editor-web/document-runtime";
import { useEditorTypingTriggerSession } from "@repo/editor-web/typing-triggers";
import {
  advanceFirstDraftTypingTriggerDismissal,
  initialFirstDraftTypingTriggerDismissalState,
  moveFirstDraftTypingTriggerActiveId,
  retainFirstDraftTypingTriggerActiveId,
  useFirstDraftTypingTriggerMenuPosition,
} from "../typing-trigger-menu/index.ts";
import {
  filterFirstDraftSlashActions,
  firstDraftSlashActionCatalog,
  type FirstDraftSlashAction,
} from "./catalog.ts";
import { materializeFirstDraftSlashAction } from "./materialize.ts";

export interface FirstDraftSlashMenuProps {
  readonly editor: EditableEditor;
  readonly geometry: EditableEditor["geometry"];
  readonly interactions: EditorDocumentLayerInteractionPort;
}

export function FirstDraftSlashMenu({
  editor,
  geometry,
  interactions,
}: FirstDraftSlashMenuProps) {
  const session = useEditorTypingTriggerSession(editor);
  const slashSession = session?.triggerId === "slash" ? session : null;
  const candidates = useMemo(
    () =>
      slashSession
        ? filterFirstDraftSlashActions(slashSession.query)
        : firstDraftSlashActionCatalog,
    [slashSession],
  );
  const [activeState, setActiveState] = useState<{
    readonly sessionId: string | null;
    readonly query: string;
    readonly activeId: string | null;
  }>({ sessionId: null, query: "", activeId: null });
  const activeStateIsCurrent =
    activeState.sessionId === (slashSession?.id ?? null) &&
    activeState.query === (slashSession?.query ?? "");
  const activeId = slashSession
    ? retainFirstDraftTypingTriggerActiveId(
        activeState.sessionId === slashSession.id
          ? activeState.activeId
          : null,
        candidates,
      )
    : null;
  if (!activeStateIsCurrent || activeState.activeId !== activeId) {
    setActiveState({
      sessionId: slashSession?.id ?? null,
      query: slashSession?.query ?? "",
      activeId,
    });
  }
  const activeCause = useRef<"keyboard" | "pointer">("keyboard");
  const optionRefs = useRef(new Map<string, HTMLElement>());
  const dismissal = useRef(initialFirstDraftTypingTriggerDismissalState);

  useEffect(() => {
    if (!slashSession) {
      dismissal.current = initialFirstDraftTypingTriggerDismissalState;
      return;
    }
    const next = advanceFirstDraftTypingTriggerDismissal(
      dismissal.current,
      {
        sessionId: slashSession.id,
        revision: slashSession.revision,
        query: slashSession.query,
      },
      (query) => filterFirstDraftSlashActions(query).length,
    );
    dismissal.current = next.state;
    if (next.dismiss) {
      editor.dismissTypingTriggerSession({
        sessionId: slashSession.id,
        revision: slashSession.revision,
      });
    }
  }, [editor, slashSession]);

  const accept = useCallback(
    (candidate: FirstDraftSlashAction) => {
      const current = editor.getTypingTriggerSession();
      if (!current || current.triggerId !== "slash") return false;
      let materialization;
      try {
        materialization = materializeFirstDraftSlashAction(candidate, editor);
      } catch {
        return false;
      }
      return editor.replaceTypingTriggerWithCanonicalFragment({
        sessionId: current.id,
        revision: current.revision,
        fragment: materialization.fragment,
        selectionBlockId: materialization.selectionBlockId,
      });
    },
    [editor],
  );

  const keyboardState = useRef({
    slashSession,
    candidates,
    activeId,
    accept,
  });
  useLayoutEffect(() => {
    keyboardState.current = { slashSession, candidates, activeId, accept };
  });
  useLayoutEffect(
    () =>
      interactions.registerKeydownHandler((event) => {
        const current = keyboardState.current;
        if (
          !current.slashSession ||
          event.isComposing ||
          event.shiftKey ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        ) {
          return "unhandled";
        }
        if (event.key === "Escape") {
          editor.dismissTypingTriggerSession({
            sessionId: current.slashSession.id,
            revision: current.slashSession.revision,
          });
          return "handled";
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          if (current.candidates.length > 0) {
            activeCause.current = "keyboard";
            setActiveState((state) => ({
              ...state,
              activeId: moveFirstDraftTypingTriggerActiveId(
                retainFirstDraftTypingTriggerActiveId(
                  state.activeId,
                  current.candidates,
                ),
                current.candidates,
                event.key === "ArrowDown" ? 1 : -1,
              ),
            }));
          }
          return "handled";
        }
        if (event.key !== "Enter") return "unhandled";
        const candidate = current.candidates.find(
          ({ id }) => id === current.activeId,
        );
        if (!candidate) return "unhandled";
        current.accept(candidate);
        return "handled";
      }),
    [editor, interactions],
  );

  useLayoutEffect(() => {
    if (activeCause.current !== "keyboard" || !activeId) return;
    optionRefs.current.get(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const { menuRef, position: menuPosition } = useFirstDraftTypingTriggerMenuPosition(
    geometry,
    slashSession?.blockId ?? null,
    slashSession?.range.from ?? null,
  );
  if (!slashSession) return null;
  const activeOptionId = activeId ? optionId(activeId) : undefined;
  const style: CSSProperties = menuPosition
    ? {
        left: menuPosition.left,
        top: menuPosition.top,
        visibility: "visible",
        "--first-draft-slash-menu-available-block-size": `${menuPosition.availableHeight}px`,
      } as CSSProperties
    : { visibility: "hidden" };

  return (
    <div
      ref={menuRef}
      className="first-draft-slash-menu"
      role="listbox"
      aria-label="Insert a First Draft block"
      aria-activedescendant={activeOptionId}
      data-editor-ui="true"
      data-first-draft-slash-menu="true"
      data-first-draft-slash-session-id={slashSession.id}
      data-first-draft-slash-source-block={slashSession.blockId}
      data-placement={menuPosition?.placement}
      style={style}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {candidates.length > 0 ? (
        candidates.map((candidate) => (
          <button
            ref={(element) => {
              if (element) optionRefs.current.set(candidate.id, element);
              else optionRefs.current.delete(candidate.id);
            }}
            id={optionId(candidate.id)}
            type="button"
            tabIndex={-1}
            role="option"
            aria-selected={candidate.id === activeId}
            className="first-draft-slash-menu__option"
            key={candidate.id}
            onPointerMove={() => {
              activeCause.current = "pointer";
              setActiveState((current) => ({
                ...current,
                activeId: candidate.id,
              }));
            }}
            onPointerEnter={() => {
              activeCause.current = "pointer";
              setActiveState((current) => ({
                ...current,
                activeId: candidate.id,
              }));
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              accept(candidate);
            }}
          >
            <span className="first-draft-slash-menu__label">
              {candidate.label}
            </span>
            <span className="first-draft-slash-menu__category">
              {candidate.category}
            </span>
          </button>
        ))
      ) : (
        <div className="first-draft-slash-menu__empty">No matching blocks</div>
      )}
    </div>
  );
}

function optionId(actionId: string): string {
  return `first-draft-slash-option-${actionId}`;
}
