export const NOTIFICATION_OUTCOMES = [
  'not_registered',
  'no_recipients',
  'accepted',
  'rejected',
  'partial',
  'ambiguous',
] as const;

export type NotificationOutcome = (typeof NOTIFICATION_OUTCOMES)[number];

export const NOTIFICATION_FAILURE_CLASSES = [
  'none',
  'invalid_configuration',
  'authentication',
  'permission',
  'rate_limited',
  'provider_rejected',
  'provider_unavailable',
  'timeout',
  'circuit_open',
  'network',
  'redis_unavailable',
  'queue_add_failed',
  'internal',
  'unknown',
  'other',
] as const;

export type NotificationFailureClass = (typeof NOTIFICATION_FAILURE_CLASSES)[number];
export type NotificationChannelId = 'telegram' | 'push' | 'other';

export interface SafeChannelOutcome {
  channel: NotificationChannelId;
  outcome: NotificationOutcome;
  failureClass: NotificationFailureClass;
}

export interface SafeNotificationOutcome {
  outcome: NotificationOutcome;
  failureClass: NotificationFailureClass;
  channels: SafeChannelOutcome[];
}

interface LegacyCompatibleChannelResult {
  channelId?: string;
  success: boolean;
  usersNotified: number;
  outcome?: NotificationOutcome;
  failureClass?: NotificationFailureClass;
}

export function toSafeChannelOutcome(result: LegacyCompatibleChannelResult): SafeChannelOutcome {
  const outcome = normalizeNotificationOutcome(result.outcome, legacyOutcome(result));
  return {
    channel: toChannelId(result.channelId),
    outcome,
    failureClass: normalizeFailureClass(result),
  };
}

function normalizeFailureClass(
  result: LegacyCompatibleChannelResult,
): NotificationFailureClass {
  if (isNotificationFailureClass(result.failureClass)) return result.failureClass;
  if (result.failureClass !== undefined) return 'other';
  return result.success ? 'none' : 'unknown';
}

export function normalizeNotificationOutcome(
  value: unknown,
  fallback: NotificationOutcome,
): NotificationOutcome {
  return isNotificationOutcome(value) ? value : fallback;
}

export function normalizeNotificationFailureClass(
  value: unknown,
  fallback: NotificationFailureClass,
): NotificationFailureClass {
  return isNotificationFailureClass(value) ? value : fallback;
}

export function summarizeSafeNotificationOutcome(
  results: LegacyCompatibleChannelResult[],
): SafeNotificationOutcome {
  const channels = results.map(toSafeChannelOutcome);
  if (channels.length === 0) {
    return { outcome: 'not_registered', failureClass: 'none', channels };
  }

  return {
    outcome: aggregateOutcomes(channels.map(({ outcome }) => outcome)),
    failureClass: aggregateFailureClasses(channels),
    channels,
  };
}

function legacyOutcome(result: LegacyCompatibleChannelResult): NotificationOutcome {
  if (!result.success) return 'ambiguous';
  return result.usersNotified > 0 ? 'accepted' : 'no_recipients';
}

function toChannelId(channelId: string | undefined): NotificationChannelId {
  if (channelId === 'telegram' || channelId === 'push') return channelId;
  return 'other';
}

function isNotificationOutcome(value: unknown): value is NotificationOutcome {
  return typeof value === 'string' && NOTIFICATION_OUTCOMES.includes(value as NotificationOutcome);
}

function isNotificationFailureClass(value: unknown): value is NotificationFailureClass {
  return typeof value === 'string' && NOTIFICATION_FAILURE_CLASSES.includes(
    value as NotificationFailureClass,
  );
}

function aggregateOutcomes(outcomes: NotificationOutcome[]): NotificationOutcome {
  // Precedence is intentionally order-independent: any mixed accepted/non-accepted
  // result is partial, then uncertainty outranks rejection when nothing succeeded.
  if (outcomes.includes('partial')) return 'partial';

  const hasAccepted = outcomes.includes('accepted');
  const hasRejected = outcomes.includes('rejected');
  const hasAmbiguous = outcomes.includes('ambiguous');
  const hasNotRegistered = outcomes.includes('not_registered');

  if (hasAccepted && (hasRejected || hasAmbiguous || hasNotRegistered)) return 'partial';
  if (hasAccepted) return 'accepted';
  if (hasAmbiguous) return 'ambiguous';
  if (hasRejected) return 'rejected';
  if (hasNotRegistered) return 'not_registered';
  return 'no_recipients';
}

function aggregateFailureClasses(channels: SafeChannelOutcome[]): NotificationFailureClass {
  const failures = new Set(
    channels
      .map(({ failureClass }) => failureClass)
      .filter((failureClass) => failureClass !== 'none'),
  );
  if (failures.size === 0) return 'none';
  // The size check guarantees the indexed value exists; avoid a misleading
  // fallback that can never occur for a native Set.
  if (failures.size === 1) return [...failures][0] as NotificationFailureClass;
  return 'other';
}
