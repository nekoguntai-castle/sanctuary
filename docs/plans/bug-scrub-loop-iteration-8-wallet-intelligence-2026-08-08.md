# Bug Scrub Loop Iteration 8: Wallet and Intelligence Ownership

## Objective

Resolve every P0-P2 finding accepted by the complete fresh scrub at
`e31e63d93e96245d2ca0ab7680956301f72f8620`, preserve existing contracts where
safe, and deliver the reviewed implementation as phase-coherent PRs before the
next whole-repository rescrub.

## Locked findings

- P1 `wallet-detail-modal-route-cross-contamination`: modal intent opened for
  wallet A survives a route-only transition and rebinds destructive or
  wallet-specific controls to wallet B.
- P1 `wallet-detail-subhook-async-route-cross-contamination`: sharing,
  transfer-refresh, search, and optimistic mutation completions captured on A
  can commit into B through raw parent setters.
- P1 `intelligence-chat-selection-response-cross-contamination`: message loads
  and sends are component-lifetime-owned, allowing old conversation responses
  to replace or append into the current conversation.
- P2 `intelligence-insight-filter-response-cross-contamination`: old
  wallet/filter insight responses and finalizers can overwrite the current
  result or loading state.
- P2 `intelligence-settings-wallet-response-cross-contamination`: settings
  reads, optimistic writes, reverts, and finalizers can cross wallet changes.
- P1 `grafana-config-leaks-encryption-master-key-without-reauth`: the normal
  admin Grafana GET returns `ENCRYPTION_KEY` when `GRAFANA_PASSWORD` is absent,
  bypassing the repository's reauthentication and audit boundary for key
  disclosure.
- P1 `intelligence-chat-history-selects-oldest-window`: the service requests
  the “last 20” messages from a repository query ordered ascending with
  `take: 20`, selecting the oldest context forever.
- P2 `intelligence-chat-oversize-message-persisted-before-proxy-validation`:
  the backend accepts and stores messages longer than the egress proxy's
  8,000-character per-message contract.

## Constraints and ownership model

- Keep all writes in the loop-owned worktree and iteration-8 branch.
- Use the shared request-ownership helper introduced by the Device Detail fix;
  do not create a second generation/abort abstraction.
- Route or wallet selection changes synchronously invalidate owned UI state.
- Every async success, error/revert, and finally write must prove current
  ownership; loading flags must not be cleared by an older operation.
- Mutations snapshot their resource identity. They may complete remotely for
  the captured resource, but their result must not mutate the new resource's
  view.
- Keep edited production functions at CCN <= 15 and avoid files over 500 lines
  growing further without extracting focused helpers.
- Tests must reproduce reversed completions and route/selection changes, not
  only assert implementation details.

## Phase 1: Wallet Detail route ownership

- [x] Introduce one Wallet Detail ownership key covering route ID and any user
  or network identity that changes wallet projection ownership.
- [x] Require `wallet.id === route id` before rendering the loaded view or any
  wallet-bound control. Test the immediate A-to-B render before layout cleanup
  or B fetch completion and assert no A content is paired with B handlers.
- [x] Make modal state wallet-owned. On ownership change synchronously dismiss
  export, transaction export, receive, QR, transfer, and delete intent; require
  the captured wallet ID to still be current before destructive confirmation or
  wallet-specific completion callbacks can affect the view.
- [x] Fence `useWalletSharing` reads, searches, share/group operations,
  device-share prompts, transfer refreshes, errors, and loading finalizers with
  current route ownership. Give user search an independent latest-query
  generation.
- [x] Fence `useWalletMutations` optimistic success/revert and error reporting
  by captured wallet identity so a failed A update cannot restore A over B.
  Reset `isEditingName` and its draft on ownership change so an editor opened
  for A cannot remain active with A's text and rename B.
- [x] Extend the same ownership contract to `useWalletSync` and
  `useWalletWebSocket`: reset sync/repair state on route changes, fence every
  awaited success/error/finally write and refresh callback, and reject events
  whose event `walletId` is not current.
- [x] Prefer guarded setters/callbacks over exporting raw parent setters into
  route-owned subhooks. Preserve `useWalletData`'s existing owned base-fetch
  semantics.
- [x] Add regressions for A-to-B route rerender with an open delete modal,
  deferred share/search/transfer refreshes, rejected optimistic mutation,
  deferred sync/repair, and a stale A WebSocket event after B is current.
  Assert B never displays or commits A state and an A-owned modal cannot invoke
  `deleteWallet(B)`.

## Phase 2: Intelligence UI ownership

- [x] Key/reset the Intelligence tab content by selected wallet so conversation
  selection, pending input, filters, settings, and local mutation state do not
  silently migrate from wallet A to wallet B.
- [x] Derive the effective selected wallet synchronously from the current
  network-filtered wallet set, or withhold the tab panel when the stored
  selection is absent. Add an immediate network A-to-B rerender regression that
  asserts no A tab content renders before selection-repair effects run.
- [x] Give conversation message loads a latest-selection generation. Only the
  current conversation may replace messages or clear its loading state.
  Synchronously clear or owner-tag rendered history, optimistic messages,
  conversation draft, and send/loading state when selection changes so B never
  renders A content or inherits A's busy state before B's load resolves.
- [x] Snapshot conversation and wallet identity for sends. An A completion may
  update A remotely but must not append, remove optimistic messages, restore
  input, or clear B/current send state.
- [x] Reset or fence conversation-list/create/delete completions where wallet
  changes or later operations would otherwise adopt stale state. Make the
  conversation list wallet-scoped at the repository/API boundary (not by
  client-filtering one paginated user-wide page), while defining explicit
  treatment for legacy conversations whose `walletId` is null: they remain
  explicitly unscoped and accessible without silently adopting the selected
  wallet, and sends omit wallet context until a future explicit binding action.
  A conversation
  bound to wallet A must not accept wallet B context. Validate wallet access
  when creating or using a wallet-bound conversation, scope list queries by
  both user and wallet, and derive the active wallet binding from the stored
  conversation rather than trusting a caller-supplied replacement ID.
- [x] Give Insights reads a wallet-plus-filter generation and fence success,
  catch, and finally. Fence status-update removal by the owning wallet/filter
  view where needed.
- [x] Give Settings reads and writes wallet ownership plus latest-mutation
  ownership. A response or failed optimistic write must not replace B settings
  or clear B saving/loading state. Serialize or coalesce same-wallet writes so
  reverse server completion cannot persist an older intent after a newer one.
- [x] Add deferred reverse-completion regressions for conversation A/B loads,
  send A then select B, wallet A-to-B tab changes, insight filter A-to-B, and
  settings load/update A-to-B. Assert latest ownership wins and loading state is
  not cleared early. Add repository/API coverage that A excludes B-bound
  conversations, legacy null conversations remain explicitly unscoped, and
  null-conversation sends cannot inherit A/B wallet context. Add a reversed
  same-wallet/same-field Settings write proof whose displayed and reloaded value
  both match the latest user intent.

## Phase 3: Monitoring and chat backend contracts

- [x] Remove `ENCRYPTION_KEY` as Grafana's credential, not only from the JSON
  response: generate and preserve an independent `GRAFANA_PASSWORD` in the
  supported setup/upgrade path, make monitoring Compose require that credential,
  and update install templates/runbooks/tests. For an existing `grafana_data`
  volume, run a one-shot pre-start migration that privately snapshots the
  Grafana database, resets the admin credential with Grafana's supported CLI,
  restores the snapshot on any migration failure, and never logs the secret;
  fresh volumes skip the reset and initialize normally. Grafana must start only
  after that migration succeeds. Keep master-key disclosure solely behind the
  existing password-confirmed, audited endpoint.
- [x] Update monitoring response types/UI/tests so absence is explicit and no
  test encodes the secret leak. Add a route regression using a sentinel
  encryption key and assert it is absent from the normal admin response.
- [x] Add a repository method (or bounded query option) that selects the newest
  20 conversation messages and returns them chronologically. Do not change the
  public full-history listing contract if it legitimately requires ascending
  order. Make newest selection deterministic for equal timestamps (for example
  `createdAt` plus `id`) and cover the tie case.
- [x] Enforce the proxy's 8,000-character content maximum in the backend route
  schema before `sendMessage` persists anything, including the proxy's trim and
  non-empty semantics. Centralize the limit where the package graph permits;
  otherwise add a contract test that fails if backend and proxy limits drift.
  Keep frontend max-length/API error handling aligned with the backend
  validation response.
- [x] Apply the same canonical content contract at the service's outbound
  history and provider-response boundaries. Preserve full persisted legacy
  history for user retrieval while deterministically bounding legacy oversized
  rows in model context; bound or reject an oversized assistant response before
  persistence so no newly stored message can poison a later send.
- [x] Add service/repository proof that message 21 is present and message 1 is
  absent from a 20-message model context, plus a route/service proof that 8,001
  characters and whitespace-only input return 400 with zero message writes and
  exactly 8,000 characters remains accepted. Add legacy 8,001-character history
  and 8,001-character provider-response cases proving every outbound context and
  newly persisted message satisfies the limit without rewriting old history.
- [x] Add a persistent-volume upgrade proof that starts from the legacy
  encryption-key-derived Grafana login, applies the migration, accepts the new
  independent password, rejects `ENCRYPTION_KEY`, and proves the volume survives
  a forced migration failure unchanged.

## Phase 4: Integrated verification and delivery

- [x] Run focused Wallet Detail, Intelligence tabs, monitoring route,
  intelligence service/repository, gateway/egress contract, and ownership
  regression suites.
- [x] Run frontend app/tests typechecks, backend typecheck, lint, architecture
  drift checks, changed-file complexity, and test-hygiene checks.
- [x] Run the repository's complete coverage command and require exact 100%
  statements, branches, functions, and lines.
- [x] Re-read the full diff for scope, stale-success/error/finally gaps,
  destructive-control identity, and duplicated ownership helpers.
- [x] Run an independent adversarial implementation review and resolve every
  verified P0-P2 comment.
- [ ] Deliver Phase 1, Phase 2 plus the chat backend contracts, and the
  independent monitoring-credential phase as separate PRs when their diffs are
  independently releasable. For each, push the exact reviewed head, require all
  PR-head contexts terminal acceptable, squash-merge, verify base ancestry and
  head/merge tree identity, then require all exact target-SHA contexts terminal
  acceptable before rebasing the next phase.
- [ ] Rebuild only the Sanctuary containers that were already running when the
  loop began, after the entire loop reaches a clean rescrub.

## Completion evidence

- [x] Every locked finding has a failing-before/passing-after behavioral test.
- [x] No old route, wallet, conversation, filter, search, or mutation generation
  can commit success, revert/error, or finally state into the current view.
- [x] A normal monitoring-config response never contains `ENCRYPTION_KEY`.
- [x] The LLM context contains the newest bounded chronological history, and
  oversized messages are rejected before persistence.
- [ ] Reviewed head, merge tree, and exact target CI are durably recorded.
