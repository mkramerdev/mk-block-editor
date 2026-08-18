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
import {
  useEditorTypingTriggerSession,
  type EditorTypingTriggerSession,
} from "@repo/editor-web/typing-triggers";
import {
  moveFirstDraftTypingTriggerActiveId,
  retainFirstDraftTypingTriggerActiveId,
  advanceFirstDraftTypingTriggerDismissal,
  initialFirstDraftTypingTriggerDismissalState,
  useFirstDraftTypingTriggerMenuPosition,
} from "../typing-trigger-menu/index.ts";
import {
  filterFirstDraftPeople,
  firstDraftPeople,
  type FirstDraftPerson,
} from "./people.ts";

export interface FirstDraftMentionMenuProps {
  readonly editor: EditableEditor;
  readonly geometry: EditableEditor["geometry"];
  readonly interactions: EditorDocumentLayerInteractionPort;
}

export function FirstDraftMentionMenu({
  editor,
  geometry,
  interactions,
}: FirstDraftMentionMenuProps) {
  const session = useEditorTypingTriggerSession(editor);
  const mentionSession = session?.triggerId === "mention" ? session : null;
  const candidates = useMemo(
    () =>
      mentionSession
        ? filterFirstDraftPeople(mentionSession.query)
        : firstDraftPeople,
    [mentionSession],
  );
  const [activeState, setActiveState] = useState<{
    readonly sessionId: string | null;
    readonly query: string;
    readonly activeId: string | null;
  }>({ sessionId: null, query: "", activeId: null });
  const activeStateIsCurrent =
    activeState.sessionId === (mentionSession?.id ?? null) &&
    activeState.query === (mentionSession?.query ?? "");
  const activeId = mentionSession
    ? retainFirstDraftTypingTriggerActiveId(
        activeState.sessionId === mentionSession.id
          ? activeState.activeId
          : null,
        candidates,
      )
    : null;
  if (!activeStateIsCurrent || activeState.activeId !== activeId) {
    setActiveState({
      sessionId: mentionSession?.id ?? null,
      query: mentionSession?.query ?? "",
      activeId,
    });
  }

  const activeCause = useRef<"keyboard" | "pointer">("keyboard");
  const optionRefs = useRef(new Map<string, HTMLElement>());
  const dismissal = useRef(initialFirstDraftTypingTriggerDismissalState);

  useEffect(() => {
    if (!mentionSession) {
      dismissal.current = initialFirstDraftTypingTriggerDismissalState;
      return;
    }
    const next = advanceFirstDraftTypingTriggerDismissal(
      dismissal.current,
      {
        sessionId: mentionSession.id,
        revision: mentionSession.revision,
        query: mentionSession.query,
      },
      (query) => filterFirstDraftPeople(query).length,
    );
    dismissal.current = next.state;
    if (next.dismiss) {
      editor.dismissTypingTriggerSession({
        sessionId: mentionSession.id,
        revision: mentionSession.revision,
      });
    }
  }, [editor, mentionSession]);

  const accept = useCallback(
    (person: FirstDraftPerson, expected: EditorTypingTriggerSession) => {
      const current = editor.getTypingTriggerSession();
      if (
        !current ||
        current.triggerId !== "mention" ||
        current.id !== expected.id ||
        current.revision !== expected.revision
      ) {
        return false;
      }
      return editor.replaceTypingTriggerWithInlineContent({
        sessionId: current.id,
        revision: current.revision,
        content: [
          { type: "mention", metadata: { id: person.id } },
          { type: "text", text: " " },
        ],
      });
    },
    [editor],
  );

  const keyboardState = useRef({
    mentionSession,
    candidates,
    activeId,
    accept,
  });
  useLayoutEffect(() => {
    keyboardState.current = { mentionSession, candidates, activeId, accept };
  });
  useLayoutEffect(
    () =>
      interactions.registerKeydownHandler((event) => {
        const current = keyboardState.current;
        if (
          !current.mentionSession ||
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
            sessionId: current.mentionSession.id,
            revision: current.mentionSession.revision,
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
        current.accept(candidate, current.mentionSession);
        return "handled";
      }),
    [editor, interactions],
  );

  useLayoutEffect(() => {
    if (activeCause.current !== "keyboard" || !activeId) return;
    optionRefs.current.get(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const { menuRef, position: menuPosition } =
    useFirstDraftTypingTriggerMenuPosition(
      geometry,
      mentionSession?.blockId ?? null,
      mentionSession?.range.from ?? null,
    );
  if (!mentionSession) return null;
  const activeOptionId = activeId ? optionId(activeId) : undefined;
  const style: CSSProperties = menuPosition
    ? ({
        left: menuPosition.left,
        top: menuPosition.top,
        visibility: "visible",
        "--first-draft-mention-menu-available-block-size": `${menuPosition.availableHeight}px`,
      } as CSSProperties)
    : { visibility: "hidden" };

  return (
    <div
      ref={menuRef}
      className="first-draft-mention-menu"
      role="listbox"
      aria-label="Mention people"
      aria-activedescendant={activeOptionId}
      data-editor-ui="true"
      data-first-draft-mention-menu="true"
      data-first-draft-mention-session-id={mentionSession.id}
      data-first-draft-mention-source-block={mentionSession.blockId}
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
        candidates.map((person) => (
          <button
            ref={(element) => {
              if (element) optionRefs.current.set(person.id, element);
              else optionRefs.current.delete(person.id);
            }}
            id={optionId(person.id)}
            type="button"
            tabIndex={-1}
            role="option"
            aria-selected={person.id === activeId}
            className="first-draft-mention-menu__option"
            key={person.id}
            onPointerMove={() => activateFromPointer(person.id)}
            onPointerEnter={() => activateFromPointer(person.id)}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              accept(person, mentionSession);
            }}
          >
            <span className="first-draft-mention-menu__avatar" aria-hidden="true">
              {person.avatarLabel}
            </span>
            <span className="first-draft-mention-menu__copy">
              <span className="first-draft-mention-menu__name">
                {person.displayName}
              </span>
              <span className="first-draft-mention-menu__role">{person.role}</span>
            </span>
          </button>
        ))
      ) : (
        <div className="first-draft-mention-menu__empty">No matching people</div>
      )}
    </div>
  );

  function activateFromPointer(personId: string): void {
    activeCause.current = "pointer";
    setActiveState((current) => ({ ...current, activeId: personId }));
  }
}

function optionId(personId: string): string {
  return `first-draft-mention-option-${personId}`;
}
