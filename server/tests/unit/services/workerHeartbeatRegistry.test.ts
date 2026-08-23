import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Redis from "ioredis";
import { WALLET_SYNC_MUTATION_FENCE_FLOOR } from "../../../src/constants/walletSyncActivation";
import {
  WorkerHeartbeatReader,
  WorkerHeartbeatWriter,
  workerFleetSnapshotSchema,
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

describe("privacy-safe worker heartbeat registry", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("writes a bounded versioned record without exporting the replica identity", async () => {
    const client = {
      status: "ready",
      eval: vi.fn().mockResolvedValue(1),
      disconnect: vi.fn(),
    };
    const writer = new WorkerHeartbeatWriter(
      () => snapshot(),
      () => client as unknown as Redis,
    );

    await writer.write(50_000);
    await writer.stop();

    expect(client.eval).toHaveBeenCalledOnce();
    const args = client.eval.mock.calls[0];
    expect(args[1]).toBe(4);
    expect(args[0]).toContain("previous_snapshot and 'collision' or 'restart'");
    expect(args).toContain(33);
    const serialized = args.find(
      (value: unknown) =>
        typeof value === "string" && value.includes("retentionContractVersion"),
    );
    expect(workerFleetSnapshotSchema.safeParse(serialized).success).toBe(false);
    expect(serialized).toContain(
      `"walletSyncMutationFenceFloor":${WALLET_SYNC_MUTATION_FENCE_FLOOR}`,
    );
    expect(String(serialized)).not.toMatch(/hostname|"replicaId"|"workerId"/i);
    expect(client.disconnect).toHaveBeenCalledWith(false);
  });

  it("uses a stable configured replica slot while keeping it internal", async () => {
    vi.stubEnv("WORKER_REPLICA_ID", "worker-slot-a");
    const clients = [
      {
        status: "ready",
        eval: vi.fn().mockResolvedValue(1),
        disconnect: vi.fn(),
      },
      {
        status: "ready",
        eval: vi.fn().mockResolvedValue(1),
        disconnect: vi.fn(),
      },
    ];
    const first = new WorkerHeartbeatWriter(
      () => snapshot(),
      () => clients[0] as unknown as Redis,
    );
    const second = new WorkerHeartbeatWriter(
      () => snapshot(),
      () => clients[1] as unknown as Redis,
    );

    await first.write(50_000);
    await second.write(60_000);
    const firstArgs = clients[0].eval.mock.calls[0];
    const secondArgs = clients[1].eval.mock.calls[0];
    expect(firstArgs[6]).toBe(secondArgs[6]);
    expect(firstArgs[6]).not.toBe("worker-slot-a");
    const serialized = firstArgs.find(
      (value: unknown) =>
        typeof value === "string" && value.includes("stableReplicaIdentity"),
    );
    expect(serialized).toContain('"stableReplicaIdentity":true');
    await Promise.all([first.stop(), second.stop()]);
  });

  it("connects a waiting writer and stops timer-driven best-effort writes", async () => {
    vi.useFakeTimers();
    const client = {
      status: "wait",
      connect: vi.fn().mockImplementation(function connect(this: {
        status: string;
      }) {
        this.status = "ready";
        return Promise.resolve();
      }),
      eval: vi
        .fn()
        .mockRejectedValueOnce(new Error("redis temporarily unavailable"))
        .mockRejectedValueOnce(new Error("redis still unavailable")),
      disconnect: vi.fn(),
    };
    const writer = new WorkerHeartbeatWriter(
      () => snapshot(),
      () => client as unknown as Redis,
    );

    writer.start();
    writer.start();
    await vi.advanceTimersByTimeAsync(10_000);
    await writer.stop();
    await writer.write();
    writer.start();

    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.eval).toHaveBeenCalledTimes(2);
    expect(client.disconnect).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("single-flights writes and force-disconnects a bounded stalled write", async () => {
    vi.useFakeTimers();
    const client = {
      status: "ready",
      eval: vi.fn().mockReturnValue(new Promise(() => undefined)),
      disconnect: vi.fn(),
    };
    const writer = new WorkerHeartbeatWriter(
      () => snapshot(),
      () => client as unknown as Redis,
    );

    const first = writer.write(50_000);
    const second = writer.write(50_001);
    const firstRejection = expect(first).rejects.toThrow(
      "worker_heartbeat_write_timeout",
    );
    const secondRejection = expect(second).rejects.toThrow(
      "worker_heartbeat_write_timeout",
    );
    await vi.advanceTimersByTimeAsync(1_000);

    await firstRejection;
    await secondRejection;
    expect(client.eval).toHaveBeenCalledOnce();
    expect(client.disconnect).toHaveBeenCalledWith(false);
    await writer.stop();
    vi.useRealTimers();
  });

  it("recovers from a timed-out write by using a fresh isolated client", async () => {
    vi.useFakeTimers();
    const stalledClient = {
      status: "ready",
      eval: vi.fn().mockReturnValue(new Promise(() => undefined)),
      disconnect: vi.fn(),
    };
    const freshClient = {
      status: "ready",
      eval: vi.fn().mockResolvedValue(1),
      disconnect: vi.fn(),
    };
    const createClient = vi
      .fn()
      .mockReturnValueOnce(stalledClient)
      .mockReturnValueOnce(freshClient);
    const writer = new WorkerHeartbeatWriter(
      () => snapshot(),
      createClient as () => Redis,
    );

    const timedOut = writer.write(50_000);
    const rejected = expect(timedOut).rejects.toThrow(
      "worker_heartbeat_write_timeout",
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await rejected;

    await writer.write(60_000);

    expect(createClient).toHaveBeenCalledTimes(2);
    expect(stalledClient.eval).toHaveBeenCalledOnce();
    expect(stalledClient.disconnect).toHaveBeenCalledWith(false);
    expect(freshClient.eval).toHaveBeenCalledOnce();
    await writer.stop();
    expect(freshClient.disconnect).toHaveBeenCalledWith(false);
    vi.useRealTimers();
  });

  it("fences post-connect writes and awaits bounded shutdown", async () => {
    vi.useFakeTimers();
    let finishConnect!: () => void;
    const client = {
      status: "wait",
      connect: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishConnect = resolve;
          }),
      ),
      eval: vi.fn(),
      disconnect: vi.fn(),
    };
    const writer = new WorkerHeartbeatWriter(
      () => snapshot(),
      () => client as unknown as Redis,
    );

    const writing = writer.write(50_000);
    const stopping = writer.stop();
    finishConnect();
    await stopping;
    await writing;

    expect(client.eval).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("awaits and contains an in-flight write failure during shutdown", async () => {
    vi.useFakeTimers();
    const client = {
      status: "ready",
      eval: vi.fn().mockReturnValue(new Promise(() => undefined)),
      disconnect: vi.fn(),
    };
    const writer = new WorkerHeartbeatWriter(
      () => snapshot(),
      () => client as unknown as Redis,
    );
    const writing = writer.write(50_000);
    const rejected = expect(writing).rejects.toThrow(
      "worker_heartbeat_write_timeout",
    );
    const stopping = writer.stop();

    await vi.advanceTimersByTimeAsync(1_000);
    await stopping;
    await rejected;
    expect(client.disconnect).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("aggregates multiple live workers without returning member or boot identifiers", async () => {
    const now = 100_000;
    const client = readerClient(
      ["member-a", "member-b"],
      [
        [null, stored("11111111-1111-4111-8111-111111111111", now - 1_000)],
        [null, null],
        [
          null,
          stored("22222222-2222-4222-8222-222222222222", now - 20_000, 1, {
            consumer: false,
            circuit: "open",
          }),
        ],
        [null, "1"],
      ],
    );

    const result = await new WorkerHeartbeatReader(
      () => client as unknown as Redis,
    ).read(now);
    expect(result).toEqual(
      expect.objectContaining({
        observation: "observed",
        coverage: "complete",
        workerCount: "2-5",
        oldestHeartbeatAge: "<1m",
        restartObserved: true,
        notificationConsumer: "mixed_or_unknown",
        transactionHandler: "all_running",
        telemetryWriterCircuit: "all_closed",
        telemetryDroppedEvents: "none",
        telegramCircuit: "any_open",
        retentionContract: "uniform",
      }),
    );
    expect(JSON.stringify(result)).not.toMatch(
      /member-a|member-b|11111111|22222222/,
    );
    expect(client.zrangebyscore).toHaveBeenCalledWith(
      expect.stringContaining(":members"),
      now - 15 * 60_000,
      "+inf",
      "WITHSCORES",
      "LIMIT",
      0,
      33,
    );
    expect(client.pipelineHandle.get).toHaveBeenCalledTimes(4);
    expect(client.disconnect).toHaveBeenCalledWith(false);
  });

  it("fails coverage closed for missing records and reports producer-version drift", async () => {
    const now = 100_000;
    const client = readerClient(
      ["current", "missing", "old"],
      [
        [null, stored("11111111-1111-4111-8111-111111111111", now)],
        [null, null],
        [null, null],
        [null, null],
        [null, stored("22222222-2222-4222-8222-222222222222", now, 2)],
        [null, null],
      ],
    );

    const result = await new WorkerHeartbeatReader(
      () => client as unknown as Redis,
    ).read(now);
    if (result.observation !== "observed") {
      throw new Error("expected observed worker heartbeat snapshot");
    }

    expect(result.coverage).toBe("degraded");
    expect(result.retentionContract).toBe("unknown");
    expect(result.workerCount).toBe("2-5");
    expect(result.transactionHandler).toBe("mixed_or_unknown");
    expect(result.telegramCircuit).toBe("mixed_or_unknown");
  });

  it("degrades restart coverage when no stable replica slot is configured", async () => {
    const now = 100_000;
    const client = readerClient(
      ["ephemeral"],
      [
        [
          null,
          stored("11111111-1111-4111-8111-111111111111", now, 1, {}, false),
        ],
        [null, null],
      ],
    );

    const result = await new WorkerHeartbeatReader(
      () => client as unknown as Redis,
    ).read(now);

    expect(result).toEqual(
      expect.objectContaining({
        observation: "observed",
        coverage: "degraded",
        restartObserved: false,
        retentionContract: "unknown",
      }),
    );
  });

  it("reports version drift only with complete stable membership", async () => {
    const now = 100_000;
    const client = readerClient(
      ["current", "old"],
      [
        [
          null,
          stored("11111111-1111-4111-8111-111111111111", now, 1, {
            consumer: false,
            handler: false,
          }),
        ],
        [null, null],
        [
          null,
          stored("22222222-2222-4222-8222-222222222222", now, 2, {
            consumer: false,
            handler: false,
          }),
        ],
        [null, null],
      ],
    );

    const result = await new WorkerHeartbeatReader(
      () => client as unknown as Redis,
    ).read(now);

    expect(result).toEqual(
      expect.objectContaining({
        observation: "observed",
        coverage: "complete",
        notificationConsumer: "none_running",
        transactionHandler: "none_running",
        telegramCircuit: "all_closed",
        retentionContract: "mixed_version",
      }),
    );
  });

  it("degrades a duplicate stable replica slot collision", async () => {
    const now = 100_000;
    const client = readerClient(
      ["colliding-slot"],
      [
        [
          null,
          stored("11111111-1111-4111-8111-111111111111", now, 1, {
            consumer: true,
            handler: true,
          }),
        ],
        [null, "collision"],
      ],
    );

    const result = await new WorkerHeartbeatReader(
      () => client as unknown as Redis,
    ).read(now);

    expect(result).toEqual(
      expect.objectContaining({
        observation: "observed",
        coverage: "degraded",
        restartObserved: true,
        notificationConsumer: "mixed_or_unknown",
        transactionHandler: "mixed_or_unknown",
        telegramCircuit: "mixed_or_unknown",
        retentionContract: "unknown",
      }),
    );
  });

  it("degrades when collision-marker inspection fails", async () => {
    const now = 100_000;
    const client = readerClient(
      ["worker"],
      [
        [null, stored("11111111-1111-4111-8111-111111111111", now)],
        [new Error("redis read failed"), null],
      ],
    );

    const result = await new WorkerHeartbeatReader(
      () => client as unknown as Redis,
    ).read(now);

    expect(result).toEqual(
      expect.objectContaining({
        coverage: "degraded",
        notificationConsumer: "mixed_or_unknown",
        telegramCircuit: "mixed_or_unknown",
      }),
    );
  });

  it("reports a half-open breaker only with complete stable membership", async () => {
    const now = 100_000;
    const client = readerClient(
      ["worker"],
      [
        [
          null,
          stored("11111111-1111-4111-8111-111111111111", now, 1, {
            circuit: "half-open",
          }),
        ],
        [null, null],
      ],
    );

    const result = await new WorkerHeartbeatReader(
      () => client as unknown as Redis,
    ).read(now);

    expect(result).toEqual(
      expect.objectContaining({
        coverage: "complete",
        telegramCircuit: "any_half_open",
      }),
    );
  });

  it("aggregates Telegram freshness and failure class without replica details", async () => {
    const now = 100_000;
    const client = readerClient(
      ["worker-a", "worker-b"],
      [
        [
          null,
          stored("11111111-1111-4111-8111-111111111111", now, 1, {
            lastSuccess: new Date(9_000).toISOString(),
            failureClass: "authentication",
          }),
        ],
        [null, null],
        [
          null,
          stored("22222222-2222-4222-8222-222222222222", now, 1, {
            lastSuccess: null,
            failureClass: "authentication",
          }),
        ],
        [null, null],
      ],
    );

    const result = await new WorkerHeartbeatReader(
      () => client as unknown as Redis,
    ).read(now);

    expect(result).toEqual(
      expect.objectContaining({
        coverage: "complete",
        telegramLastSuccessAge: "mixed_or_unknown",
        telegramLastFailureAge: "never",
        telegramFailureClass: "authentication",
      }),
    );
  });

  it.each([
    [
      { observation: "observed", circuit: "open", droppedEvents: "zero" },
      { telemetryWriterCircuit: "any_open", telemetryDroppedEvents: "none" },
    ],
    [
      { observation: "observed", circuit: "closed", droppedEvents: "one" },
      { telemetryWriterCircuit: "all_closed", telemetryDroppedEvents: "some" },
    ],
    [
      { observation: "unavailable" },
      {
        telemetryWriterCircuit: "mixed_or_unknown",
        telemetryDroppedEvents: "mixed_or_unknown",
      },
    ],
  ] as const)(
    "aggregates complete telemetry-writer health without identifiers: %j",
    async (telemetry, expected) => {
      const now = 100_000;
      const client = readerClient(
        ["worker"],
        [
          [
            null,
            stored("11111111-1111-4111-8111-111111111111", now, 1, {
              telemetry,
            }),
          ],
          [null, null],
        ],
      );

      const result = await new WorkerHeartbeatReader(
        () => client as unknown as Redis,
      ).read(now);

      expect(result).toEqual(
        expect.objectContaining({
          coverage: "complete",
          ...expected,
        }),
      );
    },
  );

  it("bounds fleet reads and reports incomplete same-version coverage as unknown", async () => {
    const now = 100_000;
    const members = Array.from({ length: 33 }, (_, index) => `member-${index}`);
    const replies = members.slice(0, 32).flatMap((_, index) => [
      [
        null,
        stored("11111111-1111-4111-8111-111111111111", now, 1, {
          consumer: false,
          handler: false,
          circuit: "half-open",
        }),
      ] as [Error | null, unknown],
      [null, null] as [Error | null, unknown],
    ]);
    const client = readerClient(members, replies);
    client.status = "wait";
    const connect = vi.fn().mockImplementation(() => {
      client.status = "ready";
      return Promise.resolve();
    });
    Object.assign(client, { connect });

    const result = await new WorkerHeartbeatReader(
      () => client as unknown as Redis,
    ).read(now);

    expect(result).toEqual(
      expect.objectContaining({
        coverage: "degraded",
        workerCount: "21-100",
        notificationConsumer: "mixed_or_unknown",
        transactionHandler: "mixed_or_unknown",
        telegramCircuit: "mixed_or_unknown",
        retentionContract: "unknown",
      }),
    );
    expect(connect).toHaveBeenCalledOnce();
    expect(client.pipelineHandle.get).toHaveBeenCalledTimes(64);
  });

  it("retains stale membership as degraded evidence while malformed reads stay unavailable", async () => {
    const now = 100_000;
    const malformed = readerClient(
      ["malformed"],
      [
        [null, "{"],
        [null, null],
      ],
    );
    const stale = readerClient(
      ["stale"],
      [
        [null, stored("11111111-1111-4111-8111-111111111111", now - 35_001)],
        [null, null],
      ],
      [now - 35_001],
    );
    const future = readerClient(
      ["future"],
      [
        [null, stored("11111111-1111-4111-8111-111111111111", now + 60_001)],
        [null, null],
      ],
    );
    const empty = readerClient([], []);
    const failedPipeline = readerClient(["worker"], []);
    failedPipeline.pipelineHandle.exec.mockResolvedValue(null);

    const [
      malformedResult,
      staleResult,
      futureResult,
      emptyResult,
      failedResult,
    ] = await Promise.all([
      new WorkerHeartbeatReader(() => malformed as unknown as Redis).read(now),
      new WorkerHeartbeatReader(() => stale as unknown as Redis).read(now),
      new WorkerHeartbeatReader(() => future as unknown as Redis).read(now),
      new WorkerHeartbeatReader(() => empty as unknown as Redis).read(now),
      new WorkerHeartbeatReader(() => failedPipeline as unknown as Redis).read(
        now,
      ),
    ]);

    expect(staleResult).toEqual(
      expect.objectContaining({
        observation: "observed",
        coverage: "degraded",
        workerCount: "1",
        notificationConsumer: "mixed_or_unknown",
        retentionContract: "unknown",
      }),
    );
    expect(
      [malformedResult, staleResult, futureResult].every(
        (result) =>
          result.observation === "observed" && result.coverage === "degraded",
      ),
    ).toBe(true);
    expect([emptyResult, failedResult]).toEqual([
      { version: 1, observation: "unavailable", coverage: "unavailable" },
      { version: 1, observation: "unavailable", coverage: "unavailable" },
    ]);
  });

  it("times out a stalled bounded registry read and disconnects the client", async () => {
    vi.useFakeTimers();
    const client = readerClient([], []);
    client.zrangebyscore.mockReturnValue(new Promise(() => undefined));
    const reading = new WorkerHeartbeatReader(
      () => client as unknown as Redis,
    ).read(100_000);

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(reading).resolves.toEqual({
      version: 1,
      observation: "timeout",
      coverage: "unavailable",
    });
    expect(client.disconnect).toHaveBeenCalledWith(false);
    vi.useRealTimers();
  });

  it("keeps unknown Telegram registration from appearing closed", async () => {
    const now = 100_000;
    const raw = JSON.parse(stored("11111111-1111-4111-8111-111111111111", now));
    raw.snapshot.telegram.circuitState = "not-registered";
    const client = readerClient(
      ["worker"],
      [
        [null, JSON.stringify(raw)],
        [null, null],
      ],
    );

    const result = await new WorkerHeartbeatReader(
      () => client as unknown as Redis,
    ).read(now);
    if (result.observation !== "observed") {
      throw new Error("expected observed worker heartbeat snapshot");
    }

    expect(result.telegramCircuit).toBe("mixed_or_unknown");
  });

  it("returns unavailable instead of a healthy zero when the registry read fails", async () => {
    const client = readerClient([], []);
    client.zrangebyscore.mockRejectedValue(new Error("private redis failure"));

    const result = await new WorkerHeartbeatReader(
      () => client as unknown as Redis,
    ).read(100_000);

    expect(result).toEqual({
      version: 1,
      observation: "unavailable",
      coverage: "unavailable",
    });
  });

  it("rejects malformed registry member-score pairs without exposing them", async () => {
    const odd = readerClient([], []);
    odd.zrangebyscore.mockResolvedValue(["member-without-score"]);
    const invalidScore = readerClient([], []);
    invalidScore.zrangebyscore.mockResolvedValue(["member", "not-a-number"]);

    await expect(
      new WorkerHeartbeatReader(() => odd as unknown as Redis).read(100_000),
    ).resolves.toEqual({
      version: 1,
      observation: "unavailable",
      coverage: "unavailable",
    });
    await expect(
      new WorkerHeartbeatReader(() => invalidScore as unknown as Redis).read(
        100_000,
      ),
    ).resolves.toEqual({
      version: 1,
      observation: "unavailable",
      coverage: "unavailable",
    });
  });

});
