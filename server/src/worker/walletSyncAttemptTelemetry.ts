import type {
  SyncExecutionStage,
  SyncProgressDetails,
} from '@sanctuary/shared/schemas/syncProgress';
import type { SyncAttemptTelemetry } from '../services/bitcoin/sync/attemptRuntime';
import {
  enterWalletSyncStage,
  recordWalletSyncAbortGraceExhaustion,
  recordWalletSyncBudgetExpiry,
  recordWalletSyncCandidateOutcome,
  recordWalletSyncFallback,
  recordWalletSyncTerminalOutcome,
  type WalletSyncStageOutcome,
} from '../observability/metrics/walletSyncMetrics';
import {
  walletSyncExecutionRegistry,
  type OwnedWalletSyncLock,
  type WalletSyncExecutionOutcome,
} from './walletSyncExecutionRegistry';

type SyncMode = 'incremental' | 'full_resync';
type FinishMetricStage = (outcome: WalletSyncStageOutcome, finishedAtMs?: number) => void;

export interface WalletSyncAttemptTelemetryOptions {
  executionId: string;
  ownedLock: OwnedWalletSyncLock;
  mode: SyncMode;
  network: unknown;
}

/** Bridges strict progress events to fixed metrics and sampled worker state. */
export class WalletSyncAttemptTelemetry implements SyncAttemptTelemetry {
  private registered = false;
  private terminalRecorded = false;
  private attemptFinished = false;
  private activeStage: { stage: SyncExecutionStage; finish: FinishMetricStage } | null = null;

  constructor(private readonly options: WalletSyncAttemptTelemetryOptions) {}

  observeProgress(details: SyncProgressDetails): void {
    switch (details.event) {
      case 'stage_started':
        this.beginStage(details.stage, Date.now() - details.elapsedMs);
        break;
      case 'fallback':
        this.recordFallback(details.stage);
        break;
      case 'batch_completed':
        this.finishStage(details.stage, 'completed');
        break;
      case 'timeout':
        this.recordAttemptTimeout();
        break;
      case 'aborted':
        this.recordAttemptAbort();
        break;
    }
  }

  beginStage(stage: SyncExecutionStage, startedAtMs = Date.now()): boolean {
    if (this.attemptFinished || this.activeStage?.stage === stage) return false;
    if (this.activeStage) this.closeActiveStage('completed', startedAtMs);
    if (!this.registered) {
      this.registered = walletSyncExecutionRegistry.start({
        executionId: this.options.executionId,
        stage,
        ownedLock: this.options.ownedLock,
        atMs: startedAtMs,
      });
    } else {
      walletSyncExecutionRegistry.transition(this.options.executionId, stage, startedAtMs);
    }
    this.activeStage = {
      stage,
      finish: enterWalletSyncStage({
        stage,
        mode: this.options.mode,
        network: this.options.network,
        startedAtMs,
      }),
    };
    return true;
  }

  finishStage(
    stage: SyncExecutionStage,
    outcome: WalletSyncStageOutcome,
    finishedAtMs = Date.now(),
  ): boolean {
    if (this.attemptFinished || this.activeStage?.stage !== stage) return false;
    if (outcome === 'budget_expired') {
      const dimensions = {
        stage,
        mode: this.options.mode,
        network: this.options.network,
      };
      recordWalletSyncBudgetExpiry(dimensions);
      walletSyncExecutionRegistry.recordBudgetExpiry(this.options.executionId);
    }
    this.closeActiveStage(outcome, finishedAtMs);
    return true;
  }

  recordCandidates(fetched: number, rejected: number): void {
    recordWalletSyncCandidateOutcome('fetched', fetched);
    recordWalletSyncCandidateOutcome('rejected', rejected);
  }

  finish(outcome: WalletSyncExecutionOutcome): void {
    if (this.attemptFinished) return;
    this.attemptFinished = true;
    if (outcome === 'timedOut' || outcome === 'aborted') {
      this.recordTerminal(outcome);
    }
    this.closeActiveStage(outcome === 'completed' ? 'completed' : outcome === 'failed'
      ? 'failed'
      : 'aborted');
    if (this.registered) {
      walletSyncExecutionRegistry.finish(this.options.executionId, outcome);
      this.registered = false;
    }
  }

  recordAbortGraceExhaustion(): void {
    recordWalletSyncAbortGraceExhaustion();
  }

  recordAttemptTimeout(): void {
    this.recordTerminal('timedOut');
  }

  recordAttemptAbort(): void {
    this.recordTerminal('aborted');
  }

  private recordFallback(stage: SyncExecutionStage): void {
    const dimensions = {
      stage,
      mode: this.options.mode,
      network: this.options.network,
    };
    recordWalletSyncFallback(dimensions);
    this.finishStage(stage, 'budget_expired');
  }

  private recordTerminal(outcome: 'timedOut' | 'aborted'): void {
    if (this.terminalRecorded) return;
    this.terminalRecorded = true;
    recordWalletSyncTerminalOutcome(outcome === 'timedOut' ? 'timeout' : 'aborted');
  }

  private closeActiveStage(outcome: WalletSyncStageOutcome, finishedAtMs = Date.now()): void {
    this.activeStage?.finish(outcome, finishedAtMs);
    this.activeStage = null;
  }
}
