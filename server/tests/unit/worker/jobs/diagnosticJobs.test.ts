import os from 'node:os';
import type { Job } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  diagnosticJobs,
  workerDiagnosticLockedPingJob,
  workerDiagnosticPingJob,
} from '../../../../src/worker/jobs/diagnosticJobs';

describe('worker diagnosticJobs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports side-effect-free diagnostic jobs on the maintenance queue', () => {
    expect(diagnosticJobs.map(job => job.name)).toEqual([
      'diagnostics:worker-ping',
      'diagnostics:locked-worker-ping',
    ]);
    expect(diagnosticJobs.every(job => job.queue === 'maintenance')).toBe(true);
    expect(workerDiagnosticPingJob.options?.attempts).toBe(1);
    expect(workerDiagnosticLockedPingJob.options?.attempts).toBe(1);
  });

  it('returns worker identity from the ping handler', async () => {
    vi.spyOn(os, 'hostname').mockReturnValue('worker-test-host');

    const result = await workerDiagnosticPingJob.handler({
      data: {
        proofId: 'phase3-proof',
        sequence: 7,
      },
    } as Job);

    expect(result).toEqual({
      success: true,
      proofId: 'phase3-proof',
      sequence: 7,
      worker: {
        hostname: 'worker-test-host',
        pid: process.pid,
      },
      durationMs: expect.any(Number),
    });
  });

  it('normalizes optional fields and caps diagnostic delay', async () => {
    vi.useFakeTimers();
    vi.spyOn(os, 'hostname').mockReturnValue('worker-test-host');

    const resultPromise = workerDiagnosticPingJob.handler({
      data: {
        delayMs: 10_000,
      },
    } as Job);

    await vi.advanceTimersByTimeAsync(5_000);
    const result = await resultPromise;

    expect(result).toEqual({
      success: true,
      proofId: null,
      sequence: null,
      worker: {
        hostname: 'worker-test-host',
        pid: process.pid,
      },
      durationMs: 5_000,
    });

    vi.useRealTimers();
  });

  it('uses a deterministic lock key for locked diagnostic pings', () => {
    expect(workerDiagnosticLockedPingJob.lockOptions?.lockKey({
      proofId: 'proof-1',
      lockKey: 'shared-lock',
    })).toBe('diagnostics:worker-ping:shared-lock');
    expect(workerDiagnosticLockedPingJob.lockOptions?.lockTtlMs).toBe(30_000);
  });
});
