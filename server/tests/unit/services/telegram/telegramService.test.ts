import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const { mockPrisma, mockLogger } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    wallet: {
      findUnique: vi.fn(),
    },
    nodeConfig: {
      findFirst: vi.fn(),
    },
  },
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../../src/repositories/db', () => ({
  db: mockPrisma,
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

vi.mock('../../../../src/websocket/notifications', () => ({
  walletLog: vi.fn(),
}));

const loadService = async () => import('../../../../src/services/telegram/telegramService');

describe('telegramService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    (mockPrisma.user.findMany as Mock).mockResolvedValue([]);
    (mockPrisma.user.findUnique as Mock).mockResolvedValue({ username: 'alice', preferences: {} });
    (mockPrisma.user.update as Mock).mockResolvedValue({});
    (mockPrisma.wallet.findUnique as Mock).mockResolvedValue({ id: 'w1', name: 'Treasury' });
    (mockPrisma.nodeConfig.findFirst as Mock).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sendTelegramMessage returns success on 200 responses', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn(),
    });
    const { sendTelegramMessage } = await loadService();

    const result = await sendTelegramMessage('bot-token', 'chat-id', 'hello');

    expect(result).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.telegram.org/botbot-token/sendMessage',
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('sendTelegramMessage returns client errors without tripping the caller', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({ description: 'Unauthorized' }),
    });
    const { sendTelegramMessage } = await loadService();

    const result = await sendTelegramMessage('bad-token', 'chat-id', 'hello');

    expect(result).toEqual({ success: false, error: 'Unauthorized' });
  });

  it('sendTelegramMessage falls back to HTTP status when error details are missing', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: vi.fn().mockResolvedValue({}),
    });
    const { sendTelegramMessage } = await loadService();

    const result = await sendTelegramMessage('bot-token', 'chat-id', 'hello');

    expect(result).toEqual({ success: false, error: 'HTTP 404' });
  });

  it('sendTelegramMessage handles invalid JSON in error responses', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 418,
      json: vi.fn().mockRejectedValue(new Error('invalid json')),
    });
    const { sendTelegramMessage } = await loadService();

    const result = await sendTelegramMessage('bot-token', 'chat-id', 'hello');
    expect(result).toEqual({ success: false, error: 'HTTP 418' });
  });

  it('sendTelegramMessage reports service-side failures and circuit-open errors', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: vi.fn().mockResolvedValue({ description: 'Service unavailable' }),
    });
    const { sendTelegramMessage } = await loadService();

    await expect(sendTelegramMessage('bot-token', 'chat-id', 'hello')).resolves.toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('Telegram API error'),
      })
    );

    const { CircuitOpenError } = await import('../../../../src/services/circuitBreaker');
    fetchMock.mockRejectedValueOnce(new CircuitOpenError('telegram', 2000));
    await expect(sendTelegramMessage('bot-token', 'chat-id', 'hello')).resolves.toEqual({
      success: false,
      error: 'Telegram service unavailable, will retry shortly',
    });
  });

  it('getChatIdFromBot handles success, missing chat id, and empty update lists', async () => {
    const { getChatIdFromBot } = await loadService();

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        ok: true,
        result: [{ update_id: 1, my_chat_member: { chat: { id: 777, first_name: 'Neko' } } }],
      }),
    });
    await expect(getChatIdFromBot('bot-token')).resolves.toEqual({
      success: true,
      chatId: '777',
      username: 'Neko',
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        ok: true,
        result: [{ update_id: 2, message: {} }],
      }),
    });
    await expect(getChatIdFromBot('bot-token')).resolves.toEqual({
      success: false,
      error: 'Could not extract chat ID from messages. Please send /start to your bot.',
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        ok: true,
        result: [],
      }),
    });
    await expect(getChatIdFromBot('bot-token')).resolves.toEqual({
      success: false,
      error: 'No messages found. Please send /start to your bot first.',
    });
  });

  it('getChatIdFromBot handles 5xx and circuit-open responses', async () => {
    const { getChatIdFromBot } = await loadService();

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: vi.fn().mockResolvedValue({ description: 'Bad gateway' }),
    });
    await expect(getChatIdFromBot('bot-token')).resolves.toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('Telegram API error'),
      })
    );

    const { CircuitOpenError } = await import('../../../../src/services/circuitBreaker');
    fetchMock.mockRejectedValueOnce(new CircuitOpenError('telegram', 2000));
    await expect(getChatIdFromBot('bot-token')).resolves.toEqual({
      success: false,
      error: 'Telegram service unavailable, will retry shortly',
    });
  });

  it('getChatIdFromBot returns HTTP fallback errors and handles chat names that are missing', async () => {
    const { getChatIdFromBot } = await loadService();

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({}),
    });
    await expect(getChatIdFromBot('bot-token')).resolves.toEqual({
      success: false,
      error: 'HTTP 400',
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        ok: true,
      }),
    });
    await expect(getChatIdFromBot('bot-token')).resolves.toEqual({
      success: false,
      error: 'No messages found. Please send /start to your bot first.',
    });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        ok: true,
        result: [{ update_id: 3, message: { chat: { id: 999 } } }],
      }),
    });
    await expect(getChatIdFromBot('bot-token')).resolves.toEqual({
      success: true,
      chatId: '999',
      username: undefined,
    });
  });

  it('getChatIdFromBot handles invalid JSON in error responses', async () => {
    const { getChatIdFromBot } = await loadService();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: vi.fn().mockRejectedValue(new Error('invalid json')),
    });

    await expect(getChatIdFromBot('bot-token')).resolves.toEqual({
      success: false,
      error: 'HTTP 429',
    });
  });

  it('testTelegramConfig sends the default test payload', async () => {
    const { testTelegramConfig } = await loadService();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn(),
    });

    await expect(testTelegramConfig('bot-token', 'chat-id')).resolves.toEqual({ success: true });

    const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
    const payload = JSON.parse(options.body);
    expect(payload.text).toContain('Sanctuary Test Message');
    expect(payload.chat_id).toBe('chat-id');
  });

  it('getWalletUsers queries direct and group wallet access', async () => {
    const users = [{ id: 'u1', username: 'alice', preferences: {} }];
    (mockPrisma.user.findMany as Mock).mockResolvedValueOnce(users);
    const { getWalletUsers } = await loadService();

    await expect(getWalletUsers('wallet-1')).resolves.toEqual(users);
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { wallets: { some: { walletId: 'wallet-1' } } },
          ]),
        }),
      })
    );
  });

  it('notifyNewTransactions returns early for empty inputs and missing wallets', async () => {
    const { notifyNewTransactions } = await loadService();

    await notifyNewTransactions('w1', []);
    expect(mockPrisma.wallet.findUnique).not.toHaveBeenCalled();

    (mockPrisma.wallet.findUnique as Mock).mockResolvedValueOnce(null);
    await notifyNewTransactions('w1', [
      { txid: 'txid1', type: 'received', amount: BigInt(10_000) },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('notifyNewTransactions sends sent and consolidation messages and skips unsupported types', async () => {
    const { notifyNewTransactions } = await loadService();
    (mockPrisma.nodeConfig.findFirst as Mock).mockResolvedValueOnce({ explorerUrl: 'https://explorer.example' });
    (mockPrisma.user.findMany as Mock).mockResolvedValueOnce([
      {
        id: 'u1',
        username: 'alice',
        preferences: {
          telegram: {
            enabled: true,
            botToken: 'bot',
            chatId: 'chat',
            wallets: {
              w1: {
                enabled: true,
                notifyReceived: false,
                notifySent: true,
                notifyConsolidation: true,
                notifyDraft: false,
              },
            },
          },
        },
      },
    ]);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn(),
    });

    await notifyNewTransactions('w1', [
      { txid: 'senttxid', type: 'sent', amount: BigInt(12_345) },
      { txid: 'constxid', type: 'consolidation', amount: BigInt(20_000) },
      { txid: 'unknowntxid', type: 'other', amount: BigInt(30_000) },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sentPayload = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    const consolidationPayload = JSON.parse((fetchMock.mock.calls[1][1] as { body: string }).body);
    expect(sentPayload.text).toContain('<b>Sent</b>');
    expect(consolidationPayload.text).toContain('<b>Consolidation</b>');
    expect(sentPayload.text).toContain('https://explorer.example/tx/senttxid');
  });

  it('notifyNewTransactions falls back to the default explorer URL when node config lookup fails', async () => {
    const { notifyNewTransactions } = await loadService();
    (mockPrisma.nodeConfig.findFirst as Mock).mockRejectedValueOnce(new Error('node config unavailable'));
    (mockPrisma.user.findMany as Mock).mockResolvedValueOnce([
      {
        id: 'u1',
        username: 'alice',
        preferences: {
          telegram: {
            enabled: true,
            botToken: 'bot',
            chatId: 'chat',
            wallets: {
              w1: {
                enabled: true,
                notifyReceived: true,
                notifySent: false,
                notifyConsolidation: false,
                notifyDraft: false,
              },
            },
          },
        },
      },
    ]);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn(),
    });

    await notifyNewTransactions('w1', [
      { txid: 'receive-txid', type: 'received', amount: BigInt(20_000) },
    ]);

    const payload = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(payload.text).toContain('https://mempool.space/tx/receive-txid');
  });

  it('notifyNewTransactions logs failed deliveries and catches unexpected errors', async () => {
    const { notifyNewTransactions } = await loadService();
    (mockPrisma.user.findMany as Mock).mockResolvedValue([
      {
        id: 'u1',
        username: 'alice',
        preferences: {
          telegram: {
            enabled: true,
            botToken: 'bot',
            chatId: 'chat',
            wallets: {
              w1: {
                enabled: true,
                notifyReceived: true,
                notifySent: true,
                notifyConsolidation: true,
                notifyDraft: true,
              },
            },
          },
        },
      },
    ]);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({ description: 'Chat not found' }),
    });

    await notifyNewTransactions('w1', [
      { txid: 'abcd1234', type: 'received', amount: BigInt(1000) },
    ]);

    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to send Telegram to alice'));

    (mockPrisma.wallet.findUnique as Mock).mockRejectedValueOnce(new Error('db offline'));
    await notifyNewTransactions('w1', [
      { txid: 'deadbeef', type: 'sent', amount: BigInt(1000) },
    ]);
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Error sending Telegram notifications'));
  });

  it('notifyNewDraft skips ineligible users, warns on send failure, and catches errors', async () => {
    const { notifyNewDraft } = await loadService();
    (mockPrisma.user.findMany as Mock).mockResolvedValue([
      {
        id: 'creator-id',
        username: 'creator',
        preferences: {},
      },
      {
        id: 'u-no-config',
        username: 'no-config',
        preferences: {},
      },
      {
        id: 'u-disabled',
        username: 'disabled',
        preferences: {
          telegram: {
            enabled: true,
            botToken: 'bot',
            chatId: 'chat',
            wallets: {
              w1: {
                enabled: true,
                notifyReceived: true,
                notifySent: true,
                notifyConsolidation: true,
                notifyDraft: false,
              },
            },
          },
        },
      },
      {
        id: 'u-eligible',
        username: 'eligible',
        preferences: {
          telegram: {
            enabled: true,
            botToken: 'bot',
            chatId: 'chat',
            wallets: {
              w1: {
                enabled: true,
                notifyReceived: true,
                notifySent: true,
                notifyConsolidation: true,
                notifyDraft: true,
              },
            },
          },
        },
      },
    ]);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({ description: 'Blocked by user' }),
    });

    await notifyNewDraft(
      'w1',
      {
        id: 'd1',
        amount: BigInt(1234),
        recipient: 'bc1qabcdefghijklmnop',
        feeRate: 5,
      },
      'creator-id'
    );

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to send draft notification to eligible')
    );

    (mockPrisma.wallet.findUnique as Mock).mockRejectedValueOnce(new Error('wallet lookup failed'));
    await notifyNewDraft(
      'w1',
      {
        id: 'd2',
        amount: BigInt(1234),
        recipient: 'bc1qabcdefghijklmnop',
        feeRate: 5,
      },
      'creator-id'
    );
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Error sending draft notifications'));
  });

  it('notifyNewDraft exits when wallet is missing and falls back to Unknown creator name', async () => {
    const { notifyNewDraft } = await loadService();

    (mockPrisma.wallet.findUnique as Mock).mockResolvedValueOnce(null);
    await notifyNewDraft(
      'w1',
      {
        id: 'd0',
        amount: BigInt(1234),
        recipient: 'bc1qabcdefghijklmnop',
        feeRate: 5,
      },
      'creator-id'
    );
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();

    (mockPrisma.wallet.findUnique as Mock).mockResolvedValueOnce({ id: 'w1', name: 'Treasury' });
    (mockPrisma.user.findUnique as Mock).mockResolvedValueOnce(null);
    (mockPrisma.user.findMany as Mock).mockResolvedValueOnce([
      {
        id: 'u-eligible',
        username: 'eligible',
        preferences: {
          telegram: {
            enabled: true,
            botToken: 'bot',
            chatId: 'chat',
            wallets: {
              w1: {
                enabled: true,
                notifyReceived: false,
                notifySent: false,
                notifyConsolidation: false,
                notifyDraft: true,
              },
            },
          },
        },
      },
    ]);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn(),
    });

    await notifyNewDraft(
      'w1',
      {
        id: 'd1',
        amount: BigInt(777),
        recipient: 'bc1qabcdefghijklmnopqrstuvwxyz123456789',
        feeRate: 10,
      },
      'creator-id'
    );

    const payload = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(payload.text).toContain('Created by: Unknown');
  });

  it('updateWalletTelegramSettings initializes defaults when preferences are missing', async () => {
    const { updateWalletTelegramSettings } = await loadService();
    (mockPrisma.user.findUnique as Mock).mockResolvedValueOnce({ preferences: null });

    await updateWalletTelegramSettings('user-1', 'wallet-1', {
      enabled: true,
      notifyDraft: true,
      notifyReceived: true,
      notifySent: false,
      notifyConsolidation: false,
    });

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        preferences: {
          telegram: {
            botToken: '',
            chatId: '',
            enabled: false,
            wallets: {
              'wallet-1': {
                enabled: true,
                notifyDraft: true,
                notifyReceived: true,
                notifySent: false,
                notifyConsolidation: false,
              },
            },
          },
        },
      },
    });
  });

  it('updateWalletTelegramSettings preserves telegram config and creates wallet map when missing', async () => {
    const { updateWalletTelegramSettings } = await loadService();
    (mockPrisma.user.findUnique as Mock).mockResolvedValueOnce({
      preferences: {
        locale: 'en',
        telegram: {
          botToken: 'bot-token',
          chatId: 'chat-id',
          enabled: true,
        },
      },
    });

    await updateWalletTelegramSettings('user-2', 'wallet-2', {
      enabled: true,
      notifyDraft: false,
      notifyReceived: false,
      notifySent: true,
      notifyConsolidation: true,
    });

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-2' },
      data: {
        preferences: {
          locale: 'en',
          telegram: {
            botToken: 'bot-token',
            chatId: 'chat-id',
            enabled: true,
            wallets: {
              'wallet-2': {
                enabled: true,
                notifyDraft: false,
                notifyReceived: false,
                notifySent: true,
                notifyConsolidation: true,
              },
            },
          },
        },
      },
    });
  });

  it('getWalletTelegramSettings returns null for missing users and missing wallet settings', async () => {
    const { getWalletTelegramSettings } = await loadService();
    (mockPrisma.user.findUnique as Mock).mockResolvedValueOnce(null);
    await expect(getWalletTelegramSettings('missing', 'wallet-1')).resolves.toBeNull();

    (mockPrisma.user.findUnique as Mock).mockResolvedValueOnce({ preferences: {} });
    await expect(getWalletTelegramSettings('user-1', 'wallet-1')).resolves.toBeNull();
  });

  it('getWalletTelegramSettings returns wallet-specific settings when configured', async () => {
    const { getWalletTelegramSettings } = await loadService();
    (mockPrisma.user.findUnique as Mock).mockResolvedValueOnce({
      preferences: {
        telegram: {
          botToken: 'bot',
          chatId: 'chat',
          enabled: true,
          wallets: {
            'wallet-1': {
              enabled: true,
              notifyReceived: true,
              notifySent: true,
              notifyConsolidation: false,
              notifyDraft: true,
            },
          },
        },
      },
    });

    await expect(getWalletTelegramSettings('user-1', 'wallet-1')).resolves.toEqual({
      enabled: true,
      notifyReceived: true,
      notifySent: true,
      notifyConsolidation: false,
      notifyDraft: true,
    });
  });

  it('updateWalletTelegramSettings throws when user is not found', async () => {
    const { updateWalletTelegramSettings } = await loadService();
    (mockPrisma.user.findUnique as Mock).mockResolvedValueOnce(null);

    await expect(
      updateWalletTelegramSettings('missing-user', 'w1', {
        enabled: true,
        notifyDraft: true,
        notifyReceived: true,
        notifySent: true,
        notifyConsolidation: true,
      })
    ).rejects.toThrow('User not found');
  });
});
