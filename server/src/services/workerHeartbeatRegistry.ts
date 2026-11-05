import { createHash, randomUUID } from "node:crypto";
import Redis from "ioredis";
import { z } from "zod";
import { getConfig } from "../config";
import {
  WALLET_SYNC_MUTATION_FENCE_FLOOR,
  WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR,
  WORKER_HEARTBEAT_TTL_MS,
  WORKER_REGISTRY_RETENTION_MS,
  WORKER_RESTART_MARKER_TTL_MS,
} from "../constants/walletSyncActivation";
import { NOTIFICATION_RETENTION_CONTRACT_VERSION } from "../internal/notificationRetention";
import {
  WorkerDiagnosticsResponseSchema,
  type AgeBucket,
  type CountBucket,
  type WorkerDiagnosticsResponse,
} from "../internal/workerDiagnostics/protocol";
import { bucketAge, bucketCount } from "../internal/workerDiagnostics/buckets";
import { safeJsonParse } from "../utils/safeJson";
import { createLogger } from "../utils/logger";

const log = createLogger("WORKER:DIAGNOSTIC_HEARTBEAT");
const HEARTBEAT_VERSION = 1 as const;
const KEY_PREFIX = `sanctuary:diagnostics:worker-heartbeat:v${HEARTBEAT_VERSION}`;
const REGISTRY_KEY = `${KEY_PREFIX}:members`;
// TTL-less incarnation nonce: a changed value proves Redis lost registry data
// (flush, volume reset) even when nobody was observing while it happened.
const INCARNATION_KEY = `${KEY_PREFIX}:incarnation`;
const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TTL_MS = WORKER_HEARTBEAT_TTL_MS;
const REGISTRY_RETENTION_MS = WORKER_REGISTRY_RETENTION_MS;
const RESTART_MARKER_TTL_MS = WORKER_RESTART_MARKER_TTL_MS;
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
    // Optional so a rolling reader can retain old-worker evidence and fail the
    // activation check closed instead of treating the whole registry as corrupt.
    walletSyncMutationFenceFloor: z.number().int().positive().optional(),
    // Optional so pre-retirement workers remain readable but block the
    // independent scheduler-retirement fleet gate.
    walletSyncSchedulerRetirementFloor: z.number().int().positive().optional(),
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

const workerMutationFenceReadinessReasonSchema = z.enum([
  "no_workers",
  "incomplete_fleet",
  "worker_below_floor",
  "restart_observed",
  "unavailable",
  "timeout",
]);

export const workerMutationFenceReadinessSchema = z.discriminatedUnion(
  "ready",
  [
    z
      .object({
        ready: z.literal(true),
        requiredFloor: z.literal(WALLET_SYNC_MUTATION_FENCE_FLOOR),
        // Null until a floor-capable writer has created the nonce.
        registryIncarnation: z.string().min(1).nullable(),
      })
      .strict(),
    z
      .object({
        ready: z.literal(false),
        requiredFloor: z.literal(WALLET_SYNC_MUTATION_FENCE_FLOOR),
        reason: workerMutationFenceReadinessReasonSchema,
        // True when the evidence could hide an unfenced execution (a below-floor
        // or unknown predecessor, a live duplicate, an unreadable or malformed
        // registry entry), so re-admission must wait out a full drain again.
        taint: z.boolean(),
      })
      .strict(),
  ],
);

export type WorkerMutationFenceReadiness = z.infer<
  typeof workerMutationFenceReadinessSchema
>;

export const workerSchedulerRetirementReadinessSchema = z.discriminatedUnion(
  "ready",
  [
    z
      .object({
        ready: z.literal(true),
        requiredFloor: z.literal(WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR),
      })
      .strict(),
    z
      .object({
        ready: z.literal(false),
        requiredFloor: z.literal(WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR),
        reason: workerMutationFenceReadinessReasonSchema,
      })
      .strict(),
  ],
);

export type WorkerSchedulerRetirementReadiness = z.infer<
  typeof workerSchedulerRetirementReadinessSchema
>;

interface RegistryMember {
  id: string;
  writtenAt: number;
}

type WorkerRegistryRead =
  | {
      observation: "observed";
      members: RegistryMember[];
      records: StoredHeartbeat[];
      /** Any restart/collision evidence, fenced or not (diagnostics). */
      restartObserved: boolean;
      /** Restart evidence a mutation-fence reader must treat as blocking. */
      mutationRestartBlocking: boolean;
      /** Restart evidence a scheduler-retirement reader must treat as blocking. */
      retirementRestartBlocking: boolean;
      /**
       * Gap evidence other than stale snapshots and blocking restart markers,
       * which readers add themselves (see readiness `taint`).
       */
      tainted: boolean;
      registryIncarnation: string | null;
      complete: boolean;
    }
  | { observation: "unavailable" | "timeout" };

// Restart marker values. A fenced marker names its exact predecessor's floors;
// every other value blocks both readers.
const RESTART_MARKER_COLLISION = "collision";
const RESTART_MARKER_RESTART = "restart";
const FENCED_RESTART_MARKER = /^fenced\|(\d+)\|(\d+)$/;

// Shared by both scripts so the boot value and marker formats are defined once.
const LUA_PRELUDE = `
local function parse_boot(value)
  local epoch, mutation_floor, retirement_floor = string.match(value, '^([^|]+)|(%d+)|(%d+)$')
  if epoch then return epoch, tonumber(mutation_floor), tonumber(retirement_floor) end
  return value, nil, nil
end
local function parse_fenced(value)
  local mutation_floor, retirement_floor = string.match(value or '', '^fenced|(%d+)|(%d+)$')
  if mutation_floor then return tonumber(mutation_floor), tonumber(retirement_floor) end
  return nil, nil
end
`;

// The boot key holds `epoch|mutationFloor|retirementFloor` so a successor can
// prove what its exact predecessor advertised; a pre-floor writer stores a bare
// epoch, which never parses as fenced. On a changed epoch:
// - the successor's first acknowledged write records `fenced|m|r` when the
//   predecessor's floors are known. Readers decide against their own required
//   floors whether it blocks. It never replaces a blocking marker, and replaces
//   a fenced one only with floors that are no higher (markers never weaken);
// - an unknown predecessor keeps the blocking `collision`/`restart` marker;
// - a later write that finds a foreign epoch is a live duplicate of this slot
//   and always records a blocking `collision`, whatever the floors.
const WRITE_SCRIPT = `${LUA_PRELUDE}
local is_first_write = ARGV[9] == '1'
redis.call('SET', KEYS[5], ARGV[10], 'NX')
local previous_boot = redis.call('GET', KEYS[3])
local own_epoch = parse_boot(ARGV[3])
if previous_boot then
  local previous_epoch, previous_mutation, previous_retirement = parse_boot(previous_boot)
  if previous_epoch ~= own_epoch then
    if not is_first_write then
      redis.call('SET', KEYS[4], '${RESTART_MARKER_COLLISION}', 'PX', ARGV[7])
    elseif previous_mutation then
      local existing = redis.call('GET', KEYS[4])
      local existing_mutation, existing_retirement = parse_fenced(existing)
      if not existing
        or (existing_mutation
          and previous_mutation <= existing_mutation
          and previous_retirement <= existing_retirement) then
        redis.call('SET', KEYS[4], 'fenced|' .. previous_mutation .. '|' .. previous_retirement, 'PX', ARGV[7])
      end
    else
      local previous_snapshot = redis.call('GET', KEYS[1])
      local marker = previous_snapshot and '${RESTART_MARKER_COLLISION}' or '${RESTART_MARKER_RESTART}'
      redis.call('SET', KEYS[4], marker, 'PX', ARGV[7])
    end
  end
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

// Graceful shutdown may retire only the boot epoch it wrote. A crash never runs
// this script, and a stale shutdown sees the replacement epoch and becomes a
// no-op, preserving fail-closed collision evidence and the replacement record.
// Retirement removes only a fenced marker that blocks neither reader; blocking
// evidence about a predecessor lives out its full TTL.
const RETIRE_SCRIPT = `${LUA_PRELUDE}
local current_boot = redis.call('GET', KEYS[3])
if not current_boot or parse_boot(current_boot) ~= ARGV[2] then
  return 0
end
redis.call('DEL', KEYS[1], KEYS[3])
local mutation_floor, retirement_floor = parse_fenced(redis.call('GET', KEYS[4]))
if mutation_floor
  and mutation_floor >= tonumber(ARGV[3])
  and retirement_floor >= tonumber(ARGV[4]) then
  redis.call('DEL', KEYS[4])
end
redis.call('ZREM', KEYS[2], ARGV[1])
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
  private readonly bootValue = `${this.bootEpoch}|${WALLET_SYNC_MUTATION_FENCE_FLOOR}|${WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR}`;
  // Only this boot's first acknowledged write may classify a foreign epoch as
  // its predecessor; any later sighting is a live duplicate of the slot. A
  // write whose reply was lost counts as unacknowledged, which errs towards
  // `fenced` once; the duplicate's next write records `collision` regardless.
  private hasWritten = false;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private fence = 0;
  private inFlight: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;

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

  stop(): Promise<void> {
    if (!this.stopPromise) this.stopPromise = this.stopGracefully();
    return this.stopPromise;
  }

  private async stopGracefully(): Promise<void> {
    this.stopped = true;
    this.fence += 1;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const pending = this.inFlight;
    await pending?.catch(() => undefined);
    this.client?.disconnect(false);
    this.client = null;
    await this.retireExactBoot();
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
      walletSyncMutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      walletSyncSchedulerRetirementFloor: WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR,
      snapshot: this.getSnapshot(),
    });
    await client.eval(
      WRITE_SCRIPT,
      5,
      heartbeatKey(this.replicaIdentity.id),
      REGISTRY_KEY,
      bootKey(this.replicaIdentity.id),
      restartKey(this.replicaIdentity.id),
      INCARNATION_KEY,
      this.replicaIdentity.id,
      JSON.stringify(record),
      this.bootValue,
      nowMs,
      HEARTBEAT_TTL_MS,
      nowMs - REGISTRY_RETENTION_MS,
      RESTART_MARKER_TTL_MS,
      MAX_REPLICAS + 1,
      this.hasWritten ? "0" : "1",
      randomUUID(),
    );
    this.hasWritten = true;
  }

  private async retireExactBoot(): Promise<void> {
    let client: Redis | null = null;
    let timer: NodeJS.Timeout | null = null;
    let timedOut = false;
    try {
      client = this.createClient();
      const retirement = this.performRetirement(client, () => timedOut);
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          client?.disconnect(false);
          reject(new Error("worker_heartbeat_retirement_timeout"));
        }, WRITE_TIMEOUT_MS);
      });
      await Promise.race([retirement, timeout]);
    } catch (error) {
      this.logRetirementFailure(error);
    } finally {
      if (timer) clearTimeout(timer);
      client?.disconnect(false);
    }
  }

  private async performRetirement(
    client: Redis,
    didTimeOut: () => boolean,
  ): Promise<void> {
    if (client.status === "wait") await client.connect();
    if (didTimeOut()) return;
    await client.eval(
      RETIRE_SCRIPT,
      4,
      heartbeatKey(this.replicaIdentity.id),
      REGISTRY_KEY,
      bootKey(this.replicaIdentity.id),
      restartKey(this.replicaIdentity.id),
      this.replicaIdentity.id,
      this.bootEpoch,
      WALLET_SYNC_MUTATION_FENCE_FLOOR,
      WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR,
    );
  }

  private logWriteFailure(_error: unknown): void {
    log.warn("Privacy-safe worker heartbeat write failed", {
      code: "heartbeat_write_failed",
    });
  }

  private logRetirementFailure(_error: unknown): void {
    log.warn("Privacy-safe worker heartbeat retirement failed", {
      code: "heartbeat_retirement_failed",
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
  /**
   * Set `disconnectAfterRead` to false only when `createClient` returns a
   * process-owned client whose lifecycle is closed elsewhere.
   */
  constructor(
    private readonly createClient: () => Redis = defaultClient,
    private readonly disconnectAfterRead = true,
  ) {}

  async read(nowMs = Date.now()): Promise<WorkerFleetSnapshot> {
    const registry = await this.readRegistry(nowMs);
    if (registry.observation !== "observed" || registry.members.length === 0) {
      return unavailableFleet(
        registry.observation === "observed"
          ? "unavailable"
          : registry.observation,
      );
    }
    return workerFleetSnapshotSchema.parse(toFleetSnapshot(registry, nowMs));
  }

  /**
   * Exact, identity-free activation proof for the current mutation-fence floor.
   * Any incomplete registry evidence or old worker blocks activation.
   */
  async readMutationFenceReadiness(
    nowMs = Date.now(),
  ): Promise<WorkerMutationFenceReadiness> {
    const registry = await this.readRegistry(nowMs);
    // Neither an unreadable nor an empty registry is taint: a gracefully retired
    // worker had drained, and Redis data loss is caught by the incarnation nonce
    // on the next ready read.
    if (registry.observation !== "observed") {
      return blockedReadiness(registry.observation, false);
    }
    if (registry.members.length === 0) return blockedReadiness("no_workers", false);
    const belowFloor = registry.records.some(
      (record) =>
        (record.walletSyncMutationFenceFloor ?? 0) <
        WALLET_SYNC_MUTATION_FENCE_FLOOR,
    );
    const taint = registry.tainted || registry.mutationRestartBlocking || belowFloor;
    if (!registry.complete) return blockedReadiness("incomplete_fleet", taint);
    if (registry.mutationRestartBlocking) {
      return blockedReadiness("restart_observed", taint);
    }
    if (belowFloor) return blockedReadiness("worker_below_floor", taint);
    return workerMutationFenceReadinessSchema.parse({
      ready: true,
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      registryIncarnation: registry.registryIncarnation,
    });
  }

  /** Exact proof that every live worker honors scheduler retirement. */
  async readSchedulerRetirementReadiness(
    nowMs = Date.now(),
  ): Promise<WorkerSchedulerRetirementReadiness> {
    const registry = await this.readRegistry(nowMs);
    if (registry.observation !== "observed") {
      return blockedSchedulerRetirementReadiness(registry.observation);
    }
    if (registry.members.length === 0) {
      return blockedSchedulerRetirementReadiness("no_workers");
    }
    if (!registry.complete) {
      return blockedSchedulerRetirementReadiness("incomplete_fleet");
    }
    if (registry.retirementRestartBlocking) {
      return blockedSchedulerRetirementReadiness("restart_observed");
    }
    if (
      registry.records.some(
        (record) =>
          (record.walletSyncSchedulerRetirementFloor ?? 0) <
          WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR,
      )
    ) {
      return blockedSchedulerRetirementReadiness("worker_below_floor");
    }
    return workerSchedulerRetirementReadinessSchema.parse({
      ready: true,
      requiredFloor: WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR,
    });
  }

  private async readRegistry(nowMs: number): Promise<WorkerRegistryRead> {
    let client: Redis | null = null;
    try {
      client = this.createClient();
      return await withTimeout(this.readRegistryWithClient(client, nowMs));
    } catch (error) {
      return {
        observation:
          error instanceof Error &&
          error.message === "worker_heartbeat_read_timeout"
            ? "timeout"
            : "unavailable",
      };
    } finally {
      if (this.disconnectAfterRead) client?.disconnect(false);
    }
  }

  private async readRegistryWithClient(
    client: Redis,
    nowMs: number,
  ): Promise<WorkerRegistryRead> {
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
    if (memberEntries.length === 0) {
      return {
        observation: "observed",
        members: [],
        records: [],
        restartObserved: false,
        mutationRestartBlocking: false,
        retirementRestartBlocking: false,
        tainted: false,
        registryIncarnation: null,
        complete: false,
      };
    }
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
    pipeline.get(INCARNATION_KEY);
    const replies = await pipeline.exec();
    if (!replies) throw new Error("worker_heartbeat_read_failed");

    const records: StoredHeartbeat[] = [];
    let restartObserved = false;
    let mutationRestartBlocking = false;
    let retirementRestartBlocking = false;
    let missing = members.length > MAX_REPLICAS;
    // Every gap except an expired or stale snapshot taints readiness.
    let tainted = missing;
    for (let index = 0; index < selected.length; index += 1) {
      const member = selected[index];
      const snapshotReply = replies[index * 2];
      const restartReply = replies[index * 2 + 1];
      if (!restartReply || restartReply[0]) {
        missing = true;
        tainted = true;
      }
      const rawMarker = restartReply && !restartReply[0] ? restartReply[1] : null;
      const marker = classifyRestartMarker(
        rawMarker === null || rawMarker === undefined ? null : String(rawMarker),
      );
      restartObserved ||= marker.observed;
      mutationRestartBlocking ||= marker.mutationBlocking;
      retirementRestartBlocking ||= marker.retirementBlocking;
      if (marker.duplicate) {
        missing = true;
        tainted = true;
      }
      if (
        !snapshotReply ||
        snapshotReply[0] ||
        typeof snapshotReply[1] !== "string"
      ) {
        missing = true;
        if (snapshotReply?.[0]) tainted = true;
        continue;
      }
      const record = safeJsonParse(
        snapshotReply[1],
        StoredHeartbeatSchema,
        null,
        "worker diagnostic heartbeat",
      );
      if (!record || record.writtenAt > nowMs + 60_000) {
        missing = true;
        tainted = true;
        continue;
      }
      if (
        member.writtenAt < nowMs - HEARTBEAT_TTL_MS ||
        record.writtenAt < nowMs - HEARTBEAT_TTL_MS
      ) {
        missing = true;
        continue;
      }
      if (!record.stableReplicaIdentity) tainted = true;
      records.push(record);
    }
    const incarnationReply = replies[selected.length * 2];
    const registryIncarnation =
      incarnationReply && !incarnationReply[0] && typeof incarnationReply[1] === "string"
        ? incarnationReply[1]
        : null;

    // Aggregate capability and provider state only when every indexed replica has
    // a fresh, parseable heartbeat with a stable identity. Any gap fails closed.
    const complete =
      !missing &&
      records.length === members.length &&
      records.every((record) => record.stableReplicaIdentity);
    return {
      observation: "observed",
      members,
      records,
      restartObserved,
      mutationRestartBlocking,
      retirementRestartBlocking,
      tainted,
      registryIncarnation,
      complete,
    };
  }
}

function blockedReadiness(
  reason: z.infer<typeof workerMutationFenceReadinessReasonSchema>,
  taint: boolean,
): WorkerMutationFenceReadiness {
  return workerMutationFenceReadinessSchema.parse({
    ready: false,
    requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
    reason,
    taint,
  });
}

interface RestartMarkerEvidence {
  observed: boolean;
  mutationBlocking: boolean;
  retirementBlocking: boolean;
  duplicate: boolean;
}

const NO_RESTART: RestartMarkerEvidence = {
  observed: false, mutationBlocking: false, retirementBlocking: false, duplicate: false,
};

/**
 * Judge restart evidence against this binary's floors. A fenced marker names
 * the floors its exact predecessor advertised; any other value, including one
 * this binary does not recognize, blocks both readers.
 */
function classifyRestartMarker(marker: string | null): RestartMarkerEvidence {
  if (marker === null) return NO_RESTART;
  const fenced = FENCED_RESTART_MARKER.exec(marker);
  if (fenced) {
    return {
      observed: true,
      mutationBlocking: Number(fenced[1]) < WALLET_SYNC_MUTATION_FENCE_FLOOR,
      retirementBlocking: Number(fenced[2]) < WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR,
      duplicate: false,
    };
  }
  return {
    observed: true,
    mutationBlocking: true,
    retirementBlocking: true,
    duplicate: marker === RESTART_MARKER_COLLISION,
  };
}

function blockedSchedulerRetirementReadiness(
  reason: z.infer<typeof workerMutationFenceReadinessReasonSchema>,
): WorkerSchedulerRetirementReadiness {
  return workerSchedulerRetirementReadinessSchema.parse({
    ready: false,
    requiredFloor: WALLET_SYNC_SCHEDULER_RETIREMENT_FLOOR,
    reason,
  });
}

function toFleetSnapshot(
  registry: Extract<WorkerRegistryRead, { observation: "observed" }>,
  nowMs: number,
): WorkerFleetSnapshot {
  const { complete, members, records, restartObserved } = registry;
  const retentionVersions = new Set(
    records.map((record) => record.retentionContractVersion),
  );
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
              record.snapshot.notificationPipeline.transactionHandlerRegistered,
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

export type { AgeBucket, CountBucket };
