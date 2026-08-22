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

/**
 * Recover a logical ID produced by `toBullMqJobId`.
 * Malformed encoded values return null so retirement classifiers fail closed.
 */
export function fromBullMqJobId(jobId: string): string | null {
  if (!jobId.startsWith(ENCODED_JOB_ID_PREFIX)) return jobId;
  const encoded = jobId.slice(ENCODED_JOB_ID_PREFIX.length);
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  const decoded = Buffer.from(encoded, "base64url").toString("utf8");
  if (
    !decoded ||
    /[\u0000-\u001f\u007f]/.test(decoded) ||
    toBullMqJobId(decoded) !== jobId
  ) {
    return null;
  }
  return decoded;
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
