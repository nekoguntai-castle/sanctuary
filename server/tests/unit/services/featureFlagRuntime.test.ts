import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const values = new Map<string, string>();
  const redis = {
    set: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
      return 'OK';
    }),
    keys: vi.fn(async (pattern: string) => {
      const prefix = pattern.slice(0, -1);
      return [...values.keys()].filter((key) => key.startsWith(prefix));
    }),
    mget: vi.fn(async (keys: string[]) => keys.map((key) => values.get(key) ?? null)),
  };
  return {
    values,
    redis,
    redisClient: redis as typeof redis | null,
  };
});

vi.mock('../../../src/infrastructure', () => ({
  getRedisClient: () => mocks.redisClient,
}));

import {
  FeatureRuntimeParticipants,
  type FeatureRuntimeSnapshot,
} from '../../../src/services/featureFlagRuntime';

describe('FeatureRuntimeParticipants', () => {
  const snapshot: FeatureRuntimeSnapshot = {
    generation: '42',
    digest: 'digest-42',
    flags: { treasuryAutopilot: false },
  };

  beforeEach(() => {
    mocks.values.clear();
    vi.clearAllMocks();
    mocks.redisClient = mocks.redis;
  });

  it('freezes every live backend and worker identity and requires exact acknowledgements', async () => {
    const participants = [
      new FeatureRuntimeParticipants('backend', 'backend-a'),
      new FeatureRuntimeParticipants('backend', 'backend-b'),
      new FeatureRuntimeParticipants('worker', 'worker-a'),
      new FeatureRuntimeParticipants('worker', 'worker-b'),
    ];
    await Promise.all(participants.map((participant) => participant.heartbeat()));
    const roster = await participants[0].freezeLiveRoster();

    expect(roster).toEqual(['backend-a', 'backend-b', 'worker-a', 'worker-b']);
    await participants[0].acknowledge(snapshot);
    await participants[1].acknowledge(snapshot);
    await participants[2].acknowledge(snapshot);
    await participants[3].acknowledge({ ...snapshot, digest: 'wrong-digest' });

    await expect(participants[0].waitForAcknowledgements(snapshot, roster, 0))
      .rejects.toThrow('worker-b');

    await participants[3].acknowledge(snapshot);
    await expect(participants[0].waitForAcknowledgements(snapshot, roster, 0))
      .resolves.toBeUndefined();
  });

  it('keeps a missing participant pending instead of accepting a partial barrier', async () => {
    const coordinator = new FeatureRuntimeParticipants('backend', 'backend-a');
    await coordinator.heartbeat();

    await expect(coordinator.waitForAcknowledgements(
      snapshot,
      ['backend-a', 'worker-missing'],
      0,
    )).rejects.toThrow('backend-a, worker-missing');
  });

  it('accepts an empty frozen roster without making acknowledgement reads', async () => {
    const coordinator = new FeatureRuntimeParticipants('backend', 'backend-a');

    await expect(coordinator.waitForAcknowledgements(snapshot, [], 0)).resolves.toBeUndefined();

    expect(mocks.redis.mget).not.toHaveBeenCalled();
  });

  it('fails closed when runtime coordination has no Redis client', async () => {
    mocks.redisClient = null;
    const coordinator = new FeatureRuntimeParticipants('backend', 'backend-a');

    await expect(coordinator.heartbeat())
      .rejects.toThrow('Redis is unavailable for feature runtime coordination');
  });
});
