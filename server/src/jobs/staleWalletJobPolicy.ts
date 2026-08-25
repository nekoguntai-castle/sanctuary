import { fromBullMqJobId } from './bullMqJobIds';
import {
  CHECK_STALE_WALLETS_JOB_NAME,
  SYNC_WALLET_JOB_NAME,
} from './syncJobContract';

const STALE_SYNC_JOB_ID_PREFIX = 'sync:stale:';
const STALE_SYNC_REASONS = new Set(['stale', 'startup-catch-up']);
// Preserve both the current producer spelling and the legacy hyphenated value
// so retirement cannot erase explicit address-triggered sync work.
const EXPLICIT_SYNC_REASONS = new Set(['manual', 'address_activity', 'address-activity']);

export type StaleWalletJobClassification = 'stale' | 'preserve' | 'indeterminate';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Classify elapsed-age/startup work without erasing jobs whose identity is unknown. */
export function classifyStaleWalletScheduleJob(input: {
  name: string;
  jobId?: string | null;
  data?: unknown;
}): StaleWalletJobClassification {
  if (input.name === CHECK_STALE_WALLETS_JOB_NAME) return 'stale';
  if (input.name !== SYNC_WALLET_JOB_NAME) return 'preserve';

  // Payload provenance is authoritative when an old producer reused a stale
  // job ID for newer explicit work. Retirement must never erase that work.
  if (isRecord(input.data)) {
    if (input.data.fullResync === true) return 'preserve';
    if (typeof input.data.reason === 'string' && EXPLICIT_SYNC_REASONS.has(input.data.reason)) {
      return 'preserve';
    }
  }

  let malformedEncodedId = false;
  if (input.jobId !== undefined && input.jobId !== null) {
    const logicalJobId = fromBullMqJobId(input.jobId);
    malformedEncodedId = logicalJobId === null;
    if (logicalJobId?.startsWith(STALE_SYNC_JOB_ID_PREFIX)) return 'stale';
  }

  if (isRecord(input.data)) {
    if (typeof input.data.reason === 'string' && STALE_SYNC_REASONS.has(input.data.reason)) {
      return 'stale';
    }
  }
  return malformedEncodedId ? 'indeterminate' : 'preserve';
}

/** Identify only positively attributed elapsed-age/startup scheduler work. */
export function isStaleWalletScheduleJob(input: {
  name: string;
  jobId?: string | null;
  data?: unknown;
}): boolean {
  return classifyStaleWalletScheduleJob(input) === 'stale';
}
