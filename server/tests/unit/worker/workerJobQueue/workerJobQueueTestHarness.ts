import { vi } from 'vitest';

// Define mock objects that will be shared
export const createdWorkers: Array<{ processFn?: (job: any) => Promise<any> }> = [];
const hoistedMocks = vi.hoisted(() => ({
  mockDlqAdd: vi.fn().mockResolvedValue(undefined),
}));
export const mockDlqAdd = hoistedMocks.mockDlqAdd;

// Mock BullMQ with factory that creates instances
vi.mock('bullmq', () => {
  // Create mock constructors that return fresh instances
  class MockQueue {
    add = vi.fn().mockResolvedValue({ id: 'job-1' });
    addBulk = vi.fn().mockResolvedValue([{ id: 'job-1' }, { id: 'job-2' }]);
    getRepeatableJobs = vi.fn().mockResolvedValue([]);
    removeRepeatableByKey = vi.fn().mockResolvedValue(undefined);
    getJobs = vi.fn().mockResolvedValue([]);
    getWaitingCount = vi.fn().mockResolvedValue(0);
    getActiveCount = vi.fn().mockResolvedValue(0);
    getCompletedCount = vi.fn().mockResolvedValue(0);
    getFailedCount = vi.fn().mockResolvedValue(0);
    getDelayedCount = vi.fn().mockResolvedValue(0);
    isPaused = vi.fn().mockResolvedValue(false);
    close = vi.fn().mockResolvedValue(undefined);
  }

  class MockWorker {
    processFn?: (job: any) => Promise<any>;
    constructor(_queueName?: string, processor?: (job: any) => Promise<any>) {
      this.processFn = processor;
      createdWorkers.push(this);
    }
    on = vi.fn();
    isRunning = vi.fn().mockReturnValue(true);
    close = vi.fn().mockResolvedValue(undefined);
  }

  class MockQueueEvents {
    close = vi.fn().mockResolvedValue(undefined);
  }

  return {
    Queue: MockQueue,
    Worker: MockWorker,
    QueueEvents: MockQueueEvents,
  };
});

// Mock Redis
vi.mock('../../../../src/infrastructure', () => ({
  getRedisClient: vi.fn(() => ({
    options: {
      host: 'localhost',
      port: 6379,
    },
  })),
  isRedisConnected: vi.fn(() => true),
}));

// Mock distributed lock
vi.mock('../../../../src/infrastructure/distributedLock', () => ({
  acquireLock: vi.fn().mockResolvedValue({ key: 'test', token: 'token' }),
  extendLock: vi.fn().mockResolvedValue({ key: 'test', token: 'token' }),
  releaseLock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../src/services/deadLetterQueue', () => ({
  deadLetterQueue: {
    add: hoistedMocks.mockDlqAdd,
  },
}));

import * as workerJobQueueModule from '../../../../src/worker/workerJobQueue';
import * as eventHandlersModule from '../../../../src/worker/workerJobQueue/eventHandlers';
import * as distributedLockModule from '../../../../src/infrastructure/distributedLock';
import type { WorkerJobHandler } from '../../../../src/worker/jobs/types';
import type { WorkerJobQueue as WorkerJobQueueType } from '../../../../src/worker/workerJobQueue';

export type { WorkerJobHandler };
export type WorkerJobQueueInstance = WorkerJobQueueType;
export type WorkerJobQueueAccessor = () => WorkerJobQueueType;

export const WorkerJobQueue = workerJobQueueModule.WorkerJobQueue;
export const setupWorkerEventHandlers = eventHandlersModule.setupWorkerEventHandlers;
export const queueToDlqCategory = eventHandlersModule.queueToDlqCategory;
export const acquireLock = distributedLockModule.acquireLock;
export const extendLock = distributedLockModule.extendLock;
export const releaseLock = distributedLockModule.releaseLock;

export const createDefaultWorkerJobQueue = (): WorkerJobQueueType => new WorkerJobQueue({
  concurrency: 3,
  queues: ['sync', 'notifications'],
});

export const setupWorkerJobQueueTest = (): WorkerJobQueueType => {
  vi.clearAllMocks();
  createdWorkers.length = 0;
  return createDefaultWorkerJobQueue();
};
