import type { Job } from 'bullmq';
import { vi } from 'vitest';

export function createMockJob<T>(data: T, opts?: Partial<Job<T>>): Job<T> {
  return {
    id: 'test-job-id',
    data,
    attemptsMade: 0,
    opts: { attempts: 5 },
    updateProgress: vi.fn().mockResolvedValue(undefined),
    ...opts,
  } as Job<T>;
}
