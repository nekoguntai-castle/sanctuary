import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRecordFeeSnapshot, mockEvaluateAllWallets } = vi.hoisted(() => ({
  mockRecordFeeSnapshot: vi.fn(),
  mockEvaluateAllWallets: vi.fn(),
}));

vi.mock('../../../../src/services/autopilot/feeMonitor', () => ({
  recordFeeSnapshot: mockRecordFeeSnapshot,
}));

vi.mock('../../../../src/services/autopilot/evaluator', () => ({
  evaluateAllWallets: mockEvaluateAllWallets,
}));

import {
  autopilotJobs,
  evaluateJob,
  recordFeesJob,
} from '../../../../src/worker/jobs/autopilotJobs';

function readEvaluateLockKey(): string {
  const lockKey = evaluateJob.lockOptions?.lockKey;
  if (!lockKey) throw new Error('Autopilot evaluate lock key is missing');
  return Reflect.apply(lockKey, evaluateJob.lockOptions, [{ data: {} }]);
}

describe('worker autopilotJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports both autopilot jobs with expected static metadata', () => {
    expect(autopilotJobs).toHaveLength(2);
    expect(autopilotJobs.map((job) => job.name)).toEqual([
      'autopilot:record-fees',
      'autopilot:evaluate',
    ]);
    expect(autopilotJobs.every((job) => job.queue === 'maintenance')).toBe(true);
  });

  it('executes record-fees handler by delegating to fee monitor', async () => {
    mockRecordFeeSnapshot.mockResolvedValueOnce(undefined);

    await expect(
      Reflect.apply(recordFeesJob.handler, recordFeesJob, [{ data: {} }])
    ).resolves.toBeUndefined();
    expect(mockRecordFeeSnapshot).toHaveBeenCalledTimes(1);
    expect(recordFeesJob.options).toEqual({ attempts: 2 });
  });

  it('executes evaluate handler and exposes lock configuration', async () => {
    mockEvaluateAllWallets.mockResolvedValueOnce(undefined);

    await expect(
      Reflect.apply(evaluateJob.handler, evaluateJob, [{ data: {} }])
    ).resolves.toBeUndefined();
    expect(mockEvaluateAllWallets).toHaveBeenCalledTimes(1);

    expect(evaluateJob.options).toEqual({ attempts: 1 });
    expect(readEvaluateLockKey()).toBe('autopilot:evaluate');
    expect(evaluateJob.lockOptions?.lockTtlMs).toBe(120_000);
  });

  it('forwards the execution signal to the long-running evaluator', async () => {
    const controller = new AbortController();
    const execution = {
      signal: controller.signal,
      throwIfAborted: () => controller.signal.throwIfAborted(),
    };
    mockEvaluateAllWallets.mockResolvedValueOnce(undefined);

    await Reflect.apply(evaluateJob.handler, evaluateJob, [{ data: {} }, execution]);

    expect(mockEvaluateAllWallets).toHaveBeenCalledWith(controller.signal);
  });
});
