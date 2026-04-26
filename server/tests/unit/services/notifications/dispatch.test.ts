/**
 * Non-regression tests for dispatch.ts — the unified entry point that callers
 * use instead of choosing between queued and inline notifications themselves.
 *
 * The dual-path bug (some callers retry, others don't, depending on which
 * function they imported) is fixed by routing every caller through this
 * helper. These tests pin down the contract:
 *
 *   1. When the BullMQ queue is healthy, the helper enqueues and never
 *      falls back to the inline path.
 *   2. When the queue rejects (Redis unavailable), the helper falls back
 *      to inline so notifications still go out — best-effort instead of
 *      silently dropped.
 *   3. Empty inputs are no-ops; neither path is invoked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDispatcher, mockNotificationService, mockLogger } = vi.hoisted(() => ({
  mockDispatcher: {
    queueTransactionNotification: vi.fn(),
    queueDraftNotification: vi.fn(),
  },
  mockNotificationService: {
    notifyNewTransactions: vi.fn(),
    notifyNewDraft: vi.fn(),
  },
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../../src/infrastructure', () => mockDispatcher);
vi.mock('../../../../src/services/notifications/notificationService', () => mockNotificationService);
vi.mock('../../../../src/utils/logger', () => ({
  createLogger: vi.fn(() => mockLogger),
}));

import {
  dispatchTransactionNotifications,
  dispatchDraftNotification,
} from '../../../../src/services/notifications/dispatch';

const transactionFixture = {
  txid: 'tx-1',
  type: 'received' as const,
  amount: 1000n,
  feeSats: 250n,
};

// Deliberately leave agent fields unset on the base fixture so the helper's
// `?? null` / `?? false` branches fire when the test passes the fixture
// straight through (covers the "agent fields absent" branch — the agent
// metadata test below covers the "agent fields present" branch).
const draftFixture = {
  id: 'draft-1',
  amount: 1500n,
  recipient: 'bc1qexample',
  feeRate: 10,
  label: 'rent',
};

describe('dispatchTransactionNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queues every transaction when Redis is healthy and never falls back to inline', async () => {
    mockDispatcher.queueTransactionNotification.mockResolvedValue(true);

    await dispatchTransactionNotifications('wallet-1', [transactionFixture, { ...transactionFixture, txid: 'tx-2' }]);

    expect(mockDispatcher.queueTransactionNotification).toHaveBeenCalledTimes(2);
    expect(mockDispatcher.queueTransactionNotification).toHaveBeenNthCalledWith(1, expect.objectContaining({
      walletId: 'wallet-1',
      txid: 'tx-1',
      type: 'received',
      amount: '1000',
      feeSats: '250',
    }));
    expect(mockNotificationService.notifyNewTransactions).not.toHaveBeenCalled();
  });

  it('falls back to inline delivery when the first queue attempt fails (Redis down)', async () => {
    mockDispatcher.queueTransactionNotification.mockResolvedValue(false);

    await dispatchTransactionNotifications('wallet-1', [transactionFixture, { ...transactionFixture, txid: 'tx-2' }]);

    expect(mockDispatcher.queueTransactionNotification).toHaveBeenCalledTimes(1);
    expect(mockNotificationService.notifyNewTransactions).toHaveBeenCalledWith('wallet-1', expect.arrayContaining([
      expect.objectContaining({ txid: 'tx-1' }),
      expect.objectContaining({ txid: 'tx-2' }),
    ]));
  });

  it('returns early on empty input without touching either path', async () => {
    await dispatchTransactionNotifications('wallet-1', []);

    expect(mockDispatcher.queueTransactionNotification).not.toHaveBeenCalled();
    expect(mockNotificationService.notifyNewTransactions).not.toHaveBeenCalled();
  });

  it('serializes BigInt fee fields, including null when fee is missing', async () => {
    mockDispatcher.queueTransactionNotification.mockResolvedValue(true);

    await dispatchTransactionNotifications('wallet-1', [{ ...transactionFixture, feeSats: null }]);

    expect(mockDispatcher.queueTransactionNotification).toHaveBeenCalledWith(expect.objectContaining({
      feeSats: null,
    }));
  });

  it('logs and swallows when the inline fallback also throws (best-effort delivery)', async () => {
    mockDispatcher.queueTransactionNotification.mockResolvedValue(false);
    mockNotificationService.notifyNewTransactions.mockRejectedValueOnce(new Error('inline broke'));

    await expect(dispatchTransactionNotifications('wallet-1', [transactionFixture])).resolves.toBeUndefined();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Inline transaction notification failed',
      expect.objectContaining({ error: 'inline broke', walletId: 'wallet-1' }),
    );
  });
});

describe('dispatchDraftNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queues the draft and never falls back to inline when the queue accepts it', async () => {
    mockDispatcher.queueDraftNotification.mockResolvedValue(true);

    await dispatchDraftNotification('wallet-1', draftFixture, 'user-1', undefined);

    expect(mockDispatcher.queueDraftNotification).toHaveBeenCalledWith(expect.objectContaining({
      walletId: 'wallet-1',
      draftId: 'draft-1',
      creatorUserId: 'user-1',
    }));
    expect(mockNotificationService.notifyNewDraft).not.toHaveBeenCalled();
  });

  it('falls back to inline delivery when the queue is unavailable', async () => {
    mockDispatcher.queueDraftNotification.mockResolvedValue(false);

    await dispatchDraftNotification('wallet-1', draftFixture, 'user-1', 'fallback-label');

    expect(mockNotificationService.notifyNewDraft).toHaveBeenCalledWith(
      'wallet-1',
      draftFixture,
      'user-1',
      'fallback-label',
    );
  });

  it('logs and swallows when the inline draft fallback also throws', async () => {
    mockDispatcher.queueDraftNotification.mockResolvedValue(false);
    mockNotificationService.notifyNewDraft.mockRejectedValueOnce(new Error('inline draft broke'));

    await expect(dispatchDraftNotification('wallet-1', draftFixture, 'user-1')).resolves.toBeUndefined();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Inline draft notification failed',
      expect.objectContaining({ error: 'inline draft broke', walletId: 'wallet-1', draftId: 'draft-1' }),
    );
  });

  it('passes agent metadata through to the queued payload so the worker can format it correctly', async () => {
    mockDispatcher.queueDraftNotification.mockResolvedValue(true);

    await dispatchDraftNotification(
      'wallet-1',
      {
        ...draftFixture,
        agentId: 'agent-7',
        agentName: 'Autopilot',
        agentSigned: true,
        agentOperationalWalletId: 'op-wallet-9',
        dedupeKey: 'dedupe-abc',
      },
      null,
      'Autopilot',
    );

    expect(mockDispatcher.queueDraftNotification).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent-7',
      agentName: 'Autopilot',
      agentSigned: true,
      agentOperationalWalletId: 'op-wallet-9',
      dedupeKey: 'dedupe-abc',
      creatorLabel: 'Autopilot',
    }));
  });
});
