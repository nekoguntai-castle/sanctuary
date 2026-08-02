import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecuteRaw, mockQueryRaw, mockTransaction } = vi.hoisted(() => ({
  mockExecuteRaw: vi.fn(),
  mockQueryRaw: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock('../../../src/models/prisma', () => ({
  default: { $transaction: (...args: unknown[]) => mockTransaction(...args) },
}));

import {
  getNotificationEligibilityCounts,
} from '../../../src/repositories/supportNotificationDiagnosticsRepository';

describe('support notification diagnostics repository', () => {
  beforeEach(() => {
    mockExecuteRaw.mockReset();
    mockQueryRaw.mockReset();
    mockTransaction.mockReset();
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      $executeRaw: mockExecuteRaw,
      $queryRaw: mockQueryRaw,
    }));
  });

  it('returns the aggregate-only database result', async () => {
    const counts = {
      configuredTelegramUsers: 2,
      enabledTelegramUsers: 1,
      eligibleReceivedWallets: 2,
      eligibleSentWallets: 1,
      eligibleDraftWallets: 0,
      eligibleConsolidationWallets: 0,
      disabledReceivedWallets: 0,
      disabledSentWallets: 1,
      disabledDraftWallets: 2,
      disabledConsolidationWallets: 2,
      enabledUsersWithoutWalletSettings: 1,
      missingCredentialUsers: 1,
      orphanedWalletSettings: 0,
    };
    mockQueryRaw.mockResolvedValue([counts]);

    await expect(getNotificationEligibilityCounts()).resolves.toEqual(counts);
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 2_000 });
    expect(JSON.stringify(mockQueryRaw.mock.calls)).not.toContain('wallet-poison');
  });

  it('retains enabled users without wallet settings in user-level diagnostics', async () => {
    mockQueryRaw.mockResolvedValue([{
      configuredTelegramUsers: 0,
      enabledTelegramUsers: 1,
      eligibleReceivedWallets: 0,
      eligibleSentWallets: 0,
      eligibleDraftWallets: 0,
      eligibleConsolidationWallets: 0,
      disabledReceivedWallets: 0,
      disabledSentWallets: 0,
      disabledDraftWallets: 0,
      disabledConsolidationWallets: 0,
      enabledUsersWithoutWalletSettings: 1,
      missingCredentialUsers: 1,
      orphanedWalletSettings: 0,
    }]);

    await getNotificationEligibilityCounts();

    const query = JSON.stringify(mockQueryRaw.mock.calls[0]?.[0]);
    expect(query).toContain('telegram_users');
    expect(query).toContain('FROM telegram_users');
    expect(query).toContain('wallets =');
    expect(query).toContain('BOOL_OR');
    expect(query).toContain('existing_wallet_settings');
    expect(query).toContain('candidate_wallet_settings');
    expect(query).toContain('accessible_wallet_settings');
    expect(query).toContain('JOIN \\"wallet_users\\" direct_access');
    expect(query).toContain('JOIN \\"group_members\\" group_access');
    expect(query).toContain('UNION');
    expect(query).not.toContain('UNION ALL');
    expect(query).not.toContain('EXISTS (');
  });

  it('fails when the aggregate query returns no row', async () => {
    mockQueryRaw.mockResolvedValue([]);

    await expect(getNotificationEligibilityCounts())
      .rejects.toThrow('notification_eligibility_unavailable');
  });
});
