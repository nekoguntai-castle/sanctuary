import { describe, expect, it } from "vitest";
import {
  SYNC_PROGRESS_EVENTS,
  SYNC_PROGRESS_MAX_COUNT,
  SYNC_PROGRESS_MAX_ELAPSED_MS,
  SYNC_PROGRESS_STAGES,
  SYNC_PROGRESS_UNITS,
  SYNC_EXECUTION_STAGES,
  SYNC_PHASE_PROGRESS_EVENTS,
  SYNC_PHASE_PROGRESS_UNITS,
  SyncPhaseProgressDetailsSchema,
  SyncProgressDetailsSchema,
} from "@sanctuary/shared/schemas/syncProgress";

const valid = {
  kind: "sync_progress",
  event: "stage_started",
  stage: "candidate_fetch",
  unit: "transactions",
  batch: 1,
  batchCount: 1,
  elapsedMs: 0,
} as const;

describe("SyncProgressDetailsSchema", () => {
  it("accepts every fixed event, stage, and unit", () => {
    for (const event of SYNC_PROGRESS_EVENTS) {
      const candidate =
        event === "batch_completed"
          ? { ...valid, event, completed: 0, total: 0 }
          : { ...valid, event };
      expect(SyncProgressDetailsSchema.safeParse(candidate).success).toBe(true);
    }
    for (const stage of SYNC_PROGRESS_STAGES) {
      expect(
        SyncProgressDetailsSchema.safeParse({ ...valid, stage }).success,
      ).toBe(true);
    }
    for (const unit of SYNC_PROGRESS_UNITS) {
      expect(
        SyncProgressDetailsSchema.safeParse({ ...valid, unit }).success,
      ).toBe(true);
    }
  });

  it("accepts bounded durable zero progress on batch completion", () => {
    expect(
      SyncProgressDetailsSchema.parse({
        ...valid,
        event: "batch_completed",
        elapsedMs: SYNC_PROGRESS_MAX_ELAPSED_MS,
        completed: 0,
        total: 0,
      }),
    ).toEqual(expect.objectContaining({ completed: 0, total: 0 }));
  });

  it.each([
    ["unknown key", { ...valid, private: true }],
    ["unknown event", { ...valid, event: "working" }],
    ["unknown stage", { ...valid, stage: "raw_error" }],
    ["unknown unit", { ...valid, unit: "wallet-1" }],
    ["negative elapsed", { ...valid, elapsedMs: -1 }],
    ["fractional elapsed", { ...valid, elapsedMs: 0.5 }],
    [
      "unbounded elapsed",
      { ...valid, elapsedMs: SYNC_PROGRESS_MAX_ELAPSED_MS + 1 },
    ],
    ["batch after batch count", { ...valid, batch: 2 }],
    ["unbounded count", { ...valid, batchCount: SYNC_PROGRESS_MAX_COUNT + 1 }],
    [
      "completed without total",
      { ...valid, event: "batch_completed", completed: 0 },
    ],
    [
      "completed beyond total",
      { ...valid, event: "batch_completed", completed: 2, total: 1 },
    ],
    ["non-durable completion", { ...valid, completed: 1, total: 1 }],
    ["non-finite value", { ...valid, elapsedMs: Number.POSITIVE_INFINITY }],
  ])("rejects %s", (_label, candidate) => {
    expect(SyncProgressDetailsSchema.safeParse(candidate).success).toBe(false);
  });
});

describe("SyncPhaseProgressDetailsSchema", () => {
  const phase = {
    kind: "sync_phase_progress",
    event: "stage_started",
    stage: "preflight",
    elapsedMs: 0,
  } as const;

  it("accepts every fixed stage, event, and truthful work-item unit", () => {
    for (const stage of SYNC_EXECUTION_STAGES) {
      expect(SyncPhaseProgressDetailsSchema.safeParse({ ...phase, stage }).success).toBe(true);
    }
    for (const event of SYNC_PHASE_PROGRESS_EVENTS) {
      expect(SyncPhaseProgressDetailsSchema.safeParse({ ...phase, event }).success).toBe(true);
    }
    for (const unit of SYNC_PHASE_PROGRESS_UNITS) {
      expect(SyncPhaseProgressDetailsSchema.safeParse({
        ...phase,
        workItems: { completed: 0, total: 1, unit },
      }).success).toBe(true);
    }
  });

  it.each([
    ["unknown key", { ...phase, overallPercent: 10 }],
    ["unknown stage", { ...phase, stage: "wallet-private" }],
    ["unknown event", { ...phase, event: "fallback" }],
    ["negative elapsed", { ...phase, elapsedMs: -1 }],
    ["unbounded elapsed", { ...phase, elapsedMs: SYNC_PROGRESS_MAX_ELAPSED_MS + 1 }],
    ["partial work items", { ...phase, workItems: { completed: 0, total: 1 } }],
    ["completed beyond total", {
      ...phase,
      workItems: { completed: 2, total: 1, unit: "addresses" },
    }],
    ["private work-item key", {
      ...phase,
      workItems: { completed: 0, total: 1, unit: "addresses", walletId: "private" },
    }],
  ])("rejects %s", (_label, candidate) => {
    expect(SyncPhaseProgressDetailsSchema.safeParse(candidate).success).toBe(false);
  });
});
