/**
 * Guards the global API stubs in tests/setup.ts.
 *
 * Layout mounts background probes (Treasury Intelligence status, the
 * sync-paused banner's availability poll). Left unmocked, each one fires a
 * real ApiClient request that retries with setTimeout backoff after the test
 * body returns, and the retry warnings race vitest's onUserConsoleLog flush at
 * worker teardown ("Closing rpc while onUserConsoleLog was pending"). That
 * flaked the frontend coverage gate with every test passing.
 */

import { describe, expect, it, vi } from 'vitest';

import * as intelligenceApi from '../src/api/intelligence';
import * as syncApi from '../src/api/sync';

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
