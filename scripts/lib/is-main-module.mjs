#!/usr/bin/env node

/**
 * Detects "am I the module Node was invoked to run directly?" by resolved
 * filesystem path rather than by comparing `import.meta.url` against a raw
 * `process.argv[1]`.
 *
 * Node resolves symlinks (and percent-encodes special characters such as
 * spaces) when it computes the entry module's `import.meta.url`, but
 * `process.argv[1]` is the literal string the shell passed on the command
 * line and is neither symlink-resolved nor percent-encoded. Every guard of
 * the form ``import.meta.url === `file://${process.argv[1]}` `` or
 * `pathToFileURL(resolve(process.argv[1])).href === import.meta.url` is
 * therefore false whenever the CLI is invoked through a symlinked directory
 * (or a path containing characters the two sides encode differently), and
 * the guarded body silently never runs: empty stdout, exit 0, no error.
 *
 * This helper compares realpath-resolved filesystem paths on both sides so
 * a symlinked invocation still matches.
 */

import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function realOrResolved(candidatePath) {
  try {
    return existsSync(candidatePath) ? realpathSync(candidatePath) : resolve(candidatePath);
  } catch {
    return resolve(candidatePath);
  }
}

/**
 * @param {string} moduleUrl - the caller's own `import.meta.url`.
 * @param {string | undefined} [argv1] - defaults to `process.argv[1]`.
 * @returns {boolean} true when `moduleUrl` is the module Node was invoked to run.
 */
export function isMainModule(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;

  let modulePath;
  try {
    modulePath = fileURLToPath(moduleUrl);
  } catch {
    return false;
  }

  return realOrResolved(argv1) === realOrResolved(modulePath);
}
