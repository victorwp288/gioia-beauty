import "server-only";

import { types } from "node:util";

export function exactDataObject(
  value: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> | null {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      types.isProxy(value)
    ) {
      return null;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const expected = new Set(expectedKeys);
    const keys = Reflect.ownKeys(value);
    if (
      expected.size !== expectedKeys.length ||
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== "string" || !expected.has(key))
    ) {
      return null;
    }

    const copy = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return null;
      }
      Object.defineProperty(copy, key, {
        value: descriptor.value,
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(copy);
  } catch {
    return null;
  }
}

export function exactDataObjectWithOptionalKeys(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
): Readonly<Record<string, unknown>> | null {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      types.isProxy(value)
    ) {
      return null;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const required = new Set(requiredKeys);
    const allowed = new Set([...requiredKeys, ...optionalKeys]);
    const keys = Reflect.ownKeys(value);
    if (
      allowed.size !== requiredKeys.length + optionalKeys.length ||
      keys.some((key) => typeof key !== "string" || !allowed.has(key)) ||
      [...required].some((key) => !keys.includes(key))
    ) {
      return null;
    }

    const copy = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return null;
      }
      Object.defineProperty(copy, key, {
        value: descriptor.value,
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(copy);
  } catch {
    return null;
  }
}

export function exactDenseArray(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): readonly unknown[] | null {
  try {
    if (
      !Array.isArray(value) ||
      types.isProxy(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      value.length < minimumLength ||
      value.length > maximumLength
    ) {
      return null;
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || !keys.includes("length")) {
      return null;
    }
    const copy = new Array<unknown>(value.length);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return null;
      }
      Object.defineProperty(copy, String(index), {
        value: descriptor.value,
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(copy);
  } catch {
    return null;
  }
}

export function exactDate(value: unknown): Date | null {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      types.isProxy(value) ||
      Object.getPrototypeOf(value) !== Date.prototype ||
      Reflect.ownKeys(value).length !== 0
    ) {
      return null;
    }
    const milliseconds = Date.prototype.getTime.call(value);
    return Number.isFinite(milliseconds) ? new Date(milliseconds) : null;
  } catch {
    return null;
  }
}
