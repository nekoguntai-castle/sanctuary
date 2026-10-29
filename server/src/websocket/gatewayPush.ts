/**
 * Gateway push delivery for wallet-level notifications.
 *
 * APNs/FCM credentials live only in the push gateway. Processes without them
 * (the worker, which runs the insight and autopilot jobs) hand a prebuilt,
 * minimal event plus its resolved audience to the gateway instead.
 *
 * Paths:
 * - Redis bridge active: publish on the gateway-only channel. Every API
 *   instance that subscribes forwards it to its gateway connection, if it has
 *   one.
 * - This process holds a connected gateway WebSocket server: also send it
 *   in-process, because a bridge never delivers an instance its own messages.
 *   This branch is not reached in production today (no API code path calls the
 *   insight/consolidation notifiers); it covers the topology where one would.
 *
 * Delivery is reported, not confirmed: an event counts as delivered when it
 * reached a gateway path (an in-process send to a connected gateway, or at
 * least one other subscribed instance). Known limitation: a subscribed API
 * instance with no gateway connected drops the event, as transaction pushes
 * already are.
 */

import config from '../config';
import { getErrorMessage } from '../utils/errors';
import { redisBridge } from './redisBridge';
import { getGatewayWebSocketServer } from './server';
import type { GatewayPushEvent } from './types';

export interface GatewayPushDispatchResult {
  /** The event reached at least one gateway path. */
  delivered: boolean;
  /** Set when the publish failed and no in-process send happened. */
  error?: string;
}

/**
 * Whether this process can hand push events to the gateway: a gateway secret
 * is configured and there is a path to a gateway connection (the Redis bridge
 * or an in-process gateway WebSocket server).
 */
export function isGatewayPushDeliveryAvailable(): boolean {
  if (!config.gatewaySecret) return false;
  return redisBridge.isActive() || getGatewayWebSocketServer() !== null;
}

/** Send to this process's gateway connection; true when one was connected to take it. */
export function forwardToGateway(event: GatewayPushEvent): boolean {
  return getGatewayWebSocketServer()?.forwardPushEvent(event) ?? false;
}

/** Hand a gateway-only push event to every reachable gateway path. */
export async function dispatchGatewayPushEvent(
  event: GatewayPushEvent,
): Promise<GatewayPushDispatchResult> {
  const sentInProcess = forwardToGateway(event);
  try {
    const externalReceivers = await redisBridge.publishGatewayEvent(event);
    return { delivered: sentInProcess || externalReceivers > 0 };
  } catch (error) {
    if (sentInProcess) return { delivered: true };
    return { delivered: false, error: getErrorMessage(error) };
  }
}
