import { beforeEach, describe, expect, it, vi } from "vitest";

const { collectorMap, collectorDefinitions, mockQueue, mockWorker, mockFleet, mockTelemetryRead } =
  vi.hoisted(() => ({
    collectorMap: new Map<string, () => Promise<unknown>>(),
    collectorDefinitions: new Map<string, Record<string, unknown>>(),
    mockQueue: vi.fn(),
    mockWorker: vi.fn(),
    mockFleet: vi.fn(),
    mockTelemetryRead: vi.fn(),
  }));

vi.mock("../../../../src/services/supportPackage/collectors/registry", () => ({
  registerShareableCollector: (
    name: string,
    definition: { collect: () => Promise<unknown> } & Record<string, unknown>,
  ) => {
    collectorMap.set(name, definition.collect);
    collectorDefinitions.set(name, definition);
  },
}));
vi.mock("../../../../src/infrastructure/workerQueueReader", () => ({
  readNotificationQueue: (...args: unknown[]) => mockQueue(...args),
}));
vi.mock("../../../../src/services/workerDiagnosticsClient", () => ({
  requestWorkerDiagnostics: (...args: unknown[]) => mockWorker(...args),
}));
vi.mock(
  "../../../../src/services/workerHeartbeatRegistry",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../../src/services/workerHeartbeatRegistry")
      >();
    return {
      ...actual,
      WorkerHeartbeatReader: class {
        read = mockFleet;
      },
    };
  },
);
vi.mock(
  "../../../../src/services/notifications/telemetryReader",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../../src/services/notifications/telemetryReader")
      >();
    return {
      ...actual,
      NotificationTelemetryReader: class {
        read = mockTelemetryRead;
      },
    };
  },
);

import "../../../../src/services/supportPackage/collectors/notificationQueue";
import "../../../../src/services/supportPackage/collectors/notificationWorker";
import "../../../../src/services/supportPackage/collectors/notificationWorkerFleet";
import "../../../../src/services/supportPackage/collectors/notificationTelemetry";
import {
  notificationQueueSchema,
  notificationWorkerSchema,
} from "../../../../src/services/supportPackage/collectors/notificationRuntimeSchemas";
import { notificationTelemetrySnapshotSchema } from "../../../../src/services/notifications/telemetryReader";
import { NOTIFICATION_QUEUE_STATES } from "../../../../src/internal/workerQueues";
import { workerFleetSnapshotSchema } from "../../../../src/services/workerHeartbeatRegistry";
import { buildWorkerDiagnosticsSnapshot } from "../../../../src/worker/diagnostics/snapshot";
import { serializePrivacySafeArtifact } from "../../../../src/services/supportPackage/privacy";

function unavailableQueue() {
  return {
    consistency: "approximate_non_atomic",
    retention: {
      contractVersion: 1,
      producerCompatibility: "unknown",
      families: Object.fromEntries(
        ["transaction", "draft", "consolidation", "webhook"].map((family) => [
          family,
          {
            classification:
              family === "webhook" ? "immediate_removal" : "uniform",
            completed:
              family === "webhook"
                ? { kind: "immediate_removal" }
                : { kind: "count", count: 500 },
            failed:
              family === "webhook"
                ? { kind: "immediate_removal" }
                : { kind: "count", count: 250 },
            retainedAge: { status: "unsupported" },
          },
        ]),
      ),
    },
    paused: { status: "unavailable" },
    states: Object.fromEntries(
      NOTIFICATION_QUEUE_STATES.map((state) => [
        state,
        {
          count: { status: "unavailable" },
          oldestAge: { status: "unavailable" },
        },
      ]),
    ),
  };
}

function unavailableTelemetry() {
  const window = {
    observation: "unavailable",
    coverage: "unavailable",
    records: [],
    truncated: false,
    droppedDimensionBucket: "zero",
    sources: {
      api: { observation: "unavailable" },
      worker: { observation: "unavailable" },
    },
  };
  return {
    version: 1,
    localWriter: { observation: "unavailable" },
    windows: { fiveMinutes: window, oneHour: window, twentyFourHours: window },
  };
}

describe("notification runtime support collectors", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps failed queue reads unavailable rather than converting them to zero", async () => {
    mockQueue.mockResolvedValue(unavailableQueue());
    const result = await collectorMap.get("notificationQueue")?.();
    expect(notificationQueueSchema.safeParse(result).success).toBe(true);
    expect(JSON.stringify(result)).not.toContain('"value":0');
  });

  it("preserves mixed-version worker unsupported state", async () => {
    mockWorker.mockResolvedValue({ status: "unsupported" });
    const result = await collectorMap.get("notificationWorker")?.();
    expect(result).toEqual({ status: "unsupported" });
    expect(notificationWorkerSchema.safeParse(result).success).toBe(true);
  });

  it("carries strict sampled execution diagnostics without making them fleet-authoritative", async () => {
    const snapshot = buildWorkerDiagnosticsSnapshot({
      workerStartedAt: 1,
      concurrency: 1,
      redisConnected: true,
      notificationConsumerRunning: true,
      transactionHandlerRegistered: true,
      electrum: {
        managerRunning: false,
        connected: false,
        subscriptionOwner: false,
        subscribedAddresses: 0,
      },
      walletSyncExecution: {
        version: 1,
        observation: "observed",
        scope: "sampled_worker",
        processEpochAge: "1h-24h",
        countersResetAge: "<1m",
        active: {
          total: "1",
          byStage: {
            candidate_fetch: "0",
            parent_fetch: "0",
            timestamp_fetch: "0",
            classification: "1",
            persistence: "0",
          },
          oldestProgressAge: "1m-15m",
        },
        counters: {
          started: "2-5",
          stageTransitions: "6-20",
          completed: "1",
          failed: "1",
          timedOut: "0",
          aborted: "0",
          budgetExpired: "1",
          lockLost: "0",
          stalePruned: "0",
        },
        redisLockAgreement: {
          agreement: "observed",
          registryWithOwnedLock: "1",
          registryMissingOwnedLock: "0",
          registryOwnershipMismatch: "0",
        },
      },
    }, 2);
    mockWorker.mockResolvedValue({ status: "observed", value: snapshot });

    const result = await collectorMap.get("notificationWorker")?.();

    expect(result).toMatchObject({
      status: "observed",
      value: {
        walletSyncExecution: {
          version: 1,
          observation: "observed",
          scope: "sampled_worker",
          redisLockAgreement: {
            agreement: "observed",
            registryOwnershipMismatch: "0",
          },
        },
      },
    });
    expect(notificationWorkerSchema.safeParse(result).success).toBe(true);
    expect(() => serializePrivacySafeArtifact(result)).not.toThrow();
    expect(JSON.stringify(result)).not.toMatch(/walletId|jobId|lockKey|token/i);
    expect(collectorDefinitions.get("notificationWorker")).toMatchObject({
      authoritativeFor: expect.arrayContaining(["wallet_sync_execution"]),
      notAuthoritativeFor: expect.arrayContaining([
        "wallet_sync_state",
        "wallet_incremental_sync_intent",
        "wallet_full_resync_intent",
        "wallet_sync_lease_row",
      ]),
    });
  });

  it("exports only aggregate fleet capability and fails partial coverage closed", async () => {
    mockFleet.mockResolvedValue({
      version: 1,
      observation: "observed",
      coverage: "degraded",
      workerCount: "2-5",
      oldestHeartbeatAge: "<1m",
      restartObserved: true,
      notificationConsumer: "mixed_or_unknown",
      transactionHandler: "all_running",
      telemetryWriterCircuit: "mixed_or_unknown",
      telemetryDroppedEvents: "mixed_or_unknown",
      telegramLastSuccessAge: "mixed_or_unknown",
      telegramLastFailureAge: "mixed_or_unknown",
      telegramFailureClass: "mixed_or_unknown",
      telegramCircuit: "any_open",
      retentionContract: "mixed_version",
    });
    const result = await collectorMap.get("notificationWorkerFleet")?.();
    expect(workerFleetSnapshotSchema.safeParse(result).success).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /replicaId|bootEpoch":"|hostname|workerId/i,
    );
  });

  it("omits factual fleet fields when the shared registry is unavailable", async () => {
    mockFleet.mockResolvedValue({
      version: 1,
      observation: "unavailable",
      coverage: "unavailable",
    });
    const result = await collectorMap.get("notificationWorkerFleet")?.();
    expect(workerFleetSnapshotSchema.safeParse(result).success).toBe(true);
    expect(result).toEqual({
      version: 1,
      observation: "unavailable",
      coverage: "unavailable",
    });
    expect(
      workerFleetSnapshotSchema.safeParse({
        version: 1,
        observation: "unavailable",
        coverage: "unavailable",
        workerCount: "0",
      }).success,
    ).toBe(false);
  });

  it("exports no event records when rolling telemetry is unavailable", async () => {
    mockTelemetryRead.mockResolvedValue(unavailableTelemetry());
    const result = await collectorMap.get("notificationTelemetry")?.();
    expect(notificationTelemetrySnapshotSchema.safeParse(result).success).toBe(
      true,
    );
    expect(JSON.stringify(result)).not.toMatch(/wallet|user|txid|jobId/i);
  });
});
