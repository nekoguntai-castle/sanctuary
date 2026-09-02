#!/bin/bash
# v0.8.66 stale-wallet scheduler retirement upgrade fixture.

WALLET_SYNC_RETIREMENT_FIXTURE="wallet-sync-retirement"
WALLET_SYNC_RETIREMENT_MARKER_KEY="operational.wallet-sync.check-stale-wallets-forbidden.v1"
WALLET_SYNC_RETIREMENT_ACTIVATION_KEY="operational.wallet-sync.activation.v1"
WALLET_SYNC_RETIREMENT_STABILIZATION_KEY="operational.wallet-sync.activation-stabilization.v1"
WALLET_SYNC_RETIREMENT_COMPATIBILITY_FLOOR=2

wallet_sync_retirement_fixture_enabled() {
    fixture_list_contains "$UPGRADE_FIXTURE" "$WALLET_SYNC_RETIREMENT_FIXTURE"
}

wallet_sync_source_supports_retirement_floor() {
    local source_root="$1"
    local policy_file="$source_root/server/src/repositories/walletSyncSchedulePolicyRepository.ts"

    [ -f "$policy_file" ] \
        && grep -Eq 'WALLET_SYNC_SCHEDULE_COMPATIBILITY_FLOOR[[:space:]]*=[[:space:]]*2' "$policy_file"
}

seed_wallet_sync_retirement_fixture() {
    if ! wallet_sync_retirement_fixture_enabled; then
        log_info "Skipping wallet-sync retirement seed for fixture: $UPGRADE_FIXTURE"
        return 0
    fi
    if wallet_sync_source_supports_retirement_floor "$PROJECT_ROOT"; then
        log_error "Wallet-sync retirement fixture requires a source below compatibility floor 2"
        return 1
    fi

    local source_worker_container
    source_worker_container=$(get_container_name worker)
    WALLET_SYNC_RETIREMENT_SOURCE_WORKER_IMAGE=$(docker inspect \
        --format '{{.Image}}' "$source_worker_container" 2>/dev/null || true)
    if [ -z "$WALLET_SYNC_RETIREMENT_SOURCE_WORKER_IMAGE" ]; then
        log_error "Could not capture the exact below-floor worker image"
        return 1
    fi

    log_info "Seeding retained stale-wallet scheduler work on the legacy source..."
    local output
    output=$(docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T \
        -e "UPGRADE_RETIREMENT_TEST_ID=$TEST_ID" \
        backend node -e '
const { Queue } = require("bullmq");
const IORedis = require("ioredis");
const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue("sync", { connection, prefix: "sanctuary:worker" });
const heartbeatPrefix = "sanctuary:diagnostics:worker-heartbeat:v1";
const delayed = { delay: 24 * 60 * 60 * 1000, removeOnComplete: false, removeOnFail: false };
const encoded = (value) => `b64_${Buffer.from(value, "utf8").toString("base64url")}`;
const suffix = process.env.UPGRADE_RETIREMENT_TEST_ID;
const ids = {
  parent: `upgrade-stale-parent-${suffix}`,
  stale: encoded(`sync:stale:upgrade-stale-${suffix}`),
  manual: encoded(`sync:stale:upgrade-manual-${suffix}`),
  activity: encoded(`sync:stale:upgrade-activity-${suffix}`),
};

(async () => {
  await queue.add("check-stale-wallets", { version: 1 }, { ...delayed, jobId: ids.parent });
  await queue.add("sync-wallet", { walletId: "upgrade-stale", reason: "stale" }, { ...delayed, jobId: ids.stale });
  await queue.add("sync-wallet", { walletId: "upgrade-manual", reason: "manual" }, { ...delayed, jobId: ids.manual });
  await queue.add("sync-wallet", { walletId: "upgrade-activity", reason: "address_activity" }, { ...delayed, jobId: ids.activity });
  const schedulers = await queue.getJobSchedulers();
  const sourceScheduler = schedulers.find(
    ({ key, name }) => key === "sync:check-stale-wallets" && name === "check-stale-wallets",
  );
  if (!sourceScheduler) {
    throw new Error("retained check-stale-wallets scheduler was not seeded");
  }
  if (Number(sourceScheduler.every) !== 5 * 60 * 1000) {
    throw new Error(`unexpected v0.8.66 scheduler cadence: ${sourceScheduler.every}`);
  }
  for (const [name, id] of Object.entries(ids)) {
    if (!await queue.getJob(id)) throw new Error(`${name} fixture job was not seeded`);
    process.stdout.write(`${name}JobId=${id}\n`);
  }
  const memberIds = await connection.zrange(`${heartbeatPrefix}:members`, 0, -1);
  const belowFloorMembers = [];
  for (const memberId of memberIds) {
    const raw = await connection.get(`${heartbeatPrefix}:snapshot:${memberId}`);
    if (!raw) continue;
    const record = JSON.parse(raw);
    if ((record.walletSyncMutationFenceFloor ?? 0) < 1) belowFloorMembers.push({ memberId, raw });
  }
  if (belowFloorMembers.length !== 1) {
    throw new Error(`expected exactly one below-floor source member, found ${belowFloorMembers.length}`);
  }
  process.stdout.write(`sourceHeartbeatMemberId=${belowFloorMembers[0].memberId}\n`);
  process.stdout.write(`sourceHeartbeatSnapshotBase64=${Buffer.from(belowFloorMembers[0].raw).toString("base64")}\n`);
})()
  .then(async () => { await queue.close(); await connection.quit(); })
  .catch(async (error) => {
    console.error(error);
    try { await queue.close(); } catch {}
    try { await connection.quit(); } catch {}
    process.exit(1);
  });
' 2>&1) || {
        log_error "Failed to seed wallet-sync retirement fixture"
        log_error "Output: $output"
        return 1
    }

    WALLET_SYNC_RETIREMENT_PARENT_JOB_ID=$(echo "$output" | sed -n 's/^parentJobId=//p' | tail -n 1)
    WALLET_SYNC_RETIREMENT_STALE_JOB_ID=$(echo "$output" | sed -n 's/^staleJobId=//p' | tail -n 1)
    WALLET_SYNC_RETIREMENT_MANUAL_JOB_ID=$(echo "$output" | sed -n 's/^manualJobId=//p' | tail -n 1)
    WALLET_SYNC_RETIREMENT_ACTIVITY_JOB_ID=$(echo "$output" | sed -n 's/^activityJobId=//p' | tail -n 1)
    WALLET_SYNC_RETIREMENT_SOURCE_MEMBER_ID=$(echo "$output" | sed -n 's/^sourceHeartbeatMemberId=//p' | tail -n 1)
    WALLET_SYNC_RETIREMENT_SOURCE_SNAPSHOT_BASE64=$(echo "$output" | sed -n 's/^sourceHeartbeatSnapshotBase64=//p' | tail -n 1)
    if [ -z "$WALLET_SYNC_RETIREMENT_PARENT_JOB_ID" ] \
        || [ -z "$WALLET_SYNC_RETIREMENT_STALE_JOB_ID" ] \
        || [ -z "$WALLET_SYNC_RETIREMENT_MANUAL_JOB_ID" ] \
        || [ -z "$WALLET_SYNC_RETIREMENT_ACTIVITY_JOB_ID" ] \
        || [ -z "$WALLET_SYNC_RETIREMENT_SOURCE_MEMBER_ID" ] \
        || [ -z "$WALLET_SYNC_RETIREMENT_SOURCE_SNAPSHOT_BASE64" ]; then
        log_error "Wallet-sync retirement fixture did not return every seeded job id"
        log_error "Output: $output"
        return 1
    fi
    log_success "Legacy stale, manual, and activity wallet-sync work seeded"
}

prove_wallet_sync_retirement_floor_fixture() {
    log_info "Proving the fresh v0.8.66 heartbeat blocks the scheduler-retirement floor..."
    docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T \
        -e "RETIREMENT_SOURCE_MEMBER_ID=$WALLET_SYNC_RETIREMENT_SOURCE_MEMBER_ID" \
        -e "RETIREMENT_SOURCE_SNAPSHOT_BASE64=$WALLET_SYNC_RETIREMENT_SOURCE_SNAPSHOT_BASE64" \
        backend node -e '
const IORedis = require("ioredis");
function loadModule(candidates) {
  for (const candidate of candidates) {
    try { return require(candidate); } catch {}
  }
  throw new Error(`Could not load any of: ${candidates.join(", ")}`);
}
const redis = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const registryModule = loadModule([
  "./dist/app/src/services/workerHeartbeatRegistry.js",
  "./dist/server/src/services/workerHeartbeatRegistry.js",
  "./dist/src/services/workerHeartbeatRegistry.js",
]);
const heartbeatPrefix = "sanctuary:diagnostics:worker-heartbeat:v1";
const registryKey = `${heartbeatPrefix}:members`;
const sourceMemberId = process.env.RETIREMENT_SOURCE_MEMBER_ID;
const sourceSnapshotBase64 = process.env.RETIREMENT_SOURCE_SNAPSHOT_BASE64;
(async () => {
  if (!sourceMemberId || !sourceSnapshotBase64) {
    throw new Error("upgrade did not preserve the captured below-floor heartbeat evidence");
  }
  const sourceRecord = JSON.parse(Buffer.from(sourceSnapshotBase64, "base64").toString("utf8"));
  delete sourceRecord.walletSyncMutationFenceFloor;
  delete sourceRecord.walletSyncSchedulerRetirementFloor;
  sourceRecord.writtenAt = Date.now();
  sourceRecord.stableReplicaIdentity = true;
  await redis.del(`${heartbeatPrefix}:restart:${sourceMemberId}`);
  await redis.set(
    `${heartbeatPrefix}:snapshot:${sourceMemberId}`,
    JSON.stringify(sourceRecord),
    "PX",
    35_000,
  );
  await redis.zadd(registryKey, sourceRecord.writtenAt, sourceMemberId);
  const reader = new registryModule.WorkerHeartbeatReader(
    () => new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null }),
    true,
  );
  const readiness = await reader.readSchedulerRetirementReadiness();
  if (readiness.ready || readiness.reason !== "worker_below_floor") {
    throw new Error(`fresh legacy heartbeat did not prove the capability floor: ${JSON.stringify(readiness)}`);
  }
  await redis.zrem(registryKey, sourceMemberId);
  await redis.del(
    `${heartbeatPrefix}:snapshot:${sourceMemberId}`,
    `${heartbeatPrefix}:boot:${sourceMemberId}`,
    `${heartbeatPrefix}:restart:${sourceMemberId}`,
  );
})()
  .then(async () => { await redis.quit(); })
  .catch(async (error) => {
    console.error(error);
    try { await redis.quit(); } catch {}
    process.exit(1);
  });
' >/dev/null
}

activate_wallet_sync_retirement_fixture() {
    log_info "Fast-forwarding activation only after the target worker is quiescent..."
    docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T \
        -e "RETIREMENT_ACTIVATION_KEY=$WALLET_SYNC_RETIREMENT_ACTIVATION_KEY" \
        -e "RETIREMENT_STABILIZATION_KEY=$WALLET_SYNC_RETIREMENT_STABILIZATION_KEY" \
        backend node -e '
function loadModule(candidates) {
  for (const candidate of candidates) {
    try { return require(candidate); } catch {}
  }
  throw new Error(`Could not load any of: ${candidates.join(", ")}`);
}
const prismaModule = loadModule([
  "./dist/app/src/models/prisma.js",
  "./dist/server/src/models/prisma.js",
  "./dist/src/models/prisma.js",
]);
const prisma = prismaModule.default || prismaModule;
const now = new Date();
const candidateReadySince = new Date(now.getTime() - 40 * 60 * 1000);
const settings = [
  [process.env.RETIREMENT_ACTIVATION_KEY, {
    version: 1,
    activatedAt: now.toISOString(),
    mutationFenceFloor: 1,
  }],
  [process.env.RETIREMENT_STABILIZATION_KEY, {
    version: 1,
    requiredMutationFenceFloor: 1,
    candidateReadySince: candidateReadySince.toISOString(),
    lastReadyAt: now.toISOString(),
  }],
];
(async () => {
  for (const [key, value] of settings) {
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: JSON.stringify(value) },
      update: { value: JSON.stringify(value) },
    });
  }
})()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (error) => {
    console.error(error);
    try { await prisma.$disconnect(); } catch {}
    process.exit(1);
  });
' >/dev/null
}

establish_wallet_sync_retirement_readiness_fixture() {
    log_info "Fast-forwarding the fixture's observed header target to exact retirement readiness..."
    docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T backend node -e '
function loadModule(candidates) {
  for (const candidate of candidates) {
    try { return require(candidate); } catch {}
  }
  throw new Error(`Could not load any of: ${candidates.join(", ")}`);
}
const prismaModule = loadModule([
  "./dist/app/src/models/prisma.js",
  "./dist/server/src/models/prisma.js",
  "./dist/src/models/prisma.js",
]);
const readinessModule = loadModule([
  "./dist/app/src/services/sync/schedulerRetirementReadiness.js",
  "./dist/server/src/services/sync/schedulerRetirementReadiness.js",
  "./dist/src/services/sync/schedulerRetirementReadiness.js",
]);
const prisma = prismaModule.default || prismaModule;

(async () => {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`
      LOCK TABLE "network_header_checkpoints",
        "network_header_reconciliations",
        "network_header_confirmation_retries",
        "network_header_reconciliation_headers"
      IN ACCESS EXCLUSIVE MODE
    `);
    if (await tx.wallet.count() !== 0) {
      throw new Error("wallet-sync retirement fixture unexpectedly contains wallets");
    }
    const reconciliations = await tx.networkHeaderReconciliation.findMany();
    for (const reconciliation of reconciliations) {
      const pending = reconciliation.pendingTargetHeight !== null;
      await tx.networkHeaderCheckpoint.upsert({
        where: { network: reconciliation.network },
        create: {
          network: reconciliation.network,
          lastProcessedHeight: pending
            ? reconciliation.pendingTargetHeight
            : reconciliation.targetHeight,
          lastProcessedHash: pending
            ? reconciliation.pendingTargetHash
            : reconciliation.targetHash,
          observedAt: pending
            ? reconciliation.pendingTargetObservedAt
            : reconciliation.targetObservedAt,
          coverageGapStartedAt: null,
        },
        update: {
          lastProcessedHeight: pending
            ? reconciliation.pendingTargetHeight
            : reconciliation.targetHeight,
          lastProcessedHash: pending
            ? reconciliation.pendingTargetHash
            : reconciliation.targetHash,
          observedAt: pending
            ? reconciliation.pendingTargetObservedAt
            : reconciliation.targetObservedAt,
          coverageGapStartedAt: null,
        },
      });
    }
    await tx.networkHeaderReconciliation.deleteMany();
  });
  const readiness = await readinessModule.readSchedulerRetirementReadiness();
  if (readiness.status !== "ready") {
    throw new Error(`scheduler retirement readiness fixture remained ${JSON.stringify(readiness)}`);
  }
})()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (error) => {
    console.error(error);
    try { await prisma.$disconnect(); } catch {}
    process.exit(1);
  });
' >/dev/null
}

wait_for_wallet_sync_retirement_marker() {
    local timeout="${1:-180}"
    local started
    local marker=""
    started=$(date +%s)

    while [ $(( $(date +%s) - started )) -lt "$timeout" ]; do
        marker=$(compose_exec postgres psql -U sanctuary -d sanctuary -tAc \
            "SELECT value FROM system_settings WHERE key = '$WALLET_SYNC_RETIREMENT_MARKER_KEY';" \
            2>/dev/null | tr -d '\r\n' || true)
        if [ -n "$marker" ]; then
            log_success "Production worker established the scheduler-retirement marker"
            return 0
        fi
        sleep 4
    done

    log_error "Timed out waiting ${timeout}s for the scheduler-retirement marker"
    return 1
}

verify_wallet_sync_retirement_state() {
    docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T \
        -e "RETIREMENT_PARENT_JOB_ID=$WALLET_SYNC_RETIREMENT_PARENT_JOB_ID" \
        -e "RETIREMENT_STALE_JOB_ID=$WALLET_SYNC_RETIREMENT_STALE_JOB_ID" \
        -e "RETIREMENT_MANUAL_JOB_ID=$WALLET_SYNC_RETIREMENT_MANUAL_JOB_ID" \
        -e "RETIREMENT_ACTIVITY_JOB_ID=$WALLET_SYNC_RETIREMENT_ACTIVITY_JOB_ID" \
        backend node -e '
const { Queue } = require("bullmq");
const IORedis = require("ioredis");
function loadModule(candidates) {
  for (const candidate of candidates) {
    try { return require(candidate); } catch {}
  }
  throw new Error(`Could not load any of: ${candidates.join(", ")}`);
}
const policyModule = loadModule([
  "./dist/app/src/repositories/walletSyncSchedulePolicyRepository.js",
  "./dist/server/src/repositories/walletSyncSchedulePolicyRepository.js",
  "./dist/src/repositories/walletSyncSchedulePolicyRepository.js",
]);
const prismaModule = loadModule([
  "./dist/app/src/models/prisma.js",
  "./dist/server/src/models/prisma.js",
  "./dist/src/models/prisma.js",
]);
const prisma = prismaModule.default || prismaModule;
const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue("sync", { connection, prefix: "sanctuary:worker" });

(async () => {
  const policy = await policyModule.readStaleWalletSchedulePolicy();
  if (policy.mode !== "forbidden" || policy.tombstone.compatibilityFloor !== 2) {
    throw new Error(`unexpected durable retirement policy: ${JSON.stringify(policy)}`);
  }
  const schedulers = await queue.getJobSchedulers();
  const repeatables = await queue.getRepeatableJobs();
  if (schedulers.some(({ key, name }) => key === "sync:check-stale-wallets" || name === "check-stale-wallets")) {
    throw new Error("retired job scheduler remains in Redis");
  }
  if (repeatables.some(({ key, name }) => key === "sync:check-stale-wallets" || name === "check-stale-wallets")) {
    throw new Error("retired repeatable schedule remains in Redis");
  }
  const generationKey = "sanctuary:worker:recurring-generation:v1:sync%3Acheck-stale-wallets";
  const heartbeatKey = "sanctuary:worker:recurring-heartbeat:v1:sync%3Acheck-stale-wallets";
  if (await connection.exists(generationKey, heartbeatKey)) {
    throw new Error("retired scheduler heartbeat state remains in Redis");
  }
  if (await queue.getJob(process.env.RETIREMENT_PARENT_JOB_ID)) {
    throw new Error("retained check-stale-wallets parent was not neutralized");
  }
  if (await queue.getJob(process.env.RETIREMENT_STALE_JOB_ID)) {
    throw new Error("retained stale child was not neutralized");
  }
  const manual = await queue.getJob(process.env.RETIREMENT_MANUAL_JOB_ID);
  const activity = await queue.getJob(process.env.RETIREMENT_ACTIVITY_JOB_ID);
  if (!manual || manual.data?.reason !== "manual") {
    throw new Error("manual wallet-sync work was not preserved");
  }
  if (!activity || activity.data?.reason !== "address_activity") {
    throw new Error("address-activity wallet-sync work was not preserved");
  }
  const explicitReasons = new Set(["manual", "address_activity", "address-activity"]);
  const decodeLogicalId = (jobId) => {
    if (typeof jobId !== "string" || !jobId.startsWith("b64_")) return jobId;
    try { return Buffer.from(jobId.slice(4), "base64url").toString("utf8"); } catch { return null; }
  };
  const jobs = await queue.getJobs(
    ["wait", "delayed", "prioritized", "paused", "waiting-children"],
    0,
    -1,
    false,
  );
  for (const job of jobs) {
    const reason = job.data?.reason;
    const explicit = job.data?.fullResync === true || explicitReasons.has(reason);
    const logicalId = decodeLogicalId(job.id);
    const stale = job.name === "check-stale-wallets"
      || reason === "stale"
      || reason === "startup-catch-up"
      || (!explicit && typeof logicalId === "string" && logicalId.startsWith("sync:stale:"));
    if (stale) throw new Error(`retired wallet-sync work remains queued: ${job.id}`);
  }
})()
  .then(async () => { await queue.close(); await connection.quit(); await prisma.$disconnect(); })
  .catch(async (error) => {
    console.error(error);
    try { await queue.close(); } catch {}
    try { await connection.quit(); } catch {}
    try { await prisma.$disconnect(); } catch {}
    process.exit(1);
  });
' >/dev/null
}

assert_wallet_sync_retirement_metrics() {
    local metrics
    metrics=$(compose_exec worker wget -q -O - http://localhost:3002/metrics 2>/dev/null || true)
    if [ -z "$metrics" ]; then
        log_error "Worker metrics were unavailable after scheduler retirement"
        return 1
    fi
    printf '%s' "$metrics" | node -e '
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  const metrics = JSON.parse(raw);
  const schedules = metrics.recurringSchedules;
  if (!schedules || schedules.healthy !== true) {
    throw new Error("recurring schedule metrics are not healthy after retirement");
  }
  for (const field of ["missing", "mismatched", "stale", "unexpected", "inspectionFailures"]) {
    if (!Array.isArray(schedules[field])) throw new Error(`metrics omitted ${field}`);
    if (schedules[field].some((value) => String(value).includes("check-stale-wallets"))) {
      throw new Error(`retired scheduler remains in metrics.${field}`);
    }
  }
  if (Object.keys(schedules.completionTimes ?? {}).some((value) => value.includes("check-stale-wallets"))) {
    throw new Error("retired scheduler completion remains in metrics");
  }
});
' || return 1
}

start_below_floor_rollback_worker() {
    local rollback_container="$1"
    local target_network="$2"
    local rollback_env="$3"
    local rollback_container_id create_output create_status=0 resolve_status=0 start_status=0
    local -a rollback_ownership_labels=()

    if [ "${SANCTUARY_CLEANUP_COORDINATED:-0}" != "1" ]; then
        log_error "Rollback-floor proof requires the signed cleanup coordinator"
        return 1
    fi

    ownership_label_args compose_container exact_delete || return 1
    rollback_ownership_labels=("${OWNERSHIP_LABEL_ARGS[@]}")
    create_output="$(docker create --rm \
        --name "$rollback_container" \
        --label "com.docker.compose.project=$COMPOSE_PROJECT_NAME" \
        "${rollback_ownership_labels[@]}" \
        --network "$target_network" \
        --env-file "$rollback_env" \
        -e "WORKER_REPLICA_ID=upgrade-below-floor-$TEST_ID" \
        "$WALLET_SYNC_RETIREMENT_SOURCE_WORKER_IMAGE" \
        node dist/server/src/worker.js)" || create_status=$?
    rollback_container_id="$(resolve_registered_created_container \
        "$rollback_container" "$create_output" "$create_status")" || resolve_status=$?
    if [[ ! "$rollback_container_id" =~ ^[0-9a-f]{64}$ ]]; then
        log_error "Rollback-floor helper identity was not proven"
        [ "$resolve_status" -ne 0 ] || resolve_status=1
        return "$resolve_status"
    fi
    if [ "$resolve_status" -ne 0 ]; then
        retire_install_container "$rollback_container_id" stop || true
        return "$resolve_status"
    fi
    start_registered_install_container "$rollback_container_id" || start_status=$?
    [ "$start_status" -eq 0 ] || return "$start_status"
    printf '%s\n' "$rollback_container_id"
}

observe_below_floor_scheduler() {
    local rollback_container_id="$1"
    local _attempt

    for _attempt in $(seq 1 45); do
        if docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T backend node -e '
const { Queue } = require("bullmq");
const IORedis = require("ioredis");
const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue("sync", { connection, prefix: "sanctuary:worker" });
(async () => {
  const schedulers = await queue.getJobSchedulers();
  if (!schedulers.some(({ key, name }) => key === "sync:check-stale-wallets" || name === "check-stale-wallets")) {
    process.exitCode = 1;
  }
})().finally(async () => { await queue.close(); await connection.quit(); });
' >/dev/null 2>&1; then
            return 0
        fi
        docker inspect "$rollback_container_id" >/dev/null 2>&1 || return 1
        sleep 2
    done
    return 1
}

finish_below_floor_rollback_worker() {
    local rollback_container_id="$1"
    local rollback_env="$2"

    if [ "${SANCTUARY_CLEANUP_COORDINATED:-0}" != "1" ]; then
        log_error "Rollback-floor cleanup requires the signed cleanup coordinator"
        return 1
    fi
    if [ -n "$rollback_container_id" ]; then
        retire_install_container "$rollback_container_id" stop || return 1
    fi
    rm -f "$rollback_env"
}

prove_below_floor_rollback_is_unsupported() {
    local target_worker_container target_network rollback_env rollback_container rollback_container_id=""
    local observed=false started=false setup_failed=false

    if [ "${SANCTUARY_CLEANUP_COORDINATED:-0}" != "1" ]; then
        log_error "Rollback-floor proof requires the signed cleanup coordinator"
        return 1
    fi
    target_worker_container=$(get_container_name worker)
    target_network=$(docker inspect --format \
        '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' \
        "$target_worker_container" 2>/dev/null | head -n 1)
    if [ -z "$target_network" ] || [ -z "$WALLET_SYNC_RETIREMENT_SOURCE_WORKER_IMAGE" ]; then
        log_error "Rollback-floor proof could not resolve the target network or source image"
        return 1
    fi

    rollback_env="$TEST_RUNTIME_DIR/wallet-sync-retirement-rollback.env"
    rollback_container="${COMPOSE_PROJECT_NAME}-below-floor-worker-${TEST_ID}"
    install -m 600 /dev/null "$rollback_env" || return 1
    if ! docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' \
        "$target_worker_container" > "$rollback_env"; then
        setup_failed=true
    fi

    log_info "Starting the exact v0.8.66 worker image briefly to prove below-floor rollback is unsafe..."
    if [ "$setup_failed" = "false" ] \
        && ! run_project_compose "$PROJECT_ROOT" stop worker >/dev/null; then
        setup_failed=true
    fi
    if [ "$setup_failed" = "false" ]; then
        if rollback_container_id="$(start_below_floor_rollback_worker \
            "$rollback_container" "$target_network" "$rollback_env")"; then
            started=true
        else
            setup_failed=true
        fi
    fi

    if [ "$started" = "true" ] \
        && observe_below_floor_scheduler "$rollback_container_id"; then
        observed=true
    fi

    finish_below_floor_rollback_worker "$rollback_container_id" "$rollback_env"
    if [ "$setup_failed" = "true" ] || [ "$observed" != "true" ]; then
        log_error "The below-floor worker did not reproduce its forbidden scheduler"
        return 1
    fi
    log_success "Executable rollback-floor proof reproduced the forbidden v0.8.66 scheduler"
}

seed_interrupted_wallet_sync_retirement_purge() {
    local output
    output=$(docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T \
        -e "UPGRADE_RETIREMENT_TEST_ID=$TEST_ID" \
        backend node -e '
const { Queue } = require("bullmq");
const IORedis = require("ioredis");
const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue("sync", { connection, prefix: "sanctuary:worker" });
const encoded = (value) => `b64_${Buffer.from(value, "utf8").toString("base64url")}`;
const suffix = process.env.UPGRADE_RETIREMENT_TEST_ID;
const parent = `upgrade-interrupted-stale-parent-${suffix}`;
const stale = encoded(`sync:stale:upgrade-interrupted-${suffix}`);
const delayed = { delay: 24 * 60 * 60 * 1000, removeOnComplete: false, removeOnFail: false };
(async () => {
  await queue.upsertJobScheduler(
    "sync:check-stale-wallets",
    { every: 10 * 60 * 1000 },
    { name: "check-stale-wallets", data: { version: 1 }, opts: { removeOnComplete: 10 } },
  );
  await queue.add("check-stale-wallets", { version: 1 }, { ...delayed, jobId: parent });
  await queue.add("sync-wallet", { walletId: "upgrade-interrupted", reason: "startup-catch-up" }, { ...delayed, jobId: stale });
  await connection.set("sanctuary:worker:recurring-generation:v1:sync%3Acheck-stale-wallets", "interrupted");
  await connection.set("sanctuary:worker:recurring-heartbeat:v1:sync%3Acheck-stale-wallets", "interrupted");
  process.stdout.write(`parentJobId=${parent}\nstaleJobId=${stale}\n`);
})()
  .then(async () => { await queue.close(); await connection.quit(); })
  .catch(async (error) => {
    console.error(error);
    try { await queue.close(); } catch {}
    try { await connection.quit(); } catch {}
    process.exit(1);
  });
' 2>&1) || {
        log_error "Failed to seed the interrupted retirement-purge state"
        log_error "Output: $output"
        return 1
    }
    WALLET_SYNC_RETIREMENT_PARENT_JOB_ID=$(echo "$output" | sed -n 's/^parentJobId=//p' | tail -n 1)
    WALLET_SYNC_RETIREMENT_STALE_JOB_ID=$(echo "$output" | sed -n 's/^staleJobId=//p' | tail -n 1)
    [ -n "$WALLET_SYNC_RETIREMENT_PARENT_JOB_ID" ] \
        && [ -n "$WALLET_SYNC_RETIREMENT_STALE_JOB_ID" ]
}

verify_wallet_sync_retirement_upgrade() {
    if ! wallet_sync_retirement_fixture_enabled; then
        log_info "Skipping wallet-sync retirement verification for fixture: $UPGRADE_FIXTURE"
        return 0
    fi
    if wallet_sync_source_supports_retirement_floor "$UPGRADE_SOURCE_CHECKOUT"; then
        log_error "Legacy source unexpectedly claims compatibility-floor 2 support"
        return 1
    fi

    prove_wallet_sync_retirement_floor_fixture || return 1
    log_info "Stopping the floor-2 worker before the isolated readiness fast-forward..."
    run_project_compose "$PROJECT_ROOT" stop worker >/dev/null || return 1
    activate_wallet_sync_retirement_fixture || return 1
    establish_wallet_sync_retirement_readiness_fixture || return 1
    log_info "Starting the floor-2 worker against the established readiness checkpoint..."
    run_project_compose "$PROJECT_ROOT" start worker >/dev/null || return 1
    local worker_container
    worker_container=$(get_container_name worker)
    [ -n "$worker_container" ] || {
        log_error "Worker container not found after readiness restart"
        return 1
    }
    wait_for_container_healthy "$worker_container" 180 || return 1
    wait_for_wallet_sync_retirement_marker 180 || return 1
    verify_wallet_sync_retirement_state || return 1
    assert_wallet_sync_retirement_metrics || return 1

    prove_below_floor_rollback_is_unsupported || return 1
    log_info "Recreating interrupted pre-purge Redis state behind the durable marker..."
    seed_interrupted_wallet_sync_retirement_purge || return 1
    run_project_compose "$PROJECT_ROOT" start worker >/dev/null || return 1
    worker_container=$(get_container_name worker)
    [ -n "$worker_container" ] || {
        log_error "Worker container not found after retirement restart"
        return 1
    }
    wait_for_container_healthy "$worker_container" 180 || return 1
    wait_for_wallet_sync_retirement_marker 30 || return 1
    verify_wallet_sync_retirement_state || return 1
    assert_wallet_sync_retirement_metrics || return 1

    log_info "Restarting the clean floor-2 worker to prove repeated-startup idempotency..."
    run_project_compose "$PROJECT_ROOT" restart worker >/dev/null || return 1
    wait_for_container_healthy "$worker_container" 180 || return 1
    verify_wallet_sync_retirement_state || return 1
    assert_wallet_sync_retirement_metrics || return 1

    log_success "Floor-2 startup purged interrupted state and stayed clean; the v0.8.66 source is explicitly below-floor and unsupported"
}
