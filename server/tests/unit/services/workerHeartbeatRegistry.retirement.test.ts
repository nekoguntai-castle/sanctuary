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
  bootValue: string | null;
  snapshot: string | null;
  member: string | null;
  restartMarker: string | null;
}

function emptySlot(): HeartbeatSlotState {
  return {
    bootValue: null,
    snapshot: null,
    member: null,
    restartMarker: null,
  };
}

const epochOf = (bootValue: string) => bootValue.split("|")[0];

/** Mirrors WRITE_SCRIPT/RETIRE_SCRIPT for one slot (Lua is covered by Redis integration). */
function statefulWriterClient(state: HeartbeatSlotState) {
  return {
    status: "ready",
    eval: vi.fn(async (script: string, ...rest: string[]) => {
      if (script.includes("local previous_boot")) {
        // rest: key count, five keys, then ARGV[1..].
        const [, , , , , , replicaId, record, bootValue, , , , , , firstWrite] = rest;
        const previous = state.bootValue;
        if (previous && epochOf(previous) !== epochOf(bootValue)) {
          const floors = /^[^|]+\|(\d+)\|(\d+)$/.exec(previous);
          if (firstWrite !== "1") {
            state.restartMarker = "collision";
          } else if (floors) {
            const fenced = `fenced|${floors[1]}|${floors[2]}`;
            const existing = /^fenced\|(\d+)\|(\d+)$/.exec(state.restartMarker ?? "");
            if (
              state.restartMarker === null
              || (existing && Number(floors[1]) <= Number(existing[1])
                && Number(floors[2]) <= Number(existing[2]))
            ) {
              state.restartMarker = fenced;
            }
          } else {
            state.restartMarker = state.snapshot ? "collision" : "restart";
          }
        }
        state.snapshot = record;
        state.bootValue = bootValue;
        state.member = replicaId;
        return 1;
      }

      // rest: key count, four keys, replica id, then epoch and floors.
      const [, , , , , , epoch, mutationFloor, retirementFloor] = rest;
      if (!state.bootValue || epochOf(state.bootValue) !== epoch) return 0;
      state.snapshot = null;
      state.bootValue = null;
      state.member = null;
      const fenced = /^fenced\|(\d+)\|(\d+)$/.exec(state.restartMarker ?? "");
      if (
        fenced
        && Number(fenced[1]) >= Number(mutationFloor)
        && Number(fenced[2]) >= Number(retirementFloor)
      ) {
        state.restartMarker = null;
      }
      return 1;
    }),
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
    const firstBootValue = state.bootValue;
    expect(JSON.parse(state.snapshot!).walletSyncSchedulerRetirementFloor).toBe(2);
    await first.stop();

    expect(firstBootValue).toMatch(/^[0-9a-f-]{36}\|1\|2$/);
    expect(state).toEqual(emptySlot());
    const retireCall = clients[1].eval.mock.calls[0];
    expect(retireCall[0]).toContain("parse_boot(current_boot) ~= ARGV[2]");
    expect(retireCall[0]).toContain("redis.call('ZREM', KEYS[2], ARGV[1])");
    expect(retireCall[7]).toBe(epochOf(firstBootValue!));

    const replacement = new WorkerHeartbeatWriter(snapshot, createClient);
    await replacement.write(60_000);

    expect(state.bootValue).not.toBe(firstBootValue);
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
    // The 31-minute execution drain horizon, one heartbeat TTL and a 5-minute
    // clock-skew budget; never an arbitrary day-long marker.
    expect(writeCall[13]).toBe(31 * 60_000 + 35_000 + 5 * 60_000);
    expect(writeCall[13]).not.toBe(24 * 60 * 60_000);
    await writer.stop();
  });

  it("never lets a stale boot retire a same-slot replacement", async () => {
    vi.stubEnv("WORKER_REPLICA_ID", "worker-slot-a");
    const state = emptySlot();
    const createClient = () => statefulWriterClient(state) as unknown as Redis;
    const stale = new WorkerHeartbeatWriter(snapshot, createClient);
    const replacement = new WorkerHeartbeatWriter(snapshot, createClient);

    await stale.write(50_000);
    const staleBootValue = state.bootValue;
    await replacement.write(60_000);
    const replacementBootValue = state.bootValue;
    const replacementSnapshot = state.snapshot;
    await stale.stop();

    expect(replacementBootValue).not.toBe(staleBootValue);
    expect(state).toEqual({
      bootValue: replacementBootValue,
      snapshot: replacementSnapshot,
      member: expect.any(String),
      restartMarker: "fenced|1|2",
    });
    await replacement.stop();
  });

  it("records fenced crash evidence naming the predecessor's floors", async () => {
    vi.stubEnv("WORKER_REPLICA_ID", "worker-slot-a");
    const state = emptySlot();
    const createClient = () => statefulWriterClient(state) as unknown as Redis;
    const crashed = new WorkerHeartbeatWriter(snapshot, createClient);
    const replacement = new WorkerHeartbeatWriter(snapshot, createClient);

    await crashed.write(50_000);
    const crashedBootValue = state.bootValue;
    await replacement.write(60_000);

    expect(state.bootValue).not.toBe(crashedBootValue);
    expect(state.snapshot).not.toBeNull();
    expect(state.member).not.toBeNull();
    expect(state.restartMarker).toBe("fenced|1|2");
    // A fenced marker that blocks neither reader leaves with a clean retirement.
    await replacement.stop();
    expect(state.restartMarker).toBeNull();
  });

  it("keeps blocking evidence about an unknown predecessor past a clean retirement", async () => {
    vi.stubEnv("WORKER_REPLICA_ID", "worker-slot-a");
    const state = { ...emptySlot(), bootValue: "legacy-epoch", snapshot: "{}", member: "slot" };
    const createClient = () => statefulWriterClient(state) as unknown as Redis;
    const replacement = new WorkerHeartbeatWriter(snapshot, createClient);

    await replacement.write(60_000);
    expect(state.restartMarker).toBe("collision");
    await replacement.stop();

    expect(state.restartMarker).toBe("collision");
    expect(state.bootValue).toBeNull();
  });

  it("marks a live duplicate of the slot as a blocking collision on its next write", async () => {
    vi.stubEnv("WORKER_REPLICA_ID", "worker-slot-a");
    const state = emptySlot();
    const createClient = () => statefulWriterClient(state) as unknown as Redis;
    const original = new WorkerHeartbeatWriter(snapshot, createClient);
    const duplicate = new WorkerHeartbeatWriter(snapshot, createClient);

    await original.write(50_000);
    await duplicate.write(55_000);
    expect(state.restartMarker).toBe("fenced|1|2");
    await original.write(60_000);

    expect(state.restartMarker).toBe("collision");
    // A blocking marker is never weakened by a later fenced classification.
    const late = new WorkerHeartbeatWriter(snapshot, createClient);
    await late.write(65_000);
    expect(state.restartMarker).toBe("collision");
    await Promise.all([original.stop(), duplicate.stop(), late.stop()]);
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
