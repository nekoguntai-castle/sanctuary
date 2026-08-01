# Bug Scrub Loop Iteration 7 — Boundary Safety Remediation

## Baseline and locked findings

- Baseline: synchronized `main` / `origin/main` at
  `a0c48b7bfc6e13ba601e2a5e84e27b0da3040955` after PR #594.
- Delivery: four bounded PR phases. The target branch is currently red because
  the operations backup drill is not isolated from the shared integration
  database, so phase 1 restores a trustworthy gate before the security and UI
  changes land.
- P1: Payjoin sender validation trusts caller-supplied input indices and compares
  outputs by a non-unique decoded address. Executable proofs show that it accepts
  both a 420,000-sat unchecked sender-input substitution and removal of one of
  two same-script 50,000-sat outputs while preserving the apparent fee.
- P1: changing a device route can retain or later commit the previous route's
  device, sharing data, and mutation handlers, allowing controls displayed on
  route B to mutate device A.
- P1: a successful full restore does not invalidate cached wallet roles, so
  pre-restore authorization decisions can remain active for the cache TTL.
- P1: scheduled PostgreSQL dumps inherit a permissive host umask; observed dumps
  are mode `0664`, exposing descriptors, history, password hashes, and encrypted
  credentials to other local users.
- P2: same-second backup invocations target and truncate the same pathname, so a
  failing run can overwrite or delete another run's valid snapshot.
- P2: the systemd installer writes path arguments into `ExecStart` without unit
  quoting or percent escaping, breaking scheduled backups for valid paths with
  whitespace or systemd specifiers.
- P2: refresh-token rotation reads, deletes, and creates in separate operations,
  while a losing delete is treated as success; concurrent replay of one token can
  mint multiple durable sessions.
- P2: 2FA backup-code verification and persistence are not compare-and-swap;
  concurrent requests can consume the same one-time code and mint multiple
  sessions.
- P2: an older unused email-verification token can survive an email change when
  SMTP is unavailable, then overwrite the current email and mark the stale
  address verified.
- P2 gate defect: the destructive backup/restore integration proof inserts fixed
  SMTP setting keys although shared cleanup preserves system settings. Target CI
  failed all three retries with P2002 on `system_settings.key`; retries migrate
  but do not reset contaminated data.

## Phase 1 — Restore the target-branch integration gate and harden backups

- [ ] Add test-local ownership for the operations proof's fixed SMTP settings:
  remove only those owned keys before and after the drill, and use deterministic
  upserts as an additional crash/retry guard so an interrupted attempt cannot
  poison the next run.
- [ ] Add a regression that executes the backup/restore drill twice against the
  same migrated database and prove no fixed-key collision or cross-test state
  survives.
- [ ] Move the destructive operations proof into a dedicated integration group
  and separate final Vitest process while retaining the same PostgreSQL service.
  Keep the group completeness/no-duplicates contract and schema preparation, and
  run the exact target-CI grouping locally to cover process, environment-stub,
  Prisma-lifecycle, and retry isolation rather than relying on file order.
- [ ] Set a restrictive umask before creating backup directories or files,
  enforce `0700` on output/daily/weekly directories and `0600` on dumps and the
  owner-only lock file, and test the resulting modes under permissive caller
  umasks.
- [ ] Hold a non-blocking `flock` across dump, weekly copy, and rotation. Write to
  a private hidden `mktemp` path, validate it completely, then publish the current
  timestamped filename with an atomic no-clobber operation. Same-second or lock
  contention must fail without touching the existing valid snapshot; cleanup may
  remove only the invoking process's temporary path.
- [ ] Derive the weekly path from the successfully published daily basename,
  preserve `0600` during the copy, retain the existing filename/rotation contract,
  and exclude hidden incomplete files.
- [ ] Quote every generated systemd `ExecStart` argument according to unit-file
  syntax, escape literal `%` specifiers and backslashes/quotes, and reject control
  characters that cannot be represented safely.
- [ ] Extend shell contract tests for `flock` availability/contention, spaces,
  `%`, quotes/backslashes, same-second no-clobber behavior, failed-pipeline
  cleanup, permissions under `umask 000`, dry-run behavior, weekly copies, and
  retention. Run `systemd-analyze verify` when available.
- [ ] Clear the entire access-control cache only after the restore transaction
  commits successfully, through a strict restore-owned path that does not swallow
  cache-layer failures. Add success/failure regressions proving committed
  membership replacement cannot reuse a cached role, rolled-back restores do not
  advertise cache success, and a post-commit cache-clear failure is surfaced
  explicitly rather than returned as an ordinary successful restore.
- [ ] Deliver this phase first and require both PR CI and target-branch CI before
  treating the existing red gate as repaired.

## Phase 2 — Atomic authentication intent consumption

- [x] Replace refresh rotation's read/delete/create sequence with one repository
  transaction. The old unexpired token hash must be conditionally consumed once;
  only the transaction that deletes one row may create and return a replacement,
  and a replacement insert failure must roll the deletion back. Preserve device
  metadata, session-version selection, expiry, logging, and the public
  null-on-invalid contract. Stop translating storage failures from either the
  pre-rotation existence/last-used check or the rotation transaction into
  invalid-token nulls; the API must return an internal failure without clearing
  valid cookies, and mint its access token only after rotation commits.
- [x] Add real-PostgreSQL concurrency coverage that releases two rotations of the
  same token together and proves exactly one replacement exists and succeeds.
  Retain sequential invalid/expired/logout/session tests.
- [x] Add a compare-and-swap repository operation for the string-backed backup-code
  JSON using the exact previously read value plus enabled user state. Perform the
  expensive bcrypt verification before the CAS; a losing concurrent update is an
  invalid/reused code and must not reach `prepareAuthSession` or success auditing.
- [x] Add route-unit and real-PostgreSQL concurrency regressions proving one
  backup code yields exactly one session while TOTP behavior remains unchanged.
- [x] Add one atomic verification-token consumption primitive: conditionally claim
  an unused/unexpired token, then conditionally mark verified only when the user's
  current normalized email still equals the token email. Roll back on mismatch,
  never write `users.email` from token data, and map the stale-intent result to the
  existing invalid-token contract.
- [x] Invalidate prior unused verification intents and update/reset the user's
  email in one transaction before attempting SMTP delivery. Use the same
  token-before-user lock order as verification to avoid inversion, and retain
  truthful `verificationSent` behavior when no replacement mail can be sent.
- [x] Add stale-token, SMTP-disabled, resend, expiry, already-used, and concurrent
  verification regressions, including the old-A/new-B takeover sequence.
- [x] Run auth unit coverage, full test typecheck, security integration tests, and
  repository boundary/complexity gates before delivery.

## Phase 3 — Complete Payjoin sender-side integrity validation

- [ ] Make the validator derive the sender-input set from every original input;
  remove the route's `[0]` assumption and do not allow a caller to weaken the
  invariant. Match all original outpoints exactly once in proposal order and
  require each sender sequence number to remain unchanged.
- [ ] Compare transaction version and locktime and reject mutations before a
  proposal can be returned for signing.
- [ ] Represent outputs by exact script bytes as well as display address. Match
  original outputs one-to-one as an ordered multiset so duplicate scripts cannot
  alias one proposal output and non-address scripts cannot be skipped. Under the
  current fail-closed no-substitution contract, every original output must remain
  and may not decrease.
- [ ] Reject proposal absolute fees below the original, non-finite/negative fee
  calculations, and retain the existing bounded-increase policy until explicit
  additional-fee contribution parameters are implemented.
- [ ] Add failing-first regressions for non-first input replacement, input
  insertion without reordering, sequence/version/locktime mutation, duplicate
  output removal, OP_RETURN/non-address script mutation, lower fee, and ordinary
  valid receiver contribution.
- [ ] Run the focused Payjoin unit/integration suites, Bitcoin boundary tests,
  server typechecks, and exact backend coverage before delivery.

## Phase 4 — Route-owned device detail state and mutations

- [ ] Add a small generation/abort ownership helper and invalidate the previous
  device route synchronously before paint. Reset every device-scoped view, edit,
  sharing, search, modal, and loading state on route/user/network ownership
  changes.
- [ ] Make device, share-info, group, transfer-reload, and user-search reads
  abortable where supported and guard every success, failure, and `finally`
  commit with the owning generation. Give search its own latest-query generation.
- [ ] Snapshot the route/device identity for each mutation. `handleSave` may run
  only when the loaded device matches the current route, must target that route
  ID, and late save/share/group completions may not mutate a newer route's state
  or loading indicators. Apply the same ownership guard to `DeviceAccountsSection`
  and `AddAccountFlow` refresh callbacks so delayed account-add USB/manual/import
  flows cannot call `setDevice` for a previous route after navigation.
- [ ] Add a defensive component render invariant so stale `device.id !== routeId`
  data never reaches edit/delete/transfer controls even between render and effect
  cleanup.
- [ ] Add deferred rerender tests for A-to-B success/failure/reordering, network
  changes, share-info/search races, late saves and sharing mutations, delayed
  add-account refresh callbacks, captured old handlers, unmount abortion, and the
  component render guard. Extend API tests to prove abort signals are forwarded.
- [ ] Run focused frontend tests, both frontend typechecks, lint, changed-file
  complexity/large-file gates, and full frontend coverage before delivery.

## Final verification and loop continuation

- [ ] Re-read every phase diff for root-cause coverage, simplification, reuse, and
  unintended scope growth; require independent implementation review with no
  confirmed P0-P2 findings.
- [ ] For each phase, commit and push a dedicated branch, open/update its PR,
  require all terminal PR checks, merge the exact reviewed head, verify merge
  ancestry/tree identity, then require target-branch CI before continuing.
- [ ] After all phases merge, synchronize local `main`, confirm no Sanctuary app
  or test containers were left running, and run another fresh eight-domain scrub.
- [ ] Terminate only when that complete pass has zero confirmed P0, P1, or P2
  findings; otherwise create the next recursively reviewed iteration.

## Plan review lock

- Reviewed in three passes against current source before implementation.
- Accepted improvements: strict/failure-signaling restore cache invalidation,
  delayed device account-add refresh ownership, and refresh-token storage-error
  handling before rotation.
- Rejected/deferred comments: splitting phase 1 further is unnecessary because
  the CI gate, restore cache, backup script, and systemd installer share the same
  operations boundary; adding abort support to mutation API helpers is unnecessary
  when mutations are guarded by route ownership and are not transport-retried.
- Verification: source reads for the listed phase owners and `git diff --check`
  on this plan file.

## Rollback

- Phase 1 shell/test changes can be reverted without changing backup formats;
  published filenames remain matched by the existing retention glob.
- Phase 2 adds no schema migration. Reverting it restores prior authentication
  behavior but reopens replay races, so emergency rollback should disable refresh
  and backup-code login paths until a corrected build is deployed.
- Phase 3 is sender-side validation only; rollback reopens malicious-proposal
  acceptance and should instead disable `payjoinSupport`.
- Phase 4 is client/API request ownership only and can be reverted independently.
