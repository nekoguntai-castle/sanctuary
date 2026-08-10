-- Additive descriptor-policy foundation. Existing wallets and wallets created by
-- pre-policy application code deliberately remain legacy-null and unverified.
ALTER TABLE "wallets"
ADD COLUMN "changeDescriptor" TEXT,
ADD COLUMN "descriptorPolicyVersion" INTEGER,
ADD COLUMN "descriptorSourceKind" TEXT,
ADD COLUMN "sourceDescriptor" TEXT,
ADD COLUMN "sourceChangeDescriptor" TEXT,
ADD COLUMN "sourceDescriptorChecksum" TEXT,
ADD COLUMN "sourceChangeDescriptorChecksum" TEXT;

-- A legacy wallet may already have an output descriptor, so descriptor alone is
-- not evidence of a verified policy. Setting the policy version atomically opts
-- the wallet into the complete version-one contract.
ALTER TABLE "wallets"
ADD CONSTRAINT "wallets_descriptor_policy_complete_check"
CHECK (
  (
    "descriptorPolicyVersion" IS NULL
    AND "changeDescriptor" IS NULL
    AND "descriptorSourceKind" IS NULL
    AND "sourceDescriptor" IS NULL
    AND "sourceChangeDescriptor" IS NULL
    AND "sourceDescriptorChecksum" IS NULL
    AND "sourceChangeDescriptorChecksum" IS NULL
  )
  OR
  (
    "descriptorPolicyVersion" IS NOT NULL
    AND "descriptorPolicyVersion" = 1
    AND "descriptor" IS NOT NULL
    AND btrim("descriptor") <> ''
    AND "fingerprint" IS NOT NULL
    AND btrim("fingerprint") <> ''
    AND "type" IN ('single_sig', 'multi_sig')
    AND "scriptType" IN ('legacy', 'nested_segwit', 'native_segwit', 'taproot')
    AND "network" IN ('mainnet', 'testnet3', 'testnet4', 'signet', 'regtest')
    AND (
      (
        "type" = 'single_sig'
        AND "quorum" IS NULL
        AND "totalSigners" IS NULL
      )
      OR
      (
        "type" = 'multi_sig'
        AND "scriptType" IN ('nested_segwit', 'native_segwit')
        AND "quorum" IS NOT NULL
        AND "totalSigners" IS NOT NULL
        AND "quorum" >= 1
        AND "totalSigners" >= "quorum"
      )
    )
    AND "changeDescriptor" IS NOT NULL
    AND btrim("changeDescriptor") <> ''
    AND "descriptorSourceKind" IS NOT NULL
    AND "descriptorSourceKind" IN (
      'generated_pair',
      'imported_pair',
      'imported_multipath'
    )
    AND "sourceDescriptor" IS NOT NULL
    AND btrim("sourceDescriptor") <> ''
    AND (
      "sourceDescriptorChecksum" IS NULL
      OR "sourceDescriptorChecksum" ~ '^[qpzry9x8gf2tvdw0s3jn54khce6mua7lQPZRYXGF2TVDWSJN54KHCEMUA]{8}$'
    )
    AND (
      "sourceChangeDescriptorChecksum" IS NULL
      OR "sourceChangeDescriptorChecksum" ~ '^[qpzry9x8gf2tvdw0s3jn54khce6mua7lQPZRYXGF2TVDWSJN54KHCEMUA]{8}$'
    )
    AND (
      (
        "descriptorSourceKind" IN ('generated_pair', 'imported_pair')
        AND "sourceChangeDescriptor" IS NOT NULL
        AND btrim("sourceChangeDescriptor") <> ''
      )
      OR
      (
        "descriptorSourceKind" = 'imported_multipath'
        AND "sourceChangeDescriptor" IS NULL
        AND "sourceChangeDescriptorChecksum" IS NULL
      )
    )
  )
);

-- Legacy-null policy data may be assigned once in a single update. After the
-- version is set, every effective descriptor and exact source field is frozen.
CREATE FUNCTION "protect_wallet_descriptor_policy"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."descriptorPolicyVersion" IS NOT NULL
    AND (
      NEW."descriptor" IS DISTINCT FROM OLD."descriptor"
      OR NEW."fingerprint" IS DISTINCT FROM OLD."fingerprint"
      OR NEW."type" IS DISTINCT FROM OLD."type"
      OR NEW."scriptType" IS DISTINCT FROM OLD."scriptType"
      OR NEW."network" IS DISTINCT FROM OLD."network"
      OR NEW."quorum" IS DISTINCT FROM OLD."quorum"
      OR NEW."totalSigners" IS DISTINCT FROM OLD."totalSigners"
      OR NEW."changeDescriptor" IS DISTINCT FROM OLD."changeDescriptor"
      OR NEW."descriptorPolicyVersion" IS DISTINCT FROM OLD."descriptorPolicyVersion"
      OR NEW."descriptorSourceKind" IS DISTINCT FROM OLD."descriptorSourceKind"
      OR NEW."sourceDescriptor" IS DISTINCT FROM OLD."sourceDescriptor"
      OR NEW."sourceChangeDescriptor" IS DISTINCT FROM OLD."sourceChangeDescriptor"
      OR NEW."sourceDescriptorChecksum" IS DISTINCT FROM OLD."sourceDescriptorChecksum"
      OR NEW."sourceChangeDescriptorChecksum" IS DISTINCT FROM OLD."sourceChangeDescriptorChecksum"
    )
  THEN
    RAISE EXCEPTION 'Assigned wallet descriptor policies are immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "wallets_protect_descriptor_policy"
BEFORE UPDATE ON "wallets"
FOR EACH ROW
EXECUTE FUNCTION "protect_wallet_descriptor_policy"();
