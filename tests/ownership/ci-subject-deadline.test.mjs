import assert from 'node:assert/strict';
import test from 'node:test';
import { captureSubjectDeadline, validateSubjectDeadlineEpochMs } from '../../scripts/ownership/ci-subject-deadline.mjs';

test('deadline validation accepts omission, past and exact upper bound', () => {
  assert.equal(validateSubjectDeadlineEpochMs(undefined, 100), undefined);
  assert.equal(validateSubjectDeadlineEpochMs(1, 100), 1);
  assert.equal(validateSubjectDeadlineEpochMs(86_400_100, 100), 86_400_100);
  for (const value of [null, '100', 0, -1, 1.5, NaN, Infinity, 86_400_101]) {
    assert.throws(() => validateSubjectDeadlineEpochMs(value, 100));
  }
});

test('captured budget consumes preparation time without consulting wall clock again', () => {
  let monotonic = 10;
  const remaining = captureSubjectDeadline(1_100, { wallNow: () => 100, monotonicNow: () => monotonic });
  assert.equal(remaining(), 1_000);
  monotonic = 510;
  assert.equal(remaining(), 500);
  monotonic = 1_110;
  assert.equal(remaining(), 0);
  assert.equal(captureSubjectDeadline(undefined)(), null);
  assert.equal(captureSubjectDeadline(1, { wallNow: () => 100 })(), 0);
});
