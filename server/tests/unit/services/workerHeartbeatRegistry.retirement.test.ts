import { afterEach, describe, expect, it, vi } from "vitest";
import type Redis from "ioredis";
import { WorkerHeartbeatWriter } from "../../../src/services/workerHeartbeatRegistry";
import { buildWorkerDiagnosticsSnapshot } from "../../../src/worker/diagnostics/snapshot";

function snapshot() {
  return buildWorkerDiagnosticsSnapshot(
    {
      workerStartedAt: 1_000,
      concurrency: 5,
      redisConnected: true,
      databaseConnected: true,
      notificationConsumerRunning: true,
      transactionHandlerRegistered: true,
      notificationTelemetryWriter: {
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
        state: "closed",
        failures: 0,
        totalRequests: 1,
        lastFailure: null,
        lastSuccess: null,
        lastFailureClass: "unknown",
      },
    },
    10_000,
  );
}

interface HeartbeatSlotState {
  bootEpoch: string | null;
  snapshot: string | null;
  member: string | null;
  restartMarker: "collision" | "restart" | null;
}

function emptySlot(): HeartbeatSlotState {
  return {
    bootEpoch: null,
    snapshot: null,
    member: null,
    restartMarker: null,
  };
}

function statefulWriterClient(state: HeartbeatSlotState) {
  return {
    status: "ready",
    eval: vi.fn(
      async (
        script: string,
        _keyCount: number,
        _snapshotKey: string,
        _registryKey: string,
        _bootKey: string,
        _restartKey: string,
        replicaId: string,
        serializedOrBootEpoch: string,
        maybeBootEpoch?: string,
      ) => {
        if (script.includes("local previous_boot")) {
          if (state.bootEpoch && state.bootEpoch !== maybeBootEpoch) {
            state.restartMarker = state.snapshot ? "collision" : "restart";
          }
          state.snapshot = serializedOrBootEpoch;
          state.bootEpoch = maybeBootEpoch ?? null;
          state.member = replicaId;
          return 1;
        }

        if (state.bootEpoch !== serializedOrBootEpoch) return 0;
        state.snapshot = null;
        state.bootEpoch = null;
        state.member = null;
        state.restartMarker = null;
        return 1;
      },
    ),
    disconnect: vi.fn(),
  };
}

describe("worker heartbeat graceful retirement", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("retires an exact boot before a quick same-slot restart", async () => {
    vi.stubEnv("WORKER_REPLICA_ID", "worker-slot-a");
    const state = emptySlot();
    const clients: ReturnType<typeof statefulWriterClient>[] = [];
    const createClient = () => {
      const client = statefulWriterClient(state);
      clients.push(client);
      return client as unknown as Redis;
    };
    const first = new WorkerHeartbeatWriter(snapshot, createClient);

    await first.write(50_000);
    const firstBootEpoch = state.bootEpoch;
    await first.stop();

    expect(firstBootEpoch).toMatch(/^[0-9a-f-]{36}$/);
    expect(state).toEqual(emptySlot());
    const retireCall = clients[1].eval.mock.calls[0];
    expect(retireCall[0]).toContain("current_boot ~= ARGV[2]");
    expect(retireCall[0]).toContain("redis.call('ZREM', KEYS[2], ARGV[1])");
    expect(retireCall[7]).toBe(firstBootEpoch);

    const replacement = new WorkerHeartbeatWriter(snapshot, createClient);
    await replacement.write(60_000);

    expect(state.bootEpoch).not.toBe(firstBootEpoch);
    expect(state.restartMarker).toBeNull();
    await replacement.stop();
  });

  it("bounds restart evidence by the activation safety horizon", async () => {
    vi.stubEnv("WORKER_REPLICA_ID", "worker-slot-a");
    const client = statefulWriterClient(emptySlot());
    const writer = new WorkerHeartbeatWriter(
      snapshot,
      () => client as unknown as Redis,
    );

    await writer.write(50_000);

    const writeCall = client.eval.mock.calls[0] as unknown[];
    // max(15-minute registry retention, 31-minute execution drain horizon)
    expect(writeCall[12]).toBe(31 * 60_000);
    expect(writeCall[12]).not.toBe(24 * 60 * 60_000);
    await writer.stop();
  });

  it("never lets a stale boot retire a same-slot replacement", async () => {
    vi.stubEnv("WORKER_REPLICA_ID", "worker-slot-a");
    const state = emptySlot();
    const createClient = () => statefulWriterClient(state) as unknown as Redis;
    const stale = new WorkerHeartbeatWriter(snapshot, createClient);
    const replacement = new WorkerHeartbeatWriter(snapshot, createClient);

    await stale.write(50_000);
    const staleBootEpoch = state.bootEpoch;
    await replacement.write(60_000);
    const replacementBootEpoch = state.bootEpoch;
    const replacementSnapshot = state.snapshot;
    await stale.stop();

    expect(replacementBootEpoch).not.toBe(staleBootEpoch);
    expect(state).toEqual({
      bootEpoch: replacementBootEpoch,
      snapshot: replacementSnapshot,
      member: expect.any(String),
      restartMarker: "collision",
    });
    await replacement.stop();
  });

  it("retains crash evidence when the old boot does not stop gracefully", async () => {
    vi.stubEnv("WORKER_REPLICA_ID", "worker-slot-a");
    const state = emptySlot();
    const createClient = () => statefulWriterClient(state) as unknown as Redis;
    const crashed = new WorkerHeartbeatWriter(snapshot, createClient);
    const replacement = new WorkerHeartbeatWriter(snapshot, createClient);

    await crashed.write(50_000);
    const crashedBootEpoch = state.bootEpoch;
    await replacement.write(60_000);

    expect(state.bootEpoch).not.toBe(crashedBootEpoch);
    expect(state.snapshot).not.toBeNull();
    expect(state.member).not.toBeNull();
    expect(state.restartMarker).toBe("collision");
    await replacement.stop();
  });

  it("bounds a stalled retirement without issuing a late delete", async () => {
    vi.useFakeTimers();
    let finishConnect!: () => void;
    const writerClient = {
      status: "ready",
      eval: vi.fn().mockResolvedValue(1),
      disconnect: vi.fn(),
    };
    const retirementClient = {
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
    const createClient = vi
      .fn()
      .mockReturnValueOnce(writerClient)
      .mockReturnValueOnce(retirementClient);
    const writer = new WorkerHeartbeatWriter(
      snapshot,
      createClient as () => Redis,
    );

    await writer.write(50_000);
    const stopping = writer.stop();
    const duplicateStop = writer.stop();
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.all([stopping, duplicateStop]);
    finishConnect();
    await Promise.resolve();

    expect(retirementClient.connect).toHaveBeenCalledOnce();
    expect(retirementClient.eval).not.toHaveBeenCalled();
    expect(retirementClient.disconnect).toHaveBeenCalled();
  });

  it("contains retirement client creation failure", async () => {
    const client = {
      status: "ready",
      eval: vi.fn().mockResolvedValue(1),
      disconnect: vi.fn(),
    };
    const createClient = vi
      .fn()
      .mockReturnValueOnce(client)
      .mockImplementationOnce(() => {
        throw new Error("redis unavailable during retirement");
      });
    const writer = new WorkerHeartbeatWriter(
      snapshot,
      createClient as () => Redis,
    );

    await writer.write(50_000);
    await expect(writer.stop()).resolves.toBeUndefined();

    expect(createClient).toHaveBeenCalledTimes(2);
    expect(client.disconnect).toHaveBeenCalledOnce();
  });
});
