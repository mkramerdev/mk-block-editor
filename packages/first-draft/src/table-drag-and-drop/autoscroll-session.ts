import {
  createAutoScroll,
  type AutoScroll,
  type AutoScrollPoint,
  type CreateAutoScrollInput,
} from "mk-autoscroll";
import type { BlockId } from "@repo/editor-core/kernel";

export type FirstDraftActiveAutoScrollSession =
  | { readonly kind: "inactive"; readonly generation: number }
  | { readonly kind: "document-selection"; readonly generation: number }
  | {
      readonly kind: "document-block";
      readonly generation: number;
      readonly group: string;
    }
  | {
      readonly kind: "table-drag";
      readonly generation: number;
      readonly group: string;
      readonly tableId: BlockId;
      readonly tableScrollElement: HTMLElement;
    };

export interface FirstDraftAutoScrollSessionOwner {
  getSession(): FirstDraftActiveAutoScrollSession;
  startDocumentSelection(point: AutoScrollPoint): void;
  updateDocumentSelection(point: AutoScrollPoint): void;
  stopDocumentSelection(): void;
  startDocumentBlock(group: string, point: AutoScrollPoint): void;
  updateDocumentBlock(group: string, point: AutoScrollPoint): void;
  stopDocumentBlock(group: string): void;
  startTableDrag(
    group: string,
    tableId: BlockId,
    tableScrollElement: HTMLElement,
    point: AutoScrollPoint,
  ): boolean;
  updateTableDrag(
    group: string,
    tableId: BlockId,
    point: AutoScrollPoint,
  ): void;
  stopTableDrag(group: string, tableId: BlockId): void;
  stopAll(): void;
}

export interface CreateFirstDraftAutoScrollSessionOwnerInput {
  readonly getDocumentScrollElement: () => HTMLElement | null;
  readonly getTableScrollElement: (tableId: BlockId) => HTMLElement | null;
  readonly onDragScroll: (group: string) => void;
  readonly onDragSessionStopped: (group: string) => void;
  readonly onTableSessionInvalidated: (tableId: BlockId) => void;
  readonly createController?: (input: CreateAutoScrollInput) => AutoScroll;
}

export function createFirstDraftAutoScrollSessionOwner({
  getDocumentScrollElement,
  getTableScrollElement,
  onDragScroll,
  onDragSessionStopped,
  onTableSessionInvalidated,
  createController = createAutoScroll,
}: CreateFirstDraftAutoScrollSessionOwnerInput): FirstDraftAutoScrollSessionOwner {
  let generation = 0;
  let session: FirstDraftActiveAutoScrollSession = {
    kind: "inactive",
    generation,
  };
  let pendingInvalidationGeneration: number | null = null;

  const documentController = createController({
    container: () => connected(getDocumentScrollElement()),
    axis: "y",
    outsideBehavior: "continue",
    onScroll: () => {
      if (session.kind === "document-block") onDragScroll(session.group);
    },
  });
  const tableController = createController({
    container: resolveTableContainers,
    axis: "both",
    outsideBehavior: "continue",
    onScroll: () => {
      if (session.kind !== "table-drag" || !isLiveTableSession(session)) return;
      onDragScroll(session.group);
    },
  });

  const owner: FirstDraftAutoScrollSessionOwner = {
    getSession: () => session,
    startDocumentSelection(point) {
      const stoppedGroup = dragGroup(session);
      stopControllers();
      session = { kind: "document-selection", generation: ++generation };
      if (stoppedGroup) onDragSessionStopped(stoppedGroup);
      documentController.updatePoint(point);
      documentController.start();
    },
    updateDocumentSelection(point) {
      if (session.kind === "document-selection") {
        documentController.updatePoint(point);
      }
    },
    stopDocumentSelection() {
      if (session.kind === "document-selection") stopAll();
    },
    startDocumentBlock(group, point) {
      const stoppedGroup = dragGroup(session);
      stopControllers();
      session = { kind: "document-block", generation: ++generation, group };
      if (stoppedGroup) onDragSessionStopped(stoppedGroup);
      documentController.updatePoint(point);
      documentController.start();
    },
    updateDocumentBlock(group, point) {
      if (session.kind === "document-block" && session.group === group) {
        documentController.updatePoint(point);
      }
    },
    stopDocumentBlock(group) {
      if (session.kind === "document-block" && session.group === group) {
        stopAll();
      }
    },
    startTableDrag(group, tableId, tableScrollElement, point) {
      const documentScrollElement = connected(getDocumentScrollElement());
      if (
        !tableScrollElement.isConnected ||
        getTableScrollElement(tableId) !== tableScrollElement ||
        !documentScrollElement
      ) {
        return false;
      }
      const stoppedGroup = dragGroup(session);
      stopControllers();
      session = {
        kind: "table-drag",
        generation: ++generation,
        group,
        tableId,
        tableScrollElement,
      };
      if (stoppedGroup) onDragSessionStopped(stoppedGroup);
      tableController.updatePoint(point);
      tableController.start();
      return true;
    },
    updateTableDrag(group, tableId, point) {
      if (
        session.kind !== "table-drag" ||
        session.group !== group ||
        session.tableId !== tableId
      ) {
        return;
      }
      if (!isLiveTableSession(session)) {
        scheduleTableInvalidation(session);
        return;
      }
      tableController.updatePoint(point);
    },
    stopTableDrag(group, tableId) {
      if (
        session.kind === "table-drag" &&
        session.group === group &&
        session.tableId === tableId
      ) {
        stopAll();
      }
    },
    stopAll,
  };
  return Object.freeze(owner);

  function stopControllers(): void {
    documentController.updatePoint(null);
    documentController.stop();
    tableController.updatePoint(null);
    tableController.stop();
    pendingInvalidationGeneration = null;
  }

  function stopAll(): void {
    const stoppedGroup = dragGroup(session);
    stopControllers();
    session = { kind: "inactive", generation: ++generation };
    if (stoppedGroup) onDragSessionStopped(stoppedGroup);
  }

  function resolveTableContainers(): readonly HTMLElement[] {
    if (session.kind !== "table-drag") return [];
    if (!isLiveTableSession(session)) {
      scheduleTableInvalidation(session);
      return [];
    }
    return [session.tableScrollElement, getDocumentScrollElement()!];
  }

  function isLiveTableSession(
    candidate: Extract<FirstDraftActiveAutoScrollSession, { kind: "table-drag" }>,
  ): boolean {
    const documentScrollElement = connected(getDocumentScrollElement());
    return (
      candidate.tableScrollElement.isConnected &&
      documentScrollElement !== null &&
      getTableScrollElement(candidate.tableId) === candidate.tableScrollElement
    );
  }

  function scheduleTableInvalidation(
    candidate: Extract<FirstDraftActiveAutoScrollSession, { kind: "table-drag" }>,
  ): void {
    if (pendingInvalidationGeneration === candidate.generation) return;
    pendingInvalidationGeneration = candidate.generation;
    queueMicrotask(() => {
      if (
        session.kind !== "table-drag" ||
        session.generation !== candidate.generation ||
        isLiveTableSession(session)
      ) {
        return;
      }
      const tableId = session.tableId;
      stopAll();
      onTableSessionInvalidated(tableId);
    });
  }
}

function dragGroup(
  session: FirstDraftActiveAutoScrollSession,
): string | null {
  return session.kind === "document-block" || session.kind === "table-drag"
    ? session.group
    : null;
}

function connected(element: HTMLElement | null): HTMLElement | null {
  return element?.isConnected ? element : null;
}
