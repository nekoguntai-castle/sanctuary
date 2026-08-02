import type { JobsOptions } from "bullmq";

export const NOTIFICATION_RETENTION_CONTRACT_VERSION = 1 as const;

export const NOTIFICATION_JOB_FAMILIES = [
  "transaction",
  "draft",
  "consolidation",
  "webhook",
] as const;

export type NotificationJobFamily = (typeof NOTIFICATION_JOB_FAMILIES)[number];

export type NotificationRetentionLimit =
  { kind: "count"; count: number } | { kind: "immediate_removal" };

export interface NotificationRetentionPolicy {
  completed: NotificationRetentionLimit;
  failed: NotificationRetentionLimit;
}

const RETAINED_POLICY = Object.freeze({
  completed: Object.freeze({ kind: "count", count: 500 } as const),
  failed: Object.freeze({ kind: "count", count: 250 } as const),
});

const IMMEDIATE_REMOVAL_POLICY = Object.freeze({
  completed: Object.freeze({ kind: "immediate_removal" } as const),
  failed: Object.freeze({ kind: "immediate_removal" } as const),
});

/**
 * Enqueue-time retention is authoritative in BullMQ. Every notification
 * producer consumes this contract; worker handler defaults are not evidence of
 * the policy that produced an already-retained job.
 */
export const NOTIFICATION_RETENTION_POLICIES: Readonly<
  Record<NotificationJobFamily, NotificationRetentionPolicy>
> = Object.freeze({
  transaction: RETAINED_POLICY,
  draft: RETAINED_POLICY,
  consolidation: RETAINED_POLICY,
  webhook: IMMEDIATE_REMOVAL_POLICY,
});

function asJobOption(limit: NotificationRetentionLimit): boolean | number {
  return limit.kind === "immediate_removal" ? true : limit.count;
}

export function notificationRetentionJobOptions(
  family: NotificationJobFamily,
): Pick<JobsOptions, "removeOnComplete" | "removeOnFail"> {
  const policy = NOTIFICATION_RETENTION_POLICIES[family];
  return {
    removeOnComplete: asJobOption(policy.completed),
    removeOnFail: asJobOption(policy.failed),
  };
}

export const DEFAULT_NOTIFICATION_RETENTION_JOB_OPTIONS = Object.freeze(
  notificationRetentionJobOptions("transaction"),
);
