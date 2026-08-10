-- Additive signer-binding foundation. Existing wallet/device links deliberately
-- remain legacy-null; a later explicit workflow will review and bind them.
ALTER TABLE "wallet_devices"
ADD COLUMN "deviceAccountId" TEXT,
ADD COLUMN "signerBindingVersion" INTEGER,
ADD COLUMN "signerFingerprint" TEXT,
ADD COLUMN "signerXpub" TEXT,
ADD COLUMN "signerDerivationPath" TEXT,
ADD COLUMN "signerPurpose" TEXT,
ADD COLUMN "signerScriptType" TEXT;

CREATE UNIQUE INDEX "device_accounts_id_deviceId_key"
ON "device_accounts"("id", "deviceId");

CREATE INDEX "wallet_devices_deviceAccountId_idx"
ON "wallet_devices"("deviceAccountId");

-- Legacy rows are intentionally excluded because historical signer indexes may
-- be null or duplicated. Every proven binding has one wallet-local signer slot.
CREATE UNIQUE INDEX "wallet_devices_bound_walletId_signerIndex_key"
ON "wallet_devices"("walletId", "signerIndex")
WHERE "signerBindingVersion" = 1;

ALTER TABLE "wallet_devices"
ADD CONSTRAINT "wallet_devices_deviceAccountId_deviceId_fkey"
FOREIGN KEY ("deviceAccountId", "deviceId")
REFERENCES "device_accounts"("id", "deviceId")
ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "wallet_devices"
ADD CONSTRAINT "wallet_devices_signer_snapshot_complete_check"
CHECK (
  (
    "deviceAccountId" IS NULL
    AND "signerBindingVersion" IS NULL
    AND "signerFingerprint" IS NULL
    AND "signerXpub" IS NULL
    AND "signerDerivationPath" IS NULL
    AND "signerPurpose" IS NULL
    AND "signerScriptType" IS NULL
  )
  OR
  (
    "signerBindingVersion" IS NOT NULL
    AND "signerBindingVersion" = 1
    AND "signerIndex" IS NOT NULL
    AND "signerIndex" >= 0
    AND "signerFingerprint" IS NOT NULL
    AND "signerXpub" IS NOT NULL
    AND "signerDerivationPath" IS NOT NULL
    AND "signerPurpose" IS NOT NULL
    AND "signerScriptType" IS NOT NULL
  )
);

-- A legacy-null link may be explicitly bound once. Once bound, its device,
-- optional account reference, version, and immutable signer snapshot cannot be
-- rewritten. Deleting the wallet link remains the explicit unlink operation.
CREATE FUNCTION "protect_wallet_device_signer_snapshot"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."signerBindingVersion" IS NOT NULL
    AND (
      NEW."walletId" IS DISTINCT FROM OLD."walletId"
      OR NEW."deviceId" IS DISTINCT FROM OLD."deviceId"
      OR NEW."deviceAccountId" IS DISTINCT FROM OLD."deviceAccountId"
      OR NEW."signerIndex" IS DISTINCT FROM OLD."signerIndex"
      OR NEW."signerBindingVersion" IS DISTINCT FROM OLD."signerBindingVersion"
      OR NEW."signerFingerprint" IS DISTINCT FROM OLD."signerFingerprint"
      OR NEW."signerXpub" IS DISTINCT FROM OLD."signerXpub"
      OR NEW."signerDerivationPath" IS DISTINCT FROM OLD."signerDerivationPath"
      OR NEW."signerPurpose" IS DISTINCT FROM OLD."signerPurpose"
      OR NEW."signerScriptType" IS DISTINCT FROM OLD."signerScriptType"
    )
  THEN
    RAISE EXCEPTION 'Bound wallet signer snapshots are immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "wallet_devices_protect_signer_snapshot"
BEFORE UPDATE ON "wallet_devices"
FOR EACH ROW
EXECUTE FUNCTION "protect_wallet_device_signer_snapshot"();

-- DeviceAccount identity remains editable only while no wallet binding points
-- at it. Unlinking the WalletDevice first is the supported mutation boundary.
CREATE FUNCTION "protect_bound_device_account_identity"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."id" IS NOT DISTINCT FROM OLD."id"
      AND NEW."deviceId" IS NOT DISTINCT FROM OLD."deviceId"
      AND NEW."purpose" IS NOT DISTINCT FROM OLD."purpose"
      AND NEW."scriptType" IS NOT DISTINCT FROM OLD."scriptType"
      AND NEW."derivationPath" IS NOT DISTINCT FROM OLD."derivationPath"
      AND NEW."xpub" IS NOT DISTINCT FROM OLD."xpub"
    THEN
      RETURN NEW;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "wallet_devices"
    WHERE "deviceAccountId" = OLD."id"
      AND "deviceId" = OLD."deviceId"
  )
  THEN
    RAISE EXCEPTION 'Cannot mutate a DeviceAccount bound to a wallet signer'
      USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "device_accounts_protect_bound_identity_update"
BEFORE UPDATE ON "device_accounts"
FOR EACH ROW
EXECUTE FUNCTION "protect_bound_device_account_identity"();

CREATE TRIGGER "device_accounts_protect_bound_identity_delete"
BEFORE DELETE ON "device_accounts"
FOR EACH ROW
EXECUTE FUNCTION "protect_bound_device_account_identity"();

-- Preserve legacy deletion behavior for unbound devices, but require an
-- explicit wallet unlink before deleting a device with a proven signer binding.
CREATE FUNCTION "protect_bound_signer_device_delete"()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "wallet_devices"
    WHERE "deviceId" = OLD."id"
      AND "signerBindingVersion" IS NOT NULL
  )
  THEN
    RAISE EXCEPTION 'Cannot delete a device bound to a wallet signer'
      USING ERRCODE = '23503';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "devices_protect_bound_signer_delete"
BEFORE DELETE ON "devices"
FOR EACH ROW
EXECUTE FUNCTION "protect_bound_signer_device_delete"();
