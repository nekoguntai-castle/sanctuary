# Bug Scrub Loop Iteration 11: Session, Runtime, URI, and Grafana Correctness

## Objective

Resolve every P0-P2 defect confirmed by the fresh whole-repository scrub at
`2cdbcd0949c33924030cd48ae8eb6bae4c0677ad`. Deliver four independently
releasable implementation phases through reviewed head CI, byte-identical
squash merges, and exact target-SHA CI, then return control to the loop for a
new locked-scope scrub.

## Confirmed Findings

1. **P1 — auth-session-revocation-storage-errors-swallowed.** Logout and
   targeted session revocation turn database deletion failures into success,
   leaving a refresh credential able to mint another access token.
2. **P1 — backup-restore-feature-flags-runtime-stale.** Restore replaces
   feature-flag rows but does not refresh process-local caches or conditional
   worker schedules, so pre-restore runtime behavior persists indefinitely.
3. **P1 — send-review-psbt-creation-outlives-reset.** A PSBT request started for
   old outputs can resolve after Back/Edit reset, repopulate signing state, and
   be signed while the review UI shows newer recipients.
4. **P2 — targeted-session-revoke-leaves-access-jwt-active.** Removing one
   listed refresh session does not revoke the access JWT issued with it.
5. **P2 — logout-body-token-overrides-current-refresh-cookie.** A stale legacy
   body token wins over the current HttpOnly cookie during logout.
6. **P2 — refresh-cookie-ttl-ignores-configured-jwt-expiry.** The refresh JWT
   honors configuration while the browser cookie is fixed to seven days.
7. **P2 — refresh-openapi-requires-body-token-for-cookie-flow.** Runtime accepts
   cookie-only refresh, but OpenAPI requires a body token an HttpOnly-cookie
   browser cannot read.
8. **P2 — group-member-replacement-nonatomic.** Replace-all membership and
   metadata writes can partially commit or produce a concurrent hybrid state.
9. **P2 — feature-flag-capability-cache-not-invalidated.** Generic admin
   toggles update their local table but leave mounted AI/Intelligence route and
   navigation consumers stale.
10. **P2 — bip21-parameters-double-percent-decoded.** Query values decoded by
    `URLSearchParams` are decoded again, rejecting literal percent values or
    changing a nested Payjoin URL.
11. **P2 — bip21-required-extension-ignored.** Unsupported `req-*` parameters
    are silently discarded even though they declare must-understand behavior.
12. **P2 — grafana-created-sentinel-unrecoverable-after-start-failure.** A
    verified migration container left in Docker's `created` state can never
    publish an outcome, but every later supported start refuses to remove it.
13. **P2 — grafana-migration-artifact-ci-ownership-gap.** The packaged migration
    image and critical helper scripts are outside real Docker build and install
    workflow ownership, so an unbuildable release artifact can pass CI.
14. **P2 — group-creation-membership-nonatomic.** Group creation commits metadata
    before validating and inserting requested members, so a failed request can
    leave an orphan or partially configured access group.
15. **P1 — grafana-control-helper-cross-wrapper-race.** Every wrapper invocation
    shares one canonical helper name, and reconciliation may delete another live
    wrapper's created or exited helper before it starts or consumes the result.

## Non-Negotiable Invariants

- A security endpoint never reports successful revocation while an owned
  credential remains valid because storage failed. Only a verified idempotent
  not-found condition may be suppressed.
- Every newly issued refresh session owns the access-token JTI and expiry issued
  with it. Rotation revokes the previous paired access JTI before discarding its
  lineage. Targeted revocation atomically removes refresh capability and records
  the current access-JTI revocation without changing other sessions. Deployment
  invalidates every unlinked legacy session before claiming this invariant.
- Cookie-authenticated browser flows give the HttpOnly refresh cookie precedence
  over a legacy body token. Cookie expiry is derived from the signed refresh
  token, and the OpenAPI contract represents both cookie-only and body-token
  callers without weakening gateway/mobile validation.
- Restore completion makes the committed feature-flag snapshot authoritative in
  every server/worker process before conditional work is considered reconciled.
  A failed runtime refresh is reported as a post-commit operational failure, not
  silently treated as a complete restore.
- Group metadata and complete membership replacement are one serializable
  database intention. One concurrent replacement wins; a failure commits none
  of the metadata or membership changes. Cache invalidation is post-commit and
  covers the exact union of added and removed users.
- A send creation or signing result may commit only to the exact wallet, route,
  output, fee, coin-selection, draft, Payjoin, user, and network generation that
  started it. Reset, edit, route change, clear, and unmount synchronously
  invalidate and abort older work; stale `catch` and `finally` paths cannot
  change current UI.
  Once broadcast begins, editing/navigation cannot move the signed transaction
  into another form generation.
- Mounted feature capability consumers observe successful generic toggles and
  resets immediately. Status stores deduplicate refreshes and generation-fence
  older completions.
- BIP21 query values receive exactly one percent-decoding pass. Malformed escapes
  fail explicitly, ordinary unknown parameters remain ignorable, and every
  unsupported `req-*` parameter rejects the URI before form state changes.
- A canonical Grafana migration container in `created` state is recoverable only
  after exact image, role, project, volume, token, container, and generation
  identity validation proves its entrypoint never started **and** its
  daemon-clock lease expired or the original owner published an atomic scoped
  pre-entrypoint abandonment record. A live non-expired creator remains the
  owner. Running/indeterminate states remain fail-closed; exited states still
  require scoped daemon outcomes.
- Daemon control helpers are invocation-unique and operation-labelled. A wrapper
  inspects, starts, consumes, and removes only the exact container ID it created;
  stale cleanup cannot delete another live invocation's helper or result.
- The Grafana migration Dockerfile and embedded script digest are built by CI as
  a real no-push image whenever any artifact input changes. Script-only lifecycle
  changes own the relevant install unit gates.
- New or edited production functions remain at `CCN <= 15`; production files
  remain within repository size thresholds or are deliberately split.

## Phase 1 — Session Revocation and Browser Contract

- [ ] Add session lineage to newly issued refresh records: persist the paired
  access-token JTI and its expiry when login/refresh creates the session. Generate
  and decode the access token before the refresh-row create/rotation, pass the
  exact JTI/expiry into that repository write, and do not expose either cookie
  unless the paired persistence operation commits. Refresh rotation must replace
  the old row with lineage for the newly issued access token in the same
  consume-and-replace transaction.
- [ ] Make lineage a rollout fence, not a permanently nullable compatibility
  state. In one migration-held table-write fence, add the columns, atomically
  advance `sessionVersion` for every user with a pre-lineage refresh row, delete
  those rows, verify zero nullable rows, and enforce database `NOT NULL` lineage
  constraints before auth writers resume. An old instance paused before insert
  must be rejected by the constraint and must not expose cookies. Make the
  transition idempotent, document the one-time relogin impact, and prove neither
  a legacy access nor refresh credential works afterward.
- [ ] During refresh rotation, insert the consumed row's paired access JTI into
  `RevokedToken` in the same transaction that consumes the old refresh row and
  stores the replacement lineage. A pre-refresh access token must not remain a
  second live credential for the logical session.
- [ ] Replace targeted read-then-delete revocation with one ownership-checked
  transaction. For a linked session, insert the access JTI into the canonical
  revocation store until its original expiry and delete the refresh record in
  the same transaction. A missing/foreign row returns not found, a verified
  Prisma `P2025` remains idempotent where the public contract requires it, and
  every other storage error rejects without an audit-success response. Do not
  advance user-wide `sessionVersion` or affect another session.
- [ ] Make raw refresh-token revocation distinguish verified not-found from
  infrastructure failure. Replace logout's split durable writes with one
  ownership-checked Prisma transaction that records the current access JTI and
  deletes the selected owned refresh row. The no-refresh case revokes only the
  access JTI; verified absence remains idempotent. Failure after either proposed
  write rolls back both so the caller is not stranded with rejected access and
  a reusable refresh credential.
- [ ] Remove negative revocation caching (or replace it with an equivalently
  immediate coherent design). Transaction-backed revocation must publish/evict
  cache state only after commit, and a JTI whose `revoked:false` result was read
  on another process immediately before commit must fail its very next auth
  check. Keep bounded positive caching through the token's natural expiry and
  fail secure when the database is unavailable.
- [ ] Make logout select the refresh cookie before the optional legacy body
  token, matching refresh rotation. Preserve body-only mobile/gateway callers
  and clear browser auth cookies on the defined terminal success/invalid-token
  paths.
- [ ] Derive refresh-cookie `Expires` from the just-issued signed refresh JWT,
  using the same defensive decoded-expiry pattern as the access cookie. Remove
  the independent seven-day constant and cover non-default configured expiry.
- [ ] Correct backend OpenAPI so `/auth/refresh` accepts an optional request body
  whose token property is optional for cookie-authenticated callers. Document
  cookie-first precedence and the body-token alternative; keep the separately
  generated mobile/gateway schema and validation strict where a body credential
  is required.
- [ ] Add repository/service/route tests for generic storage failure, true
  `P2025`, ownership failure, transaction rollback, paired-JTI insertion, and
  two-session isolation. Add an integration regression proving B's access and
  refresh credentials both fail immediately after A revokes B while A remains
  valid. Retain B's pre-refresh access token through one rotation and prove both
  old and current access credentials are rejected at the defined boundary.
  Prime a negative revocation lookup on a second process/cache client before
  targeted revoke and prove the next authentication fails. Cover legacy
  transition and migration idempotency explicitly.
- [ ] Inject failure after each proposed logout durable write and prove the
  transaction leaves either both credentials retryable or both revoked, never a
  committed access revocation with a live refresh row. Assert audit success and
  cookie clearing occur only after the durable security result is known.
- [ ] Add both-source logout, body-only logout, cookie-only refresh, configured
  cookie expiry, and OpenAPI/gateway contract tests. Run auth/session focused
  unit and integration suites, Prisma validation, backend/OpenAPI/gateway tests,
  server and test typechecks, lint, targeted coverage, complexity checks, and an
  adversarial review.

## Phase 2 — Atomic Runtime State Replacement

- [ ] Introduce a durable monotonic feature-state generation that is operational
  metadata rather than backup-restored data. Ordinary set/reset and the main
  restore transaction advance it with their feature-row mutation. Every cache
  snapshot and event carries that generation, and consumers atomically install
  only a newer complete snapshot, including removed/reset keys. Treat Redis
  pub/sub only as a wake-up hint; add bounded periodic generation polling so a
  disconnected process self-heals.
- [ ] Return `{generation, complete flag snapshot}` directly from each mutation
  transaction, or load both in one repeatable-read transaction. Canonically hash
  that exact snapshot and bind events, cache entries, polling results, and
  acknowledgements to both generation and digest; never label rows from one
  generation with another generation number.
- [ ] Add a strict throwing snapshot loader/installer instead of reusing the
  current catch-and-log `refreshCache`. After restore commit, install the local
  snapshot, publish the versioned wake-up, and await bounded acknowledgements.
  Register every live backend and worker with a stable replica ID plus fresh
  heartbeat; each acknowledges generation+digest only after installing the
  snapshot, and workers additionally reconcile schedules first. A missing,
  stale, or mismatched acknowledgement from any live participant returns the
  established `committed: true` post-commit recovery-pending/failure result,
  never success.
  Update restore result/OpenAPI fields so operators can distinguish access-cache
  and feature-runtime reconciliation outcomes.
- [ ] Gate backend/worker readiness on loading the latest durable generation and
  registering a fresh participant heartbeat. Freeze the fresh participant roster
  for each restore acknowledgement barrier; a participant present in that roster
  must acknowledge or the result stays pending, while a newly starting replica
  cannot serve or process jobs until it has independently converged.
- [ ] Make worker handling order explicit: install the restored snapshot before
  reconciling conditional recurring schedules, then add/remove Autopilot and
  Intelligence jobs from that snapshot. If local refresh/event publication or
  schedule reconciliation fails after database commit, return the existing
  post-commit operational-failure contract with recovery guidance; never roll
  back or misreport the already committed database restore.
- [ ] Run access-cache clearing and feature-runtime installation/publication as
  independent post-commit recovery actions and aggregate their outcomes. One
  failure must not skip the other action; retries remain idempotent at the same
  or newer feature generation.
- [ ] Replace separate group metadata and membership writes with one repository
  transaction invoked by `updateAdminGroup`. Lock/serialize on the group using
  the repository's canonical serializable retry/conflict classifier, validate
  requested users inside each fresh attempt, preserve roles of retained members,
  apply metadata plus the exact add/remove diff, and return the committed change
  set. Concurrent complete replacements must produce one whole winner rather
  than a union.
- [ ] Apply the same serializable repository boundary to `createAdminGroup`:
  normalize/deduplicate member IDs, resolve existing users inside the attempt
  using the current documented skip-missing contract, and create metadata plus
  all resolved memberships atomically. A lookup, insertion, or retry-exhaustion
  failure leaves no group row; missing IDs alone keep their existing successful
  skip semantics.
- [ ] Invalidate access caches only after the group transaction commits and for
  the exact union of added/removed users. A failed or exhausted conflict attempt
  must expose the normal conflict/error contract without cache invalidation.
- [ ] Add restore tests across API and worker feature-service instances proving a
  true-to-false and false-to-true snapshot takes effect without restart, removed
  overrides fall back correctly, and conditional schedules converge. Cover
  distributed-cache/event/reconciliation failures after commit.
- [ ] Add barrier tests that interleave set/reset between generation and row
  reads and prove no torn snapshot can publish. Exercise two backend and two
  worker replica identities with one missing, stale, or wrong-digest participant;
  restore remains `committed: true` and reconciliation-pending until every fresh
  required participant converges. Prove polling heals a missed pub/sub wake-up.
- [ ] Add real-database barrier-controlled group replacement tests for two
  clients, insertion/validation failure rollback, metadata-plus-membership
  rollback, retry exhaustion, retained roles, exact cache invalidation, and
  concurrent group deletion. Add create-with-members tests proving invalid users
  lookup and insertion failures leave no group, mixed valid/missing IDs preserve
  the current valid-only result, successful creation returns the exact resolved
  members, and retry behavior does not duplicate membership. Run backup/restore,
  feature-flag, worker scheduling, group/access repository and integration
  suites, server/test typechecks, lint, coverage, complexity, and adversarial
  review.

## Phase 3 — Send Ownership, Capability Stores, and BIP21

- [ ] Give PSBT creation a synchronous generation/abort owner keyed by wallet,
  user, network, route, draft identity, outputs, fee rate, coin selection,
  `sendMax`, RBF, and Payjoin intent. Snapshot the request inputs rather than
  reading mutable render state after awaits. Only the owning generation may
  commit transaction data, PSBT, Payjoin status, errors, or loading cleanup.
- [ ] Thread the owner's `AbortSignal` through transaction creation and Payjoin
  API wrappers into the already signal-capable client. Treat abort as silent
  ownership loss, while genuine current-owner failures retain the existing
  user-facing error contract.
- [ ] Make review reset, every Edit/Back transition, route change, clear, and
  unmount abort/invalidate pending creation before clearing signing state. A new
  review after edits always starts from the new snapshot; stale completions and
  stale `finally` blocks cannot suppress it. Keep signing/broadcast controls
  unavailable unless the transaction data owner equals the current form owner.
- [ ] Carry the same owner through USB/device, QR, uploaded-file, and draft
  signing workflows. Fence every signed PSBT/raw transaction, signed-device,
  persistence, error, and loading commit across awaits. Reset/Edit/route/unmount
  invalidates signing work; disable Back/Edit/Change while signing, and lock
  form navigation once broadcast begins so a signed transaction cannot migrate
  into another generation.
- [ ] Add deferred behavioral tests for Back, each Edit control, reset, route
  change, unmount, reversed old/new completion, rejection, and Payjoin completion.
  Assert no old PSBT/fee/input/output/status reaches signing or broadcast and the
  current request retains its loading/error ownership.
- [ ] Add deferred USB, QR, and file-signing tests covering reset/Edit/route/
  unmount during device work, rejection, stale `finally`, signed-device state,
  and broadcast-start navigation. A stale raw transaction must never become the
  input to a later review or broadcast.
- [ ] Convert `useIntelligenceStatus` to the same observable, immutable,
  generation-fenced, request-deduplicated store contract used for AI status, or
  extract a small shared capability-store primitive without changing public hook
  shapes. Successful generic FeatureFlags toggle/reset must invalidate the exact
  affected mounted capability stores only after the server write succeeds.
- [ ] Test AI Assistant and Treasury Intelligence enable, disable, reset,
  rejected update, reversed status completions, multiple mounted consumers, and
  persistent Layout/AppRouteSwitch behavior. Navigation, shortcuts, and guarded
  routes must change without remount or request storms.
- [ ] Refactor BIP21 parsing to validate percent escape syntax before parsing,
  then consume `URLSearchParams` values directly with no second decode. Reject
  duplicate singleton parameters consistently with the existing strict amount
  contract. Reject every unsupported parameter whose decoded key starts with
  `req-`; continue ignoring ordinary unknown parameters.
- [ ] Add parser-to-form regressions for literal `%`, UTF-8 label/message,
  outer-encoded nested Payjoin URLs that retain `%2F`, malformed escapes,
  duplicate singleton parameters, ordinary unknown keys, unknown `req-*` keys,
  and mixed valid/required inputs. Rejection must leave existing recipient,
  amount, and Payjoin state unchanged.
- [ ] Run focused Send/FeatureFlags/Layout/AI/Intelligence/BIP21 tests, the full
  frontend suite and exact coverage gate, app/test typechecks, app lint,
  complexity/diff checks, and an adversarial review.

## Phase 4 — Grafana Recovery and Artifact CI Ownership

- [ ] Replace the canonical control-helper container with invocation-unique,
  cryptographically random names and labels scoped to project, data/control
  volumes, operation, and token. Inspect/start/read/remove only the exact ID
  returned by create. Reconcile abandoned helpers only after verifying full
  identity and the same daemon-clock expiry/abandonment ownership discipline;
  never consume another invocation's output.
- [ ] Add no-flock barrier regressions with wrapper A paused after helper create
  and after helper exit. Wrapper B must neither delete nor consume A's helper or
  result, and both invocations must reach a deterministic safe outcome without
  leaking unowned helpers.
- [ ] Extend canonical migration reconciliation for an exact `created` sentinel.
  Validate immutable image ID and all project/data-volume/control-volume/token/
  Grafana-container/generation labels plus the password-migration role. Confirm
  Docker state is still `created`; then remove it plus only its scoped unused
  lease artifacts before any Grafana stop or database mutation **only** when a
  daemon-clock lease check proves expiry or the original wrapper wrote an atomic
  fully scoped `abandoned-before-start` record after definitive start failure.
  A non-expired created sentinel without that record remains fail-closed. If
  state becomes running/exited/unknown, re-enter the existing fail-closed or
  outcome-validated path.
- [ ] Derive lease issue/expiry comparisons from a daemon-side control helper,
  not the client clock. On `docker container start` error, repeatedly inspect
  the exact sentinel: publish abandonment only while it remains `created`; if it
  is running, exited, or indeterminate, leave normal daemon reconciliation in
  control. Wrapper death before publication is recovered only after lease expiry.
- [ ] Add a start-failure/client-disconnect regression in which create succeeds,
  start returns nonzero, and the daemon reports `created`; prove the next wrapper
  safely reconciles. Immediately after reclaim of the never-started sentinel,
  assert DB/journal/WAL/SHM/marker byte identity; after the retry succeeds,
  assert the intended password/database/marker result and absence of orphan
  lease/outcome/sentinel artifacts. Also cover the race where start returned an
  error but inspect observes running or exited, preserving the current sentinel/
  outcome rules, and a barrier where wrapper A pauses after create while wrapper
  B must not remove A's non-expired sentinel.
- [ ] Extend Docker image classification with a dedicated Grafana migration
  output driven by its Dockerfile, embedded migration script, monitoring Compose,
  offline image inventory, and shared build inputs. Manual/unknown dispatches
  build all owned images. Add a real no-push Buildx job. Require scope detection
  itself to succeed and every output to be exactly `true` or `false`; make the
  summary fail unless each requested frontend/backend/migration build succeeds
  and each unrequested job is skipped. Missing/malformed outputs or classifier
  failure are hard failures.
- [ ] Add `start.sh`, both Grafana migration helpers, the migration Dockerfile,
  monitoring Compose, and offline inventory/build scripts to install workflow
  path ownership and `classify-install-scope.sh`. Script-only changes must run
  the focused shell/unit/Compose contracts; image inputs must also run the real
  migration build. Define the exact install matrix: `start.sh` owns unit plus
  standard/fresh/container/reuse scopes; migration helpers own unit plus the real
  helper-image build whenever embedded behavior changes; Dockerfile/monitoring
  Compose own Compose-Docker plus the real build; offline scripts retain
  installer/upgrade ownership. Keep PR Docker-backed install policy explicit
  rather than silently substituting fake-Docker tests.
- [ ] Add classifier/workflow composition tests for Dockerfile-only,
  migration-script-only, monitoring-Compose, unrelated frontend/backend, manual,
  and docs-only changes, plus classifier failure and missing/malformed outputs.
  Add one install classifier fixture for every matrix input class and assert the
  corresponding workflow `paths` trigger. Verify the helper image is built from
  the reviewed script digest, is never pushed or pulled under its local tag, and
  is included in offline save/inventory flows.
- [ ] Run shell syntax, Grafana migration/quiescence/Compose/install/offline
  suites, Docker/workflow classifiers and composition tests, render Compose on
  supported profiles without touching the live stack, execute the real local
  migration-image build when safe, and complete an adversarial lifecycle/CI
  review.

## Phase 5 — Integrated Verification and Delivery

- [ ] Run complete frontend, backend, gateway, and LLM egress suites plus exact
  frontend/backend coverage, all typechecks, lint/safety/architecture/OpenAPI,
  test hygiene, shell syntax, diff checks, and changed-production complexity.
- [ ] Re-read every phase diff for root-cause correctness, reuse, simplification,
  rollback, migration compatibility, and unintended scope. Resolve every
  evidence-backed adversarial P0-P2 comment before delivery.
- [ ] Deliver Phases 1-4 as separate PRs in dependency order. For each, push the
  exact reviewed head, require every attached head context terminal success or
  skip, squash-merge, verify reviewed-head/merge tree identity, and require all
  exact target-SHA contexts terminal success or skip before rebasing the next
  phase.
- [ ] Mark this plan complete only after all implementation PRs are merged,
  target-CI verified, and their loop-owned branches/worktrees are cleaned. Under
  the outer loop's `--deploy final` policy, do not rebuild yet; return to a fresh
  whole-repository scrub at the new exact target SHA.

## Rollback

- Phase 1 rollback must preserve session lineage compatibility and may not
  restore success-on-storage-error or access-valid targeted revocation. A schema
  rollback is allowed only after all linked rows are safely handled.
- Phase 2 rollback must keep restore fail-visible after database commit and must
  not restore split group metadata/membership writes. Cache/event consumers may
  be disabled only together with their producers.
- Phase 3 may roll back by subsystem, but must never re-enable signing from
  ownerless PSBT state, non-observable capability invalidation, double decoding,
  or ignored mandatory extensions.
- Phase 4 rollback may retain daemon control/data volumes and exact sentinels,
  but must remain fail-closed for running/indeterminate migrations and keep the
  helper artifact inside real release CI ownership.

**Plan status:** Reviewed. Four complete adversarial passes converged with no
remaining evidence-backed P0-P2 planning gaps.
