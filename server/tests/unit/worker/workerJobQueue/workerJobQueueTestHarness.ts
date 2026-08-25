import { vi } from 'vitest';

// Define mock objects that will be shared
export const createdWorkers: Array<{
  processFn?: (job: any) => Promise<any>;
  options?: { autorun?: boolean };
  run: ReturnType<typeof vi.fn>;
}> = [];
const hoistedMocks = vi.hoisted(() => ({
  capturedLogs: [] as Array<{ level: string; message: string; meta?: unknown }>,
  mockDlqAdd: vi.fn().mockResolvedValue(undefined),
  mockRecordNotificationTelemetry: vi.fn(),
  mockRecordCaptureTerminal: vi.fn(),
  mockHardTerminate: vi.fn((_exitCode: number): never => {
    throw new Error('test hard termination');
  }),
  mockRedis: {
    options: {
      host: 'localhost',
      port: 6379,
    },
    eval: vi.fn().mockImplementation(
      (script: string, _keyCount: number, ...args: unknown[]) => {
        if (!script.includes('local replacement')) return Promise.resolve(1);
        return Promise.resolve(JSON.stringify({
          version: Number(args[2]),
          schedulerId: String(args[3]),
          recurrenceFingerprint: String(args[4]),
          generationToken: String(args[5]),
          activatedAt: 1_000,
        }));
      },
    ),
    mget: vi.fn().mockResolvedValue([]),
    del: vi.fn().mockResolvedValue(1),
  },
}));
export const capturedLogs = hoistedMocks.capturedLogs;
export const mockDlqAdd = hoistedMocks.mockDlqAdd;
export const mockRecordNotificationTelemetry = hoistedMocks.mockRecordNotificationTelemetry;
export const mockRecordCaptureTerminal = hoistedMocks.mockRecordCaptureTerminal;
export const mockHardTerminate = hoistedMocks.mockHardTerminate;
export const mockRedis = hoistedMocks.mockRedis;

// Mock BullMQ with factory that creates instances
vi.mock('bullmq', () => {
  // Create mock constructors that return fresh instances
  class MockQueue {
    add = vi.fn().mockResolvedValue({ id: 'job-1' });
    addBulk = vi.fn().mockResolvedValue([{ id: 'job-1' }, { id: 'job-2' }]);
    getRepeatableJobs = vi.fn().mockResolvedValue([]);
    getJobSchedulers = vi.fn().mockResolvedValue([]);
    upsertJobScheduler = vi.fn().mockResolvedValue({ id: 'repeat-job-1' });
    removeJobScheduler = vi.fn().mockResolvedValue(true);
    removeRepeatableByKey = vi.fn().mockResolvedValue(undefined);
    getJobs = vi.fn().mockResolvedValue([]);
    getJob = vi.fn().mockResolvedValue(undefined);
    getJobCounts = vi.fn().mockResolvedValue({});
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
    options?: { autorun?: boolean };
    private running: boolean;
    run = vi.fn(async () => {
      this.running = true;
    });
    constructor(
      _queueName?: string,
      processor?: (job: any) => Promise<any>,
      options?: { autorun?: boolean },
    ) {
      this.processFn = processor;
      this.options = options;
      this.running = options?.autorun !== false;
      createdWorkers.push(this);
    }
    on = vi.fn();
    isRunning = vi.fn(() => this.running);
    close = vi.fn().mockResolvedValue(undefined);
  }

  class MockQueueEvents {
    close = vi.fn().mockResolvedValue(undefined);
  }

  class DelayedError extends Error {
    constructor() {
      super('bullmq:delayed');
      this.name = 'DelayedError';
    }
  }

  class UnrecoverableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'UnrecoverableError';
    }
  }

  return {
    Queue: MockQueue,
    Worker: MockWorker,
    QueueEvents: MockQueueEvents,
    DelayedError,
    UnrecoverableError,
  };
});

// Capture log output so lock-contention visibility can be asserted
vi.mock('../../../../src/utils/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/utils/logger')>();
  const record = (level: string) => (message: string, meta?: unknown) => {
    hoistedMocks.capturedLogs.push({ level, message, meta });
  };
  return {
    ...actual,
    createLogger: (prefix: string) => ({
      ...actual.createLogger(prefix),
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
    }),
  };
});

// Mock Redis
vi.mock('../../../../src/infrastructure', () => ({
  getRedisClient: vi.fn(() => hoistedMocks.mockRedis),
  isRedisConnected: vi.fn(() => true),
}));

// Mock distributed lock
vi.mock('../../../../src/infrastructure/distributedLock', () => ({
  acquireLock: vi.fn().mockResolvedValue({ key: 'test', token: 'token' }),
  extendLock: vi.fn().mockResolvedValue({ key: 'test', token: 'token' }),
  releaseLock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../src/worker/workerJobQueue/hardTermination', () => ({
  hardTerminateProcess: hoistedMocks.mockHardTerminate,
}));

vi.mock('../../../../src/services/deadLetterQueue', () => ({
  deadLetterQueue: {
    add: hoistedMocks.mockDlqAdd,
    addExhaustedJob: hoistedMocks.mockDlqAdd,
  },
}));

vi.mock('../../../../src/services/notifications/telemetry', () => ({
  recordNotificationTelemetry: hoistedMocks.mockRecordNotificationTelemetry,
}));

vi.mock('../../../../src/services/supportPackage/capture', () => ({
  controlledCaptureObservations: {
    recordTerminal: hoistedMocks.mockRecordCaptureTerminal,
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
  hoistedMocks.capturedLogs.length = 0;
  return createDefaultWorkerJobQueue();
};
