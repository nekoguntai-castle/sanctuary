import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRegistry, mockLogger } = vi.hoisted(() => ({
  mockRegistry: {
    notifyTransactions: vi.fn(),
    notifyDraft: vi.fn(),
    getAll: vi.fn(),
  },
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../../src/services/notifications/channels', () => ({
  notificationChannelRegistry: mockRegistry,
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: vi.fn(() => mockLogger),
}));

import {
  getAvailableChannels,
  notifyNewDraft,
  notifyNewTransactions,
} from '../../../../src/services/notifications/notificationService';

describe('notificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns early for empty transaction notifications', async () => {
    await notifyNewTransactions('wallet-1', []);

    expect(mockRegistry.notifyTransactions).not.toHaveBeenCalled();
  });

  it('dispatches transaction notifications and logs only failed channel errors', async () => {
    mockRegistry.notifyTransactions.mockResolvedValueOnce([
      { success: true, channelId: 'push', usersNotified: 2 },
      { success: false, channelId: 'telegram', usersNotified: 0, errors: ['boom'] },
      { success: false, channelId: 'webhook', usersNotified: 0 },
    ]);

    await notifyNewTransactions('wallet-1', [
      { txid: 'a'.repeat(64), type: 'received', amount: 5_000n },
    ]);

    expect(mockRegistry.notifyTransactions).toHaveBeenCalledWith('wallet-1', [
      { txid: 'a'.repeat(64), type: 'received', amount: 5_000n },
    ]);
    expect(mockLogger.error).toHaveBeenCalledWith('telegram notification failed: boom');
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
  });

  it('dispatches draft notifications and logs failed channel errors', async () => {
    mockRegistry.notifyDraft.mockResolvedValueOnce([
      { success: true, channelId: 'push', usersNotified: 1 },
      { success: false, channelId: 'telegram', usersNotified: 0, errors: ['draft failed'] },
    ]);

    await notifyNewDraft(
      'wallet-1',
      {
        id: 'draft-1',
        amount: 7_000n,
        recipient: 'tb1qexample',
        feeRate: 3,
      },
      'user-1'
    );

    expect(mockRegistry.notifyDraft).toHaveBeenCalledWith(
      'wallet-1',
      {
        id: 'draft-1',
        amount: 7_000n,
        recipient: 'tb1qexample',
        feeRate: 3,
      },
      'user-1',
      undefined
    );
    expect(mockLogger.error).toHaveBeenCalledWith('telegram draft notification failed: draft failed');
  });

  it('dedupes repeated draft notifications when a dedupe key is supplied', async () => {
    mockRegistry.notifyDraft.mockResolvedValue([]);

    const draft = {
      id: 'draft-1',
      amount: 7_000n,
      recipient: 'tb1qexample',
      feeRate: 3,
      dedupeKey: 'agent:agent-1:wallet-1:tb1qexample:7000',
    };

    await notifyNewDraft('wallet-1', draft, null, 'Agent');
    await notifyNewDraft('wallet-1', { ...draft, id: 'draft-2' }, null, 'Agent');

    expect(mockRegistry.notifyDraft).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).toHaveBeenCalledWith('Skipping duplicate draft notification', expect.objectContaining({
      walletId: 'wallet-1',
      draftId: 'draft-2',
    }));
  });

  it('caps draft notification dedupe memory and evicts the oldest key', async () => {
    mockRegistry.notifyDraft.mockResolvedValue([]);

    for (let index = 0; index <= 1000; index++) {
      await notifyNewDraft(
        'wallet-1',
        {
          id: `draft-${index}`,
          amount: BigInt(index + 1),
          recipient: `tb1qrecipient${index}`,
          feeRate: 3,
          dedupeKey: `cap-test-${index}`,
        },
        null,
        'Agent'
      );
    }

    const callsAfterCapFill = mockRegistry.notifyDraft.mock.calls.length;
    await notifyNewDraft(
      'wallet-1',
      {
        id: 'draft-oldest-retry',
        amount: 1n,
        recipient: 'tb1qrecipient0',
        feeRate: 3,
        dedupeKey: 'cap-test-0',
      },
      null,
      'Agent'
    );

    expect(mockRegistry.notifyDraft).toHaveBeenCalledTimes(callsAfterCapFill + 1);
  });

  it('allows draft notifications again after the dedupe TTL expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    mockRegistry.notifyDraft.mockResolvedValue([]);

    const draft = {
      id: 'draft-expiring',
      amount: 7_000n,
      recipient: 'tb1qexample',
      feeRate: 3,
      dedupeKey: 'expiring-key',
    };

    try {
      await notifyNewDraft('wallet-1', draft, null, 'Agent');
      vi.setSystemTime(new Date('2026-01-01T00:11:00.000Z'));
      await notifyNewDraft('wallet-1', { ...draft, id: 'draft-after-expiry' }, null, 'Agent');
    } finally {
      vi.useRealTimers();
    }

    expect(mockRegistry.notifyDraft).toHaveBeenCalledTimes(2);
  });

  it('returns available channel metadata from the registry', () => {
    mockRegistry.getAll.mockReturnValueOnce([
      {
        id: 'push',
        name: 'Push',
        description: 'Push notifications',
        capabilities: {
          supportsTransactions: true,
          supportsDrafts: true,
          supportsConsolidationSuggestions: false,
          supportsAIInsights: false,
          supportsRichFormatting: false,
          supportsImages: false,
        },
      },
    ]);

    expect(getAvailableChannels()).toEqual([
      {
        id: 'push',
        name: 'Push',
        description: 'Push notifications',
        capabilities: {
          supportsTransactions: true,
          supportsDrafts: true,
          supportsConsolidationSuggestions: false,
          supportsAIInsights: false,
          supportsRichFormatting: false,
          supportsImages: false,
        },
      },
    ]);
  });
});
