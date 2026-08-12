-- Add immutable, content-addressed evidence for explicit per-wallet metadata
-- remediation. This migration creates no proposals and rewrites no wallet data.
CREATE TABLE "wallet_remediation_proposals" (
  "id" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL,
  "proposalDigest" TEXT NOT NULL,
  "document" JSONB NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdByUsername" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wallet_remediation_proposals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wallet_remediation_proposals_identity_check" CHECK (
    "id" ~ '^wallet-remediation-v1:[0-9a-f]{64}$'
    AND "schemaVersion" = 'sanctuary.wallet-remediation.v1'
    AND "proposalDigest" ~ '^[0-9a-f]{64}$'
    AND "id" = 'wallet-remediation-v1:' || "proposalDigest"
    AND jsonb_typeof("document") = 'object'
    AND btrim("walletId") <> ''
    AND "walletId" = btrim("walletId")
    AND btrim("createdByUserId") <> ''
    AND "createdByUserId" = btrim("createdByUserId")
    AND btrim("createdByUsername") <> ''
    AND "createdByUsername" = btrim("createdByUsername")
  )
);

CREATE TABLE "wallet_remediation_events" (
  "id" TEXT NOT NULL,
  "proposalId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "proposalDigest" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "actorUsername" TEXT NOT NULL,
  "details" JSONB,
  "previousEventDigest" TEXT,
  "eventDigest" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wallet_remediation_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wallet_remediation_events_content_check" CHECK (
    "sequence" >= 1
    AND "proposalDigest" ~ '^[0-9a-f]{64}$'
    AND "kind" IN ('approved_applied', 'cancelled', 'failed')
    AND btrim("actorUserId") <> ''
    AND "actorUserId" = btrim("actorUserId")
    AND btrim("actorUsername") <> ''
    AND "actorUsername" = btrim("actorUsername")
    AND (
      ("sequence" = 1 AND "previousEventDigest" IS NULL)
      OR
      (
        "sequence" > 1
        AND "previousEventDigest" IS NOT NULL
        AND "previousEventDigest" ~ '^[0-9a-f]{64}$'
      )
    )
    AND "eventDigest" ~ '^[0-9a-f]{64}$'
    AND ("details" IS NULL OR jsonb_typeof("details") = 'object')
  )
);

CREATE UNIQUE INDEX "wallet_remediation_proposals_walletId_proposalDigest_key"
ON "wallet_remediation_proposals"("walletId", "proposalDigest");

CREATE UNIQUE INDEX "wallet_remediation_proposals_id_proposalDigest_key"
ON "wallet_remediation_proposals"("id", "proposalDigest");

CREATE INDEX "wallet_remediation_proposals_walletId_createdAt_idx"
ON "wallet_remediation_proposals"("walletId", "createdAt");

CREATE UNIQUE INDEX "wallet_remediation_events_proposalId_sequence_key"
ON "wallet_remediation_events"("proposalId", "sequence");

CREATE UNIQUE INDEX "wallet_remediation_events_eventDigest_key"
ON "wallet_remediation_events"("eventDigest");

CREATE INDEX "wallet_remediation_events_proposalId_createdAt_idx"
ON "wallet_remediation_events"("proposalId", "createdAt");

-- At most one terminal result may exist for a proposal. Failed attempts remain
-- append-only evidence and do not prevent a later explicitly retried approval.
CREATE UNIQUE INDEX "wallet_remediation_events_terminal_proposal_key"
ON "wallet_remediation_events"("proposalId")
WHERE "kind" IN ('approved_applied', 'cancelled');

ALTER TABLE "wallet_remediation_events"
ADD CONSTRAINT "wallet_remediation_events_proposalId_proposalDigest_fkey"
FOREIGN KEY ("proposalId", "proposalDigest")
REFERENCES "wallet_remediation_proposals"("id", "proposalDigest")
ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION "protect_wallet_remediation_proposal"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Wallet remediation proposals are immutable'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "wallet_remediation_proposals_append_only"
BEFORE UPDATE OR DELETE ON "wallet_remediation_proposals"
FOR EACH ROW
EXECUTE FUNCTION "protect_wallet_remediation_proposal"();

CREATE FUNCTION "protect_wallet_remediation_event"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Wallet remediation events are append-only'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "wallet_remediation_events_append_only"
BEFORE UPDATE OR DELETE ON "wallet_remediation_events"
FOR EACH ROW
EXECUTE FUNCTION "protect_wallet_remediation_event"();

-- Close the legacy transition hole: assigning descriptor proof may populate
-- only formerly-null evidence, never rewrite the effective wallet identity.
CREATE OR REPLACE FUNCTION "protect_wallet_descriptor_policy"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."descriptorPolicyVersion" IS NULL
    AND NEW."descriptorPolicyVersion" IS NOT NULL
    AND OLD."descriptor" IS NOT NULL
    AND (
      NEW."descriptor" IS DISTINCT FROM OLD."descriptor"
      OR NEW."fingerprint" IS DISTINCT FROM OLD."fingerprint"
      OR NEW."type" IS DISTINCT FROM OLD."type"
      OR NEW."scriptType" IS DISTINCT FROM OLD."scriptType"
      OR NEW."network" IS DISTINCT FROM OLD."network"
      OR NEW."quorum" IS DISTINCT FROM OLD."quorum"
      OR NEW."totalSigners" IS DISTINCT FROM OLD."totalSigners"
      OR (
        OLD."changeDescriptor" IS NOT NULL
        AND NEW."changeDescriptor" IS DISTINCT FROM OLD."changeDescriptor"
      )
      OR (
        OLD."descriptorSourceKind" IS NOT NULL
        AND NEW."descriptorSourceKind" IS DISTINCT FROM OLD."descriptorSourceKind"
      )
      OR (
        OLD."sourceDescriptor" IS NOT NULL
        AND NEW."sourceDescriptor" IS DISTINCT FROM OLD."sourceDescriptor"
      )
      OR (
        OLD."sourceChangeDescriptor" IS NOT NULL
        AND NEW."sourceChangeDescriptor" IS DISTINCT FROM OLD."sourceChangeDescriptor"
      )
      OR (
        OLD."sourceDescriptorChecksum" IS NOT NULL
        AND NEW."sourceDescriptorChecksum" IS DISTINCT FROM OLD."sourceDescriptorChecksum"
      )
      OR (
        OLD."sourceChangeDescriptorChecksum" IS NOT NULL
        AND NEW."sourceChangeDescriptorChecksum" IS DISTINCT FROM OLD."sourceChangeDescriptorChecksum"
      )
    )
  THEN
    RAISE EXCEPTION 'Descriptor proof assignment cannot change wallet identity'
      USING ERRCODE = '23514';
  END IF;

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

-- Canonical policy assignment is also metadata-only. The descriptor trigger
-- protects versioned rows, while this transition guard covers a same-statement
-- canonical assignment against a still-legacy row.
CREATE OR REPLACE FUNCTION "protect_wallet_canonical_policy_identity"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."canonicalPolicyVersion" IS NULL
    AND NEW."canonicalPolicyVersion" IS NOT NULL
    AND OLD."descriptor" IS NOT NULL
    AND (
      NEW."descriptor" IS DISTINCT FROM OLD."descriptor"
      OR NEW."fingerprint" IS DISTINCT FROM OLD."fingerprint"
      OR NEW."type" IS DISTINCT FROM OLD."type"
      OR NEW."scriptType" IS DISTINCT FROM OLD."scriptType"
      OR NEW."network" IS DISTINCT FROM OLD."network"
      OR NEW."quorum" IS DISTINCT FROM OLD."quorum"
      OR NEW."totalSigners" IS DISTINCT FROM OLD."totalSigners"
      OR (
        OLD."canonicalPolicyId" IS NOT NULL
        AND NEW."canonicalPolicyId" IS DISTINCT FROM OLD."canonicalPolicyId"
      )
    )
  THEN
    RAISE EXCEPTION 'Canonical policy assignment cannot change wallet identity'
      USING ERRCODE = '23514';
  END IF;

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

-- A legacy link may gain its proof snapshot once, but the transition cannot
-- move the link or replace a signer position that was already recorded.
CREATE OR REPLACE FUNCTION "protect_wallet_device_signer_snapshot"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."signerBindingVersion" IS NULL
    AND NEW."signerBindingVersion" IS NOT NULL
    AND (
      NEW."walletId" IS DISTINCT FROM OLD."walletId"
      OR NEW."deviceId" IS DISTINCT FROM OLD."deviceId"
      OR (
        OLD."deviceAccountId" IS NOT NULL
        AND NEW."deviceAccountId" IS DISTINCT FROM OLD."deviceAccountId"
      )
      OR (
        OLD."signerIndex" IS NOT NULL
        AND NEW."signerIndex" IS DISTINCT FROM OLD."signerIndex"
      )
      OR (
        OLD."signerFingerprint" IS NOT NULL
        AND NEW."signerFingerprint" IS DISTINCT FROM OLD."signerFingerprint"
      )
      OR (
        OLD."signerXpub" IS NOT NULL
        AND NEW."signerXpub" IS DISTINCT FROM OLD."signerXpub"
      )
      OR (
        OLD."signerDerivationPath" IS NOT NULL
        AND NEW."signerDerivationPath" IS DISTINCT FROM OLD."signerDerivationPath"
      )
      OR (
        OLD."signerPurpose" IS NOT NULL
        AND NEW."signerPurpose" IS DISTINCT FROM OLD."signerPurpose"
      )
      OR (
        OLD."signerScriptType" IS NOT NULL
        AND NEW."signerScriptType" IS DISTINCT FROM OLD."signerScriptType"
      )
    )
  THEN
    RAISE EXCEPTION 'Signer proof assignment cannot move a wallet device link'
      USING ERRCODE = '23514';
  END IF;

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

-- Canonical coordinate assignment may fill proof columns once, but cannot
-- rewrite any legacy address identity or compatibility evidence.
CREATE OR REPLACE FUNCTION "protect_address_canonical_evidence"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."coordinateVersion" IS NULL
    AND NEW."coordinateVersion" IS NOT NULL
    AND (
      NEW."walletId" IS DISTINCT FROM OLD."walletId"
      OR NEW."address" IS DISTINCT FROM OLD."address"
      OR NEW."derivationPath" IS DISTINCT FROM OLD."derivationPath"
      OR NEW."index" IS DISTINCT FROM OLD."index"
      OR (
        OLD."branch" IS NOT NULL
        AND NEW."branch" IS DISTINCT FROM OLD."branch"
      )
      OR (
        OLD."canonicalPolicyId" IS NOT NULL
        AND NEW."canonicalPolicyId" IS DISTINCT FROM OLD."canonicalPolicyId"
      )
      OR (
        OLD."canonicalPolicyVersion" IS NOT NULL
        AND NEW."canonicalPolicyVersion" IS DISTINCT FROM OLD."canonicalPolicyVersion"
      )
      OR (
        OLD."scriptPubKey" IS NOT NULL
        AND NEW."scriptPubKey" IS DISTINCT FROM OLD."scriptPubKey"
      )
    )
  THEN
    RAISE EXCEPTION 'Coordinate proof assignment cannot change address identity'
      USING ERRCODE = '23514';
  END IF;

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
