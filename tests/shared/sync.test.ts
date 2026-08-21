import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SYNC_PRIORITY,
  SYNC_EXECUTION_OWNER_VALUES,
  SYNC_LIFECYCLE_TRANSITION_VALUES,
  SYNC_PRIORITY_BULLMQ_PRIORITY,
  SYNC_PRIORITY_SORT_ORDER,
  SYNC_PRIORITY_VALUES,
  WALLET_SYNC_FAILURE_CLASS_VALUES,
  isSyncExecutionOwner,
  isSyncPriority,
  isWalletSyncFailureClass,
} from '@sanctuary/shared/constants/sync';

describe('sync priority constants', () => {
  it('defines priority values, default, queue sort order, and BullMQ mapping', () => {
    expect(SYNC_PRIORITY_VALUES).toEqual(['high', 'normal', 'low']);
    expect(DEFAULT_SYNC_PRIORITY).toBe('normal');
    expect(SYNC_PRIORITY_SORT_ORDER).toEqual({ high: 0, normal: 1, low: 2 });
    expect(SYNC_PRIORITY_BULLMQ_PRIORITY).toEqual({ high: 1, normal: 2, low: 3 });
  });

  it('guards sync priority values', () => {
    expect(isSyncPriority('high')).toBe(true);
    expect(isSyncPriority('normal')).toBe(true);
    expect(isSyncPriority('low')).toBe(true);
    expect(isSyncPriority('urgent')).toBe(false);
    expect(isSyncPriority(null)).toBe(false);
  });

  it('defines and guards the sync execution owners', () => {
    expect(SYNC_EXECUTION_OWNER_VALUES).toEqual(['inline', 'worker']);
    expect(isSyncExecutionOwner('inline')).toBe(true);
    expect(isSyncExecutionOwner('worker')).toBe(true);
    expect(isSyncExecutionOwner('queue')).toBe(false);
    expect(isSyncExecutionOwner(undefined)).toBe(false);
  });

  it('defines the persisted lifecycle transition vocabulary', () => {
    expect(SYNC_LIFECYCLE_TRANSITION_VALUES).toEqual([
      'started',
      'succeeded',
      'retrying',
      'failed',
      'cleared',
    ]);
  });

  it('defines and guards the bounded sync failure taxonomy', () => {
    expect(WALLET_SYNC_FAILURE_CLASS_VALUES).toEqual([
      'electrum_unavailable',
      'node_rpc_unavailable',
      'descriptor_policy_missing',
      'canonical_evidence_missing',
      'evidence_authentication_failed',
      'lock_contention',
      'timeout',
      'sync_cancelled',
      'database_unavailable',
      'other',
    ]);
    for (const failureClass of WALLET_SYNC_FAILURE_CLASS_VALUES) {
      expect(isWalletSyncFailureClass(failureClass)).toBe(true);
    }
    expect(isWalletSyncFailureClass('raw_remote_error')).toBe(false);
    expect(isWalletSyncFailureClass(null)).toBe(false);
  });
});
