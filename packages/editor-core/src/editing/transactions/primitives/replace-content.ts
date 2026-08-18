import type { BlockId } from "../../../kernel/identity/ids.ts";
import type { ContentVersion } from "../../../kernel/versioning/versions.ts";
import type {
  StructuralTransactionOperation,
  TransactionContentInput,
} from "../types.ts";
import type { EditorLogicalContentOperation } from "../../../operations/language/logical-operations.ts";

export function replaceContent(input: {
  readonly blockId: BlockId;
  readonly expectedContentVersion: ContentVersion | string | null;
  readonly value: TransactionContentInput;
  readonly operation?: EditorLogicalContentOperation;
}): StructuralTransactionOperation {
  return Object.freeze({ kind: "replaceContent", ...input });
}
