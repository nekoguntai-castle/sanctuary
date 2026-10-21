#!/usr/bin/env node
/**
 * Rejects inert negative assertions in shell test suites.
 *
 * Under `set -e`, a statement negated with a leading `!` never stops the
 * script: bash ignores errexit for `!` pipelines, so `! grep -q forbidden log`
 * followed by any other statement passes whatever grep finds. The only safe
 * forms are `if cmd; then echo 'FAIL: ...' >&2; return 1; fi` (or `exit 1`)
 * and `! cmd || fail ...`.
 *
 * The rule is line-based (D-12.C5): after joining backslash continuations,
 * every logical line of a tracked `*.test.sh` that starts with `!` and holds no
 * `||` is a violation, including a function-final or loop-final `!`, which is
 * inert as soon as another statement is appended below it. `if ! cmd`,
 * `[ ! ... ]` and `[[ ! ... ]]` do not start with `!` and are accepted.
 * Known residual: a mid-line negation (`a && ! b`) is not detected.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isMainModule } from '../lib/is-main-module.mjs';

const NEGATED_STATEMENT = /^\s*!\s/;

/** 1-based start lines of the inert leading-`!` statements in a shell script. */
export function findNegatedAssertionViolations(text) {
  const lines = text.split('\n');
  const violations = [];
  for (let index = 0; index < lines.length; index += 1) {
    const start = index;
    let logical = lines[index];
    while (logical.endsWith('\\') && index + 1 < lines.length) {
      index += 1;
      logical = `${logical.slice(0, -1)} ${lines[index]}`;
    }
    if (NEGATED_STATEMENT.test(logical) && !logical.includes('||')) {
      violations.push(start + 1);
    }
  }
  return violations;
}

/** `file:line` for every violation in the tracked `*.test.sh` files under root. */
export function listRepositoryViolations(root) {
  const files = execFileSync('git', ['-C', root, 'ls-files', '*.test.sh'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  return files.flatMap(file => findNegatedAssertionViolations(readFileSync(join(root, file), 'utf8'))
    .map(line => `${file}:${line}`));
}

if (isMainModule(import.meta.url)) {
  const violations = listRepositoryViolations(process.cwd());
  if (violations.length > 0) {
    process.stderr.write(
      'Inert negated assertions (a leading `!` statement never fails under errexit; '
      + 'use `if cmd; then ...; return 1; fi` or `! cmd || fail ...`):\n',
    );
    for (const violation of violations) process.stderr.write(`${violation}\n`);
    process.exit(1);
  }
  process.stdout.write('check-negated-test-assertions: no inert negated assertions in *.test.sh\n');
}
