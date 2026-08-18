import type { BlockGraphReplayContext } from "@repo/editor-core/operations";
import type {
  EditorBlockGraphOperationBody,
  TransformBlocksPayload,
} from "@repo/editor-core/operations";

export interface EditorBlockGraphOperation<Payload = TransformBlocksPayload> {
  readonly body: EditorBlockGraphOperationBody<Payload>;
  readonly createdAt: number;
}

export function replayContextFromEditorBlockGraphOperation(
  operation: EditorBlockGraphOperation,
): BlockGraphReplayContext {
  return {
    now: operation.createdAt,
  };
}
