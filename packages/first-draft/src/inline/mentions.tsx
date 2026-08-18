import type { InlineAtomDefinition } from "@repo/editor-web/document-runtime";
import { firstDraftInlineAtomModels } from "../server/block-definitions.ts";
import { readFirstDraftPerson } from "../mention-menu/people.ts";

export const firstDraftMentionDefinition = {
  ...firstDraftInlineAtomModels[0]!,
  render: (metadata) => {
    const person = readFirstDraftPerson(String(metadata.id));
    const displayName = person?.displayName ?? "Unknown person";
    return (
      <span
        className="first-draft-mention"
        data-mention-id={String(metadata.id)}
        aria-label={`person mention ${displayName}`}
      >
        @{displayName}
      </span>
    );
  },
} satisfies InlineAtomDefinition;
