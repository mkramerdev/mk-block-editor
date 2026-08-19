import type { EditorCommandDefinition, EditorCommandId } from "./contracts.ts";
import { createImmutableMap } from "./immutable-map.ts";

const validEditorCommandId = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;

export function compileRegisteredEditorCommands(
  definitions: readonly EditorCommandDefinition[],
): ReadonlyMap<EditorCommandId, EditorCommandDefinition> {
  const commands = new Map<EditorCommandId, EditorCommandDefinition>();
  for (const command of definitions) {
    registerCommand(commands, command, "EditableEditorDefinition.commands");
  }
  return createImmutableMap(commands);
}

function registerCommand(
  commands: Map<EditorCommandId, EditorCommandDefinition>,
  command: EditorCommandDefinition,
  source: string,
): void {
  assertValidCommandDefinition(command, source);
  if (commands.has(command.id)) {
    throw new Error(
      `Editor command ${command.id} is registered more than once.`,
    );
  }
  commands.set(command.id, Object.freeze({ ...command }));
}

function assertValidCommandDefinition(
  command: unknown,
  source: string,
): asserts command is EditorCommandDefinition {
  if (!command || typeof command !== "object") {
    throw new Error(`${source} includes a malformed editor command.`);
  }
  const candidate = command as Record<string, unknown>;
  const unsupported = Object.keys(candidate).filter(
    (field) =>
      field !== "id" &&
      field !== "scope" &&
      field !== "execute" &&
      field !== "isEnabled",
  );
  if (unsupported.length > 0) {
    throw new Error(
      `Editor command from ${source} includes unsupported fields: ${unsupported.join(", ")}.`,
    );
  }
  if (
    typeof candidate.id !== "string" ||
    candidate.id.length === 0 ||
    candidate.id.trim() !== candidate.id ||
    !validEditorCommandId.test(candidate.id)
  ) {
    throw new Error(`${source} includes an invalid editor command id.`);
  }
  if (candidate.scope !== "document" && candidate.scope !== "block") {
    throw new Error(
      `Editor command ${candidate.id} from ${source} has invalid scope ${String(candidate.scope)}.`,
    );
  }
  if (typeof candidate.execute !== "function") {
    throw new Error(
      `Editor command ${candidate.id} from ${source} must include an executor.`,
    );
  }
  if (
    candidate.isEnabled !== undefined &&
    typeof candidate.isEnabled !== "function"
  ) {
    throw new Error(
      `Editor command ${candidate.id} from ${source} has an invalid isEnabled function.`,
    );
  }
}
