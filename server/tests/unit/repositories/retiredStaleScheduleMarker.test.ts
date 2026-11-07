import { describe, expect, it } from 'vitest';
import { WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR } from '../../../src/constants/walletSyncActivation';
import {
  INVALID_RETIRED_STALE_SCHEDULE_MARKER,
  assertRetiredStaleScheduleMarker,
} from '../../../src/repositories/retiredStaleScheduleMarker';

// The exact shape v0.8.67-v0.8.84 binaries parse strictly on rollback.
const marker = {
  version: 1,
  forbiddenAt: '2026-08-22T12:00:00.000Z',
  compatibilityFloor: WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR,
};

describe('retiredStaleScheduleMarker', () => {
  it('accepts the marker shape rollback binaries read', () => {
    expect(() => assertRetiredStaleScheduleMarker(JSON.stringify(marker))).not.toThrow();
    expect(WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR).toBe(2);
  });

  it.each([
    ['a non-string value', 42],
    ['null', null],
    ['non-JSON text', 'not-json'],
    ['JSON null', 'null'],
    ['an empty object', '{}'],
    ['a newer version', JSON.stringify({ ...marker, version: 2 })],
    ['a lower floor', JSON.stringify({ ...marker, compatibilityFloor: 1 })],
    ['an invalid timestamp', JSON.stringify({ ...marker, forbiddenAt: 'not-a-date' })],
    ['an extra key', JSON.stringify({ ...marker, extra: true })],
  ])('rejects %s', (_label, value) => {
    expect(() => assertRetiredStaleScheduleMarker(value))
      .toThrow(INVALID_RETIRED_STALE_SCHEDULE_MARKER);
  });
});
