import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ownedResourceNames,
  startDatabase,
} from '../../scripts/perf/wallet-sync-high-fanout-replay.mjs';
import { waitForDatabaseReadiness } from '../../scripts/perf/wallet-sync-database-readiness.mjs';

test('database readiness requires a successful TCP SQL query before migration', async () => {
  const names = ownedResourceNames('rc11', 'database-ready');
  const probes = [];
  const waits = [];
  let now = 0;
  await waitForDatabaseReadiness(names, 'test-password', {
    timeoutMs: 30_000,
    intervalMs: 100,
    now: () => now,
    probe: (args, timeoutMs) => {
      probes.push({ args, timeoutMs });
      if (probes.length < 3) throw new Error('database system is starting up');
      return '1\n';
    },
    running: () => 'true',
    wait: async milliseconds => { waits.push(milliseconds); now += milliseconds; },
  });
  assert.equal(probes.length, 3);
  assert.deepEqual(waits, [100, 100]);
  assert.equal(probes[0].timeoutMs, 2_000);
  assert.deepEqual(probes[0].args, [
    'docker', 'exec', '--env', 'PGPASSWORD=test-password', names.postgres,
    'psql', '--host', '127.0.0.1', '--username', 'sanctuary',
    '--dbname', 'sanctuary_replay', '--set', 'ON_ERROR_STOP=1',
    '--tuples-only', '--no-align', '--command', 'SELECT 1',
  ]);
});

test('database readiness fails closed at the hard SQL probe deadline', async () => {
  let probes = 0;
  let now = 0;
  await assert.rejects(waitForDatabaseReadiness(
    ownedResourceNames('rc11', 'database-timeout'),
    'test-password',
    {
      timeoutMs: 200,
      intervalMs: 100,
      now: () => now,
      probe: () => { probes += 1; throw new Error('persistent startup failure'); },
      running: () => 'true',
      wait: async milliseconds => { now += milliseconds; },
    },
  ), /PostgreSQL readiness timeout/);
  assert.equal(probes, 2);
  assert.equal(now, 200);
});

test('database readiness performs no probe with an exhausted budget', async () => {
  let probes = 0;
  await assert.rejects(waitForDatabaseReadiness(
    ownedResourceNames('rc11', 'database-zero-budget'),
    'test-password',
    { timeoutMs: 0, probe: () => { probes += 1; } },
  ), /PostgreSQL readiness timeout/);
  assert.equal(probes, 0);
});

test('database readiness caps each probe at the remaining deadline', async () => {
  const probeTimeouts = [];
  let now = 0;
  await assert.rejects(waitForDatabaseReadiness(
    ownedResourceNames('rc11', 'database-partial-budget'),
    'test-password',
    {
      timeoutMs: 2_500,
      intervalMs: 100,
      now: () => now,
      probe: (_args, timeoutMs) => {
        probeTimeouts.push(timeoutMs);
        now += timeoutMs;
        throw new Error('persistent startup failure');
      },
      running: () => 'true',
      wait: async milliseconds => { now += milliseconds; },
    },
  ), /PostgreSQL readiness timeout/);
  assert.deepEqual(probeTimeouts, [2_000, 400]);
  assert.equal(now, 2_500);
});

test('database readiness rejects a probe result completed at the deadline', async () => {
  let now = 0;
  await assert.rejects(waitForDatabaseReadiness(
    ownedResourceNames('rc11', 'database-late-success'),
    'test-password',
    {
      timeoutMs: 100,
      now: () => now,
      probe: (_args, timeoutMs) => { now += timeoutMs; return '1\n'; },
    },
  ), /PostgreSQL readiness timeout/);
  assert.equal(now, 100);
});

test('database readiness fails immediately when the owned container exits', async () => {
  let waits = 0;
  await assert.rejects(waitForDatabaseReadiness(
    ownedResourceNames('rc11', 'database-exited'),
    'test-password',
    {
      probe: () => { throw new Error('connection refused'); },
      running: () => 'false',
      wait: async () => { waits += 1; },
    },
  ), /PostgreSQL container exited before readiness/);
  assert.equal(waits, 0);
});

test('database startup proves readiness before running migration exactly once', async () => {
  const names = ownedResourceNames('rc11', 'database-order');
  const events = [];
  await startDatabase(names, 'test-password', 'subject-image', 'max', {
    operation: args => { events.push(args); return ''; },
    waitUntilReady: async (actualNames, password) => {
      assert.equal(actualNames, names);
      assert.equal(password, 'test-password');
      events.push(['readiness-proven']);
    },
  });
  assert.equal(events[0][1], 'network');
  assert.equal(events[1][1], 'run');
  assert.deepEqual(events[2], ['readiness-proven']);
  assert.equal(events[3].filter(value => value === 'migrate').length, 1);
  assert.equal(events.length, 4);
});

test('database startup never attempts migration when readiness fails', async () => {
  const operations = [];
  await assert.rejects(startDatabase(
    ownedResourceNames('rc11', 'database-no-migrate'),
    'test-password',
    'subject-image',
    'live',
    {
      operation: args => { operations.push(args); return ''; },
      waitUntilReady: async () => { throw new Error('readiness failed'); },
    },
  ), /readiness failed/);
  assert.equal(operations.length, 2);
  assert.equal(operations.some(args => args.includes('migrate')), false);
});
