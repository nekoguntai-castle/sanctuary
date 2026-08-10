import os from 'node:os';
import { getRedisClient } from '../infrastructure';
import { safeJsonParseUntyped } from '../utils/safeJson';

export type FeatureRuntimeRole = 'backend' | 'worker';

export interface FeatureRuntimeSnapshot {
  generation: string;
  digest: string;
  flags: Record<string, boolean>;
}

interface ParticipantRecord {
  role: FeatureRuntimeRole;
  heartbeatAt: number;
}

const PARTICIPANT_PREFIX = 'feature-runtime:participant:';
const ACK_PREFIX = 'feature-runtime:ack:';
const HEARTBEAT_TTL_SECONDS = 15;
const ACK_TTL_SECONDS = 60;
export const FEATURE_RUNTIME_HEARTBEAT_INTERVAL_MS = 5_000;
export const FEATURE_RUNTIME_POLL_INTERVAL_MS = 5_000;
export const FEATURE_RUNTIME_ACK_TIMEOUT_MS = 5_000;

export class FeatureRuntimeParticipants {
  readonly participantId: string;

  constructor(readonly role: FeatureRuntimeRole, participantId?: string) {
    this.participantId = participantId ?? `${role}:${os.hostname()}:${process.pid}`;
  }

  async heartbeat(): Promise<void> {
    const redis = requireRedis();
    const record: ParticipantRecord = { role: this.role, heartbeatAt: Date.now() };
    await redis.set(
      `${PARTICIPANT_PREFIX}${this.participantId}`,
      JSON.stringify(record),
      'EX',
      HEARTBEAT_TTL_SECONDS,
    );
  }

  async acknowledge(snapshot: FeatureRuntimeSnapshot): Promise<void> {
    const redis = requireRedis();
    await redis.set(
      `${ACK_PREFIX}${this.participantId}`,
      JSON.stringify({ generation: snapshot.generation, digest: snapshot.digest }),
      'EX',
      ACK_TTL_SECONDS,
    );
  }

  async freezeLiveRoster(): Promise<string[]> {
    const redis = requireRedis();
    return (await redis.keys(`${PARTICIPANT_PREFIX}*`))
      .map((key) => key.slice(PARTICIPANT_PREFIX.length))
      .sort();
  }

  async waitForAcknowledgements(
    snapshot: FeatureRuntimeSnapshot,
    roster: readonly string[],
    timeoutMs = FEATURE_RUNTIME_ACK_TIMEOUT_MS,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const missing = await this.findMissingAcknowledgements(snapshot, roster);
      if (missing.length === 0) return;
      await new Promise((resolve) => setTimeout(resolve, Math.min(100, timeoutMs)));
    }
    const missing = await this.findMissingAcknowledgements(snapshot, roster);
    throw new Error(`Feature runtime acknowledgement pending for: ${missing.join(', ')}`);
  }

  private async findMissingAcknowledgements(
    snapshot: FeatureRuntimeSnapshot,
    roster: readonly string[],
  ): Promise<string[]> {
    if (roster.length === 0) return [];
    const redis = requireRedis();
    const values = await redis.mget(roster.map((id) => `${ACK_PREFIX}${id}`));
    return roster.filter((_, index) => {
      const ack = safeJsonParseUntyped<{ generation?: string; digest?: string } | null>(
        values[index] ?? '',
        null,
        'feature-runtime-ack',
      );
      return ack?.generation !== snapshot.generation || ack.digest !== snapshot.digest;
    });
  }
}

function requireRedis() {
  const redis = getRedisClient();
  if (!redis) throw new Error('Redis is unavailable for feature runtime coordination');
  return redis;
}
