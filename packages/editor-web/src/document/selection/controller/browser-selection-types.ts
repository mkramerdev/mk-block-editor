import type { StructuralEditRange } from "@repo/editor-core/editing";
import type {
  CommittedSelectionSnapshot,
  EditorSelectionSnapshot,
} from "@repo/editor-react/selection";

export interface CapturedStructuralSelection {
  readonly captured: CommittedSelectionSnapshot;
  readonly snapshot: EditorSelectionSnapshot;
  readonly range: StructuralEditRange;
  readonly graphRevision: number;
  readonly isCurrent: () => boolean;
}

export type CaptureStructuralSelection = (
  selection: CommittedSelectionSnapshot,
) => CapturedStructuralSelection | null;
