import type { JobsOptions } from 'bullmq';

export const DEAD_LETTER_VERSION = 1;

export type DeadLetterCategory =
  | 'sync'
  | 'push'
  | 'telegram'
  | 'notification'
  | 'electrum'
  | 'transaction'
  | 'other';

export interface DeadLetterJobEnvelope {
  version: typeof DEAD_LETTER_VERSION;
  queue: string;
  name: string;
  jobId: string;
  data: unknown;
  options: Pick<
    JobsOptions,
    | 'attempts'
    | 'backoff'
    | 'priority'
    | 'removeOnComplete'
    | 'removeOnFail'
  >;
  exhaustedAttempt: number;
}

export interface DeadLetterEntry {
  version: typeof DEAD_LETTER_VERSION;
  id: string;
  category: DeadLetterCategory;
  operation: string;
  payload: Record<string, unknown>;
  job?: DeadLetterJobEnvelope;
  error: string;
  errorStack?: string;
  attempts: number;
  firstFailedAt: Date;
  lastFailedAt: Date;
  metadata?: Record<string, unknown>;
}

export interface DeadLetterStats {
  total: number;
  byCategory: Record<DeadLetterCategory, number>;
  oldest?: Date;
  newest?: Date;
}

export interface DeadLetterClaim {
  entry: DeadLetterEntry;
  token: string;
  expiresAt: Date;
}

export type DeadLetterClaimResult =
  | { status: 'claimed'; claim: DeadLetterClaim }
  | { status: 'busy' }
  | { status: 'missing' };

export interface DeadLetterStore {
  upsert(entry: DeadLetterEntry): Promise<string>;
  get(id: string): Promise<DeadLetterEntry | null>;
  list(options?: {
    category?: DeadLetterCategory;
    limit?: number;
  }): Promise<DeadLetterEntry[]>;
  remove(id: string): Promise<boolean>;
  clearCategory(category: DeadLetterCategory): Promise<number>;
  claim(id: string, token: string, leaseMs: number): Promise<DeadLetterClaimResult>;
  release(id: string, token: string): Promise<boolean>;
  acknowledge(id: string, token: string): Promise<boolean>;
  cleanup(): Promise<number>;
}

export const DEAD_LETTER_CATEGORIES: DeadLetterCategory[] = [
  'sync',
  'push',
  'telegram',
  'notification',
  'electrum',
  'transaction',
  'other',
];
