import { createHash } from 'node:crypto';

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

export class CanonicalJsonError extends Error {}

function assertUnicode(value, path) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) throw new CanonicalJsonError(`${path} contains a lone surrogate`);
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new CanonicalJsonError(`${path} contains a lone surrogate`);
    }
  }
}

function assertSupported(value, path, seen) {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') return assertUnicode(value, path);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_SAFE_INTEGER || Object.is(value, -0)) {
      throw new CanonicalJsonError(`${path} must be a safe integer`);
    }
    return;
  }
  if (Array.isArray(value)) {
    return assertArray(value, path, seen);
  }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new CanonicalJsonError(`${path} contains an unsupported value`);
  }
  assertObject(value, path, seen);
}

function assertArray(value, path, seen) {
  if (seen.has(value)) throw new CanonicalJsonError(`${path} contains a cycle`);
  seen.add(value);
  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value)) throw new CanonicalJsonError(`${path} contains a sparse array`);
    assertSupported(value[index], `${path}[${index}]`, seen);
  }
  seen.delete(value);
}

function assertObject(value, path, seen) {
  if (seen.has(value)) throw new CanonicalJsonError(`${path} contains a cycle`);
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    assertUnicode(key, `${path} key`);
    if (child === undefined) throw new CanonicalJsonError(`${path}.${key} is undefined`);
    assertSupported(child, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function serialize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`;
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${serialize(value[key])}`);
  return `{${entries.join(',')}}`;
}

/** RFC 8785 JSON Canonicalization Scheme with Sanctuary's integer-only subset. */
export function canonicalJson(value) {
  assertSupported(value, '$', new Set());
  return Buffer.from(serialize(value), 'utf8');
}

export function canonicalSha256(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

class StrictParser {
  constructor(text) { this.text = text; this.index = 0; }
  parse() {
    const value = this.value();
    this.space();
    if (this.index !== this.text.length) this.error('unexpected trailing input');
    return value;
  }
  error(message) { throw new CanonicalJsonError(`invalid JSON at byte ${Buffer.byteLength(this.text.slice(0, this.index))}: ${message}`); }
  space() { while (/[\x20\t\r\n]/.test(this.text[this.index] ?? '')) this.index += 1; }
  value() {
    this.space();
    const character = this.text[this.index];
    if (character === '{') return this.object();
    if (character === '[') return this.array();
    if (character === '"') return this.string();
    if (character === '-' || /[0-9]/.test(character ?? '')) return this.number();
    for (const [token, value] of [['true', true], ['false', false], ['null', null]]) {
      if (this.text.startsWith(token, this.index)) { this.index += token.length; return value; }
    }
    this.error('expected a JSON value');
  }
  string() {
    const start = this.index;
    this.index += 1;
    while (this.index < this.text.length) {
      const character = this.text[this.index++];
      if (character === '"') {
        let value;
        try { value = JSON.parse(this.text.slice(start, this.index)); } catch { this.error('invalid string'); }
        assertUnicode(value, '$ string');
        return value;
      }
      if (character === '\\') this.index += 1;
      else if (character.charCodeAt(0) < 0x20) this.error('unescaped control character');
    }
    this.error('unterminated string');
  }
  number() {
    const remaining = this.text.slice(this.index);
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(remaining);
    if (!match) this.error('invalid number');
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isSafeInteger(value) || Object.is(value, -0) || /[.eE]/.test(match[0])) this.error('number is outside the integer-only subset');
    return value;
  }
  array() {
    const values = [];
    this.index += 1;
    this.space();
    if (this.text[this.index] === ']') { this.index += 1; return values; }
    while (true) {
      values.push(this.value());
      this.space();
      if (this.text[this.index] === ']') { this.index += 1; return values; }
      if (this.text[this.index++] !== ',') this.error('expected comma in array');
    }
  }
  object() {
    const value = Object.create(null);
    const keys = new Set();
    this.index += 1;
    this.space();
    if (this.text[this.index] === '}') { this.index += 1; return { ...value }; }
    while (true) {
      this.space();
      if (this.text[this.index] !== '"') this.error('expected object member name');
      const key = this.string();
      if (keys.has(key)) this.error('duplicate object member name');
      keys.add(key);
      this.space();
      if (this.text[this.index++] !== ':') this.error('expected colon after member name');
      value[key] = this.value();
      this.space();
      if (this.text[this.index] === '}') { this.index += 1; return { ...value }; }
      if (this.text[this.index++] !== ',') this.error('expected comma in object');
    }
  }
}

export function parseStrictJson(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return new StrictParser(text).parse();
}
