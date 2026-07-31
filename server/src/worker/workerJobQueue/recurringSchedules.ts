import type { JobsOptions } from 'bullmq';
import { isDeepStrictEqual } from 'node:util';
import { getErrorMessage } from '../../utils/errors';
import { createLogger } from '../../utils/logger';
import type {
  QueueInstance,
  RecurringScheduleDefinition,
  RecurringScheduleInspection,
  RecurringScheduleResult,
} from './types';

const log = createLogger('WORKER:QUEUE');

function hasExactSchedule<T>(
  schedulers: Awaited<ReturnType<QueueInstance['queue']['getJobSchedulers']>>,
  schedulerId: string,
  jobName: string,
  cron: string,
  data: T,
): boolean {
  return schedulers.some(
    (scheduler) =>
      scheduler.key === schedulerId &&
      scheduler.name === jobName &&
      scheduler.pattern === cron &&
      isDeepStrictEqual(scheduler.template?.data ?? {}, data),
  );
}

async function removeObsoleteSchedules(
  queueInstance: QueueInstance,
  schedulers: Awaited<ReturnType<QueueInstance['queue']['getJobSchedulers']>>,
  repeatableJobs: Awaited<ReturnType<QueueInstance['queue']['getRepeatableJobs']>>,
  schedulerId: string,
  jobName: string,
): Promise<void> {
  for (const existing of schedulers) {
    if (existing.name === jobName && existing.key !== schedulerId) {
      await queueInstance.queue.removeJobScheduler(existing.key);
    }
  }
  for (const existing of repeatableJobs) {
    const representedByScheduler = schedulers.some(
      (scheduler) => scheduler.key === existing.key,
    );
    if (
      existing.name === jobName &&
      existing.key !== schedulerId &&
      !representedByScheduler
    ) {
      await queueInstance.queue.removeRepeatableByKey(existing.key);
    }
  }
}

export async function reconcileRecurringSchedule<T>(
  queueInstance: QueueInstance | undefined,
  queueName: string,
  jobName: string,
  data: T,
  cron: string,
  options?: Omit<JobsOptions, 'repeat'>,
): Promise<RecurringScheduleResult> {
  if (!queueInstance) {
    log.warn(`Queue not found: ${queueName}`);
    return { status: 'failed', error: `Queue not found: ${queueName}` };
  }

  try {
    const schedulerId = `${queueName}:${jobName}`;
    const schedulers = await queueInstance.queue.getJobSchedulers();
    const repeatableJobs = await queueInstance.queue.getRepeatableJobs();
    const exact = hasExactSchedule(
      schedulers,
      schedulerId,
      jobName,
      cron,
      data,
    );
    if (!exact) {
      await queueInstance.queue.upsertJobScheduler(
        schedulerId,
        { pattern: cron },
        {
          name: jobName,
          data,
          opts: {
            ...options,
            removeOnComplete: options?.removeOnComplete ?? 10,
          },
        },
      );
    }
    await removeObsoleteSchedules(
      queueInstance,
      schedulers,
      repeatableJobs,
      schedulerId,
      jobName,
    );

    const status = exact ? 'unchanged' : 'created';
    log.info(`Reconciled recurring job: ${queueName}:${jobName}`, {
      cron,
      status,
    });
    return { status };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    log.error(`Failed to schedule recurring job: ${queueName}:${jobName}`, {
      error: errorMessage,
    });
    return { status: 'failed', error: errorMessage };
  }
}

function groupDefinitionsByQueue(
  definitions: RecurringScheduleDefinition[],
): Map<string, RecurringScheduleDefinition[]> {
  const grouped = new Map<string, RecurringScheduleDefinition[]>();
  for (const definition of definitions) {
    const queueDefinitions = grouped.get(definition.queue) ?? [];
    queueDefinitions.push(definition);
    grouped.set(definition.queue, queueDefinitions);
  }
  return grouped;
}

function inspectQueueDefinitions(
  schedulers: Awaited<ReturnType<QueueInstance['queue']['getJobSchedulers']>>,
  definitions: RecurringScheduleDefinition[],
  missing: string[],
  mismatched: string[],
): void {
  for (const definition of definitions) {
    const sameName = schedulers.filter(
      (scheduler) => scheduler.name === definition.name,
    );
    const desired = sameName.filter(
      (scheduler) =>
        scheduler.key === definition.schedulerId &&
        scheduler.pattern === definition.cron &&
        isDeepStrictEqual(scheduler.template?.data ?? {}, definition.data),
    );
    if (desired.length === 0) {
      missing.push(definition.schedulerId);
    } else if (sameName.length !== 1 || desired.length !== 1) {
      mismatched.push(definition.schedulerId);
    }
  }
}

export async function inspectRecurringScheduleDefinitions(
  queues: ReadonlyMap<string, QueueInstance>,
  definitions: RecurringScheduleDefinition[],
  forbiddenDefinitions: RecurringScheduleDefinition[] = [],
): Promise<RecurringScheduleInspection> {
  const missing: string[] = [];
  const mismatched: string[] = [];
  const unexpected: string[] = [];
  const inspectionFailures: string[] = [];
  const allDefinitions = [...definitions, ...forbiddenDefinitions];

  for (const [queueName, queueDefinitions] of groupDefinitionsByQueue(
    allDefinitions,
  )) {
    const queueInstance = queues.get(queueName);
    if (!queueInstance) {
      missing.push(
        ...queueDefinitions
          .filter((definition) => definitions.includes(definition))
          .map(({ schedulerId }) => schedulerId),
      );
      continue;
    }
    try {
      const schedulers = await queueInstance.queue.getJobSchedulers();
      const required = queueDefinitions.filter((definition) =>
        definitions.includes(definition),
      );
      inspectQueueDefinitions(
        schedulers,
        required,
        missing,
        mismatched,
      );
      for (const forbidden of queueDefinitions.filter((definition) =>
        forbiddenDefinitions.includes(definition),
      )) {
        if (schedulers.some(({ name }) => name === forbidden.name)) {
          unexpected.push(forbidden.schedulerId);
        }
      }
    } catch (error) {
      log.error(`Failed to inspect recurring schedules: ${queueName}`, {
        error: getErrorMessage(error),
      });
      missing.push(
        ...queueDefinitions
          .filter((definition) => definitions.includes(definition))
          .map(({ schedulerId }) => schedulerId),
      );
      inspectionFailures.push(queueName);
    }
  }

  return {
    healthy:
      missing.length === 0 &&
      mismatched.length === 0 &&
      unexpected.length === 0 &&
      inspectionFailures.length === 0,
    missing,
    mismatched,
    unexpected,
    inspectionFailures,
  };
}
