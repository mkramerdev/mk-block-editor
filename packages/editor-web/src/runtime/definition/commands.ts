import type { EditorCommandDefinition, EditorCommandId } from "./contracts.ts";

const validEditorCommandId = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;

export function compileRegisteredEditorCommands(
  definitions: readonly EditorCommandDefinition[],
): ReadonlyMap<EditorCommandId, EditorCommandDefinition> {
  const commands = new Map<EditorCommandId, EditorCommandDefinition>();
  for (const command of definitions) {
    registerCommand(commands, command, "EditableEditorDefinition.commands");
  }
  return new ImmutableRegisteredEditorCommandMap(commands);
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
  commands.set(command.id, command);
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

class ImmutableRegisteredEditorCommandMap
  implements ReadonlyMap<EditorCommandId, EditorCommandDefinition>
{
  readonly #commands: Map<EditorCommandId, EditorCommandDefinition>;

  constructor(commands: Map<EditorCommandId, EditorCommandDefinition>) {
    this.#commands = new Map(commands);
    Object.freeze(this);
  }

  get size(): number {
    return this.#commands.size;
  }

  get(key: EditorCommandId): EditorCommandDefinition | undefined {
    return this.#commands.get(key);
  }

  has(key: EditorCommandId): boolean {
    return this.#commands.has(key);
  }

  forEach(
    callbackfn: (
      value: EditorCommandDefinition,
      key: EditorCommandId,
      map: ReadonlyMap<EditorCommandId, EditorCommandDefinition>,
    ) => void,
    thisArg?: unknown,
  ): void {
    this.#commands.forEach((value, key) =>
      callbackfn.call(thisArg, value, key, this),
    );
  }

  entries(): MapIterator<[EditorCommandId, EditorCommandDefinition]> {
    return this.#commands.entries();
  }

  keys(): MapIterator<EditorCommandId> {
    return this.#commands.keys();
  }

  values(): MapIterator<EditorCommandDefinition> {
    return this.#commands.values();
  }

  [Symbol.iterator](): MapIterator<[EditorCommandId, EditorCommandDefinition]> {
    return this.#commands[Symbol.iterator]();
  }

  get [Symbol.toStringTag](): string {
    return "ImmutableRegisteredEditorCommandMap";
  }
}
