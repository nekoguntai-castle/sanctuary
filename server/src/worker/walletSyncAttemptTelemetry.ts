import type { SyncProgressDetails, SyncProgressStage } from '@sanctuary/shared/schemas/syncProgress';
import type { NetworkType } from '@sanctuary/shared/constants/bitcoin';
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
type FinishStage = (outcome: WalletSyncStageOutcome) => void;

export interface WalletSyncAttemptTelemetryOptions {
  executionId: string;
  ownedLock: OwnedWalletSyncLock;
  mode: SyncMode;
  network: NetworkType;
}

/** Bridges strict progress events to fixed metrics and sampled worker state. */
export class WalletSyncAttemptTelemetry implements SyncAttemptTelemetry {
  private registered = false;
  private terminalRecorded = false;
  private activeStage: FinishStage | null = null;

  constructor(private readonly options: WalletSyncAttemptTelemetryOptions) {}

  observeProgress(details: SyncProgressDetails): void {
    this.ensureRegistered(details.stage);
    switch (details.event) {
      case 'stage_started':
        this.startStage(details.stage);
        break;
      case 'fallback':
        this.recordFallback(details.stage);
        break;
      case 'batch_completed':
        this.finishActiveStage('completed');
        break;
      case 'timeout':
        this.recordAttemptTimeout();
        break;
      case 'aborted':
        this.recordAttemptAbort();
        break;
    }
  }

  recordCandidates(fetched: number, rejected: number): void {
    recordWalletSyncCandidateOutcome('fetched', fetched);
    recordWalletSyncCandidateOutcome('rejected', rejected);
  }

  finish(outcome: WalletSyncExecutionOutcome): void {
    if (outcome === 'timedOut' || outcome === 'aborted') {
      this.recordTerminal(outcome);
    }
    this.finishActiveStage(outcome === 'completed' ? 'completed' : outcome === 'failed'
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

  private ensureRegistered(stage: SyncProgressStage): void {
    if (this.registered) {
      walletSyncExecutionRegistry.transition(this.options.executionId, stage);
      return;
    }
    this.registered = walletSyncExecutionRegistry.start({
      executionId: this.options.executionId,
      stage,
      ownedLock: this.options.ownedLock,
    });
  }

  private startStage(stage: SyncProgressStage): void {
    this.finishActiveStage('completed');
    walletSyncExecutionRegistry.transition(this.options.executionId, stage);
    this.activeStage = enterWalletSyncStage({
      stage,
      mode: this.options.mode,
      network: this.options.network,
    });
  }

  private recordFallback(stage: SyncProgressStage): void {
    const dimensions = {
      stage,
      mode: this.options.mode,
      network: this.options.network,
    };
    recordWalletSyncFallback(dimensions);
    recordWalletSyncBudgetExpiry(dimensions);
    walletSyncExecutionRegistry.recordBudgetExpiry(this.options.executionId);
    this.finishActiveStage('budget_expired');
  }

  private recordTerminal(outcome: 'timedOut' | 'aborted'): void {
    if (this.terminalRecorded) return;
    this.terminalRecorded = true;
    recordWalletSyncTerminalOutcome(outcome === 'timedOut' ? 'timeout' : 'aborted');
  }

  private finishActiveStage(outcome: WalletSyncStageOutcome): void {
    this.activeStage?.(outcome);
    this.activeStage = null;
  }
}
