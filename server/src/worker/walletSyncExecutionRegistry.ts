import {
  SYNC_PROGRESS_STAGES,
  type SyncProgressStage,
} from '@sanctuary/shared/schemas/syncProgress';
import { WALLET_SYNC_MAX_EXECUTION_MS } from '../constants/walletSyncActivation';
import { getRedisClient, isRedisConnected } from '../infrastructure/redis';
import type {
  ObservedWalletSyncExecutionDiagnostics,
  WalletSyncExecutionDiagnostics,
} from '../internal/workerDiagnostics/protocol';
import { bucketAge, bucketCount } from '../internal/workerDiagnostics/buckets';

export type WalletSyncExecutionOutcome = 'completed' | 'failed' | 'timedOut' | 'aborted';

export interface OwnedWalletSyncLock {
  /** Logical distributed-lock key; retained only inside the worker process. */
  key: string;
  /** Secret ownership token; retained only inside the worker process. */
  token: string;
}

export interface WalletSyncExecutionStart {
  executionId: string;
  stage: SyncProgressStage;
  ownedLock: OwnedWalletSyncLock;
  atMs?: number;
}

export interface WalletSyncLockValueReader {
  get(key: string): Promise<string | null>;
}

interface ActiveExecution {
  stage: SyncProgressStage;
  lastProgressAt: number;
  ownedLock: OwnedWalletSyncLock;
  lockLossRecorded: boolean;
}

type CounterName =
  | 'started'
  | 'stageTransitions'
  | WalletSyncExecutionOutcome
  | 'budgetExpired'
  | 'lockLost'
  | 'stalePruned';

type Counters = Record<CounterName, number>;

const ZERO_COUNTERS = (): Counters => ({
  started: 0,
  stageTransitions: 0,
  completed: 0,
  failed: 0,
  timedOut: 0,
  aborted: 0,
  budgetExpired: 0,
  lockLost: 0,
  stalePruned: 0,
});

const MAX_ACTIVE_EXECUTIONS = 50;
const AGREEMENT_READ_CONCURRENCY = 8;
const AGREEMENT_READ_TIMEOUT_MS = 250;
const SAFE_EXECUTION_ID = /^[A-Za-z0-9:_-]{1,128}$/;
const WALLET_SYNC_LOCK_KEY = /^sync:wallet:[A-Za-z0-9_-]{1,128}$/;
const DISTRIBUTED_LOCK_TOKEN = /^[a-f0-9]{32}$/;

function validTimestamp(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function validStage(value: unknown): value is SyncProgressStage {
  return SYNC_PROGRESS_STAGES.includes(value as SyncProgressStage);
}

function hasSafeInternalIdentity(input: WalletSyncExecutionStart): boolean {
  return SAFE_EXECUTION_ID.test(input.executionId)
    && WALLET_SYNC_LOCK_KEY.test(input.ownedLock.key)
    && DISTRIBUTED_LOCK_TOKEN.test(input.ownedLock.token);
}

function redisLockKey(logicalKey: string): string {
  return `lock:${logicalKey}`;
}

export class WalletSyncExecutionRegistry {
  private readonly active = new Map<string, ActiveExecution>();
  private counters = ZERO_COUNTERS();
  private countersResetAt: number;

  constructor(
    private readonly processStartedAt = Date.now(),
    private readonly staleAfterMs = WALLET_SYNC_MAX_EXECUTION_MS,
    private readonly maxActive = MAX_ACTIVE_EXECUTIONS,
    private readonly now = () => Date.now(),
    private readonly agreementReadTimeoutMs = AGREEMENT_READ_TIMEOUT_MS,
  ) {
    this.countersResetAt = processStartedAt;
  }

  start(input: WalletSyncExecutionStart): boolean {
    const atMs = validTimestamp(input.atMs ?? this.now(), this.now());
    this.prune(atMs);
    if (!validStage(input.stage) || !hasSafeInternalIdentity(input)) return false;
    if (this.active.has(input.executionId) || this.active.size >= this.maxActive) return false;
    this.active.set(input.executionId, {
      stage: input.stage,
      lastProgressAt: atMs,
      ownedLock: { ...input.ownedLock },
      lockLossRecorded: false,
    });
    this.increment('started');
    return true;
  }

  transition(executionId: string, stage: SyncProgressStage, atMs = this.now()): boolean {
    const entry = this.active.get(executionId);
    if (!entry || !validStage(stage)) return false;
    const nextAt = validTimestamp(atMs, this.now());
    if (entry.stage !== stage) this.increment('stageTransitions');
    entry.stage = stage;
    entry.lastProgressAt = Math.max(entry.lastProgressAt, nextAt);
    return true;
  }

  finish(executionId: string, outcome: WalletSyncExecutionOutcome): boolean {
    if (!this.active.delete(executionId)) return false;
    this.increment(outcome);
    return true;
  }

  recordBudgetExpiry(executionId: string): boolean {
    if (!this.active.has(executionId)) return false;
    this.increment('budgetExpired');
    return true;
  }

  recordLockLoss(executionId: string): boolean {
    const entry = this.active.get(executionId);
    if (!entry || entry.lockLossRecorded) return false;
    entry.lockLossRecorded = true;
    this.increment('lockLost');
    return true;
  }

  resetCounters(atMs = this.now()): void {
    this.counters = ZERO_COUNTERS();
    this.countersResetAt = validTimestamp(atMs, this.now());
  }

  prune(atMs = this.now()): number {
    const nowMs = validTimestamp(atMs, this.now());
    let pruned = 0;
    for (const [executionId, entry] of this.active) {
      if (nowMs - entry.lastProgressAt < this.staleAfterMs) continue;
      this.active.delete(executionId);
      pruned++;
    }
    if (pruned > 0) this.increment('stalePruned', pruned);
    return pruned;
  }

  async diagnostics(
    reader: WalletSyncLockValueReader | null,
    atMs = this.now(),
  ): Promise<WalletSyncExecutionDiagnostics> {
    const nowMs = validTimestamp(atMs, this.now());
    this.prune(nowMs);
    const redisLockAgreement = await this.readAgreement(reader);
    return {
      version: 1,
      observation: 'observed',
      scope: 'sampled_worker',
      processEpochAge: this.nonNeverAge(this.processStartedAt, nowMs),
      countersResetAge: this.nonNeverAge(this.countersResetAt, nowMs),
      active: {
        total: bucketCount(this.active.size),
        byStage: this.activeByStage(),
        oldestProgressAge: bucketAge(this.oldestProgressAt(), nowMs),
      },
      counters: this.bucketedCounters(),
      redisLockAgreement,
    };
  }

  private increment(counter: CounterName, amount = 1): void {
    this.counters[counter] = Math.min(
      Number.MAX_SAFE_INTEGER,
      this.counters[counter] + amount,
    );
  }

  private activeByStage(): Record<SyncProgressStage, ReturnType<typeof bucketCount>> {
    const counts = Object.fromEntries(SYNC_PROGRESS_STAGES.map(stage => [stage, 0])) as Record<
      SyncProgressStage,
      number
    >;
    for (const entry of this.active.values()) counts[entry.stage]++;
    return Object.fromEntries(SYNC_PROGRESS_STAGES.map(
      stage => [stage, bucketCount(counts[stage])],
    )) as Record<SyncProgressStage, ReturnType<typeof bucketCount>>;
  }

  private oldestProgressAt(): number | null {
    let oldest: number | null = null;
    for (const entry of this.active.values()) {
      oldest = oldest === null ? entry.lastProgressAt : Math.min(oldest, entry.lastProgressAt);
    }
    return oldest;
  }

  private bucketedCounters(): ObservedWalletSyncExecutionDiagnostics['counters'] {
    return Object.fromEntries(Object.entries(this.counters).map(
      ([name, value]) => [name, bucketCount(value)],
    )) as ObservedWalletSyncExecutionDiagnostics['counters'];
  }

  private nonNeverAge(timestamp: number, nowMs: number) {
    const age = bucketAge(timestamp, nowMs);
    return age === 'never' ? '<1m' as const : age;
  }

  private async readAgreement(
    reader: WalletSyncLockValueReader | null,
  ): Promise<ObservedWalletSyncExecutionDiagnostics['redisLockAgreement']> {
    if (!reader) return { agreement: 'unavailable' };
    try {
      const counts = await this.readAgreementCounts(reader);
      if (!counts) return { agreement: 'unavailable' };
      const { matching, missing, mismatch } = counts;
      return {
        agreement: 'observed',
        registryWithOwnedLock: bucketCount(matching),
        registryMissingOwnedLock: bucketCount(missing),
        registryOwnershipMismatch: bucketCount(mismatch),
      };
    } catch {
      return { agreement: 'unavailable' };
    }
  }

  private async readAgreementCounts(reader: WalletSyncLockValueReader): Promise<{
    matching: number;
    missing: number;
    mismatch: number;
  } | null> {
    const entries = [...this.active.entries()];
    const counts = { matching: 0, missing: 0, mismatch: 0 };
    let nextIndex = 0;
    let expired = false;
    const worker = async (): Promise<void> => {
      while (!expired && nextIndex < entries.length) {
        const [executionId, entry] = entries[nextIndex++];
        const value = await reader.get(redisLockKey(entry.ownedLock.key));
        if (value === null) {
          counts.missing++;
          this.recordLockLoss(executionId);
        }
        else if (value === entry.ownedLock.token) counts.matching++;
        else {
          counts.mismatch++;
          this.recordLockLoss(executionId);
        }
      }
    };
    let timeout!: NodeJS.Timeout;
    const timedOut = new Promise<null>(resolve => {
      timeout = setTimeout(() => {
        expired = true;
        resolve(null);
      }, Math.max(0, this.agreementReadTimeoutMs));
      timeout.unref?.();
    });
    try {
      return await Promise.race([
        Promise.all(Array.from(
          { length: Math.min(AGREEMENT_READ_CONCURRENCY, entries.length) },
          () => worker(),
        )).then(() => counts),
        timedOut,
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const walletSyncExecutionRegistry = new WalletSyncExecutionRegistry();

export async function collectWalletSyncExecutionDiagnostics(): Promise<
  WalletSyncExecutionDiagnostics
> {
  const reader = isRedisConnected() ? getRedisClient() : null;
  return walletSyncExecutionRegistry.diagnostics(reader);
}
