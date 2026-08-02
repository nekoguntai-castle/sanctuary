import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const { mockUserRepo, mockWalletRepo, mockNodeConfigRepo, mockLogger } = vi.hoisted(() => ({
  mockUserRepo: {
    findByWalletAccess: vi.fn(),
    findByIdWithSelect: vi.fn(),
    updatePreferences: vi.fn(),
  },
  mockWalletRepo: {
    findNameById: vi.fn(),
  },
  mockNodeConfigRepo: {
    findDefault: vi.fn(),
  },
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../../src/repositories', () => ({
  userRepository: mockUserRepo,
  walletRepository: mockWalletRepo,
  nodeConfigRepository: mockNodeConfigRepo,
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

vi.mock('../../../../src/websocket/notifications', () => ({
  walletLog: vi.fn(),
}));

const loadService = async () => import('../../../../src/services/telegram/telegramService');
const VALID_BOT_TOKEN = '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi';

describe('telegramService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    (mockUserRepo.findByWalletAccess as Mock).mockResolvedValue([]);
    (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValue({ username: 'alice', preferences: {} });
    (mockUserRepo.updatePreferences as Mock).mockResolvedValue({});
    (mockWalletRepo.findNameById as Mock).mockResolvedValue({ id: 'w1', name: 'Treasury' });
    (mockNodeConfigRepo.findDefault as Mock).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('../../../../src/services/telegram/api');
    vi.doUnmock('../../../../src/services/circuitBreaker');
  });

  it('sendTelegramMessage returns success on 200 responses', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn(),
    });
    const { sendTelegramMessage } = await loadService();

    const result = await sendTelegramMessage(VALID_BOT_TOKEN, 'chat-id', 'hello');
    const { getTelegramTransportDiagnostics } = await import(
      '../../../../src/services/telegram/api'
    );

    expect(result).toEqual({
      success: true,
      outcome: 'accepted',
      failureClass: 'none',
      retryable: false,
      acknowledgement: 'accepted',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.telegram.org/bot${VALID_BOT_TOKEN}/sendMessage`,
      expect.objectContaining({
        method: 'POST',
      })
    );
    expect(getTelegramTransportDiagnostics()).toEqual({
      lastSuccessAt: expect.any(Number),
      lastFailureAt: null,
      lastFailureClass: 'none',
    });
  });

  it('sendTelegramMessage rejects malformed bot tokens before calling Telegram', async () => {
    const { sendTelegramMessage } = await loadService();

    const result = await sendTelegramMessage('bot-token', 'chat-id', 'hello');
    const { getTelegramTransportDiagnostics } = await import(
      '../../../../src/services/telegram/api'
    );

    expect(result).toEqual(expect.objectContaining({
      success: false,
      error: 'Invalid Telegram bot token',
      outcome: 'rejected',
      failureClass: 'invalid_configuration',
      acknowledgement: 'not_accepted',
    }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getTelegramTransportDiagnostics()).toEqual({
      lastSuccessAt: null,
      lastFailureAt: expect.any(Number),
      lastFailureClass: 'invalid_configuration',
    });
  });

  it('sendTelegramMessage returns client errors without tripping the caller', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({ description: 'Unauthorized' }),
    });
    const { sendTelegramMessage } = await loadService();

    const result = await sendTelegramMessage(VALID_BOT_TOKEN, 'chat-id', 'hello');

    expect(result).toEqual(expect.objectContaining({
      success: false,
      error: 'Unauthorized',
      outcome: 'rejected',
      failureClass: 'authentication',
    }));
  });

  it('sendTelegramMessage falls back to HTTP status when error details are missing', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: vi.fn().mockResolvedValue({}),
    });
    const { sendTelegramMessage } = await loadService();

    const result = await sendTelegramMessage(VALID_BOT_TOKEN, 'chat-id', 'hello');

    expect(result).toEqual(expect.objectContaining({
      success: false,
      error: 'HTTP 404',
      outcome: 'rejected',
      failureClass: 'provider_rejected',
    }));
  });

  it('sendTelegramMessage handles invalid JSON in error responses', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 418,
      json: vi.fn().mockRejectedValue(new Error('invalid json')),
    });
    const { sendTelegramMessage } = await loadService();

    const result = await sendTelegramMessage(VALID_BOT_TOKEN, 'chat-id', 'hello');
    expect(result).toEqual(expect.objectContaining({
      success: false,
      error: 'HTTP 418',
      outcome: 'rejected',
      failureClass: 'provider_rejected',
    }));
  });

  it('classifies Telegram rate limiting without retaining provider text as a class', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: vi.fn().mockResolvedValue({ description: 'provider-specific poison detail' }),
    });
    const { sendTelegramMessage } = await loadService();

    const result = await sendTelegramMessage(VALID_BOT_TOKEN, 'chat-id', 'hello');

    expect(result).toMatchObject({
      success: false,
      outcome: 'rejected',
      failureClass: 'rate_limited',
      retryable: true,
      acknowledgement: 'not_accepted',
    });
    expect(result.failureClass).not.toContain('poison');
  });

  it('sendTelegramMessage reports service-side failures and circuit-open errors', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: vi.fn().mockResolvedValue({ description: 'Service unavailable' }),
    });
    const { sendTelegramMessage } = await loadService();

    await expect(sendTelegramMessage(VALID_BOT_TOKEN, 'chat-id', 'hello')).resolves.toEqual(
      expect.objectContaining({
        success: false,
        error: 'Service unavailable',
        outcome: 'rejected',
        failureClass: 'provider_unavailable',
      })
    );

    const { CircuitOpenError } = await import('../../../../src/services/circuitBreaker');
    fetchMock.mockRejectedValueOnce(new CircuitOpenError('telegram', 2000));
    await expect(sendTelegramMessage(VALID_BOT_TOKEN, 'chat-id', 'hello')).resolves.toEqual(
      expect.objectContaining({
        success: false,
        error: 'Telegram service unavailable, will retry shortly',
        outcome: 'rejected',
        failureClass: 'circuit_open',
      }),
    );
  });

  it('classifies a timeout after fetch starts as acknowledgement-ambiguous', async () => {
    const timeout = new Error('request timed out');
    timeout.name = 'TimeoutError';
    fetchMock.mockRejectedValueOnce(timeout);
    const { sendTelegramMessage } = await loadService();

    await expect(sendTelegramMessage(VALID_BOT_TOKEN, 'chat-id', 'hello')).resolves.toEqual(
      expect.objectContaining({
        success: false,
        outcome: 'ambiguous',
        failureClass: 'timeout',
        acknowledgement: 'unknown',
        retryable: true,
      }),
    );
  });

  it('classifies non-timeout transport exceptions as network failures', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('connection reset'));
    const { sendTelegramMessage } = await loadService();

    await expect(sendTelegramMessage(VALID_BOT_TOKEN, 'chat-id', 'hello')).resolves.toEqual(
      expect.objectContaining({
        success: false,
        outcome: 'ambiguous',
        failureClass: 'network',
        acknowledgement: 'unknown',
      }),
    );
  });

  it('maps non-provider diagnostic failure classes into the closed other bucket', async () => {
    vi.doMock('../../../../src/services/circuitBreaker', () => ({
      CircuitOpenError: class CircuitOpenError extends Error {},
      createCircuitBreaker: () => ({
        execute: vi.fn().mockResolvedValue({
          success: false,
          outcome: 'ambiguous',
          failureClass: 'internal',
          retryable: true,
          acknowledgement: 'unknown',
          error: 'private internal detail',
        }),
      }),
    }));
    const { sendTelegramMessage, getTelegramTransportDiagnostics } = await import(
      '../../../../src/services/telegram/api'
    );

    await sendTelegramMessage(VALID_BOT_TOKEN, 'chat-id', 'hello');

    expect(getTelegramTransportDiagnostics().lastFailureClass).toBe('other');
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
    await expect(getChatIdFromBot(VALID_BOT_TOKEN)).resolves.toEqual({
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
    await expect(getChatIdFromBot(VALID_BOT_TOKEN)).resolves.toEqual({
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
    await expect(getChatIdFromBot(VALID_BOT_TOKEN)).resolves.toEqual({
      success: false,
      error: 'No messages found. Please send /start to your bot first.',
    });
  });

  it('getChatIdFromBot rejects malformed bot tokens before calling Telegram', async () => {
    const { getChatIdFromBot } = await loadService();

    await expect(getChatIdFromBot('bot-token')).resolves.toEqual({
      success: false,
      error: 'Invalid Telegram bot token',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('getChatIdFromBot handles 5xx and circuit-open responses', async () => {
    const { getChatIdFromBot } = await loadService();

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: vi.fn().mockResolvedValue({ description: 'Bad gateway' }),
    });
    await expect(getChatIdFromBot(VALID_BOT_TOKEN)).resolves.toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('Telegram API error'),
      })
    );

    const { CircuitOpenError } = await import('../../../../src/services/circuitBreaker');
    fetchMock.mockRejectedValueOnce(new CircuitOpenError('telegram', 2000));
    await expect(getChatIdFromBot(VALID_BOT_TOKEN)).resolves.toEqual({
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
    await expect(getChatIdFromBot(VALID_BOT_TOKEN)).resolves.toEqual({
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
    await expect(getChatIdFromBot(VALID_BOT_TOKEN)).resolves.toEqual({
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
    await expect(getChatIdFromBot(VALID_BOT_TOKEN)).resolves.toEqual({
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

    await expect(getChatIdFromBot(VALID_BOT_TOKEN)).resolves.toEqual({
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

    await expect(testTelegramConfig(VALID_BOT_TOKEN, 'chat-id')).resolves.toEqual(
      expect.objectContaining({ success: true, outcome: 'accepted' }),
    );

    const [, options] = fetchMock.mock.calls[0] as [string, { body: string }];
    const payload = JSON.parse(options.body);
    expect(payload.text).toContain('Sanctuary Test Message');
    expect(payload.chat_id).toBe('chat-id');
  });

  it('getWalletUsers queries direct and group wallet access', async () => {
    const users = [{ id: 'u1', username: 'alice', preferences: {} }];
    (mockUserRepo.findByWalletAccess as Mock).mockResolvedValueOnce(users);
    const { getWalletUsers } = await loadService();

    await expect(getWalletUsers('wallet-1')).resolves.toEqual(users);
    expect(mockUserRepo.findByWalletAccess).toHaveBeenCalledWith('wallet-1');
  });

  it('notifyNewTransactions returns early for empty inputs and missing wallets', async () => {
    const { notifyNewTransactions } = await loadService();

    await expect(notifyNewTransactions('w1', [])).resolves.toEqual({
      usersNotified: 0,
      attempted: 0,
      errors: [],
      outcome: 'no_recipients',
      failureClass: 'none',
    });
    expect(mockWalletRepo.findNameById).not.toHaveBeenCalled();

    (mockWalletRepo.findNameById as Mock).mockResolvedValueOnce(null);
    await expect(notifyNewTransactions('w1', [
      { txid: 'txid1', type: 'received', amount: BigInt(10_000) },
    ])).resolves.toEqual({
      usersNotified: 0,
      attempted: 0,
      errors: [],
      outcome: 'no_recipients',
      failureClass: 'none',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips empty recipient sets, unconfigured users, and disabled wallet settings', async () => {
    const { notifyNewTransactions } = await loadService();

    (mockUserRepo.findByWalletAccess as Mock).mockResolvedValueOnce([]);
    await expect(notifyNewTransactions('w1', [
      { txid: 'tx-no-users', type: 'received', amount: 1n },
    ])).resolves.toMatchObject({ attempted: 0, outcome: 'no_recipients' });

    (mockUserRepo.findByWalletAccess as Mock).mockResolvedValueOnce([
      { id: 'u1', username: 'missing', preferences: {} },
      {
        id: 'u2',
        username: 'disabled',
        preferences: {
          telegram: {
            enabled: true,
            botToken: VALID_BOT_TOKEN,
            chatId: 'chat',
            wallets: { w1: { enabled: false } },
          },
        },
      },
    ]);
    await expect(notifyNewTransactions('w1', [
      { txid: 'tx-ineligible', type: 'received', amount: 1n },
    ])).resolves.toMatchObject({ attempted: 0, outcome: 'no_recipients' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('notifyNewTransactions sends sent and consolidation messages and skips unsupported types', async () => {
    const { notifyNewTransactions } = await loadService();
    (mockNodeConfigRepo.findDefault as Mock).mockResolvedValueOnce({ explorerUrl: 'https://explorer.example' });
    (mockUserRepo.findByWalletAccess as Mock).mockResolvedValueOnce([
      {
        id: 'u1',
        username: 'alice',
        preferences: {
          telegram: {
            enabled: true,
            botToken: VALID_BOT_TOKEN,
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

    const summary = await notifyNewTransactions('w1', [
      { txid: 'senttxid', type: 'sent', amount: BigInt(12_345) },
      { txid: 'constxid', type: 'consolidation', amount: BigInt(20_000) },
      { txid: 'unknowntxid', type: 'other', amount: BigInt(30_000) },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(summary).toEqual({
      usersNotified: 2,
      attempted: 2,
      errors: [],
      outcome: 'accepted',
      failureClass: 'none',
    });
    const sentPayload = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    const consolidationPayload = JSON.parse((fetchMock.mock.calls[1][1] as { body: string }).body);
    expect(sentPayload.text).toContain('<b>Sent</b>');
    expect(consolidationPayload.text).toContain('<b>Consolidation</b>');
    expect(sentPayload.text).toContain('https://explorer.example/tx/senttxid');
  });

  it('notifyNewTransactions falls back to the default explorer URL when node config lookup fails', async () => {
    const { notifyNewTransactions } = await loadService();
    (mockNodeConfigRepo.findDefault as Mock).mockRejectedValueOnce(new Error('node config unavailable'));
    (mockUserRepo.findByWalletAccess as Mock).mockResolvedValueOnce([
      {
        id: 'u1',
        username: 'alice',
        preferences: {
          telegram: {
            enabled: true,
            botToken: VALID_BOT_TOKEN,
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
    (mockUserRepo.findByWalletAccess as Mock).mockResolvedValue([
      {
        id: 'u1',
        username: 'alice',
        preferences: {
          telegram: {
            enabled: true,
            botToken: VALID_BOT_TOKEN,
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

    const summary = await notifyNewTransactions('w1', [
      { txid: 'abcd1234', type: 'received', amount: BigInt(1000) },
    ]);

    expect(summary).toEqual({
      usersNotified: 0,
      attempted: 1,
      errors: ['Chat not found'],
      outcome: 'rejected',
      failureClass: 'provider_rejected',
    });
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to send Telegram to alice'));

    (mockWalletRepo.findNameById as Mock).mockRejectedValueOnce(new Error('db offline'));
    await notifyNewTransactions('w1', [
      { txid: 'deadbeef', type: 'sent', amount: BigInt(1000) },
    ]);
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Error sending Telegram notifications'));
  });

  it('classifies mixed recipient acceptance and rejection as partial', async () => {
    const { notifyNewTransactions } = await loadService();
    const walletSettings = {
      enabled: true,
      notifyReceived: true,
      notifySent: false,
      notifyConsolidation: false,
      notifyDraft: false,
    };
    (mockUserRepo.findByWalletAccess as Mock).mockResolvedValueOnce([
      {
        id: 'u1',
        username: 'alice',
        preferences: {
          telegram: {
            enabled: true,
            botToken: VALID_BOT_TOKEN,
            chatId: 'chat-1',
            wallets: { w1: walletSettings },
          },
        },
      },
      {
        id: 'u2',
        username: 'bob',
        preferences: {
          telegram: {
            enabled: true,
            botToken: VALID_BOT_TOKEN,
            chatId: 'chat-2',
            wallets: { w1: walletSettings },
          },
        },
      },
    ]);
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn() })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: vi.fn().mockResolvedValue({ description: 'blocked' }),
      });

    const summary = await notifyNewTransactions('w1', [
      { txid: 'abcd1234', type: 'received', amount: BigInt(1000) },
    ]);

    expect(summary).toMatchObject({
      usersNotified: 1,
      attempted: 2,
      outcome: 'partial',
      failureClass: 'permission',
    });
  });

  it('notifyNewTransactions records a generic error when the send result lacks details', async () => {
    vi.doMock('../../../../src/services/telegram/api', () => ({
      sendTelegramMessage: vi.fn().mockResolvedValue({ success: false }),
      getChatIdFromBot: vi.fn(),
      testTelegramConfig: vi.fn(),
    }));

    const { notifyNewTransactions } = await loadService();
    (mockUserRepo.findByWalletAccess as Mock).mockResolvedValue([
      {
        id: 'u1',
        username: 'alice',
        preferences: {
          telegram: {
            enabled: true,
            botToken: VALID_BOT_TOKEN,
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

    const summary = await notifyNewTransactions('w1', [
      { txid: 'abcd1234', type: 'received', amount: BigInt(1000) },
    ]);

    expect(summary).toEqual({
      usersNotified: 0,
      attempted: 1,
      errors: ['Unknown Telegram send failure'],
      outcome: 'ambiguous',
      failureClass: 'unknown',
    });
  });

  it('aggregates mixed recipient outcomes independent of delivery order', async () => {
    vi.doMock('../../../../src/services/telegram/api', () => ({
      sendTelegramMessage: vi.fn()
        .mockResolvedValueOnce({
          success: false,
          outcome: 'rejected',
          failureClass: 'authentication',
          error: 'first private detail',
        })
        .mockResolvedValueOnce({
          success: false,
          outcome: 'rejected',
          failureClass: 'authentication',
          error: 'second private detail',
        })
        .mockResolvedValueOnce({
          success: false,
          outcome: 'ambiguous',
          failureClass: 'authentication',
          error: 'third private detail',
        })
        .mockResolvedValueOnce({
          success: true,
          outcome: 'accepted',
          failureClass: 'none',
        })
        .mockResolvedValueOnce({
          success: false,
          outcome: 'rejected',
          failureClass: 'timeout',
          error: 'second private detail',
        }),
      getChatIdFromBot: vi.fn(),
      testTelegramConfig: vi.fn(),
    }));
    const { notifyNewTransactions } = await loadService();
    const walletSettings = {
      enabled: true,
      notifyReceived: true,
      notifySent: false,
      notifyConsolidation: false,
      notifyDraft: false,
    };
    (mockUserRepo.findByWalletAccess as Mock).mockResolvedValueOnce([
      {
        id: 'u1', username: 'alice',
        preferences: { telegram: {
          enabled: true, botToken: VALID_BOT_TOKEN, chatId: 'chat-1',
          wallets: { w1: walletSettings },
        } },
      },
      {
        id: 'u2', username: 'bob',
        preferences: { telegram: {
          enabled: true, botToken: VALID_BOT_TOKEN, chatId: 'chat-2',
          wallets: { w1: walletSettings },
        } },
      },
      {
        id: 'u3', username: 'carol',
        preferences: { telegram: {
          enabled: true, botToken: VALID_BOT_TOKEN, chatId: 'chat-3',
          wallets: { w1: walletSettings },
        } },
      },
      {
        id: 'u4', username: 'dave',
        preferences: { telegram: {
          enabled: true, botToken: VALID_BOT_TOKEN, chatId: 'chat-4',
          wallets: { w1: walletSettings },
        } },
      },
      {
        id: 'u5', username: 'erin',
        preferences: { telegram: {
          enabled: true, botToken: VALID_BOT_TOKEN, chatId: 'chat-5',
          wallets: { w1: walletSettings },
        } },
      },
    ]);

    const summary = await notifyNewTransactions('w1', [
      { txid: 'tx-failures', type: 'received', amount: 1n },
    ]);

    expect(summary).toMatchObject({
      attempted: 5,
      usersNotified: 1,
      outcome: 'partial',
      failureClass: 'other',
    });
  });

  it('notifyNewDraft skips ineligible users, warns on send failure, and catches errors', async () => {
    const { notifyNewDraft } = await loadService();
    (mockUserRepo.findByWalletAccess as Mock).mockResolvedValue([
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
            botToken: VALID_BOT_TOKEN,
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
            botToken: VALID_BOT_TOKEN,
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

    (mockWalletRepo.findNameById as Mock).mockRejectedValueOnce(new Error('wallet lookup failed'));
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

    (mockWalletRepo.findNameById as Mock).mockResolvedValueOnce(null);
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
    expect(mockUserRepo.findByIdWithSelect).not.toHaveBeenCalled();

    (mockWalletRepo.findNameById as Mock).mockResolvedValueOnce({ id: 'w1', name: 'Treasury' });
    (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValueOnce(null);
    (mockUserRepo.findByWalletAccess as Mock).mockResolvedValueOnce([
      {
        id: 'u-eligible',
        username: 'eligible',
        preferences: {
          telegram: {
            enabled: true,
            botToken: VALID_BOT_TOKEN,
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

});
