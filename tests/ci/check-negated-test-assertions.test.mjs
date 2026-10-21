import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import {
  findNegatedAssertionViolations,
  listRepositoryViolations,
} from '../../scripts/ci/check-negated-test-assertions.mjs';

const REPO_ROOT = join(import.meta.dirname, '../..');

// Under errexit a leading-`!` statement never fails the script, so a negative
// assertion written that way is inert unless something consumes its status.
test('flags leading-! statements whose status nothing consumes', () => {
  assert.deepEqual(findNegatedAssertionViolations('! grep -q x f\necho next\n'), [1]);
  assert.deepEqual(findNegatedAssertionViolations('for f in a b; do\n! grep -q x "$f"\ndone\n'), [2]);
  assert.deepEqual(findNegatedAssertionViolations('! a | b\necho next\n'), [1]);
  assert.deepEqual(findNegatedAssertionViolations("bash <<'SCRIPT'\n! cmd\necho next\nSCRIPT\n"), [2]);
});

test('flags indented leading-! statements at their line numbers', () => {
  assert.deepEqual(findNegatedAssertionViolations('f() {\n  ! grep -q x f\n  echo next\n}\n'), [2]);
  assert.deepEqual(findNegatedAssertionViolations('f() {\n\t! cmd\n\techo next\n}\n'), [2]);
  assert.deepEqual(findNegatedAssertionViolations('if true; then\n  ! cmd\n  echo next\nfi\n'), [2]);
  assert.deepEqual(findNegatedAssertionViolations('f() {\n  for f in a b; do\n    ! grep -q x "$f"\n  done\n}\n'), [3]);
});

test('accepts negations whose status decides something', () => {
  for (const text of [
    '! cmd || fail x\n',
    '! cmd \\\n  || fail x\n',
    'if ! cmd; then\n  fail x\nfi\n',
    '[ ! -f x ] || fail x\n',
    '[[ ! -f x ]] || fail x\n',
    'test -f x && [ ! -f y ]\n',
    '[[ ! -f x ]]\n',
  ]) {
    assert.deepEqual(findNegatedAssertionViolations(text), [], text);
  }
});

test('no tracked shell test has an inert leading-! assertion', () => {
  assert.deepEqual(listRepositoryViolations(REPO_ROOT), []);
});
