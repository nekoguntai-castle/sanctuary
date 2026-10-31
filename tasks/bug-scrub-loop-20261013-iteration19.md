# Bug-scrub loop 20261013 — iteration 19 remediation plan

- **Run:** `bug-scrub-loop-20261013-sanctuary`, iteration 19
- **Source SHA:** `c8d6f035058f40a036fbb4e4f6c5da80a7745889` (`main`, after #1421)
- **Scope:** whole repository (locked at run start)
- **Blocking findings (5 × P2):**
  - A1 `node-client--pool-failure-sticky-singleton-fallback`
  - A2 `mobile-permissions--row-creation-revokes-approve-and-manage-policies`
  - B1 `autopilot-settings--push-only-users-locked-out`: backlog P3 escalated to P2 in this iteration, because #1421 made the push path work.
  - C1 `ci-classifier--browser-e2e-lane-blind-to-flow-components`: USER DECISION 2026-10-30, "Whole frontend tree".
  - C2 `offline-bundle--build-mode-tags-lane-images-but-bundles-local`

  Every finding was re-verified from source at `c8d6f035058f` (file:line in each phase), and every fix was prototyped
  test-first on a scratch copy of that tree.
- **Deferred P3s:** all other iteration-19 findings are backlog in run state and are **outside this fix set**. They are
  listed under Open questions.
- **Scratchpad (`$SCRATCH`):** `/tmp/claude-1001/-home-nekoguntai-sanctuary/03f84a15-a621-4179-a832-71dcc24cbaff/scratchpad`.
  - Prototype diffs: `plan19-{A1,A2,B1,C1,C2}-prototype.patch`.
  - Red-run outputs: `p19-{a1,a2,b1,c1,c2}-red.txt`.
  - All five patches apply together on `c8d6f035058f` (`git apply --check`; 18 files, +878/−83).
  - A prototype is guidance; where the two differ, the phase text below governs.

| Phase | Finding id | Sev |
|---|---|---|
| A1 | `node-client--pool-failure-sticky-singleton-fallback` | P2 |
| A2 | `mobile-permissions--row-creation-revokes-approve-and-manage-policies` | P2 |
| B1 | `autopilot-settings--push-only-users-locked-out` (escalated P3 → P2 this iteration) | P2 |
| C1 | `ci-classifier--browser-e2e-lane-blind-to-flow-components` (USER DECISION: whole frontend tree) | P2 |
| C2 | `offline-bundle--build-mode-tags-lane-images-but-bundles-local` | P2 |

## Open questions

These are decided; none blocks the plan.

- **OQ-C1 (user, 2026-10-30).**
  - Decision: Full Browser E2E runs for any change in the frontend runtime tree, enforced by a drift guard derived
    from the app's import closure.
  - Cost: Full Browser E2E (all four groups, about a 90-minute budget) now runs on every `src/**` and `shared/**`
    change, so the e2e runner lock and the capacity-limited fleet see more load.
  - The root `package.json`/`package-lock.json` (and `config/tooling/*`) already ran it as full-scan triggers
    (`is_full_scan_trigger_file`, `classify-files-lib.sh:538-541`; `test.yml:1362`; `plan-test-run.sh:190`). Listing
    them in `is_browser_smoke_file` (the app imports `version` from `package.json`) changes no lane decision and adds
    no cost.
- **OQ-A1 (coordinator).** Keep the documented pool → singleton fallback (dashboard design `singleton_fallback`). Stop
  it sticking: the pool is retried after `POOL_FALLBACK_RETRY_MS` (30 s).
  - A second question is out of scope here: whether pool mode with **no configured** `singletonHost` on a
    non-mainnet network should fail closed rather than fall back to the public default. It is a policy change, not
    this bug, and is recorded as P3 follow-up `node-client--pool-fallback-uses-public-default-host` (backlog).
- **OQ-A2 (coordinator).** Rows created before this fix keep their stored `false` values. That includes every row
  that existed when migration `20260317000000_add_vault_policies` added the columns with `DEFAULT false`, and rows
  restored from older backups without these fields. Repairing production data is
  not authorised, and a stored `false` cannot be told apart from a deliberate choice. Owners or users restore
  approve/manage-policies with the existing reset (`resetCapabilitiesByWalletAndUser` sets both to true) or by
  enabling them. The changelog states this.
- **OQ-B1 (coordinator).**
  - The availability check fails open. If the push-device lookup errors, the controls stay usable with a note, so no
    one is locked out.
  - An already-enabled Autopilot always shows its controls, so it can be turned off.
- **OQ-C2 (coordinator).** Alias on save, not `SANCTUARY_IMAGE_TAG=local` at build time.
  - The build stays in the lane namespace that the coordinator assigns.
  - Installed bundles are byte-for-byte the same shape: archives, RepoTags and the inventory are still
    `sanctuary-*:local`.
  - Consequence (stated in the changelog): build mode re-points the build daemon's `sanctuary-*:local` tags to the
    release build. Run it on the packaging daemon, not on a host with a live stack.
  - Integrity (D-19.C2a): `:local` is a mutable host-wide tag, so the existing ID check before `docker save` is
    time-of-check-to-time-of-use. After `docker save`, the archive's `manifest.json` `.[0].Config` must name the
    verified image ID. Otherwise the bundle fails.
    - Real archives name the config `<hex>.json` (classic Docker before 25, and Podman docker-archive) or
      `blobs/sha256/<hex>` (Docker 25+), never `sha256:<hex>`. So the check normalises both with the tar and jq the
      script already uses:
      `(.[0].Config|sub("^blobs/sha256/";"")|sub("\\.json$";"")) == ($id|ltrimstr("sha256:"))`.
    - With the containerd image store (the default on fresh Docker 29 installs), `.Id` is the manifest digest, not
      the config digest. The D-19.C2a comparison therefore fails there by construction. The failure message names the
      containerd image store as the likely cause; there is no `docker info` probe, which the test fake does not
      support. The packaging daemon uses
      overlay2.

**Deferred P3s (backlog; outside this fix set).** These are this iteration's P3 ids in run state. They are not
duplicated here; the run state is authoritative.
- From the first-pass shards (2 to 3 each): `send--future-witness-recipient-accepted-then-refused`,
  `worker-shutdown--container-stop-timeout-shorter-than-graceful-deadline`, `email-verification--resend-hourly-cap-never-trips`,
  `wallet-pending--txids-polled-from-public-mempool-in-clearnet`, and so on.
- From gap-fill: the dashboard, sound, AI-query, OpenAPI-login, client-type and wallet-label items.
- Carried over and last seen in iteration 19, still P3: `push-device-cleanup--quiet-wallet-devices-pruned`,
  `send-type-selection--double-click-skips-outputs-step`, `audit-logs--filter-omits-mcp-and-console-categories`,
  `install-unit-upgrade-backup--two-checks-cannot-fail`.
- Explicitly out of scope even though it is in B1's controller: `autopilot-settings--toggle-saves-unsaved-edits`.
- The follow-up `node-client--pool-fallback-uses-public-default-host`, already recorded as backlog.

## Goal and non-goals

**Goal.** The five P2s stop reproducing:
- After a pool failure, wallet requests return to the pool once it recovers.
- A user's first mobile-permission row does not revoke approve or manage-policies.
- A push-only user can enable Autopilot.
- A PR touching any frontend runtime file runs Full Browser E2E.
- The offline bundle build mode bundles the images it just built.

**Non-goals.**
- No change to the pool's own failover, the dashboard status probe, or the fallback host policy (OQ-A1 follow-up).
- No schema or migration change, and no repair of existing permission rows.
- No server change for Autopilot.
- No change to browser E2E grouping, sharding or budgets.
- No retirement of lane-tagged images (pre-existing; outside this finding).
- No version bump. The P3 backlog stays out.

## Decisions

### Cross-cutting decisions

- **D-19.X1 (delivery).**
  - One PR on `codex/bug-scrub-loop/20261013-i19` (worktree `/home/nekoguntai/sanctuary-bug-scrub-20261013-i19`).
  - One commit per finding (failing test + fix) in the order C1, C2, A2, A1, B1, then the integrator commit
    (changelog and any regenerated `docs/architecture/generated`).
  - The coordinator implements each phase from its prototype in the integration worktree. The prototypes are small
    and disjoint, so no separate phase worktrees are needed.
- **D-19.X2 (red evidence and setup).**
  - Every new test runs on base code before its fix and must fail for the reason its phase states. An unexpected red
    reason is a stop: record it and re-assess.
  - Setup, before C1, in the integration worktree:
    - root `npm ci`;
    - `npx prisma generate` in `server/`;
    - `npm run build --workspace shared`;
    - about 810 `node_modules` entries, in a real directory.
  - Never `server/npm ci`. Never `git stash`. One coverage run at a time host-wide.
  - Commits run in the foreground with nvm node v24.21.0 (npm 12), and never while a `vitest --coverage` runs on the
    host.
- **D-19.X3 (pinned surfaces).** No planned change touches:
  - `config/wallet-safety-mutation-map.json` or the Stryker configs;
  - `.github/mutation-baseline.json`;
  - `config/wallet-sync-mutation-boundaries.json`;
  - `server/prisma`;
  - `config/resource-lifecycle-callsites.json`;
  - `scripts/verify-addresses`, `scripts/perf` or `shared/`;
  - `.github/workflows`;
  - `server/src/services/accessControl.ts`.

  Notes:
  - `nodeClient.ts` is under `server/src/services/bitcoin/**`, which `config/wallet-safety-critical-paths.json:11`
    lists, so the PR triggers the wallet-safety full scan. The file is not in the mutation map or any Stryker range.
    `config/wallet-sync-lifecycle-contract.json` names it by file and role only. `scripts/quality/safety-catch-allowlist.json`
    pins one catch in `getNodeClient`, and the prototype keeps it.
  - `mobilePermissionRepository.ts` is in no mutation or critical list.
- **D-19.X4 (lizard).** Run the pinned `lizard` 1.24.0 with CI's flags on every changed `.ts`/`.tsx`: the per-file
  warning count must not grow, and the repository total stays ≤ the base total (measured on `c8d6f035058f` in a
  detached worktree inside the Verification block).

## Phase C1 — Every frontend runtime change runs Full Browser E2E

P2 `ci-classifier--browser-e2e-lane-blind-to-flow-components`, USER DECISION.

**Evidence (at `c8d6f035058f`).**
- **What the lane covers.** `scripts/ci/classify-files-lib.sh:268-291` `is_browser_smoke_file` covers `src/App.tsx`,
  `src/main.tsx`, `src/index.html`, `src/app/*` and `src/api/*`. Under `src/components/` it covers only `Layout`,
  `Login`, `DraftList`, `AuditLogs`, `Monitoring` and `WalletDetail`.
- **The gate.** `browser_smoke_changed` decides whether the whole Full Browser E2E job runs (`.github/workflows/test.yml`
  ≈1357-1362; required-check logic ≈2150-2213). The four groups in `scripts/ci/browser-e2e-groups.sh` are not
  selected by file.
- **Why the gap matters.** Every browser spec loads `src/main.tsx` → `App.tsx` and navigates hash routes, so specs
  drive components outside that list: `send-transaction-flow`, `create-wallet-flow`, `import-wallet-flow`,
  `settings-persistence`, `console-drawer-smoke` and `dashboard-price-blocks`.
- **The stale test.** `tests/ci/classify-test-changes.test.sh:640-649` asserts that a Dashboard change gives
  `browser_smoke_changed=false`.

**Fix (prototype `plan19-C1-prototype.patch`).**
- `is_browser_smoke_file` matches:
  - `src/App.tsx|src/main.tsx|src/index.html|package.json|package-lock.json|config/tooling/playwright.config.ts`
  - `src/app/*|src/api/*|src/components/*|src/hooks/*|src/contexts/*|src/providers/*|src/themes/*|src/utils/*|src/services/*|src/public/*|src/types/*`
  - `shared/*`

  The existing server-side entries and the `tests/e2e/*` branch stay as they are.
- **`src/types/*` is included (review pass 1).** It is not type-only: `src/types/hardware.ts:7`
  `export enum HardwareDevice`, and `src/types/index.ts:151-483` `WALLET_TYPE_LABELS`, `getWalletTypeLabel`,
  `isMultisigType` and `getQuorumM/N`, which the send flow imports. The drift guard's `TYPE_ONLY_TREE` drops
  `^src\/types\/` and keeps only the `src/api/**/types.ts` part. `is_render_file` has the same gap; that is recorded as
  P3 follow-up `ci-classifier--render-lane-omits-src-types-runtime`.
- **No caller changes.** `classify-test-changes.sh` and `plan-test-run.sh` already call `is_browser_smoke_file` for
  shared files, after their `is_shared_workspace_file` block.
- **D-19.C1a (render-regression harness; coordinator decision, overriding the prototype's exemption).**
  `tests/e2e/network-sync-toggle-dark.spec.ts`, which runs in the browser lane, imports
  `tests/e2e/render-regression/renderRegressionHarness.ts`, so that one harness file is classified as a browser
  input:
  - its exact path is checked **before** the render-regression exclusion in the `tests/e2e/*` branch, and
    returns 0;
  - the drift guard needs no exemption for it;
  - the render-only test case moves to another render-regression file that no browser spec imports.

  Exempting the file would recreate the blind spot this phase closes.
- **D-19.C1b (drift guard).** New `tests/ci/browserSmokeInputsClassified.test.ts`, modelled on
  `tests/ci/renderHarnessInputsClassified.test.ts`. Like that template, it runs through the root Vitest include, so it
  needs no registration.
  - Same import regex, including dynamic `import()`, and the same exclusion of type-only paths.
  - Follows the `@/` and `@sanctuary/shared/` aliases, and skips comment-only lines.
  - Walks from `src/main.tsx`, `src/App.tsx` and every `tests/e2e/*.spec.ts` except `render-regression.spec.ts`,
    including their relative imports.
  - Asserts that every reachable runtime file returns 0 from `is_browser_smoke_file`, in one bash call that sources
    the classifier library.
  - An `EXEMPTIONS` map fails on stale entries and on entries without a reason. With D-19.C1a it is expected to be
    empty.
- **Tests.**
  - `classify-test-changes.test.sh`: Dashboard now expects `true`; `src/services/hardwareWallet/service.ts` flips to
    `true`.
  - A new loop covers `src/components/send/x.tsx`, `src/components/Settings/x.tsx` and `src/hooks/x.ts`.
  - The shared-only case also asserts `browser_smoke_changed=true`.
  - A render-only case stays, on a render-regression file not imported by any browser spec.
  - `src/types/index.ts` is added to the flow loop.
  - `tests/e2e/render-regression/renderRegressionHarness.ts` gives `browser_smoke_changed=true` (red-first evidence
    for D-19.C1a).

**Red (observed).** `p19-c1-red.txt`:
- `classify-test-changes.test.sh` exits 1 with `expected browser_smoke_changed=true, got false`.
- The drift guard exits 1 with 934 unclassified reachable files.

**Files (4).** `scripts/ci/classify-files-lib.sh`, `tests/ci/classify-test-changes.test.sh`,
`tests/ci/browserSmokeInputsClassified.test.ts`, and `docs/reference/ci-cd-strategy.md`. At `:370` it describes the
browser lane as covering "browser/API/route/non-render E2E paths"; it now says the frontend runtime tree and
`shared/`, derived by the drift guard.

**Acceptance.**
- Red on base.
- Green:
  - `bash tests/ci/classify-test-changes.test.sh`;
  - the drift guard;
  - `bash tests/ci/classify-quality-scope.test.sh`, which also runs the classifier-suite-subject derivation;
  - `bash tests/ci/check-workflow-composition.test.sh`;
  - `bash tests/ci/plan-test-run.test.sh`;
  - `tests/ci/renderHarnessInputsClassified.test.ts`;
  - `tests/ci/vitestRepoInputsClassified.test.ts`.
- On this PR's own CI, Full Browser E2E runs: `browser_smoke_changed=true`, because B1 changes `src/**`. Record the
  job IDs.

**Changelog (Fixed).** "CI: Full Browser E2E now runs for any change to the frontend runtime tree (`src/` components,
hooks, contexts, types, utils, services and the rest of the app) and `shared/`.
Before, it ran only for a hand-kept list of six component folders, so a change that broke the send, wallet creation,
import, settings, console or dashboard flows merged green and was caught only by the nightly run. A drift guard derives
the covered set from the app's import closure."

## Phase C2 — The offline bundle build mode bundles the images it built

P2 `offline-bundle--build-mode-tags-lane-images-but-bundles-local`.

**Evidence (at `c8d6f035058f`).**
- `scripts/offline/create-bundle.sh` re-executes itself under the cleanup coordinator (≈:687
  `exec "$CLEANUP_COORDINATOR" auto-run --lane offline-create ...`).
- The coordinator sets `SANCTUARY_IMAGE_TAG` to the lane's compose project name
  (`scripts/ownership/ci-cleanup-subject-lifecycle.mjs:37`).
- The build (`create-bundle.sh` ≈:171, :185, `docker compose ... build`) does not override that tag, so compose
  (`docker-compose.yml:210` `image: sanctuary-backend:${SANCTUARY_IMAGE_TAG:-local}`, and the other images) tags the
  images `sanctuary-*:<lane>`.
- The bundle step looks only for hard-coded `sanctuary-*:local` (`scripts/offline/bundle-common.sh:11-35`).
- So build mode, the documented default, used by `scripts/release/prepare-release-assets.mjs:137` unless
  `--bundle-path` is given, fails with `image not available locally` unless same-commit `:local` images exist. It
  fails closed.

**Fix (prototype `plan19-C2-prototype.patch`).**
- `SOURCE_IMAGE_TAG` defaults to `local`. In build mode it is `${SANCTUARY_IMAGE_TAG:-local}` and is passed
  explicitly to both `compose build` calls.
- `bundle_source_image` maps each install-time `sanctuary-*:local` name to `sanctuary-*:$SOURCE_IMAGE_TAG`. The
  revision check, `save_images` and `write_image_inventory` inspect that source ref.
- `save_images` reuses its existing digest-alias path:
  - `docker image tag <lane ref> <:local>`;
  - `verify_archive_alias`, which checks the same image ID, OS and architecture;
  - `docker save`, with a check that the archive RepoTags are exactly `[":local"]`.
- `--skip-build` keeps using existing `:local` images.
- D-19.C2a: after `docker save`, `save_images` checks that the archive's `manifest.json` `.[0].Config` names the
  verified image ID, normalised as in OQ-C2. On the containerd image store it fails by construction, and the message names that store as the likely cause.
- **Cleanup:** `create-bundle.sh` never registers compose resources. Its `oci_image` create callsite is already
  `exempt` in `config/resource-lifecycle-callsites.json` ("retained under the owning application lifecycle"). The
  `:local` alias falls under that same exemption, and the registry needs no change.

**Tests.** `tests/install/unit/offline-bundle-script.test.sh`:
- The fake docker gets a `SANCTUARY_FAKE_IMAGE_STORE` mode: compose build writes `sanctuary-x:${SANCTUARY_IMAGE_TAG:-local}`,
  and `image tag` and `inspect` honour the store.
- A new `make_release_repo` helper replaces two inline copies.
- New `test_create_bundle_build_under_lane_tag_bundles_local_refs`, wired into `main`:
  - a signed full build under a lane tag: lane refs are built and aliased, the archives restore `:local`, and the
    inventory matches;
  - `--skip-build` under the lane: no build, no retag.
- D-19.C2a cases:
  - The fake `docker save` (`offline-bundle-script.test.sh:303` at base, inside the fake `save)` branch; currently
    `"Config":"config.json"`; **not** the apply-side `write_test_image_inventory` helper at `:158`, which must not
    change) writes
    `${image_id#sha256:}.json`, consistent with `SANCTUARY_FAKE_IMAGE_ID`. All existing cases keep passing.
  - New: a saved archive whose config ID differs from the verified ID fails the bundle, and the message names the
    containerd image store as the likely cause.
  - New: a `blobs/sha256/<hex>` layout passes.

**Red (observed).** `p19-c2-red.txt`: `Error: image not available locally: sanctuary-backend:local`; the suite exits
1 (34 run, 1 failed). The D-19.C2a mismatch case is new in the plan. The implementer records its red on base: a
mismatched config is bundled without error.

**Files (2).** `scripts/offline/create-bundle.sh`, `tests/install/unit/offline-bundle-script.test.sh`.

**Acceptance.**
- Red on base.
- Green:
  - `offline-bundle-script.test.sh`, every case (34 plus the two D-19.C2a cases);
  - `offline-compose-images.test.sh`;
  - `cleanup-containers-guard.test.sh`;
  - `bash -n`;
  - `node scripts/ownership/check-lifecycle-callsites.mjs`, after `git add`;
  - `node scripts/ci/check-supply-chain-locks.mjs`.
- `install-test.yml` runs on `scripts/offline/**`. Record the job ID.
- **Residual (stated in the PR):** no real compose build or `docker save` runs in tests. The alias path is proven only
  against the stub, the same as before.

**Changelog (Fixed).** "Offline bundle: building a bundle (`create-bundle.sh` without `--skip-build`, the default for
release asset preparation) bundles the images it just built again. Under the cleanup coordinator the build tags images
with the lane name, while the bundle step looked only for `:local` images, so the build failed with \"image not
available locally\" unless matching `:local` images already existed. The bundle still contains the same
`sanctuary-*:local` images, now checked against the saved archive's image ID. Build mode points the build host's
`sanctuary-*:local` tags at the new build, so run it on the packaging host, not on a host with a live stack."

## Phase A2 — Creating a user's first mobile-permission row keeps approve and manage-policies

P2 `mobile-permissions--row-creation-revokes-approve-and-manage-policies`.

**Evidence (at `c8d6f035058f`).**
- **Schema defaults.** `server/prisma/schema.prisma:1575-1576` default `canApproveTransaction` and
  `canManagePolicies` to `false`. Every other capability defaults to `true` (`:1556-1572`).
- **Create path.** `server/src/repositories/mobilePermissionRepository.ts:248-268` `upsert` creates rows from the
  given fields only, so these two take the `false` default.
- **Where rows get created:**
  - an owner sets a cap (`setMaxPermissions`, `mobilePermissionService.ts:343`);
  - a user changes one of their own actions (`:289`).
- **Effect.** Approvers and owners silently lose mobile approve and reject on agent drafts
  (`mobileAgentDraftService.ts:116/175/218`). Owners also lose the *reported* manage-policies capability; nothing in
  `server/src` or `gateway/src` acts on it. With no row at all, they get their role maximum. Effective permission is
  gated on the role maximum first (`mobilePermissionService.ts:109-110`), so a stored `true` can never exceed a
  role.
- **Reset disagrees.** `resetCapabilitiesByWalletAndUser` (`:215-235`) sets both to `true`.
- **Why tests miss it.** The service tests mock the repository with hand-built rows.

**Fix (prototype `plan19-A2-prototype.patch`).**
- The `upsert` create branch sets `canApproveTransaction: true, canManagePolicies: true` **before** `...input`, so
  explicit input still wins. The update branch is unchanged.
- Side effect, asserted in the new service test: a row created only by an owner cap no longer reports custom
  restrictions. That covers the service helper `hasSelfRestrictions` (`mobilePermissionService.ts:74`, used at `:201`
  and `:435`) and the list endpoint's inline `hasCustomRestrictions` (`api/mobilePermissions.ts:125-137`).
- The test's `SCHEMA_CREATE_DEFAULTS` fake carries a comment pointing to `schema.prisma:1556-1576`, so drift is
  visible.
- The separate `create()` function (`mobilePermissionRepository.ts:192`) is unchanged: it has no production
  callers (`git grep 'mobilePermissionRepository.create(' -- server/src` is empty at `c8d6f035058f`).
- No schema or migration change. Existing rows are not repaired (OQ-A2).

**Tests.**
- `server/tests/unit/repositories/mobilePermissionRepository.test.ts`:
  - the create defaults are `true` and the update branch does not get them;
  - an explicit `false` is kept.
- New `server/tests/unit/services/mobilePermissions/rowCreationDefaults.test.ts`: the real repository and service,
  with a Prisma fake that applies the schema's create defaults the way the database does. Cases:
  - an approver after the owner's `setMaxPermissions`;
  - an approver after `updateOwnPermissions`;
  - an owner after `updateOwnPermissions`, checking both capabilities.
- `server/tests/integration/repositories/mobilePermissionAccess.test.ts`: one case covering an approver and an owner,
  including the stored row values. The spec is already registered at `scripts/ci/backend-integration-groups.sh:98`.

**Red (observed).** `p19-a2-red.txt`:
- 4 failed / 33 passed;
- the repository test is missing the defaults in the create argument;
- the three service cases fail with `expected false to be true`.

The integration case's red is recorded by the integrator's guarded base swap before the Verification block (step 4).

**Files (4).** `server/src/repositories/mobilePermissionRepository.ts` and the three test files above.

**Acceptance.**
- Red on base.
- Green: the unit suites above, `server tsc` and `typecheck:tests`, and the integration spec through
  `npm --prefix server run test:integration:db`.

**Changelog (Fixed).** "Mobile permissions: the first time a user's mobile permissions were saved (an owner setting a
cap, or the user changing one of their own actions), the user lost mobile approve and reject for agent drafts, and an
owner's reported policy management, because new rows stored those two as off. New rows now start with them on, like every other capability and like a reset. Rows
saved before this fix keep their stored values; reset the user's mobile permissions, or turn the capabilities on
again, to restore them."

## Phase A1 — After a pool failure, requests return to the pool when it recovers

P2 `node-client--pool-failure-sticky-singleton-fallback`.

**Evidence (at `c8d6f035058f`).**
- **The cache.** `server/src/services/bitcoin/nodeClient.ts:192-195` returns the client cached in `networkClients`
  whenever it is still connected.
- **The fallback.** In pool mode, a failed pool init or borrow (`:209-235`) uses
  `getElectrumClientForNetwork(network)` and connects it. That client goes to the network's configured
  `singletonHost`, or a public default (`shared/constants/nodeConfig.ts:62`, `:74`, `:98`; mainnet first tries the
  legacy `nodeConfig.host`), through the saved proxy.
- **Why it sticks.** The fallback is then cached (`:254-260`, and `activeClient` for mainnet), so the pool is never
  retried while that socket stays up.
- **The status disagrees.** The dashboard probes independently (`networkStatusService.ts:212-275`), so it can show the
  pool healthy while requests stay pinned. The design expects a visible fallback and a pool retry
  (`docs/plans/dashboard-network-status-card-redesign.md`).
- **Why tests miss it.** The existing tests (`nodeClient.client-selection.contracts.ts:70`, `:83`) assert only the
  first call.

**Fix (prototype `plan19-A1-prototype.patch`).**
- New exported `POOL_FALLBACK_RETRY_MS = 30_000` and a module map `poolFallbackRetryAt`.
- New `getReusableCachedClient`: returns the cached client only while it is connected and its deadline (if any) has
  not passed. Otherwise the normal pool attempt runs again.
- New `cacheNetworkClient`:
  - caches the client;
  - sets the deadline to now + window when the pool fallback was used, and deletes it otherwise;
  - so a pool success replaces the cache and clears the deadline, and a repeated failure moves the deadline forward.
- New `connectSingleton` replaces the duplicated connect code.
- The fallback singleton is **never disconnected**: it is shared across the process. The worker's subscription
  stream uses the same instance (`server/src/worker/electrumManager/networkConnection.ts:123`).
- **D-19.A1a (one retry at a time; review pass 1).** The first caller after the deadline claims the retry by moving
  `poolFallbackRetryAt` to now + window **before** it attempts the pool. Concurrent callers keep getting the cached
  fallback immediately. Without this, every request after the deadline runs its own pool identity check (up to the
  10 s `DEFAULT_IDENTITY_TIMEOUT_MS`, `networkIdentity.ts:5`) and can use up sync stage budgets (`sync/pipeline.ts:100-108`).
- **D-19.A1b (never disconnect the shared fallback; review passes 1–2).** When a retry falls back to the cached,
  already-verified singleton, it does not verify it again: `identityVerified = true` for that client. So a timed-out
  re-verify can never reach `disconnectQuietly` (base `:252-259`) and drop the instance the worker also uses. This
  mirrors the existing abort guard (contracts test `:184`).
  - The exact skip rule: the fallback client is `=== networkClients.get(network)` **and** it was connected before
    `connectSingleton` ran. A reconnected or replaced singleton is verified again.
  - A claim happens only while a connected client is cached, so the first fallback and a disconnected cache always
    take the full path, and no caller is left without a client.
  - An aborted claimer pushes the next retry back one window. That is acceptable.
- `resetOneNetwork` and `resetAllNodeClients` clear the deadlines. `saveNodeConfig` is unchanged: it does not clear
  `networkClients`, and config changes already go through the reset (prototype decision 1).
- `getElectrumClientIfActive` is untouched, as is the one `getNodeClient` catch pinned by the safety-catch allowlist.

**Tests.** `server/tests/unit/services/bitcoin/nodeClient.client-selection.contracts.ts`, run by `nodeClient.test.ts`.
The clock is pinned with `vi.spyOn(Date, 'now')`. The file has no fake-timer style; the spy is safe because identity
verification is mocked.
- "retries the pool after the fallback retry window instead of pinning the singleton": red.
- "a repeated pool failure keeps the fallback and extends the deadline": red.
- "concurrent callers after the deadline share one pool retry and keep the fallback" (D-19.A1a): red on base and on the
  pass-0 prototype. It holds `getElectrumPoolForNetwork` pending and makes two calls after the deadline; the second
  resolves to the singleton, the pool getter is called twice in total (the initial failure plus one shared retry),
  and once the held pool resolves, the first caller gets the `PooledNodeClient`.
- "a retry that falls back does not re-verify or disconnect the shared singleton" (D-19.A1b): the pool fails twice.
  After the retry the pool getter has been called twice, `verifyNodeClientNetwork` once (the first fallback only),
  and `disconnect` not at all. It is red on base, where the pool getter is called once. No verify rejection is
  queued.
- Guards: "within the window returns the cached fallback without re-attempting the pool" (passes on base), and "reset
  clears the retry deadline" (passes on base when run alone). The deletes in reset are defensive; the guard documents
  the reset contract.
- **Mock hygiene (review pass 2).** The repo config only clears mocks, so queued `*Once` values leak into the next
  test. Every new test's `finally` runs `mocks.getElectrumPoolForNetwork.mockReset()` then
  `.mockResolvedValue(poolFacade)`, and the same for `verifyNodeClientNetwork` resolving `undefined`.

**Red (observed).** `p19-a1-red.txt`: `getElectrumPoolForNetwork` was called 1 time where 2 were expected, in both
prototype red cases. The two review-pass cases (A1a, A1b) are new in the plan. The implementer records their red on
base: A1a and A1b each have the pool getter called 1 time where 2 were expected.

**Files (2).** `server/src/services/bitcoin/nodeClient.ts` and the contracts file.

**Acceptance.**
- Red on base.
- Green:
  - `cd server && npx vitest run tests/unit/services/bitcoin` (5,386 tests on the prototype);
  - `tsc` and `typecheck:tests`;
  - `check-safety-catch-guards`;
  - lizard, with the D-19.X4 pinned flags: `getNodeClient` goes from NLOC 61 / CCN 12 to 52 / 8 on the prototype.
    Plain `lizard` misparses this file.
- verify-vectors runs because of the critical path.

**Changelog (Fixed).** "Electrum pool: when the connection pool failed and wallet requests fell back to the single
server, they stayed on that server until its connection dropped, even after the pool recovered, while the dashboard
could already show the pool as healthy. Requests now try the pool again every 30 seconds while on the fallback."

## Phase B1 — Push-only users can turn on Autopilot

P2 `autopilot-settings--push-only-users-locked-out`: backlog P3 escalated in iteration 19, because #1421 made
autopilot pushes deliverable.

**Evidence (at `c8d6f035058f`).**
- **The gate.** `src/components/WalletDetail/WalletAutopilotSettings/useWalletAutopilotSettingsController.ts:27-33`
  `getNotificationsAvailable` requires Telegram `botToken`, `chatId` and `enabled`, and nothing else.
  `AutopilotSettingsCard.tsx` hides all controls when that is false (≈:301).
- **The notice contradicts it.** It says "Configure Telegram or push notifications in Account Settings to use
  Autopilot" (≈:58), but the web Account Settings page has no push setup.
- **The server would deliver.** `server/src/services/autopilot/evaluator.ts:293-297` sends push to users with
  `notifyPush`. Since #1421 those pushes reach registered devices through the gateway.
- **A device list exists.** `GET /api/v1/push/devices` (`server/src/api/push.ts:228-242`, authenticate only;
  OpenAPI `paths/push.ts:100`) lists the user's devices.
- **Side effect today.** A user whose Telegram setup was removed cannot turn off an Autopilot that is already enabled.

**Fix (prototype `plan19-B1-prototype.patch`).**
- **New `src/api/push.ts` `getPushDevices()`**, validated with a local zod schema that mirrors the OpenAPI `PushDevice`
  shape (the `src/api/walletRemediation.ts` pattern).
- **Controller:**
  - the device lookup runs in parallel with the settings fetch and is awaited before `loading` turns false;
  - its result is a device count, or `'unknown'` on error (`log.warn`, never thrown);
  - `notificationsAvailable = telegramReady || deviceCount > 0 || 'unknown'`;
  - `pushLookupFailed` is set only when Telegram is not ready.
- **Card:**
  - controls show when notifications are available **or** `settings.enabled` is already true; in the second case
    the notice shows above them;
  - when the lookup failed, a note reads "Could not check for registered mobile devices…";
  - the notice now reads "Configure Telegram in Account Settings or sign in on the Sanctuary mobile app to receive
    push notifications."
- `WalletAutopilotSettings.tsx` passes `pushLookupFailed` through.
- **D-19.B1a (render stability; corrected in review pass 1).** No PNG baseline shows the Autopilot card. The only
  wallet shots are wallet-detail-addresses-empty and wallet-list-testnet, and the overflow flow takes no screenshot.
  - Keep the prototype's card body `p-6 space-y-4`: `space-y-4` only spaces siblings, so today's single-child states
    render the same.
  - Without it, the new notice, the lookup-failed note and the controls would touch in the new states.
  - The integrated Playwright run must leave every PNG baseline byte-identical.
- **D-19.B1b (e2e mock maps).** The client now calls the existing `GET /push/devices` on the wallet Autopilot tab.
  - Add `'GET /push/devices': mockResponse({ devices: [] })` to the shared render-regression map in
    `tests/e2e/render-regression/renderRegressionHarness.ts`. Its `renderWalletSettingsOverflow` flow
    (`render-regression.spec.ts:92`) opens the Autopilot tab and asserts no unhandled requests.
  - The implementer greps every e2e mock map (`transactions/balance-history` enumerates them; CLAUDE.md) and every
    spec that opens the Autopilot tab. Any other flow that mounts the tab gets the same entry.
  - The integrated Playwright run (Verification) is the proof: no new unhandled-request failure.

**Tests.**
- `tests/components/WalletDetail/WalletAutopilotSettings.test.tsx` mocks `src/api/push`; the existing gate tests at
  ≈:153, :162, :377 and :501 pass with `[]`. New cases:
  - "enables Autopilot controls for a push-only user with a registered device";
  - "keeps controls visible to disable when autopilot is already enabled without channels";
  - "fails open when the push device lookup errors";
  - "describes the real notification setup paths when no channel is available".
- New `tests/api/push.test.ts` (5 cases, the client-mock pattern from `intelligence.test.ts`).

**Red (observed).** `p19-b1-red.txt`:
1. The spec files fail to import the missing `src/api/push`.
2. With only the wrapper added, 4 of 44 fail: the gate cases and the copy case.

**Files (7).** `src/api/push.ts`, `src/components/WalletDetail/WalletAutopilotSettings.tsx`,
`src/components/WalletDetail/WalletAutopilotSettings/AutopilotSettingsCard.tsx`,
`src/components/WalletDetail/WalletAutopilotSettings/useWalletAutopilotSettingsController.ts`, `tests/api/push.test.ts`,
`tests/components/WalletDetail/WalletAutopilotSettings.test.tsx`, `tests/e2e/render-regression/renderRegressionHarness.ts`.
Add any further e2e map that D-19.B1b finds, and amend the scope count.

**Acceptance.**
- Red on base.
- Green:
  - the two spec files;
  - `tests/components/WalletDetail` and `tests/api`;
  - `typecheck:app` and `typecheck:tests`;
  - eslint;
  - frontend coverage at 100%;
  - the Playwright static run with PNG baselines unchanged.

**Changelog (Fixed).** "Autopilot: a user who receives push notifications on the Sanctuary mobile app but has no
Telegram set up can now turn Autopilot on. The settings card only checked for Telegram, although it said push works
too. An Autopilot that is already on can always be turned off, and if the app cannot check for registered devices, the
controls stay available with a note."

## Implementation log (coordinator)

- Final reviewed plan commit `3ac4788b1` (5 review passes). Five phase worktrees were created from it. Each phase
  commit was cherry-picked with `-x` in plan order and proven upstream with `git cherry`, then its worktree and branch
  were removed:

  | Phase | Integrated as | Worker commit |
  |---|---|---|
  | C1 | `5b3b6a3f0` | `40a28446f` |
  | C2 | `3e254c210` | `ed2184257` |
  | A2 | `874b9b755` | `a52761a61` |
  | A1 | `9a6131fc6` | `e2bb5816e` |
  | B1 | `5c569253a` | `2131379de` |
- Red runs, all on base code and all failing for the stated reasons:
  - `$SCRATCH/i19-{c1,c2,a2,a1,b1}-red.txt`.
  - C1: 939 unclassified reachable files. That is 934 plus `src/types` and the harness.
  - C2: 2 of 36 failed (the lane tag and the mismatch).
  - A2: 4 of 37.
  - A1: 4 red cases, plus guards.
  - B1: a missing module, then 4 of 44.
- The A2 integration red was recorded on a guarded base swap (`$SCRATCH/i19-a2-integration-red.txt`): `expected false
  to be true`, and the restore was verified.
- Worker additions inside scope, each requested by a pre-commit reviewer:
  - A1: "a retry whose fallback singleton reconnected verifies it again".
  - B1: Telegram-ready plus a failed lookup; a wallet-change race.
- Integrator commit `a96abf3fb`: five changelog bullets, and `frontend.md` regenerated with the `src/api/push` edge.
- `/simplify` (`149a5a2a0`):
  - `takeCachedClientOrClaimPoolRetry`, with no `Date.now()` when no fallback is active;
  - test `beforeEach`/`afterEach` and an `enterFallback()` helper;
  - the Autopilot `'none'|'registered'|'unknown'` state;
  - a memoized drift-guard walk;
  - `source_ref` and the `archive_config_matches_image_id` helper;
  - test helpers in the offline suite.

  Deferred (each would add a file): a shared import-graph module for the two drift guards, and moving the push schema
  into `shared/schemas`.
- Adversarial review: no blockers. Fixed in `93d6c4677`:
  - A1: the claimed retry now runs as a background probe under its own 15 s timeout, and a connected fallback is always
    returned at once. Reset generations were added, and the A1b skip rule became unnecessary.
  - C2: the revision check is bound to the saved image ID; the manifest must have exactly one entry and tag and be
    non-empty; the inventory comes from the verified inspection.
- Focused re-review of `93d6c4677`: no defects in the redesign.
  - Two test gaps were closed in `3ae156a5a`: a reset-generation case, and deterministic probe-exit waits. A small
    test-only export, `waitForPoolRetryProbeForTests`, was added. A mutation proof is in `$SCRATCH/i19-probe-gaps-red.txt`.
  - Two pre-existing issues were recorded as backlog P3s: `electrum-pool-registry--reset-during-init-stores-stale-pool`
    and `node-client--verify-timeout-disconnects-shared-singleton`.
- **Verification on `3ae156a5a`.**
  - The full block ran to Playwright with everything green:
    - backend coverage 100/100/100/100 (43,091 statements, 24,371 branches);
    - frontend 100% (27,360 statements);
    - the A2 integration case on a real database;
    - the classifier and offline suites.
  - That Playwright run had 26 extra failures across untouched specs (accessibility, dashboard, error-recovery,
    import, render-regression), mostly "element not found" timeouts. The host load was about 15, from another
    project's test run.
  - Re-running the same spec files gave 56/56 and 220/220. The block's tail, from Playwright onward, was then re-run
    as written (`$SCRATCH/i19-verify-tail.sh`): exit 0.
    - Playwright: 392 expected, 2 skipped, and only the 7 known auth/login failures; PNG baselines unchanged.
    - Lizard: 83 at head = 83 at base, with no per-file growth.
    - The 20-file scope diff, lint, `arch:check`, the architecture-boundary and server-cycle checks, the lifecycle,
      ownership-contract and supply-chain gates, and `git diff --check` all pass.
- Run state: none of this plan's `commitShas` entries are stray. The stray `3450cfe0508d` is in iteration 18's plan
  record (see the iteration-18 plan's Review log).

## Verification (before every push)

The integrator runs this block on the integrated branch in `/home/nekoguntai/sanctuary-bug-scrub-20261013-i19`, after
all five phase commits and the integrator commit, as `bash "$SCRATCH/i19-verify.sh"`.

**Before the block:**
1. Run `npm run arch:graphs` and `npm run arch:calls`, and commit `docs/architecture/generated` (if it changed) in the
   integrator commit. B1 adds a `src/api/push` import edge.
2. Copy `playwright.static.config.mts` and `known-auth-login-failures.txt` from `$SCRATCH/i18-playwright/` to
   `$SCRATCH/i19-playwright/`, with the config's import path changed to the i19 worktree.
3. The integration database needs no leftover check: under the cleanup coordinator each run gets a fresh Compose
   project, `ci-${runId}-${attempt}-${lane}` (`ci-cleanup-subject-lifecycle.mjs:24`, `ci-cleanup-authority.mjs:19`),
   so nothing is reused. Earlier logs show `ci-local-<pid>-<epoch>-1-integration-tests`. Docker must be available
   (`docker info`); host-wide serialisation comes from the `flock` below.
4. Record the A2 integration red on a guarded base swap. Write it to `$SCRATCH/i19-a2-integration-red.sh` and run it
   with `bash` (never `source`: the `exec 9>` lock must die with the script):
   ```bash
   set -euo pipefail
   export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
   SCRATCH=/tmp/claude-1001/-home-nekoguntai-sanctuary/03f84a15-a621-4179-a832-71dcc24cbaff/scratchpad
   cd /home/nekoguntai/sanctuary-bug-scrub-20261013-i19
   docker info >/dev/null
   BASE=c8d6f035058f40a036fbb4e4f6c5da80a7745889
   F=server/src/repositories/mobilePermissionRepository.ts
   test -z "$(git status --porcelain)"
   exec 9>/home/nekoguntai/.i19-integration.lock
   flock 9
   trap 'git checkout -- "$F"' EXIT
   git show "$BASE:$F" > "$F"
   RC=0
   npm --prefix server run test:integration:db -- tests/integration/repositories/mobilePermissionAccess.test.ts \
     >"$SCRATCH/i19-a2-integration-red.txt" 2>&1 || RC=$?
   git checkout -- "$F"
   git diff --exit-code HEAD -- "$F"
   trap - EXIT
   test "$RC" -ne 0 || { echo "A2 integration case passed on base" >&2; exit 1; }
   grep -qF 'expected false to be true' "$SCRATCH/i19-a2-integration-red.txt"
   echo "A2 integration red recorded"
   ```
   A different red reason is a stop.

```bash
export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH"
set -euo pipefail
cd /home/nekoguntai/sanctuary-bug-scrub-20261013-i19
test "$(git rev-parse --abbrev-ref HEAD)" = codex/bug-scrub-loop/20261013-i19
test "$(npm --version | cut -d. -f1)" = 12
test -d node_modules
test ! -L node_modules
PINNED_LIZARD=/home/nekoguntai/sanctuary/.tmp/quality-tools/lizard-1.24.0/bin/lizard
test -x "$PINNED_LIZARD"
BASE=c8d6f035058f40a036fbb4e4f6c5da80a7745889
SCRATCH=/tmp/claude-1001/-home-nekoguntai-sanctuary/03f84a15-a621-4179-a832-71dcc24cbaff/scratchpad
SRV=""
LZ_BASE_DIR=""
cleanup() {
  if [ -n "$SRV" ]; then kill "$SRV" 2>/dev/null || true; fi
  if [ -n "$LZ_BASE_DIR" ]; then git worktree remove --force "$LZ_BASE_DIR" 2>/dev/null || true; git worktree prune; fi
}
trap cleanup EXIT
wait_for_no_coverage() {
  for _ in $(seq 1 180); do
    if ! pgrep -f '[n]ode_modules/.bin/vitest run.*--coverage' >/dev/null && ! pgrep -f '[n]ode_modules/.bin/stryker run' >/dev/null; then
      return 0
    fi
    sleep 10
  done
  echo "coverage guard: another coverage or Stryker run still active after 30 min" >&2
  return 1
}
npm run build --workspace=shared
( cd server && npx prisma generate )
( cd server && npx tsc --noEmit )
( cd server && npm run typecheck:tests )
# targeted backend: A1 (node client), A2 (mobile permissions)
( cd server && npx vitest run tests/unit/services/bitcoin tests/unit/repositories/mobilePermissionRepository.test.ts \
  tests/unit/services/mobilePermissions tests/unit/api/mobilePermissions tests/unit/services/mobileAgentDraftService.test.ts )
npm run check:safety-catch-guards
# A2 integration case against a real database (DB runner; spec already in backend-integration-groups.sh)
flock /home/nekoguntai/.i19-integration.lock npm --prefix server run test:integration:db -- tests/integration/repositories/mobilePermissionAccess.test.ts
wait_for_no_coverage || exit 1
( cd server && npx vitest run --coverage tests/unit )   # scoped to tests/unit as CI
# C1: classifier
bash tests/ci/classify-test-changes.test.sh
bash tests/ci/plan-test-run.test.sh
bash tests/ci/classify-quality-scope.test.sh
bash tests/ci/check-workflow-composition.test.sh
npx vitest run --config config/tooling/vitest.config.ts tests/ci/browserSmokeInputsClassified.test.ts \
  tests/ci/renderHarnessInputsClassified.test.ts tests/ci/vitestRepoInputsClassified.test.ts
for f in src/components/Dashboard/Dashboard.tsx src/components/send/SendTransactionPage.tsx src/hooks/useNotify.ts src/types/index.ts shared/schemas/walletResponses.ts package.json tests/e2e/render-regression/renderRegressionHarness.ts; do
  test -e "$f"

  bash -c '. scripts/ci/classify-files-lib.sh; is_browser_smoke_file "$1"' _ "$f" || { echo "C1: $f not a browser input" >&2; exit 1; }
done
# C2: offline bundle
bash tests/install/unit/offline-bundle-script.test.sh
bash tests/install/unit/offline-compose-images.test.sh
bash tests/install/unit/cleanup-containers-guard.test.sh
bash -n scripts/offline/create-bundle.sh
# pinned surfaces (D-19.X3) and scope
PINNED_SURFACES=(
  config/wallet-safety-mutation-map.json 'server/stryker*' 'config/tooling/stryker*' server/scripts/mutation
  .github/mutation-baseline.json config/wallet-sync-mutation-boundaries.json server/prisma
  config/resource-lifecycle-callsites.json scripts/verify-addresses scripts/perf shared .github/workflows .nvmrc
  server/src/services/accessControl.ts
)
test -z "$(git diff --name-only "$BASE" HEAD -- "${PINNED_SURFACES[@]}")"
npx vitest run --config config/tooling/vitest.config.ts tests/scripts/verifyAddressesGenerated.test.ts tests/scripts/verifyPsbtProvenance.test.ts
EXPECTED_FILES="$(sort <<'EOF'
docs/reference/changelog.md
docs/reference/ci-cd-strategy.md
scripts/ci/classify-files-lib.sh
scripts/offline/create-bundle.sh
server/src/repositories/mobilePermissionRepository.ts
server/src/services/bitcoin/nodeClient.ts
server/tests/integration/repositories/mobilePermissionAccess.test.ts
server/tests/unit/repositories/mobilePermissionRepository.test.ts
server/tests/unit/services/bitcoin/nodeClient.client-selection.contracts.ts
server/tests/unit/services/mobilePermissions/rowCreationDefaults.test.ts
src/api/push.ts
src/components/WalletDetail/WalletAutopilotSettings.tsx
src/components/WalletDetail/WalletAutopilotSettings/AutopilotSettingsCard.tsx
src/components/WalletDetail/WalletAutopilotSettings/useWalletAutopilotSettingsController.ts
tests/api/push.test.ts
tests/ci/browserSmokeInputsClassified.test.ts
tests/ci/classify-test-changes.test.sh
tests/components/WalletDetail/WalletAutopilotSettings.test.tsx
tests/e2e/render-regression/renderRegressionHarness.ts
tests/install/unit/offline-bundle-script.test.sh
EOF
)"
test "$(printf '%s\n' "$EXPECTED_FILES" | wc -l)" -eq 20   # C1 4, C2 2, A2 4, A1 2, B1 7, plus the changelog
ACTUAL_FILES="$(git diff --name-only "$BASE" HEAD -- . ':(exclude)tasks' ':(exclude)docs/architecture/generated' | sort)"
diff <(printf '%s\n' "$EXPECTED_FILES") <(printf '%s\n' "$ACTUAL_FILES")
# shape checks
grep -qF 'POOL_FALLBACK_RETRY_MS = 30_000' server/src/services/bitcoin/nodeClient.ts
grep -A6 'create: {' server/src/repositories/mobilePermissionRepository.ts | grep -qF 'canApproveTransaction: true'   # in the upsert create branch, not reset
grep -qF "'GET /push/devices'" tests/e2e/render-regression/renderRegressionHarness.ts
grep -qF 'src/components/*' scripts/ci/classify-files-lib.sh
for phrase in 'Full Browser E2E now runs for any change' 'bundles the images it just built again' \
  'lost mobile approve and reject for agent drafts' 'try the pool again every 30 seconds' 'can now turn Autopilot on'; do
  grep -qF "$phrase" <<<"$(tr '\n' ' ' <docs/reference/changelog.md | tr -s ' ')" || { echo "changelog missing: $phrase" >&2; exit 1; }
done
# frontend
npm run typecheck:app
npm run typecheck:tests
npm run typecheck:all
npm run typecheck:scripts
npx vitest run --config config/tooling/vitest.config.ts tests/components/WalletDetail tests/api
npm run test:run
wait_for_no_coverage || exit 1
npx vitest run --config config/tooling/vitest.config.ts --coverage   # 100% threshold
# Playwright static run (known 7 auth/login failures recorded, not gated); baselines must not change
PW_DIR="$SCRATCH/i19-playwright"
grep -qF "/home/nekoguntai/sanctuary-bug-scrub-20261013-i19/config/tooling/playwright.config.ts" "$PW_DIR/playwright.static.config.mts"
rm -f "$PW_DIR/results.json" "$PW_DIR/failing.txt" "$PW_DIR/unexpected.txt"
npm run build
if curl -fsS -o /dev/null http://127.0.0.1:4173/ 2>/dev/null; then echo "port 4173 already serving" >&2; exit 1; fi
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist >/dev/null 2>&1 &
SRV=$!
for _ in $(seq 1 30); do curl -fsS -o /dev/null http://127.0.0.1:4173/ && break; sleep 1; done
kill -0 "$SRV"
PW_RC=0
npx playwright test --config "$PW_DIR/playwright.static.config.mts" --reporter=json >"$PW_DIR/results.json" || PW_RC=$?
echo "playwright exit $PW_RC (recorded)"
kill "$SRV" 2>/dev/null || true
SRV=""
test "$(jq '.stats.expected + .stats.unexpected + .stats.flaky' "$PW_DIR/results.json")" -ge 380
jq -r '[.. | objects | select(has("specs")) | .specs[] | select(.ok == false) | .file + " :: " + .title] | .[]' "$PW_DIR/results.json" | sort -u >"$PW_DIR/failing.txt"
comm -23 "$PW_DIR/failing.txt" "$PW_DIR/known-auth-login-failures.txt" >"$PW_DIR/unexpected.txt"
test ! -s "$PW_DIR/unexpected.txt" || { cat "$PW_DIR/unexpected.txt" >&2; exit 1; }
git diff --exit-code "$BASE" HEAD -- tests/e2e/render-regression.spec.ts-snapshots
test -z "$(git status --porcelain -- tests/e2e/render-regression.spec.ts-snapshots)"
# quality gates
npm run lint
LIZARD_BIN="$PINNED_LIZARD" npm run quality:lizard 2>&1 | tee "$SCRATCH/i19-lizard.txt"
LZ_BASE_DIR="$SCRATCH/i19-lizard-base"
git worktree remove --force "$LZ_BASE_DIR" 2>/dev/null || true
git worktree prune
git worktree add -q --detach "$LZ_BASE_DIR" "$BASE"
( cd "$LZ_BASE_DIR" && LIZARD_BIN="$PINNED_LIZARD" bash scripts/quality/lizard-only.sh ) >"$SCRATCH/i19-lizard-base.txt" 2>&1
LZ_BASE_TOTAL="$(grep -c ': warning:' "$SCRATCH/i19-lizard-base.txt")"
test "$LZ_BASE_TOTAL" -gt 0
test "$(grep -c ': warning:' "$SCRATCH/i19-lizard.txt")" -le "$LZ_BASE_TOTAL"
mapfile -t LZ_CHANGED < <(git diff --name-only --diff-filter=AM "$BASE" HEAD -- '*.ts' '*.tsx')
for f in "${LZ_CHANGED[@]}"; do
  test -f "$f"
  head_n="$("$PINNED_LIZARD" -w -C 15 -T nloc=200 "$f" | grep -c ': warning:' || true)"
  base_n=0
  if [ -f "$LZ_BASE_DIR/$f" ]; then base_n="$("$PINNED_LIZARD" -w -C 15 -T nloc=200 "$LZ_BASE_DIR/$f" | grep -c ': warning:' || true)"; fi
  test "$head_n" -le "$base_n" || { echo "D-19.X4: $f warnings $base_n -> $head_n" >&2; exit 1; }
done
git worktree remove --force "$LZ_BASE_DIR"
LZ_BASE_DIR=""
node scripts/quality/check-large-files.mjs
npm run arch:check
npm run check:architecture-boundaries
npm run check:server-cycle-baseline
node scripts/ownership/check-lifecycle-callsites.mjs
npm run check:resource-ownership-contract
node scripts/ci/check-supply-chain-locks.mjs
git diff --check "$BASE" HEAD
test -z "$(git status --porcelain)"
echo "i19 verification passed"
```

## Delivery, rollback, deployment

- **The PR.** One PR on `codex/bug-scrub-loop/20261013-i19`. After the plan commits (which touch only `tasks/` and are
  excluded from the scope diff), it carries five finding commits (C1, C2, A2, A1, B1) and the integrator commit. It is
  squash-merged.
- **Merge rules.**
  - Merge through protected `main`, with no admin bypass.
  - Merges are strictly serial.
  - Poll the required contexts via `/commits/<sha>/statuses`.
  - Never pass `delete_branch_after_merge`.
  - Before deleting the branch, verify the `merge_commit_sha` is an ancestor of `main`. Then verify target-branch CI.
- **Expected CI lanes** (a missing expected lane is investigated, not assumed skipped):
  - **Test Suite**, including **Full Browser E2E**. B1 changes `src/**`, and after C1 every frontend runtime file
    selects it. Record the job IDs.
  - **Code Quality**, including ci-classifier-tests (`scripts/ci/*`).
  - **Verify Bitcoin Vectors**: `nodeClient.ts` is on the wallet-safety critical paths.
  - **Install Tests**: `scripts/offline/**`. Record the job ID.
  - **Release Candidate Validation**: `release-candidate.yml:34-52` runs on `scripts/ci/**` (C1) and
    `tests/install/**` (C2). Record the job IDs.
  - **Docker build**: `create-bundle.sh` is routed there (`docker-build.yml:49`, `classify-docker-build-images.sh:121`).
  - **Architecture** is not PR-required: watch its post-merge run.
- **CI triage is infrastructure first** (CLAUDE.md). The first suspect for a sora-only timeout is sora contention
  (several mutation or emulator jobs at once). After that:
  - Podman archive stalls (runner-infra #34);
  - the npm advisory endpoint;
  - DIND;
  - a stranded e2e runner lock;
  - kumo's native builder.
- **Retriggers** carry the four-part evidence.
- **PR-body flags:**
  - C1: user decision and the CI cost (Full Browser E2E on every `src/**` or `shared/**` change; the root package
    files were already full-scan triggers); `src/types` included.
  - C2: alias on save; the installed bundle shape is unchanged; the post-save image-ID check; build mode re-points
    the daemon's `:local` tags; the stub-only residual.
  - A2: existing rows are not repaired (including rows from the `20260317000000` migration), and how to restore them.
  - A1: 30-second pool retry with a single claimed retry, and the shared fallback is never re-verified or
    disconnected; the fallback-host policy follow-up.
  - B1: the escalation; fails open; the e2e mock entry.
  - "No migration, no new endpoint, no workflow edit, no version bump."
- **Rollback.** Code, test and docs only, with no stored-shape change; each commit reverts independently. Reverting A2
  makes new rows store `false` again, but rows created meanwhile keep `true`.
- **Deployment.** None until clean closeout (`--deploy final`).

## Completion criteria

- [ ] Every failing-first test fails on `c8d6f035058f` code for its stated reason and passes on the PR head. The
  guard cases (A1 "within window" and "reset") are recorded as guards.
- [ ] The Verification block runs as written on the integrated branch, with exit 0 recorded. This includes:
  - backend coverage (`tests/unit`) and frontend coverage at 100%;
  - the A2 integration case on a real database;
  - lizard not above the base, with no per-file growth;
  - the 20-file scope diff and the empty pinned-surface diff;
  - `arch:check`;
  - the Playwright static run with baselines unchanged and no new unhandled-request failures.
- [ ] `/simplify` and an adversarial implementation review run on the integrated diff, and their findings are fixed or
  recorded.
- [ ] PR head CI is green, with run and job IDs recorded, including Full Browser E2E, Install Tests and
  verify-vectors.
- [ ] The PR is merged, required contexts are green, target-branch CI is green on the merge commit, ancestry is
  verified, and branches and worktrees are cleaned.
- [ ] Run state: the five findings are resolved. The follow-up P3s `node-client--pool-fallback-uses-public-default-host`
  and `ci-classifier--render-lane-omits-src-types-runtime` are backlog.
- [ ] The P3 backlog stays outside the blocking fix set.

## Review log

- Draft assembled 2026-10-30 from the five prototypes (source `c8d6f035058f`). All patches apply cleanly together.
  - Coordinator decisions: D-19.C1a (classify the shared render harness as a browser input instead of exempting it),
    D-19.B1a (no layout change), D-19.B1b (e2e map sweep).
  - User decision on C1 applied.
- **Pass 1 (2026-10-30): three reviewers (A phases; B/C phases; the whole plan).**
  - A1:
    - one claimed pool retry, so concurrent callers keep the fallback (D-19.A1a);
    - the shared fallback is never re-verified or disconnected on a retry (D-19.A1b);
    - two new red tests;
    - corrected citations and lizard notes; the reset test labelled a guard.
  - A2:
    - accurate effect wording (manage-policies is only reported);
    - the migration-default scope;
    - the side-effect assertion and schema-pointer comment;
    - the integration red on a guarded base swap.
  - C1:
    - `src/types/*` included (it holds runtime code);
    - the cost statement corrected (the root package files were already full-scan triggers);
    - verification loop paths that exist;
    - the harness assertion;
    - the `ci-cd-strategy.md` update (scope 20);
    - changelog under Fixed.
  - B1: keep `space-y-4` (no baseline shows the card).
  - C2: post-save image-ID check (D-19.C2a), and the `:local` re-pointing stated.
  - Whole plan:
    - Release Candidate Validation and Docker build lanes;
    - integration-DB leftover check and `flock`;
    - architecture regeneration step;
    - patch figures;
    - deferred-P3 list.
  - Rejected: none.
- **Pass 2 (2026-10-30): two reviewers (pass-1 changed areas, tried in copies of the prototypes; full read).**
  - A1:
    - the exact re-verify skip rule;
    - the A1b test reworded so it is red on base, with no queued verify rejection;
    - mock-reset hygiene for every new test, because queued `*Once` values leaked between tests;
    - "passes on base when run alone" restored;
    - red expectations for the review-pass cases.
  - A2:
    - accurate `hasSelfRestrictions`/`hasCustomRestrictions` citations;
    - the base-swap script made self-contained (`set -euo pipefail`, PATH, SCRATCH, `cd`, `docker info`, enforced
      RC, run with `bash`);
    - the shape check anchored to the create branch;
    - the changelog check phrase aligned.
  - C2:
    - the D-19.C2a check normalises the real archive layouts (`<hex>.json` and `blobs/sha256/<hex>`);
    - the fake writes a real config name;
    - a `blobs` case;
    - fail on the containerd store (by construction; see pass 3);
    - the suite count is no longer pinned to 34.
  - Verification: the leftover-DB check is dropped, because each coordinated run gets a fresh project; `flock` is
    kept.
  - Confirmed: the C1 `src/types` inclusion and empty exemptions (8/8 drift guards pass in a trial).
  - Rejected: none.
- **Pass 3 (2026-10-30): one full-plan reviewer.**
  - Applied:
    - C2 containerd handling: no `docker info` probe (it would break the fake). The comparison fails by construction,
      and the message names the store.
    - A1a expected count: the pool getter is called 2 times in total (the trial red on base: "expected 2 times, got
      1").
  - Confirmed:
    - the jq expression runs as written (passes `<hex>.json` and `blobs/sha256/<hex>`, rejects others);
    - mock hygiene: 62/62 in a trial;
    - the skip rule, the A2 base-swap script and the 20-file scope.
  - Rejected: none.
- **Pass 4 (2026-10-30): one independent full-plan reviewer**, who applied all five prototypes plus the plan-only
  changes to a copy and ran every suite and gate green.
  - No blocking or medium comments.
  - Applied one low-severity citation fix: the fake `docker save` is at `:303` at base, and the apply-side `:158`
    must not change.
  - Rejected: none.
- **Pass 5 (2026-10-30): one independent full-plan reviewer — clean, review converged.** No verified actionable
  comments. It re-checked the paths, citations, C1 callers and harness imports, the A2 integration invocation, lizard, the CI
  lanes, the pinned surfaces and the B1 mock map.
