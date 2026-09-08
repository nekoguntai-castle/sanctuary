import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';
import {
  forwardLiveAnnotations, lifecycleAnnotation, lifecycleCandidate, liveAnnotation,
} from '../../scripts/ci/forward-live-annotations.mjs';
import { subjectTerminalStatus } from '../../scripts/ownership/ci-cleanup-coordinator.mjs';

const CHECKOUT = path.resolve('.');
const CLI = path.join(CHECKOUT, 'scripts/ci/forward-live-annotations.mjs');
const EVENT = Object.freeze({
  schema_version: 1,
  event: 'cleanup_terminal',
  status: 'succeeded',
  subject_exit: 0,
  cleanup_state: 'cleaned',
});

test('lifecycle candidate is parsed and canonically re-emitted', () => {
  const unordered = 'SANCTUARY_CI_LIFECYCLE_V1 '
    + '{"status":"succeeded","subject_exit":0,"schema_version":1,'
    + '"event":"cleanup_terminal","cleanup_state":"cleaned"}';
  assert.equal(
    lifecycleAnnotation(unordered),
    '::notice title=CI lifecycle::'
      + '{"cleanup_state":"cleaned","event":"cleanup_terminal","schema_version":1,'
      + '"status":"succeeded","subject_exit":0}',
  );
  assert.equal(lifecycleAnnotation(lifecycleCandidate(EVENT)), lifecycleAnnotation(unordered));
});

test('fixed v1 schema accepts only valid event-state combinations and bounded exits', () => {
  const valid = [
    ['cleanup_prepared', 'succeeded', null, null],
    ['subject_started', 'running', null, null],
    ['subject_terminal', 'timed_out', 124, null],
    ['subject_terminal', 'interrupted', 143, null],
    ['cleanup_started', 'running', 17, null],
    ['cleanup_terminal', 'refused', 17, 'ambiguous'],
    ['cleanup_terminal', 'refused', 17, 'refused'],
    ['cleanup_terminal', 'interrupted', 143, 'cancelled'],
    ['cleanup_terminal', 'failed', 0, 'coordinator_failed'],
    ['cleanup_terminal', 'failed', 0, 'partial'],
  ];
  for (const [event, status, subjectExit, cleanupState] of valid) {
    assert.notEqual(lifecycleAnnotation(lifecycleCandidate({
      schema_version: 1, event, status,
      subject_exit: subjectExit, cleanup_state: cleanupState,
    })), null, `${event}/${status}`);
  }
  for (const subjectExit of [-1, 256, Number.MAX_SAFE_INTEGER, '0']) {
    assert.equal(lifecycleAnnotation(lifecycleCandidate({ ...EVENT, subject_exit: subjectExit })), null);
  }
  assert.equal(lifecycleAnnotation(lifecycleCandidate({ ...EVENT, status: 'running' })), null);
});

test('subject terminal status stays valid when cancellation races after subject exit', () => {
  assert.equal(subjectTerminalStatus(0), 'succeeded');
  assert.equal(subjectTerminalStatus(124), 'timed_out');
  assert.equal(subjectTerminalStatus(143), 'interrupted');
  assert.equal(subjectTerminalStatus(17), 'failed');
});

test('unsafe, malformed, incomplete, duplicate, and expanded candidates are not forwarded', () => {
  const payload = lifecycleCandidate(EVENT).slice('SANCTUARY_CI_LIFECYCLE_V1 '.length);
  const rejected = [
    `SANCTUARY_CI_LIFECYCLE_V1 ${payload.slice(0, -1)},"locator":"10.14.23.20"}`,
    `SANCTUARY_CI_LIFECYCLE_V1 ${payload.slice(0, -1)},"digest":"${'a'.repeat(64)}"}`,
    lifecycleCandidate({ ...EVENT, status: '<redacted>' }),
    lifecycleCandidate({ ...EVENT, event: 'cleanup%0Aterminal' }),
    lifecycleCandidate({ ...EVENT, event: '\u001b[31mcleanup_terminal' }),
    'SANCTUARY_CI_LIFECYCLE_V1 {"schema_version":1}',
    'SANCTUARY_CI_LIFECYCLE_V1 {"schema_version":1,"schema_version":1}',
    'SANCTUARY_CI_LIFECYCLE_V1 not-json',
    `SANCTUARY_CI_LIFECYCLE_V1 ${'x'.repeat(600)}`,
  ];
  for (const candidate of rejected) assert.equal(lifecycleAnnotation(candidate), null, candidate);
});

test('stream keeps all diagnostic lines but forwards only canonical allowlisted annotations', () => {
  const unsafe = lifecycleCandidate({ ...EVENT, status: '<redacted>' });
  const timing = '::notice title=CI timing::phase completed in 0m 2s (2s)';
  const input = `ordinary\n${lifecycleCandidate(EVENT)}\n${unsafe}\n${timing}\n`;
  const result = spawnSync(process.execPath, [CLI], { cwd: CHECKOUT, input, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, input);
  assert.match(result.stderr, /::notice title=CI lifecycle::/);
  assert.match(result.stderr, /::notice title=CI timing::phase/);
  assert.doesNotMatch(result.stderr, /ordinary|<redacted>/);
  assert.equal(result.stderr.trim().split('\n').length, 2);
});

test('unrelated workflow commands are never promoted to the live stream', () => {
  for (const line of [
    '::set-output name=unsafe::value',
    '::notice title=CI lifecycle::{"schema_version":1}',
    '::warning title=unrelated::message',
  ]) assert.equal(liveAnnotation(line), null);
});

test('diagnostic forwarding honors output backpressure without dropping lines', async () => {
  const expected = Array.from({ length: 200 }, (_, index) => `line-${index}\n`).join('');
  let actual = '';
  const output = new Writable({
    highWaterMark: 8,
    write(chunk, _encoding, callback) {
      setImmediate(() => { actual += chunk.toString(); callback(); });
    },
  });
  const live = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  await forwardLiveAnnotations(Readable.from([expected]), output, live);
  assert.equal(actual, expected);
});

test('stalled live output stays bounded without stalling diagnostic forwarding', async () => {
  const annotation = `${lifecycleCandidate(EVENT)}\n`;
  const expected = annotation.repeat(200);
  let actual = '';
  const output = new Writable({ write(chunk, _encoding, callback) {
    actual += chunk.toString(); callback();
  } });
  const live = new Writable({
    highWaterMark: 1,
    write(_chunk, _encoding, _callback) {},
  });
  await forwardLiveAnnotations(Readable.from([expected]), output, live);
  assert.equal(actual, expected);
  assert.ok(live.writableLength <= Buffer.byteLength(liveAnnotation(annotation.trim())) + 1);
  live.destroy();
});
