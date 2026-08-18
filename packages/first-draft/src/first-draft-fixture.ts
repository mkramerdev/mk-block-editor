import type {
  EditorInstanceSnapshot,
  EditorTextBlockContent,
} from "@repo/editor-core/codecs";
import {
  createBlockRichTextContentFromPlainText,
  EditorImmutableBinary,
  richTextDocumentWithInlineContent,
  type EditorContentCheckpoint,
} from "@repo/editor-core/content/rich-text";
import type { Block, BlockType } from "@repo/editor-core/document";
import type {
  BlockId,
  EditorOpaqueContentCheckpoint,
  JsonObject,
} from "@repo/editor-core/kernel";
import { createBlockRecord } from "@repo/editor-core/metadata";
import {
  createBlockContentDocContext,
  Doc as YDoc,
  EDITOR_YJS_CONTENT_FORMAT,
  EDITOR_YJS_CONTENT_FORMAT_VERSION,
  encodeBlockContentUpdate,
  ensureCanonicalYjsBlockContent,
} from "@repo/editor-yjs";
import { createDefaultColumnMetadata } from "./blocks/columns/model.ts";
import {
  TABLE_COLUMN_IDS_FIELD,
  TABLE_COLUMN_WIDTHS_FIELD,
} from "./blocks/table/model.ts";

const id = (value: string) => value as BlockId;

export function createFirstDraftSnapshot(): EditorInstanceSnapshot {
  const blocks = {} as Record<BlockId, Block>;
  const content = {} as Record<BlockId, EditorTextBlockContent>;
  const opaqueContentCheckpoints = {} as Record<
    BlockId,
    EditorOpaqueContentCheckpoint
  >;
  const childIdsByParentId = {} as Record<BlockId, BlockId[]>;
  const rootBlockIds: BlockId[] = [];

  const add = (
    blockId: string,
    type: BlockType,
    options: {
      readonly parentId?: string;
      readonly text?: string;
      readonly metadata?: JsonObject;
    } = {},
  ) => {
    const structuralId = id(blockId);
    const parentId = options.parentId ? id(options.parentId) : null;
    blocks[structuralId] = createBlockRecord({
      id: structuralId,
      type,
      parentId,
      ...(options.metadata ? { metadata: options.metadata } : {}),
    });
    if (parentId) {
      (childIdsByParentId[parentId] ??= []).push(structuralId);
    } else {
      rootBlockIds.push(structuralId);
    }
    if (options.text !== undefined) {
      content[structuralId] = createBlockRichTextContentFromPlainText(
        type,
        options.text,
      );
      opaqueContentCheckpoints[structuralId] = toOpaqueCheckpoint(
        createDeterministicCheckpoint(structuralId, content[structuralId]),
      );
    }
    return structuralId;
  };

  add("fd-heading-1", "heading", {
    text: "Northstar Editor: private beta brief",
    metadata: { level: 1 },
  });
  add("fd-paragraph-intro", "paragraph", {
    text: "This brief brings the product, design, and engineering decisions for Northstar's private beta into one working document. It is meant to be edited as the team learns from early customers.",
  });
  add("fd-paragraph-byline", "paragraph", {
    text: "Prepared for the August launch review by the collaborative editing team.",
  });

  add("fd-heading-2", "heading", {
    text: "Why we are building it",
    metadata: { level: 2 },
  });
  add("fd-paragraph-context", "paragraph", {
    text: "Research teams currently split early thinking across chat threads, documents, and issue trackers. Northstar should give them a calm place to shape an idea before it becomes a formal specification.",
  });
  add("fd-quote", "quote");
  add("fd-quote-text", "paragraph", {
    parentId: "fd-quote",
    text: "The best drafting tool disappears while the team is thinking together.",
  });
  add("fd-paragraph-after-quote", "paragraph", {
    text: "That principle means the beta should favor dependable editing and collaboration over a long list of unfinished features.",
  });

  add("fd-callout", "callout", { metadata: { icon: "info" } });
  const calloutTextId = add("fd-callout-text", "paragraph", {
    parentId: "fd-callout",
    text: "Ada owns the interaction review for the beta milestone.",
  });
  const calloutBase = content[calloutTextId]!;
  content[calloutTextId] = richTextDocumentWithInlineContent(
    "paragraph",
    calloutBase,
    [
      { type: "text", text: "Interaction review is assigned to " },
      { type: "mention", metadata: { id: "person-001" } },
      {
        type: "text",
        text: ". The blocking issues are marked in bold.",
        marks: [{ type: "strong" }],
      },
    ],
  );
  opaqueContentCheckpoints[calloutTextId] = toOpaqueCheckpoint(
    createDeterministicCheckpoint(calloutTextId, content[calloutTextId]),
  );
  add("fd-paragraph-before-goals", "paragraph", {
    text: "The first release has three concrete goals:",
  });

  add("fd-bullet-list", "bulletList");
  add("fd-bullet-1", "bulletListItem", { parentId: "fd-bullet-list" });
  add("fd-bullet-1-text", "paragraph", {
    parentId: "fd-bullet-1",
    text: "Make long-form writing feel immediate and predictable.",
  });
  add("fd-bullet-nested-list", "bulletList", { parentId: "fd-bullet-1" });
  add("fd-bullet-nested", "bulletListItem", {
    parentId: "fd-bullet-nested-list",
  });
  add("fd-bullet-nested-text", "paragraph", {
    parentId: "fd-bullet-nested",
    text: "Keep keyboard editing reliable across nested content.",
  });
  add("fd-bullet-2", "bulletListItem", { parentId: "fd-bullet-list" });
  add("fd-bullet-2-text", "paragraph", {
    parentId: "fd-bullet-2",
    text: "Make remote collaborators visible without interrupting local work.",
  });
  add("fd-paragraph-after-goals", "paragraph", {
    text: "Success means a small group can plan, draft, revise, and hand off a document without changing tools.",
  });

  add("fd-heading-3", "heading", {
    text: "How the beta will roll out",
    metadata: { level: 2 },
  });
  add("fd-paragraph-before-rollout", "paragraph", {
    text: "We will introduce the product gradually so that each cohort produces useful feedback for the next one.",
  });
  add("fd-ordered-list", "orderedList");
  add("fd-ordered-1", "orderedListItem", { parentId: "fd-ordered-list" });
  add("fd-ordered-1-text", "paragraph", {
    parentId: "fd-ordered-1",
    text: "Invite five internal project teams and observe their first drafting session.",
  });
  add("fd-ordered-2", "orderedListItem", { parentId: "fd-ordered-list" });
  add("fd-ordered-2-text", "paragraph", {
    parentId: "fd-ordered-2",
    text: "Add ten external research partners once the critical editing paths are stable.",
  });
  add("fd-ordered-3", "orderedListItem", { parentId: "fd-ordered-list" });
  add("fd-ordered-3-text", "paragraph", {
    parentId: "fd-ordered-3",
    text: "Review retention, collaboration, and support findings before opening the waitlist.",
  });
  add("fd-paragraph-before-checklist", "paragraph", {
    text: "The launch review remains focused on a short operational checklist.",
  });
  add("fd-checklist", "checklist");
  add("fd-check-unchecked", "checklistItem", {
    parentId: "fd-checklist",
    metadata: { checked: false },
  });
  add("fd-check-unchecked-text", "paragraph", {
    parentId: "fd-check-unchecked",
    text: "Complete the keyboard and screen-reader review.",
  });
  add("fd-check-checked", "checklistItem", {
    parentId: "fd-checklist",
    metadata: { checked: true },
  });
  add("fd-check-checked-text", "paragraph", {
    parentId: "fd-check-checked",
    text: "Confirm the private-beta cohort and onboarding schedule.",
  });
  add("fd-check-copy", "checklistItem", {
    parentId: "fd-checklist",
    metadata: { checked: true },
  });
  add("fd-check-copy-text", "paragraph", {
    parentId: "fd-check-copy",
    text: "Approve the onboarding guide and sample workspace.",
  });
  add("fd-check-copy-bullet-list", "bulletList", {
    parentId: "fd-check-copy",
  });
  add("fd-check-copy-bullet", "bulletListItem", {
    parentId: "fd-check-copy-bullet-list",
  });
  add("fd-check-copy-bullet-text", "paragraph", {
    parentId: "fd-check-copy-bullet",
    text: "Review the sample workspace permissions.",
  });
  add("fd-check-copy-ordered-list", "orderedList", {
    parentId: "fd-check-copy",
  });
  add("fd-check-copy-ordered", "orderedListItem", {
    parentId: "fd-check-copy-ordered-list",
  });
  add("fd-check-copy-ordered-text", "paragraph", {
    parentId: "fd-check-copy-ordered",
    text: "Publish the guide after approval.",
  });
  add("fd-check-support", "checklistItem", {
    parentId: "fd-checklist",
    metadata: { checked: false },
  });
  add("fd-check-support-text", "paragraph", {
    parentId: "fd-check-support",
    text: "Assign an owner and response target for beta support.",
  });
  add("fd-check-nested", "checklist", { parentId: "fd-check-support" });
  add("fd-check-nested-item", "checklistItem", {
    parentId: "fd-check-nested",
    metadata: { checked: false },
  });
  add("fd-check-nested-text", "paragraph", {
    parentId: "fd-check-nested-item",
    text: "Confirm the first support rotation.",
  });

  add("fd-callout-risk", "callout", { metadata: { icon: "warning" } });
  add("fd-callout-risk-text", "paragraph", {
    parentId: "fd-callout-risk",
    text: "Do not expand the cohort while any reproducible data-loss or focus-loss issue remains unresolved.",
  });

  add("fd-divider", "divider");
  add("fd-heading-interactions", "heading", {
    text: "Interaction notes",
    metadata: { level: 2 },
  });
  add("fd-paragraph-interactions", "paragraph", {
    text: "The following notes collect details that are useful during review but would interrupt the main launch narrative if they were always expanded.",
  });

  add("fd-toggle-heading", "toggleHeading");
  add("fd-toggle-heading-summary", "heading", {
    parentId: "fd-toggle-heading",
    text: "Keyboard interaction edge cases",
    metadata: { level: 3 },
  });
  add("fd-toggle-heading-body", "toggleHeadingBody", {
    parentId: "fd-toggle-heading",
  });
  add("fd-toggle-heading-body-text", "paragraph", {
    parentId: "fd-toggle-heading-body",
    text: "Verify boundary navigation, structural deletion, undo, redo, and selection settlement without requiring a pointer.",
  });
  add("fd-paragraph-between-toggles", "paragraph", {
    text: "Design questions that are still open are tracked separately from confirmed interaction requirements.",
  });

  add("fd-toggle-list", "toggleListItem");
  add("fd-toggle-list-summary", "paragraph", {
    parentId: "fd-toggle-list",
    text: "Questions for the next design review",
  });
  add("fd-toggle-list-body", "toggleListItemBody", {
    parentId: "fd-toggle-list",
  });
  add("fd-toggle-list-body-text", "paragraph", {
    parentId: "fd-toggle-list-body",
    text: "Should a returning collaborator resume their last caret, their last block, or the document's current shared focus?",
  });

  add("fd-toggle-heading-remote", "toggleHeading");
  add("fd-toggle-heading-remote-summary", "heading", {
    parentId: "fd-toggle-heading-remote",
    text: "Remote collaboration assumptions",
    metadata: { level: 3 },
  });
  add("fd-toggle-heading-remote-body", "toggleHeadingBody", {
    parentId: "fd-toggle-heading-remote",
  });
  add("fd-toggle-heading-remote-text", "paragraph", {
    parentId: "fd-toggle-heading-remote-body",
    text: "Presence should become quiet when a person is inactive, while their local editing focus remains stable and ready to resume.",
  });

  add("fd-toggle-list-follow-up", "toggleListItem");
  add("fd-toggle-list-follow-up-summary", "paragraph", {
    parentId: "fd-toggle-list-follow-up",
    text: "Follow-up after the first cohort",
  });
  add("fd-toggle-list-follow-up-body", "toggleListItemBody", {
    parentId: "fd-toggle-list-follow-up",
  });
  add("fd-toggle-list-follow-up-text", "paragraph", {
    parentId: "fd-toggle-list-follow-up-body",
    text: "Compare observed collaboration habits with the assumptions above and record any workflow the document cannot express cleanly.",
  });
  add("fd-paragraph-after-toggles", "paragraph", {
    text: "These notes should become decisions—or be removed—before the public launch brief is written.",
  });

  add("fd-quote-second", "quote");
  add("fd-quote-second-text", "paragraph", {
    parentId: "fd-quote-second",
    text: "A collaborative feature is finished only when it remains understandable after another person changes the document.",
  });
  add("fd-paragraph-after-second-quote", "paragraph", {
    text: "That standard applies equally to local editing, remote reconciliation, and history.",
  });

  add("fd-heading-implementation", "heading", {
    text: "Implementation and references",
    metadata: { level: 2 },
  });
  add("fd-paragraph-before-code", "paragraph", {
    text: "The beta configuration keeps the launch cohort intentionally small.",
  });
  add("fd-code", "code", { metadata: { language: "typescript" } });
  add("fd-code-text", "paragraph", {
    parentId: "fd-code",
    text: "const betaSeats = 15;",
  });
  add("fd-paragraph-between-code", "paragraph", {
    text: "Feature exposure is also explicit so that feedback can be tied to a known experience.",
  });
  add("fd-code-flags", "code", { metadata: { language: "json" } });
  add("fd-code-flags-text", "paragraph", {
    parentId: "fd-code-flags",
    text: '{ "tables": true, "remotePresence": true }',
  });
  add("fd-paragraph-after-code", "paragraph", {
    text: "The detailed research plan and launch checklist live alongside this brief for quick reference.",
  });
  add("fd-bookmark", "bookmark", {
    metadata: { url: "https://example.com/research-plan" },
  });
  add("fd-paragraph-between-bookmarks", "paragraph", {
    text: "The operational checklist is maintained separately so support and product owners can update it during the rollout.",
  });
  add("fd-bookmark-launch", "bookmark", {
    metadata: { url: "https://example.com/private-beta-checklist" },
  });
  add("fd-paragraph-after-bookmarks", "paragraph", {
    text: "Both references should be reviewed at the weekly launch meeting.",
  });

  add("fd-divider-planning", "divider");
  add("fd-heading-planning", "heading", {
    text: "Planning views",
    metadata: { level: 2 },
  });
  add("fd-paragraph-before-columns", "paragraph", {
    text: "The team is splitting attention between product quality and the operational work required to support the cohort.",
  });
  add("fd-columns", "columns");
  add("fd-column-left", "column", {
    parentId: "fd-columns",
    metadata: createDefaultColumnMetadata(),
  });
  add("fd-column-left-heading", "heading", {
    parentId: "fd-column-left",
    text: "Product quality",
    metadata: { level: 3 },
  });
  add("fd-column-left-text", "paragraph", {
    parentId: "fd-column-left",
    text: "Resolve editing, selection, history, and reconciliation issues that could undermine trust.",
  });
  add("fd-column-right", "column", {
    parentId: "fd-columns",
    metadata: createDefaultColumnMetadata(),
  });
  add("fd-column-right-heading", "heading", {
    parentId: "fd-column-right",
    text: "Beta operations",
    metadata: { level: 3 },
  });
  add("fd-column-right-text", "paragraph", {
    parentId: "fd-column-right",
    text: "Prepare onboarding, support coverage, interview times, and a weekly decision log.",
  });
  add("fd-paragraph-between-columns", "paragraph", {
    text: "A second view groups the same work by when it should happen.",
  });

  add("fd-columns-phases", "columns");
  add("fd-column-discovery", "column", {
    parentId: "fd-columns-phases",
    metadata: createDefaultColumnMetadata(),
  });
  add("fd-column-discovery-heading", "heading", {
    parentId: "fd-column-discovery",
    text: "Before invitations",
    metadata: { level: 3 },
  });
  add("fd-column-discovery-text", "paragraph", {
    parentId: "fd-column-discovery",
    text: "Finish the critical review, prepare the workspace, and brief every person who will speak with participants.",
  });
  add("fd-column-delivery", "column", {
    parentId: "fd-columns-phases",
    metadata: createDefaultColumnMetadata(),
  });
  add("fd-column-delivery-heading", "heading", {
    parentId: "fd-column-delivery",
    text: "During the beta",
    metadata: { level: 3 },
  });
  add("fd-column-delivery-text", "paragraph", {
    parentId: "fd-column-delivery",
    text: "Observe real drafting sessions, respond to support quickly, and record decisions while the evidence is fresh.",
  });
  add("fd-paragraph-before-planning-tabs", "paragraph", {
    text: "Audience and success criteria are kept in tabs because reviewers usually need one view at a time.",
  });

  add("fd-planning-tabs", "tabs");
  add("fd-planning-tab-audience", "tabPane", {
    parentId: "fd-planning-tabs",
    metadata: { tabId: "audience", title: "Audience" },
  });
  add("fd-planning-tab-audience-text", "paragraph", {
    parentId: "fd-planning-tab-audience",
    text: "The first cohort consists of research, design, and engineering leads who already co-author planning documents every week.",
  });
  add("fd-planning-tab-metrics", "tabPane", {
    parentId: "fd-planning-tabs",
    metadata: { tabId: "metrics", title: "Success metrics" },
  });

  const metricsTableColumns = [
    "fd-metrics-table-column-a",
    "fd-metrics-table-column-b",
    "fd-metrics-table-column-c",
  ];
  add("fd-metrics-table", "table", {
    parentId: "fd-planning-tab-metrics",
    metadata: {
      width: 0,
      viewId: "first-draft-metrics-table",
      [TABLE_COLUMN_IDS_FIELD]: metricsTableColumns,
      [TABLE_COLUMN_WIDTHS_FIELD]: {
        [metricsTableColumns[0]!]: 208,
        [metricsTableColumns[1]!]: 208,
        [metricsTableColumns[2]!]: 208,
      },
    },
  });
  const metricsTableValues = [
    ["Signal", "Target", "Review"],
    ["Weekly authors", "12", "Friday"],
    ["Critical failures", "0", "Daily"],
  ];
  metricsTableValues.forEach((rowValues, rowIndex) => {
    const rowId = `fd-metrics-table-row-${rowIndex + 1}`;
    add(rowId, "tableRow", { parentId: "fd-metrics-table" });
    rowValues.forEach((value, columnIndex) =>
      add(
        `fd-metrics-table-cell-${rowIndex + 1}-${columnIndex + 1}`,
        "tableCell",
        {
          parentId: rowId,
          text: value,
        },
      ),
    );
  });

  add("fd-heading-release-snapshot", "heading", {
    text: "Release snapshot",
    metadata: { level: 2 },
  });
  add("fd-paragraph-before-tabs", "paragraph", {
    text: "The final view keeps the current release summary and its supporting details close to the decision table.",
  });

  add("fd-tabs", "tabs");
  add("fd-tab-overview", "tabPane", {
    parentId: "fd-tabs",
    metadata: { tabId: "overview", title: "Overview" },
  });
  add("fd-tab-overview-text", "paragraph", {
    parentId: "fd-tab-overview",
    text: "Private beta invitations begin after the interaction review and support dry run are complete.",
  });
  add("fd-tab-details", "tabPane", {
    parentId: "fd-tabs",
    metadata: { tabId: "details", title: "Details" },
  });
  add("fd-tab-details-text", "paragraph", {
    parentId: "fd-tab-details",
    text: "The cohort has fifteen seats, weekly interviews, and a same-business-day response target for blocking issues.",
  });

  const tableColumns = [
    "fd-table-column-a",
    "fd-table-column-b",
    "fd-table-column-c",
  ];
  add("fd-table", "table", {
    metadata: {
      width: 0,
      viewId: "first-draft-table",
      [TABLE_COLUMN_IDS_FIELD]: tableColumns,
      [TABLE_COLUMN_WIDTHS_FIELD]: {
        [tableColumns[0]!]: 208,
        [tableColumns[1]!]: 208,
        [tableColumns[2]!]: 208,
      },
    },
  });
  const tableValues = [
    ["Milestone", "Owner", "State"],
    ["Interaction review", "Ada", "In progress"],
    ["Beta invitations", "Mina", "Planned"],
  ];
  tableValues.forEach((rowValues, rowIndex) => {
    const rowId = `fd-table-row-${rowIndex + 1}`;
    add(rowId, "tableRow", { parentId: "fd-table" });
    rowValues.forEach((value, columnIndex) =>
      add(`fd-table-cell-${rowIndex + 1}-${columnIndex + 1}`, "tableCell", {
        parentId: rowId,
        text: value,
      }),
    );
  });

  add("fd-paragraph-outro", "paragraph", {
    text: "This brief remains the working source for the private beta. Update it when evidence changes the plan, and remove decisions that no longer help the team ship confidently.",
  });

  return {
    blockGraphVersion: 1,
    blocks,
    rootBlockIds,
    childIdsByParentId,
    content,
    opaqueContentCheckpoints,
  };
}

const FIRST_DRAFT_FIXTURE_HYDRATION_ORIGIN = Object.freeze({
  kind: "first-draft-fixture-hydration",
});

/**
 * The browser route starts from a static fixture rather than a server-loaded
 * snapshot. Stable Yjs relative positions are only portable when every peer
 * starts from the same encoded CRDT state, so seed each block with a repeatable
 * client clock and include that state as its hydration checkpoint.
 */
function createDeterministicCheckpoint(
  blockId: BlockId,
  content: EditorTextBlockContent,
): EditorContentCheckpoint {
  const doc = new YDoc();
  doc.clientID = deterministicYjsClientId(blockId);
  const context = createBlockContentDocContext({
    blockId,
    doc,
    destroyDocOnDestroy: true,
  });
  try {
    ensureCanonicalYjsBlockContent(
      context,
      content,
      FIRST_DRAFT_FIXTURE_HYDRATION_ORIGIN,
    );
    return Object.freeze({
      kind: "checkpoint",
      format: EDITOR_YJS_CONTENT_FORMAT,
      version: EDITOR_YJS_CONTENT_FORMAT_VERSION,
      payload: EditorImmutableBinary.takeOwnership(
        encodeBlockContentUpdate(context),
      ),
    });
  } finally {
    context.destroy();
  }
}

function deterministicYjsClientId(blockId: BlockId): number {
  let hash = 2_166_136_261;
  for (const character of blockId) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619) >>> 0;
  }
  return hash || 1;
}

function toOpaqueCheckpoint(
  checkpoint: EditorContentCheckpoint,
): EditorOpaqueContentCheckpoint {
  return Object.freeze({
    kind: "checkpoint",
    format: checkpoint.format,
    version: checkpoint.version,
    payloadBase64: encodeBase64(checkpoint.payload.copy()),
  });
}

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeBase64(bytes: Uint8Array): string {
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const chunk =
      (first << 16) | ((second ?? 0) << 8) | (third === undefined ? 0 : third);
    result += BASE64_ALPHABET[(chunk >>> 18) & 63];
    result += BASE64_ALPHABET[(chunk >>> 12) & 63];
    result += second === undefined ? "=" : BASE64_ALPHABET[(chunk >>> 6) & 63];
    result += third === undefined ? "=" : BASE64_ALPHABET[chunk & 63];
  }
  return result;
}
