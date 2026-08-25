import { describe, expect, it, vi } from "vitest";
import type Redis from "ioredis";
import {
  WALLET_SYNC_MUTATION_FENCE_FLOOR,
  WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR,
} from "../../../src/constants/walletSyncActivation";
import {
  WorkerHeartbeatReader,
  workerMutationFenceReadinessSchema,
  workerSchedulerRetirementReadinessSchema,
} from "../../../src/services/workerHeartbeatRegistry";
import { buildWorkerDiagnosticsSnapshot } from "../../../src/worker/diagnostics/snapshot";

function snapshot(
  overrides: {
    consumer?: boolean;
    handler?: boolean;
    circuit?: "closed" | "open" | "half-open";
    lastSuccess?: string | null;
    lastFailure?: string | null;
    failureClass?: "none" | "authentication" | "timeout" | "unknown";
    telemetry?:
      | {
          observation: "observed";
          circuit: "closed" | "open";
          droppedEvents:
            "zero" | "one" | "two_to_five" | "six_to_twenty" | "over_twenty";
        }
      | { observation: "unavailable" };
  } = {},
) {
  return buildWorkerDiagnosticsSnapshot(
    {
      workerStartedAt: 1_000,
      concurrency: 5,
      redisConnected: true,
      databaseConnected: true,
      notificationConsumerRunning: overrides.consumer ?? true,
      transactionHandlerRegistered: overrides.handler ?? true,
      notificationTelemetryWriter: overrides.telemetry ?? {
        observation: "observed",
        circuit: "closed",
        droppedEvents: "zero",
      },
      electrum: {
        managerRunning: true,
        connected: true,
        subscriptionOwner: true,
        subscribedAddresses: 2,
      },
      telegramCircuit: {
        state: overrides.circuit ?? "closed",
        failures: 0,
        totalRequests: 1,
        lastFailure: overrides.lastFailure ?? null,
        lastSuccess: overrides.lastSuccess ?? null,
        lastFailureClass: overrides.failureClass ?? "unknown",
      },
    },
    10_000,
  );
}

function stored(
  bootEpoch: string,
  writtenAt: number,
  retentionContractVersion = 1,
  overrides: Parameters<typeof snapshot>[0] = {},
  stableReplicaIdentity = true,
  mutationFenceFloor: number | null = WALLET_SYNC_MUTATION_FENCE_FLOOR,
  schedulerRetirementFloor: number | null = WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR,
) {
  return JSON.stringify({
    version: 1,
    bootEpoch,
    writtenAt,
    stableReplicaIdentity,
    retentionContractVersion,
    ...(mutationFenceFloor === null
      ? {}
      : { walletSyncMutationFenceFloor: mutationFenceFloor }),
    ...(schedulerRetirementFloor === null
      ? {}
      : { walletSyncSchedulerRetirementFloor: schedulerRetirementFloor }),
    snapshot: snapshot(overrides),
  });
}

function readerClient(
  members: string[],
  replies: Array<[Error | null, unknown]>,
  scores = members.map((_, index) => 100_000 - index * 1_000),
) {
  const pipeline = {
    get: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue(replies),
  };
  return {
    status: "ready",
    zrangebyscore: vi
      .fn()
      .mockResolvedValue(
        members.flatMap((member, index) => [member, String(scores[index])]),
      ),
    pipeline: vi.fn(() => pipeline),
    disconnect: vi.fn(),
    pipelineHandle: pipeline,
  };
}

describe("wallet sync mutation-fence fleet readiness", () => {
  it("can reuse a process-owned Redis client and fails closed if none is available", async () => {
    const client = readerClient([], []);

    await expect(new WorkerHeartbeatReader(
      () => client as unknown as Redis,
      false,
    ).readMutationFenceReadiness(100_000)).resolves.toMatchObject({
      ready: false,
      reason: "no_workers",
    });
    expect(client.disconnect).not.toHaveBeenCalled();

    await expect(new WorkerHeartbeatReader(() => {
      throw new Error("Redis unavailable");
    }).readMutationFenceReadiness(100_000)).resolves.toMatchObject({
      ready: false,
      reason: "unavailable",
    });
  });

  const current = (bootEpoch: string, writtenAt: number) =>
    stored(bootEpoch, writtenAt);
  const old = (bootEpoch: string, writtenAt: number) =>
    stored(bootEpoch, writtenAt, 1, {}, true, null);

  it("returns an exact identity-free proof when every worker is current", async () => {
    const now = 100_000;
    const client = readerClient(
      ["worker-a", "worker-b"],
      [
        [null, current("11111111-1111-4111-8111-111111111111", now)],
        [null, null],
        [null, current("22222222-2222-4222-8222-222222222222", now)],
        [null, null],
      ],
    );

    const result = await new WorkerHeartbeatReader(
      () => client as unknown as Redis,
    ).readMutationFenceReadiness(now);

    expect(result).toEqual({
      ready: true,
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
    });
    expect(workerMutationFenceReadinessSchema.parse(result)).toEqual(result);
    expect(JSON.stringify(result)).not.toMatch(
      /worker-a|worker-b|11111111|22222222/,
    );
    expect(client.pipelineHandle.get).toHaveBeenCalledTimes(4);
    expect(client.disconnect).toHaveBeenCalledWith(false);
  });

  it("blocks a complete mixed fleet while accepting old heartbeat records", async () => {
    const now = 100_000;
    const client = readerClient(
      ["current", "old"],
      [
        [null, current("11111111-1111-4111-8111-111111111111", now)],
        [null, null],
        [null, old("22222222-2222-4222-8222-222222222222", now)],
        [null, null],
      ],
    );

    await expect(
      new WorkerHeartbeatReader(
        () => client as unknown as Redis,
      ).readMutationFenceReadiness(now),
    ).resolves.toEqual({
      ready: false,
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      reason: "worker_below_floor",
    });
  });

  it("blocks scheduler retirement for a pre-cutover worker that passes the mutation floor", async () => {
    const now = 100_000;
    const preCutover = stored(
      "11111111-1111-4111-8111-111111111111",
      now,
      1,
      {},
      true,
      WALLET_SYNC_MUTATION_FENCE_FLOOR,
      null,
    );
    const createClient = () => readerClient(
      ["pre-cutover"],
      [
        [null, preCutover],
        [null, null],
      ],
    ) as unknown as Redis;
    const reader = new WorkerHeartbeatReader(createClient);

    await expect(reader.readMutationFenceReadiness(now)).resolves.toEqual({
      ready: true,
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
    });
    const retirement = await reader.readSchedulerRetirementReadiness(now);
    expect(retirement).toEqual({
      ready: false,
      requiredFloor: WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR,
      reason: "worker_below_floor",
    });
    expect(workerSchedulerRetirementReadinessSchema.parse(retirement)).toEqual(retirement);
  });

  it("fails scheduler retirement closed for unavailable, empty, incomplete, and restarted fleets", async () => {
    const now = 100_000;
    const currentRecord = current(
      "11111111-1111-4111-8111-111111111111",
      now,
    );
    const unavailable = new WorkerHeartbeatReader(() => {
      throw new Error("Redis unavailable");
    });
    const empty = new WorkerHeartbeatReader(
      () => readerClient([], []) as unknown as Redis,
    );
    const incomplete = new WorkerHeartbeatReader(
      () => readerClient(
        ["missing"],
        [[null, null], [null, null]],
      ) as unknown as Redis,
    );
    const restarted = new WorkerHeartbeatReader(
      () => readerClient(
        ["restarted"],
        [[null, currentRecord], [null, "restart"]],
      ) as unknown as Redis,
    );

    await expect(Promise.all([
      unavailable.readSchedulerRetirementReadiness(now),
      empty.readSchedulerRetirementReadiness(now),
      incomplete.readSchedulerRetirementReadiness(now),
      restarted.readSchedulerRetirementReadiness(now),
    ])).resolves.toEqual([
      {
        ready: false,
        requiredFloor: WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR,
        reason: "unavailable",
      },
      {
        ready: false,
        requiredFloor: WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR,
        reason: "no_workers",
      },
      {
        ready: false,
        requiredFloor: WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR,
        reason: "incomplete_fleet",
      },
      {
        ready: false,
        requiredFloor: WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR,
        reason: "restart_observed",
      },
    ]);
  });

  it("returns scheduler-retirement readiness only when every live worker is current", async () => {
    const now = 100_000;
    const client = readerClient(
      ["current"],
      [
        [null, current("11111111-1111-4111-8111-111111111111", now)],
        [null, null],
      ],
    );

    await expect(new WorkerHeartbeatReader(
      () => client as unknown as Redis,
    ).readSchedulerRetirementReadiness(now)).resolves.toEqual({
      ready: true,
      requiredFloor: WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR,
    });
  });

  it("resets activation evidence after a non-colliding worker restart", async () => {
    const now = 100_000;
    const client = readerClient(
      ["restarted"],
      [
        [null, current("11111111-1111-4111-8111-111111111111", now)],
        [null, "restart"],
      ],
    );

    await expect(new WorkerHeartbeatReader(
      () => client as unknown as Redis,
    ).readMutationFenceReadiness(now)).resolves.toEqual({
      ready: false,
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      reason: "restart_observed",
    });
  });

  it.each([
    {
      name: "missing heartbeat",
      members: ["missing"],
      replies: [
        [null, null],
        [null, null],
      ],
    },
    {
      name: "malformed heartbeat",
      members: ["malformed"],
      replies: [
        [null, "{"],
        [null, null],
      ],
    },
    {
      name: "unstable replica identity",
      members: ["unstable"],
      replies: [
        [
          null,
          stored(
            "11111111-1111-4111-8111-111111111111",
            100_000,
            1,
            {},
            false,
          ),
        ],
        [null, null],
      ],
    },
    {
      name: "replica collision",
      members: ["collision"],
      replies: [
        [null, current("11111111-1111-4111-8111-111111111111", 100_000)],
        [null, "collision"],
      ],
    },
    {
      name: "stale heartbeat",
      members: ["stale"],
      replies: [
        [null, current("11111111-1111-4111-8111-111111111111", 64_999)],
        [null, null],
      ],
      scores: [64_999],
    },
  ])("fails closed for $name", async ({ members, replies, scores }) => {
    const client = readerClient(
      members,
      replies as Array<[Error | null, unknown]>,
      scores,
    );

    await expect(
      new WorkerHeartbeatReader(
        () => client as unknown as Redis,
      ).readMutationFenceReadiness(100_000),
    ).resolves.toEqual({
      ready: false,
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      reason: "incomplete_fleet",
    });
  });

  it("fails closed when the registry exceeds its bounded replica capacity", async () => {
    const now = 100_000;
    const members = Array.from(
      { length: 33 },
      (_, index) => `worker-${index}`,
    );
    const replies = members
      .slice(0, 32)
      .flatMap((_, index) => [
        [
          null,
          current(
            `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
            now,
          ),
        ] as [Error | null, unknown],
        [null, null] as [Error | null, unknown],
      ]);
    const client = readerClient(members, replies);

    await expect(
      new WorkerHeartbeatReader(
        () => client as unknown as Redis,
      ).readMutationFenceReadiness(now),
    ).resolves.toEqual({
      ready: false,
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      reason: "incomplete_fleet",
    });
    expect(client.pipelineHandle.get).toHaveBeenCalledTimes(64);
  });

  it("distinguishes no-worker, unavailable, and timeout evidence", async () => {
    vi.useFakeTimers();
    try {
      const empty = readerClient([], []);
      const failed = readerClient([], []);
      failed.zrangebyscore.mockRejectedValue(new Error("redis unavailable"));
      const stalled = readerClient([], []);
      stalled.zrangebyscore.mockReturnValue(new Promise(() => undefined));

      const emptyResult = await new WorkerHeartbeatReader(
        () => empty as unknown as Redis,
      ).readMutationFenceReadiness(100_000);
      const failedResult = await new WorkerHeartbeatReader(
        () => failed as unknown as Redis,
      ).readMutationFenceReadiness(100_000);
      const stalledResult = new WorkerHeartbeatReader(
        () => stalled as unknown as Redis,
      ).readMutationFenceReadiness(100_000);
      await vi.advanceTimersByTimeAsync(1_000);

      expect([emptyResult, failedResult, await stalledResult]).toEqual([
        {
          ready: false,
          requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
          reason: "no_workers",
        },
        {
          ready: false,
          requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
          reason: "unavailable",
        },
        {
          ready: false,
          requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
          reason: "timeout",
        },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
