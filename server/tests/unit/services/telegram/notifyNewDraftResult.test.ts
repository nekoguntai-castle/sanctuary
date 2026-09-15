/**
 * `notifyNewDraft` return-value contract (mirrors #1137's
 * `pushService.notifyNewTransactions`).
 *
 * Split out of telegramService.test.ts to keep that file under the
 * large-file line threshold; shares its mock shape.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

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

describe('notifyNewDraft result contract (#1137-style)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    (mockUserRepo.findByWalletAccess as Mock).mockResolvedValue([]);
    (mockUserRepo.findByIdWithSelect as Mock).mockResolvedValue({ username: 'alice', preferences: {} });
    (mockWalletRepo.findNameById as Mock).mockResolvedValue({ id: 'w1', name: 'Treasury' });
    (mockNodeConfigRepo.findDefault as Mock).mockResolvedValue(null);
  });

  const eligibleUser = (id: string, username: string, chatId: string) => ({
    id,
    username,
    preferences: {
      telegram: {
        enabled: true,
        botToken: VALID_BOT_TOKEN,
        chatId,
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
  });

  const draft = {
    id: 'd-contract',
    amount: BigInt(1234),
    recipient: 'bc1qabcdefghijklmnop',
    feeRate: 5,
  };

  it('reports success:false and usersNotified:0 when every send fails', async () => {
    const { notifyNewDraft } = await loadService();
    (mockUserRepo.findByWalletAccess as Mock).mockResolvedValue([
      eligibleUser('u1', 'alice', 'chat-1'),
      eligibleUser('u2', 'bob', 'chat-2'),
    ]);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({ description: 'Blocked by user' }),
    });

    const result = await notifyNewDraft('w1', draft, null);

    expect(result).toEqual({
      success: false,
      usersNotified: 0,
      error: 'All 2 Telegram draft notification send(s) failed',
      recorded: false,
    });
  });

  it('counts partial delivery but reports success:false naming the failed count', async () => {
    const { notifyNewDraft } = await loadService();
    (mockUserRepo.findByWalletAccess as Mock).mockResolvedValue([
      eligibleUser('u1', 'alice', 'chat-1'),
      eligibleUser('u2', 'bob', 'chat-2'),
    ]);
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn() })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: vi.fn().mockResolvedValue({ description: 'Blocked by user' }),
      });

    const result = await notifyNewDraft('w1', draft, null);

    expect(result).toEqual({
      success: false,
      usersNotified: 1,
      error: '1 of 2 Telegram draft notification send(s) failed',
      recorded: false,
    });
  });

  it('reports success:false when the wallet/user lookup throws', async () => {
    const { notifyNewDraft } = await loadService();
    (mockWalletRepo.findNameById as Mock).mockRejectedValueOnce(new Error('wallet lookup failed'));

    const result = await notifyNewDraft('w1', draft, null);

    expect(result).toEqual({
      success: false,
      usersNotified: 0,
      error: 'wallet lookup failed',
      recorded: false,
    });
  });

  it('reports success:true and usersNotified:0 when there are zero eligible recipients', async () => {
    const { notifyNewDraft } = await loadService();
    (mockUserRepo.findByWalletAccess as Mock).mockResolvedValue([
      { id: 'u-no-config', username: 'no-config', preferences: {} },
    ]);

    const result = await notifyNewDraft('w1', draft, null);

    expect(result).toEqual({ success: true, usersNotified: 0 });
  });

  it('reports success:true and usersNotified:0 when the wallet is not found', async () => {
    const { notifyNewDraft } = await loadService();
    (mockWalletRepo.findNameById as Mock).mockResolvedValueOnce(null);
    (mockUserRepo.findByWalletAccess as Mock).mockResolvedValue([
      eligibleUser('u1', 'alice', 'chat-1'),
    ]);

    const result = await notifyNewDraft('w1', draft, null);

    expect(result).toEqual({ success: true, usersNotified: 0 });
    expect(mockUserRepo.findByWalletAccess).not.toHaveBeenCalled();
  });

  it('reports success:false with the already-delivered count when a send throws mid-loop', async () => {
    vi.doMock('../../../../src/services/telegram/api', () => ({
      sendTelegramMessage: vi
        .fn()
        .mockResolvedValueOnce({
          success: true,
          outcome: 'accepted',
          failureClass: 'none',
          retryable: false,
          acknowledgement: 'accepted',
        })
        .mockRejectedValueOnce(new Error('unexpected transport crash')),
    }));

    try {
      const { notifyNewDraft } = await loadService();
      (mockUserRepo.findByWalletAccess as Mock).mockResolvedValue([
        eligibleUser('u1', 'alice', 'chat-1'),
        eligibleUser('u2', 'bob', 'chat-2'),
      ]);

      const result = await notifyNewDraft('w1', draft, null);

      expect(result).toEqual({
        success: false,
        usersNotified: 1,
        error: 'unexpected transport crash',
        recorded: false,
      });
    } finally {
      vi.doUnmock('../../../../src/services/telegram/api');
    }
  });
});
