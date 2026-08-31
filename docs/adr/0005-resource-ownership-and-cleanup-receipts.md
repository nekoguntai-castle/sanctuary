# ADR 0005: Resource ownership and cleanup receipts

- Status: Accepted
- Date: 2026-08-30

## Context

Sanctuary creates application state, worker leases and schedules, collector
processes, Docker and Podman objects, build cache, workspaces, temporary files,
cleanup evidence, and provider publication objects. Historical cleanup inferred
authority from names, prefixes, age, or the current checkout. Those hints cannot
distinguish an abandoned run from a current, shared, protected, or unrelated
resource. Cleanup therefore needs a fail-closed authority model before its
destructive adapters are expanded.

## Decision

`config/resource-ownership-contract.json` is the versioned policy authority.
`config/resource-lifecycle-callsites.json` is the migration inventory. The
dependency-light implementation lives in `scripts/ownership/`; it cannot import
server code or inherit application secrets.

Every instantiated resource records or externally registers:

```text
project, deploymentId, ownerId, resourceClass, lifecycle, cleanupPolicy,
createdAt, createdByRelease, createdByCommit, creationRunId, immutableIdentity
```

The `io.sanctuary.*` Docker labels carry the fields Docker resources can safely
expose. External signed registrations carry the rest. Creation provenance is
immutable. A restart creates a new operation run; it does not relabel an old
volume or image as newly created. Missing, conflicting, unlabeled, malformed,
shared, current, or unavailable evidence is a refusal or ambiguity, never
authority.

Mutation locators and immutable identity are separate. Containers, networks,
and images can be addressed by immutable engine IDs. Docker volumes have no
engine ID: their exact name is only a mutation locator, while a signed creation
nonce and fingerprint of the complete relevant inspect response establish the
approved identity. The controller must reinspect immediately before mutation.
This protects against accidental or concurrent operations by cooperating tools;
it does not defend against a hostile peer with equivalent daemon and evidence
filesystem access.

Application mutations, leases, subscriptions, and schedules remain owned by
their database, lock, worker, and queue lifecycle APIs. Cleanup may inventory
them but may not reclaim them generically. Default/shared BuildKit state is
preserved. Evidence is retained. Provider publications are retained and
reconciled by immutable provider identity; generic deletion is forbidden.

## Protocol

The state machine is:

```text
inventory -> signed dry-run -> single-use signed approval -> reserved journal
          -> intent/result checkpoints -> post-inventory -> finalized receipt
                                      \-> recover exact reserved journal
```

Inventory failure is ambiguous, not empty. The plan binds the inventory, policy,
deployment, and run digests. Approval additionally binds exact ordered actions,
count/classes, context fingerprint, nonce, expiry, and any explicit production
decommission intent. Approval is atomically reserved before mutation and can be
finalized only once. Expiry prevents a new reservation; it does not invalidate
recovery already bound to the exact journal.

Each action is dynamically rechecked, then a signed intent is appended and
synced before mutation. Mutation addresses the approved locator only after the
full identity and ownership tuple match. Results are appended and synced.
Timeouts and interrupted daemon calls are ambiguous until exact postconditions
are observed; they are never blindly retried.

Receipts use strict versioned schemas and bounded categorical failures. The
deterministic receipt core is validated, canonicalized with RFC 8785 rules,
privacy-scanned, and hashed before the approval is finalized. The final envelope
binds that core to the immutable finalized transition. Private evidence remains
mode `0600`; upload-safe evidence contains opaque identities, counts, enums, and
digests, not raw paths, configuration, environment, output, wallet/user IDs, or
credentials.

Detached signatures use RSA/SHA-256 over the exact canonical bytes. A key ID is
the lowercase SHA-256 fingerprint of DER SubjectPublicKeyInfo. Verification
requires an explicit public key and expected fingerprint; an artifact's declared
key ID is not trust. Production authorization and evidence keys are distinct
from each other and from offline release keys. CI uses distinct ephemeral keys
that are never accepted by production policy. Rotation is an explicit bounded
overlap of trusted public-key fingerprints.

## Crash and retention semantics

`INT`, `TERM`, and `HUP` stop new actions and attempt bounded receipt
finalization. `SIGKILL`, host loss, or disk loss cannot guarantee a final receipt.
On a surviving filesystem, a deployment-scoped active pointer and synced journal
block competing mutation until exact recovery finishes. Recovery verifies the
hash chain, signatures, approval reservation, identities, and current policy;
already-absent targets are idempotent. Physical evidence durability beyond the
host requires a separate external journal and is not claimed here.

Manifests, approval transitions, journals, receipts, checksums, signatures, and
trusted public keys follow the configured evidence retention policy. An active
operation cannot delete its own evidence. Publication records remain available
for reconciliation for as long as the corresponding provider object is retained.

Deployment mutations use the same canonical lock before env, certificate,
checkout, image, database, or Compose changes. Ordered Compose inputs are copied
into immutable generation directories; manifests bind their hashes and source
identities but never env contents. A compare-and-swap pending pointer records
each completed stage, and the active pointer changes only after routed health.
After a crash, a new controller may resume that exact generation under the lock
only when its definition digest and prior-active compare-and-swap still match;
the handoff is recorded and completed stages are skipped.
Retained generations are the sole rollback definitions. Legacy or unlabeled
resources are diagnostic-only and are never adopted from names or topology.

## Consequences and non-goals

Legacy resources are reported but never adopted by inference. Persistent data
volumes are not recreated merely to gain labels. The protocol does not replace
application fencing, turn prefix matching into authority, promise crash evidence
after filesystem loss, or authorize provider-object deletion. The initial
destructive adapter is exact Docker cleanup; other adapters must meet the same
identity, journal, privacy, and receipt contract before activation.
