# Bug Scrub Loop Iteration 4 — Sync, Export, and UI Race Correctness

Date: 2026-07-31
Target branch: `main`
Locked baseline: `9e1e586da75770e84e8b4c1e0c9c28e76e935c32`
Delivery: one full-stack pull request

## Scope

Remediate the four blockers accepted by the complete iteration-3 rescrub:

- `address-sync-self-change-partial-duplicate` (P1)
- `transaction-export-zero-values-serialize-as-null` (P2)
- `address-label-save-overwrites-newer-editor` (P2)
- `utxo-freeze-toggle-race-diverges-server-and-ui` (P2)

Keep persistence schemas and successful API response shapes unchanged.

## Phase 1 — Lock regression behavior before production changes

- [x] Add address-sync coverage for a wallet spend with an external output and
      change to the synced wallet address. Prove exactly one `sent`
      classification is produced and no `received` insert is attempted.
- [x] Add a real-PostgreSQL integration proof for the
      `(txid, walletId)` uniqueness boundary: repair a previously committed
      wrong-type `received` row to the correct `sent` values, and run concurrent
      sync persistence for the same wallet transaction without a uniqueness
      error, duplicate, or partial row. Keep fast mock-backed unit tests for the
      classification branches.
- [x] Add a non-regression case proving an existing correctly classified,
      confirmed `sent` row with a populated fee is a no-op when a later address
      fetch has no usable ownership-bearing prevout data and therefore produces
      a weaker `received` candidate. Add opposite-order concurrent complete and
      incomplete reconciles proving the final classification is deterministic.
- [x] Prove scalar repair and transaction I/O recovery independently: a repaired
      row receives inputs and outputs; a prior swallowed I/O failure retries on
      the next otherwise-unchanged sync; and a row with only inputs or only
      outputs is completed without duplicates. Deterministically hold the
      transaction-row lock through a concurrent promotion and prove deferred
      output insertion classifies from the committed stronger type.
- [x] Add JSON and CSV export endpoint regressions proving zero
      `balanceAfter`, `fee`, and `blockHeight` values remain numeric zero while
      genuine nulls remain null or blank.
- [x] Add deferred address-label tests for Save A → Edit B/Cancel A → settle A.
      Prove stale success may update only address A's persisted labels and stale
      failure cannot close B, clear B's busy state, or report against B.
- [x] Extend the address-label race through Save A → Edit B → Save B → settle A
      in both A success and failure orders, then settle B. Add wallet-change and
      unmount cases proving old-wallet completions perform no current-scope UI
      work.
- [x] Add same-tick same-UTXO freeze tests with no intervening rerender, proving
      the second toggle is rejected synchronously, only one server mutation is
      sent, and independent UTXOs can still mutate concurrently. Add wallet-A
      pending → wallet-B loaded → A rejects coverage proving B is untouched and
      a newer guard cannot be released by an old completion.

## Phase 2 — Make address history classification singular and idempotent

- [x] Classify each history transaction once: wallet-owned inputs take
      precedence and yield `sent` or `consolidation`; only transactions without
      wallet-owned inputs may yield `received`.
- [x] Replace check-then-create with one repository-owned, compound-key,
      conflict-safe reconcile operation. Atomically attempt the insert with
      duplicate skipping, then conditionally promote only to a
      stronger-evidence classification: `received → consolidation` requires
      positively identified wallet-owned inputs, and `received|consolidation →
      sent` additionally requires a positively identified external output.
      Missing ownership/output evidence may never downgrade `sent` or
      `consolidation`. Same-type candidates are strict no-ops so incomplete or
      stale later fetches cannot downgrade good fee, confirmation, or block
      data. Make the conditional update concurrency-safe so complete/incomplete
      candidates converge to the same strongest classification regardless of
      arrival order, while unrelated database failures still propagate.
- [x] Return an explicit `created`, `repaired`, or `unchanged` outcome. Count
      created and repaired rows as changed work for the existing sync result;
      unchanged rows remain skipped from that count.
- [x] Decouple transaction-I/O recovery from scalar reconcile outcomes. On every
      address sync, query history rows missing either inputs or outputs (not only
      rows missing both), and run the existing duplicate-safe backfill so an
      earlier partial or swallowed I/O failure remains retryable. Lock the
      scalar transaction rows before I/O insertion and derive output roles from
      their current committed types so promotion and deferred insertion serialize.
- [x] Keep the in-memory txid lookup only as an optimization for duplicate
      history work after a successful reconcile; do not treat it as a
      concurrency boundary.
- [x] Preserve current amount, fee, block, confirmation, missing-input, and
      missing-transaction behavior for the selected classification, plus
      existing labels, memo, and other fields not owned by address sync.

## Phase 3 — Preserve zero values in exports

- [x] Replace truthiness checks in the export mapper with explicit
      null/undefined checks for nullable balance, fee, and block-height numeric
      fields. Require literal `0` in each CSV zero column and blank fields only
      for genuine nulls.
- [x] Audit adjacent export fields and serializers for the same reachable
      zero/null conflation; change only test-backed equivalents.

## Phase 4 — Own frontend mutations by their active target

- [x] Give address-label saves a monotonically increasing editor generation and
      operation owner. Snapshot address ID and requested label IDs before the
      await; successful persistence may patch only that address.
- [x] Let only the still-current editor/operation close the editor, clear its
      spinner, or mutate editor-local state. Same-wallet stale success may patch
      only captured address A; same-wallet stale failure must raise a global
      notification explicitly naming captured A while leaving editor B intact.
      Wallet change and unmount suppress all completion UI work.
- [x] Edit, cancel, and wallet change invalidate editor owners and synchronously
      reset editor-local busy state. Preserve every refreshed address field by
      patching labels only.
- [x] Use an authoritative synchronous `useRef<Map<utxoId, operationToken>>`
      admission guard plus mirrored pending-ID state for rendering. Capture the
      database UTXO ID, wallet generation, and operation token before the
      optimistic update; match optimistic updates and rollback by captured ID.
- [x] Ignore subsequent same-ID toggles until the accepted request settles.
      Wallet change and unmount invalidate completion UI work and clear current
      guards. Rollback, error reporting, and pending release require the exact
      current wallet generation and operation token, so an old completion cannot
      touch a new wallet or release a newer operation.
- [x] Expose pending database UTXO IDs through the complete
      hook → controller → tab → list → row → button path. Disable the matching
      button, set `aria-busy`, and provide a pending accessible name while
      preserving independent UTXO actions.

## Verification

- [x] Run focused address-sync, transaction-export, address-label, UTXO-action,
      controller, and row/button suites.
- [x] Run frontend and backend production/test typechecks.
- [x] Run full frontend and backend coverage and retain configured thresholds.
- [x] Run lint, architecture, Prisma-boundary, OpenAPI, safety, blocking-I/O,
      complexity, large-file, and diff checks applicable to changed paths.
- [x] Re-read the diff for uniqueness, partial writes, null/zero boundaries,
      stale completions, rollback ownership, reuse, and unintended scope.
- [x] Obtain independent adversarial review with no unresolved P0-P2 findings.
- [ ] Rebase onto current `origin/main`, rerun focused checks, deliver through a
      green PR, verify squash-tree identity/base ancestry and target-branch CI.
- [ ] Run a fresh complete eight-domain scrub at the verified merge SHA.

## Acceptance

- Address sync creates at most one correctly classified row per wallet
  transaction, repairs a prior wrong classification, and is conflict-safe under
  concurrent sync requests.
- Exported numeric zero values remain zero; only missing values are null/blank.
- Address-label completions can affect editor state only for their originating
  editor generation.
- A UTXO cannot receive overlapping freeze requests, old-wallet completions
  cannot touch the current wallet, and its button communicates the pending state
  accessibly.
- The next full-domain rescrub reports zero P0, P1, or P2 findings.

## Rollback

No schema migration or public success-shape change is introduced. Code can be
reverted atomically, and repaired rows remain forward-compatible after a code
revert. Persisted repairs are intentionally not reversed automatically; restoring
their prior corrupted values would require a database backup or explicit manual
remediation. The only UI contract change is additive pending state for the
existing freeze action.
