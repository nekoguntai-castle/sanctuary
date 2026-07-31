import { isDeepStrictEqual } from 'node:util';
import { getErrorMessage } from '../../utils/errors';
import { createLogger } from '../../utils/logger';
import type {
  QueueInstance,
  RecurringScheduleDefinition,
  RecurringScheduleInspection,
  RecurringScheduleResult,
} from './types';
import {
  hasExactRecurrence,
  validateRecurrence,
} from './recurringRecurrence';
import {
  unwrapRecurringJobData,
  wrapRecurringJobData,
} from './recurringJobEnvelope';

const log = createLogger('WORKER:QUEUE');

function hasExactSchedule<T>(
  schedulers: Awaited<ReturnType<QueueInstance['queue']['getJobSchedulers']>>,
  definition: RecurringScheduleDefinition<T>,
  generationToken?: string,
): boolean {
  return schedulers.some(
    (scheduler) =>
      scheduler.key === definition.schedulerId &&
      scheduler.name === definition.name &&
      hasExactRecurrence(scheduler, definition.recurrence) &&
      isDeepStrictEqual(
        scheduler.template?.data ?? {},
        wrapRecurringJobData(definition.data, generationToken),
      ),
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
  definition: RecurringScheduleDefinition<T>,
  generationToken?: string,
): Promise<RecurringScheduleResult> {
  const { queue: queueName, name: jobName } = definition;
  if (!queueInstance) {
    log.warn(`Queue not found: ${queueName}`);
    return { status: 'failed', error: `Queue not found: ${queueName}` };
  }

  try {
    if (definition.schedulerId !== `${queueName}:${jobName}`) {
      throw new Error('Recurring scheduler ID must match queue:name');
    }
    validateRecurrence(definition.recurrence);
    const schedulers = await queueInstance.queue.getJobSchedulers();
    const repeatableJobs = await queueInstance.queue.getRepeatableJobs();
    const exact = hasExactSchedule(schedulers, definition, generationToken);
    if (!exact) {
      await queueInstance.queue.upsertJobScheduler(
        definition.schedulerId,
        definition.recurrence,
        {
          name: jobName,
          data: wrapRecurringJobData(definition.data, generationToken),
          opts: {
            ...definition.options,
            removeOnComplete: definition.options?.removeOnComplete ?? 10,
          },
        },
      );
    }
    await removeObsoleteSchedules(
      queueInstance,
      schedulers,
      repeatableJobs,
      definition.schedulerId,
      jobName,
    );

    const status = exact ? 'unchanged' : 'created';
    log.info(`Reconciled recurring job: ${queueName}:${jobName}`, {
      recurrence: definition.recurrence,
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
        hasExactRecurrence(scheduler, definition.recurrence) &&
        isDeepStrictEqual(
          unwrapRecurringJobData(scheduler.template?.data)?.payload ??
            scheduler.template?.data ??
            {},
          definition.data,
        ),
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
