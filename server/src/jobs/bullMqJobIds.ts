import { Buffer } from "node:buffer";
import type { BulkJobOptions, JobsOptions } from "bullmq";

const BULLMQ_RESERVED_JOB_ID_SEPARATOR = ":";
const ENCODED_JOB_ID_PREFIX = "b64_";

type BullMqJobOptionsWithId = JobsOptions | BulkJobOptions;

export function toBullMqJobId(logicalJobId: string): string {
  if (!logicalJobId.includes(BULLMQ_RESERVED_JOB_ID_SEPARATOR)) {
    return logicalJobId;
  }

  return `${ENCODED_JOB_ID_PREFIX}${Buffer.from(logicalJobId, "utf8").toString("base64url")}`;
}

export function withBullMqSafeJobId<T extends BullMqJobOptionsWithId>(
  options: T,
): T;
export function withBullMqSafeJobId<T extends BullMqJobOptionsWithId>(
  options: T | undefined,
): T | undefined;
export function withBullMqSafeJobId<T extends BullMqJobOptionsWithId>(
  options: T | undefined,
): T | undefined {
  if (!options?.jobId) {
    return options;
  }

  const jobId = toBullMqJobId(options.jobId);
  if (jobId === options.jobId) {
    return options;
  }

  return { ...options, jobId } as T;
}
