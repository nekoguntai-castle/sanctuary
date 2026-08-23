import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  wake: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../../../src/services/sync/syncIntentAdmission', () => ({
  syncIntentAdmission: { wake: mocks.wake },
}));
vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({ warn: mocks.warn }),
}));

import {
  INITIAL_SYNC_GENERATION,
  wakeInitialWalletSync,
} from '../../../../src/services/sync/initialSyncIntent';

describe('initial wallet sync intent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('wakes the atomically persisted initial generation', async () => {
    mocks.wake.mockResolvedValue(true);
    await expect(wakeInitialWalletSync('wallet-1')).resolves.toBeUndefined();
    expect(mocks.wake).toHaveBeenCalledWith('wallet-1', INITIAL_SYNC_GENERATION);
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it('retains recovery ownership when the wake is blocked or throws', async () => {
    mocks.wake.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('redis down'));
    await expect(wakeInitialWalletSync('wallet-1')).resolves.toBeUndefined();
    await expect(wakeInitialWalletSync('wallet-2')).resolves.toBeUndefined();
    expect(mocks.warn).toHaveBeenCalledTimes(2);
  });
});
