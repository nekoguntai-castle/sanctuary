import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRegistry, mockLogger } = vi.hoisted(() => ({
  mockRegistry: {
    notifyTransactions: vi.fn(),
    notifyDraft: vi.fn(),
    getAll: vi.fn(),
  },
  mockLogger: {
    debug: vi.fn(),
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
      'user-1'
    );
    expect(mockLogger.error).toHaveBeenCalledWith('telegram draft notification failed: draft failed');
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
