import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationChannelRegistry } from '../../../../../src/services/notifications/channels/registry';
import type {
  DraftNotification,
  NotificationChannelHandler,
  NotificationResult,
  TransactionNotification,
} from '../../../../../src/services/notifications/channels/types';

function createHandler(overrides: Partial<NotificationChannelHandler> = {}): NotificationChannelHandler {
  return {
    id: 'default',
    name: 'Default Channel',
    description: 'Default channel for tests',
    capabilities: {
      supportsTransactions: true,
      supportsDrafts: true,
      supportsConsolidationSuggestions: false,
      supportsAIInsights: false,
      supportsRichFormatting: false,
      supportsImages: false,
    },
    isEnabled: vi.fn().mockResolvedValue(true),
    notifyTransactions: vi.fn().mockResolvedValue({
      success: true,
      channelId: 'default',
      usersNotified: 1,
    } satisfies NotificationResult),
    notifyDraft: vi.fn().mockResolvedValue({
      success: true,
      channelId: 'default',
      usersNotified: 1,
    } satisfies NotificationResult),
    ...overrides,
  };
}

describe('NotificationChannelRegistry', () => {
  let registry: NotificationChannelRegistry;

  const txNotifications: TransactionNotification[] = [{
    txid: 'a'.repeat(64),
    type: 'received',
    amount: BigInt(50_000),
  }];

  const draftNotification: DraftNotification = {
    id: 'draft-1',
    amount: BigInt(25_000),
    recipient: 'tb1qexampleaddress',
    feeRate: 2,
  };

  beforeEach(() => {
    registry = new NotificationChannelRegistry();
    vi.restoreAllMocks();
  });

  it('registers handlers and supports lookup and unregister lifecycle', () => {
    const handler = createHandler({ id: 'telegram', name: 'Telegram' });

    registry.register(handler);

    expect(registry.count).toBe(1);
    expect(registry.has('telegram')).toBe(true);
    expect(registry.get('telegram')).toBe(handler);
    expect(registry.getIds()).toEqual(['telegram']);
    expect(registry.getAll()).toEqual([handler]);

    expect(registry.unregister('telegram')).toBe(true);
    expect(registry.unregister('telegram')).toBe(false);
    expect(registry.count).toBe(0);
  });

  it('throws for duplicate channel registration', () => {
    const handler = createHandler({ id: 'push' });

    registry.register(handler);

    expect(() => registry.register(handler)).toThrow("Notification channel 'push' is already registered");
  });

  it('filters transaction- and draft-capable handlers correctly', () => {
    const txOnly = createHandler({
      id: 'tx-only',
      capabilities: {
        supportsTransactions: true,
        supportsDrafts: false,
        supportsConsolidationSuggestions: false,
        supportsAIInsights: false,
        supportsRichFormatting: false,
        supportsImages: false,
      },
      notifyDraft: undefined,
    });

    const draftOnly = createHandler({
      id: 'draft-only',
      capabilities: {
        supportsTransactions: false,
        supportsDrafts: true,
        supportsConsolidationSuggestions: false,
        supportsAIInsights: false,
        supportsRichFormatting: false,
        supportsImages: false,
      },
      notifyTransactions: vi.fn(),
    });

    const noDraftMethod = createHandler({
      id: 'no-draft-method',
      capabilities: {
        supportsTransactions: true,
        supportsDrafts: true,
        supportsConsolidationSuggestions: false,
        supportsAIInsights: false,
        supportsRichFormatting: false,
        supportsImages: false,
      },
      notifyDraft: undefined,
    });

    registry.register(txOnly);
    registry.register(draftOnly);
    registry.register(noDraftMethod);

    expect(registry.getTransactionCapable().map((h) => h.id).sort()).toEqual([
      'no-draft-method',
      'tx-only',
    ]);
    expect(registry.getDraftCapable().map((h) => h.id)).toEqual(['draft-only']);
  });

  it('returns an empty result for empty transaction notifications', async () => {
    const handler = createHandler({ id: 'tx' });
    registry.register(handler);

    await expect(registry.notifyTransactions('wallet-1', [])).resolves.toEqual([]);
    expect(handler.isEnabled).not.toHaveBeenCalled();
  });

  it('notifies transaction channels and handles disabled and thrown errors', async () => {
    const enabled = createHandler({
      id: 'enabled',
      notifyTransactions: vi.fn().mockResolvedValue({ success: true, channelId: 'enabled', usersNotified: 3 }),
    });

    const disabled = createHandler({
      id: 'disabled',
      isEnabled: vi.fn().mockResolvedValue(false),
    });

    const failing = createHandler({
      id: 'failing',
      notifyTransactions: vi.fn().mockRejectedValue(new Error('transaction boom')),
    });

    registry.register(enabled);
    registry.register(disabled);
    registry.register(failing);

    const results = await registry.notifyTransactions('wallet-1', txNotifications);

    expect(results).toHaveLength(3);
    expect(results).toContainEqual({ success: true, channelId: 'enabled', usersNotified: 3 });
    expect(results).toContainEqual({ success: true, channelId: 'disabled', usersNotified: 0 });
    expect(results).toContainEqual({
      success: false,
      channelId: 'failing',
      usersNotified: 0,
      errors: ['transaction boom'],
    });
  });

  it('falls back to unknown transaction channel result when settled promise rejects', async () => {
    const handler = createHandler({ id: 'tx' });
    registry.register(handler);

    const allSettledSpy = vi
      .spyOn(Promise, 'allSettled')
      .mockResolvedValueOnce([
        { status: 'rejected', reason: new Error('settled tx failure') } as PromiseRejectedResult,
      ] as PromiseSettledResult<NotificationResult>[]);

    const results = await registry.notifyTransactions('wallet-1', txNotifications);

    expect(results).toEqual([
      {
        success: false,
        channelId: 'unknown',
        usersNotified: 0,
        errors: ['settled tx failure'],
      },
    ]);

    allSettledSpy.mockRestore();
  });

  it('uses generic unknown transaction error message when rejection reason has no message', async () => {
    const handler = createHandler({ id: 'tx' });
    registry.register(handler);

    const allSettledSpy = vi
      .spyOn(Promise, 'allSettled')
      .mockResolvedValueOnce([
        { status: 'rejected', reason: {} } as PromiseRejectedResult,
      ] as PromiseSettledResult<NotificationResult>[]);

    const results = await registry.notifyTransactions('wallet-1', txNotifications);

    expect(results).toEqual([
      {
        success: false,
        channelId: 'unknown',
        usersNotified: 0,
        errors: ['Unknown error'],
      },
    ]);

    allSettledSpy.mockRestore();
  });

  it('notifies draft channels and handles disabled/missing handlers/errors', async () => {
    const enabled = createHandler({
      id: 'draft-enabled',
      notifyDraft: vi.fn().mockResolvedValue({ success: true, channelId: 'draft-enabled', usersNotified: 2 }),
    });

    const disabled = createHandler({
      id: 'draft-disabled',
      isEnabled: vi.fn().mockResolvedValue(false),
      notifyDraft: vi.fn(),
    });

    const failing = createHandler({
      id: 'draft-failing',
      notifyDraft: vi.fn().mockRejectedValue(new Error('draft boom')),
    });

    registry.register(enabled);
    registry.register(disabled);
    registry.register(failing);

    const withoutDraftMethod = createHandler({
      id: 'draft-missing-method',
      notifyDraft: undefined,
    });

    vi.spyOn(registry, 'getDraftCapable').mockReturnValue([
      enabled,
      disabled,
      failing,
      withoutDraftMethod as NotificationChannelHandler,
    ]);

    const results = await registry.notifyDraft('wallet-1', draftNotification, 'user-1');

    expect(results).toHaveLength(4);
    expect(results).toContainEqual({ success: true, channelId: 'draft-enabled', usersNotified: 2 });
    expect(results).toContainEqual({ success: true, channelId: 'draft-disabled', usersNotified: 0 });
    expect(results).toContainEqual({
      success: false,
      channelId: 'draft-failing',
      usersNotified: 0,
      errors: ['draft boom'],
    });
    expect(results).toContainEqual({ success: true, channelId: 'draft-missing-method', usersNotified: 0 });
  });

  it('falls back to unknown draft channel result when settled promise rejects', async () => {
    const handler = createHandler({ id: 'draft' });
    registry.register(handler);

    const allSettledSpy = vi
      .spyOn(Promise, 'allSettled')
      .mockResolvedValueOnce([
        { status: 'rejected', reason: new Error('settled draft failure') } as PromiseRejectedResult,
      ] as PromiseSettledResult<NotificationResult>[]);

    const results = await registry.notifyDraft('wallet-1', draftNotification, 'user-1');

    expect(results).toEqual([
      {
        success: false,
        channelId: 'unknown',
        usersNotified: 0,
        errors: ['settled draft failure'],
      },
    ]);

    allSettledSpy.mockRestore();
  });

  it('uses generic unknown draft error message when rejection reason has no message', async () => {
    const handler = createHandler({ id: 'draft' });
    registry.register(handler);

    const allSettledSpy = vi
      .spyOn(Promise, 'allSettled')
      .mockResolvedValueOnce([
        { status: 'rejected', reason: {} } as PromiseRejectedResult,
      ] as PromiseSettledResult<NotificationResult>[]);

    const results = await registry.notifyDraft('wallet-1', draftNotification, 'user-1');

    expect(results).toEqual([
      {
        success: false,
        channelId: 'unknown',
        usersNotified: 0,
        errors: ['Unknown error'],
      },
    ]);

    allSettledSpy.mockRestore();
  });
});
