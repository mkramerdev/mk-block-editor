import {
  mergeAdjacentTextNodes,
  type RichTextAttrsJson,
  type RichTextInlineNodeJson,
} from "@repo/editor-core/content/rich-text";
import type { InlineMarkName } from "@repo/editor-core/content/marks";
import type { BlockType } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type {
  EditorContentBaseToken,
  EditorLogicalContentOperation,
} from "@repo/editor-core/operations";
import type {
  EditorState,
  EditorView,
  Transaction,
} from "../../prosemirror/index.ts";
import {
  AddMarkStep,
  RemoveMarkStep,
  ReplaceStep,
} from "prosemirror-transform";
import { proseMirrorInlineFragmentToCanonicalJson } from "../../schema/inline/atom-json.ts";

export interface ProseMirrorStateProposal {
  readonly previousState: EditorState;
  readonly proposedState: EditorState;
  readonly transactions: readonly Transaction[];
  readonly base: EditorContentBaseToken;
}

export type ProseMirrorProposalDispositionKind =
  | "accepted"
  | "view-only"
  | "rejected";

export interface ProseMirrorProposalDisposition {
  readonly kind: ProseMirrorProposalDispositionKind;
  readonly state: EditorState;
  readonly afterStateInstalled?: () => void;
}

export interface ProseMirrorProposalAdapter {
  isProjectingFinalizedContent(): boolean;
  readContentBaseToken(): EditorContentBaseToken;
  evaluateProposal(
    proposal: ProseMirrorStateProposal,
    view: EditorView,
  ): ProseMirrorProposalDisposition;
}

type ProseMirrorOperationsDerivationResult =
  | {
      readonly ok: true;
      readonly operations: readonly EditorLogicalContentOperation[];
    }
  | {
      readonly ok: false;
      readonly message: string;
      readonly transactionIndex: number;
      readonly stepIndex: number;
    };

export function proposalChangesDocument(
  proposal: ProseMirrorStateProposal,
): boolean {
  return proposal.transactions.some((transaction) => transaction.docChanged);
}

export function proposalChangesSelection(
  proposal: ProseMirrorStateProposal,
): boolean {
  return !proposal.previousState.selection.eq(proposal.proposedState.selection);
}

export function deriveProseMirrorOperations(input: {
  readonly proposal: ProseMirrorStateProposal;
  readonly blockId: BlockId;
  readonly blockType: BlockType;
}): ProseMirrorOperationsDerivationResult {
  const operations: EditorLogicalContentOperation[] = [];

  for (
    let transactionIndex = 0;
    transactionIndex < input.proposal.transactions.length;
    transactionIndex += 1
  ) {
    const transaction = input.proposal.transactions[transactionIndex]!;
    for (
      let stepIndex = 0;
      stepIndex < transaction.steps.length;
      stepIndex += 1
    ) {
      const beforeNode = transaction.docs[stepIndex];
      if (!beforeNode) {
        return failure(
          "ProseMirror transaction is missing its step base document",
          transactionIndex,
          stepIndex,
        );
      }

      const step = transaction.steps[stepIndex]!;
      const operation = operationFromStep({
        blockId: input.blockId,
        blockType: input.blockType,
        beforeNode,
        step,
      });
      if ("message" in operation)
        return failure(operation.message, transactionIndex, stepIndex);
      if (!operation.operation) continue;
      operations.push(operation.operation);
    }
  }

  return {
    ok: true,
    operations: Object.freeze(operations),
  };
}

function operationFromStep(input: {
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly beforeNode: Transaction["doc"];
  readonly step: Transaction["steps"][number];
}):
  | { readonly operation: EditorLogicalContentOperation | null }
  | { readonly message: string } {
  if (input.step instanceof ReplaceStep) return operationFromReplaceStep(input);
  if (input.step instanceof AddMarkStep)
    return operationFromMarkStep(input, true);
  if (input.step instanceof RemoveMarkStep)
    return operationFromMarkStep(input, false);
  return {
    message: "Unsupported ProseMirror step; add a direct canonical operation conversion",
  };
}

function operationFromReplaceStep(input: {
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly beforeNode: Transaction["doc"];
  readonly step: Transaction["steps"][number];
}):
  | { readonly operation: EditorLogicalContentOperation | null }
  | { readonly message: string } {
  const step = input.step as unknown as {
    readonly from: number;
    readonly to: number;
    readonly slice: {
      readonly openStart: number;
      readonly openEnd: number;
      readonly content: { toJSON(): unknown };
    };
    getMap(): {
      forEach(
        callback: (
          oldStart: number,
          oldEnd: number,
          newStart: number,
          newEnd: number,
        ) => void,
      ): void;
    };
  };
  if (!validReplaceStepMap(step)) {
    return { message: "ProseMirror ReplaceStep has an inconsistent step map" };
  }
  const from = canonicalOffset(input.beforeNode, step.from);
  const to = canonicalOffset(input.beforeNode, step.to);
  if (from === null || to === null || to < from) {
    return { message: "ProseMirror ReplaceStep range is outside block content" };
  }
  let inserted: readonly RichTextInlineNodeJson[];
  let deleted: readonly RichTextInlineNodeJson[];
  try {
    inserted = canonicalInlineContent(step.slice.content.toJSON());
    deleted = canonicalInlineContent(
      input.beforeNode.slice(step.from, step.to).content.toJSON(),
    );
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? `ProseMirror ReplaceStep content is invalid: ${error.message}`
          : "ProseMirror ReplaceStep content is invalid",
    };
  }
  const point = (offset: number) => ({ blockId: input.blockId, offset });
  const base = {
    blockId: input.blockId,
    blockType: input.blockType,
    target: { kind: "text" as const },
  };
  if (from === to && inserted.length === 0) return { operation: null };
  if (from === to) {
    return {
      operation: {
        ...base,
        kind: "insertInlineContent",
        position: point(from),
        content: inserted,
      },
    };
  }
  const range = { from: point(from), to: point(to) };
  return inserted.length === 0
    ? {
        operation: {
          ...base,
          kind: "deleteInlineRange",
          range,
          deletedContent: deleted,
        },
      }
    : {
        operation: {
          ...base,
          kind: "replaceInlineRange",
          range,
          content: inserted,
          deletedContent: deleted,
        },
      };
}

function operationFromMarkStep(
  input: {
    readonly blockId: BlockId;
    readonly blockType: BlockType;
    readonly beforeNode: Transaction["doc"];
    readonly step: Transaction["steps"][number];
  },
  add: boolean,
):
  | { readonly operation: EditorLogicalContentOperation }
  | { readonly message: string } {
  const step = input.step as unknown as {
    readonly from: number;
    readonly to: number;
    readonly mark: {
      readonly type: { readonly name: string };
      readonly attrs: Readonly<Record<string, unknown>>;
    };
  };
  const from = canonicalOffset(input.beforeNode, step.from);
  const to = canonicalOffset(input.beforeNode, step.to);
  if (from === null || to === null || to <= from || !step.mark?.type.name) {
    return { message: "ProseMirror mark step is outside block content" };
  }
  const attrs = Object.keys(step.mark.attrs ?? {}).length
    ? ({ ...step.mark.attrs } as RichTextAttrsJson)
    : undefined;
  return {
    operation: {
      kind: add ? "addInlineMark" : "removeInlineMark",
      blockId: input.blockId,
      blockType: input.blockType,
      target: { kind: "text" },
      range: {
        from: { blockId: input.blockId, offset: from },
        to: { blockId: input.blockId, offset: to },
      },
      markName: step.mark.type.name as InlineMarkName,
      ...(attrs ? { attrs } : {}),
    },
  };
}

function canonicalInlineContent(value: unknown): readonly RichTextInlineNodeJson[] {
  return mergeAdjacentTextNodes(
    proseMirrorInlineFragmentToCanonicalJson(value),
  );
}

function canonicalOffset(
  doc: Transaction["doc"],
  position: number,
): number | null {
  const block = doc.firstChild;
  if (
    !block?.isTextblock ||
    doc.childCount !== 1 ||
    !Number.isSafeInteger(position) ||
    position < 1 ||
    position > block.content.size + 1
  ) {
    return null;
  }
  return position - 1;
}

function validReplaceStepMap(step: {
  readonly from: number;
  readonly to: number;
  getMap(): {
    forEach(
      callback: (
        oldStart: number,
        oldEnd: number,
        newStart: number,
        newEnd: number,
      ) => void,
    ): void;
  };
}): boolean {
  const ranges: Array<readonly [number, number]> = [];
  step.getMap().forEach((oldStart, oldEnd) => ranges.push([oldStart, oldEnd]));
  return (
    ranges.length === 1 &&
    ranges[0]![0] === step.from &&
    ranges[0]![1] === step.to
  );
}

function failure(
  message: string,
  transactionIndex: number,
  stepIndex: number,
): Extract<ProseMirrorOperationsDerivationResult, { readonly ok: false }> {
  return { ok: false, message, transactionIndex, stepIndex };
}
