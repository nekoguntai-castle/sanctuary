# Changelog

All notable changes to Sanctuary are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

## [0.8.75] - 2026-09-25

### Changed

- The wallet list's balance period (1D/1W/1M/1Y/All) now also drives every
  wallet card's sparkline, and is remembered with the list's other view
  settings.
- The LLM egress proxy admits the private LAN IP endpoint an admin saves in AI
  Settings (and one they run detection against) without an
  `LLM_EGRESS_PROXY_ALLOWED_CIDRS` entry. Only that exact address and port are
  admitted, never loopback or cloud metadata, and saving a new endpoint revokes
  the previous one; hostnames and the existing allowlists are unchanged.
- Install and upgrade no longer print the `ENCRYPTION_KEY` and
  `ENCRYPTION_SALT` values, because that output is kept in log files and
  shared when asking for help. The backup reminder names both secrets and
  points to the runtime env file that holds them.

### Fixed

- Plot the Total Balance charts and wallet sparklines against real time in the
  reader's timezone, with hours, weekdays, dates or months on the axis for the
  selected period, instead of evenly spacing only the periods that had
  transactions.
- Show every bitcoin amount in the BTC/sats unit you selected. The Wallets page
  balance chart tooltip showed a raw sats integer. The dashboard gain/loss line,
  transaction-flow and draft fees, the block visualizer's pending-transaction
  card, AI filter totals, and the Autopilot UTXO health card always used sats
  (or switched by size), and transaction and balance notifications always used
  BTC. Fee rates stay in sat/vB; fee estimates and sats-denominated settings
  such as agent spend limits and the dust threshold stay in sats.
- The gateway finishes delivering push notifications for events it had already
  accepted before it shuts down or restarts, instead of dropping them.

### Upgrade validation

- No database migration, Compose or service-topology change, or new required
  runtime environment variable is added. The balance-history response gains a
  per-point `timestamp`; the new `viewSettings.wallets.timeframe` preference is
  optional and falls back to 1M when absent. Existing application-data and
  browser-authentication fixtures cover the affected upgrade surfaces. The
  release requires the `latest-stable` and `n-2` upgrade lanes and both
  wallet-sync persistence replay shapes before candidate acceptance.

## [0.8.74] - 2026-09-22

### Changed

- Separate Prisma migration tooling from application images and update runtime,
  monitoring, signing-verifier, and development dependencies.

### Fixed

- Reconcile wallet and device access after ownership transfers, enforce group
  membership and direct-role precedence, and apply consistent access checks to
  mobile clients, imports, and Telegram notifications.
- Prevent stale authentication, network, model-discovery, sharing-search, and
  hardware-wallet responses from overwriting a newer session or selection.
- Enforce replacement-transaction fee requirements, exclude replaced transactions
  from live accounting, and export transactions using their effective UTC date.
- Restore gateway transaction push delivery and drain database health checks,
  HTTP connections, and worker checkpoints during shutdown.
- Isolate monitoring upgrade fixture ports and correct owned-source canary image
  registration and verifier shutdown handling.
- Reconcile offline-to-online installation mode during source upgrades and keep
  failed container startup retryable until the selected services are healthy.

### Upgrade validation

- No database migration or new required runtime environment variable is added.
  Existing application-data, browser-authentication, legacy-environment, and
  optional-profile fixtures cover the affected upgrade surfaces. The release
  requires the `latest-stable` and `n-2` upgrade lanes and both wallet-sync
  persistence replay shapes before candidate acceptance.

## [0.8.73] - 2026-09-18

The only upgrade-path-relevant change since v0.8.72 is the Grafana volume
identity fix below: this release adds no Prisma migration, no Compose or
service-topology change, and no new runtime environment variable. That fix is
covered by the monitoring-enabled `optional-profiles` upgrade fixture, by new
`tests/install/unit/grafana-quiescence.test.sh` cases, and by the
`optional-owned-source` canary lane added here.

### Added

- A non-blocking `optional-owned-source` upgrade lane that runs the Tor,
  monitoring and MCP fixture against an ownership-aware source, restoring the
  coverage that pinning `optional-profiles` to v0.8.69 had removed.
- `scripts/bump-funds-critical.sh`, which performs the coordinated bump of a
  package pinned in `config/ci-toolchain-lock.json` across every manifest and
  lockfile that file names, and a Renovate dashboard-approval gate so those
  packages stop producing pull requests that cannot pass.
- A dedicated `sanctuary-ci-playwright` job image, so the browser and render
  E2E lanes start with Chromium already present instead of downloading it on
  every run.

### Changed

- The hardware-wallet compatibility statement pins only the resolved signing
  and hardware-wallet dependencies named in
  `config/signing-dependency-scope.json` rather than the whole lockfile, so an
  unrelated dependency change no longer invalidates it.
- `bitcoinjs-lib` 7.0.2 and `ecpair` 3.0.2 across the application and both
  verifier trees, with the address and PSBT vectors regenerated and their
  vector data byte-identical.
- `@playwright/test` 1.63 and routine backend, frontend and tooling dependency
  updates; `hono`, `qs`, `vitest` and the docs-site overrides move for
  published advisories.

### Fixed

#### Upgrade and operations

- The Grafana volume identity schema accepts any canonical millisecond
  timestamp instead of only `.000Z`, matching the ownership contract in
  `scripts/ownership/validation.mjs`. The stricter form made the credential
  migration reject the volume it had just created whenever the creation
  timestamp carried real milliseconds, which is what an ownership-aware
  monitoring upgrade produces.
- Exact image retirement gives the removal its own budget, so a slow
  multi-gigabyte image removal can no longer fail a job whose tests passed.
- An operator recovery run that halts after a success is labelled partial
  rather than complete.

#### Devices and hardware wallets

- Keystone account purpose and script type are derived from the parsed
  derivation path components, and an imported account's script type comes from
  the parsed path rather than a default.
- Disclosing or merging a device by fingerprint requires access to an existing
  device first.

#### Wallets and transactions

- A wallet's own output addresses are marked used when a transaction is
  persisted, so change and receive addresses are not handed out twice.
- Assistant balance-history buckets are summed as bigint instead of
  concatenating Decimal strings.

#### Access control

- Group-granted approver roles appear in the pending approvals list.
- Vault-policy usage reservations already taken are released when a later
  reservation call throws.

#### Notifications, console and account

- App notifications are cleared on terminal logout.
- Console turn results are applied only to the session they were sent from.
- The shared 2FA password field is cleared when backup-code regeneration
  completes.

#### Webhooks and MCP

- The webhook retry backoff multiplier is floored at 1.
- The MCP operation metric label is bounded to registered operations, and the
  audited MCP operation string is bounded before it reaches audit records, logs
  and metrics.

## [0.8.72] - 2026-09-16

No upgrade-path-relevant changes since v0.8.71: this release adds no Prisma
migration, no Compose or service-topology change, and no new runtime
environment variable. The TOTP single-use fix below is covered by the existing
upgrade browser-smoke and 2FA preservation assertions.

### Added

- Track the release-candidate canary drivers in `scripts/release/canary/`. They
  previously existed only on the deployment host, so the probe's activation
  timeout could not be reviewed, tested or diffed.
- Track the ownership TOTP step-guard test in the lifecycle callsite inventory,
  and refuse non-test database targets at every integration-DB entry point.

### Changed

- Pin `uint8array-tools` 0.0.10 so Node-side transaction parsing is linear, and
  preflight hex raw-transaction weight before handing it to bitcoinjs.
- Bound the HTTP metrics path label so unbounded request paths cannot grow the
  Prometheus label set.
- Gate `.tsx` files in the lizard complexity check.

### Fixed

#### Sending, RBF, CPFP and batching

- RBF drafts are change-aware end to end, derive replacement linkage from a
  structured `replacesTxid` instead of the memo, guard that linkage with a
  compare-and-swap, and refuse a replacement whose fee does not exceed the
  original.
- CPFP resolves the parent output and destination server-side, and batch and
  CPFP transactions honour frozen and draft-locked UTXOs, spend the whole
  pinned UTXO set, and respect the confirmation threshold.
- RBF, CPFP and batch user-input failures (recipient addresses, integer
  amounts, change adjustment) map to 400/404 responses instead of 500s.
- `psbt/create` validates the recipient address, hex PSBT imports check the
  magic and reject odd-length hex, decoy change never emits sub-dust outputs,
  and pending fee rates are computed from virtual size.
- Send-max and subtract-fees honour the confirmation and draft-lock
  spendability filters; the broadcast has its own operation lease, locks the
  signing controls while in flight, always reports and refreshes after a
  server-accepted broadcast, and gets the transaction-broadcast timeout.
- A signing attempt always releases the USB transport it opened, QR signing
  surfaces a PSBT combine failure instead of dropping collected signatures, and
  the send flow ignores superseded review-address and privacy-analysis
  responses and keeps the scanning output index aligned when an earlier output
  is removed.

#### Vault policy and approvals

- Spending-limit and velocity usage is reserved atomically before broadcast,
  RBF replacements reserve only the incremental usage, and reservations are
  released when a broadcast is rejected before reaching the network.
- Enforce-mode time-delay policies fail closed and are no longer treated as
  approval quorums; specific-quorum requests resolve against the live policy
  threshold and enforce specific-approver and all-quorum membership.
- Approval requests resolve only while still pending, and the draft status is
  derived correctly after an owner override.

#### Wallet sync, Electrum and UTXOs

- Sync never un-spends a locally spent UTXO on a listing alone, confirmation
  refresh never rewrites spent state, restores are guarded and traced in the
  release replay driver, and the confirmation-refresh lock is held until a
  timed-out writer settles.
- Electrum re-arms reconnect when resubscribe fails after a successful connect,
  destroys a socket that connects after its attempt settled, lets
  `disconnect()` cancel an in-flight connect, treats a non-positive
  `estimatefee` as no estimate, and leaves invalid `listunspent` batch items
  absent instead of empty.
- Destructive wallet and network resyncs and balance recalculation require edit
  access; sync results and spinners are scoped to the requested network.

#### Hardware wallets

- Trezor and generic hardware-wallet connects are generation-guarded so a
  stale connect cannot resurrect a disconnected device, in-flight connects are
  cancelled on disconnect, adapter handles are released on failure, and Trezor
  derives the coin from the BIP44 coin type instead of a path substring.
- Device import reports a total failure when no parsed account could be added.

#### Notifications, webhooks and push

- Telegram draft and AI-insight notifications report real per-send outcomes,
  per-channel delivery failures are recorded when other channels succeed, and
  push lookup and provider failures are reported instead of full success.
- Webhooks compare `minAmountSats` against the transaction magnitude, retire
  outstanding deliveries when an endpoint is repointed, and guard replay resets
  against in-flight attempts.
- Dead-letter entries that are oversized are truncated instead of dropped, and
  tombstone-suppressed writes are reported with tombstones cleared on fresh
  failures.
- Mobile push registration accepts a null `deviceName` and bounds its length.

#### Authentication, admin and settings

- A TOTP code is single-use via a `RevokedToken` marker, with no migration.
- The React Query cache is cleared on every logout path, and the wallet access
  cache is invalidated after an ownership transfer.
- Backup validate/restore authenticates before parsing the 200 MB body, a
  legacy backup that would restore nothing is rejected, and the backup-complete
  reminder shows after a backup and clears on dismiss.
- Deleting a user who is the sole member of a wallet is refused; the
  UsersGroups create-user form resets and group creation is single-flight.
- Node config saves keep the stored proxy password when the masked value is
  submitted; autopilot and Telegram PATCH bodies merge onto the stored settings
  inside the atomic preferences update; a failed preference save is reported.
- Autopilot surfaces a settings load failure instead of writing back defaults.
- Labels enforce the shared length bounds and nullable description on the
  backend schemas.

#### Frontend state scoping

- Draft lists, pending transfers, AI label suggestions, wallet webhooks, wallet
  Telegram saves, session transcripts, and the LabelManager draft are scoped to
  the mounted wallet, resource, or session, so a stale response can no longer
  land on a different one.
- Draft deletes apply against the current list, the create-label mutation
  resets when the form is cancelled, the operation error clears on retry, and
  transaction filters reset when the wallet changes.
- A superseded wallet refresh is a no-op instead of a failure, only the latest
  price refresh response is applied, UTXO stats load once per wallet on the
  Stats tab, and captured device-list, AI-toggle and label-create errors are
  rendered.
- The create-wallet wizard re-clamps the quorum to the selected signers and
  gates review on a valid pair; the network card surfaces server
  add/update/delete/toggle/reorder failures.
- WebSocket reconnect backoff resets only after a stable connection, so it
  survives accept-then-close.

#### Backend and infrastructure

- The worker initialises the encryption key before registering jobs.
- Route-specific body parsers match paths with a trailing slash or case
  variant; legacy testnet is normalised inside `getStatus`; the UTXO route uses
  the shared confirmation-threshold default; telemetry consumers and block
  explorers honour the active network identity.
- Maintenance applies the VACUUM statement timeout PostgreSQL accepts and pins
  it to one connection, restoring the configured default afterwards.
- The gateway bounds the mobile permission check with the backend request
  timeout.
- Symlinked ESM CLIs detect direct execution by resolved path instead of
  silently no-oping, and the backup script keeps the operator project identity
  under the cleanup coordinator.
- CI: renamed files are classified by their old path, coverage shard retries
  survive a crashed attempt's partial report directory, the compose e2e subject
  waits for the migration container, the install-test summary fails when any
  job failed on non-release runs, and the upgrade e2e waits for a fresh TOTP
  step before minting the next 2FA code.
- Correct the v0.8.71 changelog heading date to the date its tag was created.

## [0.8.71] - 2026-09-09

### Added

- Added an opt-in `io.runner-infra.owner-container` label to every Compose
  resource group so the runner-infra host reaper can reclaim a CI stack within
  minutes of its job container disappearing. The value is empty outside CI, so
  operator installs are never labelled and need no new environment variable.
- Added durable CI progress reporting and exact-commit status emission, shared
  subject deadlines that reserve finalization time, and a nightly (03:07 UTC)
  release-candidate validation of `main`'s head.
- Added `tests/ci/npmOverridesApplied.test.ts`, which reads resolved versions
  from every lockfile rather than the manifests, so a dead or drifting npm
  override pin fails closed instead of silently enforcing nothing.
- Documented the runner fleet and its per-host builder divergence in
  `docs/reference/ci-cd-strategy.md`.

### Changed

- The monitoring-disabled banner now points operators at `./start.sh
  --with-monitoring` instead of a raw multi-file Compose invocation.
- Release-surface pull requests now run the install stack smoke and upgrade
  baseline core lanes, and `USE_FRESH_INSTALL_STACK_COVERAGE` requires fresh
  install to have actually run so the smoke lane cannot report a false green.
- Subject-managed cleanup lanes install fresh so they build against the layer
  cache, and an ownership-aware source release now upgrades in place under
  coordinated cleanup.
- The Claude Code hook scripts are untracked as per-machine tooling; they were
  wired only from an already-ignored settings file and ship in no artifact.

### Security

- Fixed a remote denial of service in Nodemailer's `addressparser`, where a
  crafted address list triggers quadratic (O(n^2)) parsing
  (GHSA-2x7j-588g-ccc2, high). The server dependency moves to 9.1.1.
- Pinned the docs site's `js-yaml` to 3.15.2, where `maxTotalMergeKeys` failed
  to bound CPU use for empty merge sources (GHSA-2883-xcg3-v3hh, high), and
  added an exact `svgo` 3.3.5 pin for a `removeScripts` bypass that let
  executable links through via namespace and control-character tricks
  (GHSA-w27v-7q3p-w38r, high). Both are build-time-only documentation
  dependencies, and both were fixed rather than waived.

### Fixed

- Fixed `deepmerge-ts` stack exhaustion (GHSA-ggr8-5vv4-36mx, CWE-674) by
  pinning 8.0.2 through root overrides and dropping the upstream-blocked
  waiver, and forced `toml@4.2.0` the same way, retiring both of its waivers.
  Inert `overrides` blocks in the `server/` and `gateway/` manifests, which
  npm never honoured, are removed.
- Fixed the Trezor emulator proof exporting an empty bridge host: the CI image
  ships jq 1.6, where `jq -e` exits 0 on an empty file, so the readiness probe
  passed against an unwritten document. The resolver now fails closed on a
  missing or implausible host or port, and the forwarder is always torn down,
  including from the `EXIT` trap.
- Fixed the install-test lane rebuilding the backend image when it only needed
  to recreate the container, and preserved bounded preflight observation
  outcomes rather than discarding them.
- Fixed release promotion rejecting lightweight RC tags, and dated the v0.8.70
  changelog entry from its tag.

## [0.8.70] - 2026-09-05

### Added

- Added immutable deployment generations, canonical mutation locking, signed
  producer registrations, and application lifecycle authority references.
- Added a signed operator lost-authority recovery path with exact cleanup
  receipts and closeout for orphaned CI stacks.
- Added an additive `operational` projection to `GET /api/v1/bitcoin/status`:
  configured mode, the transport that actually answered (pool, singleton, or
  singleton fallback with a bounded reason), the observed route server, and
  freshness-aware per-server availability with failover primary/preferred/next
  roles.

### Changed

- Routed setup, start, stop, upgrade backup, and offline apply through retained
  Compose definitions and stamped Compose/OCI resources with ownership metadata.
- Failover-only Electrum pools now route requests to the highest-priority
  eligible server instead of the first idle socket, with deterministic
  `(priority, id)` ordering and primary failback without a pool restart.
- Redesigned the dashboard Node Status card around the operational projection:
  mode-specific headlines, a strategy badge, honest pool-fallback and
  unknown-health states, a `Last known` treatment for stale data, and an
  accessible server disclosure with text role and availability.

### Fixed

- Connectivity failures on the status endpoint now return the selected network,
  configured mode, and topology instead of a bare error envelope.
- The Node Status card no longer presents socket lease counts as server health
  or shows a previous network's servers after a network switch.

## [0.8.69] - 2026-08-30

### Added

- Whole-pipeline wallet-sync phase progress, active-stage age metrics, and
  request-negotiated worker diagnostics v2 while preserving diagnostics v1.
- Wallet-sync execution panels and alerts, live stage timing in the Log tab, and
  privacy-safe incident evidence for generation, lease, and worker state.

### Changed

- Made the default MCP-disabled launcher and release rebuild gate fail closed.
- Established one immutable-tag release recovery policy and an affected-fleet
  release-candidate canary contract for v0.8.69.

### Fixed

- Bounded wallet-sync remote work, cancellation, recursion, and fallback paths
  delivered by PRs #949, #950, and #951.
- Preserved causal ordering for equal-millisecond wallet-sync progress events
  across mixed worker versions.

## [0.8.68] - 2026-08-26

### Changed

- Prepared the v0.8.68 release from the accepted v0.8.67 baseline.

## [0.8.67] - 2026-08-26

### Added

- Added bounded cross-network wallet-sync recovery and retired the legacy stale-wallet scheduler.

### Fixed

- Coordinated frontend refresh and CSRF recovery, repaired MCP health probes, and updated monitoring and security dependencies.

## [0.8.66] - 2026-08-21

### Changed

- Unified the wallet-sync lifecycle, persistence, publication, retry ladder, and diagnostic contracts.
- Made static quality gates and architecture-boundary ratchets reflect the work they actually execute.

## [0.8.65] - 2026-08-20

### Added

- Added transaction sub-tabs, detachable panels, and clearer wallet-sync failure presentation.

### Changed

- Suspended the single-maintainer wallet-safety human-attestation gate while retaining automated evidence.

## [0.8.64] - 2026-08-19

### Fixed

- Restored sync for legacy wallets, enforced live WebSocket authorization, and hardened approval persistence.
- Corrected release evidence, Grafana migration settling, and install cleanup behavior.

## [0.8.63] - 2026-08-13

### Added

- Added hardware-wallet conformance and authenticated wallet-safety evidence for Ledger, Trezor, Jade, and Taproot flows.

### Fixed

- Corrected release-evidence builds and Tor configuration paths in upgrade tests.

## [0.8.62] - 2026-08-08

### Added

- Added strict frontend validation for wallet, UTXO, signing, fee, price, xpub, and RBF API responses.

### Fixed

- Made dashboard request failures visible instead of presenting them as empty data.

## [0.8.61] - 2026-08-07

### Fixed

- Made failed or stale backups externally visible and hardened send-fee and dashboard fee-rate handling.
- Isolated install lanes, migration waits, release notes, and runner-lock evidence.

## [0.8.60] - 2026-08-06

### Changed

- Made CI shell inventories self-checking and registered previously orphaned test suites.

### Fixed

- Removed the unusable Promtail host-log mount and hardened monitoring, diagnostics, and address-verification CI.

## [0.8.59] - 2026-08-05

### Added

- Reworked the dashboard layout, activity pagination, and BTC balance movement display.

### Fixed

- Corrected monitoring configuration seeding and strengthened package-compromise and AES-GCM validation.

## [0.8.58] - 2026-08-02

### Added

- Added privacy-safe notification diagnostics and single-incident support evidence.

### Fixed

- Restored candidate, upgrade, offline-upgrade, and isolated release build behavior.

## [0.8.57] - 2026-07-30

### Changed

- Made Forgejo the CI authority and GitHub the passive public mirror and operator-owned distribution endpoint.

### Fixed

- Hardened worker lock-loss termination, scheduling, webhook retries, migrations, transfers, backups, and outbound request bounds.

## [0.8.56] - 2026-06-07

### Added

- Added keyboard and dialog accessibility across dashboards, tables, charts, modals, and UTXO selection.

### Changed

- Converged shared transaction, draft, and vault-policy request schemas.

## [0.8.55] - 2026-05-27

### Added

- Added Silent Payments Electrum readiness infrastructure and wallet webhook notifications.

### Fixed

- Hardened remote LLM provider connectivity, persistent settings, and Codeberg tag refresh during upgrades.

## [0.8.54] - 2026-05-16

### Changed

- Completed quality, dependency-advisory, architecture, and hardware-readiness remediation.

### Fixed

- Corrected the release target after the prerelease preparation selected the wrong version line.

## [0.8.53] - 2026-05-13

### Changed

- Moved the prebuilt image path to Codeberg Packages and removed obsolete GitHub-only release workflows.

### Fixed

- Repaired fresh-install migrations, worker startup, release CI diagnostics, and image publication reliability.

## [0.8.52] - 2026-05-08

### Added

- Added blocking-I/O quality enforcement and reliability documentation.

### Changed

- Consolidated release-candidate upgrade evidence under the install-test owner and improved CI isolation.

## [0.8.50] - 2026-05-02

### Added

- Added signed offline-release bundle infrastructure and Codeberg installer fallback.

### Changed

- Removed the GitLab mirror and unused privacy-mixing references.

## [0.8.49] - 2026-05-02

### Added

- Added testnet and signet wallet workflows and a sidebar network selector.

### Fixed

- Hardened wallet addresses, derivation evidence, and PSBT safety verification.

## [0.8.48] - 2026-04-30

### Changed

- Published a version-only follow-up to v0.8.47.

## [0.8.47] - 2026-04-30

### Added

- Added requester-scoped agent-wallet setup and database-backed price-provider controls.

### Fixed

- Hardened decoy randomness, wallet references, derivation paths, transaction intent limits, and BullMQ job identifiers.

## [0.8.46] - 2026-04-28

### Added

- Added local AI providers and automatic Sanctuary Console context.

### Fixed

- Corrected Console transaction planning and expanded local-provider regression coverage.

## [0.8.45] - 2026-04-27

### Added

- Added the Sanctuary Console, AI provider credential boundary, MCP access controls, and assistant read tools.

### Changed

- Reduced complexity across transaction sync, signing, configuration, and UI flows while restoring exact quality gates.

## [0.8.44] - 2026-04-25

### Changed

- Unified notification worker delivery and parallelized browser, backend, and coverage CI lanes.

### Fixed

- Hardened privacy-score rendering, test semantics, and integration-suite ownership.

## [0.8.43] - 2026-04-24

### Fixed

- Restored Ledger xpub fetch flow
- Hardened 2FA upgrade release gate

### Changed

- Path-aware CI security and test scopes
- Skipped repo-quality workflow on workflow-only changes
- Cancelled superseded release-candidate CI runs
- Cleaned up CI duration reporting output

## [0.8.34] - 2026-04-15

### Changed

- Extracted admin Electrum server service from route layer
- Continued architecture cleanup: route-to-repository boundary enforcement reduced to 44 exceptions

### Fixed

- Allowed disabling worker-heartbeat startup gate for server-only runs
- Fixed install test SSL directory export for fresh installs

## [0.8.33] - 2026-04-14

### Fixed

- Migrated install e2e auth-flow scripts to Phase 6 cookie auth
- Propagated CSRF token correctly out of subshell in install tests

## [0.8.32] - 2026-04-14

### Fixed

- Lowered JS bundle size threshold to account for nginx gzip
- Synced ai-proxy lockfile with package.json dependencies
- Resolved flaky Layout test teardown race condition

## [0.8.31] - 2026-04-13

### Added

- Support bundle container diagnostics collector

### Fixed

- Prevented syncInProgress flag from getting permanently stuck
- Added dumb-init to gateway to prevent zombie process accumulation

## [0.8.30] - 2026-04-13

### Changed

- Refreshed README and install documentation
- Extracted shared `isConsolidation` utility and `useWalletLabels` hook

### Fixed

- Prevented memory exhaustion during transaction field population

## [0.8.29] - 2026-04-12

### Fixed

- Resolved BullMQ ConnectionOptions type errors in workerSyncQueue
- Achieved coverage thresholds for CI across frontend and backend

## [0.8.28] - 2026-04-12

### Fixed

- Restored legacy 2FA verification compatibility

## [0.8.27] - 2026-04-11

### Fixed

- Restored 2FA clock drift tolerance lost in otplib v13 migration

## [0.8.26] - 2026-04-10

### Fixed

- Bumped jsdom to 29.0.2
- Synced lockfiles for alpine npm ci in GitHub Actions

## [0.8.25] - 2026-04-09

### Fixed

- Corrected Prisma 7 seed.js path and Docker stage inclusion
- Fixed E2E import validation error selector

## [0.8.24] - 2026-04-08

### Changed

- Comprehensive technical debt cleanup across codebase

### Fixed

- Updated Zod v4 enum errorMap to message parameter in gateway

## [0.8.23] - 2026-04-07

### Changed

- Modernized typography: dropped serif italic, adopted General Sans medium

### Fixed

- Invalidated access cache for group members on group deletion
- Fixed CI integration test database configuration

## [0.8.22] - 2026-04-06

### Changed

- Closed backend coverage gaps for intelligence, notifications, and middleware

## [0.8.21] - 2026-04-05

### Changed

- Modernized UI with tighter radii, refined buttons, and segmented network tabs

### Fixed

- Resolved "no receive address" for wallets with many unused change addresses

## [0.8.20] - 2026-04-04

### Changed

- Covered sparkline edge cases and multisig branch for 100% coverage

## [0.8.19] - 2026-04-03

### Changed

- Extracted fetchUnusedAddresses callback and simplified effect

## [0.8.18] - 2026-04-02

### Changed

- Upgraded Docker actions to Node.js 24 versions

### Fixed

- Added REDIS_PASSWORD and AI_CONFIG_SECRET to CI and install workflows

## [0.8.17] - 2026-04-01

### Added

- Elevated login page with animations, effects, and micro-interactions

### Fixed

- Improved rate limit messages and reworked login gradient animation

## [0.8.16] - 2026-03-31

### Added

- AI Settings page gated behind aiAssistant feature flag

### Fixed

- Added missing migration for feature_flags tables

## [0.8.15] - 2026-03-30

### Fixed

- Resolved dashboard UI bugs: tooltip clipping, missing 24h price change, card border consistency

## [0.8.14] - 2026-03-29

### Added

- 20 premium UI enhancements for distinctive look and feel

### Changed

- Expanded test coverage with gateway unit tests and E2E user journeys

## [0.8.13] - 2026-03-28

### Fixed

- Standardized UI patterns across all admin components
- Repaired 3 pre-existing test failures in CI

## [0.8.12] - 2026-03-27

### Added

- Feature-flag key validation, runtime toggle coverage, and edge case tests
- Render regression visual baselines and PR gate

### Changed

- Deduplicated feature-flag key validation and shared constants

## [0.8.11] - 2026-03-26

### Added

- Treasury Autopilot frontend settings UI

### Changed

- Raised server test coverage thresholds to 99%, restored 100% frontend coverage

## [0.8.10] - 2026-03-25

### Added

- Treasury Autopilot Phase 1: fee monitoring and consolidation notifications

### Changed

- Closed coverage gaps across server and gateway

## [0.8.9] - 2026-03-24

### Fixed

- Live-refresh recent activity and show transaction lock state on dashboard
- Fixed worker readiness probes and compose health checks

## [0.8.8] - 2026-03-23

### Fixed

- Corrected rate limit env var names in docker-compose and auth flow tests
- Prevented `set -e` from exiting early during optional feature and prerequisite checks

## [0.8.7] - 2026-03-22

### Fixed

- Flaky UserContext theme test isolation

## [0.8.6] - 2026-03-21

### Fixed

- Moved nodemailer to production dependencies for Docker builds

## [0.8.5] - 2026-03-20

### Changed

- Refactored ConnectDevice, SendTransactionPage, and DeviceSharing into modular architecture
- Adopted `useLoadingState` hook across components

## [0.8.4] - 2026-03-19

### Fixed

- Fixed install tests for setup.sh refactoring

## [0.8.3] - 2026-03-18

### Fixed

- Handled docker compose build race condition errors gracefully
- setup.sh now handles SSL and startup

## [0.8.2] - 2026-03-17

### Fixed

- Fixed gateway whitelist to use full path including baseUrl
- Fixed TLS_ENABLED warning and docker-compose build for fresh clones

## [0.8.1] - 2026-03-16

### Fixed

- Added migration for lastSyncedBlockHeight column

## [0.8.0] - 2026-03-15

### Added

- Worker architecture: dedicated background worker for sync, subscriptions, and blockchain operations
- Block height tracking and pagination for large deployments

### Changed

- Removed navigation-triggered syncs in favor of worker-driven sync

[Unreleased]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.75...HEAD
[0.8.75]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.74...v0.8.75
[0.8.74]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.73...v0.8.74
[0.8.73]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.72...v0.8.73
[0.8.72]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.71...v0.8.72
[0.8.71]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.70...v0.8.71
[0.8.70]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.69...v0.8.70
[0.8.69]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.68...v0.8.69
[0.8.68]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.67...v0.8.68
[0.8.67]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.66...v0.8.67
[0.8.66]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.65...v0.8.66
[0.8.65]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.64...v0.8.65
[0.8.64]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.63...v0.8.64
[0.8.63]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.62...v0.8.63
[0.8.62]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.61...v0.8.62
[0.8.61]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.60...v0.8.61
[0.8.60]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.59...v0.8.60
[0.8.59]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.58...v0.8.59
[0.8.58]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.57...v0.8.58
[0.8.57]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.56...v0.8.57
[0.8.56]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.55...v0.8.56
[0.8.55]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.54...v0.8.55
[0.8.54]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.53...v0.8.54
[0.8.53]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.52...v0.8.53
[0.8.52]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.50...v0.8.52
[0.8.50]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.49...v0.8.50
[0.8.49]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.48...v0.8.49
[0.8.48]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.47...v0.8.48
[0.8.47]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.46...v0.8.47
[0.8.46]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.45...v0.8.46
[0.8.45]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.44...v0.8.45
[0.8.44]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.43...v0.8.44
[0.8.34]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.33...v0.8.34
[0.8.33]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.32...v0.8.33
[0.8.32]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.31...v0.8.32
[0.8.31]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.30...v0.8.31
[0.8.30]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.29...v0.8.30
[0.8.29]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.28...v0.8.29
[0.8.28]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.27...v0.8.28
[0.8.27]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.26...v0.8.27
[0.8.26]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.25...v0.8.26
[0.8.25]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.24...v0.8.25
[0.8.24]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.23...v0.8.24
[0.8.23]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.22...v0.8.23
[0.8.22]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.21...v0.8.22
[0.8.21]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.20...v0.8.21
[0.8.20]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.19...v0.8.20
[0.8.19]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.18...v0.8.19
[0.8.18]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.17...v0.8.18
[0.8.17]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.16...v0.8.17
[0.8.16]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.15...v0.8.16
[0.8.15]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.14...v0.8.15
[0.8.14]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.13...v0.8.14
[0.8.13]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.12...v0.8.13
[0.8.12]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.11...v0.8.12
[0.8.11]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.10...v0.8.11
[0.8.10]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.9...v0.8.10
[0.8.9]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.8...v0.8.9
[0.8.8]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.7...v0.8.8
[0.8.7]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.6...v0.8.7
[0.8.6]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.5...v0.8.6
[0.8.5]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.4...v0.8.5
[0.8.4]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.3...v0.8.4
[0.8.3]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/nekoguntai-castle/sanctuary/compare/v0.7.28...v0.8.0
