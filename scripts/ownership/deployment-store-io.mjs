import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
  linkSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
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

/**
 * Matches the never-linked temporary sibling a crashed state write can leave
 * (`<name>.tmp-<pid>-<uuid>`, or the older `<name>.tmp-<pid>-<ms>`).
 */
export const TEMPORARY_STATE_FILE = /\.tmp-\d+-[0-9a-f-]+$/;

export function temporarySiblingPath(filePath) {
  return `${filePath}.tmp-${process.pid}-${randomUUID()}`;
}

function removeTemporary(temporary) {
  try { unlinkSync(temporary); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

/** Remove temporaries a crashed write left in `directory` (before rmdir). */
export function removeTemporarySiblings(directory) {
  for (const name of readdirSync(directory)) {
    if (TEMPORARY_STATE_FILE.test(name)) removeTemporary(path.join(directory, name));
  }
}

function writeTemporarySibling(filePath, bytes) {
  const temporary = temporarySiblingPath(filePath);
  const descriptor = openSync(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeAll(descriptor, bytes);
    fsyncSync(descriptor);
  } catch (error) {
    closeSync(descriptor);
    removeTemporary(temporary);
    throw error;
  }
  closeSync(descriptor);
  return temporary;
}

/**
 * Create `filePath` with exactly `bytes`, failing with EEXIST when it already
 * exists. The bytes are written and fsynced to a temporary sibling first and
 * then hard-linked into place, so a crash or ENOSPC can never leave a torn file
 * under the final name (only a stray temporary sibling).
 */
export function writeCreateOnly(filePath, bytes) {
  const temporary = writeTemporarySibling(filePath, bytes);
  try { linkSync(temporary, filePath); } finally { removeTemporary(temporary); }
  fsyncDirectory(path.dirname(filePath));
}

export function writeAtomic(filePath, bytes) {
  const temporary = writeTemporarySibling(filePath, bytes);
  try { renameSync(temporary, filePath); } catch (error) {
    removeTemporary(temporary);
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
