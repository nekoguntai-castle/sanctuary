import { expect, it, vi } from 'vitest';

import { mockPrismaClient } from '../../../../../mocks/prisma';
import { mockGetNodeClient, mockWalletLog } from './confirmationsTestHarness';
import { populateMissingTransactionFields } from '../../../../../../src/services/bitcoin/sync/confirmations';

export function registerPopulateMissingTransactionFieldsCoreContracts() {
  it('returns empty result when wallet does not exist', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

    const result = await populateMissingTransactionFields('wallet-1');

    expect(result).toEqual({ updated: 0, confirmationUpdates: [] });
    expect(mockGetNodeClient).not.toHaveBeenCalled();
  });

  it('threads attempt telemetry and phase coordination into bounded repair work', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue(null);
    const controller = new AbortController();
    const telemetry = {
      beginStage: vi.fn(() => true),
      finishStage: vi.fn(() => true),
      observeProgress: vi.fn(),
      recordCandidates: vi.fn(),
    };
    const phaseProgress = {
      begin: vi.fn(() => true),
      finish: vi.fn(() => true),
      budgetExpired: vi.fn(() => true),
      activeStage: vi.fn(() => 'missing_field_repair' as const),
    };

    await expect(populateMissingTransactionFields(
      'wallet-1',
      controller.signal,
      undefined,
      undefined,
      false,
      123_456,
      telemetry,
      phaseProgress,
    )).resolves.toEqual({ updated: 0, confirmationUpdates: [] });
  });

  it('returns early when no incomplete transactions are found', async () => {
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'mainnet' });
    mockGetNodeClient.mockResolvedValue({
      getAddressHistory: vi.fn(),
      getTransaction: vi.fn(),
    });
    mockPrismaClient.transaction.findMany.mockResolvedValue([]);
    mockPrismaClient.address.findMany.mockResolvedValue([]);

    const result = await populateMissingTransactionFields('wallet-1');

    expect(result).toEqual({ updated: 0, confirmationUpdates: [] });
    expect(mockWalletLog).toHaveBeenCalledWith(
      'wallet-1',
      'info',
      'POPULATE',
      'All transaction fields are complete'
    );
  });
}
