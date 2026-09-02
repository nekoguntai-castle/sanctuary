# Post-v0.8.69 P0 Ownership Manifest and Cleanup-Receipt Plan

Status: completed through protected PR #999; final acceptance and fail-closed resource disposition recorded below
Date: 2026-08-30
Planning baseline: `origin/main` at `ee8baab03c4113c50f80183ff3aea068bc3c1ddc`
Backlog source: `tasks/todo.md`, “P0 — telemetry, overload protection, and ownership”

## 1. Outcome and scope

Deliver one machine-readable ownership contract and one fail-closed cleanup
protocol for every Sanctuary resource class named in the P0 backlog. The first
executable cleanup adapter will cover exact Docker/Compose resources; registered
host artifacts follow only after the same inventory, authorization, journaling,
postcondition, and receipt rules are proven.

This slice establishes the prerequisite for the later canonical canary controller,
telemetry contract, release ledger/resume path, and project-owned build-cache work.
It does not implement those later workstreams.

### In scope

- A tracked, strict resource-class policy and an external, per-deployment/per-run
  ownership manifest.
- Exact installed env-file and ordered Compose overlay/profile identity, without
  env contents or secret-derived hashes.
- Read-only inventory, signed dry-run planning, exact approved-plan execution,
  immediate pre-action identity checks, durable action journaling, postcondition
  inventory, and signed terminal cleanup receipts.
- Explicit ownership or retain/refuse treatment for wallet mutations,
  leases/fences, subscriptions, scheduled work, canary/replay collectors,
  containers, networks, volumes, images, build cache, worktrees, temporary files,
  receipts, and publication objects.
- Migration of existing CI/release cleanup callsites away from project-prefix,
  name/age, and daemon-global cache deletion as authority.
- Crash, SSH/HUP loss, cancellation, concurrency, current/shared/unlabeled, drift,
  privacy, signature, and real-Docker acceptance proof.

### Non-goals

- No wallet-sync mutation, database-fence, Electrum lock, or BullMQ scheduling
  behavior change. Their canonical lifecycle remains authoritative.
- No new canary controller, production telemetry/SLO, admission/backpressure,
  release state machine, or multi-worker enablement.
- No generic `/tmp`, Docker daemon, BuildKit, branch, worktree, image, or remote
  publication sweep.
- No deletion of production data volumes or immutable published release objects.
- No retroactive claim that a name, prefix, age, current user, or manifest entry
  alone proves ownership of an unlabeled resource.

## 2. Evidence and root causes

- `config/wallet-sync-lifecycle-contract.json`,
  `server/src/repositories/syncIntentRepository.ts`, and the worker runtime already
  define exact generation/token owners for wallet mutation and subscription work.
  The new contract must reference these authorities, not create a second fence.
- `scripts/ci/cleanup-docker-resources.sh` discovers Compose resources by exact
  project or prefix, downgrades mutation failures to warnings, and swallows several
  query failures as empty results. Its `--verify-empty` result therefore is not an
  ownership proof and can false-pass when inventory is unavailable.
- `scripts/setup.sh`, the RC workflow, and upgrade fixtures can run daemon-global
  `docker builder prune`. BuildKit cache on the default/shared builder has no exact
  Sanctuary owner, so this action cannot satisfy the P0 refusal contract.
- Compose resources have standard project/service labels but no common Sanctuary
  project/release/commit/run/owner/resource-class tuple. OCI images carry revision
  and image-lock evidence, but not run/owner lifecycle metadata.
- Env-file and overlay selection is independently reconstructed by `setup.sh`,
  `start.sh`, and install helpers. No durable record binds inspection, deploy,
  rollback, and cleanup to the same ordered definition.
- The current canary v2 verifier already provides strict schemas, bounded external
  evidence, safe no-follow reads, and a hash-bound raw sidecar. Release assets add
  real detached RSA/SHA-256 signatures, while publication receipts provide atomic
  external `0600` writes. The cleanup design will extract/reuse these patterns
  rather than create a competing receipt system.
- The current high-fanout replay writes a useful cleanup record and image receipt,
  but deletion is still name-based and cleanup evidence is not signed. It is a
  migration fixture for the new protocol.

Implementation must begin from a clean worktree freshly based on current
`origin/main`; the planning checkout is an older release branch and is evidence
only, not an implementation base.

## 3. Architecture decisions

### 3.1 Two-layer ownership model

1. `config/resource-ownership-contract.json` is the tracked, schema-versioned
   policy. For each resource class it names the lifecycle owner, creation sites,
   authoritative selector, immutable identity fields, active/current test,
   cleanup policy, dependency order, postcondition, and privacy class.
2. A deployment manifest and run manifest instantiate that policy outside the
   checkout. They record what this deployment/run actually owns. A policy entry
   never grants ownership retroactively.

The policy is an accidental-cross-run safety boundary, not protection from a
hostile root-equivalent or Docker-daemon peer. Labels are selectors, not
cryptographic ownership proof. External manifests/registrations must be created
atomically with owner-only directories/files (`0700`/`0600`), collision-resistant
IDs, and signed digest binding before they can authorize deletion.

The deployment record defaults under
`${SANCTUARY_RUNTIME_DIR}/ownership/deployments/<deploymentId>/` and contains the
canonical project directory/name, exact env-file real path, ordered overlay real
paths and SHA-256 values, selected profiles, install mode, release, commit, and
deployment ID. It never contains env values, a hash of secret contents, tokens,
private-key paths, or raw Docker configuration.

Only tracked canonical overlays or custom overlays that pass a strict parser and
secret-literal scanner may be hashed. Reject rendered/generated overlays and any
custom overlay containing credentials, tokens, private material, or secret-bearing
literal environment/config values; never hash a redacted secret-bearing file.

Write that record before the first managed resource is created. Updates use a
generation and compare-and-swap from the prior manifest digest: setup/deploy writes
the next definition before Compose mutation, marks it active only after health
passes, and retains the prior generation for rollback. Inspection, rollback, and
cleanup resolve one explicit generation rather than reconstructing current flags.
`deploymentId` is a stable installation identity; each immutable deployment
revision has its own generation/release/commit/definition digest and an atomic
active-revision pointer. Interrupted pending revisions remain non-authoritative and
make ownership resolution ambiguous/protected. Because Compose mutation is staged
and non-transactional, recovery inspects exact resource IDs/definition digests and
must either complete that same revision or execute and verify the recorded rollback
definition before restoring the prior active pointer; metadata-only abandonment is
forbidden.

One canonical deployment-scoped mutation lock and active-operation pointer live
under this stable root, outside per-run evidence directories. `setup.sh`,
`start.sh`, deploy, rollback, cleanup, and recovery all acquire it. The pointer
binds operation run, PID start identity, journal path, heartbeat, and generation;
stale recovery uses compare-and-swap and never age alone. Distinct run IDs or
evidence roots cannot mutate one deployment concurrently.

CI and release runs use an explicit absolute evidence root outside the checkout,
for example `$RUNNER_TEMP/sanctuary-ownership/<runId>/`. Destructive commands have
no implicit repository-local receipt fallback.

### 3.2 Common ownership tuple

Every supported resource instance carries or is paired with:

```text
project, deploymentId, ownerId, resourceClass, lifecycle, cleanupPolicy,
createdAt, createdByRelease, createdByCommit, creationRunId, immutableIdentity
```

- Creation provenance is immutable. Durable volumes keep their original
  `createdBy*` labels across later deploys; the deployment manifest separately
  records the active release/commit generation. Per-operation evidence uses a
  distinct `operationRunId`, so restarts never relabel an older resource as newly
  created.
- `createdByRelease` may be explicit `unreleased` outside a release run; it is
  never guessed from a mutable tag. Classes that cannot truthfully carry a field
  use an explicit schema value, not a fabricated current release/run.
- `ownerId` is a bounded operational role/instance ID, not a wallet/user ID.
- Docker labels use one documented `io.sanctuary.*` namespace. Compose project
  labels remain selectors but are not sufficient authority.
- Files/worktrees/processes that cannot carry labels require a safe external
  registration record containing canonical path or PID start identity plus the
  tuple. Symlinks, path replacement, dirty worktrees, PID reuse, and missing
  registration fail closed.
- Remote publication objects use provider object ID plus immutable tag/commit and
  are always `retain_reconcile`; generic cleanup can never delete them.
- A deployment/run liveness record has a bounded heartbeat, monotonic observation,
  terminal exit marker, and generation. Current or uncertain deployments/runs are
  protected; production decommission additionally requires an explicit signed
  decommission authorization and never implies data-volume deletion.

### 3.3 Resource-class policy

| Resource class | Authoritative owner | This slice’s cleanup behavior |
| --- | --- | --- |
| Wallet mutations and leases/fences | Database generation/token contracts and worker | Inventory/link only; reclamation stays in the application lifecycle |
| Electrum subscriptions and scheduled work | Worker lock epoch and canonical schedule IDs | Inventory/link only; stop/reconcile through canonical worker lifecycle |
| Canary/replay collectors | Registered run, PID start identity, script hash, heartbeat/exit marker | Stop only an exact registered process; canonical canary controller remains later work |
| Compose containers/networks/volumes | Full label tuple plus immutable Docker ID | First complete destructive adapter; active/current and data-volume policies refuse by default |
| OCI images | Immutable build provenance plus signed external owner/reference inventory | Delete only run-unique, unreferenced, explicitly disposable images; shared/release images retain |
| BuildKit cache | Dedicated builder/cache namespace only | Default/shared builder is `preserve_ambiguous`; remove broad prune now, add scoped GC in P2 |
| Worktrees | Registration, git common-dir, canonical path, branch/HEAD/base, clean state | Delete only an exact clean registered disposable worktree after branch/PR lifecycle proof |
| Temporary files/directories | Registration, canonical path, inode/device, creator run | Delete exact registered disposable artifacts only; never scan a temp prefix |
| Manifests, journals, receipts, signatures | Evidence run and retention policy | Immutable/retain; an active cleanup can never delete its own evidence |
| Provider tags/releases/assets | Provider IDs plus exact tag/commit/digests | Retain/reconcile only; mismatch stops the workflow |

### 3.4 Cleanup protocol and state machine

The standalone Node core under `scripts/ownership/` owns validation, safe file
access, canonical JSON, hashing/signing, inventory, planning, journaling, and
receipt verification. Shell entrypoints remain thin argument/exit-code adapters.
Keep modules small enough to remain below repository complexity/size thresholds.

Protocol:

1. `inventory` safely loads the policy, deployment/run manifests, and adapters;
   records each exact immutable ID and ownership tuple; and classifies unknown,
   shared, unlabeled, malformed, current, unavailable, and drifted resources.
   Any failed/partial query is `ambiguous`, never an empty inventory.
2. `plan --dry-run` computes ordered actions only from eligible inventory, writes
   the canonical inventory and action plan atomically, and emits a signed dry-run
   receipt without mutation. Refusals remain first-class receipt rows.
3. `authorize` writes a bounded, single-use approval statement over the dry-run digest,
   deployment/operation identities, permitted action count/classes, expiration,
   nonce, exact target IDs/actions, Docker/host context fingerprint, policy and
   manifest digests, and decommission intent when applicable. `apply` accepts only
   the exact signed dry-run and approval under the configured trust policy. It
   atomically transitions approval state from `unused` to
   `reserved(operationRunId, journal identity/digest)` before mutation and to
   an immutable `finalized(terminal outcome, final journal/inventory digests,
   validated receipt-core digest)` transition after postconditions but before
   receipt envelope serialization. Only recovery of that exact reserved journal may resume it;
   every other apply/run is refused. Expiry is checked when moving
   from `unused` to `reserved`; the exact reserved recovery may continue later,
   subject to every fresh dynamic eligibility check. A changed action set always
   requires a new plan and authorization. A plan/receipt signature is evidence
   integrity, not mutation authority. CI creates
   separate ephemeral authorization and evidence keys; production requires an
   attended operator authorization step.
4. Before the first mutation, `apply` validates signing capability, output paths,
   key pairing, manifest hashes, unused-approval freshness/scope, target liveness
   rules, required Linux/Docker/OpenSSL capabilities, and the canonical deployment
   lock. `recover` instead validates the exact reserved approval-state binding and
   does not reapply unused-approval wall-clock expiry. Unsupported safe-open/fsync/
   inspect semantics fail closed.
5. Immediately before each action, re-evaluate every policy eligibility and
   dependency predicate—not only immutable identity—including current/liveness,
   attachments/endpoints, image references, shared owners, lifecycle completion,
   and protected/data status. Then append and sync a signed `intent` journal
   record, re-inspect the immutable resource ID and entire ownership tuple, and
   compare it with the approved plan. Missing/changing/ambiguous state records a
   refusal; it never retargets by name. Mutate Docker objects by immutable ID, not
   display name. Append and sync the observed result after the action.
   Supervise each client subprocess in its own process group with bounded
   terminate/kill/wait. A timed-out or interrupted Docker client does not prove the
   daemon request stopped: classify it `ambiguous`, wait/reinspect exact IDs and
   postconditions, and never retry until the daemon-side result is reconciled.
6. Re-inventory through the same adapters. Failed postcondition queries are
   ambiguous failures. Final states are `dry_run`, `no_op`, `cleaned`, `partial`,
   `cancelled`, `refused`, `ambiguous`, or `recovered`.
7. After postconditions, construct the deterministic receipt core containing every
   runtime-derived payload field (including `receiptCoreFinalizedAt`), then strict-
   validate, canonicalize, privacy-scan, and hash it before committing terminal
   state. If validation fails, leave the approval reserved/recoverable and append
   no finalized transition. Append/fsync the immutable finalized transition with
   that safe core digest; build a final envelope from the unchanged core plus the
   finalized-transition digest/generation; scan it again; then write it atomically
   as mode `0600` and create detached signature/checksum sidecars. The transition
   and envelope bind one another through the prevalidated core without a digest
   cycle. Preserve the original workflow failure separately from cleanup outcome.
8. `recover` opens an incomplete journal safely, verifies its record hash chain
   and signed checkpoints, re-inventories every intended
   target, treats already-absent targets idempotently, refuses drift, completes
   remaining safe actions only when the original authorization signature/trust is
   valid and its durable state is reserved to this exact journal. Wall-clock expiry
   prevents an unused approval from starting but does not invalidate its already
   reserved recovery; fresh eligibility checks still gate every action. Recovery
   then appends the finalized transition and emits a signed recovered/partial
   receipt. If a valid finalized transition exists but receipt writing/signing was
   interrupted, recovery regenerates the exact deterministic receipt without
   permitting more mutation.

`INT`, `TERM`, and `HUP` stop new actions, journal cancellation, perform bounded
quiescence, and finalize a receipt. `SIGKILL`/host loss cannot synchronously emit a
terminal receipt. On a surviving filesystem, the deployment-scoped active pointer
makes the synced incomplete journal discoverable across run IDs and blocks a
competing mutator until `recover` finalizes it. Host/disk destruction is outside
this first slice; CI must not claim recoverable evidence after runner reimaging
unless it adds an acknowledged external durable journal. Documentation must state
these physical limits instead of claiming an impossible trap guarantee.

### 3.5 Receipt and trust envelope

Use strict versioned artifacts:

- `deployment-manifest.json`
- `run-manifest.json`
- `inventory-before.json`
- `cleanup-plan.json`
- `cleanup-approval.json` and `cleanup-approval.json.sig`
- deployment-scoped immutable `approval-state/<approvalDigest>/<generation>.json`
  transitions plus an atomic current-state pointer
- `action-journal.jsonl`
- `inventory-after.json`
- `cleanup-receipt.json`, `cleanup-receipt.sha256`, and
  `cleanup-receipt.json.sig`

The journal is append-only, each record contains the previous record digest, and
each record has an approved-plan digest and strict sequence number. The intent
checkpoint written before every mutation is signed and fsynced with its parent
directory. Recovery rejects gaps, truncation, unexpected append, broken chains, or
unknown actions and reconciles every approved action. It never acts from an
unsigned or broken chain.

Approval state is an owner-only, parent-fsynced deployment ledger keyed by approval
digest. Every monotonic `unused`, `reserved(operationRunId, journal
identity/digest)`, and `finalized` transition is immutable; an atomically replaced
pointer selects the current generation. Compare-and-swap under the deployment lock
excludes replay across processes and run IDs. Older transitions remain verifiable
for receipt retention and are never stored only in a per-run directory.

The receipt binds schema/gate version, policy/deployment/run manifest digests,
approved dry-run digest, finalized approval-transition digest/generation,
before/after
inventory digests, ordered intended actions,
per-action results and bounded failure classes, refusals, postconditions, finalized
journal digest/byte length/record count, final state, operation start/end and
`receiptCoreFinalizedAt` times,
commit/release/deployment/run/owner, and signer key ID.
It contains no secret, wallet/user identifier, raw container env/config, arbitrary
command output, or unbounded error text.

Sign the exact canonical receipt bytes with detached RSA/SHA-256, matching the
existing release-asset convention. Compute key IDs from the public key's DER SPKI
SHA-256 fingerprint, not from PEM file bytes. Verification requires an explicit
public key and expected fingerprint; a self-declared key ID is not trust.
`receiptCoreFinalizedAt` records deterministic core finalization, not the physical
signature event; detached signatures carry no asserted signing timestamp. Verify
`operationStartedAt <= operationEndedAt <= receiptCoreFinalizedAt <= now` and keep
recovery byte-identical even when the signature is recreated later.

- Production/release cleanup uses a dedicated operator-held authorization key and
  a distinct controller evidence-signing key; neither is the offline release key.
  The trust configuration records accepted public-key fingerprints,
  authorization/evidence roles, and bounded rotation overlap; private keys stay
  external and are never inherited by child mutators.
- CI creates distinct job-scoped ephemeral authorization and evidence keys, records
  their public-key fingerprints and CI run identity as lower-authority test
  evidence, and uploads only the public keys. CI keys must never satisfy a
  production cleanup trust policy.
- Signing key/output-path/public-key pairing is preflighted before mutation.
  Signing failure after a crash leaves the journal recoverable and can never be
  reported as cleanup success.
- Define separate local-private and upload-safe schemas. Raw env-file/overlay/
  worktree paths, literal overlay hashes, host identity, container names, and
  registrations remain only in private `0600` manifests/receipts. Upload-safe
  projections carry opaque resource/deployment IDs, allowlisted enums, public
  artifact digests, and a signed private-receipt digest, not host paths or
  secret-bearing overlay hashes. The operator-only local view may resolve them.

## 4. Serial delivery plan

### PR 1 — policy, schemas, verifier, and architecture contract

- Add `config/resource-ownership-contract.json` covering every resource class in
  section 3.3, with a checker that validates strict keys, unique classes/selectors,
  canonical paths, allowed cleanup policies, dependency DAG, lifecycle owner, and
  postconditions.
- Add `config/resource-lifecycle-callsites.json`, a mechanically checked inventory
  of every creation, mutation, registration, and cleanup site by resource class.
  Include old-wrapper callers and direct Docker/Podman deletion in install/RC,
  extended upgrades, replay, setup, integration tests, Podman socket canary, vector
  verification, CVE observation, hardware/address proof harnesses, Grafana helpers,
  and post-cleanup diagnostics. Each site must migrate or carry a narrow,
  evidence-backed non-Sanctuary exemption with its exact safety contract.
- Add dependency-light `scripts/ownership/` primitives for canonical JSON, safe
  bounded external file reads/writes, SHA-256, detached-signature creation and
  verification, DER-SPKI key fingerprints, strict manifest/plan/approval/journal/
  receipt validation, and privacy scanning. Use RFC 8785 canonical JSON bytes with
  the stricter repository subset of booleans/null, safe integers, arrays, and UTF-8
  strings; reject floats and duplicate semantic keys. Pin RFC key order, escaping,
  Unicode preservation, no insignificant whitespace, and no trailing newline with
  cross-process fixtures. Extract shared patterns only where dependency
  direction remains clean; do not import server-only support-package code into an
  operator CLI.
- Add `docs/adr/` ownership/cleanup architecture and an operator reference covering
  taxonomy, state machine, trust/rotation, privacy, crash semantics, ambiguity,
  retention, and non-goals.
- Register config/scripts/docs paths with architecture/quality classifiers,
  workflow triggers, CI registration-completeness checks, and root-layout docs.

Acceptance:

- Exact/invalid/unknown-field/duplicate/cycle/path/privacy schema fixtures.
- Stable canonical bytes and digests across key order; reject unsupported JSON
  values, unsafe integers, duplicate semantic IDs, oversize/truncated/symlink and
  in-checkout external evidence.
- Valid, wrong-key, wrong-fingerprint, tampered payload/hash/signature, future or
  ill-ordered timestamps, and private-key leakage tests.
- Architecture classifier tests, docs build/link checks, Node syntax, focused unit
  tests, and exact-head/landed-main CI before PR 2.

### PR 2 — deployment/run manifests and producer stamping

- Add one resolver used by `setup.sh`, `start.sh`, backup/rollback inspection, and
  install helpers to write/read the exact deployment definition. Preserve ordered
  base/offline/monitoring/Tor overlays and MCP profile selection; canonicalize
  realpaths and hash overlay files, never env contents. Implement the pending to
  active generation transition and rollback to a retained prior generation; refuse
  concurrent/stale compare-and-swap writers.
- Introduce the canonical deployment mutation lock in every setup/start/deploy/
  rollback path before cleanup execution exists. Test two run IDs/evidence roots,
  stale-pointer recovery, and start/rollback contention.
- Add common Compose labels to newly created services, networks, and volumes.
  Preexisting unlabeled networks and persistent volumes are inventoried and
  preserved/refused; Docker cannot relabel them in place, and this plan never
  recreates a data volume to gain labels. OCI labels contain only immutable build
  provenance. Per-deployment/run owner, lifecycle, references, and cleanup policy
  live in signed external registrations. Preserve the shared backend image used by
  backend/worker/MCP/migrate roles.
- Add registration hooks for out-of-band Grafana helpers, replay/canary collectors,
  run-unique CI images, isolated workspaces/worktrees, temp artifacts, receipts,
  and publication object identities.
- Record application-owned wallet/lease/subscription/schedule authorities as
  reference entries without changing their fencing logic.
- Refuse legacy/unlabeled adoption by inference. Provide read-only migration
  diagnostics; any future adoption requires separate explicit operator policy.

Acceptance:

- Deployment fixtures cover external and legacy env paths, path replacement,
  custom project, offline core, monitoring, Tor, offline overlays, and MCP.
- Overlay fixtures accept tracked/validated secret-free definitions and reject
  literal credentials, rendered secret-bearing overlays, and redaction-then-hash.
- Upgrade/rollback fixtures prove existing Postgres/Redis volumes and networks are
  neither recreated, retroactively claimed, nor deleted; an interrupted pending
  revision does not become active. Inject failures after Postgres startup, password
  reconciliation, and partial full-stack recreation; cleanup remains refused while
  pending, and recovery completes the same revision or rollback restores the
  recorded definition without changing data-volume identity.
- Compose config tests require the tuple on every eligible service/network/volume;
  Dockerfile/OCI tests require revision/source/build identity without allowing
  `unknown` in a release run.
- Registration tests cover PID reuse, dirty/unregistered worktrees, inode/path
  replacement, shared image references, and immutable publication retain policy.
  A second image consumer/run changes lifecycle state to shared/retain, and
  removing one registration cannot authorize image deletion.
- Secret/output regression tests prove manifests contain required paths/flags but
  no env values, secret-derived hashes, tokens, wallet IDs, or private-key paths.
- Focused install/release tests, classifiers, type/syntax checks, and exact-head/
  landed-main CI before PR 3.

### PR 3 — read-only inventory and signed dry-run

- Implement adapter interfaces and the Docker/Compose adapter first. Query errors,
  timeouts, malformed inspect output, partial pages, and permission errors produce
  ambiguous inventory and a nonzero result.
- Inventory exact labels plus immutable IDs for containers/networks/volumes and
  exact digest/reference state for images. Record but refuse current, shared,
  protected production, data, unlabeled, default-builder cache, and drifted rows.
- Add read-only adapters for registered processes, worktrees, temp artifacts,
  receipts, and publication identities. They may plan only policies explicitly
  enabled by the tracked contract.
- Implement deterministic action dependency ordering and a signed dry-run/no-op/
  refused/ambiguous receipt. Dry-run executes zero mutating subprocesses.
- Implement and verify the bounded approval statement, but keep `apply` disabled
  outside isolated acceptance until PR 4 proves execution and recovery.
- Add manifest-aware inventory/plan modes to `cleanup-docker-resources.sh`, but
  preserve guarded legacy mutation behavior unchanged until each caller migrates
  in PR 5. Pin per-phase compatibility: unchanged legacy callers still reclaim
  exact non-production resources and surface failures. Do not silently turn an
  active cleanup caller into diagnostics-only behavior. As soon as manifests exist,
  the wrapper detects a manifest-enabled project and acquires its canonical
  deployment lock/current-generation protection before legacy exact-project
  mutation. Unlocked fallback is allowed only for explicitly pre-manifest,
  non-production fixtures; race it against start/rollback before PR 4.

Acceptance:

- Current, eligible obsolete, shared/multi-owner, unlabeled, protected, active,
  image-reference, default-builder, worktree, temp, receipt, and publication
  fixtures.
- Docker query timeout/error and partial inventory cannot become empty/success.
- Dry-run/no-op/idempotent planning, stable action order/digest, exact refusal
  reasons, concurrent inventory, and privacy/signature verification.
- Fake Docker/Podman differences are pinned, including forced-image behavior and
  shared `:local` refusal.
- Focused unit/install/CI tests and exact-head/landed-main CI before PR 4.

### PR 4 — exact execution, journal/recovery, and cleanup receipts

Implementation lock (reviewed before execution work):

- [x] Bind the canonical engine, daemon/context fingerprint, normalized selector
  scope, protected/data/shared inputs, and registration snapshot digest through
  inventory, plan, approval, journal, and receipt. Apply recomputes that context
  and refuses drift; a caller-selected engine string is never sufficient authority.
- [x] Add owner-only, no-follow execution storage derived only from the approval
  digest. Its CAS state is `unused -> reserved -> finalized`; its append-only,
  fsynced journal is hash-chained, signs every checkpoint, and binds the approval,
  operation, ordered action, expected identity/ownership, fresh observation,
  result, and reconciliation state.
- [x] Persist a deployment-scoped active-cleanup pointer outside the mutation-lock
  directory. Start, deploy, rollback, and a second cleanup refuse an unmatched
  pointer even after a crashed controller's stale locks are recovered.
  Create/fsync the journal, CAS this pointer, then reserve the approval; recovery
  may clear an exact pre-reservation pointer without mutation, while any reserved
  pointer remains blocking until exact recovery finalizes it.
  Its owner-only/no-follow payload binds approval digest, original operation,
  immutable journal genesis/identity digest, and generation; recovery derives the
  live head only by verifying the signed chain, so the pointer never races a
  mutable journal head. Keep it through finalized-state and all
  exact receipt/signature/checksum writes, then CAS-tombstone it only after those
  bytes verify. Recovery reconciles every pointer/reservation partial combination
  under both locks; deploy, rollback, start, and another cleanup refuse every live
  or incomplete combination and may only reconcile a fully verified terminal one.
- [x] Break the receipt/state digest cycle by defining `receiptCoreDigest` over the
  validated execution receipt with `approvalStateDigest` set to `null`. The
  finalized approval state binds that digest; the signed terminal envelope then
  adds the finalized approval-state digest. Recovery recomputes this exact core and
  never mutates after a finalized transition.
- [x] Split unused approval verification from reserved recovery. Expiry prevents a
  new reservation, while the exact reserved journal remains recoverable after
  wall-clock expiry. No different journal or operation may consume the approval.
- [x] Acquire project then deployment lock with one owner/token and make inventory
  self-lock-aware only for that exact owner. Foreign, stale, missing-owner, or
  ambiguous locks remain hard refusals.
- [x] Recovery acquires both locks under a fresh controller run identity and appends
  a recovery checkpoint binding that controller, both observed stale-lock owner
  states, the original authorized operation, and the exact prior journal head. Each
  lock observation is discriminated as absent/released or an exact stale-owner
  digest; only recovery may CAS-reclaim the latter before acquiring fresh project
  then deployment locks. Cover both-absent, both-stale, and each partial boundary.
  It never impersonates the dead controller or changes the receipt operation identity.
- [x] Implement Docker mutation in a separate adapter with bounded process-group
  supervision. Containers, networks, and images mutate only by immutable ID;
  volumes mutate by name only after immediate fingerprint/nonce/ownership and zero-
  attachment verification. BuildKit and host-artifact adapters remain non-mutating.
- [x] At every action boundary reload deployment/run authority and all signed
  registrations. The first action requires fresh eligibility for the approved
  identity/ownership. Later actions accept only explicitly derived predecessor
  state (for example, the same container stopped by the immediately prior action),
  while rechecking every current/shared/data/reference/protection predicate.
- [x] Fuse signed OCI ownership and volume fingerprint/nonce registrations into the
  Docker observation before either class can become eligible; runtime image labels
  alone and a volume name alone are never deletion authority.
- [x] Journal and fsync intent before mutation, reconcile exact state before any
  later mutation, journal every bounded result, run authoritative postcondition
  inventory, privacy/schema-check the deterministic receipt core, finalize state,
  and idempotently finish the immutable signed receipt sidecars.
- [x] Pin each fail-stop boundary to: fresh full eligibility; signed+fsynced intent;
  a second exact immutable-ID/full-ownership-tuple inspection; exact mutation;
  authoritative reconciliation; signed+fsynced result. Any refusal, clean mutation
  failure, cancellation, or unresolved ambiguity stops all later actions. Only a
  reconciled success or approved already-absence may advance.
- [x] Precompute and validate the terminal journal record and its resulting chain
  digest, build/privacy-check the receipt core against that predicted digest, then
  append/fsync the exact terminal record before finalizing approval state. This
  avoids a journal/receipt digest cycle as well as the approval-state cycle above.
- [x] A timed-out, interrupted, or response-lost mutation intent is never replayed.
  Recovery may reconcile a proven exact absence/satisfied postcondition; otherwise
  it finalizes partial/ambiguous evidence and issues no later mutation.
- [x] Add fake-process, crash/cancellation, concurrent apply/recover, evidence-write,
  and isolated real-Docker acceptance. Cover every PR 4 acceptance boundary and
  preserve a separate bounded subject exit status for PR 5 wrapper propagation.
  Include crash/concurrency barriers before/after pointer creation, approval
  reservation, finalization, each receipt sidecar, and pointer tombstoning.

- Implement approved-plan execution under the canonical deployment mutation lock,
  pre-action journal sync,
  immediate ID/tuple reinspection, bounded subprocess timeouts, dependency order,
  per-action result journaling, postcondition inventory, and terminal receipt.
- Containers stop/remove before networks; disposable volumes require an explicit
  non-data policy; run-unique unreferenced images follow. Default/shared BuildKit
  cache is never deleted.
- Preserve original workflow exit status while surfacing cleanup partial/failure as
  a separate required result. A mutation command failure must not be only a warning.
- Implement bounded INT/TERM/HUP cancellation and SIGKILL recovery. A new run sees
  the incomplete journal and refuses until exact recovery resolves it.
- Keep process, temp, and worktree adapters read-only/refuse in this PR. Their
  destructive primitives require their own real-resource acceptance after Docker
  protocol proof.

Acceptance:

- ID/label drift at every action boundary, disappearing/already-absent resources,
  one-action failure, postcondition query failure, lock contention, and replay.
- Flip current-deployment state, image references, volume attachments, network
  endpoints, shared owners, and lifecycle completion after approval and between
  actions; each changed predicate refuses before mutation.
- INT/TERM/HUP before/between/after actions; forced SIGKILL after journal intent
  and after mutation; recovery neither repeats unsafe work nor loses evidence.
- Timed-out/interrupted Docker clients leave no orphan client process; daemon-side
  effects remain ambiguous until exact-ID reinspection/postconditions reconcile
  them, and no second mutation is issued while reconciliation is unresolved.
- Crash immediately after approval reservation, after intent, and after mutation;
  concurrent apply/recover, wrong-journal replay, an expired unused approval, and
  exact reserved-journal recovery after wall-clock expiry. Only the exact reserved
  journal resumes; an expired unused approval never starts.
- Signing/output failure before mutation, recovery after final-sign failure,
  immutable receipt path collision, and signed partial/cancelled/refused outcomes.
- Crash before/after finalized-transition append and before/after receipt write/
  signature. A finalized transition never permits more mutation, regenerates one
  exact receipt idempotently, and remains verifiable after later approvals.
- Inject forbidden data into bounded action/result fields and prove privacy failure
  commits no finalized transition and exposes no unsafe receipt artifact.
- No self-cleanup of manifests/journals/receipts and no remote publication delete.
- An isolated real-Docker fixture proves signed dry-run/approval, exact immutable-ID
  deletion, current/shared/unlabeled/data survival, postconditions, no-op replay,
  cancellation, and recovery before execution code merges.
- Focused tests, isolated real-resource acceptance, and exact-head/landed-main CI
  before PR 5.

Local implementation review (2026-08-31):

- The complete default ownership suite passes with 240 tests and two intentionally
  skipped real-Docker cases; producer-hook and deployment-lifecycle bridges pass.
- Isolated real-Docker acceptance passes both exact deletion/recovery and
  cancellation cases, with no surviving fixture resources or supervisor process.
- Frontend tests pass 8,260/8,260; server tests pass 15,703 with only configured
  integration skips; the complete typecheck, ownership-contract checker, workflow
  composition, CI registration, syntax, diff-hygiene, and complexity gates pass.
- Successive independent P0-P2 reviews closed predicate-boundary, signal-timing,
  stable-read, and private-key permission gaps. The final exact-tree architecture,
  security, and acceptance rereviews returned `CLEAN`. Exact-head and landed-main
  CI remain delivery gates before PR 5 starts.

### PR 5 — callsite convergence and real-resource proof

- Migrate install-test, extended-upgrade, release-candidate, replay, and install
  helper cleanup callsites to create manifests, upload dry-run/final receipts on
  every reachable exit, verify signatures, and require postconditions.
- Cover the complete current caller inventory: every exact/prefix/runner-leftover
  call in `.github/workflows/install-test.yml` and
  `.github/workflows/release-candidate.yml`,
  `scripts/ci/run-extended-upgrade-fixtures.sh`, install E2E/helper cleanup, the
  high-fanout replay, setup/upgrade cache-recovery, and post-cleanup diagnostics.
  Include every direct site in `config/resource-lifecycle-callsites.json`; migrate
  each Sanctuary-owned site or verify its narrow exemption. Make inventory drift
  and new unclassified bypasses fail CI.
- Replace daemon-global `docker builder prune` in setup/upgrade/release flows.
  Retry known corruption with `--no-cache` without deleting shared cache, or stop
  with an owned-builder migration instruction. Do not claim scoped cache cleanup
  until P2 provides a dedicated namespace/quota implementation.
- Remove destructive project-prefix and runner-name/age modes after all owned
  callsites migrate. Retain a read-only ambiguity report if operationally useful.
- Converge high-fanout replay cleanup/image records and canary v2 cleanup evidence
  on the common envelope without replacing the canary’s existing domain schema or
  raw sidecar.
- Add a PR-capable, docker-socket acceptance job selected only by ownership/
  cleanup inputs. Upload receipts/public keys even on failure where the runner
  remains available.

End-to-end callsite acceptance fixture:

1. Create run-unique eligible, current, shared, and unlabeled containers, network,
   volume, and disposable image under an exact trap.
2. Prove dry-run mutates nothing and the signed plan verifies.
3. Apply the exact approved digest; delete only eligible resources.
4. Prove current/shared/unlabeled/data resources survive, postconditions are exact,
   receipt/signature verify, and a second run is signed `no_op`.
5. Interrupt a separate fixture, recover it, and prove no orphan client process,
   no unreconciled daemon operation, and no duplicate unsafe action.

PR 5 Docker/Compose/image/build-cache acceptance:

- New focused ownership/schema/crypto tests.
- `bash tests/ci/cleanup-docker-resources.test.sh` and the complete install-unit
  suite via `scripts/ci/run-install-unit-tests.sh`.
- Install, architecture, quality, and workflow classifier/registration tests;
  workflow composition; shell and Node syntax checks; docs build/link checks.
- Real Docker acceptance on PR and main, with receipt artifacts verified.
- A Docker/resource-lifecycle inventory check proves no remaining broad builder/
  system prune and no owned Docker/Compose/image/cache callsite bypasses manifest,
  deployment lock, receipt, and postcondition.
- Exact-head and landed-main CI are green; an independent P0-P2 review finds no
  remaining correctness/safety issue in this phase.

Implementation checkpoint: the broadened bidirectional lifecycle registry contains
231 classified identities and zero Docker migrations. Exact-tree verification passes
342 ownership cases (339 pass and three opt-in real-Docker skips), 3/3 isolated
real-Docker acceptance cases, 677 workflow-composition assertions, the complete
15-install-plus-2-CI-composition install-unit gate, 10/10 CI registration checks, and
the complete quality gate with 8,271/8,271 tests and 100% coverage. A coordinated
address-verifier recovery produced verified signed final evidence and left no exact
resource residue. Independent architecture, security, recovery, callsite-scanner,
acceptance, subject-authority, and crash-window rereviews returned `CLEAN`;
protected PR #994 merged with exact-head CI green. Landed-main Fresh Install then
exposed the deferred host-authority handoff: the subject passed, but cleanup
refused after its coordinator authority changed. PR 6 owns that remaining
landed-main acceptance gap rather than weakening the refusal.

### PR 6 — registered host-artifact execution

- Add a small Linux safe-operation helper for process and path primitives. Process
  signaling uses `pidfd_open`/`pidfd_send_signal` after validating registered start
  identity; if pidfd is unavailable, process cleanup remains refused/read-only.
- Temp/worktree paths require an exclusively controlled registered `0700` parent.
  Use descriptor-relative no-follow operations to atomically quarantine the entry,
  verify registered device/inode after quarantine, restore/refuse on mismatch, and
  recursively delete only through the held parent descriptor. Never use a path-only
  recursive deletion primitive on a mutable/shared parent.
- Worktrees additionally require a git common-dir lock, clean state, exact
  branch/HEAD/base, completed PR/release lifecycle evidence, and exact metadata/
  registration cleanup. Collector processes require script hash, pidfd identity,
  terminal/heartbeat policy, and bounded stop/exit postconditions.
- Migrate only registered host-artifact creators after each adapter’s fixture
  passes. Unregistered legacy paths/processes remain visible but refused.

Acceptance:

- Adversarial PID reuse and entry replacement precisely between inspection and
  action; mutable/shared parent, symlink, mount/device, dirty worktree, changed
  HEAD/base, active collector, signal timeout, and partial deletion cases.
- Same-parent quarantine/restore, caught-signal cancellation, SIGKILL journal
  recovery, concurrent common-dir operations, idempotent already-absent replay,
  and no cleanup of active evidence.
- Real registered process/temp/worktree fixtures plus focused/static/full gates and
  exact-head/landed-main CI.
- The complete lifecycle-callsite inventory has no unclassified or legacy
  destructive host-artifact bypass. Repository-wide searches and independent
  P0-P2 review cover every serial phase before closeout.

Implementation checkpoint: the Linux helper, typed v1.1 host registrations,
registered staging/collector/start-gate adapters, isolated subject drivers, and
host cleanup integration are complete. The lifecycle registry classifies 388
scanned identities plus nine preserved provider/evidence/application identities,
with zero host-artifact or Docker migrations. Real registered process, staging,
collector, upload, isolated-workspace, subject-driver, and cleanup-CLI fixtures
pass. The complete install-unit gate, 680 workflow-composition assertions, 10/10
CI registration checks, 401 ownership cases (398 pass plus three opt-in
real-Docker skips), all typechecks, and 8,277 behavioral tests at 100% coverage
pass. The Semgrep report has seven findings, all matched by the reviewed baseline;
gitleaks and npm audit gates pass. Two independent P0-P2 reviews returned `CLEAN`.
Exact-head and landed-main CI, including Fresh Install, remain delivery gates.

## 5. Rollout and backout

- PR 1 and read-only PR 3 can be backed out without resource changes. PR 2 backout
  stops producing/authorizing new tuple labels and registrations but preserves
  already-labeled resources. It never relabels/recreates persistent volumes or
  networks merely to roll back. Forward-to-backout fixtures compare Compose config
  and exact resource IDs to prove data identity is preserved.
- PR 4 execution remains disabled at production/workflow callsites until its fake
  and isolated real-resource acceptance passes. PR 5 migrates one class of caller
  at a time, preserving the
  old exact-project cleanup as an emergency compatibility path only where it is
  explicitly non-production and still guarded; delete that path at convergence.
- PR 6 keeps each host adapter and caller disabled until its own adversarial real
  fixture passes, then migrates process, temp, and worktree classes separately.
  Backout disables further host mutation while retaining registrations, approval
  state, journals, receipts, and refusal visibility. Already-deleted disposable
  artifacts are not claimed recoverable.
- Any ambiguous inventory, trust mismatch, incomplete journal, active/current
  resource, or failed postcondition stops destructive progression. Backout means
  preserve resources and evidence, not broaden selectors.
- A schema change requires a new version and explicit verifier compatibility.
  Never rewrite, resign, or overwrite an existing receipt or journal.
- Do not exercise the new production cleanup path until distinct authorization and
  evidence trust keys/fingerprints are provisioned and the operator produces the
  single-use signed approval for the exact dry-run.

## 6. Completion criteria

- Every P0 ownership-ledger resource class has one documented authoritative owner,
  lifecycle, immutable selector, cleanup/retain policy, and postcondition.
- Inspection, deploy, rollback, and cleanup consume the same exact deployment
  definition, including env-file path and ordered overlays/profiles.
- No destructive action can be selected by prefix/name/age alone, and unknown,
  shared, unlabeled, current, drifted, or unavailable resources fail closed.
- Inventory, dry-run authorization, actions, failures, recovery, and postconditions
  are hash-bound in a strict, privacy-safe, cryptographically verified receipt.
- Crash and cancellation semantics are honest and proven: caught signals finalize;
  uncatchable process loss on a surviving filesystem leaves a deployment-scoped
  blocking durable journal that recovery finalizes. Host/disk loss is not claimed.
- Existing wallet/lease/subscription/schedule fences and immutable publication
  policies remain canonical and unchanged.
- Broad Docker/BuildKit prune is absent from owned Sanctuary workflows.
- The final recursive plan review has no remaining verified actionable comment.

## 7. Recursive review record

Six full review passes converged on 2026-08-30. The final architecture/trust and
sequencing/rollout passes independently returned `CLEAN`; no verified actionable
P0-P2 plan comment remains.

Implementation completed through protected PRs #989-#999. The six planned phases,
three landed-main CI compatibility corrections, and the manifest-bound legacy
Grafana correction are merged. Exact-main local generation 2 is healthy and the
routed API returns HTTP 200. The final resource sweep removed only an independently
reverified empty test network. Four obsolete Fresh Install stacks were deliberately
retained because their private cleanup authority roots had already been lost; this
is the plan's explicit host/disk-loss fail-closed outcome, not permission to infer
authority from labels or logs. The unlabeled local install/upgrade stack was also
retained. Detailed merge, verification, rebuild, and disposition evidence is in
`tasks/implement-merge-ownership-cleanup-ledger.md`.

Accepted improvements applied:

- Separated destructive authorization from evidence signing; added exact bounded
  approvals, distinct trust roles/keys, immutable reservation/finalization state,
  replay exclusion, and crash-safe deterministic receipt recovery.
- Added per-action dynamic eligibility rechecks, immutable-ID mutation, daemon-side
  ambiguity reconciliation, hash-chained/signed journals, and journal/approval
  history binding in receipts.
- Added stable deployment identity/revisions, one cross-run mutation lock shared by
  setup/start/deploy/rollback/cleanup, staged-Compose recovery, legacy volume/network
  refusal, and precise backout semantics.
- Split OCI build provenance from lifecycle ownership, added a mechanically checked
  creation/cleanup callsite inventory, preserved legacy caller behavior until
  migration, and separated Docker rollout from later safe host-artifact adapters.
- Added accidental-vs-hostile ownership boundaries, local-private/upload-safe
  schemas, secret-free overlay hashing, RFC 8785 byte rules, pidfd and descriptor-
  relative host primitives, and adversarial real-resource acceptance.
- Removed circular/unsafe terminal ordering: validate and privacy-scan a deterministic
  receipt core, append its immutable finalized approval transition, then sign the
  envelope that binds that transition. Recovery preserves truthful deterministic
  finalization time without claiming a physical signature timestamp.

Rejected or deferred comments:

- Replacing RSA/SHA-256 solely because it is RSA was preference-only; the plan uses
  the existing detached-signature convention with pinned key roles/fingerprints.
- Treating already-absent recovery targets as defects was rejected; they are an
  explicit idempotent outcome after a durable intent, never proof of who deleted.
- Extending this owner into wallet mutation reclamation was rejected because the
  database generation/token and worker lifecycle remain canonical.
- Adopting unlabeled legacy resources or retaining prefix/name/age as ownership was
  rejected as contrary to the fail-closed backlog requirement.
- Scoped BuildKit quotas/garbage collection remains P2; P0 removes broad prune and
  preserves ambiguous shared cache.
- Synchronous receipt guarantees after SIGKILL or host/disk destruction were
  rejected as physically impossible. This slice guarantees recovery from a synced
  deployment-scoped journal on a surviving filesystem; external durable supervision
  belongs to the later canonical canary controller.
