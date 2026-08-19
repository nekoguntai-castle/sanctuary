-- Admit a fourth descriptor-policy provenance class: 'recovered_legacy'.
--
-- Wallets created before descriptor policies existed carry a receive descriptor whose
-- origin was never recorded. They cannot honestly claim 'generated_pair' (Sanctuary did
-- not materialise them from key material it holds) or 'imported_pair'/'imported_multipath'
-- (no human supplied the tokens). Both pair kinds additionally REQUIRE a non-null
-- sourceChangeDescriptor, which for these wallets could only be filled with a token that
-- was derived rather than supplied -- encoding a false provenance claim in a column.
--
-- The recovered arm therefore pins sourceDescriptor = descriptor and forbids every other
-- source column, so the row can only ever assert "this is the descriptor the wallet already
-- had". The change descriptor is derived by canonical branch substitution and proven by
-- re-deriving every stored address before this policy is written; see
-- services/walletRemediation.
--
-- IRREVERSIBLE. Prisma has no down migrations. Once any wallet carries 'recovered_legacy'
-- the previous CHECK cannot be restored, and a server binary predating the backup
-- validation change cannot restore a backup containing such a wallet.
--
-- Rewrites no data: every clause of the previous constraint is preserved verbatim.

ALTER TABLE "wallets"
DROP CONSTRAINT "wallets_descriptor_policy_complete_check";

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
      'imported_multipath',
      'recovered_legacy'
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
      OR
      (
        -- Recovered legacy: no second token was ever supplied, and the single stored
        -- token is pinned to the active descriptor so this kind can never be used to
        -- introduce descriptor bytes the wallet did not already have.
        "descriptorSourceKind" = 'recovered_legacy'
        AND "sourceDescriptor" = "descriptor"
        AND "sourceChangeDescriptor" IS NULL
        AND "sourceDescriptorChecksum" IS NULL
        AND "sourceChangeDescriptorChecksum" IS NULL
      )
    )
  )
);
