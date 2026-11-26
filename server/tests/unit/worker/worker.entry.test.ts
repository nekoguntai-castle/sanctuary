import { describe } from 'vitest';
import { registerWorkerEntrySetup } from './workerEntryTestHarness';
import { registerWorkerEntryCheckpointContracts } from './workerEntryCheckpoints.contracts';
import { registerWorkerEntryScheduleContracts } from './workerEntrySchedules.contracts';
import { registerWorkerEntryLifecycleContracts } from './workerEntryLifecycle.contracts';
import { registerWorkerEntryHealthContracts } from './workerEntryHealth.contracts';

describe('worker entrypoint', () => {
  registerWorkerEntrySetup();
  registerWorkerEntryCheckpointContracts();
  registerWorkerEntryScheduleContracts();
  registerWorkerEntryLifecycleContracts();
  registerWorkerEntryHealthContracts();
});
