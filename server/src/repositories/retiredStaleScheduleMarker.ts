import { z } from 'zod';
import { safeJsonParse } from '../utils/safeJson';
import { STALE_WALLET_SCHEDULE_FORBIDDEN_KEY } from './operationalSystemSettings';
import { WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR } from '../constants/walletSyncActivation';

/**
 * The stale-wallet scheduler was removed, so this binary never decides
 * anything from the marker and writes it only by restoring a backed-up row.
 * v0.8.67 through v0.8.84 binaries still parse it strictly to stop a rollback
 * from recreating the schedule, so backup and restore carry it through only
 * when it is well formed.
 */
const retiredStaleScheduleMarkerSchema = z.object({
  version: z.literal(1),
  forbiddenAt: z.iso.datetime({ offset: true }),
  compatibilityFloor: z.literal(WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR),
}).strict();

export const INVALID_RETIRED_STALE_SCHEDULE_MARKER =
  'Invalid durable stale-wallet schedule tombstone';

/**
 * Throw unless `value` is the exact marker shape rollback binaries accept.
 * A malformed marker therefore fails backup creation and restore rather than
 * being carried into a database where a rollback binary would refuse it.
 */
export function assertRetiredStaleScheduleMarker(value: unknown): void {
  if (typeof value !== 'string') throw new Error(INVALID_RETIRED_STALE_SCHEDULE_MARKER);
  const parsed = safeJsonParse(
    value,
    retiredStaleScheduleMarkerSchema.nullable(),
    null,
    STALE_WALLET_SCHEDULE_FORBIDDEN_KEY,
  );
  if (parsed === null) throw new Error(INVALID_RETIRED_STALE_SCHEDULE_MARKER);
}
