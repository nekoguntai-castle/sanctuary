const RECURRING_JOB_ENVELOPE_VERSION = 1;

interface RecurringJobEnvelope<T> {
  __sanctuaryRecurring: {
    version: typeof RECURRING_JOB_ENVELOPE_VERSION;
    generationToken: string;
  };
  payload: T;
}

export function wrapRecurringJobData<T>(
  payload: T,
  generationToken: string | undefined,
): T | RecurringJobEnvelope<T> {
  if (!generationToken) return payload;
  return {
    __sanctuaryRecurring: {
      version: RECURRING_JOB_ENVELOPE_VERSION,
      generationToken,
    },
    payload,
  };
}

export function unwrapRecurringJobData<T>(
  value: unknown,
): { generationToken: string; payload: T } | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<RecurringJobEnvelope<T>>;
  const metadata = candidate.__sanctuaryRecurring;
  if (
    !metadata ||
    metadata.version !== RECURRING_JOB_ENVELOPE_VERSION ||
    typeof metadata.generationToken !== 'string' ||
    metadata.generationToken.length === 0 ||
    !Object.prototype.hasOwnProperty.call(candidate, 'payload')
  ) {
    return null;
  }
  return {
    generationToken: metadata.generationToken,
    payload: candidate.payload as T,
  };
}
