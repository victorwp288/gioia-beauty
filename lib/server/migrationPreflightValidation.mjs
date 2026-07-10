export const SHA256_PATTERN = Object.freeze(/^[0-9a-f]{64}$/);
export const COMMIT_SHA_PATTERN = Object.freeze(/^[0-9a-f]{40}$/);
export const UUID_PATTERN = Object.freeze(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
);
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]{0,6})$/;

export function freezeDeep(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freezeDeep(item);
    Object.freeze(value);
  }
  return value;
}

export function addError(errors, code, field) {
  errors.push(Object.freeze({ code, field }));
}

export function exactEnum(options, field, allowed, errors) {
  const value = options[field];
  if (typeof value !== "string") {
    addError(errors, "REQUIRED_FIELD", field);
    return null;
  }
  if (!allowed.has(value)) {
    addError(errors, "INVALID_FIELD", field);
    return null;
  }
  return value;
}

export function exactPattern(options, field, pattern, errors, required = true) {
  const value = options[field];
  if (value === undefined && !required) return null;
  if (typeof value !== "string") {
    addError(errors, "REQUIRED_FIELD", field);
    return null;
  }
  if (!pattern.test(value)) {
    addError(errors, "INVALID_FIELD", field);
    return null;
  }
  return value;
}

export function exactNumber(options, field, minimum, maximum, errors) {
  const value = options[field];
  if (typeof value !== "string") {
    addError(errors, "REQUIRED_FIELD", field);
    return null;
  }
  if (!DECIMAL_PATTERN.test(value)) {
    addError(errors, "INVALID_FIELD", field);
    return null;
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    addError(errors, "INVALID_FIELD", field);
    return null;
  }
  return number;
}

export function requireInvariant(condition, errors, field) {
  if (!condition) addError(errors, "INVARIANT_VIOLATION", field);
}
