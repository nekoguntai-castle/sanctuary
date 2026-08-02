import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import type { CaptureMembershipBarrier } from './roster';
import { membershipBarriersEqual } from './roster';

export const MAX_CAPTURE_SESSION_MS = 15 * 60 * 1_000;
const SESSION_KEY = 'sanctuary:diagnostics:controlled-capture:v1:session';
const GENERATION_KEY = 'sanctuary:diagnostics:controlled-capture:v1:generation';
const READY_KEY = 'sanctuary:diagnostics:controlled-capture:v1:ready';

type CaptureRedis = Pick<Redis, 'eval'>;

const ARM_SCRIPT = `
-- controlled-capture:arm
local nowParts = redis.call('TIME')
local now = (tonumber(nowParts[1]) * 1000) + math.floor(tonumber(nowParts[2]) / 1000)
local currentExpiry = tonumber(redis.call('HGET', KEYS[1], 'expiresAtMs') or '0')
if currentExpiry > now and redis.call('HGET', KEYS[1], 'invalidatedReason') == false then
  return {'busy'}
end
local generation = redis.call('INCR', KEYS[2])
local expiresAt = now + tonumber(ARGV[3])
redis.call('DEL', KEYS[1], KEYS[3])
redis.call('HSET', KEYS[1],
  'sessionId', ARGV[1], 'ownerToken', ARGV[2], 'generation', generation,
  'armedAtMs', now, 'expiresAtMs', expiresAt,
  'membershipGeneration', ARGV[4], 'membershipDigest', ARGV[5],
  'expectedParticipants', ARGV[6])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
redis.call('PEXPIRE', KEYS[3], ARGV[3])
return {'acquired', tostring(generation), tostring(now), tostring(expiresAt)}
`;

const RENEW_SCRIPT = `
-- controlled-capture:renew
local nowParts = redis.call('TIME')
local now = (tonumber(nowParts[1]) * 1000) + math.floor(tonumber(nowParts[2]) / 1000)
if redis.call('HGET', KEYS[1], 'sessionId') ~= ARGV[1]
  or redis.call('HGET', KEYS[1], 'generation') ~= ARGV[2]
  or redis.call('HGET', KEYS[1], 'ownerToken') ~= ARGV[3] then
  return {'stale'}
end
if redis.call('HGET', KEYS[1], 'invalidatedReason') ~= false then return {'invalid'} end
local armedAt = tonumber(redis.call('HGET', KEYS[1], 'armedAtMs'))
local currentExpiry = tonumber(redis.call('HGET', KEYS[1], 'expiresAtMs'))
if currentExpiry <= now then return {'expired'} end
local absoluteDeadline = armedAt + tonumber(ARGV[5])
local expiresAt = math.min(now + tonumber(ARGV[4]), absoluteDeadline)
if expiresAt <= now then return {'expired'} end
local ttl = expiresAt - now
redis.call('HSET', KEYS[1], 'expiresAtMs', expiresAt)
redis.call('PEXPIRE', KEYS[1], ttl)
redis.call('PEXPIRE', KEYS[2], ttl)
return {'renewed', tostring(expiresAt)}
`;

const REPORT_READY_SCRIPT = `
-- controlled-capture:report-ready
local nowParts = redis.call('TIME')
local now = (tonumber(nowParts[1]) * 1000) + math.floor(tonumber(nowParts[2]) / 1000)
if redis.call('HGET', KEYS[1], 'sessionId') ~= ARGV[1]
  or redis.call('HGET', KEYS[1], 'generation') ~= ARGV[2] then return {'stale'} end
local expiry = tonumber(redis.call('HGET', KEYS[1], 'expiresAtMs') or '0')
if expiry <= now then return {'expired'} end
if redis.call('HGET', KEYS[1], 'invalidatedReason') ~= false then return {'invalid'} end
local roster = ',' .. (redis.call('HGET', KEYS[1], 'expectedParticipants') or '') .. ','
if redis.call('HGET', KEYS[1], 'membershipGeneration') ~= ARGV[4]
  or redis.call('HGET', KEYS[1], 'membershipDigest') ~= ARGV[5]
  or string.find(roster, ',' .. ARGV[3] .. ',', 1, true) == nil then
  redis.call('HSET', KEYS[1], 'invalidatedReason', 'membership_mismatch')
  redis.call('DEL', KEYS[2])
  return {'invalid'}
end
redis.call('HSET', KEYS[2], ARGV[3], 'ready')
redis.call('PEXPIRE', KEYS[2], expiry - now)
return {'accepted'}
`;

const READ_SCRIPT = `
-- controlled-capture:read
local nowParts = redis.call('TIME')
local now = (tonumber(nowParts[1]) * 1000) + math.floor(tonumber(nowParts[2]) / 1000)
local sessionId = redis.call('HGET', KEYS[1], 'sessionId')
if sessionId == false then return nil end
local expiry = tonumber(redis.call('HGET', KEYS[1], 'expiresAtMs') or '0')
if expiry <= now then return {'expired'} end
return {
  'active', sessionId,
  redis.call('HGET', KEYS[1], 'generation'),
  redis.call('HGET', KEYS[1], 'armedAtMs'),
  tostring(expiry),
  redis.call('HGET', KEYS[1], 'membershipGeneration'),
  redis.call('HGET', KEYS[1], 'membershipDigest'),
  redis.call('HGET', KEYS[1], 'expectedParticipants'),
  redis.call('HGET', KEYS[1], 'invalidatedReason') or '',
  unpack(redis.call('HKEYS', KEYS[2]))
}
`;

const INVALIDATE_SCRIPT = `
-- controlled-capture:invalidate
if redis.call('HGET', KEYS[1], 'sessionId') ~= ARGV[1]
  or redis.call('HGET', KEYS[1], 'generation') ~= ARGV[2]
  or redis.call('HGET', KEYS[1], 'ownerToken') ~= ARGV[3] then return 0 end
redis.call('HSET', KEYS[1], 'invalidatedReason', ARGV[4])
redis.call('DEL', KEYS[2])
return 1
`;

const TEARDOWN_SCRIPT = `
-- controlled-capture:teardown
if redis.call('HGET', KEYS[1], 'sessionId') ~= ARGV[1]
  or redis.call('HGET', KEYS[1], 'generation') ~= ARGV[2]
  or redis.call('HGET', KEYS[1], 'ownerToken') ~= ARGV[3] then return 0 end
redis.call('DEL', KEYS[1], KEYS[2])
return 1
`;

export interface CaptureSessionReference {
  sessionId: string;
  generation: number;
}

export interface CaptureOwnerSession extends CaptureSessionReference {
  ownerToken: string;
  armedAtMs: number;
  expiresAtMs: number;
  membership: CaptureMembershipBarrier;
}

export type CaptureArmResult =
  | { status: 'armed'; session: CaptureOwnerSession }
  | { status: 'busy' }
  | { status: 'unavailable' };

export type CaptureReadiness =
  | { status: 'ready'; session: CaptureSessionReference; expiresAtMs: number }
  | { status: 'partial'; session: CaptureSessionReference; expiresAtMs: number; missingParticipants: string[] }
  | { status: 'invalid'; reason: 'session_missing' | 'expired' | 'invalidated' | 'membership_mismatch' }
  | { status: 'unavailable' };

function redisArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.map(item => String(item));
}

function validDuration(durationMs: number): boolean {
  return Number.isSafeInteger(durationMs) && durationMs > 0 && durationMs <= MAX_CAPTURE_SESSION_MS;
}

export async function armCaptureSession(
  redis: CaptureRedis,
  membership: CaptureMembershipBarrier,
  durationMs: number,
): Promise<CaptureArmResult> {
  if (!validDuration(durationMs)) throw new Error('capture_duration_invalid');
  const sessionId = randomUUID();
  const ownerToken = randomUUID();
  try {
    const result = redisArray(await redis.eval(
      ARM_SCRIPT, 3, SESSION_KEY, GENERATION_KEY, READY_KEY,
      sessionId, ownerToken, String(durationMs), String(membership.generation),
      membership.digest, membership.expectedParticipants.join(','),
    ));
    if (result?.[0] === 'busy') return { status: 'busy' };
    if (result?.[0] !== 'acquired' || result.length < 4) return { status: 'unavailable' };
    return {
      status: 'armed',
      session: {
        sessionId,
        ownerToken,
        generation: Number(result[1]),
        armedAtMs: Number(result[2]),
        expiresAtMs: Number(result[3]),
        membership,
      },
    };
  } catch {
    return { status: 'unavailable' };
  }
}

export async function renewCaptureSession(
  redis: CaptureRedis,
  session: CaptureOwnerSession,
  durationMs: number,
): Promise<{ status: 'renewed'; expiresAtMs: number } | { status: 'stale' | 'invalid' | 'expired' | 'unavailable' }> {
  if (!validDuration(durationMs)) throw new Error('capture_duration_invalid');
  try {
    const result = redisArray(await redis.eval(
      RENEW_SCRIPT, 2, SESSION_KEY, READY_KEY, session.sessionId,
      String(session.generation), session.ownerToken, String(durationMs),
      String(MAX_CAPTURE_SESSION_MS),
    ));
    if (result?.[0] === 'renewed' && result[1]) {
      return { status: 'renewed', expiresAtMs: Number(result[1]) };
    }
    if (result?.[0] === 'stale' || result?.[0] === 'invalid' || result?.[0] === 'expired') {
      return { status: result[0] };
    }
    return { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
}

export async function reportCaptureParticipantReady(
  redis: CaptureRedis,
  session: CaptureSessionReference,
  participantId: string,
  observedMembership: Pick<CaptureMembershipBarrier, 'generation' | 'digest'>,
): Promise<'accepted' | 'stale' | 'expired' | 'invalid' | 'unavailable'> {
  try {
    const result = redisArray(await redis.eval(
      REPORT_READY_SCRIPT, 2, SESSION_KEY, READY_KEY, session.sessionId,
      String(session.generation), participantId, String(observedMembership.generation),
      observedMembership.digest,
    ));
    const status = result?.[0];
    if (status === 'accepted' || status === 'stale' || status === 'expired' || status === 'invalid') return status;
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export async function readCaptureReadiness(
  redis: CaptureRedis,
  expectedMembership: CaptureMembershipBarrier,
): Promise<CaptureReadiness> {
  let result: string[] | null;
  try {
    result = redisArray(await redis.eval(READ_SCRIPT, 2, SESSION_KEY, READY_KEY));
  } catch {
    return { status: 'unavailable' };
  }
  if (!result) return { status: 'invalid', reason: 'session_missing' };
  if (result[0] === 'expired') return { status: 'invalid', reason: 'expired' };
  if (result[0] !== 'active' || result.length < 9) return { status: 'invalid', reason: 'session_missing' };

  const persistedMembership = {
    generation: Number(result[5]),
    digest: result[6],
  };
  if (!membershipBarriersEqual(expectedMembership, persistedMembership)) {
    return { status: 'invalid', reason: 'membership_mismatch' };
  }
  if (result[8]) return { status: 'invalid', reason: 'invalidated' };

  const expected = result[7].split(',').filter(Boolean);
  const ready = new Set(result.slice(9));
  if (ready.size > expected.length || [...ready].some(id => !expected.includes(id))) {
    return { status: 'invalid', reason: 'membership_mismatch' };
  }
  const missingParticipants = expected.filter(id => !ready.has(id));
  const state = {
    session: { sessionId: result[1], generation: Number(result[2]) },
    expiresAtMs: Number(result[4]),
  };
  return missingParticipants.length === 0
    ? { status: 'ready', ...state }
    : { status: 'partial', ...state, missingParticipants };
}

export async function invalidateCaptureSession(
  redis: CaptureRedis,
  session: CaptureOwnerSession,
  reason: 'operator_cancelled' | 'membership_changed' | 'transport_failed',
): Promise<boolean> {
  try {
    return await redis.eval(
      INVALIDATE_SCRIPT, 2, SESSION_KEY, READY_KEY, session.sessionId,
      String(session.generation), session.ownerToken, reason,
    ) === 1;
  } catch {
    return false;
  }
}

export async function teardownCaptureSession(
  redis: CaptureRedis,
  session: CaptureOwnerSession,
): Promise<boolean> {
  try {
    return await redis.eval(
      TEARDOWN_SCRIPT, 2, SESSION_KEY, READY_KEY, session.sessionId,
      String(session.generation), session.ownerToken,
    ) === 1;
  } catch {
    return false;
  }
}
