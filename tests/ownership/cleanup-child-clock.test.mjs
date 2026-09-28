import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { childClockArguments, installChildClock } from './fixtures/child-clock.mjs';

const EPOCH = Date.parse('2026-09-02T12:00:00.000Z');

test('child calendar advances monotonically and preserves Date semantics', () => {
  let elapsed = 10;
  const clock = { Date };
  installChildClock(EPOCH, clock, () => elapsed);
  assert.equal(clock.Date.now(), EPOCH);
  assert.equal(new clock.Date().getTime(), EPOCH);
  elapsed += 1_500;
  assert.equal(clock.Date.now(), EPOCH + 1_500);
  assert.equal(new clock.Date().getTime(), EPOCH + 1_500);
  assert.equal(clock.Date(), new Date(EPOCH + 1_500).toString());
  assert.equal(new clock.Date(0).getTime(), 0);
  assert.equal(new clock.Date('2000-01-01T00:00:00Z').getTime(), Date.parse('2000-01-01T00:00:00Z'));
  assert.equal(new clock.Date(2000, 0, 1).getTime(), new Date(2000, 0, 1).getTime());
  assert.equal(clock.Date.parse('2026-09-02T12:00:00.000Z'), EPOCH);
  assert.equal(clock.Date.UTC(2026, 8, 2, 12), EPOCH);
  assert.ok(new clock.Date() instanceof Date);
  assert.ok(new Date() instanceof clock.Date);
});

test('calendar preload anchors after a startup delay exceeding the old approval TTL', () => {
  const delay = 'data:text/javascript,' + encodeURIComponent(
    'await new Promise(resolve => setTimeout(resolve, 1100));',
  );
  const result = spawnSync(process.execPath, [
    '--import', delay, ...childClockArguments(EPOCH), '--input-type=module', '-e',
    `const start = Date.now();
     await new Promise(resolve => setTimeout(resolve, 30));
     process.stdout.write(JSON.stringify({ start, end: Date.now(), constructed: +new Date(), uptimeMs: process.uptime() * 1000 }));`,
  ], { encoding: 'utf8', timeout: 5_000 });
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout);
  assert.ok(observed.start >= EPOCH);
  assert.ok(observed.end > observed.start);
  assert.ok(observed.constructed >= observed.end);
  assert.ok(observed.constructed <= EPOCH + Math.ceil(observed.uptimeMs));
});

test('ordinary CLI invocations do not install a clock override', () => {
  assert.deepEqual(childClockArguments(), []);
});
