/**
 * Guards the global API stubs in tests/setup.ts.
 *
 * Layout mounts background probes (Treasury Intelligence status, the
 * sync-paused banner's availability poll). Left unmocked, each one fires a
 * real ApiClient request that retries with setTimeout backoff after the test
 * body returns, and the retry warnings race vitest's onUserConsoleLog flush at
 * worker teardown ("Closing rpc while onUserConsoleLog was pending"). That
 * flaked the frontend coverage gate with every test passing.
 *
 * The retry guard (tests/support/unmockedApiRetryGuard.ts) turns any further
 * unmocked request into a failure of the test that issued it. The last one was
 * /price/providers/status from tests/components/NodeConfig/loadOwnership.test.tsx.
 */

import { describe, expect, it, vi } from 'vitest';

import * as intelligenceApi from '../src/api/intelligence';
import * as syncApi from '../src/api/sync';
import { createLogger } from '../src/utils/logger';
import { assertNoUnmockedApiRetries } from './support/unmockedApiRetryGuard';

describe('global API stubs', () => {
  it('stubs the intelligence status probe', async () => {
    expect(vi.isMockFunction(intelligenceApi.getIntelligenceStatus)).toBe(true);
    await expect(intelligenceApi.getIntelligenceStatus()).resolves.toMatchObject({ available: false });
  });

  it('stubs the sync availability poll as available', async () => {
    expect(vi.isMockFunction(syncApi.getSyncAvailability)).toBe(true);
    await expect(syncApi.getSyncAvailability()).resolves.toEqual({ state: 'available' });
  });

  it('keeps the other sync API functions real', () => {
    expect(vi.isMockFunction(syncApi.syncWallet)).toBe(false);
  });
});

describe('unmocked API retry guard', () => {
  it('fails on an ApiClient retry warning and names the endpoint', () => {
    // Same logger and message shape as withRetry in src/api/client.ts.
    createLogger('ApiClient').warn('Request failed (attempt 1/4), retrying in 1000ms', {
      context: '/guard-self-test/first',
      status: 0,
    });
    expect(() => assertNoUnmockedApiRetries()).toThrow(
      'Unmocked API request reached the ApiClient retry loop: /guard-self-test/first.',
    );
    // The failed check drained the record, so this test's own teardown passes.
    expect(() => assertNoUnmockedApiRetries()).not.toThrow();
  });

  it('survives a test resetting and restoring every mock', () => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
    console.warn('[ApiClient] Request failed (attempt 1/4), retrying in 1000ms', {
      context: '/guard-self-test/after-reset',
    });
    expect(() => assertNoUnmockedApiRetries()).toThrow('/guard-self-test/after-reset');
  });

  it('does not charge a later timer-driven attempt to the current test', () => {
    console.warn('[ApiClient] Request failed (attempt 2/4), retrying in 2000ms', {
      context: '/guard-self-test/earlier-test',
    });
    expect(() => assertNoUnmockedApiRetries()).not.toThrow();
  });

  it('ignores unrelated warnings', () => {
    console.warn('[ApiClient] Request failed after all retries', { context: '/wallets' });
    console.warn('something else');
    expect(() => assertNoUnmockedApiRetries()).not.toThrow();
  });
});
