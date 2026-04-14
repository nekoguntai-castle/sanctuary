/**
 * WorkerJobQueue Tests
 *
 * Tests for the BullMQ-based worker job queue.
 */

import { beforeEach, describe } from 'vitest';

import { registerWorkerJobQueueCoreContracts } from './workerJobQueue/workerJobQueue.core.contracts';
import { registerWorkerJobQueueHealthLifecycleContracts } from './workerJobQueue/workerJobQueue.health-lifecycle.contracts';
import { registerWorkerJobQueueInternalBranchContracts } from './workerJobQueue/workerJobQueue.internal-branches.contracts';
import { registerWorkerJobQueueInternalEventContracts } from './workerJobQueue/workerJobQueue.internal-events.contracts';
import { registerWorkerJobQueueInternalLockContracts } from './workerJobQueue/workerJobQueue.internal-locks.contracts';
import { registerWorkerJobQueueRecurringContracts } from './workerJobQueue/workerJobQueue.recurring.contracts';
import {
  setupWorkerJobQueueTest,
  type WorkerJobQueueInstance,
} from './workerJobQueue/workerJobQueueTestHarness';

describe('WorkerJobQueue', () => {
  let queue: WorkerJobQueueInstance;
  const getQueue = () => queue;

  beforeEach(() => {
    queue = setupWorkerJobQueueTest();
  });

  registerWorkerJobQueueCoreContracts(getQueue);
  registerWorkerJobQueueRecurringContracts(getQueue);
  registerWorkerJobQueueHealthLifecycleContracts(getQueue);

  describe('internal behavior and error paths', () => {
    registerWorkerJobQueueInternalEventContracts(getQueue);
    registerWorkerJobQueueInternalLockContracts(getQueue);
    registerWorkerJobQueueInternalBranchContracts(getQueue);
  });
});
