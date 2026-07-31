# Bug Scrub Loop Iteration 6 — Correctness Remediation

## Baseline and locked findings

- Baseline: synchronized `main` / `origin/main` at
  `943b8b14d479f73e2d48bbc03c853061e88f1bb7`.
- Delivery: one bounded PR because the transaction findings share the same
  classification/reconciliation contract and all five fixes must land before
  another complete scrub.
- P1: historical incomplete `received` rows can be marked classification-complete
  without repairing their stale wallet-wide amount.
- P1: mixed-owner transactions, including Payjoin, derive wallet amounts from all
  participants' inputs/outputs instead of the wallet's own value delta.
- P2: logout authenticates from the access cookie after a malformed bearer header
  but can skip revoking that cookie token.
- P2: transaction export snapshots only IDs, so later deletes/updates can produce
  a silently incomplete or temporally inconsistent HTTP 200 export.
- P2: wallet spends with only addressless outputs can fail scalar classification
  and omit their fee/value debit from history and running balances.
- P1 (independent implementation review): a current-version classification made
  before gap-limit expansion can remain permanently fenced after newly generated
  wallet addresses provide stronger ownership evidence.
- P1/P2 (final implementation review): stale address-set I/O writes and
  classification candidates can downgrade newer ownership evidence; I/O can be
  finalized with unresolved input values.
- P1 (final implementation review): pre-queue 1.1 backups must remain restorable
  after the complete table manifest grows.
- P2 (final implementation review): a committed classification followed by a
  failed balance pass must converge on an otherwise-unchanged retry.

## Phase 1 — Authoritative complete transaction classification

- [x] Add failing regressions in both the batch and single-address classifiers for:
  - mixed wallet/external inputs where the wallet delta is negative;
  - mixed wallet/external inputs where the wallet delta is positive;
  - addressless-output-only wallet spends;
  - ordinary sent, received, and consolidation behavior.
- [x] Track wallet-owned input value separately from total input value and track
  the presence/value of addressless outputs separately from addressed external
  and wallet output value.
- [x] Redefine `classificationInputsComplete` to require both ownership/address
  and value evidence for every non-coinbase input. Resolve inline address and
  value independently so an inline address with missing value can still obtain
  value from the referenced cached/fetched output. `classificationVersion = 2`
  identifies the algorithm only and does not imply complete evidence.
- [x] When complete values are available, derive the persisted amount from
  `wallet outputs - wallet inputs`; use output ownership only to distinguish sent
  from consolidation for negative deltas, and classify positive deltas as
  received even when the transaction has wallet-owned inputs.
- [x] Define zero wallet delta consistently: if any addressed non-wallet or
  addressless output exists, classify it as `sent` with amount zero; otherwise
  wallet-input participation is `consolidation` with amount zero. Add wallet-only
  and mixed-owner zero-delta regressions in both classifiers.
- [x] Derive the whole on-chain transaction fee from all input value minus all
  output value only when every input value is complete. Persist that fee as
  metadata for `sent` and `consolidation`, keep received fee null/absent, and
  never use it to adjust the already-net wallet amount. Assert sender-Payjoin,
  receiver-Payjoin, and ordinary receive amount/fee behavior in both classifiers.
- [x] Specify the incomplete-evidence fallback for newly discovered rows:
  output-only evidence may create `received` with wallet-output amount; known
  wallet-input ownership with external/addressless evidence may create `sent`
  using only addressed external value; otherwise known wallet-input ownership may
  create `consolidation` amount zero. Its fee is null, version is 2, completeness
  is false, and it remains in rotation. An incomplete candidate never updates an
  existing row of any version/type; a stale version-1 row is upgraded only from
  complete evidence.
- [x] Never add addressless output face value separately to the wallet amount:
  authoritative amount remains `wallet outputs - wallet inputs`. Treat the
  presence of any non-wallet/addressless output only as external evidence when
  choosing `sent` versus `consolidation` for a non-positive wallet delta. Add
  mixed-owner regressions where an external participant funds some or all
  addressless value. Cover both zero-value OP_RETURN and valued addressless
  outputs; each must be `sent` with the exact wallet delta/fee rather than
  consolidation.
- [x] Make a complete classification authoritative for an existing
  stale-version or `classificationInputsComplete = false` row, including
  same-type scalar repair and safe type correction.
- [x] Add a durable `classificationVersion` integer with an additive migration
  defaulting historical rows to version 1; define the corrected algorithm as
  version 2 and write that version for new classifications. Select rows whose
  version is stale or whose input evidence is incomplete, so already-complete
  and newly inserted rows produced by the flawed version are repaired too.
- [x] Persist the wallet-address-set count used by each classification and a
  durable txid repair target carrying the required address-count watermark.
  When gap-limit scanning observes history on newly generated addresses, upsert
  only those txids even when their transaction row does not exist yet; select
  rows when version is stale, evidence is incomplete, or a target exists.
  Under the target and transaction row locks, never accept an address-count
  downgrade or consume the target until a complete candidate meets its watermark.
  Target persistence failure must fail the sync rather than be swallowed with
  best-effort address-scan errors; cover absent rows, concurrent insertion,
  crash/retry, and older/newer candidate races.
- [x] Route primary batch candidates through the same ownership-target and
  transaction-row locking decision as single-address candidates; never bulk
  insert an absent row below a durable target. Cover absent-row batch insertion
  below/at the target and concurrent target/insertion behavior.
- [x] Acquire a canonical wallet/txid advisory lock before target upsert or
  absent-row reconciliation, and acquire multi-candidate keys plus parent rows
  in sorted order. Cover a target insert paused against a competing batch and
  reversed concurrent batches without deadlock.
- [x] Include every transaction type, including historical `sent`, in the bounded
  oldest-attempt-first repair rotation. Update both the TypeScript selection
  predicate and `markClassificationRepairAttempts` SQL to use the identical
  stale-version/incomplete/ownership-target predicate. Add fairness/cursor tests
  showing incomplete sent and targeted ownership rows rotate while untargeted
  current-version complete rows stop.
- [x] Add ownership-known/value-missing, value-known/ownership-missing, missing
  external-input value, and inline-address/missing-value fallback regressions in
  both classifiers. Prove incomplete rows remain in rotation and cannot overwrite
  version-1 or version-2 authoritative scalar data.
- [x] In single-address prefetch, request the referenced transaction whenever
  either inline address or inline value evidence is missing. Prove an inline
  address with missing value fetches the referenced output and completes both
  classification and I/O repair.
- [x] Acquire the parent transaction row lock, reread committed
  version/evidence/address-count/target state, and apply authoritative
  scalar/type/version/completeness changes plus existing output-role rewrites in
  one interactive transaction. A current-version completed row wins only when it
  has no unmet ownership target and its address count is at least the candidate's.
  Add marker-set versus older/newer candidate and larger-versus-smaller
  address-count concurrency coverage.
- [x] Return `repaired` whenever authoritative scalar/type/version/completeness
  data changes, so running balances are recalculated. Add PostgreSQL concurrency
  coverage against `persistAddressSyncIORows` and failure injection proving an
  output-role rewrite failure rolls back the parent correction.
- [x] Atomically set `ioComplete = false` with every accepted scalar repair so a
  failed follow-up cannot lose durable I/O repair intent. The locked I/O boundary
  must update existing output ownership and role fields instead of relying only
  on duplicate-skipping inserts, then mark completion. Add failure/retry and
  two-pass gap-expansion regressions proving amount, type, `balanceAfter`,
  `isOurs`, and output roles converge.
- [x] Fence I/O persistence with the address-count watermark used to derive its
  ownership flags. Under the parent lock, skip stale input/output/completion
  writes below the committed classification watermark; update existing input
  amounts as well as output ownership. Require both address and value evidence
  before marking non-coinbase input I/O complete, resolving each independently
  from inline and referenced outputs. Add PostgreSQL stale-write fencing and
  unresolved-value retry regressions.
- [x] Recalculate running balances on every successful batch and single-address
  sync, including unchanged retries, so a prior post-commit balance failure
  cannot strand partial or stale `balanceAfter` values. Cover failure followed by
  an unchanged retry in both paths.
- [x] Serialize each wallet's complete balance read/write pass with a
  transaction-scoped PostgreSQL advisory lock and one database transaction.
  Cover two interleaved recalculations where a stale reader pauses across an
  authoritative repair and prove the repaired balances win.
- [x] Keep the serialized retry cheap and timestamp-stable by selecting existing
  `balanceAfter` and updating only the changed suffix. Assert an unchanged
  wallet performs zero transaction updates and a stale suffix updates exactly
  the affected rows.
- [x] Order balance rows by `blockTime`, `createdAt`, then `id` so bulk-created
  timestamp ties cannot reshuffle running balances across retries. Cover equal
  block/creation timestamps with deterministic per-transaction balances.
- [x] Add unit and real-PostgreSQL regressions for historical multi-output receive
  amount repair, sent-to-received Payjoin correction, concurrency fencing, output
  roles, and balance convergence.

## Phase 2 — Authentication source parity

- [x] Add a failing logout regression with a valid access cookie and malformed or
  empty bearer header.
- [x] Reuse the shared `extractAccessToken(req)` helper in logout so authentication
  and revocation select the identical token source.
- [x] Preserve valid bearer precedence, cookie fallback, refresh-token revocation,
  cookie clearing, and audit behavior.

## Phase 3 — Immutable transaction exports

- [x] Replace the ID-only snapshot contract with a normalized export-row snapshot
  captured entirely inside the existing repeatable-read transaction.
- [x] Page full export rows in deterministic `blockTime, id` order, normalize them
  to the JSON/CSV export shape during capture, and spill newline-delimited JSON to
  the existing owner-only temporary-file mechanism using a serialized-byte
  threshold. Spill before retaining a row that would cross the bound, keeping at
  most one bounded query page plus the bounded snapshot buffer in memory.
- [x] Parse spilled NDJSON with the repository's safe boundary conventions and
  fail closed on malformed or truncated rows. Cover a single row larger than the
  threshold, multi-page large memo/label payloads, exact round trips, and
  cancellation during spill.
- [x] Stream JSON and CSV exclusively from the sealed snapshot; perform no
  post-capture transaction row lookup.
- [x] Preserve bounded memory, bounded DB connection ownership, capture timeout,
  request-abort propagation, response backpressure, process permit ownership,
  spill-reader cleanup, orphan cleanup, and CSV formula neutralization.
- [x] Add pre-header database/serialization/file-write failure tests proving the
  repeatable-read transaction rolls back, partial spill files are closed/unlinked,
  the concurrency permit remains owned until uncancellable work settles, and the
  route returns an error rather than a partial HTTP 200.
- [x] Replace the regression that accepts deleted/updated captured rows with
  assertions that concurrent insert/delete/update cannot alter membership,
  ordering, or values. Update the real pool-pressure proof for the row snapshot.

## Verification and delivery

- [x] Run focused auth, classification, reconciliation, balance, export, worker,
  and API suites with null/empty/error/concurrency boundaries.
- [x] Run the real PostgreSQL reconciliation/export integration suites.
- [x] Run Prisma validation/generation, production and test TypeScript checks,
  lint/safety/architecture/complexity/large-file gates, and `git diff --check`.
- [x] Run full frontend, backend, and gateway coverage at exact 100%.
- [ ] Perform independent implementation review, commit, push, open/update the PR,
  require all PR checks, merge the exact reviewed tree, and require target CI.
- [ ] Run another fresh complete eight-domain scrub from synchronized merged
  `main`; continue the loop if any P0-P2 finding remains.

## Phase 4 — Backup manifest compatibility

- [x] Recognize the immutable pre-queue complete-v1 policy hash and derive its
  required/restored durable table set without `transactionOwnershipRepair`.
  Keep newly created backups on the current hash, reject every other unknown
  hash, and restore old 1.1 data with an empty repair queue.
- [x] Add validation/restore-table tests for pre-queue 1.1 backups and seed the
  new durable queue in the non-production backup/restore round-trip proof.
- [x] Foreign-key ownership-repair rows to wallets with `ON DELETE CASCADE` and
  cover wallet deletion so orphan repair intent cannot leak into later backups.

## Rollback

- Revert the iteration-6 application squash commit while leaving the additive
  `classificationVersion`, `classificationAddressCount`, and
  `transaction_ownership_repairs` table in place; column defaults allow old
  application writers (`1` and `0`), while the old application ignores the queue.
  Do not drop them during emergency rollback. Reapplying the corrected version
  resumes the bounded repair backlog.
