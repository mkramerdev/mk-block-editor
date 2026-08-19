export type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

/** Mutable construction shape. Seal it as JsonValue before publication. */
export type MutableJsonValue =
  | JsonPrimitive
  | MutableJsonValue[]
  | { [key: string]: MutableJsonValue };
export type MutableJsonObject = { [key: string]: MutableJsonValue };

export type MutableJsonClone<T> = T extends JsonPrimitive
  ? T
  : T extends readonly (infer Item)[]
    ? MutableJsonClone<Item>[]
    : T extends object
      ? { -readonly [Key in keyof T]: MutableJsonClone<T[Key]> }
      : T;

export function validateJsonObject(
  value: unknown,
  label = "value",
): readonly string[] {
  if (!isPlainObject(value)) {
    return [`${label} must be a JSON object`];
  }
  return validateJsonValueAtPath(value, label, new WeakSet<object>());
}

export function isJsonObject(value: unknown): value is JsonObject {
  return validateJsonObject(value).length === 0;
}

export function cloneJsonValue<T>(value: T): MutableJsonClone<T> {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item)) as MutableJsonClone<T>;
  }
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const clone = Object.create(
      Object.getPrototypeOf(source) === null ? null : Object.prototype,
    ) as Record<string, unknown>;
    for (const key of Object.keys(source)) {
      Object.defineProperty(clone, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: cloneJsonValue(source[key]),
      });
    }
    return clone as MutableJsonClone<T>;
  }
  return value as MutableJsonClone<T>;
}

/** Clone and deeply seal one validated JSON value at an ownership boundary. */
export function ownJsonValue<T extends JsonValue>(value: T): T {
  return freezeOwnedJsonValue(cloneJsonValue(value)) as T;
}

function freezeOwnedJsonValue(value: MutableJsonValue): MutableJsonValue {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      value[index] = freezeOwnedJsonValue(value[index]!);
    }
    Object.freeze(value);
    return value;
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      value[key] = freezeOwnedJsonValue(value[key]!);
    }
    Object.freeze(value);
    return value;
  }
  return value;
}

function validateJsonValueAtPath(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
): string[] {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return [];
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? []
      : [`${path} must be a finite JSON number`];
  }
  if (Array.isArray(value)) {
    if (seen.has(value))
      return [`${path} must not contain circular references`];
    seen.add(value);
    const errors = validateJsonArrayOwnProperties(value, path);
    for (let index = 0; index < value.length; index += 1) {
      errors.push(
        ...validateJsonValueAtPath(value[index], `${path}[${index}]`, seen),
      );
    }
    seen.delete(value);
    return errors;
  }
  if (isPlainObject(value)) {
    if (seen.has(value))
      return [`${path} must not contain circular references`];
    seen.add(value);
    const errors = validateJsonObjectOwnProperties(value, path);
    for (const key of Object.keys(value)) {
      errors.push(
        ...validateJsonValueAtPath(
          value[key],
          `${path}.${jsonPathKey(key)}`,
          seen,
        ),
      );
    }
    seen.delete(value);
    return errors;
  }
  return [`${path} must be a JSON value`];
}

function validateJsonArrayOwnProperties(
  value: readonly unknown[],
  path: string,
): string[] {
  const errors: string[] = [];
  for (const key of Object.keys(value)) {
    if (!isJsonArrayIndexKey(key, value.length)) {
      errors.push(
        `${path}.${jsonPathKey(key)} must not be an array object property`,
      );
    }
  }
  for (const symbol of Object.getOwnPropertySymbols(value)) {
    errors.push(`${path}[${String(symbol)}] must not use a symbol key`);
  }
  return errors;
}

function validateJsonObjectOwnProperties(
  value: Record<string, unknown>,
  path: string,
): string[] {
  const errors: string[] = [];
  const enumerableKeys = new Set(Object.keys(value));
  for (const key of Object.getOwnPropertyNames(value)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      errors.push(`${path}.${jsonPathKey(key)} is not a safe JSON key`);
    }
    if (!enumerableKeys.has(key)) {
      errors.push(
        `${path}.${jsonPathKey(key)} must be an enumerable JSON property`,
      );
    }
  }
  for (const symbol of Object.getOwnPropertySymbols(value)) {
    errors.push(`${path}[${String(symbol)}] must not use a symbol key`);
  }
  return errors;
}

function isJsonArrayIndexKey(key: string, length: number): boolean {
  if (!/^(0|[1-9][0-9]*)$/.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length;
}

function jsonPathKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (
    validateJsonValueAtPath(left, "left", new WeakSet<object>()).length > 0 ||
    validateJsonValueAtPath(right, "right", new WeakSet<object>()).length > 0
  ) {
    return false;
  }
  return validJsonValuesEqual(left as JsonValue, right as JsonValue);
}

function validJsonValuesEqual(left: JsonValue, right: JsonValue): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (
      !Array.isArray(left) ||
      !Array.isArray(right) ||
      left.length !== right.length
    )
      return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!validJsonValuesEqual(left[index]!, right[index]!)) return false;
    }
    return true;
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (
      !Object.prototype.hasOwnProperty.call(right, key) ||
      !validJsonValuesEqual(left[key] as JsonValue, right[key] as JsonValue)
    ) {
      return false;
    }
  }
  return true;
}
