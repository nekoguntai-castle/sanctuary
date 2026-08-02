import { describe, expect, it, vi } from 'vitest';
import type Redis from 'ioredis';
import { createMembershipBarrier } from '../../../../../src/services/supportPackage/capture/roster';
import {
  armCaptureSession,
  invalidateCaptureSession,
  MAX_CAPTURE_SESSION_MS,
  readCaptureReadiness,
  renewCaptureSession,
  reportCaptureParticipantReady,
  teardownCaptureSession,
  type CaptureOwnerSession,
} from '../../../../../src/services/supportPackage/capture/sessionCoordinator';

function redisClient() {
  return { eval: vi.fn() } as unknown as Pick<Redis, 'eval'>;
}

const membership = createMembershipBarrier(7, ['api', 'notification-worker']);
const ownerSession: CaptureOwnerSession = {
  sessionId: 'session-id',
  generation: 11,
  ownerToken: 'owner-token',
  armedAtMs: 1_000,
  expiresAtMs: 10_000,
  membership,
};

describe('controlled-capture Redis coordinator', () => {
  it('arms from Redis TIME with a generation and owner-token fence', async () => {
    const redis = redisClient();
    vi.mocked(redis.eval).mockResolvedValue(['acquired', '11', '1000', '61000']);

    const result = await armCaptureSession(redis, membership, 60_000);

    expect(result.status).toBe('armed');
    if (result.status !== 'armed') throw new Error('session was not armed');
    expect(result.session).toMatchObject({ generation: 11, armedAtMs: 1_000, expiresAtMs: 61_000 });
    expect(result.session.sessionId).toMatch(/^[a-f0-9-]{36}$/);
    expect(result.session.ownerToken).toMatch(/^[a-f0-9-]{36}$/);
    const [script, keyCount, ...args] = vi.mocked(redis.eval).mock.calls[0];
    expect(script).toContain("redis.call('TIME')");
    expect(script).toContain("redis.call('INCR', KEYS[2])");
    expect(keyCount).toBe(3);
    expect(args).toContain(membership.digest);
    expect(args).toContain('api,notification-worker');
  });

  it('reports busy and fails closed on unavailable or malformed Redis responses', async () => {
    const redis = redisClient();
    vi.mocked(redis.eval)
      .mockResolvedValueOnce(['busy'])
      .mockRejectedValueOnce(new Error('redis unavailable'))
      .mockResolvedValueOnce(['unexpected']);

    await expect(armCaptureSession(redis, membership, 1_000)).resolves.toEqual({ status: 'busy' });
    await expect(armCaptureSession(redis, membership, 1_000)).resolves.toEqual({ status: 'unavailable' });
    await expect(armCaptureSession(redis, membership, 1_000)).resolves.toEqual({ status: 'unavailable' });
  });

  it.each([0, -1, MAX_CAPTURE_SESSION_MS + 1, 1.5])(
    'rejects an invalid or over-15-minute duration (%s)',
    async duration => {
      await expect(armCaptureSession(redisClient(), membership, duration))
        .rejects.toThrow('capture_duration_invalid');
    },
  );

  it('renews only through the owner CAS and preserves the absolute 15-minute cap', async () => {
    const redis = redisClient();
    vi.mocked(redis.eval).mockResolvedValue(['renewed', '42000']);

    await expect(renewCaptureSession(redis, ownerSession, 30_000)).resolves.toEqual({
      status: 'renewed',
      expiresAtMs: 42_000,
    });
    const [script, keyCount, ...args] = vi.mocked(redis.eval).mock.calls[0];
    expect(script).toContain("redis.call('TIME')");
    expect(script).toContain('absoluteDeadline');
    expect(keyCount).toBe(2);
    expect(args).toEqual(expect.arrayContaining([
      ownerSession.sessionId,
      String(ownerSession.generation),
      ownerSession.ownerToken,
      String(MAX_CAPTURE_SESSION_MS),
    ]));
  });

  it.each(['stale', 'invalid', 'expired'] as const)('returns the Redis CAS %s state', async status => {
    const redis = redisClient();
    vi.mocked(redis.eval).mockResolvedValue([status]);
    await expect(renewCaptureSession(redis, ownerSession, 1_000)).resolves.toEqual({ status });
  });

  it('fails closed for malformed and rejected renewal responses', async () => {
    const redis = redisClient();
    vi.mocked(redis.eval)
      .mockResolvedValueOnce(['unexpected'])
      .mockRejectedValueOnce(new Error('redis unavailable'));
    await expect(renewCaptureSession(redis, ownerSession, 1_000)).resolves.toEqual({ status: 'unavailable' });
    await expect(renewCaptureSession(redis, ownerSession, 1_000)).resolves.toEqual({ status: 'unavailable' });
    await expect(renewCaptureSession(redis, ownerSession, 0)).rejects.toThrow('capture_duration_invalid');
  });

  it('accepts participant readiness only through the session and membership barrier', async () => {
    const redis = redisClient();
    vi.mocked(redis.eval).mockResolvedValue(['accepted']);

    await expect(reportCaptureParticipantReady(
      redis,
      ownerSession,
      'notification-worker',
      membership,
    )).resolves.toBe('accepted');

    const [script, keyCount, ...args] = vi.mocked(redis.eval).mock.calls[0];
    expect(script).toContain("redis.call('TIME')");
    expect(script).toContain("'membership_mismatch'");
    expect(keyCount).toBe(2);
    expect(args.slice(2)).toEqual([
      ownerSession.sessionId,
      String(ownerSession.generation),
      'notification-worker',
      String(membership.generation),
      membership.digest,
    ]);
  });

  it.each(['stale', 'expired', 'invalid'] as const)('returns participant report state %s', async status => {
    const redis = redisClient();
    vi.mocked(redis.eval).mockResolvedValue([status]);
    await expect(reportCaptureParticipantReady(redis, ownerSession, 'api', membership)).resolves.toBe(status);
  });

  it('fails closed for malformed and rejected participant reports', async () => {
    const redis = redisClient();
    vi.mocked(redis.eval)
      .mockResolvedValueOnce(['unexpected'])
      .mockRejectedValueOnce(new Error('redis unavailable'));
    await expect(reportCaptureParticipantReady(redis, ownerSession, 'api', membership)).resolves.toBe('unavailable');
    await expect(reportCaptureParticipantReady(redis, ownerSession, 'api', membership)).resolves.toBe('unavailable');
  });

  it('derives partial and ready states without exposing owner credentials', async () => {
    const redis = redisClient();
    vi.mocked(redis.eval)
      .mockResolvedValueOnce([
        'active', 'session-id', '11', '1000', '61000', '7', membership.digest,
        'api,notification-worker', '', 'api',
      ])
      .mockResolvedValueOnce([
        'active', 'session-id', '11', '1000', '61000', '7', membership.digest,
        'api,notification-worker', '', 'api', 'notification-worker',
      ]);

    await expect(readCaptureReadiness(redis, membership)).resolves.toEqual({
      status: 'partial',
      session: { sessionId: 'session-id', generation: 11 },
      expiresAtMs: 61_000,
      missingParticipants: ['notification-worker'],
    });
    const ready = await readCaptureReadiness(redis, membership);
    expect(ready).toEqual({
      status: 'ready',
      session: { sessionId: 'session-id', generation: 11 },
      expiresAtMs: 61_000,
    });
    expect(JSON.stringify(ready)).not.toContain('owner-token');
  });

  it('classifies missing, expired, invalidated, and mismatched membership as invalid', async () => {
    const redis = redisClient();
    const differentMembership = createMembershipBarrier(8, ['api', 'notification-worker']);
    vi.mocked(redis.eval)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(['expired'])
      .mockResolvedValueOnce([
        'active', 'session-id', '11', '1000', '61000', '7', membership.digest,
        'api,notification-worker', 'operator_cancelled',
      ])
      .mockResolvedValueOnce([
        'active', 'session-id', '11', '1000', '61000', '7', membership.digest,
        'api,notification-worker', '',
      ]);

    await expect(readCaptureReadiness(redis, membership)).resolves.toEqual({ status: 'invalid', reason: 'session_missing' });
    await expect(readCaptureReadiness(redis, membership)).resolves.toEqual({ status: 'invalid', reason: 'expired' });
    await expect(readCaptureReadiness(redis, membership)).resolves.toEqual({ status: 'invalid', reason: 'invalidated' });
    await expect(readCaptureReadiness(redis, differentMembership)).resolves.toEqual({ status: 'invalid', reason: 'membership_mismatch' });
  });

  it('rejects malformed readiness, unexpected participants, and Redis failures', async () => {
    const redis = redisClient();
    vi.mocked(redis.eval)
      .mockResolvedValueOnce(['malformed'])
      .mockResolvedValueOnce([
        'active', 'session-id', '11', '1000', '61000', '7', membership.digest,
        'api,notification-worker', '', 'api', 'notification-worker', 'intruder',
      ])
      .mockRejectedValueOnce(new Error('redis unavailable'));
    await expect(readCaptureReadiness(redis, membership)).resolves.toEqual({ status: 'invalid', reason: 'session_missing' });
    await expect(readCaptureReadiness(redis, membership)).resolves.toEqual({ status: 'invalid', reason: 'membership_mismatch' });
    await expect(readCaptureReadiness(redis, membership)).resolves.toEqual({ status: 'unavailable' });
  });

  it('invalidates and tears down only through owner-token CAS', async () => {
    const redis = redisClient();
    vi.mocked(redis.eval).mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(invalidateCaptureSession(redis, ownerSession, 'operator_cancelled')).resolves.toBe(true);
    await expect(teardownCaptureSession(redis, ownerSession)).resolves.toBe(false);
    const calls = vi.mocked(redis.eval).mock.calls;
    expect(calls[0]).toEqual(expect.arrayContaining([ownerSession.ownerToken, 'operator_cancelled']));
    expect(calls[1]).toEqual(expect.arrayContaining([ownerSession.ownerToken]));
    expect(String(calls[0][0])).toContain('controlled-capture:invalidate');
    expect(String(calls[1][0])).toContain('controlled-capture:teardown');
  });

  it('fails closed when invalidation or teardown cannot reach Redis', async () => {
    const redis = redisClient();
    vi.mocked(redis.eval).mockRejectedValue(new Error('redis unavailable'));
    await expect(invalidateCaptureSession(redis, ownerSession, 'transport_failed')).resolves.toBe(false);
    await expect(teardownCaptureSession(redis, ownerSession)).resolves.toBe(false);
  });
});
