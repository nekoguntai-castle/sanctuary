#!/bin/bash
# Historical transaction rows used to prove data-bearing migrations during upgrades.

seed_transaction_migration_fixture() {
    if [ "$UPGRADE_SEED_APP_STATE" != "true" ]; then
        return 0
    fi

    log_info "Seeding historical transaction rows before upgrade..."

    local seed_output
    seed_output=$(docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T \
        -e "UPGRADE_WALLET_ID=$TEST_WALLET_ID" \
        -e "UPGRADE_OPERATIONAL_WALLET_ID=$TEST_OPERATIONAL_WALLET_ID" \
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

(async () => {
  const admin = await prisma.user.findUnique({
    where: { username: "admin" },
    select: { id: true },
  });
  if (!admin) {
    throw new Error("admin user missing");
  }

  const repairTransaction = await prisma.transaction.create({
    data: {
      txid: "11".repeat(32),
      walletId: process.env.UPGRADE_WALLET_ID,
      userId: admin.id,
      type: "received",
      amount: 125000n,
      balanceAfter: null,
      confirmations: 3,
      blockHeight: 2500000,
      rawTx: "00",
      inputs: {
        create: {
          inputIndex: 0,
          txid: "33".repeat(32),
          vout: 1,
          address: "tb1qupgradefixtureinput",
          amount: 130000n,
        },
      },
      outputs: {
        create: {
          outputIndex: 0,
          address: "tb1qupgradefixtureoutput",
          amount: 125000n,
          outputType: "recipient",
          isOurs: true,
        },
      },
    },
    select: { id: true },
  });

  const triggerTransaction = await prisma.transaction.create({
    data: {
      txid: "22".repeat(32),
      walletId: process.env.UPGRADE_OPERATIONAL_WALLET_ID,
      userId: admin.id,
      type: "sent",
      amount: -2000n,
      fee: 250n,
      balanceAfter: 8000n,
      confirmations: 1,
      blockHeight: 2500001,
      rawTx: "00",
    },
    select: { id: true },
  });

  process.stdout.write(`repairTransactionId=${repairTransaction.id}\n`);
  process.stdout.write(`triggerTransactionId=${triggerTransaction.id}\n`);
})()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    try {
      await prisma.$disconnect();
    } catch {}
    process.exit(1);
  });
' 2>/dev/null) || {
        log_error "Failed to seed historical transaction rows"
        return 1
    }

    TEST_REPAIR_TRANSACTION_ID=$(echo "$seed_output" | sed -n 's/^repairTransactionId=//p' | tail -n 1)
    TEST_TRIGGER_TRANSACTION_ID=$(echo "$seed_output" | sed -n 's/^triggerTransactionId=//p' | tail -n 1)
    if [ -z "$TEST_REPAIR_TRANSACTION_ID" ] || [ -z "$TEST_TRIGGER_TRANSACTION_ID" ]; then
        log_error "Transaction migration fixture did not return required IDs"
        log_error "Output: $seed_output"
        return 1
    fi

    log_success "Historical transaction rows seeded before upgrade"
}

verify_transaction_migrations() {
    if [ "$UPGRADE_SEED_APP_STATE" != "true" ]; then
        log_info "Skipping transaction migration verification for fixture: $UPGRADE_FIXTURE"
        return 0
    fi

    log_info "Verifying historical transaction migrations after upgrade..."

    local output
    output=$(docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T \
        -e "UPGRADE_WALLET_ID=$TEST_WALLET_ID" \
        -e "UPGRADE_OPERATIONAL_WALLET_ID=$TEST_OPERATIONAL_WALLET_ID" \
        -e "UPGRADE_REPAIR_TRANSACTION_ID=$TEST_REPAIR_TRANSACTION_ID" \
        -e "UPGRADE_TRIGGER_TRANSACTION_ID=$TEST_TRIGGER_TRANSACTION_ID" \
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

(async () => {
  const wallet = await prisma.wallet.findUnique({
    where: { id: process.env.UPGRADE_WALLET_ID },
    select: {
      requestedFullResyncGeneration: true,
      processedFullResyncGeneration: true,
    },
  });
  if (!wallet || wallet.requestedFullResyncGeneration !== 0 || wallet.processedFullResyncGeneration !== 0) {
    throw new Error("wallet full-resync generations were not backfilled to zero");
  }

  const transaction = await prisma.transaction.findUnique({
    where: { id: process.env.UPGRADE_REPAIR_TRANSACTION_ID },
    select: {
      classificationInputsComplete: true,
      classificationVersion: true,
      classificationAddressCount: true,
      classificationLastAttemptAt: true,
      ioComplete: true,
      ioLastAttemptAt: true,
      balanceAfter: true,
      inputs: { select: { inputIndex: true, amount: true } },
      outputs: { select: { outputIndex: true, amount: true, isOurs: true } },
    },
  });
  if (!transaction) {
    throw new Error("historical transaction missing after upgrade");
  }
  if (transaction.classificationInputsComplete !== false || transaction.classificationVersion !== 1 ||
      transaction.classificationAddressCount !== 0 || transaction.classificationLastAttemptAt !== null ||
      transaction.ioComplete !== false || transaction.ioLastAttemptAt !== null) {
    throw new Error("historical transaction repair fields have unexpected migration defaults");
  }
  if (transaction.balanceAfter !== null || transaction.inputs.length !== 1 || transaction.outputs.length !== 1 ||
      transaction.inputs[0].inputIndex !== 0 || transaction.inputs[0].amount !== 130000n ||
      transaction.outputs[0].outputIndex !== 0 || transaction.outputs[0].amount !== 125000n ||
      transaction.outputs[0].isOurs !== true) {
    throw new Error("historical transaction data was not preserved");
  }

  const repairMarkers = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM "wallet_balance_repairs"
    WHERE "walletId" = ${process.env.UPGRADE_WALLET_ID}
  `;
  if (repairMarkers.length !== 1 || repairMarkers[0].count < 1) {
    throw new Error("null-balance historical transaction did not enqueue wallet repair");
  }

  const ownershipRepairs = await prisma.transactionOwnershipRepair.count({
    where: { walletId: process.env.UPGRADE_WALLET_ID },
  });
  if (ownershipRepairs !== 0) {
    throw new Error("ownership repair rows should not be fabricated during migration");
  }

  let boundsRejected = false;
  try {
    await prisma.wallet.update({
      where: { id: process.env.UPGRADE_WALLET_ID },
      data: { requestedFullResyncGeneration: -1 },
    });
  } catch {
    boundsRejected = true;
  }
  if (!boundsRejected) {
    throw new Error("full-resync generation bounds constraint accepted a negative value");
  }

  await prisma.$executeRaw`
    DELETE FROM "wallet_balance_repairs"
    WHERE "walletId" = ${process.env.UPGRADE_OPERATIONAL_WALLET_ID}
  `;
  await prisma.transaction.update({
    where: { id: process.env.UPGRADE_TRIGGER_TRANSACTION_ID },
    data: { amount: { decrement: 1n } },
  });
  const triggerMarkers = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM "wallet_balance_repairs"
    WHERE "walletId" = ${process.env.UPGRADE_OPERATIONAL_WALLET_ID}
  `;
  if (triggerMarkers.length !== 1 || triggerMarkers[0].count < 1) {
    throw new Error("transaction update did not trigger wallet balance repair");
  }

  process.stdout.write("transactionMigrationsVerified=true\n");
})()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    try {
      await prisma.$disconnect();
    } catch {}
    process.exit(1);
  });
' 2>/dev/null) || {
        log_error "Historical transaction migration verification failed"
        return 1
    }

    if ! echo "$output" | grep -q '^transactionMigrationsVerified=true$'; then
        log_error "Unexpected transaction migration verification output: $output"
        return 1
    fi

    log_success "Historical transaction migrations verified"
}
