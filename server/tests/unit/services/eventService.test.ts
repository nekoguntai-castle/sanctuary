import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WalletType } from '@sanctuary/shared/constants/walletIdentity';

const {
  mockEventBus,
  mockBroadcastBalance,
  mockBroadcastTransaction,
  mockBroadcastConfirmation,
  mockBroadcastSync,
} = vi.hoisted(() => ({
  mockEventBus: {
    emit: vi.fn(),
    on: vi.fn().mockReturnValue(() => undefined),
    once: vi.fn(),
    getMetrics: vi.fn().mockReturnValue({ emitted: { test: 1 } }),
  },
  mockBroadcastBalance: vi.fn(),
  mockBroadcastTransaction: vi.fn(),
  mockBroadcastConfirmation: vi.fn(),
  mockBroadcastSync: vi.fn(),
}));

vi.mock('../../../src/events/eventBus', () => ({
  eventBus: mockEventBus,
}));

vi.mock('../../../src/websocket/broadcast', () => ({
  broadcastBalance: mockBroadcastBalance,
  broadcastTransaction: mockBroadcastTransaction,
  broadcastConfirmation: mockBroadcastConfirmation,
  broadcastSync: mockBroadcastSync,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { eventService } from '../../../src/services/eventService';

describe('eventService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEventBus.on.mockReturnValue(() => undefined);
    mockEventBus.getMetrics.mockReturnValue({ emitted: { test: 1 } });
  });

  it('emits wallet sync lifecycle and balance events', () => {
    eventService.emitWalletSyncStarted('wallet-1', true);
    eventService.emitWalletSynced({
      walletId: 'wallet-1',
      balance: 1000n,
      unconfirmedBalance: 50n,
      transactionCount: 10,
      duration: 1234,
    });
    eventService.emitWalletSyncFailed('wallet-1', 'sync failed', 2);
    eventService.emitBalanceChanged({
      walletId: 'wallet-1',
      previousBalance: 900n,
      newBalance: 1000n,
      unconfirmedBalance: 25n,
    });

    expect(mockEventBus.emit).toHaveBeenCalledWith('wallet:syncStarted', { walletId: 'wallet-1', fullResync: true });
    expect(mockEventBus.emit).toHaveBeenCalledWith('wallet:synced', expect.objectContaining({ walletId: 'wallet-1' }));
    expect(mockEventBus.emit).toHaveBeenCalledWith('wallet:syncFailed', { walletId: 'wallet-1', error: 'sync failed', retryCount: 2 });
    expect(mockEventBus.emit).toHaveBeenCalledWith('wallet:balanceChanged', expect.objectContaining({
      difference: 100n,
    }));
    expect(mockBroadcastSync).toHaveBeenCalled();
    expect(mockBroadcastBalance).toHaveBeenCalled();
  });

  it('emits wallet metadata events', () => {
    eventService.emitWalletCreated({
      walletId: 'wallet-1',
      userId: 'user-1',
      name: 'My Wallet',
      type: WalletType.SINGLE_SIG,
      network: 'mainnet',
    });
    eventService.emitWalletDeleted('wallet-1', 'user-1');

    expect(mockEventBus.emit).toHaveBeenCalledWith('wallet:created', expect.objectContaining({ walletId: 'wallet-1' }));
    expect(mockEventBus.emit).toHaveBeenCalledWith('wallet:deleted', { walletId: 'wallet-1', userId: 'user-1' });
  });

  it('emits transaction events and websocket notifications', () => {
    eventService.emitTransactionSent({
      walletId: 'wallet-1',
      txid: 'a'.repeat(64),
      amount: 10000n,
      fee: 100n,
      recipients: [{ address: 'tb1qabc', amount: 10000n }],
      rawTx: '02000000',
    });
    eventService.emitTransactionReceived({
      walletId: 'wallet-1',
      txid: 'b'.repeat(64),
      amount: 5000n,
      address: 'tb1qdef',
      confirmations: 1,
    });
    eventService.emitTransactionConfirmed({
      walletId: 'wallet-1',
      txid: 'c'.repeat(64),
      confirmations: 3,
      blockHeight: 900000,
      previousConfirmations: 2,
    });
    eventService.emitTransactionReplaced('wallet-1', 'd'.repeat(64), 'e'.repeat(64));

    expect(mockEventBus.emit).toHaveBeenCalledWith('transaction:sent', expect.any(Object));
    expect(mockEventBus.emit).toHaveBeenCalledWith('transaction:broadcast', expect.objectContaining({ rawTx: '02000000' }));
    expect(mockEventBus.emit).toHaveBeenCalledWith('transaction:received', expect.objectContaining({ txid: 'b'.repeat(64) }));
    expect(mockEventBus.emit).toHaveBeenCalledWith('transaction:confirmed', expect.objectContaining({ txid: 'c'.repeat(64) }));
    expect(mockEventBus.emit).toHaveBeenCalledWith('transaction:rbfReplaced', expect.objectContaining({ walletId: 'wallet-1' }));
    expect(mockBroadcastTransaction).toHaveBeenCalled();
    expect(mockBroadcastConfirmation).toHaveBeenCalled();
  });

  it('handles optional transaction and balance fields when omitted', () => {
    eventService.emitTransactionSent({
      walletId: 'wallet-2',
      txid: 'f'.repeat(64),
      amount: 2000n,
      fee: 50n,
      recipients: [{ address: 'tb1qxyz', amount: 2000n }],
    });

    eventService.emitBalanceChanged({
      walletId: 'wallet-2',
      previousBalance: 1000n,
      newBalance: 1500n,
    });

    expect(mockEventBus.emit).toHaveBeenCalledWith('transaction:sent', expect.objectContaining({
      txid: 'f'.repeat(64),
    }));
    expect(mockEventBus.emit).not.toHaveBeenCalledWith(
      'transaction:broadcast',
      expect.objectContaining({ txid: 'f'.repeat(64) })
    );
    expect(mockBroadcastBalance).toHaveBeenCalledWith('wallet-2', expect.objectContaining({
      unconfirmed: 0,
      change: 500,
    }));
  });

  it('emits user, device, and system events', () => {
    eventService.emitUserLogin({ userId: 'u1', username: 'alice', ipAddress: '127.0.0.1' });
    eventService.emitUserLogout('u1');
    eventService.emitUserCreated('u1', 'alice');
    eventService.emitPasswordChanged('u1');
    eventService.emitTwoFactorEnabled('u1');
    eventService.emitTwoFactorDisabled('u1');

    eventService.emitDeviceRegistered({
      deviceId: 'd1',
      userId: 'u1',
      type: 'trezor',
      fingerprint: 'abcd1234',
    });
    eventService.emitDeviceDeleted('d1', 'u1');
    eventService.emitDeviceShared('d1', 'u1', 'u2', 'viewer');

    eventService.emitSystemStartup('1.0.0', 'test');
    eventService.emitSystemShutdown('manual');
    eventService.emitMaintenanceStarted('cleanup');
    eventService.emitMaintenanceCompleted('cleanup', 1000, true);
    eventService.emitNewBlock('mainnet', 900000, 'hash');
    eventService.emitFeeEstimateUpdated('mainnet', 10, 8, 6);
    eventService.emitPriceUpdated(50000, 'coingecko');

    expect(mockEventBus.emit).toHaveBeenCalledWith('user:login', expect.objectContaining({ userId: 'u1' }));
    expect(mockEventBus.emit).toHaveBeenCalledWith('device:registered', expect.objectContaining({ deviceId: 'd1' }));
    expect(mockEventBus.emit).toHaveBeenCalledWith('system:startup', { version: '1.0.0', environment: 'test' });
    expect(mockEventBus.emit).toHaveBeenCalledWith('blockchain:newBlock', expect.objectContaining({ height: 900000 }));
    expect(mockEventBus.emit).toHaveBeenCalledWith('blockchain:feeEstimateUpdated', expect.objectContaining({ fastestFee: 10 }));
    expect(mockEventBus.emit).toHaveBeenCalledWith('blockchain:priceUpdated', { btcUsd: 50000, source: 'coingecko' });
  });

  it('proxies raw event-bus helpers', () => {
    const handler = vi.fn();
    const unsubscribe = vi.fn();
    mockEventBus.on.mockReturnValueOnce(unsubscribe);

    const off = eventService.on('wallet:synced' as any, handler);
    eventService.once('wallet:synced' as any, handler);
    eventService.emit('wallet:synced' as any, { walletId: 'wallet-1' } as any);
    const metrics = eventService.getMetrics();

    expect(off).toBe(unsubscribe);
    expect(mockEventBus.on).toHaveBeenCalledWith('wallet:synced', handler);
    expect(mockEventBus.once).toHaveBeenCalledWith('wallet:synced', handler);
    expect(mockEventBus.emit).toHaveBeenCalledWith('wallet:synced', { walletId: 'wallet-1' });
    expect(metrics).toEqual({ emitted: { test: 1 } });
  });
});
