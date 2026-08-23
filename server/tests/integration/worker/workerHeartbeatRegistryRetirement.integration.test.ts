import { createHash, randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterEach, expect, it, vi } from "vitest";
import { WorkerHeartbeatWriter } from "../../../src/services/workerHeartbeatRegistry";
import { buildWorkerDiagnosticsSnapshot } from "../../../src/worker/diagnostics/snapshot";
import { describeWithRedis } from "../setup/redis";

const KEY_PREFIX = "sanctuary:diagnostics:worker-heartbeat:v1";

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

function redisClient(): Redis {
  const client = new Redis(process.env.REDIS_URL!, {
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  client.on("error", () => undefined);
  return client;
}

function slotKeys(slot: string) {
  const replicaId = createHash("sha256")
    .update(slot)
    .digest("hex")
    .slice(0, 32);
  return {
    replicaId,
    snapshot: `${KEY_PREFIX}:snapshot:${replicaId}`,
    registry: `${KEY_PREFIX}:members`,
    boot: `${KEY_PREFIX}:boot:${replicaId}`,
    restart: `${KEY_PREFIX}:restart:${replicaId}`,
  };
}

describeWithRedis("worker heartbeat Redis retirement", () => {
  let inspectionClient: Redis | null = null;
  let keys: ReturnType<typeof slotKeys> | null = null;
  const writers: WorkerHeartbeatWriter[] = [];

  afterEach(async () => {
    for (const writer of [...writers].reverse()) await writer.stop();
    writers.length = 0;
    if (inspectionClient && keys) {
      await inspectionClient.del(keys.snapshot, keys.boot, keys.restart);
      await inspectionClient.zrem(keys.registry, keys.replicaId);
      inspectionClient.disconnect(false);
    }
    inspectionClient = null;
    keys = null;
    vi.unstubAllEnvs();
  });

  async function arrangeSlot(): Promise<void> {
    const slot = `heartbeat-retirement-${randomUUID()}`;
    vi.stubEnv("WORKER_REPLICA_ID", slot);
    keys = slotKeys(slot);
    inspectionClient = redisClient();
    await inspectionClient.connect();
  }

  function writer(): WorkerHeartbeatWriter {
    const instance = new WorkerHeartbeatWriter(snapshot, redisClient);
    writers.push(instance);
    return instance;
  }

  it("retires the exact current boot and all of its slot keys", async () => {
    await arrangeSlot();
    const current = writer();
    await current.write(50_000);

    expect(await inspectionClient!.get(keys!.snapshot)).not.toBeNull();
    expect(await inspectionClient!.get(keys!.boot)).not.toBeNull();
    expect(
      await inspectionClient!.zscore(keys!.registry, keys!.replicaId),
    ).toBe("50000");

    await current.stop();

    expect(
      await inspectionClient!.mget(keys!.snapshot, keys!.boot, keys!.restart),
    ).toEqual([null, null, null]);
    expect(
      await inspectionClient!.zscore(keys!.registry, keys!.replicaId),
    ).toBeNull();
  });

  it("does not let a stale retirement delete a same-slot replacement", async () => {
    await arrangeSlot();
    const stale = writer();
    const replacement = writer();
    await stale.write(50_000);
    const staleBoot = await inspectionClient!.get(keys!.boot);
    await replacement.write(60_000);
    const replacementBoot = await inspectionClient!.get(keys!.boot);
    const replacementSnapshot = await inspectionClient!.get(keys!.snapshot);

    expect(replacementBoot).not.toBe(staleBoot);
    expect(await inspectionClient!.get(keys!.restart)).toBe("collision");
    await stale.stop();

    expect(await inspectionClient!.get(keys!.boot)).toBe(replacementBoot);
    expect(await inspectionClient!.get(keys!.snapshot)).toBe(
      replacementSnapshot,
    );
    expect(await inspectionClient!.get(keys!.restart)).toBe("collision");
    expect(
      await inspectionClient!.zscore(keys!.registry, keys!.replicaId),
    ).toBe("60000");

    await replacement.stop();
    expect(
      await inspectionClient!.mget(keys!.snapshot, keys!.boot, keys!.restart),
    ).toEqual([null, null, null]);
    expect(
      await inspectionClient!.zscore(keys!.registry, keys!.replicaId),
    ).toBeNull();
  });
});
