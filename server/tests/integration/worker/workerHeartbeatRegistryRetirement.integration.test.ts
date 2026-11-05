import { createHash, randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterEach, expect, it, vi } from "vitest";
import {
  WorkerHeartbeatReader,
  WorkerHeartbeatWriter,
} from "../../../src/services/workerHeartbeatRegistry";
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
    expect(replacementBoot).toMatch(/^[0-9a-f-]{36}\|1\|2$/);
    expect(await inspectionClient!.get(keys!.restart)).toBe("fenced|1|2");
    await stale.stop();

    expect(await inspectionClient!.get(keys!.boot)).toBe(replacementBoot);
    expect(await inspectionClient!.get(keys!.snapshot)).toBe(
      replacementSnapshot,
    );
    expect(await inspectionClient!.get(keys!.restart)).toBe("fenced|1|2");
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

  it("admits a fenced crash restart while keeping a live duplicate blocking", async () => {
    await arrangeSlot();
    const crashed = writer();
    const replacement = writer();
    await crashed.write(50_000);
    await replacement.write(55_000);
    const nonce = await inspectionClient!.get(`${KEY_PREFIX}:incarnation`);

    const reader = new WorkerHeartbeatReader(redisClient);
    await expect(reader.readMutationFenceReadiness(55_000)).resolves.toEqual({
      ready: true,
      requiredFloor: 1,
      registryIncarnation: nonce,
    });

    // The "crashed" boot is in fact still alive: its next write is a duplicate.
    await crashed.write(60_000);
    expect(await inspectionClient!.get(keys!.restart)).toBe("collision");
    await expect(reader.readMutationFenceReadiness(60_000)).resolves.toMatchObject({
      ready: false,
      taint: true,
    });
    // A later fenced classification never weakens the blocking marker.
    const late = writer();
    await late.write(65_000);
    expect(await inspectionClient!.get(keys!.restart)).toBe("collision");
    expect(await inspectionClient!.get(`${KEY_PREFIX}:incarnation`)).toBe(nonce);
  });

  it("keeps blocking evidence about an unknown predecessor past a clean retirement", async () => {
    await arrangeSlot();
    await inspectionClient!.set(keys!.boot, randomUUID(), "PX", 60_000);
    const replacement = writer();
    await replacement.write(60_000);
    expect(await inspectionClient!.get(keys!.restart)).toBe("restart");
    const ttl = await inspectionClient!.pttl(keys!.restart);

    await replacement.stop();

    expect(await inspectionClient!.get(keys!.restart)).toBe("restart");
    expect(await inspectionClient!.pttl(keys!.restart)).toBeLessThanOrEqual(ttl);
    expect(await inspectionClient!.get(keys!.boot)).toBeNull();
  });
});
