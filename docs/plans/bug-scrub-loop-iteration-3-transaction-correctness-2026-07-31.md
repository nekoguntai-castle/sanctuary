# Bug Scrub Loop Iteration 3 — Transaction Correctness

Date: 2026-07-31
Target branch: `main`
Locked baseline: `10669f958bede897b953187e45712fce2e046221`
Delivery: one full-stack pull request

## Scope

Remediate the four P2 findings accepted by the complete iteration-2 rescrub:

- `transaction-detail-zero-values-serialize-as-null`
- `transaction-label-save-overwrites-newer-selection`
- `fallback-transaction-input-lookup-crosses-wallet-scope`
- `transaction-label-mutation-failures-are-silent`

Keep public success response shapes and persistence schemas unchanged.

## Phase 1 — Lock regression behavior before production changes

- [x] Add canonical and legacy transaction-detail route tests proving `0n` for
      `fee`, `balanceAfter`, and `blockHeight` serializes as numeric zero while
      genuine nulls remain null.
- [x] Add a duplicate-outpoint persistence regression proving the fallback UTXO
      query selects only the supplied wallet and persists that wallet's address,
      amount, and derivation path.
- [x] Add deferred frontend tests for save-on-A → select-B → resolve-A and
      AI-label-create-on-A → select-B → resolve-A. Prove stale completions cannot
      mutate B's selected transaction, editor labels, error, or saving state.
- [x] Add save-on-A → refresh selected A with newer fields → resolve-save coverage.
      Prove the completion patches only labels and preserves the refreshed memo,
      confirmations, detail fields, and any other newer summary state.
- [x] Add deferred same-A save/AI-create overlap tests in both completion orders.
      Prove neither operation leaves a stuck spinner, loses selected label IDs, or
      clears/replaces error state owned by the other operation. Assert displayed
      transaction labels equal the exact label-ID snapshot sent by the successful
      save, not labels accumulated locally after that request began.
- [x] Extend mutation-failure tests to require accessible user-visible feedback
      for save and AI-created-label failures, and prove a new edit or retry clears
      stale feedback.

## Phase 2 — Correct numeric and wallet boundaries

- [x] Replace truthiness-based nullable bigint serialization with explicit
      null/undefined handling so valid zero values survive both detail routes.
- [x] Add `walletId` to the fallback UTXO predicate while retaining the batched
      `(txid, vout)` match and wallet-scoped address lookup.
- [x] Audit adjacent nullable numeric serializers and fallback outpoint queries
      for the same patterns; fix only reachable equivalents backed by tests.

## Phase 3 — Make label mutations selection-owned and observable

- [x] Tie label mutations to a common selection generation and give save and
      AI-label creation separate monotonically increasing operation owners.
      Snapshot the target before each await and let only the still-current
      selection and operation owner commit or clear that operation's local state.
- [x] Merge successful saved labels into the current selected transaction through
      a current-state/selection-ref updater that patches only `labels`; never
      spread a pre-await transaction snapshot back over newer same-selection data.
- [x] Ensure stale completions cannot close a newer editor, overwrite its selected
      transaction or labels, clear its in-flight flag, or display an error against
      the wrong transaction. Successful stale server mutations may still trigger
      the existing list-cache refresh.
- [x] Selection change and cancel invalidate both operation owners and
      synchronously reset label busy/error state; unmount only invalidates owners.
      Overlapping operations may update only the fields they own, and an older
      completion cannot clear or replace a newer operation's state.
- [x] Define overlap semantics from persisted truth: an AI-create that completes
      before save may join the editor selection; a successful save closes that
      editor generation, invalidates any still-pending AI local commit, and patches
      displayed transaction labels strictly from the IDs captured and sent by
      that save. A stale successful create may still refresh the list cache.
- [x] Expose one inline, accessible label-mutation error in the editor. Clear it
      when editing begins, a retry starts, the selection changes, or editing is
      cancelled; preserve retryability after failures.
- [x] Keep the shared phone-modal and tablet-pane rendering contract aligned and
      avoid introducing a second notification mechanism.

## Verification

- [x] Run the focused frontend hook/component and backend route/persistence suites.
- [x] Run frontend and backend production/test typechecks.
- [x] Run full frontend and backend coverage and retain configured thresholds.
- [x] Run lint, architecture, Prisma-boundary, OpenAPI, safety, blocking-I/O,
      complexity, and diff checks applicable to changed paths.
- [x] Re-read the diff for null/empty/boundary behavior, async races, error
      propagation, reuse, complexity, and unintended scope.
- [x] Obtain independent adversarial review with no unresolved P0-P2 findings.
- [ ] Rebase onto current `origin/main`, rerun focused checks, deliver through a
      green PR, verify squash-tree identity/base ancestry and target-branch CI.
- [ ] Run a fresh complete eight-domain scrub at the verified merge SHA.

## Acceptance

- Valid zero transaction values remain numeric zero and genuine missing values
  remain null on canonical and legacy detail APIs.
- Fallback input persistence never reads UTXO metadata from another wallet.
- Label mutation completions can affect local state only for their originating
  selection and operation generation.
- Every current-selection label mutation failure is visible and retryable.
- The final full-domain rescrub reports zero P0, P1, or P2 findings.

## Rollback

No schema migration or public success-shape change is introduced. The PR can be
reverted atomically; the only new UI contract is additive inline error feedback.
