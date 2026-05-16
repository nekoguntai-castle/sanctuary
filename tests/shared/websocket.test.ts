import { describe, expect, it } from 'vitest';

import {
  WEBSOCKET_CLIENT_MESSAGE_TYPES,
  WEBSOCKET_BROADCAST_EVENT_TYPES,
  WEBSOCKET_GLOBAL_CHANNELS,
  WebSocketChannels,
  getWalletIdFromWebSocketChannel,
  isClientMessage,
  isServerEvent,
  isWebSocketGlobalEventType,
  isWebSocketWalletChannel,
  isWebSocketWalletEventType,
} from '../../shared/types/websocket';

describe('shared websocket protocol ownership', () => {
  it('owns every active client message type including batch subscriptions', () => {
    expect(WEBSOCKET_CLIENT_MESSAGE_TYPES).toEqual([
      'auth',
      'subscribe',
      'unsubscribe',
      'subscribe_batch',
      'unsubscribe_batch',
      'ping',
      'pong',
    ]);

    expect(isClientMessage({ type: 'subscribe_batch', data: { channels: ['blocks'] } })).toBe(true);
    expect(isClientMessage({ type: 'unsubscribe_batch', data: { channels: ['blocks'] } })).toBe(true);
  });

  it('owns active broadcast event names without model-management events', () => {
    expect(WEBSOCKET_BROADCAST_EVENT_TYPES).toEqual([
      'transaction',
      'balance',
      'confirmation',
      'sync',
      'log',
      'block',
      'newBlock',
      'mempool',
    ]);
    expect(WEBSOCKET_BROADCAST_EVENT_TYPES).not.toContain('modelDownload');
  });

  it('owns websocket control events emitted by the server', () => {
    expect(isServerEvent({ type: 'subscribed_batch', data: { subscribed: ['blocks'] } })).toBe(true);
    expect(isServerEvent({ type: 'unsubscribed_batch', data: { unsubscribed: ['blocks'] } })).toBe(true);
    expect(isServerEvent({ type: 'modelDownload', data: {} })).toBe(false);
  });

  it('builds common global, wallet, address, and listener channels', () => {
    expect(WebSocketChannels.blocks()).toBe(WEBSOCKET_GLOBAL_CHANNELS.blocks);
    expect(WebSocketChannels.mempool()).toBe(WEBSOCKET_GLOBAL_CHANNELS.mempool);
    expect(WebSocketChannels.syncAll()).toBe(WEBSOCKET_GLOBAL_CHANNELS.syncAll);
    expect(WebSocketChannels.transactionsAll()).toBe(WEBSOCKET_GLOBAL_CHANNELS.transactionsAll);
    expect(WebSocketChannels.logsAll()).toBe(WEBSOCKET_GLOBAL_CHANNELS.logsAll);
    expect(WebSocketChannels.allGlobal()).toEqual([
      'blocks',
      'sync:all',
      'transactions:all',
      'logs:all',
    ]);
    expect(WebSocketChannels.wallet('wallet-1')).toBe('wallet:wallet-1');
    expect(WebSocketChannels.walletEvent('wallet-1', 'transaction')).toBe('wallet:wallet-1:transaction');
    expect(WebSocketChannels.address('addr-1')).toBe('address:addr-1');
    expect(WebSocketChannels.listener('wallet:wallet-1')).toBe('channel:wallet:wallet-1');
  });

  it('classifies wallet channels and event domains', () => {
    expect(isWebSocketWalletChannel('wallet:abc-123')).toBe(true);
    expect(isWebSocketWalletChannel('blocks')).toBe(false);
    expect(getWalletIdFromWebSocketChannel('wallet:abc-123:transaction')).toBe('abc-123');
    expect(getWalletIdFromWebSocketChannel('wallet:abc_123.test')).toBe('abc');
    expect(isWebSocketWalletEventType('transaction')).toBe(true);
    expect(isWebSocketWalletEventType('block')).toBe(false);
    expect(isWebSocketGlobalEventType('mempool')).toBe(true);
    expect(isWebSocketGlobalEventType('sync')).toBe(false);
  });
});
