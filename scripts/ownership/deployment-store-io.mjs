import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, renameSync, unlinkSync, writeSync,
} from 'node:fs';
import path from 'node:path';
import { canonicalJson, canonicalSha256, parseStrictJson } from './canonical-json.mjs';

export function ensureOwnerDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const resolved = path.resolve(directory);
  if (realpathSync(directory) !== resolved) {
    throw new Error(`state path must not traverse a symlink: ${resolved}`);
  }
  const info = lstatSync(resolved);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`state path is not a real directory: ${resolved}`);
  }
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
    throw new Error(`state path is not owned by this user: ${resolved}`);
  }
  if ((info.mode & 0o077) !== 0) {
    throw new Error(`state path must be owner-only: ${resolved}`);
  }
  return resolved;
}

export function fsyncDirectory(directory) {
  const descriptor = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function writeAll(descriptor, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(descriptor, bytes, offset);
    if (written === 0) throw new Error('state write made no progress');
    offset += written;
  }
}

export function readStableBytes(filePath) {
  const before = lstatSync(filePath);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`snapshot must be a regular non-symlink file: ${filePath}`);
  }
  const descriptor = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const finalPath = lstatSync(filePath);
    const changed = [
      opened.dev !== before.dev, opened.ino !== before.ino,
      after.dev !== before.dev, after.ino !== before.ino,
      finalPath.dev !== before.dev, finalPath.ino !== before.ino,
      after.size !== bytes.length, after.mtimeMs !== opened.mtimeMs,
      after.ctimeMs !== opened.ctimeMs,
    ].some(Boolean);
    if (changed) throw new Error(`snapshot identity changed while reading: ${filePath}`);
    return bytes;
  } finally { closeSync(descriptor); }
}

export function writeCreateOnly(filePath, bytes) {
  const descriptor = openSync(
    filePath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try { writeAll(descriptor, bytes); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  fsyncDirectory(path.dirname(filePath));
}

export function writeAtomic(filePath, bytes) {
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeCreateOnly(temporary, bytes);
  try { renameSync(temporary, filePath); } catch (error) {
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
  fsyncDirectory(path.dirname(filePath));
}

export function readCanonical(filePath) {
  const info = lstatSync(filePath);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`state file must be a regular non-symlink file: ${filePath}`);
  }
  const bytes = readFileSync(filePath);
  const value = parseStrictJson(bytes);
  if (!canonicalJson(value).equals(bytes)) {
    throw new Error(`state file is not canonical JSON: ${filePath}`);
  }
  return { value, digest: canonicalSha256(value) };
}

export function readOptional(filePath) {
  try { return readCanonical(filePath); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
