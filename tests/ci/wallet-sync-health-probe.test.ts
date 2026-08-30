import assert from 'node:assert/strict';
import { test } from 'vitest';
import { collectHealthProbe } from '../../scripts/perf/wallet-sync-health-probe.mjs';

const emptyBody = () => new ArrayBuffer(0);

test('retries the same endpoint after a transport failure and retains evidence', async () => {
  const responses = [new TypeError('connection reset'), 200];
  let waits = 0;
  const result = await collectHealthProbe(3002, '/metrics/prometheus', {
    request: async () => {
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return { status: response, arrayBuffer: emptyBody };
    },
    running: () => 'true',
    wait: async (milliseconds: number) => { assert.equal(milliseconds, 100); waits += 1; },
    now: (() => { const values = [10, 25]; return () => values.shift(); })(),
  });

  assert.deepEqual(result, {
    path: '/metrics/prometheus',
    ok: true,
    elapsedMs: 15,
    attempts: [
      { outcome: 'transport_error', error: 'TypeError' },
      { outcome: 'ok', status: 200 },
    ],
  });
  assert.equal(waits, 1);
});

test('fails immediately on an HTTP error or timeout', async () => {
  let httpRequests = 0;
  const httpResult = await collectHealthProbe(3002, '/metrics/prometheus', {
    request: async () => { httpRequests += 1; return { status: 500, arrayBuffer: emptyBody }; },
    running: () => 'true',
    wait: async () => assert.fail('HTTP failures must not retry'),
  });
  assert.equal(httpResult.ok, false);
  assert.deepEqual(httpResult.attempts, [{ outcome: 'http_error', status: 500 }]);
  assert.equal(httpRequests, 1);

  let timeoutRequests = 0;
  const timeout = new Error('timed out');
  timeout.name = 'TimeoutError';
  const timeoutResult = await collectHealthProbe(3002, '/ready', {
    request: async () => { timeoutRequests += 1; throw timeout; },
    running: () => 'true',
    wait: async () => assert.fail('timeouts must not retry'),
  });
  assert.equal(timeoutResult.ok, false);
  assert.deepEqual(timeoutResult.attempts, [{ outcome: 'timeout', error: 'TimeoutError' }]);
  assert.equal(timeoutRequests, 1);
});

test('fails closed after three consecutive transport errors', async () => {
  let requests = 0;
  let waits = 0;
  const result = await collectHealthProbe(3002, '/ready', {
    request: async () => { requests += 1; throw new TypeError('connection reset'); },
    running: () => 'true',
    wait: async () => { waits += 1; },
    now: (() => { const values = [5, 225]; return () => values.shift(); })(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.elapsedMs, 220);
  assert.deepEqual(result.attempts, Array.from(
    { length: 3 }, () => ({ outcome: 'transport_error', error: 'TypeError' }),
  ));
  assert.equal(requests, 3);
  assert.equal(waits, 2);
});

test('records sanitized transport failures without exposing details', async () => {
  const result = await collectHealthProbe(3002, '/live', {
    request: async () => { throw new TypeError('secret-shaped transport detail'); },
    running: () => 'true',
    wait: async () => {},
    now: (() => { const values = [1, 4]; return () => values.shift(); })(),
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.attempts, Array.from(
    { length: 3 }, () => ({ outcome: 'transport_error', error: 'TypeError' }),
  ));
  assert.doesNotMatch(JSON.stringify(result), /secret-shaped/);

  const unexpected = await collectHealthProbe(3002, '/live', {
    request: async () => { throw new Error('secret-shaped internal detail'); },
    wait: async () => assert.fail('unexpected errors must not retry'),
  });
  assert.deepEqual(unexpected.attempts, [{ outcome: 'transport_error', error: 'Error' }]);
  assert.doesNotMatch(JSON.stringify(unexpected), /secret-shaped/);
});

test('retries body-stream errors and fails closed on stopped or unknown state', async () => {
  let bodyReads = 0;
  const recovered = await collectHealthProbe(3002, '/metrics/prometheus', {
    request: async () => ({
      status: 200,
      arrayBuffer: async () => {
        bodyReads += 1;
        if (bodyReads === 1) throw new TypeError('stream reset');
        return emptyBody();
      },
    }),
    running: () => 'true',
    wait: async () => {},
  });
  assert.equal(recovered.ok, true);
  assert.deepEqual(recovered.attempts, [
    { outcome: 'transport_error', error: 'TypeError' },
    { outcome: 'ok', status: 200 },
  ]);

  const stopped = await collectHealthProbe(3002, '/live', {
    request: async () => { throw new TypeError('connection reset'); },
    running: () => 'false',
    wait: async () => assert.fail('stopped subject must not retry'),
  });
  assert.equal('subjectStopped' in stopped && stopped.subjectStopped, true);
  assert.equal(stopped.ok, false);

  await assert.rejects(collectHealthProbe(3002, '/live', {
    request: async () => { throw new TypeError('connection reset'); },
    running: () => '',
    wait: async () => assert.fail('unknown state must not retry'),
  }), /running state/);
});
