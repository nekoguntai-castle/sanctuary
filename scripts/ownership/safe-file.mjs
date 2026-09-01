import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  linkSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';

export const DEFAULT_MAX_EVIDENCE_BYTES = 1024 * 1024;

export function descriptorReadIsStable(opened, after, bytesRead) {
  if (!opened || !after || !Number.isSafeInteger(bytesRead) || bytesRead < 0) return false;
  return opened.dev === after.dev
    && opened.ino === after.ino
    && opened.size === bytesRead
    && after.size === bytesRead
    && opened.mtimeMs === after.mtimeMs
    && opened.ctimeMs === after.ctimeMs;
}

function assertPrivateKeyFile(info) {
  if (!info.isFile() || info.isSymbolicLink()
      || typeof process.getuid !== 'function' || info.uid !== process.getuid()
      || (info.mode & 0o7777) !== 0o600) {
    throw new Error('private key must be a current-user-owned regular file with exact mode 0600');
  }
}

function assertPrivateKeyParent(filePath) {
  const parent = path.dirname(filePath);
  const info = lstatSync(parent);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(parent) !== parent
      || typeof process.getuid !== 'function' || info.uid !== process.getuid()
      || (info.mode & 0o077) !== 0) {
    throw new Error('private key parent must be current-user-owned, owner-only, and non-symlink');
  }
}

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function validateExternalPath(filePath, checkoutRoot) {
  if (!path.isAbsolute(filePath)) throw new Error('evidence path must be absolute');
  const resolvedCheckout = realpathSync(checkoutRoot);
  const resolvedParent = realpathSync(path.dirname(filePath));
  if (resolvedParent !== path.dirname(filePath)) throw new Error('evidence parent must not traverse a symlink');
  if (isWithin(path.join(resolvedParent, path.basename(filePath)), resolvedCheckout)) {
    throw new Error('external evidence must be outside the checkout');
  }
}

function readExternalFileWithPolicy(filePath, { checkoutRoot, maxBytes }, validateFile = () => {}) {
  validateExternalPath(filePath, checkoutRoot);
  const before = lstatSync(filePath);
  validateFile(before);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('evidence must be a regular non-symlink file');
  if (before.size > maxBytes) throw new Error('evidence exceeds byte limit');
  const descriptor = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor);
    validateFile(opened);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error('evidence identity changed while opening');
    }
    const descriptorPath = realpathSync(`/proc/self/fd/${descriptor}`);
    if (descriptorPath !== filePath) throw new Error('opened evidence path does not match the requested path');
    const chunks = [];
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1));
    let total = 0;
    while (true) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      total += count;
      if (total > maxBytes) throw new Error('evidence exceeds byte limit');
      chunks.push(Buffer.from(buffer.subarray(0, count)));
    }
    const after = fstatSync(descriptor);
    const finalPath = lstatSync(filePath);
    validateFile(finalPath);
    if (!descriptorReadIsStable(opened, after, total)
        || !finalPath.isFile() || finalPath.isSymbolicLink()
        || !descriptorReadIsStable(opened, finalPath, total)) {
      throw new Error('evidence changed while reading');
    }
    return Buffer.concat(chunks, total);
  } finally {
    closeSync(descriptor);
  }
}

export function readExternalFile(filePath, { checkoutRoot, maxBytes = DEFAULT_MAX_EVIDENCE_BYTES }) {
  return readExternalFileWithPolicy(filePath, { checkoutRoot, maxBytes });
}

export function readPrivateKeyFile(filePath, { checkoutRoot, maxBytes = 64 * 1024 }) {
  assertPrivateKeyParent(filePath);
  const bytes = readExternalFileWithPolicy(
    filePath, { checkoutRoot, maxBytes }, assertPrivateKeyFile,
  );
  assertPrivateKeyParent(filePath);
  return bytes;
}

function writeAll(descriptor, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const count = writeSync(descriptor, bytes, offset);
    if (count === 0) throw new Error('evidence write made no progress');
    offset += count;
  }
}

export function writeExternalFileAtomic(filePath, bytes, { checkoutRoot, mode = 0o600, replace = false } = {}) {
  validateExternalPath(filePath, checkoutRoot);
  if (!Buffer.isBuffer(bytes)) throw new TypeError('evidence bytes must be a Buffer');
  const parent = realpathSync(path.dirname(filePath));
  const parentStat = statSync(parent);
  if (parentStat.uid !== process.getuid() || (parentStat.mode & 0o077) !== 0) {
    throw new Error('evidence parent must be owner-only');
  }
  const target = path.join(parent, path.basename(filePath));
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  let descriptor;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
    writeAll(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    if (replace) renameSync(temporary, target);
    else { linkSync(temporary, target); unlinkSync(temporary); }
    const parentDescriptor = openSync(parent, constants.O_RDONLY | constants.O_DIRECTORY);
    try { fsyncSync(parentDescriptor); } finally { closeSync(parentDescriptor); }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    try { unlinkSync(temporary); } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') throw cleanupError;
    }
    throw error;
  }
}
