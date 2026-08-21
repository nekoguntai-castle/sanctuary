#!/bin/bash
# Legacy wallet sync rows used to prove the 20260820000000_add_wallet_sync_state
# migration during upgrades.
#
# Most column additions are safe by construction and need no fixture. This one
# is not additive: it backfills the bounded `lastSyncFailureClass` taxonomy by
# parsing the legacy `lastSyncError` free text, recovers `syncRetryCount` from a
# decimal suffix in that same text, and installs four CHECK constraints. A
# regression in any of those is invisible to a schema-only check and shows up on
# an operator's node as a wallet whose failure history is silently reclassified,
# or as a migration that aborts mid-upgrade on an integer cast.
#
# Seeded on the source ref through raw SQL and pre-migration columns only, so the
# fixture never depends on the schema it is meant to prove.
#
# Two post-upgrade writers act on these rows, and the fixture is built around
# both rather than trying to outrun them.
#
# 1. The stale sweep. walletRepository findStale() selects
#    `lastSyncedAt IS NULL OR lastSyncedAt < now - staleThreshold` with
#    `syncInProgress = false`, and this lane deliberately ages the
#    sync:check-stale-wallets completion so that sweep runs seconds after the
#    restart. Left alone it syncs the fixture wallets, fails on the lane's
#    disabled testnet3 node config, and rewrites the columns under test --
#    observed on PR #870. A fresh `lastSyncedAt` would only move that race,
#    because the restart is an image build (5m09s on that run, against a 10
#    minute threshold). The rows are pinned past the window instead, which makes
#    the isolation independent of build time, and the pin is asserted afterwards
#    so it cannot lapse silently. The migration never reads `lastSyncedAt`.
#
# 2. Startup reconciliation. syncService resetStuckSyncs() calls
#    walletRepository demoteStrandedInlineRetries(), which matches
#    `lastSyncStatus='retrying'` with an inline or absent owner and resets it to
#    failed -- clearing `syncExecutionOwner` and `syncRetryCount` outright. That
#    matches precisely the rows the migration's retry recovery produces, so on
#    any real upgrade the recovered retry position is erased by the very next
#    boot. This is deliberate: the retry ladder was an in-heap timer that the
#    restart discarded, so reporting "retrying 3/5" afterwards would be a lie.
#    It does mean the migration's recovered count is not observable after boot
#    by any test, so this fixture asserts what an operator actually ends up with
#    rather than a value that never survives to be seen.
#
# So the taxonomy backfill is proved on a legacy `failed` row, which nothing
# reconciles, and the legacy `retrying` row proves the migrate-then-reconcile
# handoff end to end.

WALLET_SYNC_STATE_FAILED_ERROR="Electrum server unavailable after 3 attempts"
WALLET_SYNC_STATE_RETRY_ERROR="Electrum server unavailable (retrying 3/5)"
# syncService.ts resetStuckSyncs(); classifyWalletSyncFailure() matches no
# pattern for this text, so the reconciled class is the fallback.
WALLET_SYNC_STATE_RESTART_REASON="Sync retry was interrupted by a restart and did not resume"
WALLET_SYNC_STATE_RESTART_CLASS="other"

seed_wallet_sync_state_fixture() {
    if [ "$UPGRADE_SEED_APP_STATE" != "true" ]; then
        log_info "Skipping wallet sync state fixture for fixture: $UPGRADE_FIXTURE"
        return 0
    fi

    if [ -z "$TEST_WALLET_ID" ] || [ -z "$TEST_OPERATIONAL_WALLET_ID" ]; then
        log_error "Wallet sync state fixture requires seeded wallet IDs"
        return 1
    fi

    log_info "Seeding legacy wallet sync state before upgrade..."

    local seed_output
    seed_output=$(docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T \
        -e "UPGRADE_WALLET_ID=$TEST_WALLET_ID" \
        -e "UPGRADE_OPERATIONAL_WALLET_ID=$TEST_OPERATIONAL_WALLET_ID" \
        -e "UPGRADE_FAILED_ERROR=$WALLET_SYNC_STATE_FAILED_ERROR" \
        -e "UPGRADE_RETRY_ERROR=$WALLET_SYNC_STATE_RETRY_ERROR" \
        backend node -e '
function loadModule(candidates) {
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // try the next compiled path
    }
  }
  throw new Error(`Could not load any of: ${candidates.join(", ")}`);
}

const prismaModule = loadModule([
  "./dist/app/src/models/prisma.js",
  "./dist/server/src/models/prisma.js",
  "./dist/src/models/prisma.js",
]);
const prisma = prismaModule.default || prismaModule;

const FAILED = "failed";
const RETRYING = "retrying";
// Past the stale window by a wide margin, so the post-upgrade sweep cannot
// select these rows however long the image rebuild takes.
const QUIESCENT_UNTIL = new Date(Date.now() + 24 * 60 * 60 * 1000);

(async () => {
  const admin = await prisma.user.findUnique({
    where: { username: "admin" },
    select: { id: true },
  });
  if (!admin) {
    throw new Error("admin user missing");
  }

  const operational = await prisma.wallet.findUnique({
    where: { id: process.env.UPGRADE_OPERATIONAL_WALLET_ID },
    select: { groupId: true },
  });
  if (!operational) {
    throw new Error("operational wallet missing");
  }

  // A wallet that never failed proves the backfill does not fabricate a failure
  // class out of nothing. Both other fixture wallets are about to be given an
  // error, so this case needs a row of its own rather than a survey of whatever
  // else happens to be in the table.
  const neverFailed = await prisma.wallet.create({
    data: {
      name: "Upgrade Fixture Never Failed Wallet",
      type: "single_sig",
      scriptType: "native_segwit",
      network: "testnet",
      descriptor: "wpkh([abadc0de/84h/1h/9h]tpubD6NzVbkrYhZ4X5n7neverfailed/0/*)",
      fingerprint: "abadc0de",
      groupId: operational.groupId,
      groupRole: "viewer",
      lastSyncedAt: QUIESCENT_UNTIL,
      users: { create: { userId: admin.id, role: "owner" } },
    },
    select: { id: true, lastSyncError: true, lastSyncStatus: true },
  });
  if (neverFailed.lastSyncError !== null || neverFailed.lastSyncStatus !== null) {
    throw new Error("never-failed fixture wallet was created with sync history");
  }

  // Only pre-migration columns are written here: the source ref does not know
  // the sync-state columns this migration introduces.
  const settled = await prisma.$executeRaw`
    UPDATE "wallets"
    SET "lastSyncStatus" = ${FAILED},
        "lastSyncError" = ${process.env.UPGRADE_FAILED_ERROR},
        "lastSyncedAt" = ${QUIESCENT_UNTIL},
        "syncInProgress" = false
    WHERE "id" = ${process.env.UPGRADE_WALLET_ID}
  `;
  const stranded = await prisma.$executeRaw`
    UPDATE "wallets"
    SET "lastSyncStatus" = ${RETRYING},
        "lastSyncError" = ${process.env.UPGRADE_RETRY_ERROR},
        "lastSyncedAt" = ${QUIESCENT_UNTIL},
        "syncInProgress" = false
    WHERE "id" = ${process.env.UPGRADE_OPERATIONAL_WALLET_ID}
  `;
  if (settled !== 1 || stranded !== 1) {
    throw new Error(`expected to seed 2 wallet rows, updated ${settled} and ${stranded}`);
  }

  process.stdout.write("walletSyncStateSeeded=true\n");
  process.stdout.write(`neverFailedWalletId=${neverFailed.id}\n`);
  process.stdout.write(`quiescentUntil=${QUIESCENT_UNTIL.toISOString()}\n`);
})()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    try {
      await prisma.$disconnect();
    } catch {}
    process.exit(1);
  });
' 2>&1) || {
        log_error "Failed to seed legacy wallet sync state"
        log_error "Output: $seed_output"
        return 1
    }

    if ! echo "$seed_output" | grep -q '^walletSyncStateSeeded=true$'; then
        log_error "Unexpected wallet sync state seed output: $seed_output"
        return 1
    fi

    TEST_NEVER_FAILED_WALLET_ID=$(echo "$seed_output" | sed -n 's/^neverFailedWalletId=//p' | tail -n 1)
    TEST_SYNC_QUIESCENT_UNTIL=$(echo "$seed_output" | sed -n 's/^quiescentUntil=//p' | tail -n 1)
    if [ -z "$TEST_NEVER_FAILED_WALLET_ID" ] || [ -z "$TEST_SYNC_QUIESCENT_UNTIL" ]; then
        log_error "Wallet sync state fixture did not return its seeded identifiers"
        log_error "Output: $seed_output"
        return 1
    fi

    log_success "Legacy wallet sync state seeded before upgrade"
}

verify_wallet_sync_state_migration() {
    if [ "$UPGRADE_SEED_APP_STATE" != "true" ]; then
        log_info "Skipping wallet sync state verification for fixture: $UPGRADE_FIXTURE"
        return 0
    fi

    if [ -z "$TEST_NEVER_FAILED_WALLET_ID" ] || [ -z "$TEST_SYNC_QUIESCENT_UNTIL" ]; then
        log_error "Wallet sync state verification requires the seeded identifiers"
        return 1
    fi

    log_info "Verifying wallet sync state migration after upgrade..."

    local output
    output=$(docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T \
        -e "UPGRADE_WALLET_ID=$TEST_WALLET_ID" \
        -e "UPGRADE_OPERATIONAL_WALLET_ID=$TEST_OPERATIONAL_WALLET_ID" \
        -e "UPGRADE_NEVER_FAILED_WALLET_ID=$TEST_NEVER_FAILED_WALLET_ID" \
        -e "UPGRADE_FAILED_ERROR=$WALLET_SYNC_STATE_FAILED_ERROR" \
        -e "UPGRADE_RESTART_REASON=$WALLET_SYNC_STATE_RESTART_REASON" \
        -e "UPGRADE_RESTART_CLASS=$WALLET_SYNC_STATE_RESTART_CLASS" \
        -e "UPGRADE_QUIESCENT_UNTIL=$TEST_SYNC_QUIESCENT_UNTIL" \
        backend node -e '
function loadModule(candidates) {
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // try the next compiled path
    }
  }
  throw new Error(`Could not load any of: ${candidates.join(", ")}`);
}

const prismaModule = loadModule([
  "./dist/app/src/models/prisma.js",
  "./dist/server/src/models/prisma.js",
  "./dist/src/models/prisma.js",
]);
const prisma = prismaModule.default || prismaModule;

const SYNC_STATE_SELECT = {
  lastSyncedAt: true,
  lastSyncStatus: true,
  lastSyncError: true,
  lastSyncFailureClass: true,
  syncExecutionOwner: true,
  syncRetryCount: true,
  syncNextRetryAt: true,
  syncStartedAt: true,
  syncStateVersion: true,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadWallet(label, id) {
  const wallet = await prisma.wallet.findUnique({ where: { id }, select: SYNC_STATE_SELECT });
  if (!wallet) {
    throw new Error(`${label} wallet missing after upgrade`);
  }
  // Checked before anything else: every assertion below reads state the stale
  // sweep would overwrite if it ever synced this row, so a lapsed pin has to
  // fail here rather than surface as a confusing mismatch further down.
  const pinned = wallet.lastSyncedAt === null ? null : wallet.lastSyncedAt.toISOString();
  if (pinned !== process.env.UPGRADE_QUIESCENT_UNTIL) {
    throw new Error(
      `${label} wallet was synced after the upgrade, so its state is no longer attributable to the migration (lastSyncedAt=${pinned}); the fixture pin past the stale window did not hold`
    );
  }
  return wallet;
}

function assertUnscheduled(label, wallet) {
  // Neither the migration nor the reconciliation may leave a schedule behind or
  // claim an in-flight attempt.
  if (wallet.syncNextRetryAt !== null || wallet.syncStartedAt !== null) {
    throw new Error(`${label} wallet carries a sync schedule it was never given`);
  }
}

(async () => {
  // 1. A legacy settled failure. Nothing reconciles a `failed` row, so this is
  //    the migration taxonomy backfill observed directly.
  const settled = await loadWallet("settled-failure", process.env.UPGRADE_WALLET_ID);
  if (settled.lastSyncError !== process.env.UPGRADE_FAILED_ERROR || settled.lastSyncStatus !== "failed") {
    throw new Error(
      `settled-failure wallet changed during upgrade: status=${settled.lastSyncStatus} error=${settled.lastSyncError}`
    );
  }
  if (settled.lastSyncFailureClass !== "electrum_unavailable") {
    throw new Error(`legacy failure text was not classified: ${settled.lastSyncFailureClass}`);
  }
  if (settled.syncExecutionOwner !== null || settled.syncRetryCount !== 0 || settled.syncStateVersion !== 0) {
    throw new Error(
      `settled-failure wallet did not receive additive defaults: owner=${settled.syncExecutionOwner} count=${settled.syncRetryCount} version=${settled.syncStateVersion}`
    );
  }
  assertUnscheduled("settled-failure", settled);

  // 2. A legacy stranded retry. The migration claims it for the inline owner and
  //    recovers the count; startup reconciliation then demotes it. Poll rather
  //    than assume, so a slow sync-service boot reports as itself.
  let stranded = await loadWallet("stranded-retry", process.env.UPGRADE_OPERATIONAL_WALLET_ID);
  for (let attempt = 0; attempt < 30 && stranded.lastSyncStatus === "retrying"; attempt += 1) {
    await sleep(2000);
    stranded = await loadWallet("stranded-retry", process.env.UPGRADE_OPERATIONAL_WALLET_ID);
  }
  if (stranded.lastSyncStatus !== "failed") {
    throw new Error(
      `stranded retry was never reconciled after the upgrade: status=${stranded.lastSyncStatus} error=${stranded.lastSyncError}`
    );
  }
  if (stranded.lastSyncError !== process.env.UPGRADE_RESTART_REASON) {
    throw new Error(`unexpected reconciliation reason: ${stranded.lastSyncError}`);
  }
  if (stranded.lastSyncFailureClass !== process.env.UPGRADE_RESTART_CLASS) {
    throw new Error(`unexpected reconciled failure class: ${stranded.lastSyncFailureClass}`);
  }
  if (stranded.syncExecutionOwner !== null || stranded.syncRetryCount !== 0) {
    throw new Error(
      `reconciliation left a retry position nothing owns: owner=${stranded.syncExecutionOwner} count=${stranded.syncRetryCount}`
    );
  }
  // Exactly one increment above the migration default. Anything else means the
  // migration did not seed 0, or the row was reconciled more than once.
  if (stranded.syncStateVersion !== 1) {
    throw new Error(
      `expected exactly one reconciliation over the migrated default, got version=${stranded.syncStateVersion}`
    );
  }
  assertUnscheduled("stranded-retry", stranded);

  // 3. A wallet that never failed keeps a null class; the backfill is guarded on
  //    `lastSyncError IS NOT NULL` and must not invent one.
  const neverFailed = await loadWallet("never-failed", process.env.UPGRADE_NEVER_FAILED_WALLET_ID);
  if (neverFailed.lastSyncError !== null || neverFailed.lastSyncStatus !== null) {
    throw new Error("never-failed wallet acquired sync history during upgrade");
  }
  if (neverFailed.lastSyncFailureClass !== null || neverFailed.syncExecutionOwner !== null ||
      neverFailed.syncRetryCount !== 0 || neverFailed.syncStateVersion !== 0) {
    throw new Error(
      `never-failed wallet was given fabricated sync state: class=${neverFailed.lastSyncFailureClass} owner=${neverFailed.syncExecutionOwner} count=${neverFailed.syncRetryCount} version=${neverFailed.syncStateVersion}`
    );
  }
  assertUnscheduled("never-failed", neverFailed);

  // The CHECK constraints are the half of the migration that data assertions
  // cannot see, and a partially applied migration would leave them missing.
  const rejections = [
    ["lastSyncFailureClass", { lastSyncFailureClass: "not_a_real_class" }],
    ["syncExecutionOwner", { syncExecutionOwner: "cron" }],
    ["syncRetryCount", { syncRetryCount: -1 }],
    ["syncStateVersion", { syncStateVersion: -1 }],
  ];
  for (const [label, data] of rejections) {
    let rejected = false;
    try {
      await prisma.wallet.update({ where: { id: process.env.UPGRADE_NEVER_FAILED_WALLET_ID }, data });
    } catch {
      rejected = true;
    }
    if (!rejected) {
      throw new Error(`${label} bounds constraint accepted an out-of-taxonomy value`);
    }
  }

  process.stdout.write("walletSyncStateMigrationVerified=true\n");
})()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    try {
      await prisma.$disconnect();
    } catch {}
    process.exit(1);
  });
' 2>&1) || {
        log_error "Wallet sync state migration verification failed"
        log_error "Output: $output"
        return 1
    }

    if ! echo "$output" | grep -q '^walletSyncStateMigrationVerified=true$'; then
        log_error "Unexpected wallet sync state verification output: $output"
        return 1
    fi

    log_success "Wallet sync state migration verified"
}
