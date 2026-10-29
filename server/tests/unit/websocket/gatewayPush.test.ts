import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockGatewayServer = {
  forwardPushEvent: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
  config: { gatewaySecret: 'gateway-secret' },
  isActive: vi.fn(() => false),
  publishGatewayEvent: vi.fn(async () => 0),
  gatewayServer: null as null | MockGatewayServer,
}));

vi.mock('../../../src/config', () => ({ __esModule: true, default: mocks.config }));
vi.mock('../../../src/websocket/redisBridge', () => ({
  redisBridge: { isActive: mocks.isActive, publishGatewayEvent: mocks.publishGatewayEvent },
}));
vi.mock('../../../src/websocket/server', () => ({
  getGatewayWebSocketServer: () => mocks.gatewayServer,
}));

import {
  dispatchGatewayPushEvent,
  forwardToGateway,
  isGatewayPushDeliveryAvailable,
} from '../../../src/websocket/gatewayPush';
import type { GatewayPushEvent } from '../../../src/websocket/types';

const event: GatewayPushEvent = {
  type: 'consolidation_suggestion',
  walletId: 'w1',
  walletName: 'Treasury',
  userIds: ['u1'],
  data: { feeRate: 2 },
};

/** A held gateway server; `forwardPushEvent` reports whether a gateway was connected. */
function gatewayServer(connected: boolean): MockGatewayServer {
  return { forwardPushEvent: vi.fn(() => connected) };
}

describe('gateway push delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.config.gatewaySecret = 'gateway-secret';
    mocks.isActive.mockReturnValue(false);
    mocks.publishGatewayEvent.mockResolvedValue(0);
    mocks.gatewayServer = null;
  });

  describe('isGatewayPushDeliveryAvailable', () => {
    it('requires a gateway secret', () => {
      mocks.config.gatewaySecret = '';
      mocks.isActive.mockReturnValue(true);
      mocks.gatewayServer = gatewayServer(true);
      expect(isGatewayPushDeliveryAvailable()).toBe(false);
    });

    it('is available through an active Redis bridge (the worker)', () => {
      mocks.isActive.mockReturnValue(true);
      expect(isGatewayPushDeliveryAvailable()).toBe(true);
    });

    it('is available through an in-process gateway server (single API instance without Redis)', () => {
      mocks.gatewayServer = gatewayServer(false);
      expect(isGatewayPushDeliveryAvailable()).toBe(true);
    });

    it('is available with both paths and unavailable with neither', () => {
      expect(isGatewayPushDeliveryAvailable()).toBe(false);
      mocks.isActive.mockReturnValue(true);
      mocks.gatewayServer = gatewayServer(true);
      expect(isGatewayPushDeliveryAvailable()).toBe(true);
    });
  });

  describe('dispatchGatewayPushEvent', () => {
    it('is delivered by an in-process send to a connected gateway with no external receivers', async () => {
      mocks.gatewayServer = gatewayServer(true);

      await expect(dispatchGatewayPushEvent(event)).resolves.toEqual({ delivered: true });

      expect(mocks.gatewayServer.forwardPushEvent).toHaveBeenCalledWith(event);
      expect(mocks.publishGatewayEvent).toHaveBeenCalledWith(event);
    });

    it('stays delivered when the publish rejects after an in-process send', async () => {
      mocks.gatewayServer = gatewayServer(true);
      mocks.publishGatewayEvent.mockRejectedValue(new Error('redis down'));

      await expect(dispatchGatewayPushEvent(event)).resolves.toEqual({ delivered: true });
    });

    it('is not delivered when the held gateway server has no connected gateway and nobody else listens', async () => {
      mocks.gatewayServer = gatewayServer(false);

      await expect(dispatchGatewayPushEvent(event)).resolves.toEqual({ delivered: false });

      expect(mocks.gatewayServer.forwardPushEvent).toHaveBeenCalledWith(event);
      expect(mocks.publishGatewayEvent).toHaveBeenCalledWith(event);
    });

    it('is delivered by publishing to at least one other instance (the worker)', async () => {
      mocks.publishGatewayEvent.mockResolvedValue(1);

      await expect(dispatchGatewayPushEvent(event)).resolves.toEqual({ delivered: true });
    });

    it('is not delivered when no other instance receives the publish', async () => {
      await expect(dispatchGatewayPushEvent(event)).resolves.toEqual({ delivered: false });
    });

    it('reports a rejected publish when there was no in-process send', async () => {
      mocks.publishGatewayEvent.mockRejectedValue(new Error('redis down'));

      await expect(dispatchGatewayPushEvent(event)).resolves.toEqual({
        delivered: false,
        error: 'redis down',
      });
    });

  });

  describe('forwardToGateway', () => {
    it('reports false without a gateway server in this process', () => {
      expect(forwardToGateway(event)).toBe(false);
    });

    it('reports whether the held gateway server took the event', () => {
      mocks.gatewayServer = gatewayServer(false);
      expect(forwardToGateway(event)).toBe(false);
      mocks.gatewayServer = gatewayServer(true);
      expect(forwardToGateway(event)).toBe(true);
      expect(mocks.gatewayServer.forwardPushEvent).toHaveBeenCalledWith(event);
    });
  });
});
