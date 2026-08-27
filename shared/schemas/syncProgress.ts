import { z } from "zod";

export const SYNC_PROGRESS_STAGES = [
  "candidate_fetch",
  "parent_fetch",
  "timestamp_fetch",
  "classification",
  "persistence",
] as const;

export const SYNC_PROGRESS_EVENTS = [
  "stage_started",
  "fallback",
  "batch_completed",
  "timeout",
  "aborted",
] as const;

export const SYNC_PROGRESS_UNITS = ["transactions", "block_heights"] as const;

export const SYNC_EXECUTION_STAGES = [
  "preflight",
  "initial_network",
  "address_history",
  "transaction_reconciliation",
  ...SYNC_PROGRESS_STAGES,
  "utxo_reconciliation",
  "address_maintenance",
  "missing_field_repair",
  "subscription_enrollment",
  "finalization",
] as const;

export const SYNC_PHASE_PROGRESS_EVENTS = [
  "stage_started",
  "stage_completed",
  "stage_failed",
  "stage_aborted",
] as const;

export const SYNC_PHASE_PROGRESS_UNITS = [
  "addresses",
  "transactions",
  "utxos",
  "subscriptions",
] as const;

export const SYNC_PROGRESS_MAX_COUNT = 1_000_000;
export const SYNC_PROGRESS_MAX_ELAPSED_MS = 24 * 60 * 60 * 1_000;

const nonNegativeInteger = z.number().int().nonnegative();
const boundedCount = nonNegativeInteger.max(SYNC_PROGRESS_MAX_COUNT);

export const SyncProgressDetailsSchema = z
  .object({
    kind: z.literal("sync_progress"),
    event: z.enum(SYNC_PROGRESS_EVENTS),
    stage: z.enum(SYNC_PROGRESS_STAGES),
    unit: z.enum(SYNC_PROGRESS_UNITS),
    batch: z.number().int().positive().max(SYNC_PROGRESS_MAX_COUNT),
    batchCount: z.number().int().positive().max(SYNC_PROGRESS_MAX_COUNT),
    elapsedMs: nonNegativeInteger.max(SYNC_PROGRESS_MAX_ELAPSED_MS),
    completed: boundedCount.optional(),
    total: boundedCount.optional(),
  })
  .strict()
  .superRefine((details, ctx) => {
    if (details.batch > details.batchCount) {
      ctx.addIssue({
        code: "custom",
        path: ["batch"],
        message: "batch must not exceed batchCount",
      });
    }
    if ((details.completed === undefined) !== (details.total === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["completed"],
        message: "completed and total must be provided together",
      });
    }
    if (
      details.completed !== undefined &&
      details.total !== undefined &&
      details.completed > details.total
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["completed"],
        message: "completed must not exceed total",
      });
    }
    if (
      details.event !== "batch_completed" &&
      (details.completed !== undefined || details.total !== undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["completed"],
        message: "durable progress is only valid for batch_completed events",
      });
    }
  });

const SyncPhaseWorkItemsSchema = z.object({
  completed: boundedCount,
  total: boundedCount,
  unit: z.enum(SYNC_PHASE_PROGRESS_UNITS),
}).strict().superRefine((workItems, ctx) => {
  if (workItems.completed > workItems.total) {
    ctx.addIssue({
      code: "custom",
      path: ["completed"],
      message: "completed must not exceed total",
    });
  }
});

export const SyncPhaseProgressDetailsSchema = z.object({
  kind: z.literal("sync_phase_progress"),
  event: z.enum(SYNC_PHASE_PROGRESS_EVENTS),
  stage: z.enum(SYNC_EXECUTION_STAGES),
  elapsedMs: nonNegativeInteger.max(SYNC_PROGRESS_MAX_ELAPSED_MS),
  workItems: SyncPhaseWorkItemsSchema.optional(),
}).strict();

export type SyncProgressDetails = z.infer<typeof SyncProgressDetailsSchema>;
export type SyncProgressStage = SyncProgressDetails["stage"];
export type SyncProgressUnit = SyncProgressDetails["unit"];
export type SyncExecutionStage = (typeof SYNC_EXECUTION_STAGES)[number];
export type SyncPhaseProgressDetails = z.infer<typeof SyncPhaseProgressDetailsSchema>;
export type SyncPhaseProgressEvent = SyncPhaseProgressDetails["event"];
export type SyncPhaseProgressUnit = NonNullable<
  SyncPhaseProgressDetails["workItems"]
>["unit"];
