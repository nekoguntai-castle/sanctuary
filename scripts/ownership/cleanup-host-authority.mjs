import {
  existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { canonicalSha256 } from './canonical-json.mjs';
import {
  buildCleanupSafeHelper, CLEANUP_SAFE_HELPER_SOURCE, inspectCleanupSafeHelper,
} from './cleanup-safe-helper.mjs';

export const HOST_AUTHORITY_POLICY = 'sanctuary.cleanup-host-authority.v1';
const HOST_CLASSES = new Set(['collector_process', 'git_worktree', 'temporary_artifact']);

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function ensurePrivateDirectory(directory, checkoutRoot) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const resolved = realpathSync(directory);
  const checkout = realpathSync(checkoutRoot);
  const info = lstatSync(resolved);
  if (resolved !== directory || isWithin(resolved, checkout) || !info.isDirectory()
      || info.isSymbolicLink() || (info.mode & 0o077) !== 0
      || (typeof process.getuid === 'function' && info.uid !== process.getuid())) {
    throw new Error('host helper directory must be private, canonical, and outside checkout');
  }
  return resolved;
}

function verifiedAuthority(helperPath) {
  const info = inspectCleanupSafeHelper(helperPath);
  const normalized = {
    policy: HOST_AUTHORITY_POLICY, platform: info.platform,
    abiVersion: info.abiVersion, helperDigest: info.helperDigest,
    features: { openat2: info.openat2, pidfd: info.pidfd, renameat2: info.renameat2 },
  };
  return Object.freeze({
    available: Object.values(normalized.features).every(Boolean), helperPath,
    ...normalized, digest: canonicalSha256(normalized),
  });
}

function buildHelper(directory) {
  const sourceDigest = canonicalSha256({ source: readFileSync(CLEANUP_SAFE_HELPER_SOURCE, 'utf8') });
  const temporary = path.join(directory, `.cleanup-safe-helper-${sourceDigest}.tmp-${process.pid}-${Date.now()}`);
  const target = path.join(directory, `cleanup-safe-helper-${sourceDigest}`);
  try {
    buildCleanupSafeHelper({ outputPath: temporary });
    const built = verifiedAuthority(temporary);
    if (existsSync(target)) {
      const current = verifiedAuthority(target);
      if (current.helperDigest !== built.helperDigest) {
        throw new Error('existing host helper conflicts with the current source build');
      }
    } else renameSync(temporary, target);
  } finally {
    try { if (existsSync(temporary)) unlinkSync(temporary); } catch { /* inert private temp */ }
  }
  return verifiedAuthority(target);
}

function unavailableAuthority(error) {
  const normalized = {
    policy: HOST_AUTHORITY_POLICY, platform: process.platform,
    abiVersion: null, helperDigest: null,
    features: { openat2: false, pidfd: false, renameat2: false },
    failureClass: ['ENOENT', 'EACCES', 'EPERM'].includes(error?.code) ? 'unsupported' : 'query_failed',
  };
  return Object.freeze({
    available: false, helperPath: null, ...normalized, digest: canonicalSha256(normalized),
  });
}

/** Resolve a private immutable helper only when a v1.1 host registration is selected. */
export function resolveCleanupHostAuthority({ runtimeDirectory, checkoutRoot, registrations }) {
  const required = registrations.some((entry) => entry.schemaVersion === '1.1.0'
    && HOST_CLASSES.has(entry.resourceClass));
  if (!required) return null;
  if (process.platform !== 'linux') return unavailableAuthority({ code: 'ENOSYS' });
  try {
    const directory = ensurePrivateDirectory(
      path.join(path.resolve(runtimeDirectory), 'ownership', 'host-helper'),
      path.resolve(checkoutRoot),
    );
    return buildHelper(directory);
  } catch (error) {
    return unavailableAuthority(error);
  }
}

export function verifyCleanupHostAuthority(authority) {
  if (!authority?.available || typeof authority.helperPath !== 'string') return authority;
  const current = verifiedAuthority(authority.helperPath);
  if (current.digest !== authority.digest) throw new Error('host helper authority changed');
  return current;
}
