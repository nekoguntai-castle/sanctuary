import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  classifyDistributedLockScope,
  enterWalletSyncStage,
  metricsService,
  recordWalletSyncAbortGraceExhaustion,
  recordWalletSyncBudgetExpiry,
  recordWalletSyncCandidateOutcome,
  recordWalletSyncCleanupOutcome,
  recordWalletSyncFallback,
  recordWalletSyncLockLoss,
  recordWalletSyncTerminalOutcome,
  WALLET_SYNC_METRIC_MODES,
  WALLET_SYNC_METRIC_NETWORKS,
  WALLET_SYNC_METRIC_STAGES,
  WALLET_SYNC_STAGE_OUTCOMES,
} from '../../../src/observability/metrics';

describe('wallet sync metrics', () => {
  beforeEach(() => {
    metricsService.reset();
  });

  it('records stage lifecycle with fixed stage, mode, network, and outcome labels', async () => {
    const finish = enterWalletSyncStage({
      stage: 'timestamp_fetch',
      mode: 'full_resync',
      network: 'testnet4',
      startedAtMs: 1_000,
      now: () => 3_500,
    });

    finish('completed');
    finish('failed');

    const metrics = await metricsService.getMetrics();
    expect(metrics).toContain(
      'sanctuary_wallet_sync_active_stage{stage="timestamp_fetch",mode="full_resync",network="testnet4"} 0',
    );
    expect(metrics).toContain(
      'sanctuary_wallet_sync_stage_duration_seconds_count{stage="timestamp_fetch",mode="full_resync",network="testnet4",outcome="completed"} 1',
    );
    expect(metrics).not.toContain('outcome="failed"');
  });

  it('reports the oldest concurrent active stage and reveals the next oldest on close', async () => {
    let now = 10_000;
    const finishOldest = enterWalletSyncStage({
      stage: 'address_history', mode: 'incremental', network: 'mainnet',
      startedAtMs: 1_000, now: () => now,
    });
    const finishNewer = enterWalletSyncStage({
      stage: 'address_history', mode: 'incremental', network: 'mainnet',
      startedAtMs: 4_000, now: () => now,
    });

    let metrics = await metricsService.getMetrics();
    expect(metrics).toContain(
      'sanctuary_wallet_sync_active_stage_oldest_seconds{stage="address_history",mode="incremental",network="mainnet"} 9',
    );
    now = 12_000;
    finishOldest('completed');
    metrics = await metricsService.getMetrics();
    expect(metrics).toContain(
      'sanctuary_wallet_sync_active_stage_oldest_seconds{stage="address_history",mode="incremental",network="mainnet"} 8',
    );
    finishOldest('failed');
    finishNewer('completed');
    metrics = await metricsService.getMetrics();
    expect(metrics).toContain(
      'sanctuary_wallet_sync_active_stage_oldest_seconds{stage="address_history",mode="incremental",network="mainnet"} 0',
    );
  });

  it('clamps active-stage clock rollback and exposes long-duration boundaries', async () => {
    const finish = enterWalletSyncStage({
      stage: 'preflight', mode: 'incremental', network: 'mainnet',
      startedAtMs: 2_000, now: () => 1_000,
    });
    let metrics = await metricsService.getMetrics();
    expect(metrics).toContain(
      'sanctuary_wallet_sync_active_stage_oldest_seconds{stage="preflight",mode="incremental",network="mainnet"} 0',
    );
    finish('aborted', 1_000);
    metrics = await metricsService.getMetrics();
    for (const boundary of ['330', '1800', '1830']) {
      expect(metrics).toContain(
        `sanctuary_wallet_sync_stage_duration_seconds_bucket{le="${boundary}",stage="preflight",mode="incremental",network="mainnet",outcome="aborted"}`,
      );
    }
  });

  it('enumerates the complete fixed stage series inventory', async () => {
    for (const stage of WALLET_SYNC_METRIC_STAGES) {
      for (const mode of WALLET_SYNC_METRIC_MODES) {
        for (const network of WALLET_SYNC_METRIC_NETWORKS) {
          for (const outcome of WALLET_SYNC_STAGE_OUTCOMES) {
            enterWalletSyncStage({ stage, mode, network, startedAtMs: 0, now: () => 1_000 })(
              outcome,
            );
          }
        }
      }
    }

    const metrics = await metricsService.getMetrics();
    for (const stage of WALLET_SYNC_METRIC_STAGES) {
      for (const mode of WALLET_SYNC_METRIC_MODES) {
        for (const network of WALLET_SYNC_METRIC_NETWORKS) {
          for (const outcome of WALLET_SYNC_STAGE_OUTCOMES) {
            expect(metrics).toContain(
              `stage="${stage}",mode="${mode}",network="${network}",outcome="${outcome}"`,
            );
          }
        }
      }
    }
  });

  it('normalizes arbitrary stage, mode, and network values to existing other series', async () => {
    const poison = 'wallet-id\nsecret-token';
    const finish = enterWalletSyncStage({
      stage: poison,
      mode: poison,
      network: poison,
      startedAtMs: 0,
      now: () => 50,
    });
    finish('failed');
    recordWalletSyncFallback({ stage: poison, mode: poison, network: poison });
    recordWalletSyncBudgetExpiry({ stage: poison, mode: poison, network: poison });

    const metrics = await metricsService.getMetrics();
    expect(metrics).toContain('stage="other",mode="other",network="other"');
    expect(metrics).not.toContain(poison);
  });

  it('records candidate and attempt outcomes without identifier labels', async () => {
    recordWalletSyncCandidateOutcome('fetched', 25);
    recordWalletSyncCandidateOutcome('rejected', 3);
    recordWalletSyncTerminalOutcome('timeout');
    recordWalletSyncTerminalOutcome('aborted');
    recordWalletSyncAbortGraceExhaustion();

    const metrics = await metricsService.getMetrics();
    expect(metrics).toContain('sanctuary_wallet_sync_candidates_total{outcome="fetched"} 25');
    expect(metrics).toContain('sanctuary_wallet_sync_candidates_total{outcome="rejected"} 3');
    expect(metrics).toContain('sanctuary_wallet_sync_terminal_total{outcome="timeout"} 1');
    expect(metrics).toContain('sanctuary_wallet_sync_terminal_total{outcome="aborted"} 1');
    expect(metrics).toContain('sanctuary_wallet_sync_abort_grace_exhausted_total 1');
  });

  it('drops invalid outcome and count values instead of creating dynamic series', async () => {
    expect(recordWalletSyncCandidateOutcome('wallet-secret', 1)).toBe(false);
    expect(recordWalletSyncCandidateOutcome('fetched', -1)).toBe(false);
    expect(recordWalletSyncTerminalOutcome('wallet-secret')).toBe(false);
    expect(recordWalletSyncCleanupOutcome('wallet-secret')).toBe(false);

    const metrics = await metricsService.getMetrics();
    expect(metrics).not.toContain('wallet-secret');
  });

  it('records only the closed lock scope, loss, and cleanup domains', async () => {
    const scopes = [
      'wallet_sync',
      'electrum_subscription',
      'worker_maintenance',
      'other',
    ] as const;
    const losses = ['renewal_lost', 'ownership_mismatch'] as const;
    const cleanups = [
      'flag_cleared',
      'intent_requeued',
      'lock_present_deferred',
      'no_change',
      'error',
    ] as const;

    for (const scope of scopes) {
      for (const loss of losses) recordWalletSyncLockLoss(scope, loss);
    }
    for (const cleanup of cleanups) recordWalletSyncCleanupOutcome(cleanup);

    const metrics = await metricsService.getMetrics();
    for (const scope of scopes) {
      for (const loss of losses) {
        expect(metrics).toContain(
          `sanctuary_wallet_sync_lock_loss_total{scope="${scope}",loss="${loss}"} 1`,
        );
      }
    }
    for (const cleanup of cleanups) {
      expect(metrics).toContain(
        `sanctuary_wallet_sync_cleanup_total{outcome="${cleanup}"} 1`,
      );
    }
  });

  it('normalizes unknown lock scope while rejecting an unknown loss domain', async () => {
    expect(recordWalletSyncLockLoss('sync:wallet:private-id', 'renewal_lost')).toBe(true);
    expect(recordWalletSyncLockLoss('wallet_sync', 'private-loss')).toBe(false);

    const metrics = await metricsService.getMetrics();
    expect(metrics).toContain(
      'sanctuary_wallet_sync_lock_loss_total{scope="other",loss="renewal_lost"} 1',
    );
    expect(metrics).not.toContain('private-id');
    expect(metrics).not.toContain('private-loss');
  });

  it('clamps invalid clocks to a zero-second observation', async () => {
    const now = vi.fn(() => Number.NaN);
    enterWalletSyncStage({
      stage: 'persistence',
      mode: 'incremental',
      network: 'mainnet',
      startedAtMs: Number.POSITIVE_INFINITY,
      now,
    })('completed');

    const metrics = await metricsService.getMetrics();
    expect(metrics).toContain(
      'sanctuary_wallet_sync_stage_duration_seconds_sum{stage="persistence",mode="incremental",network="mainnet",outcome="completed"} 0',
    );
  });

  it('uses safe defaults and maps an invalid stage outcome to failed', async () => {
    const finish = enterWalletSyncStage({
      stage: 'classification',
      mode: 'incremental',
      network: 'signet',
    });

    finish('unexpected' as never);

    const metrics = await metricsService.getMetrics();
    expect(metrics).toContain(
      'stage="classification",mode="incremental",network="signet",outcome="failed"',
    );
  });

  it('classifies only fixed distributed-lock scopes without retaining lock keys', () => {
    expect(classifyDistributedLockScope(undefined)).toBe('other');
    expect(classifyDistributedLockScope('sync:wallet:private-id')).toBe('wallet_sync');
    expect(classifyDistributedLockScope('electrum:subscriptions')).toBe(
      'electrum_subscription',
    );
    expect(classifyDistributedLockScope('maintenance:prices')).toBe(
      'worker_maintenance',
    );
    expect(classifyDistributedLockScope('unclassified:private-id')).toBe('other');
  });
});
