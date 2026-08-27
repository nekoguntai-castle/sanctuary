import {
  SYNC_PROGRESS_MAX_COUNT,
  SYNC_PROGRESS_MAX_ELAPSED_MS,
  SyncProgressDetailsSchema,
  type SyncProgressDetails,
  type SyncProgressStage,
  type SyncProgressUnit,
} from "@sanctuary/shared/schemas/syncProgress";
import { walletLog } from "../../../../../websocket/notifications";
import type { SyncAttemptTelemetry } from "../../attemptRuntime";
import type { SyncPhaseProgress } from '../../phaseProgress';

type ProgressEvent = SyncProgressDetails["event"];

interface CandidateBatchProgress {
  start(
    stage: SyncProgressStage,
    unit: SyncProgressUnit,
    message: string,
  ): void;
  fallback(message: string): void;
  complete(completed: number, total: number): void;
  terminal(event: "timeout" | "aborted", message: string): void;
  candidates(fetched: number, rejected: number): void;
}

const boundedInteger = (value: number, maximum: number): number =>
  Math.min(
    maximum,
    Math.max(0, Math.floor(Number.isFinite(value) ? value : 0)),
  );

export function createCandidateBatchProgress(
  walletId: string,
  batch: number,
  batchCount: number,
  now: () => number = Date.now,
  telemetry?: SyncAttemptTelemetry,
  phaseProgress?: SyncPhaseProgress,
): CandidateBatchProgress {
  const normalizedBatchCount = Math.max(
    1,
    boundedInteger(batchCount, SYNC_PROGRESS_MAX_COUNT),
  );
  const normalizedBatch = Math.max(
    1,
    Math.min(
      normalizedBatchCount,
      boundedInteger(batch, SYNC_PROGRESS_MAX_COUNT),
    ),
  );
  let stage: SyncProgressStage = "candidate_fetch";
  let unit: SyncProgressUnit = "transactions";
  let stageStartedAt = now();

  const emit = (
    event: ProgressEvent,
    message: string,
    durable?: { completed: number; total: number },
  ): void => {
    const elapsedMs = boundedInteger(
      now() - stageStartedAt,
      SYNC_PROGRESS_MAX_ELAPSED_MS,
    );
    const details = SyncProgressDetailsSchema.parse({
      kind: "sync_progress",
      event,
      stage,
      unit,
      batch: normalizedBatch,
      batchCount: normalizedBatchCount,
      elapsedMs,
      ...(durable
        ? {
            completed: boundedInteger(
              durable.completed,
              SYNC_PROGRESS_MAX_COUNT,
            ),
            total: boundedInteger(durable.total, SYNC_PROGRESS_MAX_COUNT),
          }
        : {}),
    });
    walletLog(
      walletId,
      event === "fallback" ? "warn" : "info",
      "SYNC",
      message,
      details,
    );
    telemetry?.observeProgress(details);
  };

  return {
    start(nextStage, nextUnit, message) {
      stage = nextStage;
      unit = nextUnit;
      stageStartedAt = now();
      phaseProgress?.begin(nextStage, message);
      emit("stage_started", message);
    },
    fallback(message) {
      phaseProgress?.budgetExpired(message);
      emit("fallback", message);
    },
    complete(completed, total) {
      const boundedTotal = boundedInteger(total, SYNC_PROGRESS_MAX_COUNT);
      phaseProgress?.finish('stage_completed', 'Transaction candidate stage completed.');
      emit("batch_completed", "Transaction batch saved.", {
        completed: Math.min(
          boundedInteger(completed, SYNC_PROGRESS_MAX_COUNT),
          boundedTotal,
        ),
        total: boundedTotal,
      });
      phaseProgress?.begin(
        'transaction_reconciliation',
        'Continuing transaction reconciliation.',
      );
    },
    terminal(event, message) {
      phaseProgress?.finish('stage_aborted', message);
      emit(event, message);
    },
    candidates(fetched, rejected) {
      telemetry?.recordCandidates(fetched, rejected);
    },
  };
}
