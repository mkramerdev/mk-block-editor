import type {
  EditorBlockGraphOperationBody,
  TransformBlocksPayload,
} from "@repo/editor-core/operations";

export interface EditorBlockGraphOperation<Payload = TransformBlocksPayload> {
  readonly body: EditorBlockGraphOperationBody<Payload>;
  readonly createdAt: number;
}
