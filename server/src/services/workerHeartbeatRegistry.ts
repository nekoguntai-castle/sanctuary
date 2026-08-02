import { createHash, randomUUID } from "node:crypto";
import Redis from "ioredis";
import { z } from "zod";
import { getConfig } from "../config";
import { NOTIFICATION_RETENTION_CONTRACT_VERSION } from "../internal/notificationRetention";
import {
  WorkerDiagnosticsResponseSchema,
  type AgeBucket,
  type CountBucket,
  type WorkerDiagnosticsResponse,
} from "../internal/workerDiagnostics/protocol";
import { bucketAge, bucketCount } from "../worker/diagnostics/snapshot";
import { safeJsonParse } from "../utils/safeJson";
import { createLogger } from "../utils/logger";

const log = createLogger("WORKER:DIAGNOSTIC_HEARTBEAT");
const HEARTBEAT_VERSION = 1 as const;
const KEY_PREFIX = `sanctuary:diagnostics:worker-heartbeat:v${HEARTBEAT_VERSION}`;
const REGISTRY_KEY = `${KEY_PREFIX}:members`;
const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TTL_MS = 35_000;
const REGISTRY_RETENTION_MS = 15 * 60_000;
const RESTART_MARKER_TTL_MS = 24 * 60 * 60 * 1_000;
const READ_TIMEOUT_MS = 1_000;
const WRITE_TIMEOUT_MS = 1_000;
const MAX_REPLICAS = 32;

const StoredHeartbeatSchema = z
  .object({
    version: z.literal(HEARTBEAT_VERSION),
    bootEpoch: z.string().uuid(),
    writtenAt: z.number().int().nonnegative(),
    stableReplicaIdentity: z.boolean(),
    retentionContractVersion: z.number().int().positive(),
    snapshot: WorkerDiagnosticsResponseSchema,
  })
  .strict();

type StoredHeartbeat = z.infer<typeof StoredHeartbeatSchema>;

const capabilityAggregateSchema = z.enum([
  "all_running",
  "none_running",
  "mixed_or_unknown",
]);

const observedWorkerFleetSnapshotSchema = z
  .object({
    version: z.literal(HEARTBEAT_VERSION),
    observation: z.literal("observed"),
    coverage: z.enum(["complete", "degraded"]),
    workerCount: z.enum(["0", "1", "2-5", "6-20", "21-100", "101+"]),
    oldestHeartbeatAge: z.enum([
      "never",
      "<1m",
      "1m-15m",
      "15m-1h",
      "1h-24h",
      "1d+",
    ]),
    restartObserved: z.boolean(),
    notificationConsumer: capabilityAggregateSchema,
    transactionHandler: capabilityAggregateSchema,
    telemetryWriterCircuit: z.enum([
      "all_closed",
      "any_open",
      "mixed_or_unknown",
    ]),
    telemetryDroppedEvents: z.enum(["none", "some", "mixed_or_unknown"]),
    telegramCircuit: z.enum([
      "all_closed",
      "any_open",
      "any_half_open",
      "mixed_or_unknown",
    ]),
    telegramLastSuccessAge: z.enum([
      "never",
      "<1m",
      "1m-15m",
      "15m-1h",
      "1h-24h",
      "1d+",
      "mixed_or_unknown",
    ]),
    telegramLastFailureAge: z.enum([
      "never",
      "<1m",
      "1m-15m",
      "15m-1h",
      "1h-24h",
      "1d+",
      "mixed_or_unknown",
    ]),
    telegramFailureClass: z.enum([
      "none",
      "invalid_configuration",
      "authentication",
      "permission",
      "rate_limited",
      "provider_rejected",
      "provider_unavailable",
      "timeout",
      "circuit_open",
      "network",
      "unknown",
      "other",
      "mixed_or_unknown",
    ]),
    retentionContract: z.enum(["uniform", "mixed_version", "unknown"]),
  })
  .strict();

const unavailableWorkerFleetSnapshotSchema = z
  .object({
    version: z.literal(HEARTBEAT_VERSION),
    observation: z.enum(["unavailable", "timeout"]),
    coverage: z.literal("unavailable"),
  })
  .strict();

export const workerFleetSnapshotSchema = z.discriminatedUnion("observation", [
  observedWorkerFleetSnapshotSchema,
  unavailableWorkerFleetSnapshotSchema,
]);

export type WorkerFleetSnapshot = z.infer<typeof workerFleetSnapshotSchema>;
type ObservedWorkerFleetSnapshot = z.infer<
  typeof observedWorkerFleetSnapshotSchema
>;

const WRITE_SCRIPT = `
local previous_boot = redis.call('GET', KEYS[3])
if previous_boot and previous_boot ~= ARGV[3] then
  local previous_snapshot = redis.call('GET', KEYS[1])
  local marker = previous_snapshot and 'collision' or 'restart'
  redis.call('SET', KEYS[4], marker, 'PX', ARGV[7])
end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[5])
redis.call('SET', KEYS[3], ARGV[3], 'PX', ARGV[7])
redis.call('ZADD', KEYS[2], ARGV[4], ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[6])
local count = redis.call('ZCARD', KEYS[2])
if count > tonumber(ARGV[8]) then
  local excess = count - tonumber(ARGV[8])
  local oldest = redis.call('ZRANGE', KEYS[2], 0, excess - 1)
  if #oldest > 0 then redis.call('ZREM', KEYS[2], unpack(oldest)) end
end
return 1
`;

/**
 * A stable replica slot lets the Lua writer distinguish an ordinary restart from
 * two live processes claiming the same slot. The script treats a changed boot
 * epoch with a still-live prior snapshot as a collision and retains a marker long
 * enough for the fleet reader to force coverage and capability claims degraded.
 */
function internalReplicaIdentity(): { id: string; stable: boolean } {
  const configured = process.env.WORKER_REPLICA_ID?.trim();
  const identity = configured || randomUUID();
  return {
    id: createHash("sha256").update(identity).digest("hex").slice(0, 32),
    stable: Boolean(configured),
  };
}

function heartbeatKey(replicaId: string): string {
  return `${KEY_PREFIX}:snapshot:${replicaId}`;
}

function bootKey(replicaId: string): string {
  return `${KEY_PREFIX}:boot:${replicaId}`;
}

function restartKey(replicaId: string): string {
  return `${KEY_PREFIX}:restart:${replicaId}`;
}

/* v8 ignore next 11 -- exercised only by process wiring; tests inject isolated clients */
function defaultClient(): Redis {
  const client = new Redis(getConfig().redis.url, {
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  // Prevent ioredis from printing raw connection errors outside our fixed-code
  // writer boundary or the reader's fixed unavailable/timeout result.
  client.on("error", () => undefined);
  return client;
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("worker_heartbeat_read_timeout")),
      READ_TIMEOUT_MS,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export class WorkerHeartbeatWriter {
  private client: Redis | null;
  private readonly replicaIdentity = internalReplicaIdentity();
  private readonly bootEpoch = randomUUID();
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private fence = 0;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly getSnapshot: () => WorkerDiagnosticsResponse,
    private readonly createClient: () => Redis = defaultClient,
  ) {
    this.client = this.createClient();
  }

  start(): void {
    if (this.timer || this.stopped) return;
    void this.write().catch((error) => this.logWriteFailure(error));
    this.timer = setInterval(() => {
      void this.write().catch((error) => this.logWriteFailure(error));
    }, HEARTBEAT_INTERVAL_MS);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.fence += 1;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const pending = this.inFlight;
    this.client?.disconnect(false);
    await pending?.catch(() => undefined);
  }

  write(nowMs = Date.now()): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    const fence = this.fence;
    const flight = this.writeWithDeadline(nowMs, fence).finally(() => {
      this.inFlight = null;
    });
    this.inFlight = flight;
    return flight;
  }

  private async writeWithDeadline(nowMs: number, fence: number): Promise<void> {
    const client = this.client ?? this.createClient();
    this.client = client;
    let timer!: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        client.disconnect(false);
        if (!this.stopped) this.client = null;
        reject(new Error("worker_heartbeat_write_timeout"));
      }, WRITE_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.performWrite(client, nowMs, fence), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async performWrite(
    client: Redis,
    nowMs: number,
    fence: number,
  ): Promise<void> {
    if (client.status === "wait") await client.connect();
    if (this.stopped || fence !== this.fence) return;
    const record = StoredHeartbeatSchema.parse({
      version: HEARTBEAT_VERSION,
      bootEpoch: this.bootEpoch,
      writtenAt: nowMs,
      stableReplicaIdentity: this.replicaIdentity.stable,
      retentionContractVersion: NOTIFICATION_RETENTION_CONTRACT_VERSION,
      snapshot: this.getSnapshot(),
    });
    await client.eval(
      WRITE_SCRIPT,
      4,
      heartbeatKey(this.replicaIdentity.id),
      REGISTRY_KEY,
      bootKey(this.replicaIdentity.id),
      restartKey(this.replicaIdentity.id),
      this.replicaIdentity.id,
      JSON.stringify(record),
      this.bootEpoch,
      nowMs,
      HEARTBEAT_TTL_MS,
      nowMs - REGISTRY_RETENTION_MS,
      RESTART_MARKER_TTL_MS,
      MAX_REPLICAS + 1,
    );
  }

  private logWriteFailure(_error: unknown): void {
    log.warn("Privacy-safe worker heartbeat write failed", {
      code: "heartbeat_write_failed",
    });
  }
}

function capability(
  values: boolean[],
): z.infer<typeof capabilityAggregateSchema> {
  if (values.every(Boolean)) return "all_running";
  if (values.every((value) => !value)) return "none_running";
  return "mixed_or_unknown";
}

function telegramCircuit(
  records: StoredHeartbeat[],
): ObservedWorkerFleetSnapshot["telegramCircuit"] {
  const states = records.map((record) => record.snapshot.telegram.circuitState);
  if (states.length === 0 || states.includes("not-registered"))
    return "mixed_or_unknown";
  if (states.includes("open")) return "any_open";
  if (states.includes("half-open")) return "any_half_open";
  return "all_closed";
}

function telemetryWriter(
  records: StoredHeartbeat[],
): Pick<
  ObservedWorkerFleetSnapshot,
  "telemetryWriterCircuit" | "telemetryDroppedEvents"
> {
  const states = records.map(
    (record) => record.snapshot.notificationTelemetryWriter,
  );
  if (states.some((state) => state.observation === "unavailable"))
    return {
      telemetryWriterCircuit: "mixed_or_unknown",
      telemetryDroppedEvents: "mixed_or_unknown",
    };
  return {
    telemetryWriterCircuit: states.some(
      (state) => state.observation === "observed" && state.circuit === "open",
    )
      ? "any_open"
      : "all_closed",
    telemetryDroppedEvents: states.some(
      (state) =>
        state.observation === "observed" && state.droppedEvents !== "zero",
    )
      ? "some"
      : "none",
  };
}

function uniformValue<T extends string>(values: T[]): T | "mixed_or_unknown" {
  return new Set(values).size === 1 ? values[0] : "mixed_or_unknown";
}

function unavailableFleet(
  observation: "unavailable" | "timeout",
): WorkerFleetSnapshot {
  return {
    version: HEARTBEAT_VERSION,
    observation,
    coverage: "unavailable",
  };
}

export class WorkerHeartbeatReader {
  constructor(private readonly createClient: () => Redis = defaultClient) {}

  async read(nowMs = Date.now()): Promise<WorkerFleetSnapshot> {
    const client = this.createClient();
    try {
      return workerFleetSnapshotSchema.parse(
        await withTimeout(this.readWithClient(client, nowMs)),
      );
    } catch (error) {
      return unavailableFleet(
        error instanceof Error &&
          error.message === "worker_heartbeat_read_timeout"
          ? "timeout"
          : "unavailable",
      );
    } finally {
      client.disconnect(false);
    }
  }

  private async readWithClient(
    client: Redis,
    nowMs: number,
  ): Promise<WorkerFleetSnapshot> {
    if (client.status === "wait") await client.connect();
    const memberEntries = await client.zrangebyscore(
      REGISTRY_KEY,
      nowMs - REGISTRY_RETENTION_MS,
      "+inf",
      "WITHSCORES",
      "LIMIT",
      0,
      MAX_REPLICAS + 1,
    );
    if (memberEntries.length === 0) return unavailableFleet("unavailable");
    if (memberEntries.length % 2 !== 0)
      throw new Error("worker_heartbeat_registry_malformed");

    const members = Array.from(
      { length: memberEntries.length / 2 },
      (_, index) => ({
        id: memberEntries[index * 2],
        writtenAt: Number.parseInt(memberEntries[index * 2 + 1], 10),
      }),
    );
    if (members.some((member) => !Number.isSafeInteger(member.writtenAt)))
      throw new Error("worker_heartbeat_registry_malformed");

    const selected = members.slice(0, MAX_REPLICAS);
    const pipeline = client.pipeline();
    for (const member of selected) {
      pipeline.get(heartbeatKey(member.id));
      pipeline.get(restartKey(member.id));
    }
    const replies = await pipeline.exec();
    if (!replies) throw new Error("worker_heartbeat_read_failed");

    const records: StoredHeartbeat[] = [];
    let restartObserved = false;
    let missing = members.length > MAX_REPLICAS;
    for (let index = 0; index < selected.length; index += 1) {
      const member = selected[index];
      const snapshotReply = replies[index * 2];
      const restartReply = replies[index * 2 + 1];
      if (!restartReply || restartReply[0]) missing = true;
      const restartMarker =
        restartReply && !restartReply[0] ? restartReply[1] : null;
      restartObserved ||= ["1", "restart", "collision"].includes(
        String(restartMarker),
      );
      if (restartMarker === "collision") missing = true;
      if (
        !snapshotReply ||
        snapshotReply[0] ||
        typeof snapshotReply[1] !== "string"
      ) {
        missing = true;
        continue;
      }
      const record = safeJsonParse(
        snapshotReply[1],
        StoredHeartbeatSchema,
        null,
        "worker diagnostic heartbeat",
      );
      if (
        !record ||
        member.writtenAt < nowMs - HEARTBEAT_TTL_MS ||
        record.writtenAt < nowMs - HEARTBEAT_TTL_MS ||
        record.writtenAt > nowMs + 60_000
      ) {
        missing = true;
        continue;
      }
      records.push(record);
    }

    const retentionVersions = new Set(
      records.map((record) => record.retentionContractVersion),
    );
    // Aggregate capability and provider state only when every indexed replica has
    // a fresh, parseable heartbeat with a stable identity. Any gap fails closed.
    const complete =
      !missing &&
      records.length === members.length &&
      records.every((record) => record.stableReplicaIdentity);
    const writerHealth = complete
      ? telemetryWriter(records)
      : {
          telemetryWriterCircuit: "mixed_or_unknown" as const,
          telemetryDroppedEvents: "mixed_or_unknown" as const,
        };
    return {
      version: HEARTBEAT_VERSION,
      observation: "observed",
      coverage: complete ? "complete" : "degraded",
      workerCount: bucketCount(members.length),
      oldestHeartbeatAge: bucketAge(
        Math.min(...members.map((member) => member.writtenAt)),
        nowMs,
      ),
      restartObserved,
      notificationConsumer: complete
        ? capability(
            records.map(
              (record) => record.snapshot.notificationPipeline.consumerRunning,
            ),
          )
        : "mixed_or_unknown",
      transactionHandler: complete
        ? capability(
            records.map(
              (record) =>
                record.snapshot.notificationPipeline
                  .transactionHandlerRegistered,
            ),
          )
        : "mixed_or_unknown",
      ...writerHealth,
      telegramCircuit: complete ? telegramCircuit(records) : "mixed_or_unknown",
      telegramLastSuccessAge: complete
        ? uniformValue(
            records.map((record) => record.snapshot.telegram.lastSuccessAge),
          )
        : "mixed_or_unknown",
      telegramLastFailureAge: complete
        ? uniformValue(
            records.map((record) => record.snapshot.telegram.lastFailureAge),
          )
        : "mixed_or_unknown",
      telegramFailureClass: complete
        ? uniformValue(
            records.map((record) => record.snapshot.telegram.lastFailureClass),
          )
        : "mixed_or_unknown",
      retentionContract:
        !complete || records.length === 0
          ? "unknown"
          : retentionVersions.size > 1 ||
              !retentionVersions.has(NOTIFICATION_RETENTION_CONTRACT_VERSION)
            ? "mixed_version"
            : "uniform",
    };
  }
}

export type { AgeBucket, CountBucket };
