-- Version durable transaction classifications so corrected wallet-delta
-- semantics can repair rows produced by earlier algorithms.
ALTER TABLE "transactions"
ADD COLUMN "classificationVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "classificationAddressCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "wallet_balance_repairs" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "walletId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_balance_repairs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "wallet_balance_repairs_walletId_idx"
ON "wallet_balance_repairs"("walletId");

ALTER TABLE "wallet_balance_repairs"
ADD CONSTRAINT "wallet_balance_repairs_walletId_fkey"
FOREIGN KEY ("walletId") REFERENCES "wallets"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION "queue_wallet_balance_repair"(target_wallet_id TEXT)
RETURNS VOID AS $$
BEGIN
    -- A wallet cascade deletes child transactions after the parent row is no
    -- longer visible; there is no balance left to repair in that case.
    IF NOT EXISTS (SELECT 1 FROM "wallets" WHERE "id" = target_wallet_id) THEN
        RETURN;
    END IF;

    -- Reuse the wallet-balance lock namespace without waiting. An uncontended
    -- mutation compacts prior markers; a mutation racing recalculation appends
    -- a marker immediately so the in-flight pass cannot erase its retry.
    IF pg_try_advisory_xact_lock(hashtextextended(target_wallet_id, 0)) THEN
        DELETE FROM "wallet_balance_repairs"
        WHERE "walletId" = target_wallet_id;
    END IF;

    INSERT INTO "wallet_balance_repairs" ("walletId")
    VALUES (target_wallet_id);
END;
$$ LANGUAGE plpgsql;

-- Preserve the pre-migration durable retry signal used by unchanged-wallet
-- syncs. One marker per affected wallet is sufficient.
INSERT INTO "wallet_balance_repairs" ("walletId")
SELECT DISTINCT "walletId"
FROM "transactions"
WHERE "balanceAfter" IS NULL;

CREATE FUNCTION "mark_inserted_wallet_balances_for_repair"()
RETURNS TRIGGER AS $$
DECLARE
    changed_wallet TEXT;
BEGIN
    FOR changed_wallet IN
        SELECT DISTINCT "walletId" FROM changed_transactions ORDER BY "walletId"
    LOOP
        PERFORM "queue_wallet_balance_repair"(changed_wallet);
    END LOOP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "mark_deleted_wallet_balances_for_repair"()
RETURNS TRIGGER AS $$
DECLARE
    changed_wallet TEXT;
BEGIN
    FOR changed_wallet IN
        SELECT DISTINCT "walletId" FROM changed_transactions ORDER BY "walletId"
    LOOP
        PERFORM "queue_wallet_balance_repair"(changed_wallet);
    END LOOP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "mark_updated_wallet_balances_for_repair"()
RETURNS TRIGGER AS $$
DECLARE
    changed_wallet TEXT;
BEGIN
    FOR changed_wallet IN
        SELECT DISTINCT affected_wallet
        FROM (
            SELECT new_rows."walletId" AS affected_wallet
            FROM changed_transactions_new new_rows
            JOIN changed_transactions_old old_rows USING ("id")
            WHERE new_rows."walletId" IS DISTINCT FROM old_rows."walletId"
               OR new_rows."amount" IS DISTINCT FROM old_rows."amount"
               OR new_rows."blockTime" IS DISTINCT FROM old_rows."blockTime"
               OR new_rows."createdAt" IS DISTINCT FROM old_rows."createdAt"
            UNION
            SELECT old_rows."walletId" AS affected_wallet
            FROM changed_transactions_new new_rows
            JOIN changed_transactions_old old_rows USING ("id")
            WHERE new_rows."walletId" IS DISTINCT FROM old_rows."walletId"
        ) changed_wallets
        ORDER BY affected_wallet
    LOOP
        PERFORM "queue_wallet_balance_repair"(changed_wallet);
    END LOOP;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "transactions_mark_inserted_balance_repair"
AFTER INSERT ON "transactions"
REFERENCING NEW TABLE AS changed_transactions
FOR EACH STATEMENT
EXECUTE FUNCTION "mark_inserted_wallet_balances_for_repair"();

CREATE TRIGGER "transactions_mark_deleted_balance_repair"
AFTER DELETE ON "transactions"
REFERENCING OLD TABLE AS changed_transactions
FOR EACH STATEMENT
EXECUTE FUNCTION "mark_deleted_wallet_balances_for_repair"();

CREATE TRIGGER "transactions_mark_updated_balance_repair"
AFTER UPDATE ON "transactions"
REFERENCING OLD TABLE AS changed_transactions_old NEW TABLE AS changed_transactions_new
FOR EACH STATEMENT
EXECUTE FUNCTION "mark_updated_wallet_balances_for_repair"();

CREATE TABLE "transaction_ownership_repairs" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "txid" TEXT NOT NULL,
    "targetAddressCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_ownership_repairs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "transaction_ownership_repairs_walletId_txid_key"
ON "transaction_ownership_repairs"("walletId", "txid");

CREATE INDEX "transaction_ownership_repairs_walletId_createdAt_idx"
ON "transaction_ownership_repairs"("walletId", "createdAt");

ALTER TABLE "transaction_ownership_repairs"
ADD CONSTRAINT "transaction_ownership_repairs_walletId_fkey"
FOREIGN KEY ("walletId") REFERENCES "wallets"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
