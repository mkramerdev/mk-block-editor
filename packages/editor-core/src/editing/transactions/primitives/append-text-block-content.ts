import type { BlockId } from "../../../kernel/identity/ids.ts";
import type { ContentVersion } from "../../../kernel/versioning/versions.ts";
import type { EditorLogicalContentOperation } from "../../../operations/language/logical-operations.ts";
import type { StructuralTransactionOperation } from "../types.ts";

export function appendTextBlockContent(input: {
  readonly destinationBlockId: BlockId;
  readonly sourceBlockId: BlockId;
  readonly expectedDestinationContentVersion: ContentVersion | string | null;
  readonly expectedSourceContentVersion: ContentVersion | string | null;
  readonly operation: Extract<
    EditorLogicalContentOperation,
    { readonly kind: "insertInlineContent" }
  >;
}): StructuralTransactionOperation {
  return {
    kind: "appendTextBlockContent",
    ...input,
  };
}
