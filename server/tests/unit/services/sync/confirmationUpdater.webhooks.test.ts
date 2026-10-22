/**
 * A transaction first stored unconfirmed must still produce its confirmation
 * webhooks when the confirmation refresh later confirms it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EVENTS, acceptAllDeliveries, makeEndpoint, storedTx } from '../webhooks/deliveryService.fixtures';

const m = vi.hoisted(() => ({
  populate: vi.fn(),
  update: vi.fn(),
  listEndpoints: vi.fn(),
  createDelivery: vi.fn(),
  findManyByTxids: vi.fn(),
  findWalletById: vi.fn(),
  queueWebhookDeliveryNotification: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: m.warn, error: vi.fn() }),
}));

vi.mock('../../../../src/config', () => ({ getConfig: () => ({ sync: { maxSyncDurationMs: 10_000 } }) }));
vi.mock('../../../../src/infrastructure', () => ({
  acquireLock: vi.fn(async () => ({ key: 'sync:wallet:wallet-1', token: 't' })),
  extendLock: vi.fn(async (lock: unknown) => lock),
  releaseLock: vi.fn(async () => 'deleted'),
  queueWebhookDeliveryNotification: m.queueWebhookDeliveryNotification,
}));
vi.mock('../../../../src/jobs/syncJobContract', () => ({
  getSyncLockKey: ({ walletId }: { walletId: string }) => `sync:wallet:${walletId}`,
  getSyncLockTtlMs: () => 120_000,
}));
vi.mock('../../../../src/services/bitcoin/blockchain', () => ({
  populateMissingTransactionFields: m.populate,
  updateTransactionConfirmations: m.update,
}));
vi.mock('../../../../src/services/bitcoin/sync/confirmations/updateConfirmations', () => ({
  updateTransactionConfirmationsAtHeight: vi.fn(),
}));
vi.mock('../../../../src/services/eventService', () => ({ eventService: { emitTransactionConfirmed: vi.fn() } }));
vi.mock('../../../../src/repositories', () => ({
  transactionRepository: { findManyByTxids: m.findManyByTxids },
  walletRepository: { findById: m.findWalletById },
  webhookRepository: { listEndpoints: m.listEndpoints, createDelivery: m.createDelivery },
}));

import { refreshWalletConfirmations } from '../../../../src/services/sync/confirmationUpdater';

function confirmTo(oldConfirmations: number, newConfirmations: number) {
  m.update.mockResolvedValue([{ txid: 'tx-1', oldConfirmations, newConfirmations }]);
  m.findManyByTxids.mockResolvedValue([storedTx(newConfirmations)]);
}

describe('confirmation refresh webhooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.populate.mockResolvedValue({ updated: 0, confirmationUpdates: [] });
    m.findWalletById.mockResolvedValue({ id: 'wallet-1', name: 'Treasury', network: 'mainnet' });
    acceptAllDeliveries(m.createDelivery);
    m.queueWebhookDeliveryNotification.mockResolvedValue(true);
  });

  it('queues wallet.transaction.confirmed once when a mempool transaction gets its first confirmation', async () => {
    m.listEndpoints.mockResolvedValue([makeEndpoint({ eventTypes: DEFAULT_EVENTS })]);
    confirmTo(0, 1);

    await refreshWalletConfirmations('wallet-1');

    await vi.waitFor(() => expect(m.createDelivery).toHaveBeenCalledTimes(1));
    expect(m.createDelivery).toHaveBeenCalledWith(expect.objectContaining({
      endpointId: 'endpoint-1',
      eventType: 'wallet.transaction.confirmed',
      eventId: 'wallet:wallet-1:tx:tx-1:wallet.transaction.confirmed:v1',
    }));
    expect(m.listEndpoints).toHaveBeenCalledOnce();
  });

  it('delivers every subscribed event to a threshold endpoint when the threshold is reached', async () => {
    m.listEndpoints.mockResolvedValue([makeEndpoint({ eventTypes: ['*'], filters: { confirmationThreshold: 2 } })]);
    confirmTo(1, 2);

    await refreshWalletConfirmations('wallet-1');

    await vi.waitFor(() => expect(m.createDelivery).toHaveBeenCalledTimes(3));
    expect(m.createDelivery.mock.calls.map(([input]) => input.eventType)).toEqual([
      'wallet.transaction.observed',
      'wallet.transaction.received',
      'wallet.transaction.confirmed',
    ]);
  });

  it('logs, and does not fail the refresh, when a delivery cannot be queued', async () => {
    m.listEndpoints.mockResolvedValue([makeEndpoint({ eventTypes: DEFAULT_EVENTS })]);
    m.createDelivery.mockRejectedValue(new Error('db down'));
    confirmTo(0, 1);

    await expect(refreshWalletConfirmations('wallet-1')).resolves.toMatchObject({ confirmationUpdateCount: 1 });

    await vi.waitFor(() => expect(m.warn).toHaveBeenCalledWith(
      'Confirmation webhooks partially queued',
      { walletId: 'wallet-1', errors: ['db down'] },
    ));
  });

  it('logs, and does not fail the refresh, when endpoints cannot be read', async () => {
    m.listEndpoints.mockRejectedValue(new Error('endpoints unavailable'));
    confirmTo(0, 1);

    await expect(refreshWalletConfirmations('wallet-1')).resolves.toMatchObject({ confirmationUpdateCount: 1 });

    await vi.waitFor(() => expect(m.warn).toHaveBeenCalledWith(
      'Failed to queue confirmation webhooks',
      { walletId: 'wallet-1', error: 'endpoints unavailable' },
    ));
  });
});
