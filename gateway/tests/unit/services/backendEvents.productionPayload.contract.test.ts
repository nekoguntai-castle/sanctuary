import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class MockWebSocketServer {
    on = vi.fn();
    close = vi.fn();
  }

  return {
    MockWebSocketServer,
    findAudience: vi.fn(),
    getDevicesForUser: vi.fn(),
    removeInvalidDevice: vi.fn(),
    sendToDevices: vi.fn(),
    formatTransactionNotification: vi.fn((type, walletName, amount, txid) => ({
      title: `${type}:${walletName}`,
      body: String(amount),
      data: { txid },
    })),
    localBroadcast: vi.fn(),
    singletonGatewaySend: vi.fn(async () => undefined),
  };
});

vi.mock('ws', () => ({
  WebSocket: { OPEN: 1 },
  WebSocketServer: mocks.MockWebSocketServer,
}));

vi.mock('../../../../server/src/config', () => ({
  __esModule: true,
  default: { gatewaySecret: 'test-secret' },
}));

vi.mock('../../../../server/src/observability/metrics', () => ({
  websocketConnections: { inc: vi.fn(), dec: vi.fn() },
  websocketMessagesTotal: { inc: vi.fn() },
}));

vi.mock('../../../../server/src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../../../server/src/utils/errors', () => ({
  getErrorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
}));

vi.mock('../../../../server/src/repositories/pushAudienceRepository', () => ({
  findGatewayPushAudience: mocks.findAudience,
}));

// The mobile view-cap filter is not under test here: let every candidate through.
vi.mock('../../../../server/src/services/mobilePermissions', () => ({
  mobilePermissionService: {
    filterUserIdsByMobileAction: async (_walletId: string, userIds: string[]) => userIds,
  },
}));

vi.mock('../../../../server/src/websocket/server', () => ({
  getWebSocketServerIfInitialized: () => ({ broadcast: mocks.localBroadcast }),
  getWebSocketServer: () => ({ broadcast: mocks.localBroadcast }),
  getGatewayWebSocketServer: () => ({
    isGatewayConnected: () => true,
    sendEvent: mocks.singletonGatewaySend,
  }),
}));

vi.mock('../../../../server/src/websocket/redisBridge', () => ({
  redisBridge: { publishBroadcast: vi.fn(), isActive: () => true },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../../src/services/backendEvents/deviceTokens', () => ({
  getDevicesForUser: mocks.getDevicesForUser,
  removeInvalidDevice: mocks.removeInvalidDevice,
}));

vi.mock('../../../src/services/push', () => ({
  sendToDevices: mocks.sendToDevices,
  formatTransactionNotification: mocks.formatTransactionNotification,
  formatBroadcastNotification: vi.fn(),
  formatPsbtSigningNotification: vi.fn(),
  formatDraftCreatedNotification: vi.fn(),
  formatDraftApprovedNotification: vi.fn(),
}));

import { GatewayWebSocketServer } from '../../../../server/src/websocket/gatewayServer';
import {
  broadcastConfirmation,
  broadcastTransaction,
} from '../../../../server/src/websocket/broadcast';
import { handleEvent } from '../../../src/services/backendEvents/eventHandler';
import type { BackendEvent } from '../../../src/services/backendEvents/types';

function walletPreferences() {
  return {
    telegram: {
      wallets: {
        'wallet-1': {
          enabled: true,
          notifyReceived: true,
          notifySent: true,
          notifyConsolidation: true,
        },
      },
    },
  };
}

function createConnectedServer() {
  const send = vi.fn();
  const server = new GatewayWebSocketServer();
  (server as unknown as { gateway: unknown }).gateway = {
    isAuthenticated: true,
    readyState: 1,
    send,
  };
  return { server, send };
}

async function readSerializedEvent(
  server: GatewayWebSocketServer,
  send: ReturnType<typeof vi.fn>,
  sourceEvent: Parameters<GatewayWebSocketServer['sendEvent']>[0],
): Promise<BackendEvent> {
  await server.sendEvent(sourceEvent);
  const envelope = JSON.parse(send.mock.calls[0][0]) as { type: string; event: BackendEvent };
  expect(envelope.type).toBe('event');
  return envelope.event;
}

function takeBroadcastGatewayEvent(): Parameters<GatewayWebSocketServer['sendEvent']>[0] {
  expect(mocks.singletonGatewaySend).toHaveBeenCalledTimes(1);
  return mocks.singletonGatewaySend.mock.calls[0][0];
}

describe('production gateway push payload contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDevicesForUser.mockImplementation(async (userId: string) => [{
      id: `device-${userId}`,
      platform: 'android',
      pushToken: `token-${userId}`,
      userId,
    }]);
    mocks.sendToDevices.mockResolvedValue({ success: 2, failed: 0, invalidTokens: [] });
  });

  it('serializes an enriched transaction that the plural gateway consumer delivers', async () => {
    mocks.findAudience.mockResolvedValue({
      walletId: 'wallet-1',
      walletName: 'Treasury',
      transaction: null,
      candidates: [
        { userId: 'user-1', preferences: walletPreferences() },
        { userId: 'user-2', preferences: walletPreferences() },
      ],
    });
    const { server, send } = createConnectedServer();

    broadcastTransaction('wallet-1', {
      txid: 'tx-transaction',
      type: 'received',
      amount: 125_000,
      confirmations: 0,
      timestamp: '2026-09-21T00:00:00.000Z',
    });

    const event = await readSerializedEvent(server, send, takeBroadcastGatewayEvent());

    expect(event).toEqual({
      type: 'transaction',
      walletId: 'wallet-1',
      walletName: 'Treasury',
      userIds: ['user-1', 'user-2'],
      data: {
        txid: 'tx-transaction',
        type: 'received',
        amount: 125_000,
        confirmations: 0,
        timestamp: '2026-09-21T00:00:00.000Z',
        walletId: 'wallet-1',
      },
    });

    await handleEvent(event);
    expect(mocks.getDevicesForUser.mock.calls.map(([userId]) => userId)).toEqual(['user-1', 'user-2']);
    expect(mocks.formatTransactionNotification).toHaveBeenCalledWith(
      'received', 'Treasury', 125_000, 'tx-transaction',
    );
    expect(mocks.sendToDevices).toHaveBeenCalledTimes(1);
  });

  it('preserves the signed amount from a production sent transaction envelope', async () => {
    mocks.findAudience.mockResolvedValue({
      walletId: 'wallet-1',
      walletName: 'Treasury',
      transaction: null,
      candidates: [{ userId: 'user-1', preferences: walletPreferences() }],
    });
    const { server, send } = createConnectedServer();

    broadcastTransaction('wallet-1', {
      txid: 'tx-sent',
      type: 'sent',
      amount: -100_000,
      confirmations: 0,
      timestamp: '2026-09-21T00:00:30.000Z',
    });

    const event = await readSerializedEvent(server, send, takeBroadcastGatewayEvent());
    await handleEvent(event);

    expect(event.data.amount).toBe(-100_000);
    expect(mocks.formatTransactionNotification).toHaveBeenCalledWith(
      'sent', 'Treasury', -100_000, 'tx-sent',
    );
  });

  it('serializes persisted confirmation direction and amount for the plural consumer', async () => {
    mocks.findAudience.mockResolvedValue({
      walletId: 'wallet-1',
      walletName: 'Treasury',
      transaction: { type: 'sent', amount: 275_000n },
      candidates: [
        { userId: 'user-1', preferences: walletPreferences() },
        { userId: 'user-2', preferences: walletPreferences() },
      ],
    });
    const { server, send } = createConnectedServer();

    broadcastConfirmation('wallet-1', {
      txid: 'tx-confirmation',
      confirmations: 1,
      timestamp: '2026-09-21T00:01:00.000Z',
    });

    const event = await readSerializedEvent(server, send, takeBroadcastGatewayEvent());

    expect(event).toEqual({
      type: 'confirmation',
      walletId: 'wallet-1',
      walletName: 'Treasury',
      userIds: ['user-1', 'user-2'],
      data: {
        txid: 'tx-confirmation',
        confirmations: 1,
        timestamp: '2026-09-21T00:01:00.000Z',
        walletId: 'wallet-1',
        type: 'sent',
        amount: 275_000,
      },
    });

    await handleEvent(event);
    expect(mocks.getDevicesForUser.mock.calls.map(([userId]) => userId)).toEqual(['user-1', 'user-2']);
    expect(mocks.formatTransactionNotification).toHaveBeenCalledWith(
      'confirmed', 'Treasury', 275_000, 'tx-confirmation',
    );
    expect(mocks.sendToDevices).toHaveBeenCalledTimes(1);
  });

  // The backend re-reads wallet access and name for gateway-only pushes.
  const walletAccess = (userIds: string[]) => mocks.findAudience.mockResolvedValue({
    walletId: 'wallet-1',
    walletName: 'Treasury',
    transaction: null,
    candidates: userIds.map((userId) => ({ userId, preferences: null })),
  });

  it('delivers a gateway-only ai_insight event with the minimal Treasury Intelligence push', async () => {
    walletAccess(['user-1', 'user-2']);
    const { server, send } = createConnectedServer();

    const event = await readSerializedEvent(server, send, {
      type: 'ai_insight',
      walletId: 'wallet-1',
      walletName: 'Treasury',
      userIds: ['user-1', 'user-2', 'user-1'],
      data: {
        insightId: 'insight-1',
        insightType: 'utxo_health',
        insightTypeLabel: 'UTXO Health',
        severity: 'warning',
      },
    });

    expect(event).toEqual({
      type: 'ai_insight',
      walletId: 'wallet-1',
      walletName: 'Treasury',
      userIds: ['user-1', 'user-2'],
      data: {
        insightId: 'insight-1',
        insightType: 'utxo_health',
        insightTypeLabel: 'UTXO Health',
        severity: 'warning',
      },
    });
    expect(mocks.findAudience).toHaveBeenCalledWith('wallet-1', '');

    await handleEvent(event);
    expect(mocks.getDevicesForUser.mock.calls.map(([userId]) => userId)).toEqual(['user-1', 'user-2']);
    expect(mocks.sendToDevices).toHaveBeenCalledWith(expect.any(Array), {
      title: 'Treasury Intelligence',
      body: 'Treasury: warning UTXO Health insight',
      data: { walletId: 'wallet-1', insightId: 'insight-1', kind: 'ai_insight' },
    });
  });

  it('delivers a gateway-only consolidation_suggestion event with the fee-rate push', async () => {
    walletAccess(['user-1']);
    const { server, send } = createConnectedServer();

    const event = await readSerializedEvent(server, send, {
      type: 'consolidation_suggestion',
      walletId: 'wallet-1',
      walletName: 'Treasury',
      userIds: ['user-1'],
      data: { feeRate: 2 },
    });

    expect(event).toEqual({
      type: 'consolidation_suggestion',
      walletId: 'wallet-1',
      walletName: 'Treasury',
      userIds: ['user-1'],
      data: { feeRate: 2 },
    });

    await handleEvent(event);
    expect(mocks.getDevicesForUser.mock.calls.map(([userId]) => userId)).toEqual(['user-1']);
    expect(mocks.sendToDevices).toHaveBeenCalledWith(expect.any(Array), {
      title: 'Consolidation opportunity',
      body: 'Treasury: fees are low (2 sat/vB)',
      data: { walletId: 'wallet-1', kind: 'consolidation_suggestion' },
    });
  });
});
