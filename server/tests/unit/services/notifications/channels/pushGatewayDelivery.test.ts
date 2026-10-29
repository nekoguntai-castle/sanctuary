/**
 * Non-regression: insight and consolidation pushes in the worker.
 *
 * docker-compose gives APNs/FCM credentials only to the gateway. The worker,
 * which runs the insight and autopilot jobs, has GATEWAY_SECRET and a
 * publish-only Redis bridge but no provider credentials, so the push channel
 * used to report itself disabled and every insight/consolidation push was
 * silently dropped. These tests drive the real push service and channel with
 * no provider env and expect the event to reach the gateway-only Redis channel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayPushEvent } from '../../../../../src/websocket/types';

const mocks = vi.hoisted(() => ({
  findByWalletAccess: vi.fn(),
  filterUserIdsByMobileAction: vi.fn(),
  hasConfiguredProviders: vi.fn(() => false),
  // The worker's bridge is publish-only, so the count is the subscribed API instances.
  publishGatewayEvent: vi.fn(async (_event: GatewayPushEvent) => 1),
  publishBroadcast: vi.fn(),
  isActive: vi.fn(() => true),
  recordNotificationTelemetry: vi.fn(),
  gatewayServer: null as null | { forwardPushEvent: ReturnType<typeof vi.fn> },
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../../../src/repositories', () => ({
  pushDeviceRepository: {},
  walletRepository: {},
  userRepository: { findByWalletAccess: mocks.findByWalletAccess },
  agentRepository: { findActiveAgentsByOperationalWalletId: vi.fn(async () => []) },
}));
vi.mock('../../../../../src/services/mobilePermissions', () => ({
  mobilePermissionService: { filterUserIdsByMobileAction: mocks.filterUserIdsByMobileAction },
}));
vi.mock('../../../../../src/services/deadLetterQueue', () => ({ recordPushFailure: vi.fn() }));
vi.mock('../../../../../src/services/push/providers', () => ({
  createPushProviderRegistry: vi.fn(() => ({})),
  initializePushProviders: vi.fn(),
  getProviderForPlatform: vi.fn(),
  hasConfiguredProviders: mocks.hasConfiguredProviders,
}));
vi.mock('../../../../../src/services/notifications/telemetry', () => ({
  recordNotificationTelemetry: mocks.recordNotificationTelemetry,
}));
vi.mock('../../../../../src/utils/logger', () => ({ createLogger: () => mocks.log }));
vi.mock('../../../../../src/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/config')>();
  return { ...actual, default: { ...actual.default, gatewaySecret: 'gateway-secret' } };
});
vi.mock('../../../../../src/websocket/redisBridge', () => ({
  redisBridge: {
    isActive: mocks.isActive,
    publishGatewayEvent: mocks.publishGatewayEvent,
    publishBroadcast: mocks.publishBroadcast,
  },
}));
// The worker never initializes WebSocket servers; the API topology sets one.
vi.mock('../../../../../src/websocket/server', () => ({
  getGatewayWebSocketServer: () => mocks.gatewayServer,
  getWebSocketServerIfInitialized: () => null,
  getWebSocketServer: () => {
    throw new Error('WebSocket server not initialized');
  },
}));

import { NotificationChannelRegistry } from '../../../../../src/services/notifications/channels/registry';
import { pushChannelHandler } from '../../../../../src/services/notifications/channels/push';
import { getPushService } from '../../../../../src/services/push/pushService';
import type { NotificationResult } from '../../../../../src/services/notifications/channels/types';

const PROVIDER_ENV = [
  'APNS_KEY_ID',
  'APNS_TEAM_ID',
  'APNS_KEY_PATH',
  'APNS_BUNDLE_ID',
  'FCM_SERVICE_ACCOUNT',
] as const;

const insight = {
  id: 'insight-1',
  type: 'utxo_health',
  severity: 'warning',
  title: 'Dust is piling up',
  summary: 'SECRET-AI-SUMMARY 12 UTXOs worth 0.5 BTC',
  walletName: 'Treasury',
};

const suggestion = {
  walletId: 'w1',
  walletName: 'Treasury',
  feeRate: 3,
  utxoHealth: { totalUtxos: 40, dustCount: 7, dustValue: 1_234n, totalValue: 9_999_999n },
  estimatedSavings: '4321 sats',
  reason: 'Fees are low',
};

function eligibleUser(id: string, pushDevices: number) {
  return {
    id,
    _count: { pushDevices },
    preferences: {
      intelligence: { wallets: { w1: { enabled: true, notifyPush: true } } },
      autopilot: { wallets: { w1: { enabled: true, notifyPush: true } } },
    },
  };
}

function makeRegistry(): NotificationChannelRegistry {
  const registry = new NotificationChannelRegistry();
  registry.register(pushChannelHandler);
  return registry;
}

/** The analysis service marks an insight notified only on this predicate. */
function wouldMarkNotified(results: NotificationResult[]): boolean {
  return results.some((r) => r.success && r.usersNotified > 0);
}

function setApnsCredentials(): void {
  Object.assign(process.env, {
    APNS_KEY_ID: 'k', APNS_TEAM_ID: 't', APNS_KEY_PATH: '/nonexistent.p8', APNS_BUNDLE_ID: 'b',
  });
}

describe('push channel delivers wallet-level pushes through the gateway (worker mode)', () => {
  const savedEnv: Partial<Record<(typeof PROVIDER_ENV)[number], string>> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isActive.mockReturnValue(true);
    mocks.hasConfiguredProviders.mockReturnValue(false);
    mocks.publishGatewayEvent.mockResolvedValue(1);
    mocks.gatewayServer = null;
    for (const key of PROVIDER_ENV) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    mocks.findByWalletAccess.mockResolvedValue([
      eligibleUser('u1', 1),
      eligibleUser('no-device', 0),
    ]);
    mocks.filterUserIdsByMobileAction.mockImplementation(
      async (_walletId: string, ids: string[]) => ids,
    );
  });

  afterEach(() => {
    for (const key of PROVIDER_ENV) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('publishes a minimal ai_insight gateway event for eligible users', async () => {
    const [result] = await makeRegistry().notifyInsight('w1', insight);

    expect(result).toMatchObject({
      channelId: 'push', success: true, usersNotified: 1, outcome: 'ambiguous',
    });
    expect(mocks.publishGatewayEvent).toHaveBeenCalledTimes(1);
    const event = mocks.publishGatewayEvent.mock.calls[0][0];
    expect(event).toEqual({
      type: 'ai_insight',
      walletId: 'w1',
      walletName: 'Treasury',
      userIds: ['u1'],
      data: {
        insightId: 'insight-1',
        insightType: 'utxo_health',
        insightTypeLabel: 'UTXO Health',
        severity: 'warning',
      },
    });
    expect(JSON.stringify(event)).not.toContain('SECRET-AI-SUMMARY');
    expect(mocks.publishBroadcast).not.toHaveBeenCalled();
  });

  it('publishes a minimal consolidation_suggestion gateway event for eligible users', async () => {
    const [result] = await makeRegistry().notifyConsolidationSuggestion('w1', suggestion);

    expect(result).toMatchObject({
      channelId: 'push', success: true, usersNotified: 1, outcome: 'ambiguous',
    });
    expect(mocks.publishGatewayEvent).toHaveBeenCalledTimes(1);
    const event = mocks.publishGatewayEvent.mock.calls[0][0];
    expect(event).toEqual({
      type: 'consolidation_suggestion',
      walletId: 'w1',
      walletName: 'Treasury',
      userIds: ['u1'],
      data: { feeRate: 3 },
    });
    expect(JSON.stringify(event)).not.toMatch(/4321|9999999|1234/);
    expect(mocks.publishBroadcast).not.toHaveBeenCalled();
  });

  it('publishes nothing and reports no recipients when no user is eligible', async () => {
    mocks.findByWalletAccess.mockResolvedValue([
      { ...eligibleUser('opted-out', 1), preferences: { intelligence: { wallets: { w1: { enabled: false } } } } },
    ]);

    const [result] = await makeRegistry().notifyInsight('w1', insight);

    expect(result).toEqual({
      success: true, channelId: 'push', usersNotified: 0, outcome: 'no_recipients', failureClass: 'none',
    });
    expect(mocks.publishGatewayEvent).not.toHaveBeenCalled();
  });

  it('honours the mobile viewTransactions cap when resolving the audience', async () => {
    mocks.findByWalletAccess.mockResolvedValue([eligibleUser('u1', 1), eligibleUser('balance-only', 1)]);
    mocks.filterUserIdsByMobileAction.mockResolvedValue(['u1']);

    await makeRegistry().notifyConsolidationSuggestion('w1', suggestion);

    expect(mocks.filterUserIdsByMobileAction).toHaveBeenCalledWith('w1', ['u1', 'balance-only'], 'viewTransactions');
    expect(mocks.publishGatewayEvent.mock.calls[0][0].userIds).toEqual(['u1']);
  });

  it('reports and logs an audience lookup failure as unrecorded and publishes nothing', async () => {
    mocks.findByWalletAccess.mockRejectedValue(new Error('db down'));

    const [result] = await makeRegistry().notifyInsight('w1', insight);

    expect(result).toMatchObject({
      success: false, channelId: 'push', usersNotified: 0, errors: ['db down'], recorded: false,
    });
    expect(mocks.publishGatewayEvent).not.toHaveBeenCalled();
    expect(mocks.log.error).toHaveBeenCalledWith(
      expect.any(String),
      { walletId: 'w1', error: 'db down' },
    );
  });

  it('stays disabled without credentials when there is no path to a gateway', async () => {
    mocks.isActive.mockReturnValue(false);

    const [result] = await makeRegistry().notifyInsight('w1', insight);

    expect(result).toEqual({ success: true, channelId: 'push', usersNotified: 0 });
    expect(mocks.findByWalletAccess).not.toHaveBeenCalled();
    expect(mocks.publishGatewayEvent).not.toHaveBeenCalled();
  });

  it('sends directly with local credentials when there is no path to a gateway', async () => {
    mocks.isActive.mockReturnValue(false);
    mocks.hasConfiguredProviders.mockReturnValue(true);
    setApnsCredentials();
    const sendToUser = vi.spyOn(getPushService(), 'sendToUser').mockResolvedValue(undefined);

    const [result] = await makeRegistry().notifyConsolidationSuggestion('w1', suggestion);

    expect(result).toEqual({
      success: true, channelId: 'push', usersNotified: 1, outcome: 'ambiguous', failureClass: 'unknown',
    });
    expect(sendToUser).toHaveBeenCalledTimes(1);
    expect(mocks.publishGatewayEvent).not.toHaveBeenCalled();
    sendToUser.mockRestore();
  });

  it('uses the gateway instead of direct sends when credentials are also present (never both)', async () => {
    mocks.hasConfiguredProviders.mockReturnValue(true);
    setApnsCredentials();
    const sendToUser = vi.spyOn(getPushService(), 'sendToUser');

    const [result] = await makeRegistry().notifyConsolidationSuggestion('w1', suggestion);

    expect(result).toMatchObject({ success: true, usersNotified: 1 });
    expect(mocks.publishGatewayEvent).toHaveBeenCalledTimes(1);
    expect(sendToUser).not.toHaveBeenCalled();
    sendToUser.mockRestore();
  });

  it('reports a rejected publish as a failure and leaves the insight unmarked', async () => {
    mocks.publishGatewayEvent.mockRejectedValue(new Error('redis down'));

    const results = await makeRegistry().notifyInsight('w1', insight);

    expect(results[0]).toMatchObject({
      success: false, channelId: 'push', usersNotified: 0, errors: ['redis down'], recorded: false,
    });
    expect(wouldMarkNotified(results)).toBe(false);
  });

  it('reports no recipients when no API instance is subscribed (worker, publish count 0)', async () => {
    mocks.publishGatewayEvent.mockResolvedValue(0);

    const results = await makeRegistry().notifyInsight('w1', insight);

    expect(results[0]).toEqual({
      success: true, channelId: 'push', usersNotified: 0, outcome: 'no_recipients', failureClass: 'none',
    });
    expect(mocks.publishGatewayEvent).toHaveBeenCalledTimes(1);
    expect(wouldMarkNotified(results)).toBe(false);
  });

  it('reports no recipients on an API whose only subscriber is itself and whose gateway is not connected', async () => {
    // The bridge subtracts this API's own subscriber from PUBLISH's count of 1.
    mocks.publishGatewayEvent.mockResolvedValue(0);
    // forwardPushEvent reports false: this API holds a gateway server with no gateway connected.
    mocks.gatewayServer = { forwardPushEvent: vi.fn(() => false) };

    const results = await makeRegistry().notifyConsolidationSuggestion('w1', suggestion);

    expect(results[0]).toEqual({
      success: true, channelId: 'push', usersNotified: 0, outcome: 'no_recipients', failureClass: 'none',
    });
    expect(mocks.gatewayServer.forwardPushEvent).toHaveBeenCalledTimes(1);
  });

  it('leaves transaction pushes to the broadcast path and records no push telemetry', async () => {
    const [result] = await makeRegistry().notifyTransactions(
      'w1',
      [{ txid: 'a'.repeat(64), type: 'received', amount: 1_000n }],
      { executionPath: 'queued' },
    );

    expect(result).toEqual({
      success: true, channelId: 'push', usersNotified: 0, outcome: 'no_recipients', failureClass: 'none',
    });
    expect(mocks.findByWalletAccess).not.toHaveBeenCalled();
    expect(mocks.publishGatewayEvent).not.toHaveBeenCalled();
    expect(mocks.recordNotificationTelemetry).not.toHaveBeenCalled();
  });
});
