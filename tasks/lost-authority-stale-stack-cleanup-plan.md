# Lost-Authority Stale-Stack Cleanup Plan

Status: recursively reviewed; implementation in progress
Date: 2026-09-02
Baseline: `main` at `34eb8909d65b6355876148ddc009c6b1c2ea3592`

## Outcome

Remove only the four approved obsolete Fresh Install stacks whose original CI
cleanup authority roots were lost, while preserving ordinary fail-closed cleanup
semantics. Produce signed, single-use, journaled terminal evidence for the exact
resources actually removed. Do not claim reconstruction of the lost CI authority
or historical topology.

Targets are the four exact ownership tuples for projects
`ci-99604-1-fresh-install` through `ci-99607-1-fresh-install`. The active
`sanctuary` deployment, the unlabeled
`ci-local-3469272-1788333412-1-install-upgrade` project, and all unrelated,
current, shared, protected, persistent-data, or ambiguous resources are excluded.

## Authority and invariants

- Introduce a distinct `operator_lost_authority_recovery` authority kind. Never
  synthesize a CI provider state, legacy creation witness, or ordinary producer
  registration from labels.
- `observe` is read-only and accepts one bounded explicit target tuple. Production
  code is incident-agnostic; the checked closeout request binds this incident's
  exact four tuples and expected per-class counts. Observation derives the full
  candidate set from bounded per-project/per-class Sanctuary and Compose label
  selectors, refuses matching partial/malformed same-project evidence, resolves a
  local daemon context, performs two stable observations, and records exact
  locators, immutable identities, complete ownership tuples, observation digests,
  dependencies, target membership, policy digest, and a short expiry.
- The operator signs each exact per-stack recovery scope with the authorization
  key. Evidence signing remains a separate key and trust role. Both roles are
  anchored by a canonical owner-only host recovery-trust file provisioned outside
  the incident request; request-selected, replaced, expired, or same-role keys
  refuse. Its digest is bound into scopes, contexts, journals, and receipts.
- `prepare` verifies the signature/fingerprint and a short-lived,
  authorization-key-signed operator assertion that binds the exact local source
  tuple/commit and is the sole historical terminality authority. Provider evidence
  is explicitly unavailable for this incident: the numeric project suffixes are
  not Forgejo run IDs, two creation commits have no provider runs, and the only
  plausible run for the first commit skipped the relevant job. The attestation
  separately binds a diagnostic-only `provider_correlation_evidence` artifact covering provider instance,
  repository, queried commits, workflow/job predicates, complete pagination, all
  candidate run identities/statuses/conclusions, observation time, and freshness.
  the positive runs plus skipped relevant job for `49184c...`, exact zero-result
  queries for `fc2c6e8...` and `03ee720...`, unrelated numeric task collisions,
  and explicit absence of a run-attempt field. Unavailable or incomplete queries
  are recorded as unavailable, never negative; validators prohibit treating the
  diagnostic as terminal authority. Both artifact digests are bound into every
  scope. The scope binds the full original signed artifact digest, including its
  temporal envelope, plus its stable `queryResultCoreDigest`. The operator
  assertion never substitutes an unrelated or sibling run. Inside the locked
  approval-reservation path, preparation validates original freshness, performs a
  complete re-fetch with a new temporal envelope, records both artifact digests,
  compares only the stable core digest, and refuses on unavailability,
  response-shape/query/pagination/new-result drift, or stable-digest mismatch.
  It then revalidates
  revalidates every currently observable predicate
  (obsolete/exact-delete labels, no current/shared/data/protected target,
  dependency closure, pinned daemon, and held canonical project lock), scope
  expiry, and a byte-equivalent fresh observation before creating recovery state.
  The attestation never claims that missing historical state proves terminality.
- A recovery manifest and approval bind the exact scope digest. Ordinary inventory
  remains unchanged; only an exact recovery-manifest entry may replace a missing
  historical registration for an obsolete `exact_delete` resource.
- `operator-recovery-schema.mjs` is deliberately classified as one 530-line
  strict schema boundary: its builders and validators share the same exact-field,
  digest, timestamp, and cross-artifact invariants, every function remains below
  the CCN limit, and splitting those invariants would create a second schema
  authority. Files above 400 lines remain a design warning; all other recovery
  production files stay below the 500-line refactor trigger.
- Containers and networks use full engine IDs. Volumes use exact names plus full
  relevant-inspect fingerprints and a new attestation nonce (never represented as
  the lost creation nonce), and must have zero attachments at deletion time.
  OCI images and BuildKit caches are outside this incident and are never selected
  or mutated by this recovery mode.
- Execute four serial, independent per-stack recovery sessions, each with its own
  manifest, plan, approval, project/deployment locks, journal, recovery state, and
  receipt. Reinspect immediately before approval reservation and every action.
  Any drift refuses further mutation. Each later stack receives a fresh scope, so
  expiry or prior successful removals cannot strand the incident. A closeout
  record binds the sorted four scope and receipt digests; there is no synthetic
  daemon-wide lock.
- Scope and approval expiry block a new reservation. Once an approval is reserved,
  its exact journal remains recoverable after expiry under the existing semantics;
  the scope digest is bound into journal genesis and recovery validation.
- Reuse the existing ordered plan, single-use approval ledger, synced journal,
  timeout/cancellation reconciliation, deterministic receipt core, signatures,
  privacy projection, and exact recovery behavior.
- A `cleaned` receipt claims only that every explicitly enumerated approved
  container, network, and ephemeral-volume target reached its postcondition and
  that exact in-scope selectors find no replacement target. Retained images and
  BuildKit state are listed separately as out-of-scope observations. The incident
  request also binds explicit before/after sentinels for the active Sanctuary and
  named unlabeled project; exact-ID mutation protects other unenumerated resources
  without claiming they were all observed.
  It does not claim knowledge of unobserved historical resources.

## Implementation phases

### 1. Recovery scope and observation

- [x] Add strict schemas and validators for an incident-agnostic per-stack recovery
  scope, target attestations, exact resource entries, host recovery trust, and a
  four-scope/four-receipt closeout record. Add a diagnostic-only negative provider
  correlation-evidence schema with explicit completeness/unavailability semantics
  and Forgejo's real `commit_sha`/`workflow_id`/terminal-status field shape. Define
  `queryResultCoreDigest` over stable query authority/scope/results/pagination only;
  exclude observation/freshness envelope fields. The one-time signed artifact may
  retain the diagnostic repository-wide task-collision snapshot, but locked
  revalidation covers only server-filtered exact commit/workflow/job queries.
  Exclude mutable page positions, repository task totals, and unrelated records;
  include the query specification, exact matching records, and completeness bit.
  Bound candidate runs, jobs per run, pages, and decoded bytes; reject repeated
  cursors and apply one total deadline across list/detail/job queries. Any limit or
  deadline breach is incomplete/unavailable, releases held locks, and occurs
  before approval reservation.
- [x] Add a read-only CLI that creates a scope candidate from explicit exact
  target tuples and immutable resource selectors.
- [x] In the checked incident request, reject missing/fifth/wrong tuples and count
  mismatches. Generally reject dependency mismatch, duplicate identities within a
  stack, remote/TLS daemon contexts, incomplete labels, active/current,
  shared, protected, persistent-data, unlabeled, malformed, or unstable resources.

### 2. Recovery authority bridge

- [x] Verify the signed scope with a pinned operator fingerprint and reobserve it
  before creating owner-only recovery state.
- [x] Add an explicit schema-versioned recovery authority alternative to the
  tracked ownership contract and a recovery manifest/approval binding without
  changing normal manifest, registration, plan, or approval behavior.
- [x] Generalize the volume proof seam to an approval-bound recovery witness while
  preserving exact fingerprint, daemon, replacement, and attachment checks.
- [x] Refuse image and BuildKit entries in recovery scopes; report their unchanged
  presence separately during closeout without making them receipt targets.

### 3. Execution and evidence

- [x] Delegate each stack's mutation to the existing cleanup executor in dependency
  order: containers, networks, then eligible ephemeral volumes.
- [x] Preserve journal/recovery/cancellation semantics and add final closed-set
  observation against exact IDs plus complete target-label selectors.
- [x] Preserve distinct private and upload-safe signed evidence, bind each recovery
  scope/attestation digest into its journal and receipt, and bind the four terminal
  receipt digests in one closeout record.

### 4. Verification and delivery

- [x] Add regression-first schema, CLI, inventory, approval, runtime, executor,
  recovery, privacy, and normal-path compatibility tests.
- [x] Add fake-daemon proofs and reuse the existing opt-in real-Docker cleanup
  coordinator proof for the shared exact mutation runtime. Cover default refusal, nonmutating
  observation/dry-run, drift refusal, exact deletion, neighbor preservation,
  receipt verification, replay safety, missing/expired/mismatched operator
  attestations, negative-lookup pagination/repository/sibling/skipped-job cases,
  task/run namespace substitution, positive-result drift, tampering, stale or
  unavailable correlation evidence, acceptance of identical results with a fresh
  timestamp, immunity to unrelated task/page shifts, refusal of a new exact-commit
  relevant-job result, endless/repeated pagination, oversized bodies, excess
  matching runs/jobs, stalled later pages, and successful in-scope closeout with
  retained images.
- [x] Register the new boundary in lifecycle/quality scanners and document the
  operator ceremony and limitations.
- [x] Run focused tests, the complete ownership/install-unit gates, full precommit,
  syntax/type/lint/complexity checks, and two independent P0-P2 reviews. The full
  quality command reached and passed 100% frontend coverage before a newly
  published `fast-uri@3.1.5` advisory appeared. Both affected lockfiles were
  refreshed to compatible `fast-uri@3.1.7`, and the eight-target repository audit
  gate then passed with all three existing exceptions consumed.
- [ ] Deliver through one protected PR; require exact-head and landed-main CI.

### 5. Approved cleanup and closeout

- [ ] Reobserve all four exact targets and the excluded active/unlabeled neighbors.
- [ ] Generate, sign, and consume four short-lived per-stack scopes serially, each
  with its own dry-run and single-use approval. A reserved journal remains exactly
  recoverable after expiry; an unused later stack receives a fresh scope.
- [ ] Execute/recover the four exact plans, then sign and verify a closeout record
  over exactly four unique, signature-verified scope/receipt pairs. Each accepted
  receipt must be `cleaned`, or `recovered` with every approved action/result and
  postcondition successful, no refusal/ambiguity, exact per-stack bindings, and
  final in-scope closure; all other terminal states make closeout unsuccessful.
  Verify zero in-scope container/network/volume residue and unchanged explicit
  exclusion sentinels; separately report retained image/BuildKit observations.
- [ ] Remove only the recovery-owned merged branch/worktree after ancestry/tree
  and landed-main CI proof. Then hand control back for the next backlog workstream.

## Review record

Initial independent reviews converged on a separate operator authority, exact
immutable selectors, aggregate incident scope with per-stack receipt aggregation,
short-lived signatures, ordinary executor reuse, and truthful narrow receipt claims. Implementation must
be recursively reviewed before delivery; unresolved P0-P2 comments block mutation.

Four complete recursive passes resolved all P0-P2 findings. The final two
independent plan passes reported no remaining P0-P2 comments.

Implementation inventory then disproved the proposed provider binding: the four
projects came from local development executions, not the similarly numbered
Forgejo runs/tasks. The plan therefore preserves provider evidence only as a
negative lookup digest inside the operator attestation and requires another
recursive review before mutation.

That follow-up recursive review also converged cleanly. Implementation review
then found and closed three additional fail-safe gaps before delivery: same-project
partial-label discovery, stale recovery-controller lock takeover, and closeout
verification of signed approvals plus exact incident/exclusion evidence.

The final recursive implementation passes closed journal-aware survivor
projection (including stop/remove/absent/open-intent and dependency shrinkage),
atomic preparation/execution persistence, bounded provider and request I/O,
Forgejo's live bare-array job response, idempotent closeout, and material runtime
state in neighbor sentinels. Two independent reviewers reported no remaining
P0-P2 findings.
