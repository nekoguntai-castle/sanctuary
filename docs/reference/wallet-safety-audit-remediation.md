# Wallet Safety Audit And Remediation Runbook

This command inventories persisted wallet policy evidence without changing it.
It does not repair, normalize, relabel, or delete wallets, descriptors, device
accounts, signer bindings, or addresses.

## Run The Audit

Run it on a protected host with the normal server database configuration:

```bash
npm run audit:wallet-safety -- --output /secure/path/wallet-safety-audit.json
```

The report contains sensitive public wallet metadata, including descriptors,
extended public keys, fingerprints, derivation paths, and addresses. The command
writes it atomically with mode `0600`. Store it in an encrypted, access-controlled
location. Do not paste the report into tickets, chat, CI logs, or support tools.
Stdout contains aggregate counts only.

Stable exit codes are:

- `0`: every inventoried wallet has exact evidence for the current proven-safe contract.
- `2`: one or more findings require operator review or remediation.
- `1`: the audit could not complete or publish its report; do not use a partial result.

The report schema is `sanctuary.wallet-safety-audit.v1`. Compare reports only
when their schema versions match. A later schema must be reviewed before it is
accepted as equivalent evidence.

## Immediate Response To Any Finding

1. Quarantine the affected wallet from new deposits. Do not display or distribute
   another receive address while its classification is unresolved.
2. Keep viewing and recovery export available. Never delete or overwrite the
   wallet, its original descriptor evidence, device records, or existing addresses.
3. Export the original receive/change descriptor evidence through the supported
   recovery workflow to encrypted offline storage. Verify the export before use.
4. Independently derive every relevant receive and change address from the exact
   original policy with a separate implementation. For hardware wallets, compare
   against the address displayed by the intended physical device and account.
5. Prove recovery and signing on a controlled test transaction before considering
   any movement of funds. Verify transaction intent, inputs, change, signer identity,
   finalization, and Bitcoin Core acceptance independently.
6. Obtain explicit owner approval for a reviewed migration. The audit itself must
   never be used as authorization to rewrite persisted data.

## Classification Handling

### `proven_safe`

This means the audit reproduced the exact PR2A policy, all stored address/path
coordinates, and every persisted hardware signer snapshot present for the wallet.
It is evidence for the audited database snapshot, not a claim of physical-device
conformance. Preserve the report and continue normal release review.

### `unsupported_but_recoverable`

The original unsupported policy and both branches remain available and the stored
addresses are reproducible. Keep the wallet quarantined from new deposits and
ordinary funds-controlling actions. Follow the independent recovery proof above;
later remediation must be an explicit opt-in migration, never normalization in place.

### `manual_investigation`

Evidence is missing, ambiguous, inconsistent, or cannot be safely reconstructed.
This classification dominates all other findings. Do not infer a change branch,
fingerprint, xpub, account, or original ordered key sequence. Escalate to the
funds-safety owner and perform an offline wallet-by-wallet recovery investigation.

## Finding Families

- `address.*`: quarantine deposits and independently reproduce address bytes and
  full account/branch/index coordinates from original policy evidence.
- `descriptor.*`: preserve every original token and checksum; do not synthesize
  change policy or treat normalized text as proof of the original policy.
- `policy.*_unsupported`: keep the policy blocked. Recovery requires exact original
  descriptors and independently reproduced addresses before any approved migration.
- `signer.binding_*` and `signer.snapshot_*`: identify the intended physical device
  and exact account without fallback, then prove its fingerprint, xpub, origin,
  displayed address, and signing behavior.
- `signer.fingerprint_*`: never substitute an account-parent or placeholder
  fingerprint for the device master fingerprint.
- `signer.xpub_*`: independently verify public-key version/policy semantics, network family, account
  depth, and derivation origin. Do not convert or relabel the persisted key as repair.

## Closeout Evidence

Record the original report hash, the independent derivation/signing evidence, the
reviewer and owner approval, the chosen recovery or migration disposition, and a
post-action audit report. Keep both reports immutable. A clean later report does
not erase the original finding or replace the need for an auditable approval trail.
