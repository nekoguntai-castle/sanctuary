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
  getIncidentTelegramEligibilityCoverage,
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

  it.each([
    [{ walletPresent: false, accessibleUsers: 0, eligibleUsers: 0 }, 'unknown'],
    [{ walletPresent: true, accessibleUsers: 0, eligibleUsers: 0 }, 'none'],
    [{ walletPresent: true, accessibleUsers: 3, eligibleUsers: 0 }, 'none'],
    [{ walletPresent: true, accessibleUsers: 3, eligibleUsers: 1 }, 'some'],
    [{ walletPresent: true, accessibleUsers: 3, eligibleUsers: 3 }, 'all'],
  ] as const)('reduces exact incident eligibility to %s without returning counts', async (row, expected) => {
    mockQueryRaw.mockResolvedValue([row]);

    await expect(getIncidentTelegramEligibilityCoverage('wallet-selector', 'sent'))
      .resolves.toBe(expected);

    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
    expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 2_000 });
  });

  it('uses only the selected direction and keeps selectors as bound SQL values', async () => {
    mockQueryRaw.mockResolvedValue([{
      walletPresent: true,
      accessibleUsers: 1,
      eligibleUsers: 1,
    }]);

    await getIncidentTelegramEligibilityCoverage('wallet-selector-poison', 'received');

    const query = mockQueryRaw.mock.calls[0]?.[0] as {
      strings: string[];
      values: unknown[];
    };
    const sqlText = query.strings.join('?');
    expect(sqlText).toContain('notifyReceived');
    expect(sqlText).not.toContain('notifySent');
    expect(sqlText).not.toContain('wallet-selector-poison');
    expect(query.values).toContain('wallet-selector-poison');
  });
});
