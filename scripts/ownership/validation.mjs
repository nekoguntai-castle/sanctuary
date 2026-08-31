const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;

export function fail(path, message) {
  throw new Error(`${path} ${message}`);
}

export function object(value, path, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object');
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(path, `must contain exactly: ${expected.join(', ')}`);
  }
  return value;
}

export function array(value, path, { min = 0, max = 10_000 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(path, `must contain ${min}-${max} items`);
  return value;
}

export function string(value, path, { min = 1, max = 1024, pattern } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max) fail(path, `must be a ${min}-${max} character string`);
  if (pattern && !pattern.test(value)) fail(path, 'has an invalid format');
  return value;
}

export function integer(value, path, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(path, `must be an integer from ${min} to ${max}`);
  return value;
}

export function enumeration(value, path, allowed) {
  if (!allowed.includes(value)) fail(path, `must be one of: ${allowed.join(', ')}`);
  return value;
}

export function boolean(value, path) {
  if (typeof value !== 'boolean') fail(path, 'must be a boolean');
  return value;
}

export function identifier(value, path) {
  return string(value, path, { max: 128, pattern: IDENTIFIER });
}

export function digest(value, path) {
  return string(value, path, { min: 64, max: 64, pattern: SHA256 });
}

export function commit(value, path) {
  return string(value, path, { min: 40, max: 40, pattern: COMMIT });
}

export function timestamp(value, path) {
  string(value, path, { max: 40 });
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) fail(path, 'must be a canonical UTC timestamp');
  return milliseconds;
}

export function unique(values, path) {
  if (new Set(values).size !== values.length) fail(path, 'must not contain duplicates');
}

export function canonicalRelativePath(value, pathName) {
  string(value, pathName, { max: 512 });
  if (value.startsWith('/') || value.includes('\\') || value.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    fail(pathName, 'must be a canonical repository-relative path');
  }
  return value;
}
