import { describe, expect, it } from 'vitest';
import { toBullMqJobId } from '../../../src/jobs/bullMqJobIds';
import {
  classifyStaleWalletScheduleJob,
  isStaleWalletScheduleJob,
} from '../../../src/jobs/staleWalletJobPolicy';

describe('staleWalletJobPolicy', () => {
  it('classifies the retired parent and encoded stale children', () => {
    expect(isStaleWalletScheduleJob({ name: 'check-stale-wallets' })).toBe(true);
    expect(isStaleWalletScheduleJob({
      name: 'sync-wallet',
      jobId: toBullMqJobId('sync:stale:wallet-1:123'),
      data: { reason: 'custom-stale-sweep' },
    })).toBe(true);
  });

  it.each(['stale', 'startup-catch-up'])(
    'classifies retained %s jobs even without an ID',
    (reason) => {
      expect(isStaleWalletScheduleJob({
        name: 'sync-wallet',
        data: { reason },
      })).toBe(true);
    },
  );

  it('preserves manual, activity, and full-resync work', () => {
    for (const input of [
      { name: 'sync-wallet', jobId: toBullMqJobId('manual-sync:wallet-1'), data: { reason: 'manual' } },
      { name: 'sync-wallet', jobId: toBullMqJobId('sync:wallet-1:123'), data: { reason: 'address_activity' } },
      { name: 'sync-wallet', jobId: toBullMqJobId('full-resync:wallet-1'), data: { fullResync: true } },
      { name: 'other', jobId: toBullMqJobId('sync:stale:wallet-1') },
    ]) {
      expect(isStaleWalletScheduleJob(input)).toBe(false);
    }
  });

  it('lets explicit provenance override a stale-shaped retained job ID', () => {
    const staleJobId = toBullMqJobId('sync:stale:wallet-1:123');

    expect(classifyStaleWalletScheduleJob({
      name: 'sync-wallet',
      jobId: staleJobId,
      data: { reason: 'manual' },
    })).toBe('preserve');
    expect(classifyStaleWalletScheduleJob({
      name: 'sync-wallet',
      jobId: staleJobId,
      data: { reason: 'address_activity' },
    })).toBe('preserve');
    expect(classifyStaleWalletScheduleJob({
      name: 'sync-wallet',
      jobId: staleJobId,
      data: { fullResync: true },
    })).toBe('preserve');
  });

  it('preserves positively identified manual and full-resync work with malformed IDs', () => {
    expect(isStaleWalletScheduleJob({
      name: 'sync-wallet',
      jobId: 'b64_not+base64',
      data: { reason: 'manual' },
    })).toBe(false);
    expect(classifyStaleWalletScheduleJob({
      name: 'sync-wallet',
      jobId: 'b64_not+base64',
      data: { fullResync: true },
    })).toBe('preserve');
  });

  it('reports malformed IDs without positive provenance as indeterminate', () => {
    expect(classifyStaleWalletScheduleJob({
      name: 'sync-wallet',
      jobId: 'b64_not+base64',
      data: { reason: 'custom-source' },
    })).toBe('indeterminate');
  });

  it('preserves an ordinary sync when optional provenance is not an object', () => {
    expect(classifyStaleWalletScheduleJob({
      name: 'sync-wallet',
      data: 'manual',
    })).toBe('preserve');
  });
});
