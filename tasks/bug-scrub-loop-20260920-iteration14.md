# Bug scrub loop iteration 14: retire RBF actions with their originating UI

Status: reviewed; two complete clean passes. Prior target CI19072–19076 passed; fresh complete eight-domain scrub at current main confirms one P2.

Source target: `f0752a0042e85afed7f9d21f2ecffddab30337d4`. Preserve the existing outer bug-scrub-loop goal; do not create a competing goal. Implementation starts only after clean exact-plan review and durable provenance pinning.

## Confirmed finding and scope

P2 `transaction-rbf--late-navigation-after-unmount`: `useTransactionActions.handleRBF` awaits draft creation and then unconditionally navigates and invokes its completion callback. A real MemoryRouter reproduction navigates Back while the response is pending, proves the originating component unmounted, then observes the late response seize navigation to `/wallets/A/send`. Evidence: `.tmp/iteration14-rbf-repro.test.tsx` and `.tmp/iteration14-rbf-repro.log`.

Expected behavior follows `useBroadcast.ts`: server work already accepted may remain, but navigation and component-local effects require current UI ownership. No broadcast, wrong-wallet signing, or funds-loss claim is made.

P3 backlog is outside the blocking fix set; the prior timer P3 was incidentally resolved and verified in PR1307. No other blocking findings remain after the full-app auth cancellation disproof.

One implementation phase. Production scope is `src/components/TransactionActions/useTransactionActions.ts`, using existing `useLatestRequest`/request ownership facilities without modifying those helpers or introducing a generic framework. Tests: existing `tests/components/TransactionActions.test.tsx`, existing data contracts only if impacted, and a focused new `tests/components/TransactionActions/ownership.test.tsx`.

WalletId/txid scope handling is bounded hardening needed to make ownership coherent for a reused hook; the confirmed user bug is unmount navigation. Parent transaction panels are keyed by txid and intentionally keep hidden inactive tabs mounted. Do not retire on switching to another still-mounted tab, change panel keys, or add active-tab policy.

## Preconditions and fresh evidence

- [x] Finish prior target CI; fetch/resolve exact main and enumerate open PRs before selection. Preserve unrelated work and other agents' files.
- [x] Reconfirm current source and caller chain: TransactionList keyed panels → TransactionDetailPanel → TransactionDetailsBody → ActionMenu → TransactionActions. Rerun the isolated actual-hook/real-router reproduction at the exact target SHA.
- [x] Complete coordinator eight-domain scrub and reconcile all confirmed P0–P2 findings. If another blocking finding exists, revise the selected plan before implementation rather than silently omitting it.
- [x] Persist the exact bounded plan, recursively review to a complete clean pass, pin reviewed plan identity in durable state, and reserve an owned delivery branch/worktree before writes.

## Tests first and minimal implementation

- [x] Add a failing real-hook/real-router Back regression: delay createDraft, start RBF, navigate to previous route, verify unmount, resolve response; expect no navigation or completion callback. Preserve the accepted draft fixture and existing replacesTxid semantics.
- [x] Add deferred regressions at the earlier getTransaction and createRBFTransaction awaits. Retire before settlement; no subsequent API mutation or retired local commit may occur. Cover stale success and rejection at each boundary and preserve current error/retry behavior.
- [x] Add operation ownership in the existing hook, capturing tokens at action admission and invalidating on unmount through the established helper lifecycle. Guard continuation after every await, before later requests, navigation, completion callbacks, and local success/error/loading updates. Do not abort/delete already accepted server work or add compensation.
- [x] Make walletId+txid identity changes invalidate old operations synchronously and reset scoped action state so old pending flags/modal/results cannot block or contaminate the next identity. Confirmation may retire action eligibility; production already unmounts actions on confirmation. Avoid stale rbfStatus/fee reuse for the new identity. Keep status-lookup ownership separate from action ownership so a lookup cannot supersede an active action.
- [x] Preserve the status effect's existing success/failure contract while guarding retired errors; a failed new-scope lookup must not expose prior-scope eligibility. Add a focused same-txid/new-wallet test and A→B→A ownership test. These tests validate bounded scope handling, not a separate newly claimed security defect.
- [x] CPFP shares the hook's processing/error/success/modal/completion state: use the same bounded lifecycle owner to prevent its retired local commits and callback. Preserve accepted API behavior, current success message and current error flow. No CPFP API/schema redesign.
- [x] Test current successful RBF creates the original draft payload once, navigates with the returned draft plus replacesTxid, and completes once. Preserve current success/error/retry behavior for CPFP. If direct action supersession is supported, test obsolete finally cannot clear the newer busy flag; no claim of backend deduplication.
- [x] Test StrictMode setup replay permits current actions and retires cleaned-up work. Capture tokens inside actions, never hold a render token across replay. Confirm mounted inactive panels retain their existing behavior; only actual retirement invalidates the UI owner.
- [x] Independently review final production and test diff for each awaited continuation, callback ordering/reentry, helper reuse, mock fidelity, complexity and scope creep. Keep edited functions CCN<=15; extract only small named local helpers if required.

Acceptance: leaving/closing the originating UI cannot cause a late RBF redirect or local callback. No later client mutation starts after ownership retirement. A server-accepted draft remains available through normal application data, without automatic rollback. Current successful flow is unchanged. No unrelated authentication, sync UI, query/cache framework, backend, schema or migration change.

## Verification

Run guarded Node selection first: `source "$HOME/.nvm/nvm.sh" && nvm use --silent`. Check available disk/inodes/dependencies before expensive gates; use the configured frontend runner.

- [x] Preserve focused red evidence, then run:

```bash
npm run test:run -- tests/components/TransactionActions.test.tsx tests/components/TransactionActions/transactionActionsData.test.ts tests/components/TransactionActions/ownership.test.tsx tests/hooks/useLatestRequest.test.tsx
npm run typecheck:app
npm run typecheck:tests
npm run typecheck:all
```

- [x] Parent integration runs full `npm run test:run` and literal100% `npm run test:coverage`; meaningful current/stale/error tests must cover new guards without ignore directives.
- [x] Run `npm run build`. Serve dist with an owned static HTTP process and an ignored Playwright config without webServer; execute Chromium `tests/e2e/render-regression.spec.ts`. The actual-router Back regression is the direct navigation proof. `tests/e2e/send-transaction-flow.spec.ts` is API-mocked and can supplement send-wizard regression coverage, but its RBF checkbox does not test replacement retirement. Do not run live-backend `tests/e2e/wallet.spec.ts` against static dist.
- [x] Run configured frontend lint, affected architecture boundaries/cycles/graphs, `bash scripts/quality/lizard-only.sh`, and diff whitespace checks. Regenerate/stage expected graphs if the new helper import changes them. Preserve unrelated generated output.
- [x] Reuse backend verification only after recording unchanged server source/tree identity against its successful baseline. No backend test execution is required merely because frontend ownership changed.
- [x] Honor foreground commit hooks and investigate verified feedback. Before repeating an expensive failed gate, record immutable source/job identity, failure signature, new hypothesis and cheap discriminator.

## Delivery and rollback

- [x] One standalone protected PR for this phase. Parent owns docs/state/integration/commit/push and delivery; implementation delegates do not commit or push.
- [x] Refresh target and open PRs before delivery. Pin reviewed implementation head and plan provenance. Wait all required PR checks, merge using the exact head with branch deletion disabled, verify actual merge object/tree/ancestry, then verify exact target-branch push CI before marking delivered.
- [x] Maintain caller-owned outer goal and `rebuild_policy: defer`; no intermediate deployment. Do not start a stopped stack or alter unrelated release/dependency work.
- [ ] Revert through a protected PR if required; rollback restores the late-navigation defect but needs no data or cache migration. Accepted draft requests cannot be rolled back by UI retirement or code revert.
- [x] Preserve owned branches/worktree and operational evidence until final loop completion and exact cleanup authorization. Record provenance and concrete per-resource cleanup commands; never claim unperformed cleanup. Stop only owned temporary servers.

## Completion

- [x] Phase merged and exact target CI verified; finding attempts and immutable provenance recorded.
- [x] Run a new complete eight-domain scrub at new main. Any remaining P0–P2 findings require a newly reviewed plan; successful tests alone do not complete the loop.
- [ ] Only after a validated clean pass, complete authorized owned cleanup and deferred crash-safe rebuild of the originally running stack via `./start.sh --rebuild`, with deployed identity/readiness evidence. Validate durable state before completing the existing outer goal.

Recursive review: two complete clean passes, coordinator and independent source-backed review of this exact file. No verified actionable comments remain. Separate status/action ownership is retained to avoid a lookup canceling an action; hidden mounted tabs remain active. The reviewed implementation commit is pinned in durable state before code writes.

## Implementation verification progress

Implemented only the transaction-actions hook with existing ownership helper and a 27-case ownership suite. Tests-first run failed17/passed4; final focused run passes71 tests. The original real-router scrub reproduction now passes. All frontend typechecks, production build, app/server lint, architecture boundaries/cycles/graphs and complexity pass. Independent production and final test reviews are clean. Full frontend coverage passed all9,102 tests/673files at100% statements26,084, branches16,582, functions7,224 and lines23,784. All144 static-build Chromium render regressions and generated architecture index check passed; delivery is verified below. Backend/shared/dependencies/config source is unchanged from verified6004978.

## Verified delivery closeout

PR #1308 merged at `4467e96e11ea914a0239d54f1fa4b7d053fd0747`; actual object, main ancestry and equality with tested head `1f5b8562543e94f47c48f6283e60a6155ef6ff52` verified. PR workflows19077–19081 and exact target-push workflows19083–19087 passed. Vectors required one user-started same-SHA retry after recorded debug-session failure and verified cleanup; attempt2 and target Trezor passed, without claiming a root-cause repair. Finding resolved at attempt1. New iteration15 fresh scrub confirms three separate creation-flow P2s. Owned cleanup and deployment remain deferred outer-loop obligations.
