-- Keep rolling-version address inserts visible to the bounded enrollment reader.
--
-- The original compatibility query started at addresses so it could recover a
-- row written by an older producer that did not create the additive checkpoint.
-- That LEFT JOIN/IS NULL branch made every recovery page walk the quiet address
-- population before the existing partial pending-checkpoint index could help.
-- Backfill once, then make the compatibility invariant structural: even an old
-- address-only writer creates an owner-network-derived pending checkpoint in the
-- same transaction.
BEGIN;

CREATE FUNCTION "ensure_address_subscription_checkpoint"()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "address_subscription_checkpoints" (
    "addressId",
    "network",
    "requestedEnrollmentGeneration",
    "processedEnrollmentGeneration"
  )
  SELECT
    NEW."id",
    CASE WHEN wallet."network" = 'testnet' THEN 'testnet3' ELSE wallet."network" END,
    1,
    0
  FROM "wallets" AS wallet
  WHERE wallet."id" = NEW."walletId"
  ON CONFLICT ("addressId") DO UPDATE
  SET "network" = EXCLUDED."network",
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE "address_subscription_checkpoints"."network" = 'testnet'
    AND EXCLUDED."network" = 'testnet3';

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Fire at commit so the immediately prior binary may still perform its own
-- explicit checkpoint insert in the same transaction. ON CONFLICT then turns
-- the deferred trigger into a no-op for that mixed-version writer.
--
-- Install the trigger before backfill while holding the table lock acquired by
-- CREATE TRIGGER. Writers that committed before the lock are included by the
-- subsequent backfill; writers blocked behind it see the trigger after commit.
CREATE CONSTRAINT TRIGGER "ensure_address_subscription_checkpoint"
AFTER INSERT ON "addresses"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "ensure_address_subscription_checkpoint"();

UPDATE "address_subscription_checkpoints"
SET "network" = 'testnet3',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "network" = 'testnet';

INSERT INTO "address_subscription_checkpoints" (
  "addressId",
  "network",
  "requestedEnrollmentGeneration",
  "processedEnrollmentGeneration"
)
SELECT
  address."id",
  CASE WHEN wallet."network" = 'testnet' THEN 'testnet3' ELSE wallet."network" END,
  1,
  0
FROM "addresses" AS address
INNER JOIN "wallets" AS wallet ON wallet."id" = address."walletId"
LEFT JOIN "address_subscription_checkpoints" AS checkpoint
  ON checkpoint."addressId" = address."id"
WHERE checkpoint."addressId" IS NULL
ON CONFLICT ("addressId") DO NOTHING;

COMMIT;
