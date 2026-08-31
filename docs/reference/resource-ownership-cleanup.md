# Resource ownership and cleanup evidence

This reference describes the operator-visible contract introduced by
[ADR 0005](../adr/0005-resource-ownership-and-cleanup-receipts.md). The contract
and validators are available before destructive execution is enabled.

## Policy and trust

- `config/resource-ownership-contract.json` defines lifecycle owners, selectors,
  mutation locators, identity fields, active/current checks, cleanup policies,
  dependency order, postconditions, privacy, and unregistered-resource behavior.
- `config/resource-lifecycle-callsites.json` identifies current creation,
  mutation, registration, cleanup, and publication sites and their required
  migration or narrow exemption.
- Production requires separate operator authorization and controller evidence
  RSA keys. Configure accepted DER-SPKI SHA-256 fingerprints by role. Never use
  the offline release key or put private keys in a checkout, env file, manifest,
  command argument, log, journal, or receipt.
- CI keys are ephemeral and lower authority. Upload only public keys and the
  upload-safe receipt projection.

Run the contract check with:

```bash
npm run check:resource-ownership-contract
```

## Operator rules

Treat `refused` and `ambiguous` as safe terminal outcomes requiring inspection.
Do not relabel, rename, or manually delete a target to force a plan through.
Create a new inventory and approval whenever an identity, label, action, context,
or policy digest changes.

Production decommission must be explicit in the signed approval. It never grants
permission to remove protected or persistent data volumes. Unlabeled legacy
objects are retained and reported. Default/shared BuildKit caches are retained.
Provider publications are reconciled, not generically removed.

The local-private evidence directory must be outside the checkout, owned by the
operator, non-symlinked, and inaccessible to group/other users. Evidence reads
are bounded and no-follow. Immutable writes refuse an existing target, sync the
file, and sync its parent. Mutable pointers are a separate atomic-replace mode.

## Receipt interpretation

Final states are `dry_run`, `no_op`, `cleaned`, `partial`, `cancelled`, `refused`,
`ambiguous`, or `recovered`. A cleanup command timeout is not success and does
not prove the daemon request stopped. Inspect exact identities and postconditions
before recovery proceeds.

Verify the detached signature against the configured public key and expected
fingerprint, then verify every bound digest and timestamp. Timestamps must satisfy
`operationStartedAt <= operationEndedAt <= receiptCoreFinalizedAt <= now`.
Recreated signatures do not change deterministic receipt-core bytes.

If a process is interrupted, locate the deployment-scoped active journal rather
than starting another cleanup. Recovery is allowed only for the approval already
reserved to that exact journal. If the host or evidence filesystem was lost,
there is no locally recoverable proof; start with a fresh inventory and treat
prior effects as ambiguous.

## Privacy boundary

Local-private evidence may contain canonical paths and engine inspection facts
needed for safe execution. It still must not contain secrets, raw environment or
Compose config, arbitrary stdout/stderr, wallet/user identifiers, addresses,
transactions, queue payloads, or private keys. Upload-safe evidence is restricted
to schema versions, policy identifiers, opaque IDs, public artifact digests,
counts, bounded states/failure classes, and the private receipt digest.

Retain manifests, approval-state transitions, journals, receipts, checksums,
signatures, and public keys according to policy. Never point active cleanup at
its own evidence directory.
