import { z } from "zod";
import { NOTIFICATION_QUEUE_STATES } from "../../../internal/workerQueues";
import {
  WalletSyncExecutionDiagnosticsSchema,
  WorkerDiagnosticsBareResponseSchema,
} from "../../../internal/workerDiagnostics/protocol";

const observed = <T extends z.ZodType>(value: T) =>
  z
    .object({
      status: z.literal("observed"),
      value,
    })
    .strict();

const unavailableObservation = z
  .object({
    status: z.enum(["unavailable", "timeout", "unsupported"]),
  })
  .strict();

const countObservation = z.union([
  observed(
    z
      .object({
        value: z.number().int().min(0).max(1_000_000),
        saturated: z.boolean(),
      })
      .strict(),
  ),
  unavailableObservation,
]);

const ageObservation = z.union([
  observed(
    z.enum([
      "none",
      "not_due",
      "lt_1m",
      "one_to_five_minutes",
      "five_minutes_to_one_hour",
      "one_to_twenty_four_hours",
      "gte_twenty_four_hours",
    ]),
  ),
  unavailableObservation,
]);

const queueStateSchema = z
  .object({
    count: countObservation,
    oldestAge: ageObservation,
  })
  .strict();

const retentionLimitSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("count"),
      count: z.number().int().positive().max(10_000),
    })
    .strict(),
  z.object({ kind: z.literal("immediate_removal") }).strict(),
]);

const retentionFamilySchema = z
  .object({
    classification: z.enum(["uniform", "immediate_removal"]),
    completed: retentionLimitSchema,
    failed: retentionLimitSchema,
    retainedAge: z.object({ status: z.literal("unsupported") }).strict(),
  })
  .strict();

export const notificationQueueSchema = z
  .object({
    consistency: z.literal("approximate_non_atomic"),
    paused: z.union([observed(z.boolean()), unavailableObservation]),
    states: z
      .object(
        Object.fromEntries(
          NOTIFICATION_QUEUE_STATES.map((state) => [state, queueStateSchema]),
        ) as Record<
          (typeof NOTIFICATION_QUEUE_STATES)[number],
          typeof queueStateSchema
        >,
      )
      .strict(),
    retention: z
      .object({
        contractVersion: z.literal(1),
        producerCompatibility: z.literal("unknown"),
        families: z
          .object({
            transaction: retentionFamilySchema,
            draft: retentionFamilySchema,
            consolidation: retentionFamilySchema,
            webhook: retentionFamilySchema,
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export const notificationWorkerSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("observed"),
      value: WorkerDiagnosticsBareResponseSchema,
      walletSyncExecution: z.union([
        observed(WalletSyncExecutionDiagnosticsSchema),
        z.object({ status: z.literal("unsupported") }).strict(),
      ]),
    })
    .strict(),
  unavailableObservation,
]);
