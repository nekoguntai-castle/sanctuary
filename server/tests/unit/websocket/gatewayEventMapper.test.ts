import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findAudience: vi.fn(),
  filterUserIds: vi.fn(),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../src/repositories/pushAudienceRepository', () => ({
  findGatewayPushAudience: mocks.findAudience,
}));
vi.mock('../../../src/services/mobilePermissions', () => ({
  mobilePermissionService: { filterUserIdsByMobileAction: mocks.filterUserIds },
}));
vi.mock('../../../src/utils/logger', () => ({ createLogger: () => mocks.logger }));

import { mapGatewayEvent, refilterPushAudience } from '../../../src/websocket/gatewayEventMapper';
import type { GatewayPushEvent, WebSocketEvent } from '../../../src/websocket/types';

const settings = (overrides: Record<string, boolean> = {}) => ({
  telegram: { wallets: { w1: {
    enabled: true, notifyReceived: true, notifySent: true, notifyConsolidation: true, ...overrides,
  } } },
});

describe('mapGatewayEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.filterUserIds.mockImplementation(async (_walletId: string, userIds: string[]) => userIds);
  });

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

  it('passes non-transaction broadcast events through without a repository read', async () => {
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

  describe('mobile view caps', () => {
    const audience = (transaction: unknown = null) => ({
      walletId: 'w1', walletName: 'Vault', transaction,
      candidates: [
        { userId: 'u1', preferences: settings() },
        { userId: 'u2', preferences: settings() },
      ],
    });

    it('drops recipients whose viewTransactions cap is off for transaction events', async () => {
      mocks.findAudience.mockResolvedValue(audience());
      mocks.filterUserIds.mockResolvedValue(['u1']);

      await expect(mapGatewayEvent({
        type: 'transaction', walletId: 'w1', data: { txid: 'tx1', type: 'received', amount: 5 },
      })).resolves.toEqual(expect.objectContaining({ userIds: ['u1'] }));
      expect(mocks.filterUserIds).toHaveBeenCalledWith('w1', ['u1', 'u2'], 'viewTransactions');
    });

    it('drops recipients whose viewTransactions cap is off for confirmation events', async () => {
      mocks.findAudience.mockResolvedValue(audience({ type: 'received', amount: 5n }));
      mocks.filterUserIds.mockResolvedValue(['u1']);

      await expect(mapGatewayEvent({
        type: 'confirmation', walletId: 'w1', data: { txid: 'tx1', confirmations: 1 },
      })).resolves.toEqual(expect.objectContaining({ userIds: ['u1'] }));
    });

    it('sends to nobody and warns when the permission lookup fails', async () => {
      mocks.findAudience.mockResolvedValue(audience());
      mocks.filterUserIds.mockRejectedValue(new Error('db down'));

      await expect(mapGatewayEvent({
        type: 'transaction', walletId: 'w1', data: { txid: 'tx1', type: 'received', amount: 5 },
      })).resolves.toEqual(expect.objectContaining({ walletName: 'Vault', userIds: [] }));
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('sending to nobody'),
        expect.objectContaining({ walletId: 'w1', error: 'db down' }),
      );
    });
  });

  describe('refilterPushAudience: gateway-only push events (ai_insight, consolidation_suggestion)', () => {
    const insightEvent: GatewayPushEvent = {
      type: 'ai_insight', walletId: 'w1', walletName: 'Vault', userIds: ['u1', 'u2', 'u1'],
      data: { insightId: 'i1', insightType: 'fee_timing', insightTypeLabel: 'Fee Timing', severity: 'info' },
    };
    const consolidationEvent: GatewayPushEvent = {
      type: 'consolidation_suggestion', walletId: 'w1', walletName: 'Vault', userIds: ['u1', 'u2'],
      data: { feeRate: 2 },
    };
    const walletAudience = (userIds: string[], walletName = 'DB Vault') => ({
      walletId: 'w1', walletName, transaction: null,
      candidates: userIds.map((userId) => ({ userId, preferences: null })),
    });
    // Simulates an envelope written straight to Redis by someone other than the worker.
    const forged = (event: object) => event as GatewayPushEvent;

    beforeEach(() => {
      mocks.findAudience.mockResolvedValue(walletAudience(['u1', 'u2']));
    });

    it('re-checks wallet access and the viewTransactions cap at send time, naming the wallet from the DB', async () => {
      mocks.filterUserIds.mockResolvedValue(['u2']);

      await expect(refilterPushAudience({ ...insightEvent, walletName: 'Forged name' })).resolves.toEqual({
        ...insightEvent, walletName: 'DB Vault', userIds: ['u2'],
      });
      expect(mocks.findAudience).toHaveBeenCalledWith('w1', '');
      expect(mocks.filterUserIds).toHaveBeenCalledWith('w1', ['u1', 'u2'], 'viewTransactions');
      await expect(refilterPushAudience(consolidationEvent)).resolves.toEqual({
        ...consolidationEvent, walletName: 'DB Vault', userIds: ['u2'],
      });
    });

    it('drops recipients without wallet access before the cap lookup', async () => {
      mocks.findAudience.mockResolvedValue(walletAudience(['u2']));

      await expect(refilterPushAudience({ ...consolidationEvent, userIds: ['intruder', 'u2'] }))
        .resolves.toEqual({ ...consolidationEvent, walletName: 'DB Vault', userIds: ['u2'] });
      expect(mocks.filterUserIds).toHaveBeenCalledWith('w1', ['u2'], 'viewTransactions');
    });

    it('sends to nobody when no listed recipient has wallet access', async () => {
      mocks.findAudience.mockResolvedValue(walletAudience(['someone-else']));

      await expect(refilterPushAudience(insightEvent)).resolves.toBeNull();
      expect(mocks.filterUserIds).not.toHaveBeenCalled();
    });

    it('rebuilds the event from validated fields, so forged top-level and data keys never reach the gateway', async () => {
      const result = await refilterPushAudience(forged({
        ...insightEvent,
        userId: 'attacker',
        title: 'Forged title',
        data: { ...insightEvent.data, body: 'Forged body', userId: 'attacker' },
      }));

      expect(result).toEqual({ ...insightEvent, walletName: 'DB Vault', userIds: ['u1', 'u2'] });
      expect(result).not.toHaveProperty('userId');
      expect(result).not.toHaveProperty('title');
      expect(result?.data).not.toHaveProperty('body');

      const { insightTypeLabel: _label, ...unlabelled } = insightEvent.data;
      await expect(refilterPushAudience({ ...insightEvent, data: unlabelled })).resolves.toEqual({
        ...insightEvent, walletName: 'DB Vault', userIds: ['u1', 'u2'], data: unlabelled,
      });
      await expect(refilterPushAudience(forged({ ...consolidationEvent, data: { feeRate: 2, note: 'x' } })))
        .resolves.toEqual({ ...consolidationEvent, walletName: 'DB Vault' });
    });

    it.each([
      ['non-string severity', { ...insightEvent, data: { ...insightEvent.data, severity: 7 } }],
      ['empty insightId', { ...insightEvent, data: { ...insightEvent.data, insightId: '' } }],
      ['non-string insightType', { ...insightEvent, data: { ...insightEvent.data, insightType: null } }],
      ['non-string insightTypeLabel', { ...insightEvent, data: { ...insightEvent.data, insightTypeLabel: 5 } }],
      ['string feeRate', { ...consolidationEvent, data: { feeRate: '2' } }],
      ['non-finite feeRate', { ...consolidationEvent, data: { feeRate: Number.POSITIVE_INFINITY } }],
      ['insight data on a consolidation event', { ...consolidationEvent, data: insightEvent.data }],
      ['missing data', { ...consolidationEvent, data: null }],
      ['non-object event', 'ai_insight'],
      ['unknown type', { ...consolidationEvent, type: 'transaction' }],
      ['empty walletId', { ...consolidationEvent, walletId: '' }],
      ['non-string walletName', { ...consolidationEvent, walletName: 7 }],
      ['non-array userIds', { ...consolidationEvent, userIds: 'u1' }],
    ])('drops a malformed event (%s) without any lookup', async (_label, event) => {
      await expect(refilterPushAudience(forged(event as object))).resolves.toBeNull();
      expect(mocks.findAudience).not.toHaveBeenCalled();
      expect(mocks.filterUserIds).not.toHaveBeenCalled();
      expect(mocks.logger.warn).toHaveBeenCalledWith('Dropping malformed gateway push event');
    });

    it('sends to nobody and warns without user ids when the wallet is gone or the access lookup fails', async () => {
      mocks.findAudience.mockResolvedValueOnce(null);
      await expect(refilterPushAudience(insightEvent)).resolves.toBeNull();
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('sending to nobody'),
        { walletId: 'w1', type: 'ai_insight' },
      );

      mocks.findAudience.mockRejectedValueOnce(new Error('db down'));
      await expect(refilterPushAudience(consolidationEvent)).resolves.toBeNull();
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('sending to nobody'),
        { walletId: 'w1', type: 'consolidation_suggestion', error: 'db down' },
      );
      expect(mocks.filterUserIds).not.toHaveBeenCalled();
    });

    it('sends to nobody and warns when the permission lookup fails or removes everyone', async () => {
      mocks.filterUserIds.mockRejectedValueOnce(new Error('db down'));
      await expect(refilterPushAudience(consolidationEvent)).resolves.toBeNull();
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('sending to nobody'),
        expect.objectContaining({ walletId: 'w1', type: 'consolidation_suggestion', error: 'db down' }),
      );

      mocks.filterUserIds.mockResolvedValueOnce([]);
      await expect(refilterPushAudience(consolidationEvent)).resolves.toBeNull();
    });

    it('skips every lookup for an empty audience', async () => {
      await expect(refilterPushAudience({ ...insightEvent, userIds: [] })).resolves.toBeNull();
      expect(mocks.findAudience).not.toHaveBeenCalled();
      expect(mocks.filterUserIds).not.toHaveBeenCalled();
    });
  });
});
