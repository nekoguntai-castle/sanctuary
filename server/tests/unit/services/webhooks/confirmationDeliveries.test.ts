import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EVENTS, acceptAllDeliveries, makeEndpoint, storedTx } from './deliveryService.fixtures';

const m = vi.hoisted(() => ({
  listEndpoints: vi.fn(),
  createDelivery: vi.fn(),
  findManyByTxids: vi.fn(),
  findWalletById: vi.fn(),
  queueWebhookDeliveryNotification: vi.fn(),
}));

vi.mock('../../../../src/repositories', () => ({
  transactionRepository: { findManyByTxids: m.findManyByTxids },
  walletRepository: { findById: m.findWalletById },
  webhookRepository: { listEndpoints: m.listEndpoints, createDelivery: m.createDelivery },
}));
vi.mock('../../../../src/infrastructure', () => ({
  queueWebhookDeliveryNotification: m.queueWebhookDeliveryNotification,
}));

import { queueTransactionConfirmationWebhooks } from '../../../../src/services/webhooks/confirmationDeliveries';

const queuedTypes = () => m.createDelivery.mock.calls.map(([input]) => input.eventType);

describe('queueTransactionConfirmationWebhooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.findWalletById.mockResolvedValue({ id: 'wallet-1', name: 'Treasury', network: 'mainnet' });
    acceptAllDeliveries(m.createDelivery);
    m.queueWebhookDeliveryNotification.mockResolvedValue(true);
  });

  it('does nothing for confirmation decreases (reorg) or no change', async () => {
    await expect(queueTransactionConfirmationWebhooks('wallet-1', [
      { txid: 'tx-1', oldConfirmations: 2, newConfirmations: 1 },
    ])).resolves.toEqual({ queued: 0, errors: [] });
    expect(m.listEndpoints).not.toHaveBeenCalled();
  });

  it('skips building events when the wallet has no enabled endpoint', async () => {
    m.listEndpoints.mockResolvedValue([makeEndpoint({ enabled: false, eventTypes: DEFAULT_EVENTS })]);
    await queueTransactionConfirmationWebhooks('wallet-1', [{ txid: 'tx-1', oldConfirmations: 0, newConfirmations: 1 }]);
    expect(m.findManyByTxids).not.toHaveBeenCalled();
  });

  it('does not re-queue a confirmed event the endpoint already crossed', async () => {
    m.listEndpoints.mockResolvedValue([makeEndpoint({ eventTypes: DEFAULT_EVENTS })]);
    m.findManyByTxids.mockResolvedValue([storedTx(2)]);
    await queueTransactionConfirmationWebhooks('wallet-1', [{ txid: 'tx-1', oldConfirmations: 1, newConfirmations: 2 }]);
    expect(m.createDelivery).not.toHaveBeenCalled();
  });

  it('waits for a threshold and fires on the change that jumps across it', async () => {
    m.listEndpoints.mockResolvedValue([makeEndpoint({ eventTypes: DEFAULT_EVENTS, filters: { confirmationThreshold: 3 } })]);
    m.findManyByTxids.mockResolvedValue([storedTx(2)]);
    await queueTransactionConfirmationWebhooks('wallet-1', [{ txid: 'tx-1', oldConfirmations: 0, newConfirmations: 2 }]);
    expect(m.createDelivery).not.toHaveBeenCalled();

    m.findManyByTxids.mockResolvedValue([storedTx(5)]);
    await queueTransactionConfirmationWebhooks('wallet-1', [{ txid: 'tx-1', oldConfirmations: 2, newConfirmations: 5 }]);
    expect(queuedTypes()).toEqual(['wallet.transaction.received', 'wallet.transaction.confirmed']);
    expect(m.createDelivery.mock.calls[0][0].eventPayload.source.dispatchPath).toBe('sync.confirmation');
    expect(m.listEndpoints).toHaveBeenCalledTimes(2); // once per call, not again inside the delivery loop
  });

  it('ignores stored rows that are not notifiable transaction types', async () => {
    m.listEndpoints.mockResolvedValue([makeEndpoint({ eventTypes: ['*'] })]);
    m.findManyByTxids.mockResolvedValue([storedTx(1, 'unknown')]);
    await queueTransactionConfirmationWebhooks('wallet-1', [{ txid: 'tx-1', oldConfirmations: 0, newConfirmations: 1 }]);
    expect(m.createDelivery).not.toHaveBeenCalled();
  });

  it('skips a change whose transaction is no longer stored', async () => {
    m.listEndpoints.mockResolvedValue([makeEndpoint({ eventTypes: ['*'] })]);
    m.findManyByTxids.mockResolvedValue([]);
    await expect(queueTransactionConfirmationWebhooks('wallet-1', [
      { txid: 'tx-1', oldConfirmations: 0, newConfirmations: 1 },
    ])).resolves.toEqual({ queued: 0, errors: [] });
  });
});
