-- Additive canonical-policy and address-coordinate evidence. Existing wallets
-- and addresses deliberately remain wholly legacy-null; review/migration is a
-- later explicit workflow and this migration performs no data rewrite.
ALTER TABLE "wallets"
ADD COLUMN "canonicalPolicyId" TEXT,
ADD COLUMN "canonicalPolicyVersion" INTEGER;

ALTER TABLE "addresses"
ADD COLUMN "branch" INTEGER,
ADD COLUMN "coordinateVersion" INTEGER,
ADD COLUMN "canonicalPolicyId" TEXT,
ADD COLUMN "canonicalPolicyVersion" INTEGER,
ADD COLUMN "scriptPubKey" TEXT;

ALTER TABLE "wallets"
ADD CONSTRAINT "wallets_canonical_policy_identity_complete_check"
CHECK (
  (
    "canonicalPolicyId" IS NULL
    AND "canonicalPolicyVersion" IS NULL
  )
  OR
  (
    "canonicalPolicyId" IS NOT NULL
    AND btrim("canonicalPolicyId") <> ''
    AND "canonicalPolicyId" = btrim("canonicalPolicyId")
    AND "canonicalPolicyVersion" IS NOT NULL
    AND "canonicalPolicyVersion" >= 1
    AND "descriptorPolicyVersion" IS NOT NULL
  )
);

ALTER TABLE "addresses"
ADD CONSTRAINT "addresses_canonical_coordinate_complete_check"
CHECK (
  (
    "branch" IS NULL
    AND "coordinateVersion" IS NULL
    AND "canonicalPolicyId" IS NULL
    AND "canonicalPolicyVersion" IS NULL
    AND "scriptPubKey" IS NULL
  )
  OR
  (
    "branch" IS NOT NULL
    AND "branch" IN (0, 1)
    AND "coordinateVersion" IS NOT NULL
    AND "coordinateVersion" = 1
    AND "index" >= 0
    AND "index" <= 2147483647
    AND "canonicalPolicyId" IS NOT NULL
    AND btrim("canonicalPolicyId") <> ''
    AND "canonicalPolicyId" = btrim("canonicalPolicyId")
    AND "canonicalPolicyVersion" IS NOT NULL
    AND "canonicalPolicyVersion" >= 1
    AND "scriptPubKey" IS NOT NULL
    AND "scriptPubKey" ~ '^[0-9a-f]+$'
    AND length("scriptPubKey") % 2 = 0
  )
);

-- Legacy-null rows do not participate. Canonical rows have exactly one record
-- for each wallet-relative receive/change coordinate.
CREATE UNIQUE INDEX "addresses_walletId_branch_index_key"
ON "addresses"("walletId", "branch", "index")
WHERE "branch" IS NOT NULL;

CREATE INDEX "addresses_walletId_branch_used_index_idx"
ON "addresses"("walletId", "branch", "used", "index");

CREATE FUNCTION "protect_wallet_canonical_policy_identity"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."canonicalPolicyVersion" IS NOT NULL
    AND (
      NEW."canonicalPolicyId" IS DISTINCT FROM OLD."canonicalPolicyId"
      OR NEW."canonicalPolicyVersion" IS DISTINCT FROM OLD."canonicalPolicyVersion"
    )
  THEN
    RAISE EXCEPTION 'Assigned wallet canonical policy identities are immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "wallets_protect_canonical_policy_identity"
BEFORE UPDATE ON "wallets"
FOR EACH ROW
EXECUTE FUNCTION "protect_wallet_canonical_policy_identity"();

-- PostgreSQL CHECK constraints cannot reference another table. This trigger
-- binds every canonical address snapshot to its wallet's exact registry row.
CREATE FUNCTION "enforce_address_wallet_policy_identity"()
RETURNS TRIGGER AS $$
DECLARE
  wallet_policy_id TEXT;
  wallet_policy_version INTEGER;
BEGIN
  IF NEW."coordinateVersion" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "canonicalPolicyId", "canonicalPolicyVersion"
  INTO wallet_policy_id, wallet_policy_version
  FROM "wallets"
  WHERE "id" = NEW."walletId";

  IF NOT FOUND
    OR wallet_policy_id IS DISTINCT FROM NEW."canonicalPolicyId"
    OR wallet_policy_version IS DISTINCT FROM NEW."canonicalPolicyVersion"
  THEN
    RAISE EXCEPTION 'Address canonical policy identity does not match its wallet'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "addresses_enforce_wallet_policy_identity"
BEFORE INSERT OR UPDATE ON "addresses"
FOR EACH ROW
EXECUTE FUNCTION "enforce_address_wallet_policy_identity"();

-- A legacy row may be assigned canonical evidence once by the later approved
-- migration. Once versioned, address bytes, compatibility path, coordinate,
-- and policy identity are immutable; used-state updates and deletion remain
-- available to normal synchronization and explicit wallet removal.
CREATE FUNCTION "protect_address_canonical_evidence"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."coordinateVersion" IS NOT NULL
    AND (
      NEW."walletId" IS DISTINCT FROM OLD."walletId"
      OR NEW."address" IS DISTINCT FROM OLD."address"
      OR NEW."derivationPath" IS DISTINCT FROM OLD."derivationPath"
      OR NEW."index" IS DISTINCT FROM OLD."index"
      OR NEW."branch" IS DISTINCT FROM OLD."branch"
      OR NEW."coordinateVersion" IS DISTINCT FROM OLD."coordinateVersion"
      OR NEW."canonicalPolicyId" IS DISTINCT FROM OLD."canonicalPolicyId"
      OR NEW."canonicalPolicyVersion" IS DISTINCT FROM OLD."canonicalPolicyVersion"
      OR NEW."scriptPubKey" IS DISTINCT FROM OLD."scriptPubKey"
    )
  THEN
    RAISE EXCEPTION 'Canonical address coordinate evidence is immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "addresses_protect_canonical_evidence"
BEFORE UPDATE ON "addresses"
FOR EACH ROW
EXECUTE FUNCTION "protect_address_canonical_evidence"();
