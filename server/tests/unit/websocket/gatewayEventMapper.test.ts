import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findAudience: vi.fn(),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../src/repositories/pushAudienceRepository', () => ({
  findGatewayPushAudience: mocks.findAudience,
}));
vi.mock('../../../src/utils/logger', () => ({ createLogger: () => mocks.logger }));

import { mapGatewayEvent } from '../../../src/websocket/gatewayEventMapper';
import type { WebSocketEvent } from '../../../src/websocket/types';

const settings = (overrides: Record<string, boolean> = {}) => ({
  telegram: { wallets: { w1: {
    enabled: true, notifyReceived: true, notifySent: true, notifyConsolidation: true, ...overrides,
  } } },
});

describe('mapGatewayEvent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('enriches transaction events with wallet name and distinct eligible users', async () => {
    mocks.findAudience.mockResolvedValue({
      walletId: 'w1', walletName: 'Vault', transaction: null,
      candidates: [
        { userId: 'u1', preferences: settings() },
        { userId: 'u2', preferences: settings({ notifyReceived: false }) },
        { userId: 'u1', preferences: settings() },
      ],
    });
    await expect(mapGatewayEvent({
      type: 'transaction', walletId: 'w1',
      data: { txid: 'tx1', type: 'received', amount: 25, confirmations: 0 },
    })).resolves.toEqual({
      type: 'transaction', walletId: 'w1', walletName: 'Vault', userIds: ['u1'],
      data: { txid: 'tx1', type: 'received', amount: 25, confirmations: 0 },
    });
  });

  it('does not coerce transaction amounts while selecting eligible recipients', async () => {
    mocks.findAudience.mockResolvedValue({
      walletId: 'w1', walletName: 'Vault', transaction: null,
      candidates: [{ userId: 'u1', preferences: settings() }],
    });
    const event: WebSocketEvent = {
      type: 'transaction', walletId: 'w1',
      data: { txid: 'tx1', type: 'received', amount: 25.5 },
    };

    await expect(mapGatewayEvent(event)).resolves.toEqual({
      ...event, walletName: 'Vault', userIds: ['u1'],
    });
  });

  it('uses persisted type and amount before filtering and formatting confirmations', async () => {
    mocks.findAudience.mockResolvedValue({
      walletId: 'w1', walletName: 'Vault', transaction: { type: 'sent', amount: 81n },
      candidates: [
        { userId: 'sent', preferences: settings() },
        { userId: 'received-only', preferences: settings({ notifySent: false }) },
      ],
    });
    await expect(mapGatewayEvent({
      type: 'confirmation', walletId: 'w1', data: { txid: 'tx1', confirmations: 1 },
    })).resolves.toEqual({
      type: 'confirmation', walletId: 'w1', walletName: 'Vault', userIds: ['sent'],
      data: { txid: 'tx1', confirmations: 1, type: 'sent', amount: 81 },
    });
  });

  it('fails closed for missing wallets, missing transactions, and empty audiences', async () => {
    mocks.findAudience.mockResolvedValueOnce(null).mockResolvedValueOnce({
      walletId: 'w1', walletName: 'Vault', transaction: null, candidates: [],
    });
    await expect(mapGatewayEvent({ type: 'transaction', walletId: 'missing', data: { txid: 'tx1', type: 'received', amount: 1 } })).resolves.toEqual(expect.objectContaining({ userIds: [] }));
    await expect(mapGatewayEvent({ type: 'confirmation', walletId: 'w1', data: { txid: 'missing', confirmations: 1 } })).resolves.toEqual(expect.objectContaining({ userIds: [] }));
    expect(mocks.logger.warn).toHaveBeenCalledTimes(2);
  });

  it('fails closed before lookup when a push event has no transaction ID', async () => {
    await expect(mapGatewayEvent({
      type: 'transaction', walletId: 'w1', data: null,
    })).resolves.toEqual({ type: 'transaction', walletId: 'w1', data: null, userIds: [] });
    await expect(mapGatewayEvent({
      type: 'transaction', walletId: 'w1', data: {},
    })).resolves.toEqual({ type: 'transaction', walletId: 'w1', data: {}, userIds: [] });
    expect(mocks.findAudience).not.toHaveBeenCalled();
  });

  it('fails closed when a transaction event lacks direction or amount', async () => {
    mocks.findAudience.mockResolvedValue({
      walletId: 'w1', walletName: 'Vault', transaction: null, candidates: [],
    });
    await expect(mapGatewayEvent({
      type: 'transaction', walletId: 'w1', data: { txid: 'tx1' },
    })).resolves.toEqual(expect.objectContaining({ walletName: 'Vault', userIds: [] }));
  });

  it('passes non-transaction events through without a repository read', async () => {
    const event: WebSocketEvent = { type: 'balance', walletId: 'w1', data: { balance: 10 } };
    await expect(mapGatewayEvent(event)).resolves.toBe(event);
    expect(mocks.findAudience).not.toHaveBeenCalled();
  });

  it('passes relevant event types without a wallet ID through without lookup', async () => {
    const event: WebSocketEvent = {
      type: 'confirmation', data: { txid: 'tx1', confirmations: 1 },
    };
    await expect(mapGatewayEvent(event)).resolves.toBe(event);
    expect(mocks.findAudience).not.toHaveBeenCalled();
  });
});
