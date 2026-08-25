import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  createReconciler: vi.fn(),
  finalize: vi.fn(),
  findDue: vi.fn(),
  findConfirmationRetries: vi.fn(),
  findHistory: vi.fn(),
  observe: vi.fn(),
  reconcileAttempt: vi.fn(),
  reconcileObserve: vi.fn(),
  recordConfirmationPage: vi.fn(),
  recordConfirmationRetryResult: vi.fn(),
  recordCursor: vi.fn(),
  recordFailure: vi.fn(),
  refreshConfirmations: vi.fn(),
  refreshConfirmationRetries: vi.fn(),
  resetCursor: vi.fn(),
  setAuthoritativeHeight: vi.fn(),
}));

vi.mock('../../../src/repositories/networkHeaderReconciliationRepository', () => ({
  claimNetworkHeaderReconciliation: mocks.claim,
  finalizeNetworkHeaderReconciliation: mocks.finalize,
  findDueNetworkHeaderReconciliations: mocks.findDue,
  findNetworkHeaderConfirmationRetries: mocks.findConfirmationRetries,
  findNetworkHeaderHistory: mocks.findHistory,
  observeNetworkHeader: mocks.observe,
  recordNetworkHeaderConfirmationPage: mocks.recordConfirmationPage,
  recordNetworkHeaderConfirmationRetryResult: mocks.recordConfirmationRetryResult,
  recordNetworkHeaderCursor: mocks.recordCursor,
  recordNetworkHeaderReconciliationFailure: mocks.recordFailure,
  resetNetworkHeaderCursor: mocks.resetCursor,
}));

vi.mock('../../../src/services/bitcoin/blockchain', () => ({
  setAuthoritativeBlockHeight: mocks.setAuthoritativeHeight,
}));

vi.mock('../../../src/services/sync/headerConfirmationUpdater', () => ({
  refreshConfirmationRetryWalletsAtHeight: mocks.refreshConfirmationRetries,
  refreshPendingConfirmationsAtHeight: mocks.refreshConfirmations,
}));

vi.mock('../../../src/services/sync/networkHeaderReconciler', () => ({
  createNetworkHeaderReconciler: mocks.createReconciler,
}));

import { createProductionNetworkHeaderReconciliationRuntime } from '../../../src/worker/networkHeaderReconciliationRuntime';

describe('production network-header reconciliation runtime composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createReconciler.mockReturnValue({
      attempt: mocks.reconcileAttempt,
      observe: mocks.reconcileObserve,
    });
    mocks.reconcileObserve.mockResolvedValue({
      status: 'complete',
      height: 0,
      hash: '0'.repeat(64),
    });
    mocks.findDue.mockResolvedValue([]);
    mocks.finalize.mockResolvedValue({ checkpoint: {}, continuation: null });
    mocks.refreshConfirmations.mockResolvedValue({
      walletIds: [],
      failures: [],
      nextCursor: null,
      enumerationComplete: true,
    });
    mocks.refreshConfirmationRetries.mockResolvedValue({ failures: [] });
  });

  it('binds every production adapter and routes observations through the runtime', async () => {
    const activityEpoch = vi.fn(() => 7);
    const isActive = vi.fn(() => true);
    const runtime = createProductionNetworkHeaderReconciliationRuntime(activityEpoch);
    const dependencies = mocks.createReconciler.mock.calls[0][0];
    const fence = {
      network: 'mainnet' as const,
      generation: 1,
      ownerToken: 'production-owner-token',
    };

    await dependencies.repository.finalize(fence);
    await dependencies.refreshConfirmations('mainnet', 100, null, isActive);
    await dependencies.refreshConfirmationRetryWallets('mainnet', 100, ['wallet-a'], isActive);
    dependencies.setAuthoritativeHeight(100, 'mainnet');
    const fetchHeaders = vi.fn();
    await runtime.observe('mainnet', { height: 0, hex: '00'.repeat(80) }, fetchHeaders);
    await runtime.recoverDue();

    expect(dependencies.repository).toEqual({
      observe: mocks.observe,
      recordNetworkHeaderConfirmationPage: mocks.recordConfirmationPage,
      findNetworkHeaderConfirmationRetries: mocks.findConfirmationRetries,
      recordNetworkHeaderConfirmationRetryResult: mocks.recordConfirmationRetryResult,
      recordCursor: mocks.recordCursor,
      resetCursor: mocks.resetCursor,
      recordFailure: mocks.recordFailure,
      findHistory: mocks.findHistory,
      finalize: expect.any(Function),
    });
    expect(mocks.finalize).toHaveBeenCalledWith(fence);
    expect(mocks.refreshConfirmations).toHaveBeenCalledWith('mainnet', 100, isActive, null);
    expect(mocks.refreshConfirmationRetries).toHaveBeenCalledWith(['wallet-a'], 100, isActive);
    expect(mocks.setAuthoritativeHeight).toHaveBeenCalledWith(100, 'mainnet');
    expect(mocks.reconcileObserve).toHaveBeenCalledWith(
      'mainnet',
      expect.any(String),
      { height: 0, hex: '00'.repeat(80) },
      fetchHeaders,
      expect.any(Function),
    );
    expect(mocks.findDue).toHaveBeenCalledWith(20);
    await runtime.stop();
  });
});
