/**
 * Shared record of which API instances currently hold an authenticated push
 * gateway connection.
 *
 * "A gateway is connected" used to exist only in the API process's memory. The
 * worker inferred it from the Redis subscriber count, but the API subscribes
 * whether or not a gateway is attached, so a push published while the gateway
 * was reconnecting was reported as delivered and then dropped.
 *
 * One sorted set: member = API instance id, score = expiry (epoch ms). The
 * holder refreshes its score on every gateway pong, so a crashed API process
 * ages out instead of leaving a stale "connected" record.
 */

import { getRedisClient, isRedisConnected } from '../infrastructure/redis';
import { getErrorMessage } from '../utils/errors';
import { createLogger } from '../utils/logger';
import { redisBridge } from './redisBridge';

const log = createLogger('WS:GATEWAY_PRESENCE');

export const GATEWAY_PRESENCE_KEY = 'sanctuary:ws:gateway:presence';
/** Three heartbeat intervals (30s each): one late pong does not drop the record. */
export const GATEWAY_PRESENCE_TTL_MS = 90_000;

function presenceRedis() {
  return isRedisConnected() ? getRedisClient() : null;
}

/** Record (or refresh) this instance's gateway connection. Never throws. */
export async function markGatewayConnected(): Promise<void> {
  const redis = presenceRedis();
  if (!redis) return;
  try {
    const now = Date.now();
    // One round trip: record this instance, drop records of instances that
    // died without clearing theirs, and let the whole key lapse when no
    // gateway is attached anywhere.
    await redis
      .multi()
      .zadd(GATEWAY_PRESENCE_KEY, now + GATEWAY_PRESENCE_TTL_MS, redisBridge.getInstanceId())
      .zremrangebyscore(GATEWAY_PRESENCE_KEY, '-inf', now)
      .pexpire(GATEWAY_PRESENCE_KEY, GATEWAY_PRESENCE_TTL_MS)
      .exec();
  } catch (error) {
    log.warn('Failed to record gateway presence', { error: getErrorMessage(error) });
  }
}

/** Remove this instance's record when its gateway disconnects. Never throws. */
export async function clearGatewayConnected(): Promise<void> {
  const redis = presenceRedis();
  if (!redis) return;
  try {
    await redis.zrem(GATEWAY_PRESENCE_KEY, redisBridge.getInstanceId());
  } catch (error) {
    log.warn('Failed to clear gateway presence', { error: getErrorMessage(error) });
  }
}

/**
 * Whether any API instance holds a live gateway connection. Rejects when the
 * record cannot be read, so callers report a failure rather than assume
 * delivery. Resolves false without Redis: there is then no cross-process path.
 */
export async function isAnyGatewayConnected(): Promise<boolean> {
  const redis = presenceRedis();
  if (!redis) return false;
  // Expired records are ignored by the score range; the writer prunes them.
  return (await redis.zcount(GATEWAY_PRESENCE_KEY, `(${Date.now()}`, '+inf')) > 0;
}

/**
 * Whether an API instance other than this one holds a live gateway connection.
 *
 * This instance's own record is not counted. It can outlive the connection:
 * when Redis is unreachable as the gateway socket closes, the record is not
 * cleared and stays until it expires. Rejects when the record cannot be read.
 */
export async function isGatewayConnectedElsewhere(): Promise<boolean> {
  const redis = presenceRedis();
  if (!redis) return false;
  const holders = await redis.zrangebyscore(GATEWAY_PRESENCE_KEY, `(${Date.now()}`, '+inf');
  const self = redisBridge.getInstanceId();
  return holders.some((holder) => holder !== self);
}
